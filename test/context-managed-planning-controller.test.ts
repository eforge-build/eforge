import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '@eforge-build/engine/config';
import type { CompilePreflightRisk, EforgeEvent } from '@eforge-build/engine/events';
import { CompileScopeContextError } from '@eforge-build/engine/compile-resilience/context-guard';
import { runContextManagedCompilePlanning } from '@eforge-build/engine/compile-resilience/context-managed-planning';
import { makePipelineCtx, TEST_PIPELINE } from './pipeline-helpers.js';
import { StubHarness, type StubResponse } from './stub-harness.js';
import { useTempDir } from './test-tmpdir.js';
import { singletonRegistry } from '@eforge-build/engine/agent-runtime-registry';

const makeTempDir = useTempDir('eforge-context-managed-controller-');
const sentinel = 'ROOT_SOURCE_SENTINEL_DO_NOT_SEND_TO_UNITS';

async function collect(gen: AsyncGenerator<EforgeEvent>): Promise<EforgeEvent[]> {
  const events: EforgeEvent[] = [];
  for await (const event of gen) events.push(event);
  return events;
}

function risk(action: CompilePreflightRisk['recommendation']['action'] = 'bounded-decomposition'): CompilePreflightRisk {
  return {
    level: 'overflow-risk',
    sourceBytes: 100_000,
    promptSourceBytes: 80_000,
    acceptanceCriteriaCount: 4,
    score: 95,
    generatedInventory: { detected: false, contentHashes: ['hash'], pathReferences: [], headings: [], blockCount: 0, sidecarCount: 0, omittedBytes: 0 },
    subsystemBreadth: { count: 4, subsystems: ['engine', 'client', 'console', 'cli'], evidence: ['wide'] },
    pipelineScope: 'excursion',
    reasons: ['overflow'],
    recommendation: { action, eligible: true, reason: 'bounded decomposition required' },
  };
}

function source(count = 4, subsystem = 'subsystem'): string {
  return [`# Large PRD`, '', sentinel, '', '## Acceptance Criteria', ...Array.from({ length: count }, (_, index) => `- ${subsystem} implements independently bounded behavior ${index}`)].join('\n');
}

function config(overrides: Partial<typeof DEFAULT_CONFIG.compile> = {}) {
  return {
    ...DEFAULT_CONFIG,
    plan: { ...DEFAULT_CONFIG.plan, outputDir: 'plans' },
    compile: { ...DEFAULT_CONFIG.compile, planningUnitParallelism: 2, planningUnitMaxCriteriaPerUnit: 1, planningUnitMaxSubsystemsPerUnit: 1, ...overrides },
  };
}

function planResponse(id: string): StubResponse {
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

function ctxWithHarness(harness: StubHarness, overrides: Parameters<typeof makePipelineCtx>[0] = {}) {
  return makePipelineCtx({
    cwd: makeTempDir(),
    sourceContent: source(),
    config: config(),
    compilePreflight: risk(),
    pipeline: { ...TEST_PIPELINE, scope: 'excursion', compile: ['planner'] },
    agentRuntimes: singletonRegistry(harness),
    ...overrides,
  });
}

describe('context-managed planning controller', () => {
  it('emits start, queued, schedule, bounded unit lifecycle, synthesis, and planning complete events', async () => {
    const harness = new StubHarness(Array.from({ length: 8 }, (_, index) => planResponse(String(index + 1))));
    const ctx = ctxWithHarness(harness);

    const events = await collect(runContextManagedCompilePlanning(ctx));
    const schedule = events.find((event): event is Extract<EforgeEvent, { type: 'planning:decomposition:schedule' }> => event.type === 'planning:decomposition:schedule');

    expect(events[0]?.type).toBe('planning:decomposition:start');
    expect(events.some((event) => event.type === 'planning:decomposition:unit:queued')).toBe(true);
    expect(schedule?.decision.parallelism).toBe(2);
    expect(schedule?.decision.selectedBatchUnitIds).toHaveLength(2);
    expect(events.some((event) => event.type === 'planning:decomposition:unit:completed')).toBe(true);
    expect(events.some((event) => event.type === 'planning:decomposition:synthesis:complete')).toBe(true);
    expect(events.at(-1)).toMatchObject({ type: 'planning:complete' });
    expect(ctx.contextManagedPlanning).toMatchObject({ planningParallelism: 2 });
    expect(ctx.plans.length).toBeGreaterThan(0);
    expect(harness.prompts.every((prompt) => prompt.includes('unit-') && !prompt.includes(sentinel))).toBe(true);
  });

  it('marks context-managed compile skipped when all bounded units skip', async () => {
    const harness = new StubHarness(Array.from({ length: 8 }, () => ({ text: '<skip>already implemented</skip>' })));
    const ctx = ctxWithHarness(harness, { sourceContent: source(1), config: config({ planningUnitParallelism: 10 }) });

    const events = await collect(runContextManagedCompilePlanning(ctx));

    expect(ctx.skipped).toBe(true);
    expect(events.at(-1)).toMatchObject({ type: 'planning:skip' });
    expect(events.some((event) => event.type === 'planning:decomposition:synthesis:complete')).toBe(false);
  });

  it('honors compile.planningUnitParallelism overrides in schedule decisions', async () => {
    const harness = new StubHarness(Array.from({ length: 8 }, (_, index) => planResponse(String(index + 1))));
    const ctx = ctxWithHarness(harness, { config: config({ planningUnitParallelism: 3 }), sourceContent: source(6) });

    const events = await collect(runContextManagedCompilePlanning(ctx));
    const firstSchedule = events.find((event): event is Extract<EforgeEvent, { type: 'planning:decomposition:schedule' }> => event.type === 'planning:decomposition:schedule');

    expect(firstSchedule?.decision.parallelism).toBe(3);
    expect(firstSchedule?.decision.selectedBatchUnitIds.length).toBeLessThanOrEqual(3);
  });

  it('recursively splits a failed over-budget unit, queues children, skips the parent, and rewrites graph evidence', async () => {
    const harness = new StubHarness([
      { events: [{ kind: 'usage', usage: { input: 999, total: 999 }, numTurns: 2 }], lateError: new Error('unit exceeded observed budget') },
      ...Array.from({ length: 8 }, (_, index) => planResponse(`child-${index + 1}`)),
    ]);
    const ctx = ctxWithHarness(harness, {
      sourceContent: source(4, 'engine'),
      config: config({ planningUnitParallelism: 1, planningUnitMaxCriteriaPerUnit: 10, planningUnitMaxSubsystemsPerUnit: 10, planningUnitMaxObservedInputTokens: 1, planningUnitMaxSplitAttemptsPerUnit: 1 }),
    });

    const events = await collect(runContextManagedCompilePlanning(ctx));
    const skipped = events.find((event): event is Extract<EforgeEvent, { type: 'planning:decomposition:unit:skipped' }> => event.type === 'planning:decomposition:unit:skipped');
    const graphJson = JSON.parse(await readFile(join(ctx.cwd, 'plans', ctx.planSetName, '.decomposition', 'graph.json'), 'utf8'));

    expect(skipped?.reason).toContain('recursive split');
    expect(graphJson.units.some((unit: { parentId?: string }) => unit.parentId === skipped?.unitId)).toBe(true);
    expect(graphJson.units.find((unit: { unitId: string }) => unit.unitId === skipped?.unitId)?.status).toBe('skipped');
  });

  it('classifies unsplittable bounded unit failure as decomposition-exhausted compile scope context error', async () => {
    const harness = new StubHarness([]);
    const ctx = ctxWithHarness(harness, {
      sourceContent: source(1),
      config: config({ planningUnitMaxPromptSourceBytes: 10, planningUnitMaxDepth: 0, planningUnitMaxSplitAttemptsPerUnit: 1 }),
    });

    await expect(collect(runContextManagedCompilePlanning(ctx))).rejects.toMatchObject({
      failure: { failureKind: 'decomposition-exhausted', source: 'decomposition', stage: 'planning-decomposition', decompositionEvidence: { unitId: expect.any(String), depth: expect.any(Number) } },
    });
    await collectFailureEvents(runContextManagedCompilePlanning(ctx)).then((events) => {
      expect(events.some((event) => event.type === 'planning:decomposition:unit:failed')).toBe(true);
    });
  });
});

async function collectFailureEvents(gen: AsyncGenerator<EforgeEvent>): Promise<EforgeEvent[]> {
  const events: EforgeEvent[] = [];
  try {
    for await (const event of gen) events.push(event);
  } catch (error) {
    expect(error).toBeInstanceOf(CompileScopeContextError);
  }
  return events;
}
