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
// --- eforge:region plan-02-validation-repair-routing ---
import {
  stableJsonStringify,
  writeValidationRecoveryCheckpoint,
  type ValidationRecoveryCheckpointReference,
  type ValidationRecoveryRepairStrategy,
} from '../../validation-recovery-checkpoints.js';
// --- eforge:endregion plan-02-validation-repair-routing ---
import type { BuildStageContext } from '../types.js';

// --- eforge:region plan-02-validation-repair-routing ---
export type ValidationRecoveryRepairClass = NonNullable<ReviewIssue['repairClass']> | 'unspecified';

export interface ValidationRecoveryRepairContext {
  providerName: string;
  repairStrategy: ValidationRecoveryRepairStrategy;
  repairClass: ValidationRecoveryRepairClass;
  attempt: number;
  maxAttempts: number;
  checkpoint: ValidationRecoveryCheckpointReference;
  issues: ReviewIssue[];
  signatures: string[];
  failureSummary: string;
  promptContext: string;
}

export type ValidationRecoveryRoute =
  | { repairStrategy: ValidationRecoveryRepairStrategy; repairClass: ValidationRecoveryRepairClass; reason: string }
  | { repairStrategy: 'manual'; repairClass: ValidationRecoveryRepairClass; reason: string };
// --- eforge:endregion plan-02-validation-repair-routing ---

export interface ValidationProviderRecoveryCallbacks {
  runReviewFix: (context: ValidationRecoveryRepairContext) => AsyncIterable<EforgeEvent>;
  // --- eforge:region plan-02-validation-repair-routing ---
  runStructuralValidationFix?: (context: ValidationRecoveryRepairContext) => AsyncIterable<EforgeEvent>;
  runEvaluate: (overrides?: { strictness?: 'strict' | 'standard' | 'lenient'; validationRepairContext?: ValidationRecoveryRepairContext }) => AsyncIterable<EforgeEvent>;
  // --- eforge:endregion plan-02-validation-repair-routing ---
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
  getChangedFiles?: () => Promise<string[] | undefined>,
): AsyncGenerator<EforgeEvent> {
  const providers = ctx.extensionValidationProviders;
  if (!providers || providers.length === 0) return;

  const timeoutMs = ctx.config.extensions.validationProviderTimeoutMs;
  const maxAttempts = ctx.review.maxRounds;
  const previousReviewIssues = ctx.reviewIssues;
  let injectedReviewIssues: ReviewIssue[] | undefined;
  let injectedReviewIssuesSnapshot: ReviewIssue[] | undefined;
  let attempts = 0;
  // --- eforge:region plan-02-validation-repair-routing ---
  const narrowAttemptedSignatures = new Set<string>();
  let latestCheckpoint: ValidationRecoveryCheckpointReference | undefined;
  // --- eforge:endregion plan-02-validation-repair-routing ---

  while (true) {
    let shouldRestart = false;

    for (const registration of providers) {
      const changedFiles = getChangedFiles ? await getChangedFiles() : undefined;
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
        yield buildFailureEvent(ctx.planId, appendLatestCheckpoint(result.outcome.message ?? `Validation provider "${registration.name}" failed`, latestCheckpoint));
        ctx.buildFailed = true;
        return;
      }

      // --- eforge:region plan-02-validation-repair-routing ---
      const recoveryIssues = validationFailureToReviewIssues(registration, result.outcome);
      const signatures = validationFailureSignatures(registration, result.outcome);
      const route = selectValidationRecoveryStrategy(recoveryIssues, signatures, narrowAttemptedSignatures);
      const failureSummary = summarizeValidationFailure(registration, result.outcome);

      if (route.repairStrategy === 'manual') {
        yield progressEvent(ctx.planId, `Validation provider "${registration.name}" requested ${route.repairClass} repair; no automated validation recovery will run.${checkpointSuffix(latestCheckpoint)}`);
        yield buildFailureEvent(ctx.planId, appendLatestCheckpoint(result.outcome.message ?? failureSummary, latestCheckpoint));
        ctx.buildFailed = true;
        return;
      }

      if (attempts >= maxAttempts) {
        yield progressEvent(ctx.planId, `Validation provider recovery exhausted after ${maxAttempts} attempt(s) for "${registration.name}".${checkpointSuffix(latestCheckpoint)}`);
        yield buildFailureEvent(ctx.planId, appendLatestCheckpoint(result.outcome.message ?? `Validation provider "${registration.name}" failed`, latestCheckpoint));
        ctx.buildFailed = true;
        return;
      }

      attempts += 1;
      injectedReviewIssues = recoveryIssues;
      injectedReviewIssuesSnapshot = [...injectedReviewIssues];
      ctx.reviewIssues = injectedReviewIssues;

      let checkpoint: ValidationRecoveryCheckpointReference;
      try {
        checkpoint = await writeValidationRecoveryCheckpoint({
          cwd: checkpointRoot(ctx),
          worktreePath: ctx.worktreePath,
          planSetName: checkpointPlanSet(ctx),
          planId: ctx.planId,
          attempt: attempts,
          providerName: registration.name,
          repairStrategy: route.repairStrategy,
          repairClass: route.repairClass,
          issues: recoveryIssues,
          signatures,
          failureSummary,
        });
      } catch (error) {
        yield buildFailureEvent(ctx.planId, `Validation recovery checkpoint failed for "${registration.name}": ${errorMessage(error)}`);
        ctx.buildFailed = true;
        return;
      }
      latestCheckpoint = checkpoint;

      const repairContext = buildValidationRecoveryRepairContext({
        providerName: registration.name,
        repairStrategy: route.repairStrategy,
        repairClass: route.repairClass,
        attempt: attempts,
        maxAttempts,
        checkpoint,
        issues: recoveryIssues,
        signatures,
        failureSummary,
      });

      yield progressEvent(ctx.planId, `Validation provider "${registration.name}" failed; running recovery attempt ${attempts} of ${maxAttempts} via ${route.repairStrategy} repair.`);
      yield progressEvent(ctx.planId, `Validation recovery checkpoint written for "${registration.name}": ${checkpoint.directory}`);

      if (route.repairStrategy === 'narrow') {
        for (const signature of signatures) narrowAttemptedSignatures.add(signature);
        for await (const event of callbacks.runReviewFix(repairContext)) {
          yield event;
          if (ctx.buildFailed) return;
        }
      } else {
        if (!callbacks.runStructuralValidationFix) {
          yield buildFailureEvent(ctx.planId, appendLatestCheckpoint(`Structural validation repair was routed for "${registration.name}" but no structural validation-fixer callback is configured.`, checkpoint));
          ctx.buildFailed = true;
          return;
        }
        for await (const event of callbacks.runStructuralValidationFix(repairContext)) {
          yield event;
          if (ctx.buildFailed) return;
        }
      }
      // --- eforge:endregion plan-02-validation-repair-routing ---
      if (ctx.buildFailed) return;

      for await (const event of callbacks.runEvaluate({ strictness: ctx.review.evaluatorStrictness, validationRepairContext: repairContext })) {
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

// --- eforge:region plan-02-validation-repair-routing ---
export function validationFailureSignatures(
  provider: ValidationProviderRegistration,
  outcome: NormalizedValidationResult,
): string[] {
  const entries = outcome.annotations && outcome.annotations.length > 0
    ? outcome.annotations.map((annotation) => annotationSignature(provider, annotation))
    : [stableJsonStringify({
        providerName: provider.name,
        file: pseudoFileForProvider(provider.name),
        failureKind: '',
        message: normalizeSignatureMessage(outcome.message ?? outcome.details ?? describeValidationFailure(provider, outcome)),
        metadata: {},
      })];
  return [...new Set(entries)].sort();
}

export function selectValidationRecoveryStrategy(
  issues: ReviewIssue[],
  signatures: string[],
  narrowAttemptedSignatures: ReadonlySet<string>,
): ValidationRecoveryRoute {
  const repairClass = summarizeRepairClass(issues);
  if (issues.some((issue) => issue.repairClass === 'manual')) {
    return { repairStrategy: 'manual', repairClass, reason: 'provider requested manual handling' };
  }
  if (issues.length > 0 && issues.every((issue) => issue.repairClass === 'followup')) {
    return { repairStrategy: 'manual', repairClass, reason: 'provider requested follow-up handling' };
  }
  if (issues.some((issue) => issue.repairClass === 'structural')) {
    return { repairStrategy: 'structural', repairClass, reason: 'provider requested structural repair' };
  }
  if (signatures.some((signature) => narrowAttemptedSignatures.has(signature))) {
    return { repairStrategy: 'structural', repairClass, reason: 'signature survived a prior narrow repair attempt' };
  }
  return { repairStrategy: 'narrow', repairClass, reason: 'provider requested narrow or unspecified repair' };
}

export function renderValidationRepairContext(
  context: Omit<ValidationRecoveryRepairContext, 'promptContext'>,
): string {
  const lines = [
    '# Validation Provider Repair Context',
    '',
    `Provider: ${context.providerName}`,
    `Repair strategy: ${context.repairStrategy}`,
    `Repair class: ${context.repairClass}`,
    `Attempt: ${context.attempt} of ${context.maxAttempts}`,
    `Checkpoint directory: ${context.checkpoint.directory}`,
    `Checkpoint patch: ${context.checkpoint.patchPath}`,
    `Checkpoint metadata: ${context.checkpoint.metadataPath}`,
    '',
    '## Validation Failure Summary',
    '',
    context.failureSummary,
    '',
    '## Failure Signatures',
    '',
    ...context.signatures.map((signature) => `- ${signature}`),
    '',
    '## Provider Guidance',
  ];

  for (const [index, issue] of context.issues.entries()) {
    lines.push('', `${index + 1}. ${issue.file}${issue.line !== undefined ? `:${issue.line}` : ''} — ${issue.severity}/${issue.category}`);
    lines.push(`   Description: ${issue.description}`);
    if (issue.fix) lines.push(`   Fix guidance: ${issue.fix}`);
    if (issue.retryGuidance) lines.push(`   Retry guidance: ${issue.retryGuidance}`);
    if (issue.repairClass) lines.push(`   Repair class: ${issue.repairClass}`);
    if (issue.failureKind) lines.push(`   Provider failure kind: ${issue.failureKind}`);
    if (issue.runtimeFailureKind) lines.push(`   Runtime failure kind: ${issue.runtimeFailureKind}`);
    if (issue.validationProviderName) lines.push(`   Validation provider: ${issue.validationProviderName}`);
    if (issue.metadata !== undefined) lines.push(`   Metadata: ${stableJsonStringify(issue.metadata)}`);
  }

  return lines.join('\n');
}

function buildValidationRecoveryRepairContext(
  context: Omit<ValidationRecoveryRepairContext, 'promptContext'>,
): ValidationRecoveryRepairContext {
  return { ...context, promptContext: renderValidationRepairContext(context) };
}

function annotationSignature(
  provider: ValidationProviderRegistration,
  annotation: NormalizedValidationAnnotation,
): string {
  return stableJsonStringify({
    providerName: provider.name,
    file: annotation.file ?? pseudoFileForProvider(provider.name),
    failureKind: annotation.failureKind ?? '',
    message: normalizeSignatureMessage(annotation.message),
    metadata: annotation.metadata ?? {},
  });
}

function normalizeSignatureMessage(message: string): string {
  return message.trim().replace(/\s+/g, ' ').toLowerCase();
}

function summarizeRepairClass(issues: ReviewIssue[]): ValidationRecoveryRepairClass {
  const classes = issues.map((issue) => issue.repairClass).filter((value): value is NonNullable<ReviewIssue['repairClass']> => value !== undefined);
  if (classes.includes('structural')) return 'structural';
  if (classes.length > 0 && classes.every((value) => value === 'manual')) return 'manual';
  if (classes.length > 0 && classes.every((value) => value === 'followup')) return 'followup';
  if (classes.includes('narrow')) return 'narrow';
  if (classes.includes('manual')) return 'manual';
  if (classes.includes('followup')) return 'followup';
  return 'unspecified';
}

function summarizeValidationFailure(
  provider: ValidationProviderRegistration,
  outcome: NormalizedValidationResult,
): string {
  return outcome.annotations && outcome.annotations.length > 0
    ? outcome.annotations.map((annotation) => `Validation provider "${provider.name}" reported: ${annotation.message}${annotation.details ? `\nDetails: ${annotation.details}` : ''}`).join('\n\n')
    : describeValidationFailure(provider, outcome);
}

function checkpointRoot(ctx: BuildStageContext): string {
  return typeof ctx.cwd === 'string' && ctx.cwd.length > 0 ? ctx.cwd : ctx.worktreePath;
}

function checkpointPlanSet(ctx: BuildStageContext): string {
  return typeof ctx.planSetName === 'string' && ctx.planSetName.length > 0 ? ctx.planSetName : 'default';
}

function checkpointSuffix(checkpoint: ValidationRecoveryCheckpointReference | undefined): string {
  return checkpoint ? ` Latest validation recovery checkpoint: ${checkpoint.directory}.` : '';
}

function appendLatestCheckpoint(message: string, checkpoint: ValidationRecoveryCheckpointReference | undefined): string {
  return checkpoint ? `${message}\nLatest validation recovery checkpoint: ${checkpoint.directory}` : message;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
// --- eforge:endregion plan-02-validation-repair-routing ---

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
