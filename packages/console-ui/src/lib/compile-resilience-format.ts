import type {
  CompileRecoveryAction,
  CompileScopeContextFailure,
  EforgeEvent,
  PlannerInspectionSummary,
  RecoverySidecarRecoveryOption,
} from '@eforge-build/client/browser';
import { decompositionFailureEvidenceDetail, decompositionFailureEvidenceSummary } from './planning-decomposition-format';

export interface CompileFailureBannerModel {
  title: string;
  summary: string;
  details: string[];
}

type EventCompileScopeContextFailure = Extract<EforgeEvent, { type: 'planning:scope-context:failure' }>['failure'];
type DisplayCompileScopeContextFailure = CompileScopeContextFailure | EventCompileScopeContextFailure;
export type CompileScopeContextOption = Extract<RecoverySidecarRecoveryOption, { kind: 'compile-scope-context' }>;

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kib = bytes / 1024;
  if (kib < 1024) return `${kib.toFixed(kib >= 10 ? 0 : 1)} KiB`;
  const mib = kib / 1024;
  return `${mib.toFixed(mib >= 10 ? 1 : 2)} MiB`;
}

export function recoveryActionLabel(action: CompileRecoveryAction | CompileScopeContextOption['action']): string {
  switch (action) {
    case 'none': return 'none';
    case 'bounded-decomposition': return 'bounded decomposition';
    case 'manual-reduce-scope': return 'manual scope reduction';
    case 'repair-existing-artifacts': return 'repair existing artifacts';
  }
}

function artifactSummary(failure: DisplayCompileScopeContextFailure): string {
  const a = failure.artifacts;
  const parts = [
    `orchestration ${a.orchestrationExists ? 'present' : 'missing'}`,
    `${a.validPlanCount} valid plan(s)`,
    `${a.invalidPlanCount} invalid plan(s)`,
    `${a.missingPlanFileCount} missing plan file(s)`,
  ];
  if (a.missingPlanFiles.length > 0) parts.push(`missing: ${a.missingPlanFiles.join(', ')}`);
  if (a.invalidPlanFiles.length > 0) parts.push(`invalid: ${a.invalidPlanFiles.join(', ')}`);
  return parts.join('; ');
}

function observedSummary(failure: DisplayCompileScopeContextFailure): string | undefined {
  const observed = failure.observed;
  if (!observed) return undefined;
  const parts: string[] = [];
  if (observed.promptBytes !== undefined) parts.push(`${formatBytes(observed.promptBytes)} prompt`);
  if (observed.inputTokens !== undefined) parts.push(`${observed.inputTokens} input token(s)`);
  if (observed.outputTokens !== undefined) parts.push(`${observed.outputTokens} output token(s)`);
  if (observed.turns !== undefined) parts.push(`${observed.turns} turn(s)`);
  return parts.length > 0 ? parts.join(', ') : undefined;
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

export function plannerInspectionSummarySummary(summary: PlannerInspectionSummary): string {
  const observed = summary.budgetDiagnostics.observed;
  return `Planner compact inspection summary: ${summary.relevantFiles.length} file(s), ${summary.observedFacts.length} fact(s), ${summary.importantFindings.length} finding(s), ${observed.turns} turn(s)`;
}

export function plannerInspectionSummaryDetail(summary: PlannerInspectionSummary): string {
  const observed = summary.budgetDiagnostics.observed;
  const lines = [
    `Observed: ${observed.inputTokens} input token(s), ${observed.outputTokens} output token(s), ${observed.turns} turn(s), ${formatBytes(observed.promptBytes)} prompt`,
    `Budget: soft input ${summary.budgetDiagnostics.softInputTokenThreshold}/${summary.budgetDiagnostics.maxObservedInputTokens}; inspection turns ${summary.budgetDiagnostics.inspectionTurnBudget}/${summary.budgetDiagnostics.plannerMaxTurns}`,
    `Tools: ${summary.budgetDiagnostics.toolUseCount} use(s), ${summary.budgetDiagnostics.toolResultCount} result(s)`,
  ];
  if (summary.source.sourceName) lines.push(`Source: ${summary.source.sourceName}`);
  if (summary.relevantFiles.length > 0) lines.push(`Relevant files: ${summary.relevantFiles.join(', ')}`);
  if (summary.observedFacts.length > 0) lines.push(`Observed facts: ${summary.observedFacts.join('; ')}`);
  if (summary.importantFindings.length > 0) lines.push(`Important findings: ${summary.importantFindings.join('; ')}`);
  if (summary.inferredImplementationAreas.length > 0) lines.push(`Implementation areas: ${summary.inferredImplementationAreas.join(', ')}`);
  if (summary.unresolvedQuestions.length > 0) lines.push(`Unresolved questions: ${summary.unresolvedQuestions.join('; ')}`);
  if (summary.caveats.length > 0) lines.push(`Caveats: ${summary.caveats.join('; ')}`);
  const omitted = Object.entries(summary.omittedCounts).filter(([, count]) => count > 0);
  if (omitted.length > 0) lines.push(`Omitted: ${omitted.map(([key, count]) => `${key}=${count}`).join(', ')}`);
  return lines.join('\n');
}

export function compileScopeContextFailureSummary(failure: DisplayCompileScopeContextFailure): string {
  return `Compile scope/context failure: ${failure.failureKind} from ${failure.source} at ${failure.stage} — ${recoveryActionLabel(failure.recovery.action)}`;
}

export function compileScopeContextFailureDetail(failure: DisplayCompileScopeContextFailure): string {
  const lines = [
    `Explanation: ${failure.explanation}`,
    `Recovery: ${recoveryActionLabel(failure.recovery.action)}; eligible ${failure.recovery.eligible ? 'yes' : 'no'}; attempted ${failure.recovery.attempted ? 'yes' : 'no'}; attempt ${failure.recovery.attempt}/${failure.recovery.maxAttempts}`,
    `Recovery reason: ${failure.recovery.reason}`,
    `Artifacts: ${artifactSummary(failure)}`,
  ];
  const observed = observedSummary(failure);
  if (observed) lines.push(`Observed: ${observed}`);
  lines.push(...guardDiagnosticLines(failure));
  if (failure.decompositionEvidence) {
    lines.push(decompositionFailureEvidenceSummary(failure.decompositionEvidence));
    lines.push(decompositionFailureEvidenceDetail(failure.decompositionEvidence));
  }
  return lines.join('\n');
}

export function compileFailureBannerModel(failure: CompileScopeContextFailure): CompileFailureBannerModel {
  return {
    title: 'Compile scope/context failure',
    summary: `${failure.failureKind} from ${failure.source} at ${failure.stage}`,
    details: compileScopeContextFailureDetail(failure).split('\n'),
  };
}

export function compileScopeContextOptions(options: RecoverySidecarRecoveryOption[] | undefined): CompileScopeContextOption[] {
  return options?.filter((option): option is CompileScopeContextOption => option.kind === 'compile-scope-context') ?? [];
}
