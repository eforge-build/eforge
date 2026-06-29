import type { PlannerInspectionHandoff, PlannerInspectionOmittedCounts, PlannerInspectionSourceContext } from './planner-inspection.js';

const ELLIPSIS_BYTES = Buffer.byteLength('…', 'utf8');

type PlannerInspectionOmittedCountKey = keyof PlannerInspectionOmittedCounts;
type HandoffListCountKey = 'relevantFiles' | 'observedFacts' | 'importantFindings' | 'inferredImplementationAreas' | 'unresolvedQuestions';

interface HandoffCompactionProfile {
  relevantFiles: number;
  observedFacts: number;
  importantFindings: number;
  inferredImplementationAreas: number;
  unresolvedQuestions: number;
  caveats: number;
  textBytes: number;
  sourceContextBytes: number;
  stripGuardDiagnostics: boolean;
}

export function plannerInspectionHandoffByteLength(handoff: PlannerInspectionHandoff): number {
  return Buffer.byteLength(`${JSON.stringify(handoff, null, 2)}\n`, 'utf8');
}

export function compactPlannerInspectionHandoffToBudget(handoff: PlannerInspectionHandoff, maxByteLength?: number): PlannerInspectionHandoff {
  const requestedTarget = positiveInteger(maxByteLength);
  if (requestedTarget === undefined) return handoff;
  const target = requestedTarget;
  let current = cloneHandoff(handoff);
  if (plannerInspectionHandoffByteLength(current) <= target) return current;
  for (const profile of compactionProfiles(target)) {
    current = applyCompactionProfile(handoff, profile);
    if (plannerInspectionHandoffByteLength(current) <= target) return current;
  }
  const fitted = fitHandoffByDroppingEvidence(current, target);
  const fittedBytes = plannerInspectionHandoffByteLength(fitted);
  if (fittedBytes <= target) return fitted;
  throw new Error(`Planner inspection handoff minimum byte length ${fittedBytes} exceeds maxCompactHandoffBytes ${target}`);
}

function compactionProfiles(targetBytes: number): HandoffCompactionProfile[] {
  const small = targetBytes < 4_000;
  return [
    { relevantFiles: 24, observedFacts: 10, importantFindings: 8, inferredImplementationAreas: 10, unresolvedQuestions: 5, caveats: 4, textBytes: 800, sourceContextBytes: 1_200, stripGuardDiagnostics: false },
    { relevantFiles: 16, observedFacts: 8, importantFindings: 6, inferredImplementationAreas: 8, unresolvedQuestions: 4, caveats: 3, textBytes: 600, sourceContextBytes: 800, stripGuardDiagnostics: false },
    { relevantFiles: small ? 6 : 10, observedFacts: small ? 2 : 4, importantFindings: small ? 1 : 3, inferredImplementationAreas: small ? 3 : 6, unresolvedQuestions: small ? 1 : 3, caveats: 2, textBytes: small ? 220 : 400, sourceContextBytes: small ? 160 : 500, stripGuardDiagnostics: true },
  ];
}

function applyCompactionProfile(handoff: PlannerInspectionHandoff, profile: HandoffCompactionProfile): PlannerInspectionHandoff {
  const omittedCounts: PlannerInspectionOmittedCounts = { ...(handoff.omittedCounts ?? {}) };
  const compacted: PlannerInspectionHandoff = {
    ...handoff,
    relevantFiles: capList(handoff.relevantFiles, profile.relevantFiles, profile.textBytes, 'relevantFiles', omittedCounts),
    observedFacts: capList(handoff.observedFacts, profile.observedFacts, profile.textBytes, 'observedFacts', omittedCounts),
    importantFindings: capList(handoff.importantFindings, profile.importantFindings, profile.textBytes, 'importantFindings', omittedCounts),
    inferredImplementationAreas: capList(handoff.inferredImplementationAreas, profile.inferredImplementationAreas, profile.textBytes, 'inferredImplementationAreas', omittedCounts),
    unresolvedQuestions: capList(handoff.unresolvedQuestions, profile.unresolvedQuestions, profile.textBytes, 'unresolvedQuestions', omittedCounts),
    sourceBuildContext: compactSourceBuildContext(handoff.sourceBuildContext, profile.sourceContextBytes, omittedCounts),
    budgetDiagnostics: compactBudgetDiagnostics(handoff.budgetDiagnostics, profile.stripGuardDiagnostics),
    caveats: compactCaveats(handoff.caveats, profile.caveats, profile.textBytes, omittedCounts),
    omittedCounts,
  };
  compacted.caveats = ensureCompactionCaveat(compacted.caveats, omittedCounts, profile.textBytes);
  return compacted;
}

function capList(items: readonly string[], maxItems: number, maxBytes: number, key: HandoffListCountKey, omittedCounts: PlannerInspectionOmittedCounts): string[] {
  return capArray(items, maxItems, key, omittedCounts).map((item) => capCountedText(item, maxBytes, compactionByteKey(key), omittedCounts));
}

function compactionByteKey(key: HandoffListCountKey): PlannerInspectionOmittedCountKey {
  if (key === 'relevantFiles') return 'relevantFileBytes';
  if (key === 'importantFindings') return 'importantFindingBytes';
  if (key === 'inferredImplementationAreas') return 'inferredImplementationAreaBytes';
  return 'messageBytes';
}

function compactSourceBuildContext(context: PlannerInspectionSourceContext, maxBytes: number, omittedCounts: PlannerInspectionOmittedCounts): PlannerInspectionSourceContext {
  return {
    ...(context.sourceSummary ? { sourceSummary: capCountedText(context.sourceSummary, maxBytes, 'sourceSummaryBytes', omittedCounts) } : {}),
    ...(context.buildGoal ? { buildGoal: capCountedText(context.buildGoal, maxBytes, 'buildGoalBytes', omittedCounts) } : {}),
    ...(context.promptSourceSnippet ? { promptSourceSnippet: capCountedText(context.promptSourceSnippet, maxBytes, 'promptSourceSnippetBytes', omittedCounts) } : {}),
  };
}

function compactBudgetDiagnostics(diagnostics: PlannerInspectionHandoff['budgetDiagnostics'], stripGuardDiagnostics: boolean): PlannerInspectionHandoff['budgetDiagnostics'] {
  if (!stripGuardDiagnostics || !('guardDiagnostics' in diagnostics)) return diagnostics;
  const { guardDiagnostics: _guardDiagnostics, ...rest } = diagnostics;
  return rest;
}

function compactCaveats(items: readonly string[], maxItems: number, maxBytes: number, omittedCounts: PlannerInspectionOmittedCounts): string[] {
  return items.slice(0, maxItems).map((item) => capCountedText(item, maxBytes, 'caveatBytes', omittedCounts));
}

function ensureCompactionCaveat(caveats: readonly string[], omittedCounts: PlannerInspectionOmittedCounts, maxBytes: number): string[] {
  const note = 'Compact handoff was reduced to fit the configured maxCompactHandoffBytes budget; absence of omitted evidence is not proof of absence.';
  if (caveats.some((caveat) => caveat.includes('maxCompactHandoffBytes'))) return [...caveats];
  return [...caveats, capCountedText(note, maxBytes, 'caveatBytes', omittedCounts)];
}

function fitHandoffByDroppingEvidence(handoff: PlannerInspectionHandoff, target: number): PlannerInspectionHandoff {
  let current = cloneHandoff(handoff);
  const reductions: Array<(input: PlannerInspectionHandoff) => PlannerInspectionHandoff> = [
    (input) => dropStringArray(input, 'importantFindings', 'importantFindings', 'importantFindingBytes'),
    (input) => dropStringArray(input, 'observedFacts', 'observedFacts', 'messageBytes'),
    (input) => dropStringArray(input, 'unresolvedQuestions', 'unresolvedQuestions', 'messageBytes'),
    compactCoreEvidenceArrays,
    dropSourceBuildContext,
    (input) => keepFirstStringArray(input, 'caveats', 1, undefined, 'caveatBytes'),
    (input) => dropStringArray(input, 'relevantFiles', 'relevantFiles', 'relevantFileBytes'),
    (input) => dropStringArray(input, 'inferredImplementationAreas', 'inferredImplementationAreas', 'inferredImplementationAreaBytes'),
    (input) => dropStringArray(input, 'caveats', undefined, 'caveatBytes'),
  ];
  for (const reduce of reductions) {
    current = reduce(current);
    if (plannerInspectionHandoffByteLength(current) <= target) return current;
  }
  return current;
}

function compactCoreEvidenceArrays(handoff: PlannerInspectionHandoff): PlannerInspectionHandoff {
  const withRelevantFiles = keepFirstStringArray(handoff, 'relevantFiles', 3, 'relevantFiles', 'relevantFileBytes');
  return keepFirstStringArray(withRelevantFiles, 'inferredImplementationAreas', 3, 'inferredImplementationAreas', 'inferredImplementationAreaBytes');
}

function dropStringArray<Key extends 'relevantFiles' | 'observedFacts' | 'importantFindings' | 'inferredImplementationAreas' | 'unresolvedQuestions' | 'caveats'>(
  handoff: PlannerInspectionHandoff,
  key: Key,
  countKey: PlannerInspectionOmittedCountKey | undefined,
  byteKey: PlannerInspectionOmittedCountKey,
): PlannerInspectionHandoff {
  return keepFirstStringArray(handoff, key, 0, countKey, byteKey);
}

function keepFirstStringArray<Key extends 'relevantFiles' | 'observedFacts' | 'importantFindings' | 'inferredImplementationAreas' | 'unresolvedQuestions' | 'caveats'>(
  handoff: PlannerInspectionHandoff,
  key: Key,
  keep: number,
  countKey: PlannerInspectionOmittedCountKey | undefined,
  byteKey: PlannerInspectionOmittedCountKey,
): PlannerInspectionHandoff {
  const retained = handoff[key].slice(0, keep);
  const omitted = handoff[key].slice(keep);
  if (omitted.length === 0) return handoff;
  const omittedCounts: PlannerInspectionOmittedCounts = { ...(handoff.omittedCounts ?? {}) };
  if (countKey) omittedCounts[countKey] = (omittedCounts[countKey] ?? 0) + omitted.length;
  incrementOmitted(omittedCounts, byteKey, omitted.reduce((sum, text) => sum + Buffer.byteLength(text, 'utf8'), 0));
  return { ...handoff, [key]: retained, omittedCounts };
}

function dropSourceBuildContext(handoff: PlannerInspectionHandoff): PlannerInspectionHandoff {
  const omittedCounts: PlannerInspectionOmittedCounts = { ...(handoff.omittedCounts ?? {}) };
  incrementOmitted(omittedCounts, 'sourceSummaryBytes', byteLengthIfPresent(handoff.sourceBuildContext.sourceSummary));
  incrementOmitted(omittedCounts, 'buildGoalBytes', byteLengthIfPresent(handoff.sourceBuildContext.buildGoal));
  incrementOmitted(omittedCounts, 'promptSourceSnippetBytes', byteLengthIfPresent(handoff.sourceBuildContext.promptSourceSnippet));
  return { ...handoff, sourceBuildContext: {}, omittedCounts };
}

function byteLengthIfPresent(value: string | undefined): number {
  return value ? Buffer.byteLength(value, 'utf8') : 0;
}

function capArray<T>(items: readonly T[], max: number, key: PlannerInspectionOmittedCountKey, omittedCounts: PlannerInspectionOmittedCounts): T[] {
  const cap = Math.max(0, Math.floor(max));
  if (items.length > cap) omittedCounts[key] = (omittedCounts[key] ?? 0) + items.length - cap;
  return items.slice(0, cap);
}

function capCountedText(text: string, maxBytes: number, key: PlannerInspectionOmittedCountKey, omittedCounts: PlannerInspectionOmittedCounts): string {
  const capped = capText(text, maxBytes);
  incrementOmitted(omittedCounts, key, capped.omittedBytes);
  return capped.text;
}

function incrementOmitted(omittedCounts: PlannerInspectionOmittedCounts, key: PlannerInspectionOmittedCountKey, count: number): void {
  if (count > 0) omittedCounts[key] = (omittedCounts[key] ?? 0) + count;
}

function capText(text: string, maxBytes: number): { text: string; omittedBytes: number } {
  const bytes = Buffer.byteLength(text, 'utf8');
  if (bytes <= maxBytes) return { text, omittedBytes: 0 };
  if (maxBytes < ELLIPSIS_BYTES) return { text: '', omittedBytes: bytes };
  let end = Math.max(0, maxBytes - ELLIPSIS_BYTES);
  while (end > 0 && Buffer.byteLength(text.slice(0, end), 'utf8') > maxBytes - ELLIPSIS_BYTES) end--;
  const capped = `${text.slice(0, end)}…`;
  return { text: capped, omittedBytes: bytes - Buffer.byteLength(capped, 'utf8') };
}

function cloneHandoff(handoff: PlannerInspectionHandoff): PlannerInspectionHandoff {
  return JSON.parse(JSON.stringify(handoff)) as PlannerInspectionHandoff;
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined;
}
