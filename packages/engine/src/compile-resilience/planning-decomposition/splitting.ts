import type { PlanningDecompositionLimits, PlanningObservedBudgetPressure, PlanningSplitAttemptEvidence } from '@eforge-build/client';
import { evaluatePlanningUnitBudgetPressure, type DecompositionPlanningError, type SplitOverBudgetPlanningUnitInput, type PlanningDecompositionGraph, type PlanningDecompositionUnit } from '../planning-decomposition.js';
import { buildEdges, deriveBudget, recomputeCoverage } from './graph-builders.js';

export function splitUnit(input: SplitOverBudgetPlanningUnitInput): { graph: PlanningDecompositionGraph; childUnitIds: string[] } | DecompositionPlanningError {
  const limits = input.limits ?? input.graph.limits;
  const blockers = exhaustionBlockers(input.graph, input.unit, input.observedPressure, limits);
  if (blockers.length > 0) return exhausted(input, blockers);
  const groups = splitGroups(input.unit, limits);
  if (groups.length < 2) return exhausted(input, ['no-smaller-child-graph']);
  const children = groups.map((group, index) => childUnit(input.unit, group, index + 1, limits));
  if (!children.every((child) => hasProgress(input.unit, child, input.observedPressure))) return exhausted(input, ['split-does-not-reduce-triggered-pressure']);
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

interface SplitGroup { criteriaIds: string[]; subsystemHints: string[]; sourceSlices: PlanningDecompositionUnit['sourceSlices'] }

function splitGroups(unit: PlanningDecompositionUnit, limits: PlanningDecompositionLimits): SplitGroup[] {
  const strategies: Array<() => SplitGroup[]> = [
    () => unit.criteriaIds.length > 1 ? chunk(unit.criteriaIds, Math.max(1, limits.maxCriteriaPerUnit)).map((criteriaIds) => groupForCriteria(unit, criteriaIds)) : [],
    () => unit.subsystemHints.length > 1 ? unit.subsystemHints.map((hint) => ({ criteriaIds: unit.criteriaIds, subsystemHints: [hint], sourceSlices: unit.sourceSlices })) : [],
    () => unit.sourceSlices.length > 1 ? unit.sourceSlices.map((slice) => ({ criteriaIds: slice.criteriaIds, subsystemHints: unit.subsystemHints, sourceSlices: [{ ...slice }] })).filter((group) => group.criteriaIds.length > 0) : [],
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
  const firstBytes = Math.ceil(slice.byteLength / 2);
  const secondBytes = slice.byteLength - firstBytes;
  return [firstBytes, secondBytes]
    .filter((byteLength) => byteLength > 0)
    .map((byteLength) => ({ criteriaIds: slice.criteriaIds, subsystemHints: unit.subsystemHints, sourceSlices: [{ ...slice, byteLength }] }));
}

function childUnit(parent: PlanningDecompositionUnit, group: SplitGroup, ordinal: number, limits: PlanningDecompositionLimits): PlanningDecompositionUnit {
  const childId = `${parent.unitId}-child-${String(ordinal).padStart(2, '0')}`;
  return {
    ...parent,
    unitId: childId,
    parentId: parent.unitId,
    depth: parent.depth + 1,
    title: `${parent.title} child ${ordinal}`,
    sourceSlices: group.sourceSlices,
    criteriaIds: [...group.criteriaIds].sort(),
    subsystemHints: [...group.subsystemHints].sort(),
    dependsOn: parent.dependsOn,
    budgets: deriveBudget(limits, parent.depth + 1),
    status: 'queued',
  };
}

function hasProgress(parent: PlanningDecompositionUnit, child: PlanningDecompositionUnit, observed: PlanningObservedBudgetPressure): boolean {
  const keys = observed.triggeredLimitKeys.length > 0 ? observed.triggeredLimitKeys : ['maxCriteriaPerUnit'];
  const parentPressure = pressureValues(parent, observed, parent);
  const childPressure = pressureValues(child, observed, parent);
  return keys.some((key) => {
    const parentValue = parentPressure.get(key);
    const childValue = childPressure.get(key);
    return typeof parentValue === 'number' && typeof childValue === 'number' && childValue < parentValue;
  });
}

function pressureValues(unit: PlanningDecompositionUnit, observed: PlanningObservedBudgetPressure, parent: PlanningDecompositionUnit): Map<string, number | undefined> {
  const sourceBytes = unit.sourceSlices.reduce((sum, slice) => sum + slice.byteLength, 0);
  const parentSourceBytes = Math.max(1, parent.sourceSlices.reduce((sum, slice) => sum + slice.byteLength, 0));
  const criteriaRatio = parent.criteriaIds.length > 0 ? unit.criteriaIds.length / parent.criteriaIds.length : sourceBytes / parentSourceBytes;
  const sourceRatio = sourceBytes / parentSourceBytes;
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
      unresolvedCriteria: input.graph.coverage.unresolvedCriteria,
      blockers,
      splitAttempts: input.graph.splitAttempts.slice(-8),
    },
  };
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}
