import { describe, expect, it } from 'vitest';
import { DEFAULT_CONFIG } from '@eforge-build/engine/config';
import { singletonRegistry } from '@eforge-build/engine/agent-runtime-registry';
import type { CompilePreflightRisk, EforgeEvent } from '@eforge-build/engine/events';
import { getCompileStage } from '@eforge-build/engine/pipeline';
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

function unitResponse(id: string): StubResponse {
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

describe('compile planner stage context-managed orchestration branch', () => {
  it('routes overflow-risk bounded-decomposition through the controller and avoids a broad root planner prompt', async () => {
    const harness = new StubHarness([composer(), ...Array.from({ length: 8 }, (_, index) => unitResponse(String(index + 1)))]);
    const ctx = makePipelineCtx({
      cwd: makeTempDir(),
      sourceContent: source(),
      compilePreflight: boundedRisk(),
      config: config(),
      pipeline: { ...TEST_PIPELINE, compile: ['planner'] },
      agentRuntimes: singletonRegistry(harness),
    });

    const events = await collect(getCompileStage('planner')(ctx));

    expect(events.some((event) => event.type === 'planning:decomposition:start')).toBe(true);
    expect(events.some((event) => event.type === 'planning:decomposition:schedule')).toBe(true);
    expect(events.some((event) => event.type === 'planning:decomposition:synthesis:complete')).toBe(true);
    expect(harness.prompts).toHaveLength(1 + ctx.contextManagedPlanning!.unitOutputs.length);
    expect(harness.prompts[0]).toContain(sentinel);
    expect(harness.prompts.slice(1).every((prompt) => prompt.includes('unit-') && !prompt.includes(sentinel))).toBe(true);
    expect(ctx.contextManagedPlanning).toMatchObject({ planningParallelism: 2 });
  });

  it('falls back to context-managed decomposition when an elevated direct planner run trips the live guard', async () => {
    const harness = new StubHarness([
      composer(),
      { events: [{ kind: 'usage', usage: { input: 101, total: 101 }, numTurns: 1 }] },
      ...Array.from({ length: 8 }, (_, index) => unitResponse(`fallback-${index + 1}`)),
    ]);
    const ctx = makePipelineCtx({
      cwd: makeTempDir(),
      sourceContent: source(),
      compilePreflight: elevatedRisk(),
      compileContextGuardLimits: { maxObservedInputTokens: 100 },
      config: config(),
      pipeline: { ...TEST_PIPELINE, compile: ['planner'] },
      agentRuntimes: singletonRegistry(harness),
    });

    const events = await collect(getCompileStage('planner')(ctx));

    expect(events.some((event) => event.type === 'planning:scope-context:failure')).toBe(true);
    expect(events.some((event) => event.type === 'planning:decomposition:start')).toBe(true);
    expect(events.some((event) => event.type === 'planning:complete')).toBe(true);
    expect(ctx.contextManagedPlanning).toBeDefined();
    expect(harness.prompts[1]).toContain(sentinel);
    expect(harness.prompts.slice(2).every((prompt) => prompt.includes('unit-') && !prompt.includes(sentinel))).toBe(true);
  });

  it('leaves normal-risk planner-stage runs on the existing direct planner path', async () => {
    const harness = new StubHarness([
      composer(),
      unitResponse('direct-root'),
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
