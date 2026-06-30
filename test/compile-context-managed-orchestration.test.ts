import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG, resolvePlanningDecompositionLimits } from '@eforge-build/engine/config';
import { singletonRegistry } from '@eforge-build/engine/agent-runtime-registry';
import type { CompilePreflightRisk, EforgeEvent } from '@eforge-build/engine/events';
import { getCompileStage } from '@eforge-build/engine/pipeline';
import { buildPlanningAtomTasks, derivePlanningAtomGraph, deriveSharedPlanningBrief, deriveSourceInventory, type PlanningAtomOutput, type PlanningAtomTask } from '@eforge-build/engine/planner-compiler';
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

function compilerResponses(content: string, cfg = config()): StubResponse[] {
  const tasks = expectedTasks(content, cfg);
  const outputs = tasks.map(completedOutput);
  return [...outputs.map((output) => ({ resultText: JSON.stringify(output) })), { resultText: JSON.stringify(completedReduceOutput(outputs)) }];
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

function completedReduceOutput(outputs: PlanningAtomOutput[]) {
  return {
    status: 'completed',
    compactSummary: 'Reduced compiler synthesis.',
    planFragments: outputs.flatMap((output) => output.planFragments ?? []),
    moduleCandidates: [{ moduleId: 'module-reduced', title: 'Reduced module', criterionIds: outputs.flatMap((output) => output.moduleCandidates?.flatMap((module) => module.criterionIds) ?? []), aspectIds: outputs.flatMap((output) => output.moduleCandidates?.flatMap((module) => module.aspectIds) ?? []), description: 'Implement reduced compiler work.', validationExpectation: 'Reduced checks pass.' }],
    validationStrategy: 'Run relevant checks.',
  };
}

function hash(value: string): string {
  return `h${value.length}`.padEnd(64, '0');
}

describe('compile planner stage bounded compiler orchestration branch', () => {
  it('routes overflow-risk bounded-decomposition through the canonical compiler without a broad root planner prompt', async () => {
    const content = source();
    const cfg = config();
    const harness = new StubHarness([composer(), ...compilerResponses(content, cfg)]);
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
    expect(harness.prompts).toHaveLength(1 + expectedTasks(content, cfg).length + 1);
    expect(harness.prompts[0]).toContain(sentinel);
    expect(harness.calls.slice(1).every((call) => call.tools === 'none')).toBe(true);
    expect(ctx.plans.map((plan) => plan.id)).toEqual(['module-reduced']);
  });

  it('falls back to the bounded compiler when an elevated direct planner run trips the live guard', async () => {
    const content = source();
    const cfg = config();
    const harness = new StubHarness([
      composer(),
      { events: [{ kind: 'usage', usage: { input: 101, total: 101 }, numTurns: 1 }] },
      ...compilerResponses(content, cfg),
    ]);
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
    expect(harness.prompts[1]).toContain(sentinel);
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
    expect(ctx.contextManagedPlanning).toBeUndefined();
  });
});
