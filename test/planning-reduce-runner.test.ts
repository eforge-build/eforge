import { describe, expect, it } from 'vitest';
import type { PlanningDecompositionLimits } from '@eforge-build/client';
import { buildPlanningAtomTasks, buildPlanningReduceTask, buildPlanningReduceTree, derivePlanningAtomGraph, deriveSourceInventory, runPlanningReduce, type PlanningAtomMapResult, type PlanningAtomOutput, type PlanningAtomTask, type PlanningReduceLimits, type PlanningReduceNode, type PlanningReduceOutput } from '@eforge-build/engine/planner-compiler';
import { StubHarness } from './stub-harness.js';

const atomLimits: PlanningDecompositionLimits = { parallelism: 2, maxDepth: 3, maxPromptSourceBytes: 1_000, maxPromptBytes: 20_000, maxObservedInputTokens: 50_000, maxObservedTurns: 10, maxCompactHandoffBytes: 8_000, maxLocalExplorationToolUses: 8, maxCriteriaPerUnit: 1, maxSubsystemsPerUnit: 2, maxSplitAttemptsPerUnit: 2 };
const reduceLimits: PlanningReduceLimits = { maxInputsPerReduce: 2, maxReduceDepth: 4, maxReducePromptBytes: 50_000, maxReduceSummaryBytes: 8_000 };
const hash = (value: string) => `h${value.length}`.padEnd(64, '0');

function prd(criteria: string[]): string {
  return ['# Reduce Plan', '', '## Acceptance Criteria', ...criteria.map((criterion) => `- ${criterion}`)].join('\n');
}

function fixture(criteria: string[], mapComplete = true, limits: PlanningDecompositionLimits = atomLimits) {
  const content = prd(criteria);
  const inventory = deriveSourceInventory({ content, hash: hash(content), path: 'reduce.md' });
  const graph = derivePlanningAtomGraph({ content, hash: hash(content), path: 'reduce.md', limits, inventory });
  const tasks = buildPlanningAtomTasks({ graph, inventory });
  const outputs = tasks.map(completedAtomOutput);
  const mapResult: PlanningAtomMapResult = { graphId: graph.graphId, outputs, coverage: completedCoverage(tasks), completedAtomIds: outputs.map((output) => output.atomId).sort(), failedAtomIds: mapComplete ? [] : ['atom-failed'], skippedAtomIds: [], blockedAtoms: [], readyAtomIds: [], mapComplete, validationErrors: [], events: [], iterations: 1 };
  return { graph, inventory, tasks, outputs, mapResult };
}

describe('planning reduce runner', () => {
  it('builds a deterministic bounded reduce tree with criterion and aspect traceability', () => {
    const data = fixture(['engine updates `packages/engine/src/a.ts`.', 'client updates `packages/client/src/b.ts`.', 'docs update `docs/c.md`.', 'test updates `test/d.test.ts`.', 'web updates `web/e.tsx`.']);

    const tree = buildPlanningReduceTree({ graph: data.graph, mapResult: data.mapResult, limits: reduceLimits });

    expect(tree.validationErrors).toEqual([]);
    expect(tree.nodes.every((node) => node.inputAtomIds.length + node.inputNodeIds.length <= 2)).toBe(true);
    expect(tree.nodes.map((node) => node.nodeId)).toEqual(['reduce-000-001', 'reduce-000-002', 'reduce-000-003', 'reduce-001-001', 'reduce-001-002', 'reduce-002-001']);
    expect(tree.nodes.find((node) => node.nodeId === tree.rootNodeId)?.criterionIds).toEqual(['ac-001', 'ac-002', 'ac-003', 'ac-004', 'ac-005']);
    expect(tree.nodes.find((node) => node.nodeId === tree.rootNodeId)?.aspectIds.length).toBeGreaterThan(4);
  });

  it('unions criterion traceability from both plan fragments and module candidates', () => {
    const data = fixture(['engine updates `packages/engine/src/a.ts`.', 'engine updates `packages/engine/src/b.ts`.'], true, { ...atomLimits, maxCriteriaPerUnit: 2 });
    const task = data.tasks[0]!;
    const [fragmentCriterionId, moduleCriterionId] = task.criterionIds as [string, string];
    const fragmentAspectId = task.aspectIds.find((aspectId) => aspectId.startsWith(`${fragmentCriterionId}:`))!;
    const moduleAspectId = task.aspectIds.find((aspectId) => aspectId.startsWith(`${moduleCriterionId}:`))!;
    const output = data.mapResult.outputs[0]!;
    data.mapResult.outputs = [{
      ...output,
      planFragments: [{ fragmentId: `fragment-${task.atomId}-fragment-only`, title: 'Fragment trace', criterionIds: [fragmentCriterionId], aspectIds: [fragmentAspectId], markdown: 'Fragment trace.' }],
      moduleCandidates: [{ moduleId: `module-${task.atomId}-module-only`, title: 'Module trace', criterionIds: [moduleCriterionId], aspectIds: [moduleAspectId], description: 'Module trace.', validationExpectation: 'Module validation passes.' }],
    }];

    const tree = buildPlanningReduceTree({ graph: data.graph, mapResult: data.mapResult, limits: reduceLimits });

    expect(tree.nodes[0]?.criterionIds).toEqual(['ac-001', 'ac-002']);
  });

  it('executes reduce nodes bottom-up and returns a completed root synthesis', async () => {
    const data = fixture(['engine updates `packages/engine/src/a.ts`.', 'client updates `packages/client/src/b.ts`.', 'docs update `docs/c.md`.']);
    const tree = buildPlanningReduceTree({ graph: data.graph, mapResult: data.mapResult, limits: reduceLimits });
    const scripted = scriptedReduceOutputs(tree, data.mapResult.outputs);
    const harness = new StubHarness(scripted.map((output) => ({ resultText: JSON.stringify(output) })));

    const result = await runPlanningReduce({ graph: data.graph, mapResult: data.mapResult, cwd: process.cwd(), harness, limits: reduceLimits, agentOptions: { maxTurns: 3 } });

    expect(result.reduceComplete).toBe(true);
    expect(result.validationErrors).toEqual([]);
    expect(result.rootNodeId).toBe(tree.rootNodeId);
    expect(result.finalOutput?.status).toBe('completed');
    expect(result.iterations).toBe(2);
    expect(harness.calls.every((call) => call.tools === 'none' && call.maxTurns === 3)).toBe(true);
    expect(harness.prompts[0]).toContain('Do not inspect the repository or call tools');
  });

  it('rejects invalid reducer output before accepting completion', async () => {
    const data = fixture(['engine updates `packages/engine/src/a.ts`.']);
    const tree = buildPlanningReduceTree({ graph: data.graph, mapResult: data.mapResult, limits: reduceLimits });
    const node = tree.nodes[0];
    const harness = new StubHarness([{ resultText: JSON.stringify({ nodeId: node.nodeId, status: 'completed', compactSummary: 'bad', planFragments: [{ fragmentId: 'fragment-bad', title: 'Bad', criterionIds: ['ac-001'], aspectIds: ['ac-999:missing'], markdown: 'Bad.' }] }) }]);

    const result = await runPlanningReduce({ graph: data.graph, mapResult: data.mapResult, cwd: process.cwd(), harness, limits: reduceLimits });

    expect(result.reduceComplete).toBe(false);
    expect(result.outputs).toEqual([{ nodeId: node.nodeId, status: 'failed', compactSummary: '', error: 'invalid reduce output:unknown aspect for reduce output:fragment-bad:ac-999:missing' }]);
    expect(result.validationErrors).toEqual(['unknown aspect for reduce output:fragment-bad:ac-999:missing']);
  });

  it('fails closed when reducer summaries exceed budget', async () => {
    const data = fixture(['engine updates `packages/engine/src/a.ts`.']);
    const tree = buildPlanningReduceTree({ graph: data.graph, mapResult: data.mapResult, limits: { ...reduceLimits, maxReduceSummaryBytes: 8 } });
    const node = tree.nodes[0];
    const harness = new StubHarness([{ resultText: JSON.stringify({ nodeId: node.nodeId, status: 'completed', compactSummary: 'this summary is too long' }) }]);

    const result = await runPlanningReduce({ graph: data.graph, mapResult: data.mapResult, cwd: process.cwd(), harness, limits: { ...reduceLimits, maxReduceSummaryBytes: 8 } });

    expect(result.reduceComplete).toBe(false);
    expect(result.validationErrors).toEqual([`reduce summary budget exceeded:${node.nodeId}`]);
  });

  it('propagates conflicts and gaps while incomplete map results prevent fake success', async () => {
    const data = fixture(['engine updates `packages/engine/src/a.ts`.'], false);
    const node = buildPlanningReduceTree({ graph: data.graph, mapResult: data.mapResult, limits: reduceLimits }).nodes[0];
    const task = buildPlanningReduceTask(buildPlanningReduceTree({ graph: data.graph, mapResult: data.mapResult, limits: reduceLimits }), node, data.mapResult.outputs, []);
    const harness = new StubHarness([{ resultText: JSON.stringify(validReduceOutput(task.node, { gap: true, status: 'incomplete' })) }]);

    const result = await runPlanningReduce({ graph: data.graph, mapResult: data.mapResult, cwd: process.cwd(), harness, limits: reduceLimits });

    expect(result.reduceComplete).toBe(false);
    expect(result.validationErrors).toEqual(['map result incomplete']);
    expect(result.gaps.map((gap) => gap.gapId)).toEqual([`gap-${node.nodeId}`]);
  });

  it('propagates abort errors from reducer agents', async () => {
    const data = fixture(['engine updates `packages/engine/src/a.ts`.']);
    const abortError = new Error('cancelled');
    abortError.name = 'AbortError';
    const harness = new StubHarness([{ error: abortError }]);

    await expect(runPlanningReduce({ graph: data.graph, mapResult: data.mapResult, cwd: process.cwd(), harness, limits: reduceLimits })).rejects.toMatchObject({ name: 'AbortError', message: 'cancelled' });
  });
});

function scriptedReduceOutputs(tree: ReturnType<typeof buildPlanningReduceTree>, atomOutputs: PlanningAtomOutput[]): PlanningReduceOutput[] {
  const outputs: PlanningReduceOutput[] = [];
  for (const node of [...tree.nodes].sort((a, b) => a.depth - b.depth || a.nodeId.localeCompare(b.nodeId))) {
    const task = buildPlanningReduceTask(tree, node, atomOutputs.filter((output) => node.inputAtomIds.includes(output.atomId)), outputs.filter((output) => node.inputNodeIds.includes(output.nodeId)));
    outputs.push(validReduceOutput(task.node));
  }
  return outputs;
}

function validReduceOutput(node: PlanningReduceNode, options: { gap?: boolean; status?: PlanningReduceOutput['status'] } = {}): PlanningReduceOutput {
  const fragmentId = `fragment-${node.nodeId}`;
  return {
    nodeId: node.nodeId,
    status: options.status ?? 'completed',
    compactSummary: `Reduced ${node.nodeId}.`,
    planFragments: [{ fragmentId, title: node.nodeId, criterionIds: node.criterionIds, aspectIds: node.aspectIds, markdown: `Reduced plan for ${node.nodeId}.` }],
    moduleCandidates: [{ moduleId: `module-${node.nodeId}`, title: node.nodeId, criterionIds: node.criterionIds, aspectIds: node.aspectIds, description: `Implement reduced work for ${node.nodeId}.`, validationExpectation: 'Reduced validation passes.' }],
    ...(options.gap ? { gaps: [{ gapId: `gap-${node.nodeId}`, title: 'Gap', criterionIds: node.criterionIds, aspectIds: node.aspectIds, description: 'Gap requires representation.', representationRequired: true }] } : {}),
    validationStrategy: 'Run relevant validation.',
  };
}

function completedAtomOutput(task: PlanningAtomTask): PlanningAtomOutput {
  return { atomId: task.atomId, status: 'completed', aspectUpdates: task.aspectIds.map((aspectId) => ({ aspectId, status: 'resolved', completedByAtomIds: [task.atomId] })), compactHandoff: `completed ${task.atomId}`, planFragments: [{ fragmentId: `fragment-${task.atomId}`, title: task.title, criterionIds: task.criterionIds, aspectIds: task.aspectIds, markdown: `Plan ${task.title}.` }], moduleCandidates: [{ moduleId: `module-${task.atomId}`, title: task.title, criterionIds: task.criterionIds, aspectIds: task.aspectIds, description: `Implement ${task.title}.`, validationExpectation: 'Relevant checks pass.' }] };
}

function completedCoverage(tasks: PlanningAtomTask[]): PlanningAtomMapResult['coverage'] {
  const criteria = [...new Set(tasks.flatMap((task) => task.criterionIds))].sort();
  return { totalCriteria: criteria.length, completeCriteria: criteria, incompleteCriteria: [], rawCriterionCoverage: criteria.map((criterionId) => ({ criterionId, coveredByAtomIds: tasks.filter((task) => task.criterionIds.includes(criterionId)).map((task) => task.atomId) })), aspects: [], criteria: [], coverageByAtom: {}, validationErrors: [] };
}
