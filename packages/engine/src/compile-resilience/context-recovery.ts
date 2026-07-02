import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

import {
  MAX_COMPILE_RISK_LIST_ITEMS,
  type CompileArtifactSummary,
  type CompileContextGuardDiagnostics,
  type CompileRecoveryAction,
  type CompileScopeContextFailure,
  type EforgeEvent,
} from '../events.js';
import { RECOVERY_SIDECAR_COMPILE_SCOPE_CONTEXT_REASON_MAX_BYTES, type RecoverySidecarRecoveryOption } from '@eforge-build/client';
import type { PipelineContext } from '../pipeline/types.js';
import { AgentTerminalError } from '../harness.js';
import { CompileScopeContextError } from './context-guard.js';
import { validateCompileArtifacts } from './artifact-validation.js';
import { boundProviderContextExplanation, classifyProviderContextError } from './provider-context.js';
export { classifyProviderContextError, MAX_PROVIDER_CONTEXT_EXPLANATION_BYTES } from './provider-context.js';

export interface CompileScopeRecoveryState {
  sourceHash: string;
  lastFailure?: CompileScopeContextFailure;
}

type DecompositionCompileScopeContextFailure = Extract<CompileScopeContextFailure, { source: 'decomposition' }>;
type NonDecompositionCompileScopeContextFailure = Exclude<CompileScopeContextFailure, { source: 'decomposition' }>;

type CompileScopeContextFailureInputBase = {
  explanation: string;
  observed?: CompileScopeContextFailure['observed'];
  guardDiagnostics?: CompileContextGuardDiagnostics;
};

export type CompileScopeContextFailureInput =
  | (CompileScopeContextFailureInputBase & {
      source: DecompositionCompileScopeContextFailure['source'];
      failureKind: DecompositionCompileScopeContextFailure['failureKind'];
      stage: DecompositionCompileScopeContextFailure['stage'];
      decompositionEvidence: DecompositionCompileScopeContextFailure['decompositionEvidence'];
    })
  | (CompileScopeContextFailureInputBase & {
      source: NonDecompositionCompileScopeContextFailure['source'];
      failureKind: NonDecompositionCompileScopeContextFailure['failureKind'];
      stage: NonDecompositionCompileScopeContextFailure['stage'];
      decompositionEvidence?: never;
    });

const MAX_REASON_BYTES = RECOVERY_SIDECAR_COMPILE_SCOPE_CONTEXT_REASON_MAX_BYTES;

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
      guardDiagnostics: error.failure.guardDiagnostics ?? guardDiagnostics,
    } as CompileScopeContextFailureInput));
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
    guardDiagnostics,
  }));
}

export async function buildCompileScopeContextFailure(ctx: PipelineContext, input: CompileScopeContextFailureInput): Promise<CompileScopeContextFailure> {
  const state = ensureCompileScopeRecoveryState(ctx);
  const artifacts = await summarizeCompileArtifactsForRecovery(ctx);
  const action = chooseRecoveryAction(input, artifacts);
  const common = {
    explanation: capUtf8(input.explanation, 1500),
    ...(input.observed ? { observed: input.observed } : {}),
    ...(input.guardDiagnostics ? { guardDiagnostics: input.guardDiagnostics } : {}),
    recovery: {
      action,
      eligible: action !== 'manual-reduce-scope' && action !== 'none',
      attempted: false,
      attempt: 0,
      maxAttempts: 1,
      reason: capUtf8(recoveryReason(ctx, action, input, artifacts), MAX_REASON_BYTES),
    },
    artifacts,
  };
  const failure: CompileScopeContextFailure = input.source === 'decomposition'
    ? { ...common, source: input.source, failureKind: input.failureKind, stage: input.stage, decompositionEvidence: input.decompositionEvidence }
    : { ...common, source: input.source, failureKind: input.failureKind, stage: input.stage };
  state.lastFailure = failure;
  return failure;
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
      ...(input.failure.failureKind !== 'decomposition-exhausted' ? { terminalSubtype: 'error_context_window' } : {}),
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
  const base = {
    kind: 'compile-scope-context' as const,
    action: failure.recovery.action,
    recommended: true,
    eligible: failure.recovery.eligible,
    reason: failure.recovery.reason,
    attempted: failure.recovery.attempted,
    attempt: failure.recovery.attempt,
    maxAttempts: failure.recovery.maxAttempts,
  };
  return failure.source === 'decomposition'
    ? { ...base, source: failure.source, failureKind: failure.failureKind, decompositionEvidence: failure.decompositionEvidence }
    : { ...base, source: failure.source, failureKind: failure.failureKind };
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

function chooseRecoveryAction(input: CompileScopeContextFailureInput, artifacts: CompileArtifactSummary): CompileRecoveryAction {
  if (artifacts.orchestrationExists && artifacts.validPlanCount > 0 && artifacts.invalidPlanCount === 0 && artifacts.missingPlanFileCount === 0) return 'repair-existing-artifacts';
  if (input.failureKind === 'decomposition-exhausted' || isPlannerRuntimeContextFailure(input)) return 'bounded-decomposition';
  return 'manual-reduce-scope';
}

function isPlannerRuntimeContextFailure(input: CompileScopeContextFailureInput): boolean {
  return input.stage === 'planner' && input.source === 'live-context-guard';
}

function recoveryReason(ctx: PipelineContext, action: CompileRecoveryAction, input: CompileScopeContextFailureInput, artifacts: CompileArtifactSummary): string {
  if (action === 'repair-existing-artifacts') return `Valid compile artifacts exist (${artifacts.validPlanCount} plan file(s)); prefer continue/repair over retrying compile.`;
  const compactGuidance = plannerCompactInspectionGuidance(ctx, input, artifacts);
  if (action === 'bounded-decomposition' && input.failureKind === 'decomposition-exhausted' && input.decompositionEvidence) {
    return withCompactGuidance(`Context-managed decomposition exhausted in unit ${input.decompositionEvidence.unitId}; this is decomposition exhaustion, not a provider context rejection. Existing direct retry/apply-recovery actions do not mutate compile decomposition state. Operators can inspect bounded evidence and choose a manual reduced source or deliberate follow-up PRD outside the engine. The engine does not auto-author and does not auto-enqueue successor PRDs.`, compactGuidance);
  }
  if (action === 'bounded-decomposition') return withCompactGuidance('Planner-family context pressure exceeded the compile budget; the bounded compiler is the only planning path — inspect bounded decomposition evidence or manually reduce source before choosing deliberate follow-up work outside the engine.', compactGuidance);
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
  const created: CompileScopeRecoveryState = { sourceHash };
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
