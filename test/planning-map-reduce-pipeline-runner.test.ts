import { describe, expect, it } from 'vitest';
import type { PlanningDecompositionLimits } from '@eforge-build/client';
import type { AgentHarness, AgentRunOptions } from '@eforge-build/engine/harness';
import type { AgentRole, EforgeEvent } from '@eforge-build/engine/events';
import { buildPlanningAtomTasks, buildPlanningReduceTask, buildPlanningReduceTreeFromAtomTasks, derivePlanningAtomGraph, deriveSharedPlanningBrief, deriveSourceInventory, planPromptSafeReduceTreeFromTasks, runPlanningMapReducePipeline, type PlanningAtomOutput, type PlanningAtomTask, type PlanningReduceNode, type PlanningReduceOutput } from '@eforge-build/engine/planner-compiler';

const atomLimits: PlanningDecompositionLimits = { parallelism: 2, maxDepth: 3, maxPromptSourceBytes: 1_000, maxPromptBytes: 20_000, maxObservedInputTokens: 50_000, maxObservedTurns: 10, maxCompactHandoffBytes: 8_000, maxLocalExplorationToolUses: 8, maxCriteriaPerUnit: 1, maxSubsystemsPerUnit: 2, maxSplitAttemptsPerUnit: 2 };
const reduceLimits = { maxInputsPerReduce: 2, maxReduceDepth: 4, maxReducePromptBytes: 50_000, maxReduceSummaryBytes: 8_000 };
const constrainedPromptBudget = 24_000;
const hash = (value: string) => `h${value.length}`.padEnd(64, '0');

function prd(criteria: string[]): string {
  return ['# Pipeline Scheduler', '', '## Acceptance Criteria', ...criteria.map((criterion) => `- ${criterion}`)].join('\n');
}

function fixture(criteria: string[], options: { sharedBrief?: boolean; limits?: PlanningDecompositionLimits } = {}) {
  const content = prd(criteria);
  const inventory = deriveSourceInventory({ content, hash: hash(content), path: 'pipeline.md' });
  const graph = derivePlanningAtomGraph({ content, hash: hash(content), path: 'pipeline.md', limits: options.limits ?? atomLimits, inventory });
  const sharedBrief = options.sharedBrief ? deriveSharedPlanningBrief({ graph }) : undefined;
  const tasks = buildPlanningAtomTasks({ graph, inventory, ...(sharedBrief ? { sharedBrief } : {}) });
  const tree = buildPlanningReduceTreeFromAtomTasks({ graph, tasks, limits: reduceLimits });
  return { content, inventory, graph, sharedBrief, tasks, tree, taskById: new Map(tasks.map((task) => [task.atomId, task])) };
}

describe('planning map/reduce pipeline runner', () => {
  it('starts an eligible depth-0 reducer before unrelated atoms globally complete', async () => {
    const data = fixture(['engine updates `packages/engine/src/a.ts`.', 'client updates `packages/client/src/b.ts`.', 'docs update `docs/c.md`.']);
    const firstReducer = data.tree.nodes.find((node) => node.depth === 0 && node.inputAtomIds.length === 2)!;
    const outputs = new Map<string, unknown>([
      ...data.tasks.map((task) => [task.atomId, completedAtomOutput(task)] as const),
      ...scriptedReduceOutputs(data.tree, data.tasks.map(completedAtomOutput)).map((output) => [output.nodeId, output] as const),
    ]);
    const harness = new GateHarness(outputs);
    const live: EforgeEvent[] = [];

    const promise = runPlanningMapReducePipeline({ graph: data.graph, inventory: data.inventory, sourceContent: data.content, cwd: process.cwd(), harness, reduceLimits, parallelism: 2, onEvent: (event) => live.push(event) });
    await harness.waitForStarted(firstReducer.inputAtomIds[0]!);
    await harness.waitForStarted(firstReducer.inputAtomIds[1]!);
    harness.release(firstReducer.inputAtomIds[0]!);
    harness.release(firstReducer.inputAtomIds[1]!);
    await harness.waitForStarted(firstReducer.nodeId);
    harness.releaseAll();
    const result = await promise;

    const statuses = live.filter((event) => event.type === 'planning:map-reduce:atom:status' || event.type === 'planning:map-reduce:reduce:status');
    const reducerRunning = statuses.findIndex((event) => event.type === 'planning:map-reduce:reduce:status' && event.nodeId === firstReducer.nodeId && event.status === 'running');
    const lastAtomCompleted = Math.max(...data.graph.atoms.map((atom) => statuses.findIndex((event) => event.type === 'planning:map-reduce:atom:status' && event.atomId === atom.atomId && event.status === 'completed')));
    expect(reducerRunning).toBeGreaterThan(-1);
    expect(reducerRunning).toBeLessThan(lastAtomCompleted);
    expect(result.map.mapComplete).toBe(true);
    expect(result.reduce.reduceComplete).toBe(true);
  });

  it('starts a parent reducer as soon as its children complete', async () => {
    const data = fixture(Array.from({ length: 5 }, (_, index) => `work item ${index + 1} updates packages/engine/src/file-${index + 1}.ts.`));
    const root = data.tree.nodes.find((node) => node.nodeId === data.tree.rootNodeId)!;
    const outputs = new Map<string, unknown>([
      ...data.tasks.map((task) => [task.atomId, completedAtomOutput(task)] as const),
      ...scriptedReduceOutputs(data.tree, data.tasks.map(completedAtomOutput)).map((output) => [output.nodeId, output] as const),
    ]);
    const harness = new GateHarness(outputs);
    const live: EforgeEvent[] = [];

    const promise = runPlanningMapReducePipeline({ graph: data.graph, inventory: data.inventory, sourceContent: data.content, cwd: process.cwd(), harness, reduceLimits, parallelism: 3, onEvent: (event) => live.push(event) });
    harness.releaseAll();
    const result = await promise;

    const rootRunning = live.findIndex((event) => event.type === 'planning:map-reduce:reduce:status' && event.nodeId === root.nodeId && event.status === 'running');
    const childCompleted = root.inputNodeIds.map((nodeId) => live.findIndex((event) => event.type === 'planning:map-reduce:reduce:status' && event.nodeId === nodeId && event.status === 'completed'));
    expect(rootRunning).toBeGreaterThan(Math.max(...childCompleted));
    expect(result.reduce.reduceComplete).toBe(true);
  });

  it('starts a non-root parent reducer before unrelated atoms complete', async () => {
    const data = fixture(Array.from({ length: 5 }, (_, index) => `work item ${index + 1} updates packages/engine/src/file-${index + 1}.ts.`));
    const parent = data.tree.nodes.find((node) => node.depth === 1 && node.inputNodeIds.length === 2)!;
    const childAtomIds = parent.inputNodeIds.flatMap((nodeId) => data.tree.nodes.find((node) => node.nodeId === nodeId)?.inputAtomIds ?? []);
    const unrelatedAtomId = data.tasks.map((task) => task.atomId).find((atomId) => !childAtomIds.includes(atomId))!;
    const atomOutputs = data.tasks.map((task) => completedAtomOutput(task));
    const outputs = new Map<string, unknown>([
      ...atomOutputs.map((output) => [output.atomId, output] as const),
      ...scriptedReduceOutputs(data.tree, atomOutputs).map((output) => [output.nodeId, output] as const),
    ]);
    const harness = new GateHarness(outputs);
    const live: EforgeEvent[] = [];

    const promise = runPlanningMapReducePipeline({ graph: data.graph, inventory: data.inventory, sourceContent: data.content, cwd: process.cwd(), harness, reduceLimits, parallelism: 3, onEvent: (event) => live.push(event) });
    await Promise.all(childAtomIds.slice(0, 3).map((atomId) => harness.waitForStarted(atomId)));
    for (const atomId of childAtomIds) harness.release(atomId);
    await Promise.all(parent.inputNodeIds.map((nodeId) => harness.waitForStarted(nodeId)));
    await harness.waitForStarted(unrelatedAtomId);
    for (const nodeId of parent.inputNodeIds) harness.release(nodeId);
    await harness.waitForStarted(parent.nodeId);
    harness.releaseAll();
    const result = await promise;

    const parentRunning = live.findIndex((event) => event.type === 'planning:map-reduce:reduce:status' && event.nodeId === parent.nodeId && event.status === 'running');
    const unrelatedCompleted = live.findIndex((event) => event.type === 'planning:map-reduce:atom:status' && event.atomId === unrelatedAtomId && event.status === 'completed');
    expect(parentRunning).toBeGreaterThan(-1);
    expect(parentRunning).toBeLessThan(unrelatedCompleted);
    expect(result.reduce.reduceComplete).toBe(true);
  });

  it('cancels running atoms and reducers after an atom failure', async () => {
    const data = fixture(Array.from({ length: 4 }, (_, index) => `work item ${index + 1} updates packages/engine/src/file-${index + 1}.ts.`));
    const firstReducer = data.tree.nodes.find((node) => node.depth === 0 && node.inputAtomIds.length === 2)!;
    const siblingAtomIds = data.tasks.map((task) => task.atomId).filter((atomId) => !firstReducer.inputAtomIds.includes(atomId));
    const runningAtomId = siblingAtomIds[0]!;
    const failingAtomId = siblingAtomIds[1]!;
    const atomOutputs = data.tasks.map((task) => task.atomId === failingAtomId ? { atomId: task.atomId, status: 'failed', aspectUpdates: [], error: 'boom' } : completedAtomOutput(task));
    const outputs = new Map<string, unknown>([
      ...atomOutputs.map((output) => [output.atomId, output] as const),
      ...scriptedReduceOutputs(data.tree, atomOutputs.filter((output): output is PlanningAtomOutput => output.status === 'completed')).map((output) => [output.nodeId, output] as const),
    ]);
    const harness = new GateHarness(outputs);
    const live: EforgeEvent[] = [];

    const promise = runPlanningMapReducePipeline({ graph: data.graph, inventory: data.inventory, sourceContent: data.content, cwd: process.cwd(), harness, reduceLimits, parallelism: 3, onEvent: (event) => live.push(event) });
    await Promise.all(firstReducer.inputAtomIds.map((atomId) => harness.waitForStarted(atomId)));
    await harness.waitForStarted(runningAtomId);
    for (const atomId of firstReducer.inputAtomIds) harness.release(atomId);
    await harness.waitForStarted(firstReducer.nodeId);
    await harness.waitForStarted(failingAtomId);
    harness.release(failingAtomId);
    const result = await promise;

    expect(result.map.failedAtomIds).toEqual(expect.arrayContaining([failingAtomId, runningAtomId]));
    expect(live).toContainEqual(expect.objectContaining({ type: 'planning:map-reduce:atom:status', atomId: runningAtomId, status: 'failed' }));
    expect(live).toContainEqual(expect.objectContaining({ type: 'planning:map-reduce:reduce:status', nodeId: firstReducer.nodeId, status: 'failed' }));
    expect(result.reduce.outputs.some((output) => output.status === 'incomplete' && output.error?.includes('incomplete child'))).toBe(true);
    expect(result.reduce.outputs.some((output) => output.status === 'incomplete' && output.error?.includes('incomplete atom'))).toBe(true);
  });

  it('cancels running atoms and parent reducers after a reducer failure', async () => {
    const data = fixture(Array.from({ length: 4 }, (_, index) => `work item ${index + 1} updates packages/engine/src/file-${index + 1}.ts.`));
    const failingReducer = data.tree.nodes.find((node) => node.depth === 0 && node.inputAtomIds.length === 2)!;
    const root = data.tree.nodes.find((node) => node.nodeId === data.tree.rootNodeId)!;
    const runningAtomId = data.tasks.map((task) => task.atomId).find((atomId) => !failingReducer.inputAtomIds.includes(atomId))!;
    const atomOutputs = data.tasks.map((task) => completedAtomOutput(task));
    const reduceOutputs = scriptedReduceOutputs(data.tree, atomOutputs).map((output) => output.nodeId === failingReducer.nodeId ? { nodeId: output.nodeId, status: 'failed' as const, compactSummary: '', error: 'reducer boom' } : output);
    const outputs = new Map<string, unknown>([
      ...atomOutputs.map((output) => [output.atomId, output] as const),
      ...reduceOutputs.map((output) => [output.nodeId, output] as const),
    ]);
    const harness = new GateHarness(outputs);
    const live: EforgeEvent[] = [];

    const promise = runPlanningMapReducePipeline({ graph: data.graph, inventory: data.inventory, sourceContent: data.content, cwd: process.cwd(), harness, reduceLimits, parallelism: 3, onEvent: (event) => live.push(event) });
    await Promise.all(failingReducer.inputAtomIds.map((atomId) => harness.waitForStarted(atomId)));
    await harness.waitForStarted(runningAtomId);
    for (const atomId of failingReducer.inputAtomIds) harness.release(atomId);
    await harness.waitForStarted(failingReducer.nodeId);
    harness.release(failingReducer.nodeId);
    const result = await promise;

    expect(result.map.failedAtomIds).toContain(runningAtomId);
    expect(live).toContainEqual(expect.objectContaining({ type: 'planning:map-reduce:atom:status', atomId: runningAtomId, status: 'failed' }));
    expect(result.reduce.outputs).toContainEqual(expect.objectContaining({ nodeId: failingReducer.nodeId, status: 'failed', error: 'reducer boom' }));
    expect(result.reduce.outputs).toContainEqual(expect.objectContaining({ nodeId: root.nodeId, status: 'incomplete', error: expect.stringContaining('incomplete child') }));
    expect(result.reduce.reduceComplete).toBe(false);
  });

  it('blocks dependent reducers after a skipped atom output', async () => {
    const data = fixture(Array.from({ length: 3 }, (_, index) => `work item ${index + 1} updates packages/engine/src/file-${index + 1}.ts.`));
    const skippedTask = data.tasks[0]!;
    const dependentReducer = data.tree.nodes.find((node) => node.inputAtomIds.includes(skippedTask.atomId))!;
    const atomOutputs = data.tasks.map((task) => task.atomId === skippedTask.atomId ? skippedAtomOutput(task) : completedAtomOutput(task));
    const outputs = new Map<string, unknown>([
      ...atomOutputs.map((output) => [output.atomId, output] as const),
      ...scriptedReduceOutputs(data.tree, atomOutputs.filter((output): output is PlanningAtomOutput => output.status === 'completed')).map((output) => [output.nodeId, output] as const),
    ]);
    const harness = new GateHarness(outputs);

    const promise = runPlanningMapReducePipeline({ graph: data.graph, inventory: data.inventory, sourceContent: data.content, cwd: process.cwd(), harness, reduceLimits, parallelism: 2 });
    await harness.waitForStarted(skippedTask.atomId);
    harness.release(skippedTask.atomId);
    const result = await promise;

    expect(result.map.skippedAtomIds).toEqual([skippedTask.atomId]);
    expect(result.map.mapComplete).toBe(false);
    expect(harness.prompts.some((call) => call.planId === dependentReducer.nodeId)).toBe(false);
    expect(result.reduce.outputs).toContainEqual(expect.objectContaining({ nodeId: dependentReducer.nodeId, status: 'incomplete', error: expect.stringContaining(`incomplete atom:${skippedTask.atomId}`) }));
    expect(result.reduce.validationErrors).toContain('map result incomplete');
    expect(result.reduce.reduceComplete).toBe(false);
  });

  it('does not invoke a reducer when launch-time prompt validation exceeds budget', async () => {
    const limits = { ...reduceLimits, maxReducePromptBytes: 5_400 };
    const data = fixture(['engine updates `packages/engine/src/a.ts`.', 'client updates `packages/client/src/b.ts`.']);
    const reducer = data.tree.nodes[0]!;
    const atomOutputs = data.tasks.map((task) => completedAtomOutputWithLargeReducerDigest(task));
    const outputs = new Map<string, unknown>([
      ...atomOutputs.map((output) => [output.atomId, output] as const),
      [reducer.nodeId, validReduceOutput(reducer)] as const,
    ]);
    const harness = new GateHarness(outputs);

    const promise = runPlanningMapReducePipeline({ graph: data.graph, inventory: data.inventory, sourceContent: data.content, cwd: process.cwd(), harness, reduceLimits: limits, parallelism: 2 });
    harness.releaseAll();
    const result = await promise;

    expect(harness.prompts.some((call) => call.planId === reducer.nodeId)).toBe(false);
    expect(result.reduce.outputs).toContainEqual(expect.objectContaining({ nodeId: reducer.nodeId, status: 'failed', error: expect.stringContaining('invalid reduce prompt:reduce prompt budget exceeded') }));
    expect(result.reduce.validationErrors).toContain(`reduce prompt budget exceeded:${reducer.nodeId}`);
    expect(result.reduce.reduceComplete).toBe(false);
  });

  it('does not exceed global atom and reducer scheduler capacity', async () => {
    const data = fixture(Array.from({ length: 4 }, (_, index) => `work item ${index + 1} updates packages/engine/src/file-${index + 1}.ts.`));
    const atomOutputs = data.tasks.map((task) => completedAtomOutput(task));
    const outputs = new Map<string, unknown>([
      ...atomOutputs.map((output) => [output.atomId, output] as const),
      ...scriptedReduceOutputs(data.tree, atomOutputs).map((output) => [output.nodeId, output] as const),
    ]);
    const harness = new GateHarness(outputs);

    const promise = runPlanningMapReducePipeline({ graph: data.graph, inventory: data.inventory, sourceContent: data.content, cwd: process.cwd(), harness, reduceLimits, parallelism: 2 });
    harness.releaseAll();
    await expect(promise).resolves.toMatchObject({ reduce: { reduceComplete: true } });

    expect(harness.maxActive).toBeLessThanOrEqual(2);
  });


  it('waits for primary shared evidence owners before starting consumer atoms', async () => {
    const data = fixture([
      'engine updates `packages/engine/src/shared.ts` for one aspect.',
      'engine validates `packages/engine/src/shared.ts` for another aspect.',
      'engine updates `packages/engine/src/independent.ts` independently.',
    ], { sharedBrief: true });
    const primaryTask = data.tasks.find((task) => task.sharedBrief?.ownedEvidencePaths.includes('packages/engine/src/shared.ts'))!;
    const consumerTask = data.tasks.find((task) => task.sharedBrief?.sharedEvidenceRefs.some((ref) => ref.path === 'packages/engine/src/shared.ts'))!;
    const independentTask = data.tasks.find((task) => task.atomId !== primaryTask.atomId && task.atomId !== consumerTask.atomId)!;
    const finding = { findingId: 'finding-shared-ts', sourceAtomId: primaryTask.atomId, evidencePath: 'packages/engine/src/shared.ts', aspectIds: primaryTask.aspectIds, summary: 'Shared file exports the bounded planner contract.', byteLength: 48 };
    const atomOutputs = data.tasks.map((task) => completedAtomOutput(task, task.atomId === primaryTask.atomId ? { sharedFindings: [finding] } : {}));
    const outputs = new Map<string, unknown>([
      ...atomOutputs.map((output) => [output.atomId, output] as const),
      ...scriptedReduceOutputs(data.tree, atomOutputs).map((output) => [output.nodeId, output] as const),
    ]);
    const harness = new GateHarness(outputs);
    const live: EforgeEvent[] = [];

    const promise = runPlanningMapReducePipeline({ graph: data.graph, inventory: data.inventory, sharedBrief: data.sharedBrief, sourceContent: data.content, cwd: process.cwd(), harness, reduceLimits, parallelism: 2, onEvent: (event) => live.push(event) });
    await harness.waitForStarted(primaryTask.atomId);
    await harness.waitForStarted(independentTask.atomId);
    harness.release(independentTask.atomId);
    harness.release(primaryTask.atomId);
    await harness.waitForStarted(consumerTask.atomId);
    harness.releaseAll();
    const result = await promise;

    const atomStatuses = live.filter((event) => event.type === 'planning:map-reduce:atom:status');
    const primaryCompleted = atomStatuses.findIndex((event) => event.atomId === primaryTask.atomId && event.status === 'completed');
    const consumerRunning = atomStatuses.findIndex((event) => event.atomId === consumerTask.atomId && event.status === 'running');
    expect(primaryCompleted).toBeGreaterThan(-1);
    expect(consumerRunning).toBeGreaterThan(primaryCompleted);
    expect(result.map.sharedFindings).toEqual([finding]);
    expect(result.map.mapComplete).toBe(true);
  });

  it('performs a deterministic passthrough reduce for a single clean digest-bearing atom', async () => {
    const data = fixture(['engine updates `packages/engine/src/a.ts`.']);
    const root = data.tree.nodes[0]!;
    const task = data.tasks[0]!;
    const atomOutput = completedAtomOutput(task, { reduceDigest: atomDigest(task) });
    const harness = new GateHarness(new Map<string, unknown>([[task.atomId, atomOutput]]));

    const promise = runPlanningMapReducePipeline({ graph: data.graph, inventory: data.inventory, sourceContent: data.content, cwd: process.cwd(), harness, reduceLimits, parallelism: 2 });
    harness.releaseAll();
    const result = await promise;

    expect(harness.prompts.some((call) => call.planId === root.nodeId)).toBe(false);
    expect(result.reduce.finalOutput).toMatchObject({ nodeId: root.nodeId, status: 'completed' });
    expect(result.reduce.finalOutput?.reduceDigest).toMatchObject({ sourceId: root.nodeId, sourceKind: 'reduce' });
    expect(result.reduce.finalOutput?.moduleCandidates).toEqual(atomOutput.moduleCandidates);
    expect(result.reduce.finalOutput?.planFragments).toEqual(atomOutput.planFragments);
    expect(result.reduce.reduceComplete).toBe(true);
    expect(result.map.mapComplete).toBe(true);
  });

  it('invokes the reducer agent when the single atom digest reports issues', async () => {
    const data = fixture(['engine updates `packages/engine/src/a.ts`.']);
    const root = data.tree.nodes[0]!;
    const task = data.tasks[0]!;
    const issue = { issueId: 'issue-conflict', kind: 'conflict' as const, title: 'Ownership conflict', summary: 'Two fragments claim the same file.', criterionIds: task.criterionIds, aspectIds: task.aspectIds };
    const atomOutput = completedAtomOutput(task, { reduceDigest: { ...atomDigest(task), issues: [issue] } });
    const harness = new GateHarness(new Map<string, unknown>([[task.atomId, atomOutput], [root.nodeId, validReduceOutput(root)]]));

    const promise = runPlanningMapReducePipeline({ graph: data.graph, inventory: data.inventory, sourceContent: data.content, cwd: process.cwd(), harness, reduceLimits, parallelism: 2 });
    harness.releaseAll();
    const result = await promise;

    expect(harness.prompts.some((call) => call.planId === root.nodeId)).toBe(true);
    expect(result.reduce.reduceComplete).toBe(true);
  });

  it('invokes the reducer agent when the single atom output has no reduce digest', async () => {
    const data = fixture(['engine updates `packages/engine/src/a.ts`.']);
    const root = data.tree.nodes[0]!;
    const task = data.tasks[0]!;
    const atomOutput = completedAtomOutput(task);
    const harness = new GateHarness(new Map<string, unknown>([[task.atomId, atomOutput], [root.nodeId, validReduceOutput(root)]]));

    const promise = runPlanningMapReducePipeline({ graph: data.graph, inventory: data.inventory, sourceContent: data.content, cwd: process.cwd(), harness, reduceLimits, parallelism: 2 });
    harness.releaseAll();
    const result = await promise;

    expect(harness.prompts.some((call) => call.planId === root.nodeId)).toBe(true);
    expect(result.reduce.reduceComplete).toBe(true);
  });

  it('uses an upfront prompt-safe tree and keeps launched reducer prompts within budget', async () => {
    const data = fixture(Array.from({ length: 14 }, (_, index) => `general work item ${index + 1} updates packages/engine/src/file-${index + 1}.ts.`));
    const limits = { ...reduceLimits, maxInputsPerReduce: 4, maxReducePromptBytes: constrainedPromptBudget };
    const planned = planPromptSafeReduceTreeFromTasks({ graph: data.graph, tasks: data.tasks, limits });
    const atomOutputs = data.tasks.map((task) => completedAtomOutput(task));
    const outputs = new Map<string, unknown>([
      ...atomOutputs.map((output) => [output.atomId, output] as const),
      ...scriptedReduceOutputs(planned.tree, atomOutputs).map((output) => [output.nodeId, output] as const),
    ]);
    const harness = new GateHarness(outputs);

    const promise = runPlanningMapReducePipeline({ graph: data.graph, inventory: data.inventory, sourceContent: data.content, cwd: process.cwd(), harness, reduceLimits: limits, parallelism: 4 });
    harness.releaseAll();
    const result = await promise;

    expect(planned.ok).toBe(true);
    const reducerPrompts = harness.prompts.filter((call) => call.planId?.startsWith('reduce-'));
    expect(result.reduce.tree.nodes.map((node) => node.nodeId)).toEqual(planned.tree.nodes.map((node) => node.nodeId));
    expect(result.reduce.reduceComplete).toBe(true);
    expect(reducerPrompts).toHaveLength(result.reduce.tree.nodes.length);
    expect(reducerPrompts.map((call) => call.planId).sort()).toEqual(result.reduce.tree.nodes.map((node) => node.nodeId).sort());
    expect(reducerPrompts.every((call) => Buffer.byteLength(call.prompt, 'utf8') <= constrainedPromptBudget)).toBe(true);
  });
});

class GateHarness implements AgentHarness {
  private readonly started = new Map<string, Deferred<void>>();
  private readonly releases = new Map<string, Deferred<void>>();

  readonly prompts: Array<{ planId?: string; prompt: string }> = [];
  active = 0;
  maxActive = 0;

  constructor(private readonly outputs: Map<string, unknown>) {}

  effectiveCustomToolName(name: string): string { return name; }

  async waitForStarted(planId: string): Promise<void> { await this.deferred(this.started, planId).promise; }
  release(planId: string): void { this.deferred(this.releases, planId).resolve(); }
  releaseAll(): void { for (const key of this.outputs.keys()) this.release(key); }

  async *run(options: AgentRunOptions, agent: AgentRole, planId?: string): AsyncGenerator<EforgeEvent> {
    this.prompts.push({ planId, prompt: options.prompt });
    const id = planId ?? `unknown-${this.started.size}`;
    const agentId = `gate-${id}`;
    this.active += 1;
    this.maxActive = Math.max(this.maxActive, this.active);
    yield { type: 'agent:start', planId, agentId, agent, model: options.model?.id ?? 'stub-model', harness: options.harness ?? 'pi', harnessSource: options.harnessSource ?? 'tier', tier: options.tier ?? 'stub', tierSource: options.tierSource ?? 'tier', timestamp: new Date().toISOString() };
    this.deferred(this.started, id).resolve();
    await this.deferred(this.releases, id).promise;
    const tool = options.customTools?.[0];
    const input = this.outputs.get(id);
    if (tool && input) {
      yield { type: 'agent:tool_use', planId, agentId, agent, tool: tool.name, toolUseId: `tool-${id}`, input };
      const output = await tool.handler(input);
      yield { type: 'agent:tool_result', planId, agentId, agent, tool: tool.name, toolUseId: `tool-${id}`, output };
    }
    yield { type: 'agent:result', planId, agent, result: { durationMs: 1, durationApiMs: 1, numTurns: 1, totalCostUsd: 0, usage: { input: 0, output: 0, total: 0, cacheRead: 0, cacheCreation: 0 }, modelUsage: {}, resultText: '' } };
    yield { type: 'agent:stop', planId, agent, agentId, timestamp: new Date().toISOString() };
    this.active -= 1;
  }

  private deferred(map: Map<string, Deferred<void>>, key: string): Deferred<void> {
    let deferred = map.get(key);
    if (!deferred) { deferred = createDeferred<void>(); map.set(key, deferred); }
    return deferred;
  }
}

interface Deferred<T> { promise: Promise<T>; resolve: (value: T) => void }
function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function scriptedReduceOutputs(tree: ReturnType<typeof buildPlanningReduceTreeFromAtomTasks>, atomOutputs: PlanningAtomOutput[]): PlanningReduceOutput[] {
  const outputs: PlanningReduceOutput[] = [];
  for (const node of [...tree.nodes].sort((a, b) => a.depth - b.depth || a.nodeId.localeCompare(b.nodeId))) {
    buildPlanningReduceTask(tree, node, atomOutputs.filter((output) => node.inputAtomIds.includes(output.atomId)), outputs.filter((output) => node.inputNodeIds.includes(output.nodeId)));
    outputs.push(validReduceOutput(node));
  }
  return outputs;
}

function completedAtomOutput(task: PlanningAtomTask, extra: Partial<PlanningAtomOutput> = {}): PlanningAtomOutput {
  return { atomId: task.atomId, status: 'completed', aspectUpdates: task.aspectIds.map((aspectId) => ({ aspectId, status: 'resolved', completedByAtomIds: [task.atomId] })), compactHandoff: `completed ${task.atomId}`, planFragments: [{ fragmentId: `fragment-${task.atomId}`, title: task.title, criterionIds: task.criterionIds, aspectIds: task.aspectIds, markdown: `Plan ${task.title}.` }], moduleCandidates: [{ moduleId: `module-${task.atomId}`, title: task.title, criterionIds: task.criterionIds, aspectIds: task.aspectIds, description: `Implement ${task.title}.`, validationExpectation: 'Relevant checks pass.' }], ...extra };
}

function completedAtomOutputWithLargeReducerDigest(task: PlanningAtomTask): PlanningAtomOutput {
  return completedAtomOutput(task, {
    planFragments: Array.from({ length: 2 }, (_, index) => ({ fragmentId: `fragment-${task.atomId}-${index}`, title: task.title, criterionIds: task.criterionIds, aspectIds: task.aspectIds, markdown: 'm'.repeat(700) })),
    moduleCandidates: [],
  });
}

function atomDigest(task: PlanningAtomTask) {
  return { sourceId: task.atomId, sourceKind: 'atom' as const, status: 'completed' as const, summary: `Atom ${task.atomId} planned all assigned aspects.`, criterionIds: task.criterionIds, aspectIds: task.aspectIds };
}

function skippedAtomOutput(task: PlanningAtomTask): PlanningAtomOutput {
  return { atomId: task.atomId, status: 'skipped', aspectUpdates: task.aspectIds.map((aspectId) => ({ aspectId, status: 'skipped', reason: 'not applicable to this atom' })), compactHandoff: `skipped ${task.atomId}` };
}

function validReduceOutput(node: PlanningReduceNode): PlanningReduceOutput {
  return { nodeId: node.nodeId, status: 'completed', compactSummary: `Reduced ${node.nodeId}.`, reduceDigest: { sourceId: node.nodeId, sourceKind: 'reduce', status: 'completed', summary: `Reduced ${node.nodeId}.`, criterionIds: node.criterionIds, aspectIds: node.aspectIds }, planFragments: [{ fragmentId: `fragment-${node.nodeId}`, title: node.nodeId, criterionIds: node.criterionIds, aspectIds: node.aspectIds, markdown: `Reduced plan for ${node.nodeId}.` }], moduleCandidates: [{ moduleId: `module-${node.nodeId}`, title: node.nodeId, criterionIds: node.criterionIds, aspectIds: node.aspectIds, description: `Implement ${node.nodeId}.`, validationExpectation: 'Relevant checks pass.' }] };
}
