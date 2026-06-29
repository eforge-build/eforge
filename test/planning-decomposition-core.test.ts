import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { safeParseEforgeEvent, type PlanningDecompositionLimits } from '@eforge-build/client';
import { extractExpectedAcceptanceCriteria } from '@eforge-build/engine/validation/acceptance-criteria';
import { derivePlanningDecompositionGraph, evaluatePlanningUnitBudgetPressure, selectReadyPlanningBatch, splitOverBudgetPlanningUnit, validatePlanningDecompositionGraph, type PlanningDecompositionGraph } from '@eforge-build/engine/compile-resilience/planning-decomposition';
import { readUnitSourceSlice } from '@eforge-build/engine/compile-resilience/context-managed-planning/artifacts';

const limits: PlanningDecompositionLimits = { parallelism: 2, maxDepth: 2, maxPromptSourceBytes: 500, maxPromptBytes: 1000, maxObservedInputTokens: 1000, maxObservedTurns: 3, maxCompactHandoffBytes: 200, maxLocalExplorationToolUses: 4, maxCriteriaPerUnit: 2, maxSubsystemsPerUnit: 1, maxSplitAttemptsPerUnit: 2 };
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const graphFor = (content: string, l = limits) => derivePlanningDecompositionGraph({ source: { content, hash: hash(content), path: 'prd.md' }, limits: l });

function source(subsystems = ['engine', 'client', 'console', 'cli', 'input', 'test'], count = 24): string {
  return `# PRD\n\n## Acceptance Criteria\n${Array.from({ length: count }, (_, i) => `- ${subsystems[i % subsystems.length]} implements behavior ${i + 1} for the ${subsystems[i % subsystems.length]} subsystem`).join('\n')}`;
}

describe('planning decomposition core', () => {
  it('derives deterministic covered graphs with slices, budgets, and valid edges', () => {
    const content = source();
    const graph = graphFor(content);
    const again = graphFor(content);
    const criteria = extractExpectedAcceptanceCriteria(content, { allowFallbackSections: true });
    expect(graph.units.filter((u) => u.status !== 'skipped').length).toBeGreaterThan(1);
    expect(graph.parallelism).toBe(limits.parallelism);
    expect(graph.coverage.totalCriteria).toBe(criteria.length);
    expect(new Set([...Object.values(graph.coverage.coverageByUnit).flat(), ...graph.coverage.unresolvedCriteria.map((c) => c.criterionId)])).toEqual(new Set(criteria.map((c) => c.id)));
    expect(graph.units.every((u) => u.unitId.startsWith('unit-'))).toBe(true);
    expect(graph.units.filter((u) => u.criteriaIds.length > 0).every((u) => u.sourceSlices.some((s) => s.criteriaIds.length > 0 && s.byteLength > 0))).toBe(true);
    expect(graph.units.every((u) => u.budgets.maxRecursiveDepth === Math.max(0, limits.maxDepth - u.depth))).toBe(true);
    expect(graph.units.map((u) => u.unitId)).toEqual(again.units.map((u) => u.unitId));
    expect(graph.edges).toEqual(again.edges);
    expect(graph.coverage).toEqual(again.coverage);
    expect(graph.edges.every((e) => graph.units.some((u) => u.unitId === e.fromUnitId) && graph.units.some((u) => u.unitId === e.toUnitId))).toBe(true);
    expect(validatePlanningDecompositionGraph(graph).ok).toBe(true);
  });

  it('uses preflight subsystem breadth when criterion text has no subsystem hints', () => {
    const content = `# PRD\n\n## Acceptance Criteria\n- Implements first behavior\n- Implements second behavior\n- Implements third behavior\n- Implements fourth behavior`;
    const graph = derivePlanningDecompositionGraph({
      source: { content, hash: hash(content), path: 'prd.md' },
      limits,
      preflightRisk: {
        level: 'elevated',
        sourceBytes: content.length,
        promptSourceBytes: content.length,
        acceptanceCriteriaCount: 4,
        score: 4,
        generatedInventory: { detected: false, contentHashes: [], pathReferences: [], headings: [], blockCount: 0, sidecarCount: 0, omittedBytes: 0 },
        subsystemBreadth: { count: 2, subsystems: ['engine', 'console'], evidence: ['preflight only'] },
        reasons: [],
        recommendation: { action: 'bounded-decomposition', eligible: true, reason: 'broad' },
      },
      pipelineComposition: { scope: 'expedition', compile: [], defaultBuild: [], defaultReview: { strategy: 'single', perspectives: ['general'], maxRounds: 1, evaluatorStrictness: 'standard' }, rationale: 'broad work' },
    });
    expect(new Set(graph.units.flatMap((unit) => unit.subsystemHints))).toEqual(new Set(['console', 'engine']));
  });

  it('pre-splits a single criterion line that exceeds the source byte budget', async () => {
    const content = `# PRD\n\n## Acceptance Criteria\n- ${'x'.repeat(1200)}`;
    const graph = graphFor(content, { ...limits, maxPromptSourceBytes: 500, maxCriteriaPerUnit: 10 });
    expect(graph.units.length).toBeGreaterThan(1);
    expect(validatePlanningDecompositionGraph(graph).ok).toBe(true);
    expect(graph.units.every((unit) => unit.sourceSlices.reduce((sum, slice) => sum + slice.byteLength, 0) <= 500)).toBe(true);
    for (const unit of graph.units) {
      const text = await readUnitSourceSlice({ sourceContent: content } as never, unit);
      expect(Buffer.byteLength(text, 'utf8')).toBeLessThanOrEqual(500);
      expect(text).not.toBe(content.split('\n').at(-1));
    }
  });

  it('creates foundation unit for contract-heavy work and independent units for independent work', () => {
    const contract = graphFor(`# PRD\n\n## Acceptance Criteria\n- engine updates event schema for packages/client/src/events.ts\n- client updates route constant /api/runs for packages/client/src/routes.ts\n- console consumes config contract compile.planningUnitParallelism\n- cli renders engine behavior`);
    expect(contract.units.some((u) => u.unitId === 'unit-foundation-contracts')).toBe(true);
    expect(contract.units.some((u) => u.dependsOn.includes('unit-foundation-contracts'))).toBe(true);
    const independent = graphFor(`# PRD\n\n## Acceptance Criteria\n- engine handles isolated behavior\n- engine handles second isolated behavior\n- console handles isolated view\n- console handles second isolated view`);
    const active = independent.units.filter((u) => u.unitId !== 'unit-foundation-contracts');
    expect(active.length).toBeGreaterThanOrEqual(2);
    expect(independent.edges).toHaveLength(0);
  });

  it('schedules by dependency, capacity, running slots, failed dependencies, and constraints', () => {
    const graph = graphFor(source(['engine', 'client', 'console', 'cli'], 8));
    expect(selectReadyPlanningBatch({ graph, parallelism: 2 }).selectedBatchUnitIds).toHaveLength(2);
    expect(selectReadyPlanningBatch({ graph, runningUnitIds: [graph.units[0].unitId], parallelism: 2 }).selectedBatchUnitIds.length).toBeLessThanOrEqual(1);
    const capacityLimited = selectReadyPlanningBatch({ graph, parallelism: 1 });
    expect(capacityLimited.waitingUnitIds.every((id) => !id.includes('capacity:'))).toBe(true);
    expect(capacityLimited.waitingReasons.some((entry) => entry.reasons.includes('capacity:parallelism-1'))).toBe(true);

    const dependent = graphFor(`# PRD\n\n## Acceptance Criteria\n- engine updates event schema\n- client updates route constant /api/runs\n- console renders feature\n- cli renders feature`);
    const downstream = dependent.units.find((u) => u.dependsOn.length > 0)!;
    expect(selectReadyPlanningBatch({ graph: dependent }).waitingReasons.some((entry) => entry.reasons.includes(`dependency:${downstream.dependsOn[0]}`))).toBe(true);
    expect(selectReadyPlanningBatch({ graph: dependent, failedUnitIds: downstream.dependsOn }).waitingReasons.some((entry) => entry.reasons.includes(`dependency-failed:${downstream.dependsOn[0]}`))).toBe(true);
    expect(selectReadyPlanningBatch({ graph: dependent, skippedUnitIds: downstream.dependsOn }).waitingReasons.some((entry) => entry.reasons.includes(`dependency-skipped:${downstream.dependsOn[0]}`))).toBe(true);

    const constrained: PlanningDecompositionGraph = { ...graph, units: graph.units.slice(0, 2).map((u) => ({ ...u, interfaceConstraints: ['event-schemas'], sharedFileConstraints: [] })), edges: [], coverage: graph.coverage };
    const scheduled = selectReadyPlanningBatch({ graph: constrained, parallelism: 2 });
    expect(scheduled.selectedBatchUnitIds).toHaveLength(1);
    expect(scheduled.blockedPairs[0]?.reason).toBe('interface-contract:event-schemas');

    const sharedFileConstrained: PlanningDecompositionGraph = { ...graph, units: graph.units.slice(0, 2).map((u) => ({ ...u, interfaceConstraints: [], sharedFileConstraints: ['packages/client/src/events.ts'] })), edges: [], coverage: graph.coverage };
    const sharedFileScheduled = selectReadyPlanningBatch({ graph: sharedFileConstrained, parallelism: 2 });
    expect(sharedFileScheduled.selectedBatchUnitIds).toHaveLength(1);
    expect(sharedFileScheduled.blockedPairs[0]?.reason).toBe('shared-file:packages/client/src/events.ts');

    const withLifecycleState: PlanningDecompositionGraph = { ...graph, parallelism: 1, units: graph.units.slice(0, 3).map((u, index) => ({ ...u, status: index === 0 ? 'completed' : index === 1 ? 'running' : 'queued' })) };
    const lifecycleScheduled = selectReadyPlanningBatch({ graph: withLifecycleState, parallelism: 99 });
    expect(lifecycleScheduled.parallelism).toBe(1);
    expect(lifecycleScheduled.runningUnitIds).toEqual([withLifecycleState.units[1].unitId]);
    expect(lifecycleScheduled.selectedBatchUnitIds).toEqual([]);
  });

  it('normalizes scheduler inputs to the public schedule event schema', () => {
    const graph = graphFor(source(['engine'], 140), { ...limits, parallelism: 2, maxCriteriaPerUnit: 1 });
    const timestamp = '2025-01-01T00:00:00.000Z';
    for (const decision of [
      selectReadyPlanningBatch({ graph, parallelism: 0 }),
      selectReadyPlanningBatch({ graph, parallelism: 1, runningUnitIds: graph.units.slice(0, 3).map((u) => u.unitId) }),
      selectReadyPlanningBatch({ graph, parallelism: 1 }),
    ]) {
      const parsed = safeParseEforgeEvent({ timestamp, type: 'planning:decomposition:schedule', decision });
      expect(parsed.success).toBe(decision.runningUnitIds.length + decision.selectedBatchUnitIds.length <= decision.parallelism);
      expect(decision.readyUnitIds.length).toBeLessThanOrEqual(128);
      expect(decision.waitingUnitIds.length).toBeLessThanOrEqual(128);
    }
  });

  it('reports budget pressure keys exactly', () => {
    const unit = graphFor(source(['engine'], 3)).units[0];
    const pressure = evaluatePlanningUnitBudgetPressure({ unit, observed: { promptSourceBytes: 999, promptBytes: 9999, observedInputTokens: 1001, observedTurns: 4, compactHandoffBytes: 201, localExplorationToolUses: 5, criteriaCount: 3, subsystemCount: 2 } });
    expect(pressure.triggeredLimitKeys).toEqual(['maxPromptSourceBytes', 'maxPromptBytes', 'maxObservedInputTokens', 'maxObservedTurns', 'maxCompactHandoffBytes', 'maxLocalExplorationToolUses', 'maxCriteriaPerUnit', 'maxSubsystemsPerUnit']);
  });

  it('splits over-budget units, rewrites downstream dependencies, and preserves active coverage', () => {
    const graph = graphFor(source(['engine'], 5), { ...limits, maxCriteriaPerUnit: 10 });
    const parent = graph.units[0];
    const downstream = { ...parent, unitId: 'unit-downstream', title: 'Downstream synthesis', criteriaIds: [], sourceSlices: [], dependsOn: [parent.unitId] };
    const withDownstream: PlanningDecompositionGraph = { ...graph, units: [parent, downstream], edges: [{ fromUnitId: parent.unitId, toUnitId: downstream.unitId, reason: 'test' }] };
    const before = new Set(Object.values(withDownstream.coverage.coverageByUnit).flat());
    const result = splitOverBudgetPlanningUnit({ graph: withDownstream, unit: parent, observedPressure: { criteriaCount: 5, triggeredLimitKeys: ['maxCriteriaPerUnit'] }, limits });
    expect('graph' in result).toBe(true);
    if (!('graph' in result)) return;
    expect(result.childUnitIds).toHaveLength(3);
    expect(result.graph.units.find((u) => u.unitId === parent.unitId)?.status).toBe('skipped');
    expect(result.childUnitIds.every((id) => result.graph.units.find((u) => u.unitId === id)?.parentId === parent.unitId)).toBe(true);
    expect(new Set(Object.values(result.graph.coverage.coverageByUnit).flat())).toEqual(before);
    expect(result.graph.units.find((u) => u.unitId === downstream.unitId)?.dependsOn).toEqual(result.childUnitIds);
  });

  it('enforces split attempts per unit from graph evidence', () => {
    const graph = graphFor(source(['engine'], 5), { ...limits, maxCriteriaPerUnit: 10, maxSplitAttemptsPerUnit: 1 });
    const parent = graph.units[0];
    const first = splitOverBudgetPlanningUnit({ graph, unit: parent, observedPressure: { criteriaCount: 5, triggeredLimitKeys: ['maxCriteriaPerUnit'] }, limits: { ...limits, maxSplitAttemptsPerUnit: 1 } });
    expect('graph' in first).toBe(true);
    if (!('graph' in first)) return;
    const retry = splitOverBudgetPlanningUnit({ graph: first.graph, unit: parent, observedPressure: { criteriaCount: 5, triggeredLimitKeys: ['maxCriteriaPerUnit'] }, limits: { ...limits, maxSplitAttemptsPerUnit: 1 } });
    expect('kind' in retry && retry.kind).toBe('decomposition-exhausted');
    if ('kind' in retry) expect(retry.evidence.blockers).toContain('unit-already-split');
  });

  it('returns typed exhaustion and validates bad graphs', () => {
    const graph = graphFor(`# PRD\n\n## Acceptance Criteria\n- engine single criterion`);
    const unit = { ...graph.units[0], depth: limits.maxDepth, budgets: { ...graph.units[0].budgets, maxRecursiveDepth: 0 } };
    const exhausted = splitOverBudgetPlanningUnit({ graph, unit, observedPressure: { criteriaCount: 1, triggeredLimitKeys: ['maxCriteriaPerUnit'] }, limits });
    expect('kind' in exhausted && exhausted.kind).toBe('decomposition-exhausted');
    if ('kind' in exhausted) {
      expect(exhausted.stage).toBe('planning-decomposition');
      expect(exhausted.evidence.unitId).toBe(unit.unitId);
      expect(exhausted.evidence.depth).toBe(unit.depth);
      expect(exhausted.evidence.budgets).toBe(unit.budgets);
      expect(exhausted.evidence.observed).toBeDefined();
      expect(exhausted.evidence.blockers.length).toBeGreaterThan(0);
      expect(Object.keys(exhausted.evidence)).not.toContain('rawSourceContent');
      expect(Object.keys(exhausted.evidence)).not.toContain('promptText');
      expect(Object.keys(exhausted.evidence)).not.toContain('transcript');
      expect(Object.keys(exhausted.evidence)).not.toContain('agentOutput');
    }
    const unsplittable = splitOverBudgetPlanningUnit({ graph, unit: graph.units[0], observedPressure: { promptSourceBytes: 9999, triggeredLimitKeys: ['maxPromptSourceBytes'] }, limits });
    expect('kind' in unsplittable && unsplittable.kind).toBe('decomposition-exhausted');
    if ('kind' in unsplittable) expect(unsplittable.evidence.blockers).toContain('no-smaller-child-graph');
    expect(graph.units).toHaveLength(1);
    const duplicate = { ...graph, units: [graph.units[0], { ...graph.units[0] }] };
    expect(validatePlanningDecompositionGraph(duplicate).ok).toBe(false);
    const missing = { ...graph, units: [{ ...graph.units[0], dependsOn: ['missing'] }] };
    expect(validatePlanningDecompositionGraph(missing).ok).toBe(false);
    const cycle = { ...graph, units: [{ ...graph.units[0], dependsOn: [graph.units[0].unitId] }] };
    expect(validatePlanningDecompositionGraph(cycle).ok).toBe(false);
    const gap = { ...graph, coverage: { ...graph.coverage, coveredCriteria: [], coverageByUnit: {} } };
    expect(validatePlanningDecompositionGraph(gap).ok).toBe(false);
  });
});
