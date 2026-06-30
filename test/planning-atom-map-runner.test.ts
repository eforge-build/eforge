import { describe, expect, it } from 'vitest';
import type { PlanningDecompositionLimits } from '@eforge-build/client';
import { buildPlanningAtomTasks, derivePlanningAtomGraph, deriveSourceInventory, runPlanningAtomMap, selectReadyPlanningAtoms, type PlanningAtomGraph, type PlanningAtomOutput, type PlanningAtomTask } from '@eforge-build/engine/planner-compiler';
import { StubHarness } from './stub-harness.js';

const limits: PlanningDecompositionLimits = { parallelism: 2, maxDepth: 3, maxPromptSourceBytes: 1_000, maxPromptBytes: 20_000, maxObservedInputTokens: 50_000, maxObservedTurns: 10, maxCompactHandoffBytes: 8_000, maxLocalExplorationToolUses: 8, maxCriteriaPerUnit: 1, maxSubsystemsPerUnit: 2, maxSplitAttemptsPerUnit: 2 };
const hash = (value: string) => `h${value.length}`.padEnd(64, '0');

function prd(criteria: string[]): string {
  return ['# Atom Map', '', '## Acceptance Criteria', ...criteria.map((criterion) => `- ${criterion}`)].join('\n');
}

function fixture(criteria: string[]) {
  const content = prd(criteria);
  const inventory = deriveSourceInventory({ content, hash: hash(content), path: 'atom-map.md' });
  const graph = derivePlanningAtomGraph({ content, hash: hash(content), path: 'atom-map.md', limits, inventory });
  const tasks = buildPlanningAtomTasks({ graph, inventory });
  return { content, inventory, graph, tasks, taskById: new Map(tasks.map((task) => [task.atomId, task])) };
}

describe('planning atom map runner', () => {
  it('executes ready atoms in dependency order and summarizes completed coverage', async () => {
    const data = fixture([
      'engine updates `packages/engine/src/a.ts`.',
      'client updates `packages/client/src/b.ts` after ac-001.',
      'docs update `docs/c.md`.',
    ]);
    const order = completionOrder(data.graph);
    const harness = new StubHarness(order.map((atomId) => ({ resultText: JSON.stringify(completedOutput(data.taskById.get(atomId)!)) })));

    const result = await runPlanningAtomMap({ graph: data.graph, inventory: data.inventory, sourceContent: data.content, cwd: process.cwd(), harness, parallelism: 2, agentOptions: { maxTurns: 3 } });

    expect(result.mapComplete).toBe(true);
    expect(result.validationErrors).toEqual([]);
    expect(result.completedAtomIds).toEqual(order.sort());
    expect(result.failedAtomIds).toEqual([]);
    expect(result.coverage.completeCriteria).toEqual(['ac-001', 'ac-002', 'ac-003']);
    expect(harness.calls.every((call) => call.tools === 'none' && call.maxTurns === 3)).toBe(true);
    expect(harness.prompts[0]).toContain('Do not inspect the repository or call tools');
  });

  it('continues independent atoms after a failure and blocks dependency successors', async () => {
    const data = fixture([
      'engine updates `packages/engine/src/a.ts`.',
      'client updates `packages/client/src/b.ts` after ac-001.',
      'docs update `docs/c.md`.',
    ]);
    const initial = selectReadyPlanningAtoms({ graph: data.graph, parallelism: 2 }).readyAtomIds;
    const failedAtomId = data.graph.edges[0].fromAtomId;
    const blockedAtomId = data.graph.edges[0].toAtomId;
    const independentAtomId = initial.find((atomId) => atomId !== failedAtomId)!;
    const harness = new StubHarness(initial.map((atomId) => ({ resultText: JSON.stringify(atomId === failedAtomId ? { atomId, status: 'failed', aspectUpdates: [], error: 'source too ambiguous' } : completedOutput(data.taskById.get(atomId)!)) })));

    const result = await runPlanningAtomMap({ graph: data.graph, inventory: data.inventory, sourceContent: data.content, cwd: process.cwd(), harness, parallelism: 2 });

    expect(result.mapComplete).toBe(false);
    expect(result.failedAtomIds).toEqual([failedAtomId]);
    expect(result.completedAtomIds).toEqual([independentAtomId]);
    expect(result.blockedAtoms).toEqual([{ atomId: blockedAtomId, blockedByAtomIds: [failedAtomId] }]);
    expect(result.coverage.completeCriteria).toEqual(['ac-003']);
  });

  it('rejects invalid agent outputs before accepting atom completion', async () => {
    const data = fixture(['engine updates `packages/engine/src/a.ts`.']);
    const [task] = data.tasks;
    const harness = new StubHarness([{ resultText: JSON.stringify({ atomId: task.atomId, status: 'completed', aspectUpdates: [{ aspectId: 'ac-999:evidence:missing', status: 'resolved', completedByAtomIds: [task.atomId] }] }) }]);

    const result = await runPlanningAtomMap({ graph: data.graph, inventory: data.inventory, sourceContent: data.content, cwd: process.cwd(), harness });

    expect(result.mapComplete).toBe(false);
    expect(result.failedAtomIds).toEqual([task.atomId]);
    expect(result.validationErrors).toContain('unknown aspect:ac-999:evidence:missing');
    expect(result.validationErrors).toContain(`atom output missing aspect update:${task.atomId}:${task.aspectIds[0]}`);
    expect(result.coverage.incompleteCriteria).toEqual(['ac-001']);
  });

  it('excludes invalid aspect updates from coverage accounting', async () => {
    const data = fixture(['engine updates `packages/engine/src/a.ts`.']);
    const [task] = data.tasks;
    const harness = new StubHarness([{ resultText: JSON.stringify({ atomId: task.atomId, status: 'completed', aspectUpdates: [{ aspectId: task.aspectIds[0], status: 'resolved' }] }) }]);

    const result = await runPlanningAtomMap({ graph: data.graph, inventory: data.inventory, sourceContent: data.content, cwd: process.cwd(), harness });

    expect(result.mapComplete).toBe(false);
    expect(result.failedAtomIds).toEqual([task.atomId]);
    expect(result.validationErrors).toContain(`resolved aspect must cite producing atom:${task.atomId}:${task.aspectIds[0]}`);
    expect(result.coverage.completeCriteria).toEqual([]);
    expect(result.coverage.incompleteCriteria).toEqual(['ac-001']);
    expect(result.outputs[0].aspectUpdates).toEqual([]);
  });

  it('propagates abort errors from atom planners', async () => {
    const data = fixture(['engine updates `packages/engine/src/a.ts`.']);
    const abortError = new Error('cancelled');
    abortError.name = 'AbortError';
    const harness = new StubHarness([{ error: abortError }]);

    await expect(runPlanningAtomMap({ graph: data.graph, inventory: data.inventory, sourceContent: data.content, cwd: process.cwd(), harness })).rejects.toMatchObject({ name: 'AbortError', message: 'cancelled' });
  });

  it('fails closed when materialized source exceeds the atom source budget', async () => {
    const data = fixture(['engine updates `packages/engine/src/a.ts`.']);
    data.graph.atoms[0] = { ...data.graph.atoms[0], sourceSlices: [{ ...data.graph.atoms[0].sourceSlices[0], byteLength: limits.maxPromptSourceBytes + 1 }] };
    const harness = new StubHarness([]);

    const result = await runPlanningAtomMap({ graph: data.graph, inventory: data.inventory, sourceContent: data.content, cwd: process.cwd(), harness });

    expect(result.mapComplete).toBe(false);
    expect(result.failedAtomIds).toEqual([data.graph.atoms[0].atomId]);
    expect(result.validationErrors).toEqual([`atom planner failed:${data.graph.atoms[0].atomId}:declared atom source budget exceeded:${data.graph.atoms[0].atomId}`]);
    expect(harness.calls).toEqual([]);
  });
});

function completionOrder(graph: PlanningAtomGraph): string[] {
  const completed = new Set<string>();
  const order: string[] = [];
  while (true) {
    const ready = selectReadyPlanningAtoms({ graph, completedAtomIds: completed, parallelism: graph.limits.parallelism }).readyAtomIds;
    if (ready.length === 0) return order;
    for (const atomId of ready) { order.push(atomId); completed.add(atomId); }
  }
}

function completedOutput(task: PlanningAtomTask): PlanningAtomOutput {
  return {
    atomId: task.atomId,
    status: 'completed',
    aspectUpdates: task.aspectIds.map((aspectId) => ({ aspectId, status: 'resolved', completedByAtomIds: [task.atomId] })),
    compactHandoff: `completed ${task.atomId}`,
    planFragments: [{ fragmentId: `fragment-${task.atomId}`, title: task.title, criterionIds: task.criterionIds, aspectIds: task.aspectIds, markdown: `Plan ${task.title}.` }],
    moduleCandidates: [{ moduleId: `module-${task.atomId}`, title: task.title, criterionIds: task.criterionIds, aspectIds: task.aspectIds, description: `Implement ${task.title}.`, validationExpectation: 'Relevant checks pass.' }],
  };
}
