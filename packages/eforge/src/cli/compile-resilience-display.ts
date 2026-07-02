import type { CompileRecoveryAction, CompileScopeContextFailure, EforgeEvent, PlannerInspectionSummary } from '@eforge-build/client';
import { renderDecompositionEvidenceLines } from './planning-decomposition-display.js';

type EventCompileScopeContextFailure = Extract<EforgeEvent, { type: 'planning:scope-context:failure' }>['failure'];
type DisplayCompileScopeContextFailure = CompileScopeContextFailure | EventCompileScopeContextFailure;

export interface CompileScopeContextFailureRenderModel {
  attempted: boolean;
  headline: string;
  details: string[];
}

export interface PlannerInspectionSummaryRenderModel {
  headline: string;
  details: string[];
}

export function plannerContinuationReasonLabel(reason: Extract<EforgeEvent, { type: 'planning:continuation' }>['reason']): string {
  switch (reason) {
    case 'max_turns': return 'max turns';
    case 'dropped_submission': return 'dropped submission';
    case 'compact_inspection': return 'compact inspection synthesis';
    case undefined: return 'continuation';
  }
}

export function recoveryActionLabel(action: CompileRecoveryAction): string {
  switch (action) {
    case 'none': return 'none';
    case 'bounded-decomposition': return 'bounded decomposition';
    case 'manual-reduce-scope': return 'manual scope reduction';
    case 'repair-existing-artifacts': return 'repair existing artifacts';
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kib = bytes / 1024;
  if (kib < 1024) return `${kib.toFixed(kib >= 10 ? 0 : 1)} KiB`;
  const mib = kib / 1024;
  return `${mib.toFixed(mib >= 10 ? 1 : 2)} MiB`;
}

function artifactSummary(failure: DisplayCompileScopeContextFailure): string {
  const a = failure.artifacts;
  return `${a.validPlanCount} valid plan(s), ${a.invalidPlanCount} invalid plan(s), ${a.missingPlanFileCount} missing plan file(s), orchestration ${a.orchestrationExists ? 'present' : 'missing'}`;
}

function observedSummary(failure: DisplayCompileScopeContextFailure): string | undefined {
  const observed = failure.observed;
  if (!observed) return undefined;
  const parts: string[] = [];
  if (observed.promptBytes !== undefined) parts.push(`${formatBytes(observed.promptBytes)} prompt`);
  if (observed.inputTokens !== undefined) parts.push(`${observed.inputTokens} input tokens`);
  if (observed.outputTokens !== undefined) parts.push(`${observed.outputTokens} output tokens`);
  if (observed.turns !== undefined) parts.push(`${observed.turns} turns`);
  return parts.length > 0 ? parts.join(', ') : undefined;
}

export function renderPlannerInspectionSummaryModel(summary: PlannerInspectionSummary): PlannerInspectionSummaryRenderModel {
  const observed = summary.budgetDiagnostics.observed;
  const headline = `Planner compact inspection summary: ${summary.relevantFiles.length} file(s), ${summary.observedFacts.length} fact(s), ${summary.importantFindings.length} finding(s)`;
  const details = [
    `Observed: ${observed.inputTokens} input tokens, ${observed.outputTokens} output tokens, ${observed.turns} turns, ${formatBytes(observed.promptBytes)} prompt`,
    `Budget: soft input ${summary.budgetDiagnostics.softInputTokenThreshold}/${summary.budgetDiagnostics.maxObservedInputTokens}; inspection turns ${summary.budgetDiagnostics.inspectionTurnBudget}/${summary.budgetDiagnostics.plannerMaxTurns}`,
    `Tools: ${summary.budgetDiagnostics.toolUseCount} use(s), ${summary.budgetDiagnostics.toolResultCount} result(s)`,
  ];
  if (summary.relevantFiles.length > 0) details.push(`Relevant files: ${summary.relevantFiles.join(', ')}`);
  if (summary.importantFindings.length > 0) details.push(`Findings: ${summary.importantFindings.join('; ')}`);
  if (summary.unresolvedQuestions.length > 0) details.push(`Unresolved: ${summary.unresolvedQuestions.join('; ')}`);
  if (summary.caveats.length > 0) details.push(`Caveats: ${summary.caveats.join('; ')}`);
  return { headline, details };
}

function guardDiagnosticLines(failure: DisplayCompileScopeContextFailure): string[] {
  const guard = failure.guardDiagnostics;
  if (!guard) return [];
  const lines: string[] = [];
  if (guard.provider && guard.modelId) lines.push(`Model: ${guard.provider}/${guard.modelId}`);
  const limitParts = [
    `maxObservedInputTokens=${guard.limits.maxObservedInputTokens}`,
    `metadataSource=${guard.metadataSource}`,
  ];
  if (guard.contextWindow !== undefined) limitParts.push(`contextWindow=${guard.contextWindow}`);
  limitParts.push(`outputReserveTokens=${guard.outputReserveTokens}`);
  limitParts.push(`overheadReserveTokens=${guard.overheadReserveTokens}`);
  limitParts.push(`safetyMargin=${guard.safetyMargin}`);
  lines.push(`Guard: ${limitParts.join(', ')}`);
  if (guard.fallbackReason) lines.push(`Fallback: ${guard.fallbackReason}`);
  return lines;
}

export function renderCompileScopeContextFailureModel(failure: DisplayCompileScopeContextFailure): CompileScopeContextFailureRenderModel {
  const action = recoveryActionLabel(failure.recovery.action);
  const attempted = failure.recovery.attempted === true;
  const headline = attempted
    ? `Compile context guard: ${action} (${failure.failureKind} from ${failure.source} at ${failure.stage})`
    : `Compile scope/context failure: ${failure.failureKind} from ${failure.source} at ${failure.stage} — ${action}`;
  const details = [
    `Failure: ${failure.failureKind} from ${failure.source} at ${failure.stage}`,
    `Recovery: ${action}; eligible ${failure.recovery.eligible ? 'yes' : 'no'}; attempted ${failure.recovery.attempted ? 'yes' : 'no'}; attempt ${failure.recovery.attempt}/${failure.recovery.maxAttempts}`,
    `Artifacts: ${artifactSummary(failure)}`,
  ];
  const observed = observedSummary(failure);
  if (observed) details.push(`Observed: ${observed}`);
  details.push(...guardDiagnosticLines(failure));
  if (failure.explanation) details.push(`Explanation: ${failure.explanation}`);
  if (failure.recovery.reason) details.push(`Reason: ${failure.recovery.reason}`);
  if (failure.decompositionEvidence) {
    details.push('Decomposition evidence:');
    details.push(...renderDecompositionEvidenceLines(failure.decompositionEvidence));
  }
  return { attempted, headline, details };
}
