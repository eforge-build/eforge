/**
 * Parity fixtures — errand-, excursion-, and expedition-size PRDs compiled
 * end-to-end through the bounded planner compiler, producing valid buildable
 * artifacts and passing the unconditional planning quality review gate.
 * These fixtures are the gate for the follow-up legacy-path deletion build.
 */
import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, resolveConfig, resolvePlanningDecompositionLimits, type EforgeConfig } from '@eforge-build/engine/config';
import type { AgentRole, EforgeEvent } from '@eforge-build/engine/events';
import type { AgentHarness, AgentRunOptions } from '@eforge-build/engine/harness';
import { parseOrchestrationConfig } from '@eforge-build/engine/plan';
import { runCompilePipeline, type PipelineContext } from '@eforge-build/engine/pipeline';
import {
  DEFAULT_PLANNING_REDUCE_LIMITS,
  buildPlanningAtomTasks,
  derivePlanningAtomGraph,
  deriveSharedPlanningBrief,
  deriveSourceInventory,
  parseArchitectureManifest,
  planPromptSafeReduceTreeFromTasks,
  validateCompilerDiagnostics,
  type CompilerDiagnostics,
  type PlanningAtomOutput,
  type PlanningAtomTask,
  type PlanningReduceNode,
  type PlanningReduceOutput,
  type PlanningReduceTree,
} from '@eforge-build/engine/planner-compiler';
import { singletonRegistry } from '@eforge-build/engine/agent-runtime-registry';
import { makePipelineCtx, collect, TEST_PIPELINE } from './pipeline-helpers.js';
import type { StubResponse } from './stub-harness.js';
import { hash, overflowRisk, prd, readFileText, unsatisfiedGateSubmission, workspace } from './planning-compiler-fixtures.js';

const exec = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await exec('git', args, { cwd });
  return stdout;
}

async function gitWorkspace(files: Record<string, string>): Promise<string> {
  const cwd = await workspace(files);
  await git(cwd, ['init', '-b', 'main']);
  await git(cwd, ['config', 'user.email', 'test@eforge.build']);
  await git(cwd, ['config', 'user.name', 'eforge-test']);
  await git(cwd, ['add', '-A']);
  await git(cwd, ['commit', '-m', 'chore: base']);
  return cwd;
}

/**
 * Excursion/expedition fixtures compile with a tight per-unit criterion cap:
 * under production defaults their small PRDs now collapse to a single root
 * atom (the errand fixture's job), and these fixtures exist to exercise the
 * multi-atom map and reduce-tree machinery.
 */
const FRAGMENTING_CONFIG = resolveConfig({ compile: { planningUnitMaxCriteriaPerUnit: 2 } });

/** Deterministically derive the same atom tasks and reduce tree the compiler will use. */
function derivedPlan(content: string, config: EforgeConfig): { tasks: PlanningAtomTask[]; tree: PlanningReduceTree } {
  const limits = resolvePlanningDecompositionLimits(config);
  const inventory = deriveSourceInventory({ content, hash: hash(content), path: undefined });
  const graph = derivePlanningAtomGraph({ content, hash: hash(content), limits, inventory });
  const sharedBrief = deriveSharedPlanningBrief({ graph });
  const tasks = buildPlanningAtomTasks({ graph, inventory, sharedBrief });
  const treePlan = planPromptSafeReduceTreeFromTasks({ graph, tasks, limits: DEFAULT_PLANNING_REDUCE_LIMITS });
  if (!treePlan.ok) throw new Error(`reduce tree planning failed: ${treePlan.validationErrors.join('; ')}`);
  return { tasks, tree: treePlan.tree };
}

function completedAtomOutput(task: PlanningAtomTask, options: { digest?: boolean } = {}): PlanningAtomOutput {
  return {
    atomId: task.atomId,
    status: 'completed',
    aspectUpdates: task.aspectIds.map((aspectId) => ({ aspectId, status: 'resolved', completedByAtomIds: [task.atomId] })),
    compactHandoff: `completed ${task.atomId}`,
    planFragments: [{ fragmentId: `fragment-${task.atomId}`, title: task.title, criterionIds: task.criterionIds, aspectIds: task.aspectIds, markdown: `Plan ${task.title}.` }],
    moduleCandidates: [{ moduleId: `module-${task.atomId}`, title: task.title, criterionIds: task.criterionIds, aspectIds: task.aspectIds, description: `Implement ${task.title}.`, validationExpectation: 'Relevant checks pass.' }],
    ...(options.digest ? { reduceDigest: { sourceId: task.atomId, sourceKind: 'atom' as const, status: 'completed' as const, summary: `Atom ${task.atomId} planned all assigned aspects.`, criterionIds: task.criterionIds, aspectIds: task.aspectIds } } : {}),
  };
}

/**
 * Script every reduce node's output: intermediate nodes carry digests only;
 * the root aggregates one module candidate per atom so synthesis produces a
 * plan per atom with disjoint criteria (no ownership conflicts).
 */
function scriptedReduceOutput(node: PlanningReduceNode, isRoot: boolean, tasks: PlanningAtomTask[]): PlanningReduceOutput {
  return {
    nodeId: node.nodeId,
    status: 'completed',
    compactSummary: `Reduced ${node.nodeId}.`,
    reduceDigest: { sourceId: node.nodeId, sourceKind: 'reduce', status: 'completed', summary: `Reduced ${node.nodeId}.`, criterionIds: node.criterionIds, aspectIds: node.aspectIds },
    ...(isRoot
      ? {
        moduleCandidates: tasks.map((task) => ({ moduleId: `module-${task.atomId}`, title: task.title, criterionIds: task.criterionIds, aspectIds: task.aspectIds, description: `Implement ${task.title}.`, validationExpectation: 'Relevant checks pass.' })),
        validationStrategy: 'Run relevant checks.',
      }
      : {}),
  };
}

/**
 * Order-tolerant harness: atom and reducer runs are keyed by planId (they run
 * concurrently, so sequential scripting is racy); composer and reviewer runs
 * consume a sequential fallback queue.
 */
class ParityHarness implements AgentHarness {
  readonly prompts: string[] = [];
  readonly ranPlanIds: Array<string | undefined> = [];
  private runCount = 0;

  constructor(
    private readonly keyed: Map<string, unknown>,
    private readonly sequential: StubResponse[],
  ) {}

  effectiveCustomToolName(name: string): string { return name; }

  async *run(options: AgentRunOptions, agent: AgentRole, planId?: string): AsyncGenerator<EforgeEvent> {
    this.prompts.push(options.prompt);
    this.ranPlanIds.push(planId);
    this.runCount += 1;
    const agentId = `parity-${this.runCount}`;
    yield { type: 'agent:start', planId, agentId, agent, model: 'stub-model', harness: 'pi', harnessSource: 'tier', tier: 'stub', tierSource: 'tier', timestamp: new Date().toISOString() };

    const keyedInput = planId !== undefined ? this.keyed.get(planId) : undefined;
    let resultText = '';
    if (keyedInput !== undefined) {
      const tool = options.customTools?.[0];
      if (!tool) throw new Error(`keyed run ${planId} has no custom tool`);
      yield { type: 'agent:tool_use', planId, agentId, agent, tool: tool.name, toolUseId: `tool-${agentId}`, input: keyedInput };
      const output = await tool.handler(keyedInput);
      yield { type: 'agent:tool_result', planId, agentId, agent, tool: tool.name, toolUseId: `tool-${agentId}`, output };
    } else {
      const next = this.sequential.shift();
      if (!next) throw new Error(`no scripted response for run ${this.runCount} (planId: ${planId ?? 'none'})`);
      for (const toolCall of next.toolCalls ?? []) {
        const tool = options.customTools?.find((candidate) => candidate.name === toolCall.tool);
        yield { type: 'agent:tool_use', planId, agentId, agent, tool: toolCall.tool, toolUseId: toolCall.toolUseId, input: toolCall.input };
        const output = tool ? await tool.handler(toolCall.input) : toolCall.output;
        yield { type: 'agent:tool_result', planId, agentId, agent, tool: toolCall.tool, toolUseId: toolCall.toolUseId, output };
      }
      if (next.text) {
        yield { type: 'agent:message', planId, agentId, agent, content: next.text };
      }
      resultText = next.resultText ?? next.text ?? '';
    }

    yield { type: 'agent:result', planId, agent, result: { durationMs: 1, durationApiMs: 1, numTurns: 1, totalCostUsd: 0, usage: { input: 0, output: 0, total: 0, cacheRead: 0, cacheCreation: 0 }, modelUsage: {}, resultText } };
    yield { type: 'agent:stop', planId, agent, agentId, timestamp: new Date().toISOString() };
  }
}


const NO_FIX_REVIEW: StubResponse = { text: '<review-issues></review-issues>' };

interface ParityRun {
  ctx: PipelineContext;
  events: EforgeEvent[];
  harness: ParityHarness;
  tasks: PlanningAtomTask[];
  tree: PlanningReduceTree;
}

async function compileParityFixture(input: {
  planSetName: string;
  scope: 'errand' | 'excursion' | 'expedition';
  criteria: string[];
  files: Record<string, string>;
  fastPath?: boolean;
  config?: EforgeConfig;
}): Promise<ParityRun> {
  const config = input.config ?? DEFAULT_CONFIG;
  const sourceContent = prd(input.criteria);
  const cwd = await gitWorkspace(input.files);
  const { tasks, tree } = derivedPlan(sourceContent, config);

  const keyed = new Map<string, unknown>();
  for (const task of tasks) keyed.set(task.atomId, completedAtomOutput(task, { digest: input.fastPath ?? false }));
  if (!input.fastPath) {
    for (const node of tree.nodes) keyed.set(node.nodeId, scriptedReduceOutput(node, node.nodeId === tree.rootNodeId, tasks));
  }

  // The satisfaction gate (planId 'satisfaction-gate') is not keyed, so it
  // consumes the first sequential response before the quality reviewer.
  const harness = new ParityHarness(keyed, [unsatisfiedGateSubmission(), NO_FIX_REVIEW]);
  const ctx = makePipelineCtx({
    cwd,
    sourceContent,
    config,
    planSetName: input.planSetName,
    agentRuntimes: singletonRegistry(harness as AgentHarness),
    compilePreflight: overflowRisk(sourceContent),
    pipeline: { ...TEST_PIPELINE, scope: input.scope, compile: ['planner'] },
    baseBranch: 'main',
  });

  const events = await collect(runCompilePipeline(ctx));
  return { ctx, events, harness, tasks, tree };
}

/** Shared parity assertions: one planning:complete, gate ran, all five artifacts valid on disk. */
async function assertParityArtifacts(run: ParityRun, planSetName: string): Promise<void> {
  const { ctx, events } = run;
  const planDir = path.join(ctx.cwd, 'eforge/plans', planSetName);

  expect(ctx.pipeline.compile).toEqual(['planner', 'planning-quality-review-cycle']);
  expect(events.some((event) => event.type === 'planning:review:start')).toBe(true);
  expect(events.some((event) => event.type === 'planning:review:complete')).toBe(true);
  const completes = events.filter((event) => event.type === 'planning:complete');
  expect(completes).toHaveLength(1);
  expect(completes[0].plans.length).toBeGreaterThan(0);
  expect(completes[0].planConfigs).toBeDefined();

  // orchestration.yaml agrees with the emitted plans and carries per-plan settings.
  const orchestration = await parseOrchestrationConfig(path.join(planDir, 'orchestration.yaml'));
  expect(orchestration.plans.map((plan) => plan.id).sort()).toEqual(completes[0].plans.map((plan) => plan.id).sort());
  for (const plan of orchestration.plans) {
    expect(plan.build).toBeDefined();
    expect(plan.review).toBeDefined();
  }

  // architecture.md carries a parseable manifest agreeing with orchestration.
  const architecture = await readFileText(path.join(planDir, 'architecture.md'));
  const parsed = parseArchitectureManifest(architecture);
  expect(parsed.errors).toEqual([]);
  expect(parsed.manifest!.plans.map((plan) => plan.planId).sort()).toEqual(orchestration.plans.map((plan) => plan.id).sort());

  // acceptance-coverage.md and compiler-diagnostics.json are present and valid.
  await expect(readFileText(path.join(planDir, 'acceptance-coverage.md'))).resolves.toContain('criteria');
  const diagnostics = JSON.parse(await readFileText(path.join(planDir, 'compiler-diagnostics.json'))) as CompilerDiagnostics;
  expect(validateCompilerDiagnostics(diagnostics)).toEqual({ ok: true, errors: [] });
  expect(diagnostics.compilerStatus).toBe('complete');
  expect(diagnostics.coverage.incompleteCriteria).toEqual([]);

  // Every plan file exists on disk.
  for (const plan of orchestration.plans) {
    await expect(readFileText(path.join(planDir, `${plan.id}.md`))).resolves.toContain('## Traceability');
  }
}

describe('bounded compiler parity fixtures', () => {
  it('errand: a small detailed PRD compiles via the fast path and passes the gate', async () => {
    const run = await compileParityFixture({
      planSetName: 'parity-errand',
      scope: 'errand',
      criteria: ['engine updates `packages/engine/src/a.ts` with a documented flag.'],
      files: { 'packages/engine/src/a.ts': 'export const flag = true;\n' },
      fastPath: true,
    });

    expect(run.tasks).toHaveLength(1);
    await assertParityArtifacts(run, 'parity-errand');
    // Fast path: zero exploration runs, one atom planner, zero reducer runs.
    expect(run.harness.ranPlanIds.filter((planId) => planId === 'repository-exploration')).toHaveLength(0);
    expect(run.harness.ranPlanIds.filter((planId) => planId === run.tasks[0].atomId)).toHaveLength(1);
    expect(run.harness.ranPlanIds.filter((planId) => planId?.startsWith('reduce-'))).toHaveLength(0);
  });

  it('excursion: a multi-subsystem PRD compiles through one reduce node and passes the gate', async () => {
    const criteria = [
      'engine updates `packages/engine/src/scheduler.ts` to expose queue depth.',
      'engine records queue depth transitions in `packages/engine/src/metrics.ts`.',
      'client renders queue depth from `packages/client/src/queue-view.ts`.',
      'docs describe the queue depth metric in `docs/queue-depth.md`.',
    ];
    const run = await compileParityFixture({
      planSetName: 'parity-excursion',
      scope: 'excursion',
      criteria,
      config: FRAGMENTING_CONFIG,
      files: {
        'packages/engine/src/scheduler.ts': 'export const scheduler = true;\n',
        'packages/engine/src/metrics.ts': 'export const metrics = true;\n',
        'packages/client/src/queue-view.ts': 'export const view = true;\n',
        'docs/queue-depth.md': '# Queue depth\n',
      },
    });

    expect(run.tasks.length).toBeGreaterThanOrEqual(2);
    expect(run.tree.nodes.length).toBeGreaterThanOrEqual(1);
    await assertParityArtifacts(run, 'parity-excursion');
    // One plan per atom, all reduce nodes exercised.
    const reduceRuns = run.harness.ranPlanIds.filter((planId) => planId?.startsWith('reduce-'));
    expect(reduceRuns.length).toBe(run.tree.nodes.length);
  });

  it('expedition: a many-subsystem PRD compiles through a multi-node reduce tree and passes the gate', async () => {
    // 5 subsystems x 2 criteria stays within the compiler's shared-brief
    // budgets while still yielding a multi-atom map and a multi-node tree.
    const subsystems = ['alpha', 'beta', 'gamma', 'delta', 'epsilon'];
    const criteria = subsystems.flatMap((name) => [
      `${name} exposes its runtime state from \`packages/${name}/src/state.ts\`.`,
      `${name} validates inbound payloads in \`packages/${name}/src/validate.ts\`.`,
    ]);
    const files = Object.fromEntries(subsystems.flatMap((name) => [
      [`packages/${name}/src/state.ts`, `export const ${name}State = true;\n`],
      [`packages/${name}/src/validate.ts`, `export const ${name}Validate = true;\n`],
    ]));
    const run = await compileParityFixture({
      planSetName: 'parity-expedition',
      scope: 'expedition',
      criteria,
      files,
      config: FRAGMENTING_CONFIG,
    });

    // Expedition scale: multiple atoms and a real reduce tree.
    expect(run.tasks.length).toBeGreaterThanOrEqual(4);
    expect(run.tree.nodes.length).toBeGreaterThanOrEqual(2);
    await assertParityArtifacts(run, 'parity-expedition');
    const completes = run.events.filter((event) => event.type === 'planning:complete');
    expect(completes[0].plans.length).toBe(run.tasks.length);
  });
});
