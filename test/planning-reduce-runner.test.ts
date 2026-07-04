import { describe, expect, it } from 'vitest';
import type { PlanningDecompositionLimits } from '@eforge-build/client';
import { AgentTerminalError } from '@eforge-build/engine/harness';
import { buildPlanningAtomTasks, buildPlanningReduceTask, buildPlanningReduceTree, buildPlanningReduceTreeFromAtomTasks, deriveInitialReduceDigestPromptBudget, derivePlanningAtomGraph, deriveReduceDigestTotalByteLimit, deriveSourceInventory, formatPlanningReducerPrompt, minimumReduceDigestPromptByteLength, planPromptSafeReduceTree, planPromptSafeReduceTreeFromTasks, runPlanningReduce, runPlanningReducer, validatePromptSafeTree, type PlanningAtomMapResult, type PlanningAtomOutput, type PlanningAtomTask, type PlanningReduceLimits, type PlanningReduceNode, type PlanningReduceOutput } from '@eforge-build/engine/planner-compiler';
import { StubHarness } from './stub-harness.js';

const atomLimits: PlanningDecompositionLimits = { parallelism: 2, maxDepth: 3, maxPromptSourceBytes: 1_000, maxPromptBytes: 20_000, maxObservedInputTokens: 50_000, maxObservedTurns: 10, maxCompactHandoffBytes: 8_000, maxLocalExplorationToolUses: 8, maxCriteriaPerUnit: 1, maxSubsystemsPerUnit: 2, maxSplitAttemptsPerUnit: 2 };
const reduceLimits: PlanningReduceLimits = { maxInputsPerReduce: 2, maxReduceDepth: 4, maxReducePromptBytes: 50_000, maxReduceSummaryBytes: 8_000 };
const constrainedPromptBudget = 24_000;
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

  it('builds the same deterministic tree shape from atom task metadata before outputs exist', () => {
    const data = fixture(['engine updates `packages/engine/src/a.ts`.', 'client updates `packages/client/src/b.ts`.', 'docs update `docs/c.md`.', 'test updates `test/d.test.ts`.', 'web updates `web/e.tsx`.']);

    const outputTree = buildPlanningReduceTree({ graph: data.graph, mapResult: data.mapResult, limits: reduceLimits });
    const taskTree = buildPlanningReduceTreeFromAtomTasks({ graph: data.graph, tasks: data.tasks, limits: reduceLimits });
    const planned = planPromptSafeReduceTreeFromTasks({ graph: data.graph, tasks: data.tasks, limits: reduceLimits });

    expect(normalizedReduceNodes(taskTree.nodes)).toEqual(normalizedReduceNodes(outputTree.nodes));
    expect(taskTree.rootNodeId).toBe(outputTree.rootNodeId);
    expect(taskTree.nodes.find((node) => node.nodeId === taskTree.rootNodeId)?.criterionIds).toEqual(['ac-001', 'ac-002', 'ac-003', 'ac-004', 'ac-005']);
    expect(planned.ok).toBe(true);
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
    const harness = new StubHarness(scripted.map(reduceSubmission));

    const result = await runPlanningReduce({ graph: data.graph, mapResult: data.mapResult, cwd: process.cwd(), harness, limits: reduceLimits, agentOptions: { maxTurns: 3 } });

    expect(result.reduceComplete).toBe(true);
    expect(result.validationErrors).toEqual([]);
    expect(result.rootNodeId).toBe(tree.rootNodeId);
    expect(result.finalOutput?.status).toBe('completed');
    expect(result.iterations).toBe(2);
    expect(harness.calls.every((call) => call.tools === 'none' && call.maxTurns === 3)).toBe(true);
    expect(harness.prompts[0]).toContain('Do not inspect the repository or call repository tools');
    expect(harness.customToolSets[0]?.map((tool) => tool.name)).toEqual(['submit_reduce_output']);
  });

  it('uses harness-effective submit tool names in schema retry guidance', async () => {
    const data = fixture(['engine updates `packages/engine/src/a.ts`.']);
    const tree = buildPlanningReduceTree({ graph: data.graph, mapResult: data.mapResult, limits: reduceLimits });
    const node = tree.nodes[0];
    const task = buildPlanningReduceTask(tree, node, data.mapResult.outputs, []);
    const harness = new PrefixedSubmitHarness([{ toolCalls: [{ tool: 'submit_reduce_output', toolUseId: 'submit-invalid', input: { nodeId: node.nodeId }, output: 'unused' }] }]);
    const events: unknown[] = [];

    await expect(runPlanningReducer({ task, cwd: process.cwd(), harness, onEvent: (event) => { events.push(event); } })).rejects.toThrow('Reducer did not call mcp__eforge_engine__submit_reduce_output');

    const toolResult = events.find((event) => typeof event === 'object' && event !== null && (event as { type?: string }).type === 'agent:tool_result') as { output?: string } | undefined;
    expect(toolResult?.output).toContain('Call mcp__eforge_engine__submit_reduce_output again with a schema-valid payload.');
  });

  it('formats reducer prompts from reducer digests instead of full artifact markdown', () => {
    const data = fixture(['engine updates `packages/engine/src/a.ts`.', 'client updates `packages/client/src/b.ts`.', 'docs update `docs/c.md`.', 'test updates `test/d.test.ts`.']);
    const hugeMarkdown = 'LOSSY-MARKDOWN-SHOULD-NOT-APPEAR '.repeat(1_000);
    data.mapResult.outputs = data.mapResult.outputs.map((output) => ({
      ...output,
      compactHandoff: hugeMarkdown,
      planFragments: (output.planFragments ?? []).map((fragment) => ({ ...fragment, markdown: hugeMarkdown })),
      moduleCandidates: (output.moduleCandidates ?? []).map((module) => ({ ...module, description: hugeMarkdown, validationExpectation: hugeMarkdown })),
      reduceDigest: {
        sourceId: output.atomId,
        sourceKind: 'atom',
        status: output.status,
        summary: `Digest for ${output.atomId}.`,
        criterionIds: [...new Set((output.planFragments ?? []).flatMap((fragment) => fragment.criterionIds))].sort(),
        aspectIds: output.aspectUpdates.map((update) => update.aspectId).sort(),
        fragments: (output.planFragments ?? []).map((fragment) => ({ fragmentId: fragment.fragmentId, title: fragment.title, intent: `Intent for ${fragment.fragmentId}.`, criterionIds: fragment.criterionIds, aspectIds: fragment.aspectIds })),
        modules: (output.moduleCandidates ?? []).map((module) => ({ moduleId: module.moduleId, title: module.title, purpose: `Purpose for ${module.moduleId}.`, criterionIds: module.criterionIds, aspectIds: module.aspectIds, validationExpectation: 'Run focused validation.' })),
      },
    }));
    const tree = buildPlanningReduceTree({ graph: data.graph, mapResult: data.mapResult, limits: { ...reduceLimits, maxInputsPerReduce: 4, maxReducePromptBytes: constrainedPromptBudget } });
    const task = buildPlanningReduceTask(tree, tree.nodes[0], data.mapResult.outputs, []);

    const prompt = formatPlanningReducerPrompt(task);

    expect(prompt).toContain(`Digest for ${data.mapResult.outputs[0]!.atomId}.`);
    expect(prompt).not.toContain('LOSSY-MARKDOWN-SHOULD-NOT-APPEAR');
    expect(Buffer.byteLength(prompt, 'utf8')).toBeLessThan(task.budget.maxReducePromptBytes);
  });

  it('carries module docsWork/testWork declarations into reducer digests', () => {
    const data = fixture(['engine updates `packages/engine/src/a.ts`.']);
    data.mapResult.outputs = data.mapResult.outputs.map((output) => ({
      ...output,
      moduleCandidates: (output.moduleCandidates ?? []).map((module) => ({ ...module, docsWork: 'author-new' as const, testWork: 'exercise-existing' as const })),
    }));
    const tree = buildPlanningReduceTree({ graph: data.graph, mapResult: data.mapResult, limits: reduceLimits });
    const task = buildPlanningReduceTask(tree, tree.nodes[0], data.mapResult.outputs, []);

    const prompt = formatPlanningReducerPrompt(task);

    expect(prompt).toContain('"docsWork": "author-new"');
    expect(prompt).toContain('"testWork": "exercise-existing"');
  });

  it('stamps candidate docsWork/testWork declarations onto producer-authored reducer digests', () => {
    const data = fixture(['engine updates `packages/engine/src/a.ts`.']);
    data.mapResult.outputs = data.mapResult.outputs.map((output) => ({
      ...output,
      moduleCandidates: (output.moduleCandidates ?? []).map((module) => ({ ...module, docsWork: 'author-new' as const, testWork: 'exercise-existing' as const })),
      reduceDigest: {
        sourceId: output.atomId,
        sourceKind: 'atom' as const,
        status: output.status,
        summary: `Digest for ${output.atomId}.`,
        criterionIds: [...new Set((output.moduleCandidates ?? []).flatMap((module) => module.criterionIds))].sort(),
        aspectIds: output.aspectUpdates.map((update) => update.aspectId).sort(),
        modules: (output.moduleCandidates ?? []).map((module) => ({ moduleId: module.moduleId, title: module.title, purpose: `Purpose for ${module.moduleId}.`, criterionIds: module.criterionIds, aspectIds: module.aspectIds, validationExpectation: 'Run focused validation.', docsWork: 'sync-existing' as const })),
      },
    }));
    const tree = buildPlanningReduceTree({ graph: data.graph, mapResult: data.mapResult, limits: reduceLimits });
    const task = buildPlanningReduceTask(tree, tree.nodes[0], data.mapResult.outputs, []);

    const prompt = formatPlanningReducerPrompt(task);

    // The authored digest omitted testWork and declared weaker docsWork; the validated
    // module candidates' declarations must still reach the reducer (strongest wins).
    expect(prompt).toContain('"docsWork": "author-new"');
    expect(prompt).toContain('"testWork": "exercise-existing"');
    expect(prompt).not.toContain('"docsWork": "sync-existing"');
  });

  it('reduces fan-in when configured reducer inputs exceed prompt budget', async () => {
    const data = fixture(['engine updates `packages/engine/src/a.ts`.', 'client updates `packages/client/src/b.ts`.', 'docs update `docs/c.md`.', 'test updates `test/d.test.ts`.']);
    data.mapResult.outputs = data.mapResult.outputs.map((output) => ({ ...output, reduceDigest: largeReduceDigest(output) }));
    const adaptiveTree = buildPlanningReduceTree({ graph: data.graph, mapResult: data.mapResult, limits: { ...reduceLimits, maxInputsPerReduce: 2, maxReducePromptBytes: constrainedPromptBudget } });
    const harness = new StubHarness(scriptedReduceOutputs(adaptiveTree, data.mapResult.outputs).map(reduceSubmission));

    const result = await runPlanningReduce({ graph: data.graph, mapResult: data.mapResult, cwd: process.cwd(), harness, limits: { ...reduceLimits, maxInputsPerReduce: 4, maxReducePromptBytes: constrainedPromptBudget } });

    expect(result.tree.limits.maxInputsPerReduce).toBe(2);
    expect(result.reduceComplete).toBe(true);
    expect(harness.prompts.every((prompt) => Buffer.byteLength(prompt, 'utf8') <= constrainedPromptBudget)).toBe(true);
  });

  it('derives feasible initial atom digest budgets per first-level reducer input', () => {
    const criteria = Array.from({ length: 120 }, (_, index) => `general work item ${index + 1} updates packages/engine/src/file-${index + 1}.ts.`);
    const data = fixture(criteria, true, { ...atomLimits, maxCriteriaPerUnit: 1, parallelism: 4 });

    const budget = deriveInitialReduceDigestPromptBudget({ graph: data.graph, limits: { ...reduceLimits, maxReducePromptBytes: constrainedPromptBudget } });
    const minimumAtomBudget = Math.max(...data.tasks.map((task) => minimumReduceDigestPromptByteLength({ sourceId: task.atomId, sourceKind: 'atom', criterionIds: task.criterionIds, aspectIds: task.aspectIds })));

    expect(data.graph.atoms.length).toBeGreaterThan(50);
    expect(budget).toBeGreaterThanOrEqual(minimumAtomBudget);
  });

  it('budget-plans multi-level reducer prompts before emitting the reduce tree', async () => {
    const criteria = Array.from({ length: 14 }, (_, index) => `general work item ${index + 1} updates packages/engine/src/file-${index + 1}.ts.`);
    const data = fixture(criteria);
    data.mapResult.outputs = data.mapResult.outputs.map((output) => ({ ...output, reduceDigest: largeReduceDigest(output) }));
    const limits = { ...reduceLimits, maxInputsPerReduce: 4, maxReducePromptBytes: constrainedPromptBudget };

    const planned = planPromptSafeReduceTree({ graph: data.graph, mapResult: data.mapResult, limits });

    expect(planned.ok).toBe(true);
    expect(planned.tree.limits.maxInputsPerReduce).toBe(2);
    expect(validatePromptSafeTree(planned.tree, data.mapResult.outputs)).toEqual([]);

    const live: unknown[] = [];
    const harness = new StubHarness(scriptedReduceOutputs(planned.tree, data.mapResult.outputs).map(reduceSubmission));
    const result = await runPlanningReduce({ graph: data.graph, mapResult: data.mapResult, cwd: process.cwd(), harness, limits, onEvent: (event) => live.push(event) });
    const treeEvent = live.find((event) => typeof event === 'object' && event !== null && (event as { type?: string }).type === 'planning:map-reduce:reduce-tree') as { nodes?: Array<{ nodeId: string }> } | undefined;

    expect(result.reduceComplete).toBe(true);
    expect(treeEvent?.nodes?.map((node) => node.nodeId)).toEqual(planned.tree.nodes.map((node) => node.nodeId));
    expect(harness.prompts.every((prompt) => Buffer.byteLength(prompt, 'utf8') <= constrainedPromptBudget)).toBe(true);
  });

  it('rejects oversized reducer digests during structured submission', async () => {
    const data = fixture(['engine updates `packages/engine/src/a.ts`.']);
    const tree = buildPlanningReduceTree({ graph: data.graph, mapResult: data.mapResult, limits: reduceLimits });
    const node = tree.nodes[0];
    const task = buildPlanningReduceTask(tree, node, data.mapResult.outputs, []);
    const events: unknown[] = [];
    const oversized = oversizedDigestReduceOutput(node);
    const digestBudget = deriveReduceDigestTotalByteLimit({ maxReducePromptBytes: task.budget.maxReducePromptBytes });
    const harness = new StubHarness([{ toolCalls: [reduceToolCall(oversized, 'submit-oversized'), reduceToolCall(validReduceOutput(node), 'submit-valid')] }]);

    expect(Buffer.byteLength(JSON.stringify(oversized.reduceDigest), 'utf8')).toBeGreaterThan(digestBudget);

    const result = await runPlanningReducer({ task, cwd: process.cwd(), harness, onEvent: (event) => { events.push(event); } });

    expect(result.output.nodeId).toBe(node.nodeId);
    expect(result.output.reduceDigest?.sourceId).toBe(node.nodeId);
    expect(events.filter((event) => typeof event === 'object' && event !== null && (event as { type?: string }).type === 'agent:tool_result').map((event) => (event as { output?: string }).output)).toEqual([
      expect.stringContaining('reduce digest prompt budget exceeded'),
      expect.stringContaining('Reduce output submitted successfully.'),
    ]);
  });

  it('retries retryable infrastructure failures before failing a reduce node', async () => {
    const data = fixture(['engine updates `packages/engine/src/a.ts`.']);
    const tree = buildPlanningReduceTree({ graph: data.graph, mapResult: data.mapResult, limits: reduceLimits });
    const node = tree.nodes[0];
    const harness = new StubHarness([
      { error: new AgentTerminalError('error_pi_tool_infrastructure', 'Theme not initialized. Call initTheme() first.') },
      reduceSubmission(validReduceOutput(node)),
    ]);

    const result = await runPlanningReduce({ graph: data.graph, mapResult: data.mapResult, cwd: process.cwd(), harness, limits: reduceLimits });

    expect(result.reduceComplete).toBe(true);
    expect(result.validationErrors).toEqual([]);
    expect(harness.calls).toHaveLength(2);
    expect(result.events.filter((event) => event.type === 'agent:retry')).toEqual([expect.objectContaining({ agent: 'planner', planId: node.nodeId, subtype: 'error_pi_tool_infrastructure', label: 'reducer-infrastructure-retry' })]);
  });

  it('rejects invalid reducer output before accepting completion', async () => {
    const data = fixture(['engine updates `packages/engine/src/a.ts`.']);
    const tree = buildPlanningReduceTree({ graph: data.graph, mapResult: data.mapResult, limits: reduceLimits });
    const node = tree.nodes[0];
    const harness = new StubHarness([reduceSubmission({ nodeId: node.nodeId, status: 'completed', compactSummary: 'bad', reduceDigest: { sourceId: node.nodeId, sourceKind: 'reduce', status: 'completed', summary: 'Bad.', criterionIds: node.criterionIds, aspectIds: node.aspectIds }, planFragments: [{ fragmentId: 'fragment-bad', title: 'Bad', criterionIds: ['ac-001'], aspectIds: ['ac-999:missing'], markdown: 'Bad.' }] })]);

    const result = await runPlanningReduce({ graph: data.graph, mapResult: data.mapResult, cwd: process.cwd(), harness, limits: reduceLimits });

    expect(result.reduceComplete).toBe(false);
    expect(result.outputs).toEqual([{ nodeId: node.nodeId, status: 'failed', compactSummary: '', error: 'invalid reduce output:unknown aspect for reduce output:fragment-bad:ac-999:missing' }]);
    expect(result.validationErrors).toEqual(['unknown aspect for reduce output:fragment-bad:ac-999:missing']);
  });

  it('fails closed when reducer summaries exceed budget', async () => {
    const data = fixture(['engine updates `packages/engine/src/a.ts`.']);
    const tree = buildPlanningReduceTree({ graph: data.graph, mapResult: data.mapResult, limits: { ...reduceLimits, maxReduceSummaryBytes: 8 } });
    const node = tree.nodes[0];
    const harness = new StubHarness([reduceSubmission({ nodeId: node.nodeId, status: 'completed', compactSummary: 'this summary is too long', reduceDigest: { sourceId: node.nodeId, sourceKind: 'reduce', status: 'completed', summary: 'Too long.', criterionIds: node.criterionIds, aspectIds: node.aspectIds } })]);

    const result = await runPlanningReduce({ graph: data.graph, mapResult: data.mapResult, cwd: process.cwd(), harness, limits: { ...reduceLimits, maxReduceSummaryBytes: 8 } });

    expect(result.reduceComplete).toBe(false);
    expect(result.validationErrors).toEqual([`reduce summary budget exceeded:${node.nodeId}`]);
  });

  it('propagates conflicts and gaps while incomplete map results prevent fake success', async () => {
    const data = fixture(['engine updates `packages/engine/src/a.ts`.'], false);
    const node = buildPlanningReduceTree({ graph: data.graph, mapResult: data.mapResult, limits: reduceLimits }).nodes[0];
    const task = buildPlanningReduceTask(buildPlanningReduceTree({ graph: data.graph, mapResult: data.mapResult, limits: reduceLimits }), node, data.mapResult.outputs, []);
    const harness = new StubHarness([reduceSubmission(validReduceOutput(task.node, { gap: true, status: 'incomplete' }))]);

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

function reduceSubmission(output: PlanningReduceOutput | { nodeId: string; status: 'completed'; compactSummary: string; planFragments?: PlanningReduceOutput['planFragments'] }) {
  return { toolCalls: [reduceToolCall(output, `submit-${output.nodeId}`)] };
}

function reduceToolCall(output: PlanningReduceOutput | { nodeId: string; status: 'completed'; compactSummary: string; planFragments?: PlanningReduceOutput['planFragments'] }, toolUseId: string) {
  return { tool: 'submit_reduce_output', toolUseId, input: output, output: 'ok' };
}

class PrefixedSubmitHarness extends StubHarness {
  override effectiveCustomToolName(name: string): string {
    return `mcp__eforge_engine__${name}`;
  }
}

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
    reduceDigest: { sourceId: node.nodeId, sourceKind: 'reduce', status: options.status ?? 'completed', summary: `Reduced ${node.nodeId}.`, criterionIds: node.criterionIds, aspectIds: node.aspectIds, fragments: [{ fragmentId: `digest-fragment-${node.nodeId}`, title: node.nodeId, intent: 'Implement reduced work.', criterionIds: node.criterionIds, aspectIds: node.aspectIds }] },
    moduleCandidates: [{ moduleId: `module-${node.nodeId}`, title: node.nodeId, criterionIds: node.criterionIds, aspectIds: node.aspectIds, description: `Implement reduced work for ${node.nodeId}.`, validationExpectation: 'Reduced validation passes.' }],
    ...(options.gap ? { gaps: [{ gapId: `gap-${node.nodeId}`, title: 'Gap', criterionIds: node.criterionIds, aspectIds: node.aspectIds, description: 'Gap requires representation.', representationRequired: true }] } : {}),
    validationStrategy: 'Run relevant validation.',
  };
}

function normalizedReduceNodes(nodes: PlanningReduceNode[]) {
  return nodes.map((node) => ({ nodeId: node.nodeId, depth: node.depth, inputAtomIds: node.inputAtomIds, inputNodeIds: node.inputNodeIds, criterionIds: node.criterionIds, aspectIds: node.aspectIds }));
}

function oversizedDigestReduceOutput(node: PlanningReduceNode): PlanningReduceOutput {
  return { ...validReduceOutput(node), reduceDigest: { sourceId: node.nodeId, sourceKind: 'reduce', status: 'completed', summary: `Reduced ${node.nodeId}.`, criterionIds: node.criterionIds, aspectIds: node.aspectIds, fragments: Array.from({ length: 16 }, (_, index) => ({ fragmentId: `oversized-fragment-${index}`, title: `Fragment ${index}`, intent: 'oversized intent '.repeat(55), criterionIds: node.criterionIds, aspectIds: node.aspectIds })) } };
}

function completedAtomOutput(task: PlanningAtomTask): PlanningAtomOutput {
  return { atomId: task.atomId, status: 'completed', aspectUpdates: task.aspectIds.map((aspectId) => ({ aspectId, status: 'resolved', completedByAtomIds: [task.atomId] })), compactHandoff: `completed ${task.atomId}`, planFragments: [{ fragmentId: `fragment-${task.atomId}`, title: task.title, criterionIds: task.criterionIds, aspectIds: task.aspectIds, markdown: `Plan ${task.title}.` }], moduleCandidates: [{ moduleId: `module-${task.atomId}`, title: task.title, criterionIds: task.criterionIds, aspectIds: task.aspectIds, description: `Implement ${task.title}.`, validationExpectation: 'Relevant checks pass.' }] };
}

function largeReduceDigest(output: PlanningAtomOutput): NonNullable<PlanningAtomOutput['reduceDigest']> {
  const criterionIds = [...new Set([...(output.planFragments ?? []).flatMap((fragment) => fragment.criterionIds), ...(output.moduleCandidates ?? []).flatMap((module) => module.criterionIds)])].sort();
  const aspectIds = output.aspectUpdates.map((update) => update.aspectId).sort();
  return {
    sourceId: output.atomId,
    sourceKind: 'atom',
    status: output.status,
    summary: `Large bounded digest for ${output.atomId}.`,
    criterionIds,
    aspectIds,
    fragments: Array.from({ length: 4 }, (_, index) => ({ fragmentId: `digest-fragment-${output.atomId}-${index}`, title: `Fragment ${index}`, intent: 'fragment intent '.repeat(45), criterionIds, aspectIds })),
    modules: Array.from({ length: 4 }, (_, index) => ({ moduleId: `digest-module-${output.atomId}-${index}`, title: `Module ${index}`, purpose: 'module purpose '.repeat(45), criterionIds, aspectIds, validationExpectation: 'focused validation' })),
  };
}

function completedCoverage(tasks: PlanningAtomTask[]): PlanningAtomMapResult['coverage'] {
  const criteria = [...new Set(tasks.flatMap((task) => task.criterionIds))].sort();
  return { totalCriteria: criteria.length, completeCriteria: criteria, incompleteCriteria: [], rawCriterionCoverage: criteria.map((criterionId) => ({ criterionId, coveredByAtomIds: tasks.filter((task) => task.criterionIds.includes(criterionId)).map((task) => task.atomId) })), aspects: [], criteria: [], coverageByAtom: {}, validationErrors: [] };
}
