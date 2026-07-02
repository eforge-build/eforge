import type { DecompositionFailureEvidence } from '@eforge-build/client';

const MAX_ITEMS = 8;
const MAX_TEXT = 240;

function cap(value: string, max = MAX_TEXT): string { return value.length <= max ? value : `${value.slice(0, max - 1)}…`; }
function list(items: readonly string[] | undefined, empty = 'none'): string { return items && items.length > 0 ? items.slice(0, MAX_ITEMS).map((item) => cap(item)).join(', ') + (items.length > MAX_ITEMS ? ` (+${items.length - MAX_ITEMS} more)` : '') : empty; }
function kv(parts: Array<[string, number | undefined]>): string { return parts.filter(([, v]) => v !== undefined).map(([k, v]) => `${k}=${v}`).join(', '); }

export function decompositionEvidenceSummary(evidence: DecompositionFailureEvidence): string {
  return `Decomposition exhausted: ${evidence.unitId}; depth ${evidence.depth}; triggered limits: ${list(evidence.observed.triggeredLimitKeys)}; unresolved ${evidence.unresolvedCriteria.length}`;
}

export function renderDecompositionEvidenceMarkdownLines(evidence: DecompositionFailureEvidence): string[] {
  const lines = [
    `- Failed Unit: ${cap(evidence.unitId)}`,
    ...(evidence.parentUnitId ? [`- Parent Unit: ${cap(evidence.parentUnitId)}`] : []),
    `- Depth: ${evidence.depth}`,
    `- Triggered limits: ${list(evidence.observed.triggeredLimitKeys)}`,
    `- Budget: ${kv([
      ['maxPromptSourceBytes', evidence.budgets.maxPromptSourceBytes],
      ['maxPromptBytes', evidence.budgets.maxPromptBytes],
      ['maxObservedInputTokens', evidence.budgets.maxObservedInputTokens],
      ['maxCompactHandoffBytes', evidence.budgets.maxCompactHandoffBytes],
      ['maxLocalExplorationToolUses', evidence.budgets.maxLocalExplorationToolUses],
      ['maxCriteriaPerUnit', evidence.budgets.maxCriteriaPerUnit],
      ['maxSubsystemsPerUnit', evidence.budgets.maxSubsystemsPerUnit],
      ['maxRecursiveDepth', evidence.budgets.maxRecursiveDepth],
    ])}`,
    `- Observed pressure: ${kv([
      ['promptSourceBytes', evidence.observed.promptSourceBytes],
      ['promptBytes', evidence.observed.promptBytes],
      ['observedInputTokens', evidence.observed.observedInputTokens],
      ['observedTurns', evidence.observed.observedTurns],
      ['compactHandoffBytes', evidence.observed.compactHandoffBytes],
      ['localExplorationToolUses', evidence.observed.localExplorationToolUses],
      ['criteriaCount', evidence.observed.criteriaCount],
      ['subsystemCount', evidence.observed.subsystemCount],
      ['splitAttempts', evidence.observed.splitAttempts],
    ]) || 'none'}`,
    `- Assigned criteria: ${evidence.assignedCriteriaIds.length}${evidence.assignedCriteriaIds.length > 0 ? ` (${list(evidence.assignedCriteriaIds)})` : ''}`,
    `- Unresolved criteria: ${evidence.unresolvedCriteria.length}`,
  ];
  for (const item of evidence.unresolvedCriteria.slice(0, MAX_ITEMS)) lines.push(`  - ${cap(item.criterionId)}: ${cap(item.reason)}${item.evidence ? ` — ${cap(item.evidence)}` : ''}`);
  if (evidence.unresolvedCriteria.length > MAX_ITEMS) lines.push(`  - [omitted ${evidence.unresolvedCriteria.length - MAX_ITEMS} unresolved criteria]`);
  lines.push(`- Blockers: ${evidence.blockers.length}`);
  for (const blocker of evidence.blockers.slice(0, MAX_ITEMS)) lines.push(`  - ${cap(blocker)}`);
  if (evidence.blockers.length > MAX_ITEMS) lines.push(`  - [omitted ${evidence.blockers.length - MAX_ITEMS} blocker(s)]`);
  lines.push(`- Split attempts: ${evidence.splitAttempts.length}`);
  for (const attempt of evidence.splitAttempts.slice(0, MAX_ITEMS)) lines.push(`  - attempt ${attempt.attempt}${attempt.unitId ? ` (${cap(attempt.unitId)})` : ''}: ${cap(attempt.reason)} → ${list(attempt.resultingUnitIds)}`);
  return lines;
}
