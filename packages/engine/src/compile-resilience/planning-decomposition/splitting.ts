import { PLANNING_DECOMPOSITION_MAX_UNRESOLVED_CRITERIA, type PlanningDecompositionLimits, type PlanningObservedBudgetPressure, type PlanningSplitAttemptEvidence } from '@eforge-build/client';
import { evaluatePlanningUnitBudgetPressure, type DecompositionPlanningError, type SplitOverBudgetPlanningUnitInput, type PlanningDecompositionGraph, type PlanningDecompositionUnit, type PlanningUnresolvedCriterion } from '../planning-decomposition.js';
import { buildEdges, deriveBudget, recomputeCoverage } from './graph-builders.js';
import { inferSubsystemHints, stableSlug } from '../../planner-compiler/source-analysis.js';

export function splitUnit(input: SplitOverBudgetPlanningUnitInput): { graph: PlanningDecompositionGraph; childUnitIds: string[] } | DecompositionPlanningError {
  const limits = input.limits ?? input.graph.limits;
  const blockers = exhaustionBlockers(input.graph, input.unit, input.observedPressure, limits);
  if (blockers.length > 0) return exhausted(input, blockers);
  const groups = splitGroups(input, limits);
  if (groups.length < 2) return exhausted(input, ['no-smaller-child-graph']);
  const children = groups.map((group, index) => childUnit(input.unit, group, index + 1, limits));
  if (!children.every((child, index) => hasProgress(input.unit, child, input.observedPressure, groups[index]?.pressureRatio))) return exhausted(input, ['split-does-not-reduce-triggered-pressure']);
  const childIds = children.map((c) => c.unitId);
  const parentSkipped = { ...input.unit, status: 'skipped' as const };
  const replaced = input.graph.units.map((unit) => {
    if (unit.unitId === input.unit.unitId) return parentSkipped;
    if (!unit.dependsOn.includes(input.unit.unitId)) return unit;
    return { ...unit, dependsOn: [...new Set(unit.dependsOn.flatMap((dep) => dep === input.unit.unitId ? childIds : [dep]))].sort() };
  });
  const units = [...replaced, ...children].sort((a, b) => a.unitId.localeCompare(b.unitId));
  const attemptNumber = splitAttemptsForUnit(input.graph, input.unit.unitId) + 1;
  const attempt: PlanningSplitAttemptEvidence = { unitId: input.unit.unitId, attempt: attemptNumber, reason: 'over-budget-recursive-split', resultingUnitIds: childIds, observed: input.observedPressure };
  const graph: PlanningDecompositionGraph = { ...input.graph, units, edges: buildEdges(units), coverage: recomputeCoverage(units, input.graph.sourceHash, input.graph.coverage), splitAttempts: [...input.graph.splitAttempts, attempt] };
  return { graph, childUnitIds: childIds };
}

function exhaustionBlockers(graph: PlanningDecompositionGraph, unit: PlanningDecompositionUnit, _observed: PlanningObservedBudgetPressure, limits: PlanningDecompositionLimits): string[] {
  const blockers: string[] = [];
  const current = graph.units.find((candidate) => candidate.unitId === unit.unitId);
  const priorAttempts = splitAttemptsForUnit(graph, unit.unitId);
  if (!current) blockers.push('unit-not-in-graph');
  if (current && current.status !== 'queued' && current.status !== 'running') blockers.push(`unit-not-active:${current.status}`);
  if (priorAttempts > 0) blockers.push('unit-already-split');
  if (unit.depth >= limits.maxDepth || unit.budgets.maxRecursiveDepth <= 0) blockers.push('max-depth-reached');
  if (priorAttempts >= limits.maxSplitAttemptsPerUnit) blockers.push('max-split-attempts-reached');
  return blockers;
}

interface SplitGroup { criteriaIds: string[]; subsystemHints: string[]; sourceSlices: PlanningDecompositionUnit['sourceSlices']; interfaceConstraints?: string[]; sharedFileConstraints?: string[]; titleSuffix?: string; pressureRatio?: number }

function splitGroups(input: SplitOverBudgetPlanningUnitInput, limits: PlanningDecompositionLimits): SplitGroup[] {
  const unit = input.unit;
  const strategies: Array<() => SplitGroup[]> = [
    () => unit.criteriaIds.length > 1 ? chunk(unit.criteriaIds, Math.max(1, limits.maxCriteriaPerUnit)).map((criteriaIds) => groupForCriteria(unit, criteriaIds)) : [],
    () => unit.subsystemHints.length > 1 ? unit.subsystemHints.map((hint) => ({ criteriaIds: unit.criteriaIds, subsystemHints: [hint], sourceSlices: unit.sourceSlices })) : [],
    () => unit.sourceSlices.length > 1 ? unit.sourceSlices.map((slice) => ({ criteriaIds: slice.criteriaIds, subsystemHints: unit.subsystemHints, sourceSlices: [{ ...slice }] })).filter((group) => group.criteriaIds.length > 0) : [],
    () => evidenceSplitGroups(input, limits),
    () => splitOversizedSourceSlice(unit, limits),
  ];
  for (const strategy of strategies) {
    const groups = strategy();
    if (groups.length >= 2) return groups;
  }
  return [];
}

function groupForCriteria(unit: PlanningDecompositionUnit, criteriaIds: string[]): SplitGroup {
  const criteria = new Set(criteriaIds);
  const sourceSlices = unit.sourceSlices.filter((slice) => slice.criteriaIds.some((id) => criteria.has(id))).map((slice) => ({ ...slice, criteriaIds: slice.criteriaIds.filter((id) => criteria.has(id)) }));
  return { criteriaIds, subsystemHints: unit.subsystemHints, sourceSlices };
}

function splitOversizedSourceSlice(unit: PlanningDecompositionUnit, limits: PlanningDecompositionLimits): SplitGroup[] {
  if (unit.sourceSlices.length !== 1 || unit.sourceSlices[0].byteLength <= limits.maxPromptSourceBytes) return [];
  const slice = unit.sourceSlices[0];
  if (typeof slice.byteStart !== 'number' || typeof slice.byteEnd !== 'number' || slice.byteEnd <= slice.byteStart) return [];
  const firstBytes = Math.ceil(slice.byteLength / 2);
  const splitAt = Math.min(slice.byteEnd, slice.byteStart + firstBytes);
  const ranges = [[slice.byteStart, splitAt], [splitAt, slice.byteEnd]] as const;
  return ranges
    .filter(([byteStart, byteEnd]) => byteEnd > byteStart)
    .map(([byteStart, byteEnd]) => ({ criteriaIds: slice.criteriaIds, subsystemHints: unit.subsystemHints, sourceSlices: [{ ...slice, byteStart, byteEnd, byteLength: byteEnd - byteStart }] }));
}

function evidenceSplitGroups(input: SplitOverBudgetPlanningUnitInput, limits: PlanningDecompositionLimits): SplitGroup[] {
  if (!shouldSplitByEvidence(input)) return [];
  const groups = evidencePaths(input).map((path) => evidenceGroup(input.unit, path));
  const unique = uniqueGroups(groups).slice(0, Math.max(2, Math.min(6, limits.maxCriteriaPerUnit)));
  if (unique.length < 2) return [];
  const ratio = 1 / unique.length;
  return unique.map((group) => ({ ...group, pressureRatio: ratio }));
}

function shouldSplitByEvidence(input: SplitOverBudgetPlanningUnitInput): boolean {
  return input.unit.criteriaIds.length <= 1 && input.observedPressure.triggeredLimitKeys.some((key) => key === 'maxCompactHandoffBytes' || key === 'maxLocalExplorationToolUses' || key === 'maxObservedInputTokens');
}

function evidencePaths(input: SplitOverBudgetPlanningUnitInput): string[] {
  const candidates = [
    ...(input.failedOutput?.discoveredFiles ?? []),
    ...input.unit.sharedFileConstraints,
    ...input.unit.interfaceConstraints,
  ];
  return candidates.map(normalizeEvidencePath).filter((path): path is string => Boolean(path));
}

function evidenceGroup(unit: PlanningDecompositionUnit, path: string): SplitGroup {
  const hints = inferSubsystemHints(path).filter((hint) => hint !== 'general');
  const subsystemHints = hints.length > 0 ? hints : unit.subsystemHints;
  return {
    criteriaIds: unit.criteriaIds,
    subsystemHints,
    sourceSlices: unit.sourceSlices.map((slice) => ({ ...slice })),
    interfaceConstraints: unit.interfaceConstraints.filter((constraint) => constraint === path || path.includes(stableSlug(constraint))).slice(0, 1),
    sharedFileConstraints: [path],
    titleSuffix: stableSlug(path).slice(0, 36),
  };
}

function uniqueGroups(groups: SplitGroup[]): SplitGroup[] {
  const seen = new Set<string>();
  const unique: SplitGroup[] = [];
  for (const group of groups) {
    const key = group.sharedFileConstraints?.[0] ?? group.titleSuffix ?? group.subsystemHints.join(',');
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(group);
  }
  return unique;
}

function normalizeEvidencePath(value: string): string | undefined {
  const cleaned = value.trim().replace(/^['"`]+|['"`),:;]+$/g, '');
  if (!cleaned || cleaned.includes('[omitted ')) return undefined;
  if (/^(?:read|find|grep|ls|bash) called$/i.test(cleaned)) return undefined;
  if (isGeneratedPlanningArtifactPath(cleaned)) return undefined;
  if (cleaned.includes('/')) return cleaned;
  if (/^[A-Za-z0-9_.-]+\.[A-Za-z0-9_.-]+$/.test(cleaned)) return cleaned;
  return undefined;
}

function isGeneratedPlanningArtifactPath(path: string): boolean {
  return path.startsWith('eforge/plans/') || path.includes('/.decomposition/') || /(?:^|\/)(?:planner-inspection-handoff\.json|output\.json|orchestration\.ya?ml)$/.test(path);
}

function childUnit(parent: PlanningDecompositionUnit, group: SplitGroup, ordinal: number, limits: PlanningDecompositionLimits): PlanningDecompositionUnit {
  const childId = `${parent.unitId}-child-${String(ordinal).padStart(2, '0')}`;
  return {
    ...parent,
    unitId: childId,
    parentId: parent.unitId,
    depth: parent.depth + 1,
    title: group.titleSuffix ? `${parent.title} — ${group.titleSuffix}` : `${parent.title} child ${ordinal}`,
    sourceSlices: group.sourceSlices,
    criteriaIds: [...group.criteriaIds].sort(),
    subsystemHints: [...group.subsystemHints].sort(),
    dependsOn: parent.dependsOn,
    interfaceConstraints: group.interfaceConstraints ?? parent.interfaceConstraints,
    sharedFileConstraints: group.sharedFileConstraints ?? parent.sharedFileConstraints,
    budgets: deriveBudget(limits, parent.depth + 1),
    status: 'queued',
  };
}

function hasProgress(parent: PlanningDecompositionUnit, child: PlanningDecompositionUnit, observed: PlanningObservedBudgetPressure, pressureRatio?: number): boolean {
  const keys = observed.triggeredLimitKeys.length > 0 ? observed.triggeredLimitKeys : ['maxCriteriaPerUnit'];
  const parentPressure = pressureValues(parent, observed, parent);
  const childPressure = pressureValues(child, observed, parent, pressureRatio);
  return keys.some((key) => {
    const parentValue = parentPressure.get(key);
    const childValue = childPressure.get(key);
    return typeof parentValue === 'number' && typeof childValue === 'number' && childValue < parentValue;
  });
}

function pressureValues(unit: PlanningDecompositionUnit, observed: PlanningObservedBudgetPressure, parent: PlanningDecompositionUnit, pressureRatio?: number): Map<string, number | undefined> {
  const sourceBytes = unit.sourceSlices.reduce((sum, slice) => sum + slice.byteLength, 0);
  const parentSourceBytes = Math.max(1, parent.sourceSlices.reduce((sum, slice) => sum + slice.byteLength, 0));
  const criteriaRatio = pressureRatio ?? (parent.criteriaIds.length > 0 ? unit.criteriaIds.length / parent.criteriaIds.length : sourceBytes / parentSourceBytes);
  const sourceRatio = pressureRatio ?? sourceBytes / parentSourceBytes;
  const pressure = evaluatePlanningUnitBudgetPressure({ unit });
  return new Map<string, number | undefined>([
    ['maxPromptSourceBytes', pressure.promptSourceBytes ?? sourceBytes],
    ['maxPromptBytes', scaled(observed.promptBytes, sourceRatio)],
    ['maxObservedInputTokens', scaled(observed.observedInputTokens, sourceRatio)],
    ['maxObservedTurns', scaled(observed.observedTurns, criteriaRatio)],
    ['maxCompactHandoffBytes', scaled(observed.compactHandoffBytes, sourceRatio)],
    ['maxLocalExplorationToolUses', scaled(observed.localExplorationToolUses, criteriaRatio)],
    ['maxCriteriaPerUnit', pressure.criteriaCount ?? unit.criteriaIds.length],
    ['maxSubsystemsPerUnit', pressure.subsystemCount ?? unit.subsystemHints.length],
  ]);
}

function scaled(value: number | undefined, ratio: number): number | undefined {
  return typeof value === 'number' ? Math.ceil(value * ratio) : undefined;
}

function splitAttemptsForUnit(graph: PlanningDecompositionGraph, unitId: string): number {
  return graph.splitAttempts.filter((attempt) => attempt.unitId === unitId).length;
}

function exhausted(input: SplitOverBudgetPlanningUnitInput, blockers: string[]): DecompositionPlanningError {
  return {
    kind: 'decomposition-exhausted',
    stage: 'planning-decomposition',
    source: 'decomposition',
    message: `Planning decomposition exhausted for ${input.unit.unitId}`,
    evidence: {
      unitId: input.unit.unitId,
      parentUnitId: input.unit.parentId,
      depth: input.unit.depth,
      budgets: input.unit.budgets,
      observed: input.observedPressure,
      assignedCriteriaIds: input.unit.criteriaIds,
      unresolvedCriteria: unresolvedCriteriaForExhaustedUnit(input, blockers),
      blockers,
      splitAttempts: input.graph.splitAttempts.filter((attempt) => attempt.unitId === input.unit.unitId).slice(-8),
    },
  };
}

function unresolvedCriteriaForExhaustedUnit(input: SplitOverBudgetPlanningUnitInput, blockers: string[]): PlanningUnresolvedCriterion[] {
  const assignedIds = new Set(input.unit.criteriaIds);
  const coveredIds = new Set(input.graph.coverage.coveredCriteria.map((criterion) => criterion.criterionId));
  const unitUnresolved = input.graph.coverage.unresolvedCriteria.filter((criterion) => assignedIds.has(criterion.criterionId));
  const existingIds = new Set(unitUnresolved.map((criterion) => criterion.criterionId));
  const reason = blockers[0] ?? 'decomposition-exhausted';
  const synthesized = input.unit.criteriaIds
    .filter((criterionId) => !coveredIds.has(criterionId) && !existingIds.has(criterionId))
    .map((criterionId) => ({ criterionId, reason, evidence: input.unit.unitId }));
  return [...unitUnresolved, ...synthesized].slice(0, PLANNING_DECOMPOSITION_MAX_UNRESOLVED_CRITERIA);
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}
