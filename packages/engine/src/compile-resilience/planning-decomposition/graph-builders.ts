import type { PlanningDecompositionLimits, PlanningUnitBudget } from '@eforge-build/client';
import type { DerivePlanningDecompositionGraphInput, PlanningCoverageSummary, PlanningDecompositionEdge, PlanningDecompositionGraph, PlanningDecompositionUnit } from '../planning-decomposition.js';
import { analyzePlanningSource, hashText, stableSlug, type RequirementRecord } from './source-analysis.js';

const ROOT = 'unit-root';

export function deriveGraph(input: DerivePlanningDecompositionGraphInput): PlanningDecompositionGraph {
  const requirements = applyMetadataSubsystemHints(analyzePlanningSource(input.source.content), input);
  const foundation = foundationRequirements(requirements);
  const units: PlanningDecompositionUnit[] = [];
  const foundationChunks = chunkRequirements(foundation, input.limits);
  for (const [index, chunk] of foundationChunks.entries()) {
    const suffix = index === 0 ? '' : `-${String(index + 1).padStart(3, '0')}`;
    units.push(buildUnit(`unit-foundation-contracts${suffix}`, 'Foundation contracts', chunk, input, 0, []));
  }
  const foundationUnitIds = units.map((u) => u.unitId);
  const foundationIds = new Set(foundation.map((r) => r.id));
  for (const chunk of chunkRequirements(requirements.filter((r) => !foundationIds.has(r.id)), input.limits)) {
    const subsystem = chunk[0]?.subsystemHints[0] ?? 'general';
    units.push(buildUnit(`unit-${stableSlug(subsystem)}-${String(units.length + 1).padStart(3, '0')}`, `${subsystem} planning`, chunk, input, 0, foundationUnitIds));
  }
  if (units.length === 0) units.push(emptyRootUnit(input));
  const sorted = units.sort((a, b) => a.unitId.localeCompare(b.unitId));
  const graph: PlanningDecompositionGraph = {
    graphId: `graph-${hashText(`${input.source.hash}:${sorted.map((u) => `${u.unitId}:${u.criteriaIds.join(',')}:${u.dependsOn.join(',')}`).join('|')}`).slice(0, 16)}`,
    rootUnitId: sorted[0]?.unitId ?? ROOT,
    units: sorted,
    edges: buildEdges(sorted),
    coverage: recomputeCoverage(sorted, input.source.hash),
    parallelism: input.limits.parallelism,
    limits: input.limits,
    sourceHash: input.source.hash,
    splitAttempts: [],
  };
  const validation = validateGraph(graph);
  if (!validation.ok) throw new Error(`Invalid planning decomposition graph: ${validation.errors.join('; ')}`);
  return graph;
}

function emptyRootUnit(input: DerivePlanningDecompositionGraphInput): PlanningDecompositionUnit {
  return { unitId: ROOT, depth: 0, title: 'Root planning', sourceSlices: [{ kind: 'prd', sourceHash: input.source.hash, path: input.source.path, startLine: 1, endLine: 1, criteriaIds: [], byteLength: 0 }], criteriaIds: [], subsystemHints: ['general'], dependsOn: [], interfaceConstraints: [], sharedFileConstraints: [], budgets: deriveBudget(input.limits, 0), status: 'queued' };
}

function applyMetadataSubsystemHints(requirements: RequirementRecord[], input: DerivePlanningDecompositionGraphInput): RequirementRecord[] {
  const preflightHints = input.preflightRisk?.subsystemBreadth.subsystems ?? [];
  const pipelineHints = preflightHints.length === 0 && input.pipelineComposition?.scope === 'expedition' ? ['engine', 'client', 'console', 'cli'] : [];
  const metadataHints = [...new Set([...preflightHints, ...pipelineHints].map((hint) => stableSlug(hint)).filter((hint) => hint && hint !== 'general'))].sort();
  if (metadataHints.length === 0) return requirements;
  return requirements.map((req, index) => req.subsystemHints.length === 0 || (req.subsystemHints.length === 1 && req.subsystemHints[0] === 'general')
    ? { ...req, subsystemHints: [metadataHints[index % metadataHints.length]] }
    : req);
}

function foundationRequirements(requirements: RequirementRecord[]): RequirementRecord[] {
  const contractReqs = requirements.filter((r) => r.interfaceKeys.length > 0 || r.sharedFileKeys.length > 0);
  const subsystems = new Set(contractReqs.flatMap((r) => r.subsystemHints));
  if (contractReqs.length >= 2 && (subsystems.size > 1 || new Set(contractReqs.flatMap((r) => [...r.interfaceKeys, ...r.sharedFileKeys])).size > 1)) return contractReqs;
  return [];
}

function chunkRequirements(requirements: RequirementRecord[], limits: PlanningDecompositionLimits): RequirementRecord[][] {
  const bySubsystem = new Map<string, RequirementRecord[]>();
  for (const req of splitOversizedRequirements(requirements, limits)) {
    const key = req.subsystemHints[0] ?? 'general';
    bySubsystem.set(key, [...(bySubsystem.get(key) ?? []), req]);
  }
  const chunks: RequirementRecord[][] = [];
  for (const [, reqs] of [...bySubsystem.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    let current: RequirementRecord[] = [];
    let bytes = 0;
    for (const req of reqs) {
      const subsystems = new Set([...current.flatMap((r) => r.subsystemHints), ...req.subsystemHints]).size;
      if (current.length > 0 && (current.length >= limits.maxCriteriaPerUnit || subsystems > limits.maxSubsystemsPerUnit || bytes + req.byteLength > limits.maxPromptSourceBytes)) {
        chunks.push(current); current = []; bytes = 0;
      }
      current.push(req); bytes += req.byteLength;
    }
    if (current.length > 0) chunks.push(current);
  }
  return chunks;
}

function splitOversizedRequirements(requirements: RequirementRecord[], limits: PlanningDecompositionLimits): RequirementRecord[] {
  return requirements.flatMap((req) => {
    if (req.byteLength <= limits.maxPromptSourceBytes) return [req];
    const partCount = Math.ceil(req.byteLength / limits.maxPromptSourceBytes);
    return Array.from({ length: partCount }, (_, index) => ({ ...req, byteLength: index === partCount - 1 ? req.byteLength - (partCount - 1) * limits.maxPromptSourceBytes : limits.maxPromptSourceBytes }));
  });
}

export function buildUnit(unitId: string, title: string, reqs: RequirementRecord[], input: DerivePlanningDecompositionGraphInput, depth: number, dependsOn: string[]): PlanningDecompositionUnit {
  return {
    unitId,
    depth,
    title,
    sourceSlices: reqs.map((req) => ({ kind: 'criteria', sourceHash: input.source.hash, path: input.source.path, headingPath: req.headingPath, startLine: req.line, endLine: req.line, criteriaIds: [req.id], byteLength: req.byteLength })),
    criteriaIds: reqs.map((r) => r.id).sort(),
    subsystemHints: [...new Set(reqs.flatMap((r) => r.subsystemHints))].sort().slice(0, input.limits.maxSubsystemsPerUnit),
    dependsOn: [...new Set(dependsOn)].sort(),
    interfaceConstraints: [...new Set(reqs.flatMap((r) => r.interfaceKeys))].sort(),
    sharedFileConstraints: [...new Set(reqs.flatMap((r) => r.sharedFileKeys))].sort(),
    budgets: deriveBudget(input.limits, depth),
    status: 'queued',
  };
}

export function deriveBudget(limits: PlanningDecompositionLimits, depth: number): PlanningUnitBudget {
  const budget: PlanningUnitBudget = { maxRecursiveDepth: Math.max(0, limits.maxDepth - depth), maxPromptSourceBytes: limits.maxPromptSourceBytes, maxPromptBytes: limits.maxPromptBytes, maxObservedInputTokens: limits.maxObservedInputTokens, maxCompactHandoffBytes: limits.maxCompactHandoffBytes, maxLocalExplorationToolUses: limits.maxLocalExplorationToolUses, maxCriteriaPerUnit: limits.maxCriteriaPerUnit, maxSubsystemsPerUnit: limits.maxSubsystemsPerUnit, maxSplitAttemptsPerUnit: limits.maxSplitAttemptsPerUnit };
  if (limits.maxObservedTurns !== undefined) budget.maxObservedTurns = limits.maxObservedTurns;
  return budget;
}

export function buildEdges(units: PlanningDecompositionUnit[]): PlanningDecompositionEdge[] {
  return units.flatMap((unit) => unit.dependsOn.map((dep) => ({ fromUnitId: dep, toUnitId: unit.unitId, reason: 'dependency' }))).sort((a, b) => `${a.fromUnitId}:${a.toUnitId}`.localeCompare(`${b.fromUnitId}:${b.toUnitId}`));
}

export function recomputeCoverage(units: PlanningDecompositionUnit[], sourceHash: string, prior?: PlanningCoverageSummary): PlanningCoverageSummary {
  const active = units.filter((u) => u.status !== 'skipped');
  const coverageByUnit = Object.fromEntries(active.map((u) => [u.unitId, [...u.criteriaIds].sort()]).filter(([, ids]) => (ids as string[]).length > 0)) as Record<string, string[]>;
  const byCriterion = new Map<string, string[]>();
  for (const unit of active) for (const id of unit.criteriaIds) byCriterion.set(id, [...(byCriterion.get(id) ?? []), unit.unitId].sort());
  const coveredCriteria = [...byCriterion.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([criterionId, coveredByUnitIds]) => ({ criterionId, sourceHash, coveredByUnitIds }));
  const coveredIds = new Set(coveredCriteria.map((criterion) => criterion.criterionId));
  const unresolvedCriteria = (prior?.unresolvedCriteria ?? []).filter((criterion) => !coveredIds.has(criterion.criterionId));
  const totalCriteria = Math.max(prior?.totalCriteria ?? 0, coveredCriteria.length + unresolvedCriteria.length);
  return { totalCriteria, coverageByUnit, coveredCriteria, unresolvedCriteria };
}

export function validateGraph(graph: PlanningDecompositionGraph): { ok: true; errors: [] } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const ids = graph.units.map((u) => u.unitId);
  const idSet = new Set(ids);
  if (idSet.size !== ids.length) errors.push('duplicate unit ID');
  for (const unit of graph.units) {
    validateUnitBudgets(unit, graph.limits, errors);
    if (unit.criteriaIds.length > graph.limits.maxCriteriaPerUnit) errors.push(`criteria budget exceeded:${unit.unitId}`);
    if (unit.subsystemHints.length > graph.limits.maxSubsystemsPerUnit) errors.push(`subsystem budget exceeded:${unit.unitId}`);
    if (unit.sourceSlices.reduce((sum, slice) => sum + slice.byteLength, 0) > graph.limits.maxPromptSourceBytes) errors.push(`source byte budget exceeded:${unit.unitId}`);
    if (unit.parentId && !idSet.has(unit.parentId)) errors.push(`invalid parent:${unit.unitId}`);
    for (const dep of unit.dependsOn) if (!idSet.has(dep)) errors.push(`missing dependency:${unit.unitId}->${dep}`);
    for (const slice of unit.sourceSlices) {
      if (slice.byteLength < 0) errors.push(`negative slice byte count:${unit.unitId}`);
      if (!validLineRange(slice.startLine, slice.endLine)) errors.push(`invalid line range:${unit.unitId}`);
    }
  }
  for (const [unitId, count] of splitAttemptCounts(graph)) if (count > graph.limits.maxSplitAttemptsPerUnit) errors.push(`split attempts budget exceeded:${unitId}`);
  for (const attempt of graph.splitAttempts) if (attempt.attempt > graph.limits.maxSplitAttemptsPerUnit) errors.push(`split attempt ordinal budget exceeded:${attempt.unitId ?? 'unknown'}`);
  for (const edge of graph.edges) if (!idSet.has(edge.fromUnitId) || !idSet.has(edge.toUnitId)) errors.push(`missing edge endpoint:${edge.fromUnitId}->${edge.toUnitId}`);
  for (const cycle of findCycle(graph.units)) errors.push(`dependency cycle:${cycle}`);
  validateCoverage(graph, errors);
  return errors.length === 0 ? { ok: true, errors: [] } : { ok: false, errors };
}

type BudgetLimitKey = 'maxPromptSourceBytes' | 'maxPromptBytes' | 'maxObservedInputTokens' | 'maxCompactHandoffBytes' | 'maxLocalExplorationToolUses' | 'maxCriteriaPerUnit' | 'maxSubsystemsPerUnit' | 'maxSplitAttemptsPerUnit';
const REQUIRED_POSITIVE_BUDGET_KEYS: BudgetLimitKey[] = ['maxPromptSourceBytes', 'maxPromptBytes', 'maxObservedInputTokens', 'maxCompactHandoffBytes', 'maxLocalExplorationToolUses', 'maxCriteriaPerUnit', 'maxSubsystemsPerUnit', 'maxSplitAttemptsPerUnit'];

function validateUnitBudgets(unit: PlanningDecompositionUnit, limits: PlanningDecompositionLimits, errors: string[]): void {
  if (!unit.budgets) { errors.push(`missing budgets:${unit.unitId}`); return; }
  if (!Number.isInteger(unit.budgets.maxRecursiveDepth) || unit.budgets.maxRecursiveDepth < 0) errors.push(`invalid budget:maxRecursiveDepth:${unit.unitId}`);
  if (unit.budgets.maxRecursiveDepth !== Math.max(0, limits.maxDepth - unit.depth)) errors.push(`budget mismatch:maxRecursiveDepth:${unit.unitId}`);
  for (const key of REQUIRED_POSITIVE_BUDGET_KEYS) {
    if (!Number.isInteger(unit.budgets[key]) || (unit.budgets[key] as number) <= 0) errors.push(`invalid budget:${key}:${unit.unitId}`);
    if (unit.budgets[key] !== limits[key]) errors.push(`budget mismatch:${key}:${unit.unitId}`);
  }
  if (limits.maxObservedTurns !== undefined && unit.budgets.maxObservedTurns !== limits.maxObservedTurns) errors.push(`budget mismatch:maxObservedTurns:${unit.unitId}`);
  if (unit.budgets.maxObservedTurns !== undefined && (!Number.isInteger(unit.budgets.maxObservedTurns) || unit.budgets.maxObservedTurns <= 0)) errors.push(`invalid budget:maxObservedTurns:${unit.unitId}`);
}

function validLineRange(startLine?: number, endLine?: number): boolean {
  if (startLine !== undefined && (!Number.isInteger(startLine) || startLine <= 0)) return false;
  if (endLine !== undefined && (!Number.isInteger(endLine) || endLine <= 0)) return false;
  return startLine === undefined || endLine === undefined || startLine <= endLine;
}

function validateCoverage(graph: PlanningDecompositionGraph, errors: string[]): void {
  const activeUnits = graph.units.filter((u) => u.status !== 'skipped');
  const expectedCoverageByUnit = Object.fromEntries(activeUnits.map((u) => [u.unitId, [...u.criteriaIds].sort()]).filter(([, criteriaIds]) => (criteriaIds as string[]).length > 0)) as Record<string, string[]>;
  if (!sameStringRecord(graph.coverage.coverageByUnit, expectedCoverageByUnit)) errors.push('coverageByUnit mismatch');

  const byCriterion = new Map<string, string[]>();
  for (const unit of activeUnits) for (const id of unit.criteriaIds) byCriterion.set(id, [...(byCriterion.get(id) ?? []), unit.unitId].sort());
  const coveredCriteria = new Map(graph.coverage.coveredCriteria.map((coverage) => [coverage.criterionId, [...coverage.coveredByUnitIds].sort()]));
  for (const [criterionId, unitIds] of byCriterion) if (!sameStringList(coveredCriteria.get(criterionId) ?? [], unitIds)) errors.push(`coverage mismatch:${criterionId}`);
  for (const criterionId of coveredCriteria.keys()) if (!byCriterion.has(criterionId)) errors.push(`coverage extra:${criterionId}`);

  const coveredIds = new Set(graph.coverage.coveredCriteria.map((c) => c.criterionId));
  const unresolvedIds = new Set(graph.coverage.unresolvedCriteria.map((c) => c.criterionId));
  for (const id of unresolvedIds) if (coveredIds.has(id)) errors.push(`coverage overlap:${id}`);
  const coveredOrUnresolved = new Set([...coveredIds, ...unresolvedIds]);
  const activeCriteria = new Set(activeUnits.flatMap((u) => u.criteriaIds));
  for (const id of activeCriteria) if (!coveredOrUnresolved.has(id)) errors.push(`coverage gap:${id}`);
  if (graph.coverage.totalCriteria !== coveredOrUnresolved.size) errors.push('coverage total must equal covered and unresolved criteria');
}

function sameStringRecord(actual: Record<string, string[]>, expected: Record<string, string[]>): boolean {
  const actualKeys = Object.keys(actual).sort();
  const expectedKeys = Object.keys(expected).sort();
  return sameStringList(actualKeys, expectedKeys) && expectedKeys.every((key) => sameStringList([...(actual[key] ?? [])].sort(), expected[key]));
}

function sameStringList(actual: string[], expected: string[]): boolean {
  return actual.length === expected.length && actual.every((value, index) => value === expected[index]);
}

function splitAttemptCounts(graph: PlanningDecompositionGraph): Map<string, number> {
  const counts = new Map<string, number>();
  for (const attempt of graph.splitAttempts) {
    if (!attempt.unitId) continue;
    counts.set(attempt.unitId, (counts.get(attempt.unitId) ?? 0) + 1);
  }
  return counts;
}

function findCycle(units: PlanningDecompositionUnit[]): string[] {
  const byId = new Map(units.map((u) => [u.unitId, u]));
  const visiting = new Set<string>(); const visited = new Set<string>(); const cycles: string[] = [];
  const visit = (id: string): void => {
    if (visiting.has(id)) { cycles.push(id); return; }
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dep of byId.get(id)?.dependsOn ?? []) visit(dep);
    visiting.delete(id); visited.add(id);
  };
  for (const unit of units) visit(unit.unitId);
  return cycles;
}
