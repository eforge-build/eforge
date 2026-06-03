/**
 * Validation provider recovery runtime for the build validate stage.
 */

import type { EforgeEvent, ReviewIssue } from '../../events.js';
import type { ValidationProviderRegistration } from '../../extensions/types.js';
import {
  runValidationProvider,
  type NormalizedValidationAnnotation,
  type NormalizedValidationResult,
} from '../../extensions/validation-provider-runtime.js';
import type { BuildStageContext } from '../types.js';

export interface ValidationProviderRecoveryCallbacks {
  runReviewFix: () => AsyncIterable<EforgeEvent>;
  runEvaluate: (overrides?: { strictness?: 'strict' | 'standard' | 'lenient' }) => AsyncIterable<EforgeEvent>;
}

export function isRecoverableValidationFailure(outcome: NormalizedValidationResult): boolean {
  return outcome.status === 'failed' && (outcome.runtimeFailureKind === 'result' || outcome.runtimeFailureKind === 'command');
}

export function isHardValidationFailure(outcome: NormalizedValidationResult): boolean {
  return outcome.status === 'failed' && !isRecoverableValidationFailure(outcome);
}

export function validationFailureToReviewIssues(
  provider: ValidationProviderRegistration,
  outcome: NormalizedValidationResult,
): ReviewIssue[] {
  if (outcome.annotations && outcome.annotations.length > 0) {
    return outcome.annotations.map((annotation) => annotationToReviewIssue(provider, annotation, outcome));
  }
  return [synthesizeReviewIssue(provider, outcome)];
}

export async function* runValidationProviderRecoveryStage(
  ctx: BuildStageContext,
  callbacks: ValidationProviderRecoveryCallbacks,
  changedFiles?: string[],
): AsyncGenerator<EforgeEvent> {
  const providers = ctx.extensionValidationProviders;
  if (!providers || providers.length === 0) return;

  const timeoutMs = ctx.config.extensions.validationProviderTimeoutMs;
  const maxAttempts = ctx.review.maxRounds;
  const previousReviewIssues = ctx.reviewIssues;
  let injectedReviewIssues: ReviewIssue[] | undefined;
  let injectedReviewIssuesSnapshot: ReviewIssue[] | undefined;
  let attempts = 0;

  while (true) {
    let shouldRestart = false;

    for (const registration of providers) {
      const result = await runValidationProvider(
        registration,
        {
          planId: ctx.planId,
          planOutputDir: ctx.worktreePath,
          worktreePath: ctx.worktreePath,
          signal: ctx.abortController?.signal,
          // Fresh clone per provider so a provider mutating ctx.changedFiles cannot leak across providers.
          ...(changedFiles !== undefined && { changedFiles: [...changedFiles] }),
        },
        { timeoutMs },
      );

      for (const event of result.events) {
        yield event;
      }

      if (result.outcome.status !== 'failed') continue;

      if (isHardValidationFailure(result.outcome)) {
        yield buildFailureEvent(ctx.planId, result.outcome.message ?? `Validation provider "${registration.name}" failed`);
        ctx.buildFailed = true;
        return;
      }

      if (attempts >= maxAttempts) {
        yield progressEvent(ctx.planId, `Validation provider recovery exhausted after ${maxAttempts} attempt(s) for "${registration.name}".`);
        yield buildFailureEvent(ctx.planId, result.outcome.message ?? `Validation provider "${registration.name}" failed`);
        ctx.buildFailed = true;
        return;
      }

      attempts += 1;
      injectedReviewIssues = validationFailureToReviewIssues(registration, result.outcome);
      injectedReviewIssuesSnapshot = [...injectedReviewIssues];
      ctx.reviewIssues = injectedReviewIssues;
      yield progressEvent(ctx.planId, `Validation provider "${registration.name}" failed; running recovery attempt ${attempts} of ${maxAttempts}.`);

      for await (const event of callbacks.runReviewFix()) {
        yield event;
        if (ctx.buildFailed) return;
      }
      if (ctx.buildFailed) return;

      for await (const event of callbacks.runEvaluate({ strictness: ctx.review.evaluatorStrictness })) {
        yield event;
        if (ctx.buildFailed) return;
      }
      if (ctx.buildFailed) return;

      shouldRestart = true;
      break;
    }

    if (!shouldRestart) {
      if (injectedReviewIssues && ctx.reviewIssues === injectedReviewIssues && reviewIssuesUnchanged(ctx.reviewIssues, injectedReviewIssuesSnapshot)) {
        ctx.reviewIssues = previousReviewIssues;
      }
      return;
    }
  }
}

function reviewIssuesUnchanged(current: ReviewIssue[], snapshot: ReviewIssue[] | undefined): boolean {
  if (!snapshot || current.length !== snapshot.length) return false;
  return current.every((issue, index) => issue === snapshot[index]);
}

function annotationToReviewIssue(
  provider: ValidationProviderRegistration,
  annotation: NormalizedValidationAnnotation,
  outcome: NormalizedValidationResult,
): ReviewIssue {
  const descriptionParts = [`Validation provider "${provider.name}" reported: ${annotation.message}`];
  if (annotation.details) descriptionParts.push(`Details: ${annotation.details}`);
  if (outcome.command) descriptionParts.push(`Command: ${outcome.command}`);
  if (outcome.exitCode !== undefined) descriptionParts.push(`Exit code: ${outcome.exitCode}`);
  return {
    severity: mapAnnotationSeverity(annotation.severity),
    category: 'validation-provider',
    file: annotation.file ?? pseudoFileForProvider(provider.name),
    ...(annotation.line !== undefined ? { line: annotation.line } : {}),
    description: descriptionParts.join('\n'),
    ...(annotation.fix !== undefined ? { fix: annotation.fix } : {}),
    ...(annotation.retryGuidance !== undefined ? { retryGuidance: annotation.retryGuidance } : {}),
    ...(annotation.failureKind !== undefined ? { failureKind: annotation.failureKind } : {}),
    ...(annotation.repairClass !== undefined ? { repairClass: annotation.repairClass } : {}),
    ...(annotation.metadata !== undefined ? { metadata: annotation.metadata } : {}),
    validationProviderName: provider.name,
    ...(outcome.runtimeFailureKind !== undefined ? { runtimeFailureKind: outcome.runtimeFailureKind } : {}),
  };
}

function synthesizeReviewIssue(
  provider: ValidationProviderRegistration,
  outcome: NormalizedValidationResult,
): ReviewIssue {
  return {
    severity: 'critical',
    category: 'validation-provider',
    file: pseudoFileForProvider(provider.name),
    description: describeValidationFailure(provider, outcome),
    validationProviderName: provider.name,
    ...(outcome.runtimeFailureKind !== undefined ? { runtimeFailureKind: outcome.runtimeFailureKind } : {}),
  };
}

function describeValidationFailure(
  provider: ValidationProviderRegistration,
  outcome: NormalizedValidationResult,
): string {
  const parts = [`Validation provider "${provider.name}" failed.`];
  if (outcome.message) parts.push(`Message: ${outcome.message}`);
  if (outcome.details) parts.push(`Details: ${outcome.details}`);
  if (outcome.command) parts.push(`Command: ${outcome.command}`);
  if (outcome.exitCode !== undefined) parts.push(`Exit code: ${outcome.exitCode}`);
  return parts.join('\n');
}

function mapAnnotationSeverity(severity: NormalizedValidationAnnotation['severity']): ReviewIssue['severity'] {
  if (severity === 'error') return 'critical';
  if (severity === 'warning') return 'warning';
  return 'suggestion';
}

function pseudoFileForProvider(providerName: string): string {
  const safeName = providerName.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'provider';
  return `.eforge/validation-providers/${safeName}.txt`;
}

function progressEvent(planId: string, message: string): EforgeEvent {
  return { timestamp: new Date().toISOString(), type: 'plan:build:progress', planId, message };
}

function buildFailureEvent(planId: string, error: string): EforgeEvent {
  return { timestamp: new Date().toISOString(), type: 'plan:build:failed', planId, error };
}
