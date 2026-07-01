import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, resolvePlanningDecompositionLimits } from '@eforge-build/engine/config';
import { singletonRegistry } from '@eforge-build/engine/agent-runtime-registry';
import type { AgentRole, CompilePreflightRisk, EforgeEvent } from '@eforge-build/engine/events';
import type { AgentHarness, AgentRunOptions } from '@eforge-build/engine/harness';
import { getCompileStage } from '@eforge-build/engine/pipeline';
import { buildPlanningAtomTasks, derivePlanningAtomGraph, deriveSharedPlanningBrief, deriveSourceInventory, type PlanningAtomOutput, type PlanningAtomTask, type PlanningReduceNode, type PlanningReduceOutput } from '@eforge-build/engine/planner-compiler';
import { makePipelineCtx, TEST_PIPELINE } from './pipeline-helpers.js';
import { StubHarness, type StubResponse } from './stub-harness.js';
import { useTempDir } from './test-tmpdir.js';

const makeTempDir = useTempDir('eforge-context-managed-orchestration-');
const sentinel = 'MONOLITHIC_ROOT_SOURCE_SENTINEL';

async function collect(gen: AsyncGenerator<EforgeEvent>): Promise<EforgeEvent[]> {
  const events: EforgeEvent[] = [];
  for await (const event of gen) events.push(event);
  return events;
}

function boundedRisk(): CompilePreflightRisk {
  return {
    level: 'overflow-risk',
    sourceBytes: 100_000,
    promptSourceBytes: 80_000,
    acceptanceCriteriaCount: 4,
    score: 98,
    generatedInventory: { detected: true, contentHashes: ['hash'], pathReferences: [], headings: [], blockCount: 1, sidecarCount: 0, omittedBytes: 20_000 },
    subsystemBreadth: { count: 4, subsystems: ['engine', 'client', 'console', 'cli'], evidence: ['wide'] },
    pipelineScope: 'excursion',
    reasons: ['overflow-risk'],
    recommendation: { action: 'bounded-decomposition', eligible: true, reason: 'decompose' },
  };
}

function normalRisk(): CompilePreflightRisk {
  return { ...boundedRisk(), level: 'normal', score: 10, recommendation: { action: 'none', eligible: false, reason: 'normal' } };
}

function elevatedRisk(): CompilePreflightRisk {
  return { ...boundedRisk(), level: 'elevated', score: 60, recommendation: { action: 'none', eligible: false, reason: 'advisory only' } };
}

function source(): string {
  return [`# Compile Source`, '', sentinel, '', '## Acceptance Criteria', '- engine implements unit one', '- client implements unit two', '- console implements unit three', '- cli implements unit four'].join('\n');
}

function config() {
  return {
    ...DEFAULT_CONFIG,
    plan: { ...DEFAULT_CONFIG.plan, outputDir: 'plans' },
    compile: { ...DEFAULT_CONFIG.compile, planningUnitParallelism: 2, planningUnitMaxCriteriaPerUnit: 1, planningUnitMaxSubsystemsPerUnit: 1 },
  };
}

function composer(scope: 'excursion' | 'expedition' = 'excursion'): StubResponse {
  return {
    resultText: JSON.stringify({
      scope,
      compile: ['planner'],
      defaultBuild: ['implement', 'review-cycle'],
      defaultReview: { strategy: 'parallel', perspectives: ['code', 'test'], maxRounds: 1, evaluatorStrictness: 'standard' },
      rationale: 'test composition',
    }),
  };
}

function directPlanResponse(id: string): StubResponse {
  return {
    toolCalls: [{
      tool: 'submit_plan_set',
      toolUseId: `tool-${id}`,
      input: {
        description: `bounded ${id}`,
        plans: [{ frontmatter: { id: `plan-${id}`, name: `Plan ${id}` }, body: `# Plan ${id}\n\n## Acceptance Criteria\n- [ ] ${id}` }],
        orchestration: { validate: [], plans: [{ id: `plan-${id}`, dependsOn: [] }] },
      },
      output: 'captured',
    }],
    text: `submitted ${id}`,
  };
}

function compilerHarness(responses: StubResponse[], content: string, cfg = config()): AgentHarness & Pick<StubHarness, 'prompts' | 'calls'> {
  return new DynamicCompilerHarness(responses, expectedTasks(content, cfg));
}

function expectedTasks(content: string, cfg = config()): PlanningAtomTask[] {
  const limits = resolvePlanningDecompositionLimits(cfg);
  const inventory = deriveSourceInventory({ content, hash: hash(content), path: undefined });
  const graph = derivePlanningAtomGraph({ content, hash: hash(content), limits, inventory });
  const sharedBrief = deriveSharedPlanningBrief({ graph });
  return buildPlanningAtomTasks({ graph, inventory, sharedBrief });
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

function completedReduceOutput(node: PlanningReduceNode, atomOutputs: PlanningAtomOutput[], childOutputs: PlanningReduceOutput[] = []): PlanningReduceOutput {
  return {
    nodeId: node.nodeId,
    status: 'completed',
    compactSummary: 'Reduced compiler synthesis.',
    reduceDigest: { sourceId: node.nodeId, sourceKind: 'reduce', status: 'completed', summary: 'Reduced compiler synthesis.', criterionIds: node.criterionIds, aspectIds: node.aspectIds },
    planFragments: [...atomOutputs.flatMap((output) => output.planFragments ?? []), ...childOutputs.flatMap((output) => output.planFragments ?? [])],
    moduleCandidates: [{ moduleId: 'module-reduced', title: 'Reduced module', criterionIds: node.criterionIds, aspectIds: node.aspectIds, description: 'Implement reduced compiler work.', validationExpectation: 'Reduced checks pass.' }],
    validationStrategy: 'Run relevant checks.',
  };
}

class DynamicCompilerHarness implements AgentHarness {
  private readonly delegate: StubHarness;
  private readonly taskById: Map<string, PlanningAtomTask>;
  private readonly outputs: PlanningAtomOutput[];
  private readonly reduceOutputs: PlanningReduceOutput[] = [];
  readonly prompts: string[] = [];
  readonly calls: AgentRunOptions[] = [];

  constructor(responses: StubResponse[], tasks: PlanningAtomTask[]) {
    this.delegate = new StubHarness(responses);
    this.taskById = new Map(tasks.map((task) => [task.atomId, task]));
    this.outputs = tasks.map(completedOutput);
  }

  effectiveCustomToolName(name: string): string { return name; }

  async *run(options: AgentRunOptions, agent: AgentRole, planId?: string): AsyncGenerator<EforgeEvent> {
    const toolNames = new Set((options.customTools ?? []).map((tool) => tool.name));
    if (toolNames.has('submit_atom_output') || toolNames.has('submit_reduce_output')) {
      this.prompts.push(options.prompt);
      this.calls.push(options);
      yield* this.runDynamicTool(options, agent, planId, toolNames.has('submit_atom_output') ? 'atom' : 'reduce');
      return;
    }
    for await (const event of this.delegate.run(options, agent, planId)) yield event;
    this.prompts.splice(0, this.prompts.length, ...this.delegate.prompts);
    this.calls.splice(0, this.calls.length, ...this.delegate.calls);
  }

  private async *runDynamicTool(options: AgentRunOptions, agent: AgentRole, planId: string | undefined, kind: 'atom' | 'reduce'): AsyncGenerator<EforgeEvent> {
    const agentId = crypto.randomUUID();
    yield { type: 'agent:start', planId, agent, agentId, model: 'stub-model', harness: 'claude-sdk', harnessSource: 'tier', tier: 'stub', tierSource: 'tier', timestamp: new Date().toISOString() };
    const output = kind === 'atom' ? this.atomOutputForPrompt(options.prompt) : this.reduceOutputForPrompt(options.prompt);
    const tool = kind === 'atom' ? 'submit_atom_output' : 'submit_reduce_output';
    const toolUseId = `submit-${kind === 'atom' ? output.atomId : output.nodeId}`;
    yield { type: 'agent:tool_use', planId, agentId, agent, tool, toolUseId, input: output };
    const customTool = (options.customTools ?? []).find((candidate) => candidate.name === tool);
    const toolOutput = customTool ? await customTool.handler(output) : 'ok';
    if (kind === 'reduce') this.reduceOutputs.push(output as PlanningReduceOutput);
    yield { type: 'agent:tool_result', planId, agentId, agent, tool, toolUseId, output: toolOutput };
    yield { type: 'agent:result', planId, agent, result: { durationMs: 100, durationApiMs: 80, numTurns: 1, totalCostUsd: 0, usage: { input: 0, output: 0, total: 0, cacheRead: 0, cacheCreation: 0 }, modelUsage: {} } };
    yield { type: 'agent:stop', planId, agent, agentId, timestamp: new Date().toISOString() };
  }

  private atomOutputForPrompt(prompt: string): PlanningAtomOutput {
    const atomId = /"atomId": "([^"]+)"/.exec(prompt)?.[1];
    const task = atomId ? this.taskById.get(atomId) : undefined;
    if (!task) throw new Error(`missing dynamic atom task:${atomId ?? 'unknown'}`);
    return completedOutput(task);
  }

  private reduceOutputForPrompt(prompt: string): PlanningReduceOutput {
    const node = reduceNodeForPrompt(prompt);
    const atomOutputs = this.outputs.filter((output) => node.inputAtomIds.includes(output.atomId));
    const childOutputs = this.reduceOutputs.filter((output) => node.inputNodeIds.includes(output.nodeId));
    return completedReduceOutput(node, atomOutputs, childOutputs);
  }
}

function reduceNodeForPrompt(prompt: string): PlanningReduceNode {
  const nodeId = /"nodeId": "([^"]+)"/.exec(prompt)?.[1];
  if (!nodeId) throw new Error('missing dynamic reduce node');
  return {
    nodeId,
    depth: Number(/"depth": (\d+)/.exec(prompt)?.[1] ?? 0),
    inputAtomIds: stringArrayForPromptKey(prompt, 'inputAtomIds'),
    inputNodeIds: stringArrayForPromptKey(prompt, 'inputNodeIds'),
    criterionIds: stringArrayForPromptKey(prompt, 'criterionIds'),
    aspectIds: stringArrayForPromptKey(prompt, 'aspectIds'),
  };
}

function stringArrayForPromptKey(prompt: string, key: string): string[] {
  const match = new RegExp(`"${key}": \\[([\\s\\S]*?)\\]`).exec(prompt);
  return match?.[1]?.match(/"([^"]+)"/g)?.map((value) => value.slice(1, -1)) ?? [];
}

function hash(value: string): string {
  return `h${value.length}`.padEnd(64, '0');
}

describe('compile planner stage bounded compiler orchestration branch', () => {
  it('routes overflow-risk bounded-decomposition through the canonical compiler without a broad root planner prompt', async () => {
    const content = source();
    const cfg = config();
    const harness = compilerHarness([composer()], content, cfg);
    const ctx = makePipelineCtx({
      cwd: makeTempDir(),
      sourceContent: content,
      compilePreflight: boundedRisk(),
      config: cfg,
      pipeline: { ...TEST_PIPELINE, compile: ['planner'] },
      agentRuntimes: singletonRegistry(harness),
    });

    const events = await collect(getCompileStage('planner')(ctx));

    expect(events.some((event) => event.type === 'planning:progress' && event.message.includes('Starting bounded planner compiler'))).toBe(true);
    expect(events.some((event) => event.type === 'planning:decomposition:start')).toBe(false);
    expect(events.some((event) => event.type === 'planning:complete')).toBe(true);
    const atomPromptCount = harness.calls.filter((call) => call.customTools?.some((tool) => tool.name === 'submit_atom_output')).length;
    const reducePromptCount = harness.calls.filter((call) => call.customTools?.some((tool) => tool.name === 'submit_reduce_output')).length;
    expect(atomPromptCount).toBe(expectedTasks(content, cfg).length);
    expect(reducePromptCount).toBeGreaterThan(0);
    expect(harness.prompts).toHaveLength(1 + atomPromptCount + reducePromptCount);
    expect(harness.prompts[0]).toContain(sentinel);
    expect(harness.calls.slice(1).every((call) => call.tools === 'none')).toBe(true);
    expect(ctx.plans.map((plan) => plan.id)).toEqual(['module-reduced']);
  });

  it('falls back to the bounded compiler when an elevated direct planner run trips the live guard', async () => {
    const content = source();
    const cfg = config();
    const harness = compilerHarness([
      composer(),
      { events: [{ kind: 'usage', usage: { input: 101, total: 101 }, numTurns: 1 }] },
    ], content, cfg);
    const ctx = makePipelineCtx({
      cwd: makeTempDir(),
      sourceContent: content,
      compilePreflight: elevatedRisk(),
      compileContextGuardLimits: { maxObservedInputTokens: 100 },
      config: cfg,
      pipeline: { ...TEST_PIPELINE, compile: ['planner'] },
      agentRuntimes: singletonRegistry(harness),
    });

    const events = await collect(getCompileStage('planner')(ctx));

    expect(events.some((event) => event.type === 'planning:scope-context:failure')).toBe(true);
    expect(events.some((event) => event.type === 'planning:progress' && event.message.includes('Starting bounded planner compiler'))).toBe(true);
    expect(events.some((event) => event.type === 'planning:complete')).toBe(true);
    expect(ctx.plans.map((plan) => plan.id)).toEqual(['module-reduced']);
    expect(harness.prompts.some((prompt) => prompt.includes(sentinel))).toBe(true);
    expect(harness.calls.slice(2).every((call) => call.tools === 'none')).toBe(true);
  });

  it('leaves normal-risk planner-stage runs on the existing direct planner path', async () => {
    const harness = new StubHarness([
      composer(),
      directPlanResponse('direct-root'),
    ]);
    const ctx = makePipelineCtx({
      cwd: makeTempDir(),
      sourceContent: source(),
      compilePreflight: normalRisk(),
      config: config(),
      pipeline: { ...TEST_PIPELINE, compile: ['planner'] },
      agentRuntimes: singletonRegistry(harness),
    });

    const events = await collect(getCompileStage('planner')(ctx));

    expect(events.some((event) => event.type === 'planning:decomposition:start')).toBe(false);
    expect(events.some((event) => event.type === 'planning:complete')).toBe(true);
    expect(harness.prompts).toHaveLength(2);
    expect(harness.prompts[1]).toContain(sentinel);
  });
});
