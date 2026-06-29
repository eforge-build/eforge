import type { DecompositionFailureEvidence, EforgeEvent, PlanningDecompositionEventType } from '@eforge-build/client/browser';
import { formatBytes } from './compile-resilience-format';

type DecompositionEvent = Extract<EforgeEvent, { type: PlanningDecompositionEventType }>;
const MAX = 8;
function cap(s: string, n = 240): string { return s.length <= n ? s : `${s.slice(0, n - 1)}…`; }
function join(items: readonly string[] | undefined, empty = 'none'): string { return items && items.length > 0 ? items.slice(0, MAX).map((x) => cap(x)).join(', ') + (items.length > MAX ? ` (+${items.length - MAX} more)` : '') : empty; }
function trig(e?: { triggeredLimitKeys: string[] }): string { return e && e.triggeredLimitKeys.length > 0 ? join(e.triggeredLimitKeys) : 'none'; }

export function decompositionFailureEvidenceSummary(evidence: DecompositionFailureEvidence): string { return `Decomposition exhausted: ${evidence.unitId}; depth ${evidence.depth}; triggered limits: ${trig(evidence.observed)}; unresolved criteria ${evidence.unresolvedCriteria.length}`; }
export function decompositionFailureEvidenceDetail(evidence: DecompositionFailureEvidence): string { const lines = [
  `Failed Unit: ${evidence.unitId}`,
  ...(evidence.parentUnitId ? [`Parent Unit: ${evidence.parentUnitId}`] : []),
  `Depth: ${evidence.depth}`,
  `Triggered limits: ${trig(evidence.observed)}`,
  `Budget: maxPromptSourceBytes=${evidence.budgets.maxPromptSourceBytes}, maxPromptBytes=${evidence.budgets.maxPromptBytes}, maxObservedInputTokens=${evidence.budgets.maxObservedInputTokens}, maxCompactHandoffBytes=${evidence.budgets.maxCompactHandoffBytes}, maxLocalExplorationToolUses=${evidence.budgets.maxLocalExplorationToolUses}, maxCriteriaPerUnit=${evidence.budgets.maxCriteriaPerUnit}, maxSubsystemsPerUnit=${evidence.budgets.maxSubsystemsPerUnit}, maxRecursiveDepth=${evidence.budgets.maxRecursiveDepth}`,
  `Observed pressure: promptSourceBytes=${evidence.observed.promptSourceBytes ?? 'n/a'}, promptBytes=${evidence.observed.promptBytes ?? 'n/a'}, observedInputTokens=${evidence.observed.observedInputTokens ?? 'n/a'}, observedTurns=${evidence.observed.observedTurns ?? 'n/a'}, compactHandoffBytes=${evidence.observed.compactHandoffBytes ?? 'n/a'}, localExplorationToolUses=${evidence.observed.localExplorationToolUses ?? 'n/a'}`,
  `Assigned criteria: ${evidence.assignedCriteriaIds.length}${evidence.assignedCriteriaIds.length ? ` (${join(evidence.assignedCriteriaIds)})` : ''}`,
  `Unresolved criteria: ${evidence.unresolvedCriteria.length}`,
];
for (const item of evidence.unresolvedCriteria.slice(0, MAX)) lines.push(`  - ${cap(item.criterionId)}: ${cap(item.reason)}${item.evidence ? ` — ${cap(item.evidence)}` : ''}`);
if (evidence.blockers.length) lines.push(`Blockers: ${join(evidence.blockers)}`);
if (evidence.splitAttempts.length) lines.push(`Split attempts: ${evidence.splitAttempts.map((a) => `${a.attempt}:${join(a.resultingUnitIds)}`).join('; ')}`);
return lines.join('\n'); }

export function planningDecompositionEventSummary(event: DecompositionEvent): string {
  switch (event.type) {
    case 'planning:decomposition:start': return `Context-managed planning: ${event.unitCount} unit(s), ${event.edgeCount} edge(s), parallelism ${event.limits.parallelism}${event.riskEvidence ? `, ${event.riskEvidence.acceptanceCriteriaCount} criteria` : ''}`;
    case 'planning:decomposition:unit:queued': return `Planning unit queued: ${event.unit.unitId}${event.unit.subsystemHints.length ? ` (${join(event.unit.subsystemHints)})` : ''}`;
    case 'planning:decomposition:unit:running': return `Planning unit running: ${event.unitId}`;
    case 'planning:decomposition:unit:progress': return `Planning unit ${event.unitId}: ${cap(event.message)}`;
    case 'planning:decomposition:unit:completed': return `Planning unit completed: ${event.unit.unitId} (${event.unit.coverage.coveredCriteria.length} criteria)`;
    case 'planning:decomposition:unit:skipped': return `Planning unit skipped: ${event.unitId} — ${cap(event.reason)}`;
    case 'planning:decomposition:unit:failed': return `Planning unit failed: ${event.unitId} — ${event.reason || trig(event.evidence.observed)}`;
    case 'planning:decomposition:schedule': return `Planning schedule: running [${join(event.decision.runningUnitIds, '')}]; waiting ${event.decision.waitingUnitIds.length}; selected [${join(event.decision.selectedBatchUnitIds, '')}]`;
    case 'planning:decomposition:budget': return `Planning budget: ${event.unitId} ${event.observed?.triggeredLimitKeys.length ? `triggered ${trig(event.observed)}` : 'within limits'}`;
    case 'planning:decomposition:compact-handoff': return `Planning unit handoff: ${event.unitId ?? 'unknown'} → ${event.artifactPath ?? 'artifact'} (${event.byteLength} B)`;
    case 'planning:decomposition:synthesis:complete': return `Context-managed synthesis complete: ${event.artifactPaths.length} artifact(s), ${event.completedUnitCount}/${event.failedUnitCount}/${event.skippedUnitCount} units`;
  }
}

export function planningDecompositionEventDetail(event: DecompositionEvent): string {
  switch (event.type) {
    case 'planning:decomposition:start': return [`Limits: parallelism=${event.limits.parallelism}, maxDepth=${event.limits.maxDepth}, maxObservedInputTokens=${event.limits.maxObservedInputTokens}`, ...(event.riskEvidence ? [`Risk: ${event.riskEvidence.level}; sourceBytes=${event.riskEvidence.sourceBytes}; promptSourceBytes=${event.riskEvidence.promptSourceBytes}; subsystems=${join(event.riskEvidence.subsystemSummaries)}`] : [])].join('\n');
    case 'planning:decomposition:unit:queued': return [`Depth: ${event.unit.depth}`, `Dependencies: ${join(event.unit.dependencies)}`, `Criteria: ${event.unit.coverage.totalCriteria ?? event.unit.coverage.coveredCriteria.length}`, `Source slices: ${event.unit.sourceSlices.map((s) => `${s.kind}:${s.path ?? s.sourceHash.slice(0, 8)} (${s.byteLength} B)`).join(', ')}`].join('\n');
    case 'planning:decomposition:unit:running': return `Unit: ${event.unitId}`;
    case 'planning:decomposition:unit:progress': return event.observed ? `Observed: triggeredLimitKeys=${trig(event.observed)}, observedInputTokens=${event.observed.observedInputTokens ?? 'n/a'}, promptBytes=${event.observed.promptBytes ?? 'n/a'}` : '';
    case 'planning:decomposition:unit:completed': return [`Coverage: ${event.unit.coverage.coveredCriteria.length}/${event.unit.coverage.totalCriteria ?? event.unit.coverage.coveredCriteria.length}`, `Unresolved criteria: ${event.unit.coverage.unresolvedCriteria.length}`].join('\n');
    case 'planning:decomposition:unit:skipped': return event.unit ? `Depth: ${event.unit.depth}\nDependencies: ${join(event.unit.dependencies)}` : `Reason: ${event.reason}`;
    case 'planning:decomposition:unit:failed': return decompositionFailureEvidenceDetail(event.evidence);
    case 'planning:decomposition:schedule': return [`Active concurrent units: ${event.decision.runningUnitIds.length}/${event.decision.parallelism}`, `ready: ${join(event.decision.readyUnitIds)}`, `running: ${join(event.decision.runningUnitIds)}`, `waiting: ${join(event.decision.waitingUnitIds)}`, `selectedBatch: ${join(event.decision.selectedBatchUnitIds)}`, ...event.decision.waitingReasons.map((r) => `waitingReason:${r.unitId}: ${join(r.reasons)}`), ...event.decision.blockedPairs.map((p) => `blockedPair: ${p.unitId} blocked by ${p.blockedByUnitId}${p.reason ? ` (${p.reason})` : ''}`)].join('\n');
    case 'planning:decomposition:budget': return [`Limits: parallelism=${event.limits.parallelism}, maxObservedInputTokens=${event.limits.maxObservedInputTokens}`, ...(event.observed ? [`Observed: triggeredLimitKeys=${trig(event.observed)}, observedInputTokens=${event.observed.observedInputTokens ?? 'n/a'}, localExplorationToolUses=${event.observed.localExplorationToolUses ?? 'n/a'}`] : []), ...event.unitBudgets.map((b) => `Unit budget ${b.unitId}: maxPromptBytes=${b.budget.maxPromptBytes}, maxObservedInputTokens=${b.budget.maxObservedInputTokens}`)].join('\n');
    case 'planning:decomposition:compact-handoff': return [`Artifact: ${event.artifactPath ?? 'n/a'}`, `Bytes: ${formatBytes(event.byteLength)}`, `Hash: ${event.contentHash.slice(0, 12)}`, `Omitted units: ${join(event.omittedUnitIds)}`].join('\n');
    case 'planning:decomposition:synthesis:complete': return [`Units: ${event.unitCount}`, `Covered criteria: ${event.coverage.coveredCriteria.length}`, `Unresolved criteria: ${event.coverage.unresolvedCriteria.length}`, `Artifacts: ${join(event.artifactPaths)}`].join('\n');
  }
}
