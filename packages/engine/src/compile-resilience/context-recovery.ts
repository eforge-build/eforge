import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

import {
  MAX_COMPILE_RISK_LIST_ITEMS,
  type CompileArtifactSummary,
  type CompileContextGuardDiagnostics,
  type CompilePreflightRisk,
  type CompileRecoveryAction,
  type CompileScopeContextFailure,
  type EforgeEvent,
} from '../events.js';
import { RECOVERY_SIDECAR_COMPILE_SCOPE_CONTEXT_REASON_MAX_BYTES, type RecoverySidecarRecoveryOption } from '@eforge-build/client';
import type { PipelineContext } from '../pipeline/types.js';
import { estimateCompilePreflightRisk } from './preflight.js';
import { AgentTerminalError } from '../harness.js';
import { CompileScopeContextError } from './context-guard.js';
import { validateCompileArtifacts } from './artifact-validation.js';
import { boundProviderContextExplanation, classifyProviderContextError } from './provider-context.js';
// --- eforge:region plan-04-compile-orchestration-synthesis ---
import type { DecompositionPlanningError } from './planning-decomposition.js';
// --- eforge:endregion plan-04-compile-orchestration-synthesis ---
export { classifyProviderContextError, MAX_PROVIDER_CONTEXT_EXPLANATION_BYTES } from './provider-context.js';

export interface CompileScopeRecoveryState {
  sourceHash: string;
  retryAsExpeditionAttempts: number;
  maxRetryAsExpeditionAttempts: number;
  attemptedSourceHashes: string[];
  lastFailure?: CompileScopeContextFailure;
}

export interface CompileScopeContextFailureInput {
  source: CompileScopeContextFailure['source'];
  failureKind: CompileScopeContextFailure['failureKind'];
  stage: CompileScopeContextFailure['stage'];
  explanation: string;
  observed?: CompileScopeContextFailure['observed'];
  decompositionEvidence?: CompileScopeContextFailure['decompositionEvidence'];
  risk?: CompilePreflightRisk;
  guardDiagnostics?: CompileContextGuardDiagnostics;
}

const MAX_REASON_BYTES = RECOVERY_SIDECAR_COMPILE_SCOPE_CONTEXT_REASON_MAX_BYTES;
const EXPEDITION_COMPILE = ['planner', 'architecture-review-cycle', 'module-planning', 'cohesion-review-cycle', 'compile-expedition'];

export async function toCompileScopeContextError(
  ctx: PipelineContext,
  error: unknown,
  fallbackStage: CompileScopeContextFailureInput['stage'],
  guardDiagnostics?: CompileContextGuardDiagnostics,
): Promise<CompileScopeContextError | null> {
  if (error instanceof CompileScopeContextError) {
    return new CompileScopeContextError(await buildCompileScopeContextFailure(ctx, {
      source: error.failure.source,
      failureKind: error.failure.failureKind,
      stage: error.failure.stage ?? fallbackStage,
      explanation: error.failure.explanation,
      observed: error.failure.observed,
      decompositionEvidence: error.failure.decompositionEvidence,
      risk: error.failure.risk ?? ctx.compilePreflight,
      guardDiagnostics: error.failure.guardDiagnostics ?? guardDiagnostics,
    }));
  }
  const provider = classifyProviderContextError(error) ?? (error instanceof AgentTerminalError && error.subtype === 'error_context_window'
    ? { failureKind: 'context-window' as const, explanation: boundProviderContextExplanation(error.message) }
    : null);
  if (!provider) return null;
  return new CompileScopeContextError(await buildCompileScopeContextFailure(ctx, {
    source: 'provider',
    failureKind: provider.failureKind,
    stage: fallbackStage,
    explanation: provider.explanation,
    risk: ctx.compilePreflight,
    guardDiagnostics,
  }));
}

export async function buildPreflightEscalationDecision(
  ctx: PipelineContext,
): Promise<{ failure: CompileScopeContextFailure; retryAsExpedition: boolean } | null> {
  const risk = ctx.compilePreflight;
  if (!risk || risk.recommendation.action !== 'retry-as-expedition' || !risk.recommendation.eligible) return null;
  if (ctx.pipeline.scope === 'expedition') return null;
  const failure = await buildCompileScopeContextFailure(ctx, {
    source: 'preflight',
    failureKind: 'scope-too-broad',
    stage: 'planner',
    explanation: risk.recommendation.reason,
    risk,
  });
  return { failure, retryAsExpedition: failure.recovery.action === 'retry-as-expedition' && failure.recovery.eligible };
}

// --- eforge:region plan-04-compile-orchestration-synthesis ---
export async function toDecompositionCompileScopeFailure(ctx: PipelineContext, error: DecompositionPlanningError): Promise<CompileScopeContextFailure> {
  return buildCompileScopeContextFailure(ctx, {
    source: error.source,
    failureKind: error.kind,
    stage: error.stage,
    explanation: error.message,
    decompositionEvidence: error.evidence,
    risk: ctx.compilePreflight,
  });
}
// --- eforge:endregion plan-04-compile-orchestration-synthesis ---

export async function buildCompileScopeContextFailure(ctx: PipelineContext, input: CompileScopeContextFailureInput): Promise<CompileScopeContextFailure> {
  const state = ensureCompileScopeRecoveryState(ctx);
  const artifacts = await summarizeCompileArtifactsForRecovery(ctx);
  const action = chooseRecoveryAction(ctx, input, state, artifacts);
  const failure: CompileScopeContextFailure = {
    source: input.source,
    failureKind: input.failureKind,
    stage: input.stage,
    explanation: capUtf8(input.explanation, 1500),
    ...(input.risk ?? ctx.compilePreflight ? { risk: input.risk ?? ctx.compilePreflight } : {}),
    ...(input.observed ? { observed: input.observed } : {}),
    ...(input.decompositionEvidence ? { decompositionEvidence: input.decompositionEvidence } : {}),
    ...(input.guardDiagnostics ? { guardDiagnostics: input.guardDiagnostics } : {}),
    recovery: {
      action,
      eligible: action !== 'manual-reduce-scope' && action !== 'none',
      attempted: false,
      attempt: state.retryAsExpeditionAttempts,
      maxAttempts: state.maxRetryAsExpeditionAttempts,
      reason: capUtf8(recoveryReason(ctx, action, input, state, artifacts), MAX_REASON_BYTES),
    },
    artifacts,
  };
  state.lastFailure = failure;
  return failure;
}

export function markRetryAsExpeditionStarted(ctx: PipelineContext, failure: CompileScopeContextFailure): void {
  const state = ensureCompileScopeRecoveryState(ctx);
  if (!state.attemptedSourceHashes.includes(state.sourceHash)) {
    state.retryAsExpeditionAttempts += 1;
    state.attemptedSourceHashes.push(state.sourceHash);
  }
  const updated: CompileScopeContextFailure = {
    ...failure,
    recovery: {
      ...failure.recovery,
      attempted: true,
      attempt: Math.max(1, state.retryAsExpeditionAttempts),
      maxAttempts: state.maxRetryAsExpeditionAttempts,
    },
  };
  state.lastFailure = updated;
}

export function applyRetryAsExpeditionPipeline(ctx: PipelineContext, reason: string): void {
  ctx.pipeline = {
    ...ctx.pipeline,
    scope: 'expedition',
    compile: [...EXPEDITION_COMPILE],
    rationale: capUtf8(`${ctx.pipeline.rationale}\n\nCompile context recovery escalated this run to expedition scope: ${reason}`, 2000),
  };
  if (ctx.compilePromptSourceBundle && ctx.compilePreflightOptions) {
    ctx.compilePreflightOptions = { ...ctx.compilePreflightOptions, requestedPipelineScope: 'expedition' };
    ctx.compilePreflight = estimateCompilePreflightRisk(ctx.compilePromptSourceBundle, ctx.compilePreflightOptions);
  }
}

export function scopeContextFailureEvent(failure: CompileScopeContextFailure, runId?: string): EforgeEvent {
  return { timestamp: new Date().toISOString(), type: 'planning:scope-context:failure', ...(runId !== undefined ? { runId } : {}), failure };
}

export function compileScopeTerminalFailureEvent(input: { runId: string; failure: CompileScopeContextFailure }): EforgeEvent {
  return {
    timestamp: new Date().toISOString(),
    type: 'build:terminal-failure',
    runId: input.runId,
    failure: {
      scope: 'compile',
      stage: input.failure.stage,
      message: input.failure.explanation,
      authoritative: true,
      terminalSubtype: 'error_context_window',
    },
  };
}

export async function summarizeCompileArtifactsForRecovery(ctx: PipelineContext): Promise<CompileArtifactSummary> {
  const result = await validateCompileArtifacts(ctx);
  if (result.ok) return result.summary;
  if (!result.summary.orchestrationExists || result.summary.invalidPlanCount > 0 || result.summary.missingPlanFileCount > 0) return result.summary;
  return {
    ...result.summary,
    invalidPlanCount: 1,
    invalidPlanFiles: ['orchestration.yaml', ...result.summary.invalidPlanFiles].slice(0, MAX_COMPILE_RISK_LIST_ITEMS),
  };
}

export function compileScopeContextRecoveryOption(failure: CompileScopeContextFailure): RecoverySidecarRecoveryOption | undefined {
  if (failure.recovery.action === 'none' || failure.recovery.action === 'repair-existing-artifacts') return undefined;
  return {
    kind: 'compile-scope-context',
    action: failure.recovery.action,
    recommended: true,
    eligible: failure.recovery.eligible,
    reason: failure.recovery.reason,
    attempted: failure.recovery.attempted,
    attempt: failure.recovery.attempt,
    maxAttempts: failure.recovery.maxAttempts,
    source: failure.source,
    failureKind: failure.failureKind,
    ...(failure.decompositionEvidence ? { decompositionEvidence: failure.decompositionEvidence } : {}),
  };
}

export function readCompileScopeContextRecoveryOptionFromDb(input: { dbPath?: string; runId?: string; setName?: string }): RecoverySidecarRecoveryOption | undefined {
  if (!input.dbPath) return undefined;
  try {
    const db = new DatabaseSync(input.dbPath, { readOnly: true });
    try {
      const row = input.runId
        ? db.prepare(`SELECT data FROM events WHERE run_id = ? AND type = 'planning:scope-context:failure' ORDER BY id DESC LIMIT 1`).get(input.runId)
        : db.prepare(`SELECT e.data FROM events e JOIN runs r ON r.id = e.run_id WHERE r.plan_set = ? AND e.type = 'planning:scope-context:failure' ORDER BY e.id DESC LIMIT 1`).get(input.setName ?? '');
      const data = typeof (row as { data?: unknown } | undefined)?.data === 'string' ? JSON.parse((row as { data: string }).data) as { failure?: CompileScopeContextFailure } : undefined;
      return data?.failure ? compileScopeContextRecoveryOption(data.failure) : undefined;
    } finally {
      db.close();
    }
  } catch {
    return undefined;
  }
}

function chooseRecoveryAction(ctx: PipelineContext, input: CompileScopeContextFailureInput, state: CompileScopeRecoveryState, artifacts: CompileArtifactSummary): CompileRecoveryAction {
  if (artifacts.orchestrationExists && artifacts.validPlanCount > 0 && artifacts.invalidPlanCount === 0 && artifacts.missingPlanFileCount === 0) return 'repair-existing-artifacts';
  const alreadyAttempted = state.attemptedSourceHashes.includes(state.sourceHash);
  const wantsRetry = input.stage === 'planner'
    && input.risk?.recommendation.action === 'retry-as-expedition'
    && input.risk.recommendation.eligible;
  if (ctx.pipeline.scope !== 'expedition' && wantsRetry && state.retryAsExpeditionAttempts < state.maxRetryAsExpeditionAttempts && !alreadyAttempted) return 'retry-as-expedition';
  if (ctx.pipeline.scope === 'expedition' || state.retryAsExpeditionAttempts >= state.maxRetryAsExpeditionAttempts || alreadyAttempted || input.risk?.recommendation.action === 'bounded-decomposition') return 'bounded-decomposition';
  return 'manual-reduce-scope';
}

function recoveryReason(ctx: PipelineContext, action: CompileRecoveryAction, input: CompileScopeContextFailureInput, state: CompileScopeRecoveryState, artifacts: CompileArtifactSummary): string {
  if (action === 'repair-existing-artifacts') return `Valid compile artifacts exist (${artifacts.validPlanCount} plan file(s)); prefer continue/repair over retrying compile.`;
  const compactGuidance = plannerCompactInspectionGuidance(ctx, input, artifacts);
  if (action === 'retry-as-expedition') return withCompactGuidance(`Context failure at ${input.stage} is eligible for one bounded retry as expedition for the same source hash.`, compactGuidance);
  if (action === 'bounded-decomposition') return withCompactGuidance(`Retry-as-expedition is not available or already attempted (${state.retryAsExpeditionAttempts}/${state.maxRetryAsExpeditionAttempts}); decompose the source into bounded follow-up PRDs.`, compactGuidance);
  if (action === 'manual-reduce-scope') return withCompactGuidance('Compile scope/context evidence is incomplete or ambiguous; manually reduce scope before retrying.', compactGuidance);
  return input.explanation;
}

function plannerCompactInspectionGuidance(ctx: PipelineContext, input: CompileScopeContextFailureInput, artifacts: CompileArtifactSummary): string | undefined {
  if (input.stage !== 'planner') return undefined;
  if (artifacts.validPlanCount > 0 || artifacts.orchestrationExists) return undefined;
  if (ctx.plannerInspectionSummary) return 'Automatic compact-inspection continuation was attempted and exhausted without producing valid planning artifacts.';
  return 'Automatic compact-inspection continuation is only available when soft planner inspection pressure is observed before the hard context guard; no compact handoff artifact was available for this failure.';
}

function withCompactGuidance(reason: string, compactGuidance: string | undefined): string {
  return compactGuidance ? `${reason} ${compactGuidance}` : reason;
}

function ensureCompileScopeRecoveryState(ctx: PipelineContext): CompileScopeRecoveryState {
  const existing = ctx.compileScopeRecovery;
  const sourceHash = createHash('sha256').update(ctx.sourceContent).digest('hex');
  if (existing && existing.sourceHash === sourceHash) return existing;
  const created: CompileScopeRecoveryState = { sourceHash, retryAsExpeditionAttempts: 0, maxRetryAsExpeditionAttempts: 1, attemptedSourceHashes: [] };
  ctx.compileScopeRecovery = created;
  return created;
}

function capUtf8(text: string, maxBytes: number): string {
  if (Buffer.byteLength(text, 'utf8') <= maxBytes) return text;
  const ellipsis = '…';
  let end = Math.max(0, maxBytes - Buffer.byteLength(ellipsis, 'utf8'));
  while (Buffer.byteLength(text.slice(0, end), 'utf8') > maxBytes - Buffer.byteLength(ellipsis, 'utf8')) end--;
  return `${text.slice(0, end)}${ellipsis}`;
}
