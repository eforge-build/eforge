import type { DecompositionFailureEvidence, EforgeEvent, PlanningDecompositionEventType } from '@eforge-build/client';
import { formatBytes } from './compile-resilience-display.js';

export interface PlanningDecompositionEventModel { headline: string; details: string[] }
type DecompositionEvent = Extract<EforgeEvent, { type: PlanningDecompositionEventType }>;
const MAX = 8;
function cap(s: string, n = 240): string { return s.length <= n ? s : `${s.slice(0, n - 1)}…`; }
function join(items: readonly string[] | undefined, empty = 'none'): string { return items && items.length > 0 ? items.slice(0, MAX).map((x) => cap(x)).join(', ') + (items.length > MAX ? ` (+${items.length - MAX} more)` : '') : empty; }
function triggered(e?: { triggeredLimitKeys: string[] }): string { return e && e.triggeredLimitKeys.length > 0 ? join(e.triggeredLimitKeys) : 'none'; }
function budgetLines(evidence: DecompositionFailureEvidence): string[] { return [
  `Budget: maxPromptSourceBytes=${evidence.budgets.maxPromptSourceBytes}, maxPromptBytes=${evidence.budgets.maxPromptBytes}, maxObservedInputTokens=${evidence.budgets.maxObservedInputTokens}, maxCompactHandoffBytes=${evidence.budgets.maxCompactHandoffBytes}, maxLocalExplorationToolUses=${evidence.budgets.maxLocalExplorationToolUses}, maxCriteriaPerUnit=${evidence.budgets.maxCriteriaPerUnit}, maxSubsystemsPerUnit=${evidence.budgets.maxSubsystemsPerUnit}, maxRecursiveDepth=${evidence.budgets.maxRecursiveDepth}`,
  `Observed: promptSourceBytes=${evidence.observed.promptSourceBytes ?? 'n/a'}, promptBytes=${evidence.observed.promptBytes ?? 'n/a'}, observedInputTokens=${evidence.observed.observedInputTokens ?? 'n/a'}, observedTurns=${evidence.observed.observedTurns ?? 'n/a'}, compactHandoffBytes=${evidence.observed.compactHandoffBytes ?? 'n/a'}, localExplorationToolUses=${evidence.observed.localExplorationToolUses ?? 'n/a'}, triggeredLimitKeys=${triggered(evidence.observed)}`,
]; }
export function renderDecompositionEvidenceLines(evidence: DecompositionFailureEvidence): string[] { const lines = [
  `Decomposition exhausted in unit ${evidence.unitId}${evidence.parentUnitId ? ` (parent ${evidence.parentUnitId})` : ''}`,
  `Depth: ${evidence.depth}`,
  `Triggered limits: ${triggered(evidence.observed)}`,
  ...budgetLines(evidence),
  `Assigned criteria: ${evidence.assignedCriteriaIds.length}${evidence.assignedCriteriaIds.length ? ` (${join(evidence.assignedCriteriaIds)})` : ''}`,
  `Unresolved criteria: ${evidence.unresolvedCriteria.length}`,
];
for (const item of evidence.unresolvedCriteria.slice(0, MAX)) lines.push(`  - ${cap(item.criterionId)}: ${cap(item.reason)}${item.evidence ? ` — ${cap(item.evidence)}` : ''}`);
if (evidence.blockers.length) lines.push(`Blockers: ${join(evidence.blockers)}`);
if (evidence.splitAttempts.length) lines.push(`Split attempts: ${evidence.splitAttempts.map((a) => `${a.attempt}:${join(a.resultingUnitIds)}`).join('; ')}`);
return lines; }
function coverage(unit: { coverage: { coveredCriteria: unknown[]; totalCriteria?: number } }): string { return `${unit.coverage.coveredCriteria.length}${unit.coverage.totalCriteria !== undefined ? `/${unit.coverage.totalCriteria}` : ''}`; }
export function renderPlanningDecompositionEventModel(event: DecompositionEvent): PlanningDecompositionEventModel {
  switch (event.type) {
    case 'planning:decomposition:start': { const criteria = event.riskEvidence ? `, ${event.riskEvidence.acceptanceCriteriaCount} criteria` : ''; return { headline: `Context-managed planning: ${event.unitCount} unit(s), ${event.edgeCount} edge(s), parallelism ${event.limits.parallelism}${criteria}`, details: [`Graph: ${event.graphId}; root=${event.rootUnitId}`, `Limits: parallelism=${event.limits.parallelism}, maxDepth=${event.limits.maxDepth}, maxObservedInputTokens=${event.limits.maxObservedInputTokens}`, ...(event.riskEvidence ? [`Risk: ${event.riskEvidence.level}; sourceBytes=${event.riskEvidence.sourceBytes}; promptSourceBytes=${event.riskEvidence.promptSourceBytes}; subsystems=${join(event.riskEvidence.subsystemSummaries)}`] : [])] }; }
    case 'planning:decomposition:unit:queued': return { headline: `Planning unit queued: ${event.unit.unitId}${event.unit.subsystemHints.length ? ` (${join(event.unit.subsystemHints)})` : ''}`, details: [`Depth: ${event.unit.depth}`, `Dependencies: ${join(event.unit.dependencies)}`, `Criteria: ${event.unit.coverage.totalCriteria ?? event.unit.coverage.coveredCriteria.length}`] };
    case 'planning:decomposition:unit:running': return { headline: `Planning unit running: ${event.unitId}`, details: [] };
    case 'planning:decomposition:unit:progress': return { headline: `Planning unit ${event.unitId}: ${cap(event.message)}`, details: event.observed ? [`Observed: triggeredLimitKeys=${triggered(event.observed)}, observedInputTokens=${event.observed.observedInputTokens ?? 'n/a'}, promptBytes=${event.observed.promptBytes ?? 'n/a'}`] : [] };
    case 'planning:decomposition:unit:completed': return { headline: `Planning unit completed: ${event.unit.unitId} (${event.unit.coverage.coveredCriteria.length} criteria)`, details: [`Coverage: ${coverage(event.unit)} criteria`, `Unresolved criteria: ${event.unit.coverage.unresolvedCriteria.length}`, `Artifacts source slices: ${event.unit.sourceSlices.length}`] };
    case 'planning:decomposition:unit:skipped': return { headline: `Planning unit skipped: ${event.unitId} — ${cap(event.reason)}`, details: event.unit ? [`Depth: ${event.unit.depth}`, `Dependencies: ${join(event.unit.dependencies)}`] : [] };
    case 'planning:decomposition:unit:failed': return { headline: `Planning unit failed: ${event.unitId} — ${event.reason || triggered(event.evidence.observed)}`, details: renderDecompositionEvidenceLines(event.evidence) };
    case 'planning:decomposition:schedule': return { headline: `Planning schedule: running [${join(event.decision.runningUnitIds, '')}]; waiting ${event.decision.waitingUnitIds.length}; selected [${join(event.decision.selectedBatchUnitIds, '')}]`, details: [`ready: ${join(event.decision.readyUnitIds)}`, `running: ${join(event.decision.runningUnitIds)}`, `waiting: ${join(event.decision.waitingUnitIds)}`, `selectedBatch: ${join(event.decision.selectedBatchUnitIds)}`, ...event.decision.waitingReasons.slice(0, MAX).map((r) => `waitingReason:${r.unitId}: ${join(r.reasons)}`), ...event.decision.blockedPairs.slice(0, MAX).map((p) => `dependency:${p.blockedByUnitId} blocks ${p.unitId}${p.reason ? ` (${p.reason})` : ''}`)] };
    case 'planning:decomposition:budget': return { headline: `Planning budget: ${event.unitId} ${event.observed?.triggeredLimitKeys.length ? `triggered ${triggered(event.observed)}` : 'within limits'}`, details: [`Limits: parallelism=${event.limits.parallelism}, maxObservedInputTokens=${event.limits.maxObservedInputTokens}`, ...(event.observed ? [`Observed: triggeredLimitKeys=${triggered(event.observed)}, observedInputTokens=${event.observed.observedInputTokens ?? 'n/a'}, localExplorationToolUses=${event.observed.localExplorationToolUses ?? 'n/a'}`] : []), ...event.unitBudgets.slice(0, MAX).map((b) => `Unit budget ${b.unitId}: maxPromptBytes=${b.budget.maxPromptBytes}, maxObservedInputTokens=${b.budget.maxObservedInputTokens}`)] };
    case 'planning:decomposition:compact-handoff': return { headline: `Planning unit handoff: ${event.unitId ?? 'unknown'} → ${event.artifactPath ?? 'artifact'} (${event.byteLength} B)`, details: [`Artifact: ${event.artifactPath ?? 'n/a'}`, `Bytes: ${formatBytes(event.byteLength)}`, `Hash: ${event.contentHash.slice(0, 12)}`, `Omitted units: ${join(event.omittedUnitIds)}`] };
    case 'planning:decomposition:synthesis:complete': return { headline: `Context-managed synthesis complete: ${event.artifactPaths.length} artifact(s), ${event.completedUnitCount}/${event.failedUnitCount}/${event.skippedUnitCount} units`, details: [`Units: ${event.unitCount}`, `Covered criteria: ${event.coverage.coveredCriteria.length}`, `Unresolved criteria: ${event.coverage.unresolvedCriteria.length}`, `Artifacts: ${join(event.artifactPaths)}`] };
  }
}
