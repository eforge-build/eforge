import { describe, expect, it } from 'vitest';
import { safeParseEforgeEvent, type EforgeEvent, type PlanningDecompositionLimits, type PlanningReduceLimits } from '@eforge-build/client';
import {
  buildPlanningAtomTasks,
  buildPlanningReduceTree,
  derivePlanningAtomGraph,
  deriveSourceInventory,
  runPlanningAtomMap,
  runPlanningReduce,
  selectReadyPlanningAtoms,
  type PlanningAtomGraph,
  type PlanningAtomOutput,
  type PlanningAtomTask,
  type PlanningReduceNode,
  type PlanningReduceOutput,
} from '@eforge-build/engine/planner-compiler';
import { StubHarness } from './stub-harness.js';

const atomLimits: PlanningDecompositionLimits = { parallelism: 2, maxDepth: 3, maxPromptSourceBytes: 1_000, maxPromptBytes: 20_000, maxObservedInputTokens: 50_000, maxObservedTurns: 10, maxCompactHandoffBytes: 8_000, maxLocalExplorationToolUses: 8, maxCriteriaPerUnit: 1, maxSubsystemsPerUnit: 2, maxSplitAttemptsPerUnit: 2 };
const reduceLimits: PlanningReduceLimits = { maxInputsPerReduce: 2, maxReduceDepth: 4, maxReducePromptBytes: 50_000, maxReduceSummaryBytes: 8_000 };
const hash = (value: string) => `h${value.length}`.padEnd(64, '0');

function prd(criteria: string[]): string {
  return ['# Map Reduce Events', '', '## Acceptance Criteria', ...criteria.map((criterion) => `- ${criterion}`)].join('\n');
}

function fixture(criteria: string[]) {
  const content = prd(criteria);
  const inventory = deriveSourceInventory({ content, hash: hash(content), path: 'mr.md' });
  const graph = derivePlanningAtomGraph({ content, hash: hash(content), path: 'mr.md', limits: atomLimits, inventory });
  const tasks = buildPlanningAtomTasks({ graph, inventory });
  return { content, inventory, graph, tasks, taskById: new Map(tasks.map((task) => [task.atomId, task])) };
}

const isMapReduce = (event: EforgeEvent) => event.type.startsWith('planning:map-reduce:');

describe('planning map/reduce orchestration events', () => {
  it('emits an atoms snapshot followed by per-atom running and terminal status events', async () => {
    const data = fixture([
      'engine updates `packages/engine/src/a.ts`.',
      'client updates `packages/client/src/b.ts` after ac-001.',
      'docs update `docs/c.md`.',
    ]);
    const order = completionOrder(data.graph);
    const live: EforgeEvent[] = [];
    const harness = new StubHarness(order.map((atomId) => atomSubmission(completedOutput(data.taskById.get(atomId)!))));

    const result = await runPlanningAtomMap({ graph: data.graph, inventory: data.inventory, sourceContent: data.content, cwd: process.cwd(), harness, parallelism: 2, onEvent: (event) => live.push(event) });

    const mr = result.events.filter(isMapReduce);
    const snapshot = mr[0];
    expect(snapshot.type).toBe('planning:map-reduce:atoms');
    if (snapshot.type !== 'planning:map-reduce:atoms') throw new Error('unreachable');
    expect(snapshot.atomCount).toBe(data.graph.atoms.length);
    expect(snapshot.edgeCount).toBe(data.graph.edges.length);
    expect(snapshot.atoms.map((atom) => atom.atomId).sort()).toEqual(data.graph.atoms.map((atom) => atom.atomId).sort());

    // dependencyAtomIds reflect the graph edges (toAtomId depends on fromAtomId).
    const edge = data.graph.edges[0];
    const dependent = snapshot.atoms.find((atom) => atom.atomId === edge.toAtomId);
    expect(dependent?.dependencyAtomIds).toContain(edge.fromAtomId);

    // The snapshot precedes every status event.
    expect(mr.slice(1).every((event) => event.type !== 'planning:map-reduce:atoms')).toBe(true);

    // Each atom gets a running then a completed status.
    for (const atomId of data.graph.atoms.map((atom) => atom.atomId)) {
      const statuses = mr.filter((event) => event.type === 'planning:map-reduce:atom:status' && event.atomId === atomId).map((event) => (event as Extract<EforgeEvent, { type: 'planning:map-reduce:atom:status' }>).status);
      expect(statuses).toEqual(['running', 'completed']);
    }

    // Live (onEvent) stream matches the replay (result.events) stream exactly.
    expect(live.filter(isMapReduce)).toEqual(mr);
  });

  it('emits a failed atom status with a reason and keeps the result invariant with or without a sink', async () => {
    const criteria = ['engine updates `packages/engine/src/a.ts`.', 'client updates `packages/client/src/b.ts` after ac-001.', 'docs update `docs/c.md`.'];
    const make = () => {
      const data = fixture(criteria);
      const initial = selectReadyPlanningAtoms({ graph: data.graph, parallelism: 2 }).readyAtomIds;
      const failedAtomId = data.graph.edges[0].fromAtomId;
      const harness = new StubHarness(initial.map((atomId) => atomSubmission(atomId === failedAtomId ? { atomId, status: 'failed', aspectUpdates: [], error: 'source too ambiguous' } : completedOutput(data.taskById.get(atomId)!))));
      return { data, harness, failedAtomId };
    };

    const sunk: EforgeEvent[] = [];
    const a = make();
    const withSink = await runPlanningAtomMap({ graph: a.data.graph, inventory: a.data.inventory, sourceContent: a.data.content, cwd: process.cwd(), harness: a.harness, parallelism: 2, onEvent: (event) => sunk.push(event) });
    const b = make();
    const withoutSink = await runPlanningAtomMap({ graph: b.data.graph, inventory: b.data.inventory, sourceContent: b.data.content, cwd: process.cwd(), harness: b.harness, parallelism: 2 });

    // Non-event result fields are unaffected by whether a sink is wired.
    expect(withoutSink.completedAtomIds).toEqual(withSink.completedAtomIds);
    expect(withoutSink.failedAtomIds).toEqual(withSink.failedAtomIds);
    expect(withoutSink.mapComplete).toBe(withSink.mapComplete);
    // Map/reduce events are present in result.events regardless of the sink.
    expect(withoutSink.events.filter(isMapReduce).map((event) => event.type)).toEqual(withSink.events.filter(isMapReduce).map((event) => event.type));

    const failedStatus = withSink.events.find((event) => event.type === 'planning:map-reduce:atom:status' && event.atomId === a.failedAtomId && event.status === 'failed') as Extract<EforgeEvent, { type: 'planning:map-reduce:atom:status' }> | undefined;
    expect(failedStatus?.reason).toBe('source too ambiguous');
  });

  it('emits a reduce-tree snapshot followed by per-node running and terminal status events', async () => {
    const reduceData = await reduceFixture(['engine updates `packages/engine/src/a.ts`.', 'client updates `packages/client/src/b.ts`.', 'docs update `docs/c.md`.']);
    const tree = buildPlanningReduceTree({ graph: reduceData.graph, mapResult: reduceData.mapResult, limits: reduceLimits });
    const live: EforgeEvent[] = [];
    const harness = new StubHarness(scriptedReduceOutputs(tree, reduceData.mapResult.outputs).map(reduceSubmission));

    const result = await runPlanningReduce({ graph: reduceData.graph, mapResult: reduceData.mapResult, cwd: process.cwd(), harness, limits: reduceLimits, onEvent: (event) => live.push(event) });

    const mr = result.events.filter(isMapReduce);
    const snapshot = mr[0];
    expect(snapshot.type).toBe('planning:map-reduce:reduce-tree');
    if (snapshot.type !== 'planning:map-reduce:reduce-tree') throw new Error('unreachable');
    expect(snapshot.nodeCount).toBe(tree.nodes.length);
    expect(snapshot.rootNodeId).toBe(tree.rootNodeId);
    expect(snapshot.maxDepth).toBe(Math.max(...tree.nodes.map((node) => node.depth)));
    const rootSnapshotNode = snapshot.nodes.find((node) => node.nodeId === tree.rootNodeId);
    const rootTreeNode = tree.nodes.find((node) => node.nodeId === tree.rootNodeId);
    expect(rootSnapshotNode?.inputNodeIds).toEqual(rootTreeNode?.inputNodeIds);

    for (const node of tree.nodes) {
      const statuses = mr.filter((event) => event.type === 'planning:map-reduce:reduce:status' && event.nodeId === node.nodeId).map((event) => (event as Extract<EforgeEvent, { type: 'planning:map-reduce:reduce:status' }>).status);
      expect(statuses).toEqual(['running', 'completed']);
    }

    expect(live.filter(isMapReduce)).toEqual(mr);
  });

  it('produces map/reduce events that round-trip through the client schema', async () => {
    const data = fixture(['engine updates `packages/engine/src/a.ts`.', 'docs update `docs/c.md`.']);
    const order = completionOrder(data.graph);
    const harness = new StubHarness(order.map((atomId) => atomSubmission(completedOutput(data.taskById.get(atomId)!))));
    const result = await runPlanningAtomMap({ graph: data.graph, inventory: data.inventory, sourceContent: data.content, cwd: process.cwd(), harness, parallelism: 2 });

    const mr = result.events.filter(isMapReduce);
    expect(mr.length).toBeGreaterThan(0);
    for (const event of mr) {
      expect(safeParseEforgeEvent(event).success).toBe(true);
    }

    // A malformed status value is rejected.
    const bad = { timestamp: new Date().toISOString(), type: 'planning:map-reduce:atom:status', atomId: 'atom-x', status: 'bogus' };
    expect(safeParseEforgeEvent(bad).success).toBe(false);
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

function atomSubmission(output: PlanningAtomOutput | { atomId: string; status: 'failed'; aspectUpdates: []; error: string }) {
  return { toolCalls: [{ tool: 'submit_atom_output', toolUseId: `submit-${output.atomId}`, input: output, output: 'ok' }] };
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

async function reduceFixture(criteria: string[]) {
  const content = prd(criteria);
  const inventory = deriveSourceInventory({ content, hash: hash(content), path: 'mr-reduce.md' });
  const graph = derivePlanningAtomGraph({ content, hash: hash(content), path: 'mr-reduce.md', limits: atomLimits, inventory });
  const tasks = buildPlanningAtomTasks({ graph, inventory });
  const taskById = new Map(tasks.map((task) => [task.atomId, task]));
  const order = completionOrder(graph);
  const harness = new StubHarness(order.map((atomId) => atomSubmission(completedOutput(taskById.get(atomId)!))));
  const mapResult = await runPlanningAtomMap({ graph, inventory, sourceContent: content, cwd: process.cwd(), harness, parallelism: 2 });
  return { graph, inventory, tasks, mapResult };
}

function scriptedReduceOutputs(tree: ReturnType<typeof buildPlanningReduceTree>, atomOutputs: PlanningAtomOutput[]): PlanningReduceOutput[] {
  const outputs: PlanningReduceOutput[] = [];
  for (const node of [...tree.nodes].sort((a, b) => a.depth - b.depth || a.nodeId.localeCompare(b.nodeId))) {
    outputs.push(validReduceOutput(node));
  }
  return outputs;
}

function validReduceOutput(node: PlanningReduceNode): PlanningReduceOutput {
  return {
    nodeId: node.nodeId,
    status: 'completed',
    compactSummary: `Reduced ${node.nodeId}.`,
    planFragments: [{ fragmentId: `fragment-${node.nodeId}`, title: node.nodeId, criterionIds: node.criterionIds, aspectIds: node.aspectIds, markdown: `Reduced plan for ${node.nodeId}.` }],
    moduleCandidates: [{ moduleId: `module-${node.nodeId}`, title: node.nodeId, criterionIds: node.criterionIds, aspectIds: node.aspectIds, description: `Implement reduced work for ${node.nodeId}.`, validationExpectation: 'Reduced validation passes.' }],
    validationStrategy: 'Run relevant validation.',
  };
}

function reduceSubmission(output: PlanningReduceOutput) {
  return { toolCalls: [{ tool: 'submit_reduce_output', toolUseId: `submit-${output.nodeId}`, input: output, output: 'ok' }] };
}
