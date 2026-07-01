import { describe, it, expect, vi } from 'vitest';
import type { EforgeEvent, AgentRole } from '@eforge-build/engine/events';
import type { RuntimeChoiceRouterRegistration } from '@eforge-build/engine/extensions/types';
import type { AgentHarness, AgentRunOptions } from '@eforge-build/engine/harness';
import { StubHarness } from './stub-harness.js';
import { collectEvents, findEvent, filterEvents } from './test-events.js';
import { runGapCloser, type GapCloserContext } from '@eforge-build/engine/agents/gap-closer';
import { DEFAULT_TIER_MAX_TURNS } from '@eforge-build/engine/config';
import type { BuildStageContext } from '@eforge-build/engine/pipeline';
import { singletonRegistry } from '@eforge-build/engine/agent-runtime-registry';

const GAPS = [
  { requirement: 'Must support dark mode', explanation: 'No dark mode CSS classes found in the theme configuration' },
];

const PRD_CONTENT = '# Feature PRD\n\n## Requirements\n\n- Must support dark mode\n- Must have responsive layout';

function makePipelineContext(agentRegistryOverride?: ReturnType<typeof singletonRegistry>) {
  const stubHarness = new StubHarness([]);
  return {
    config: {
      agents: {
        maxTurns: 30,
        tiers: {
          planning: { harness: 'claude-sdk', model: 'claude-opus-4-7', effort: 'high', maxTurns: DEFAULT_TIER_MAX_TURNS.planning },
          implementation: { harness: 'claude-sdk', model: 'claude-sonnet-4-6', effort: 'medium', maxTurns: DEFAULT_TIER_MAX_TURNS.implementation },
          review: { harness: 'claude-sdk', model: 'claude-opus-4-7', effort: 'high', maxTurns: DEFAULT_TIER_MAX_TURNS.review },
          evaluation: { harness: 'claude-sdk', model: 'claude-opus-4-7', effort: 'high', maxTurns: DEFAULT_TIER_MAX_TURNS.evaluation },
        },
      },
    } as never,
    pipeline: { compile: [], build: [] } as never,
    tracing: { createSpan: () => ({ setInput: () => {}, end: () => {}, error: () => {} }) } as never,
    planSetName: 'test-set',
    orchConfig: { name: 'test', description: '', created: '', mode: 'errand' as const, baseBranch: 'main', pipeline: { compile: [], build: [] }, plans: [] } as never,
    planFileMap: new Map(),
    agentRuntimes: agentRegistryOverride ?? singletonRegistry(stubHarness),
  };
}

class StreamingDeltaHarness implements AgentHarness {
  readonly calls: AgentRunOptions[] = [];

  constructor(private readonly deltas: string[], private readonly resultText: string) {}

  async *run(options: AgentRunOptions, agent: AgentRole, planId?: string): AsyncGenerator<EforgeEvent> {
    this.calls.push(options);
    const agentId = crypto.randomUUID();
    yield { type: 'agent:start', planId, agent, agentId, model: 'stub-model', harness: 'pi', harnessSource: 'tier', tier: 'stub', tierSource: 'tier', timestamp: new Date().toISOString() };
    for (const delta of this.deltas) {
      yield { type: 'agent:message', planId, agentId, agent, content: delta };
    }
    yield {
      type: 'agent:result',
      planId,
      agentId,
      agent,
      result: {
        durationMs: 100,
        durationApiMs: 80,
        numTurns: 1,
        totalCostUsd: 0,
        usage: { input: 0, output: 0, total: 0, cacheRead: 0, cacheCreation: 0 },
        modelUsage: {},
        resultText: this.resultText,
      },
    };
    yield { type: 'agent:stop', planId, agent, agentId, timestamp: new Date().toISOString() };
  }
}

function makeOptions(backend: AgentHarness, overrides?: Partial<GapCloserContext>): GapCloserContext {
  return {
    harness: backend,
    cwd: '/tmp',
    gaps: GAPS,
    prdContent: PRD_CONTENT,
    pipelineContext: makePipelineContext(),
    runBuildPipeline: async function* () {
      yield { timestamp: new Date().toISOString(), type: 'plan:build:start', planId: 'gap-close' } as EforgeEvent;
      yield { timestamp: new Date().toISOString(), type: 'plan:build:complete', planId: 'gap-close' } as EforgeEvent;
    },
    ...overrides,
  };
}

describe('runGapCloser two-stage flow', () => {
  it('emits gap_close:start with gapCount', async () => {
    const backend = new StubHarness([{ text: '## Overview\nFix dark mode\n\n## Files\n- src/theme.ts: Add dark classes' }]);

    const events = await collectEvents(runGapCloser(makeOptions(backend)));

    const start = findEvent(events, 'gap_close:start');
    expect(start).toBeDefined();
    expect((start as { gapCount?: number }).gapCount).toBe(1);
  });

  it('calls plan generation agent with maxTurns from the planning tier', async () => {
    const backend = new StubHarness([{ text: '## Overview\nFix it\n\n## Files\n- src/a.ts: change' }]);

    await collectEvents(runGapCloser(makeOptions(backend)));

    expect(backend.calls).toHaveLength(1);
    expect(backend.calls[0].maxTurns).toBe(DEFAULT_TIER_MAX_TURNS.planning);
    expect(backend.calls[0].tools).toBe('coding');
  });

  it('honors caller-resolved maxTurns and runtime choice metadata for plan generation', async () => {
    const backend = new StubHarness([{ text: '## Overview\nFix it\n\n## Files\n- src/a.ts: change' }]);

    const events = await collectEvents(runGapCloser(makeOptions(backend, {
      maxTurns: 7,
      runtimeChoice: 'routed',
      runtimeChoiceQualified: 'implementation.routed',
      runtimeChoiceSource: 'extension-router',
      runtimeChoiceRouter: 'gap-router',
      model: { id: 'routed-model' },
    })));

    expect(backend.calls).toHaveLength(1);
    expect(backend.calls[0].maxTurns).toBe(7);
    const start = filterEvents(events, 'agent:start').find((event) => event.agent === 'gap-closer');
    expect(start).toMatchObject({
      model: 'routed-model',
      runtimeChoice: 'routed',
      runtimeChoiceQualified: 'implementation.routed',
      runtimeChoiceSource: 'extension-router',
      runtimeChoiceRouter: 'gap-router',
    });
  });

  it('emits the plan generation gap-closer agent on the gap-close lane', async () => {
    const backend = new StubHarness([{ text: '## Overview\nFix it\n\n## Files\n- src/a.ts: change' }]);

    const events = await collectEvents(runGapCloser(makeOptions(backend)));

    const starts = filterEvents(events, 'agent:start').filter((event) => event.agent === 'gap-closer');
    expect(starts).toHaveLength(1);
    expect(starts[0].planId).toBe('gap-close');
  });

  it('passes generated plan to runBuildPipeline with planId gap-close', async () => {
    const backend = new StubHarness([{ text: '## Overview\nFix dark mode\n\n## Files\n- src/theme.ts: Add dark classes' }]);

    let capturedCtx: BuildStageContext | undefined;
    const runBuildPipeline = async function* (ctx: BuildStageContext): AsyncGenerator<EforgeEvent> {
      capturedCtx = ctx;
      yield { timestamp: new Date().toISOString(), type: 'plan:build:start', planId: ctx.planId } as EforgeEvent;
      yield { timestamp: new Date().toISOString(), type: 'plan:build:complete', planId: ctx.planId } as EforgeEvent;
    };

    await collectEvents(runGapCloser(makeOptions(backend, { runBuildPipeline })));

    expect(capturedCtx).toBeDefined();
    expect(capturedCtx!.planId).toBe('gap-close');
    expect(capturedCtx!.build).toEqual(['implement', 'review-cycle']);
  });

  it('preserves extension runtime-choice router metadata on the synthetic BuildStageContext', async () => {
    const backend = new StubHarness([{ text: '## Overview\nFix dark mode\n\n## Files\n- src/theme.ts: Add dark classes' }]);
    const routers: RuntimeChoiceRouterRegistration[] = [{
      kind: 'runtimeChoiceRouter',
      extensionName: 'test-ext',
      extensionPath: '/ext/router.js',
      name: 'gap-router',
      value: { name: 'gap-router', resolveRuntimeChoice: (() => ({ choice: 'default' })) as never },
    }];

    let capturedCtx: BuildStageContext | undefined;
    const runBuildPipeline = async function* (ctx: BuildStageContext): AsyncGenerator<EforgeEvent> {
      capturedCtx = ctx;
      yield { timestamp: new Date().toISOString(), type: 'plan:build:start', planId: ctx.planId } as EforgeEvent;
      yield { timestamp: new Date().toISOString(), type: 'plan:build:complete', planId: ctx.planId } as EforgeEvent;
    };

    await collectEvents(runGapCloser(makeOptions(backend, {
      runBuildPipeline,
      pipelineContext: {
        ...makePipelineContext(),
        extensionRuntimeChoiceRouters: routers,
        configProfileName: 'gap-profile',
        extensionConfigDir: '/tmp/project/.eforge',
      },
    })));

    expect(capturedCtx).toBeDefined();
    expect(capturedCtx!.extensionRuntimeChoiceRouters).toBe(routers);
    expect(capturedCtx!.configProfileName).toBe('gap-profile');
    expect(capturedCtx!.extensionConfigDir).toBe('/tmp/project/.eforge');
  });

  it('uses final agent result text instead of the last streamed message delta', async () => {
    const fullPlan = '## Overview\nFix dark mode\n\n## Files\n- src/theme.ts: Add dark classes.';
    const backend = new StreamingDeltaHarness(['## Overview\n', 'Fix dark mode', '.'], fullPlan);

    const events = await collectEvents(runGapCloser(makeOptions(backend)));

    const ready = findEvent(events, 'gap_close:plan_ready') as { planBody?: string } | undefined;
    expect(ready?.planBody).toBe(fullPlan);
  });

  it('emits gap_close:complete with passed: true on success', async () => {
    const backend = new StubHarness([{ text: '## Overview\nFix\n\n## Files\n- src/a.ts: change' }]);

    const events = await collectEvents(runGapCloser(makeOptions(backend)));

    const complete = findEvent(events, 'gap_close:complete');
    expect(complete).toBeDefined();
    expect((complete as { passed?: boolean }).passed).toBe(true);
  });

  it('emits gap_close:complete with passed: false when plan generation fails', async () => {
    const backend = new StubHarness([{ error: new Error('Agent crashed') }]);

    const events = await collectEvents(runGapCloser(makeOptions(backend)));

    const complete = findEvent(events, 'gap_close:complete');
    expect(complete).toBeDefined();
    expect((complete as { passed?: boolean }).passed).toBe(false);

    // runBuildPipeline should NOT have been called
    const buildStarts = filterEvents(events, 'plan:build:start');
    expect(buildStarts).toHaveLength(0);
  });

  it('emits gap_close:complete with passed: false when agent returns no plan', async () => {
    const backend = new StubHarness([{ text: '' }]);

    const events = await collectEvents(runGapCloser(makeOptions(backend)));

    const complete = findEvent(events, 'gap_close:complete');
    expect(complete).toBeDefined();
    expect((complete as { passed?: boolean }).passed).toBe(false);
  });

  it('re-throws AbortError', async () => {
    const abortError = new Error('The operation was aborted');
    abortError.name = 'AbortError';
    const backend = new StubHarness([{ error: abortError }]);

    let thrown: Error | undefined;
    const events: EforgeEvent[] = [];
    try {
      for await (const event of runGapCloser(makeOptions(backend))) {
        events.push(event);
      }
    } catch (err) {
      thrown = err as Error;
    }

    expect(thrown).toBeDefined();
    expect(thrown!.name).toBe('AbortError');

    // Start event emitted before the error
    expect(findEvent(events, 'gap_close:start')).toBeDefined();
    // Complete event NOT emitted - generator threw
    expect(findEvent(events, 'gap_close:complete')).toBeUndefined();
  });

  it('forwards completionPercent to gap_close:start event', async () => {
    const backend = new StubHarness([{ text: '## Overview\nFix\n\n## Files\n- src/a.ts: change' }]);

    const events = await collectEvents(runGapCloser(makeOptions(backend, { completionPercent: 82 })));

    const start = findEvent(events, 'gap_close:start');
    expect(start).toBeDefined();
    expect((start as { completionPercent?: number }).completionPercent).toBe(82);
  });

  it('omits completionPercent from gap_close:start when not provided', async () => {
    const backend = new StubHarness([{ text: '## Overview\nFix\n\n## Files\n- src/a.ts: change' }]);

    const events = await collectEvents(runGapCloser(makeOptions(backend)));

    const start = findEvent(events, 'gap_close:start');
    expect(start).toBeDefined();
    expect((start as { completionPercent?: number }).completionPercent).toBeUndefined();
  });

  it('emits gap_close:complete with passed: false when build pipeline throws', async () => {
    const backend = new StubHarness([{ text: '## Overview\nFix\n\n## Files\n- src/a.ts: change' }]);

    const runBuildPipeline = async function* (): AsyncGenerator<EforgeEvent> {
      yield { timestamp: new Date().toISOString(), type: 'plan:build:start', planId: 'gap-close' } as EforgeEvent;
      throw new Error('Build pipeline exploded');
    };

    const events = await collectEvents(runGapCloser(makeOptions(backend, { runBuildPipeline })));

    const complete = findEvent(events, 'gap_close:complete');
    expect(complete).toBeDefined();
    expect((complete as { passed?: boolean }).passed).toBe(false);
  });

  it('re-throws AbortError from build pipeline', async () => {
    const backend = new StubHarness([{ text: '## Overview\nFix\n\n## Files\n- src/a.ts: change' }]);

    const abortError = new Error('The operation was aborted');
    abortError.name = 'AbortError';
    const runBuildPipeline = async function* (): AsyncGenerator<EforgeEvent> {
      throw abortError;
    };

    let thrown: Error | undefined;
    const events: EforgeEvent[] = [];
    try {
      for await (const event of runGapCloser(makeOptions(backend, { runBuildPipeline }))) {
        events.push(event);
      }
    } catch (err) {
      thrown = err as Error;
    }

    expect(thrown).toBeDefined();
    expect(thrown!.name).toBe('AbortError');
    expect(findEvent(events, 'gap_close:complete')).toBeUndefined();
  });

  it('formats gaps and PRD content into prompt', async () => {
    const backend = new StubHarness([{ text: '## Overview\nPlan\n\n## Files\n- f.ts: change' }]);

    await collectEvents(runGapCloser(makeOptions(backend)));

    expect(backend.prompts).toHaveLength(1);
    expect(backend.prompts[0]).toContain('Must support dark mode');
    expect(backend.prompts[0]).toContain('No dark mode CSS classes found');
    expect(backend.prompts[0]).toContain('Feature PRD');
  });

  it('emits gap_close:complete with passed: false when runBuildPipeline yields plan:build:failed', async () => {
    const backend = new StubHarness([{ text: '## Overview\nFix\n\n## Files\n- src/a.ts: change' }]);

    const runBuildPipeline = async function* (): AsyncGenerator<EforgeEvent> {
      yield { timestamp: new Date().toISOString(), type: 'plan:build:start', planId: 'gap-close' } as EforgeEvent;
      yield { timestamp: new Date().toISOString(), type: 'plan:build:failed', planId: 'gap-close', error: 'Builder stopped with error' } as EforgeEvent;
    };

    const events = await collectEvents(runGapCloser(makeOptions(backend, { runBuildPipeline })));

    const completes = filterEvents(events, 'gap_close:complete');
    expect(completes).toHaveLength(1);
    expect((completes[0] as { passed?: boolean }).passed).toBe(false);

    // The plan:build:failed event should still have been forwarded before completion
    const buildFailed = filterEvents(events, 'plan:build:failed');
    expect(buildFailed).toHaveLength(1);
    expect(events.indexOf(buildFailed[0])).toBeLessThan(events.indexOf(completes[0]));
  });
});

describe('runGapCloser registry inheritance', () => {
  it('synthetic BuildStageContext uses inherited agentRuntimes, not gap-closer harness', async () => {
    const gapCloserHarness = new StubHarness([{ text: '## Overview\nFix\n\n## Files\n- src/a.ts: change' }]);

    const implHarness = new StubHarness([]);
    const reviewHarness = new StubHarness([]);
    const evalHarness = new StubHarness([]);

    // Build a registry that maps specific roles to distinct harness instances
    const inheritedRegistry = {
      forRole: (role: string) => {
        if (role === 'builder' || role === 'review-fixer') return implHarness;
        if (role === 'reviewer') return reviewHarness;
        if (role === 'evaluator') return evalHarness;
        return implHarness;
      },
      forRoleResolved: (role: string) => ({
        harness: inheritedRegistry.forRole(role),
        toolbeltSummary: { toolbeltSource: 'default' as const, projectMcpSelection: 'all' as const, projectMcpServerNames: [] },
      }),
    };

    let capturedCtx: BuildStageContext | undefined;
    const runBuildPipeline = async function* (ctx: BuildStageContext): AsyncGenerator<EforgeEvent> {
      capturedCtx = ctx;
      yield { timestamp: new Date().toISOString(), type: 'plan:build:start', planId: ctx.planId } as EforgeEvent;
      yield { timestamp: new Date().toISOString(), type: 'plan:build:complete', planId: ctx.planId } as EforgeEvent;
    };

    await collectEvents(runGapCloser(makeOptions(gapCloserHarness, {
      runBuildPipeline,
      pipelineContext: makePipelineContext(inheritedRegistry as ReturnType<typeof singletonRegistry>),
    })));

    expect(capturedCtx).toBeDefined();
    // The synthetic BuildStageContext should use the inherited registry
    expect(capturedCtx!.agentRuntimes.forRoleResolved('builder').harness).toBe(implHarness);
    expect(capturedCtx!.agentRuntimes.forRoleResolved('review-fixer').harness).toBe(implHarness);
    expect(capturedCtx!.agentRuntimes.forRoleResolved('reviewer').harness).toBe(reviewHarness);
    expect(capturedCtx!.agentRuntimes.forRoleResolved('evaluator').harness).toBe(evalHarness);
    // The gap-closer harness should NOT be the registry harness for implementation roles
    expect(capturedCtx!.agentRuntimes.forRoleResolved('builder').harness).not.toBe(gapCloserHarness);
  });
});
