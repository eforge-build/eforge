import { describe, it, expect } from 'vitest';

import type { AgentHarness, AgentRunOptions } from '@eforge-build/engine/harness';
import type { AgentRole, EforgeEvent, CompileContextGuardDiagnostics, CompilePreflightRisk } from '@eforge-build/engine/events';
import { composePipeline } from '@eforge-build/engine/agents/pipeline-composer';
import { runModulePlanner } from '@eforge-build/engine/agents/module-planner';
import { runPlanner } from '@eforge-build/engine/agents/planner';
import {
  CompileScopeContextError,
  createCompileContextGuard,
  createPlannerContextObservationState,
  observePlannerContextUsage,
  setPlannerContextPromptBytes,
} from '@eforge-build/engine/compile-resilience/context-guard';
import { StubHarness } from './stub-harness.js';
import { collectEvents } from './test-events.js';
import { useTempDir } from './test-tmpdir.js';

const USAGE = { input: 0, output: 0, total: 0, cacheRead: 0, cacheCreation: 0 };

describe('planner-family context guard', () => {
  const makeTempDir = useTempDir('eforge-planner-context-guard-');

  it('throws CompileScopeContextError with bounded failure details when prompt bytes exceed limit', () => {
    const guard = createCompileContextGuard({ stage: 'planner', risk: risk(), limits: { maxPromptBytes: 5, maxExplanationBytes: 220 } });

    expect(() => guard.assertPrompt('0123456789')).toThrow(CompileScopeContextError);
    try {
      guard.assertPrompt('0123456789');
    } catch (err) {
      expect(err).toBeInstanceOf(CompileScopeContextError);
      const failure = (err as CompileScopeContextError).failure;
      expect(failure.source).toBe('live-context-guard');
      expect(failure.failureKind).toBe('context-budget');
      expect(failure.stage).toBe('planner');
      expect(failure.observed?.promptBytes).toBe(10);
      expect(failure.risk?.level).toBe('elevated');
      expect(failure.recovery.action).toBe('retry-as-expedition');
      expect(Buffer.byteLength(failure.explanation, 'utf8')).toBeLessThanOrEqual(220);
    }
  });

  it('includes model-aware guard diagnostics on live guard failures', () => {
    const diagnostics: CompileContextGuardDiagnostics = {
      provider: 'anthropic',
      modelId: 'claude-sonnet-4-5',
      metadataSource: 'registry',
      contextWindow: 1_000_000,
      outputReserveTokens: 64_000,
      overheadReserveTokens: 8_192,
      safetyMargin: 0.9,
      limits: { maxPromptBytes: 1_500_000, maxObservedInputTokens: 10, maxExplanationBytes: 1_500 },
    };
    const guard = createCompileContextGuard({ stage: 'planner', limits: { maxObservedInputTokens: 10 }, guardDiagnostics: diagnostics });
    guard.assertPrompt('ok');

    try {
      guard.observe(usageEvent('planner', { input: 11, total: 11 }, false));
      throw new Error('expected guard failure');
    } catch (err) {
      expect(err).toBeInstanceOf(CompileScopeContextError);
      expect((err as CompileScopeContextError).failure.guardDiagnostics).toMatchObject({
        provider: 'anthropic',
        modelId: 'claude-sonnet-4-5',
        metadataSource: 'registry',
        contextWindow: 1_000_000,
        outputReserveTokens: 64_000,
        overheadReserveTokens: 8_192,
        safetyMargin: 0.9,
        limits: expect.objectContaining({ maxObservedInputTokens: 10 }),
      });
    }
  });

  it('checks per-turn input instead of accumulating normal non-final usage deltas', () => {
    const guard = createCompileContextGuard({ stage: 'planner', limits: { maxObservedInputTokens: 10 } });
    guard.assertPrompt('ok');
    guard.observe(usageEvent('planner', { input: 6, total: 6 }, false));
    expect(() => guard.observe(usageEvent('planner', { input: 5, total: 5 }, false))).not.toThrow();
  });

  it('exposes shared planner-family observation state for soft inspection users', () => {
    const state = createPlannerContextObservationState();
    setPlannerContextPromptBytes(state, 'hello');
    const first = observePlannerContextUsage(state, usageEvent('planner', { input: 6, total: 6 }, false), 'planner');
    const ignored = observePlannerContextUsage(state, usageEvent('builder', { input: 100, total: 100 }, false), 'planner');
    const second = observePlannerContextUsage(state, usageEvent('planner', { input: 0, total: 10 }, false, 2), 'planner');

    expect(first).toMatchObject({ inputTokens: 6, turns: 1, final: false });
    expect(ignored).toBeUndefined();
    expect(second).toMatchObject({ inputTokens: 10, turns: 2, final: false });
    expect(state.observed).toMatchObject({ promptBytes: 5, inputTokens: 10, outputTokens: 0, turns: 3 });
  });

  it('throws when a single non-final usage event crosses the input-token budget', () => {
    const guard = createCompileContextGuard({ stage: 'planner', limits: { maxObservedInputTokens: 10 } });
    guard.assertPrompt('ok');
    expect(() => guard.observe(usageEvent('planner', { input: 11, total: 11 }, false))).toThrow(CompileScopeContextError);
  });

  it('throws when non-final usage crosses the turn budget', () => {
    const guard = createCompileContextGuard({ stage: 'planner', limits: { maxObservedInputTokens: 100, maxObservedTurns: 1 } });
    guard.assertPrompt('ok');
    expect(() => guard.observe(usageEvent('planner', { input: 1, total: 1 }, false, 2))).toThrow(CompileScopeContextError);
  });

  it('uses usage.total as the input-budget fallback when non-final input is zero', () => {
    const guard = createCompileContextGuard({ stage: 'pipeline-composer', limits: { maxObservedInputTokens: 10 } });
    guard.assertPrompt('ok');
    expect(() => guard.observe(usageEvent('pipeline-composer', { input: 0, total: 11 }, false))).toThrow(CompileScopeContextError);
  });

  it('records but does not throw for final usage above the threshold', () => {
    const guard = createCompileContextGuard({ stage: 'module-planner', limits: { maxObservedInputTokens: 10 } });
    guard.assertPrompt('ok');
    expect(() => guard.observe(usageEvent('module-planner', { input: 50, total: 50 }, true))).not.toThrow();
  });

  it('allows normal small prompt and usage below thresholds', () => {
    const guard = createCompileContextGuard({ stage: 'planner', limits: { maxPromptBytes: 100, maxObservedInputTokens: 100, maxObservedTurns: 10 } });
    expect(() => {
      guard.assertPrompt('small prompt');
      guard.observe(usageEvent('planner', { input: 5, total: 5 }, false));
    }).not.toThrow();
  });

  it('runPlanner prompt guard throws before the harness is called without aborting the parent controller', async () => {
    const backend = new StubHarness([{ text: 'not reached' }]);
    const abortController = new AbortController();
    await expect(collectEvents(runPlanner('Build widgets', {
      harness: backend,
      cwd: makeTempDir(),
      auto: true,
      scope: 'excursion',
      abortController,
      contextGuard: { stage: 'planner', limits: { maxPromptBytes: 1 } },
    }))).rejects.toThrow(CompileScopeContextError);
    expect(backend.calls).toHaveLength(0);
    expect(abortController.signal.aborted).toBe(false);
  });

  it('composePipeline prompt guard throws before the harness is called', async () => {
    const backend = new StubHarness([{ text: 'not reached' }]);
    await expect(collectEvents(composePipeline({
      harness: backend,
      source: '# PRD\nBuild widgets',
      cwd: makeTempDir(),
      contextGuard: { stage: 'pipeline-composer', limits: { maxPromptBytes: 1 } },
    }))).rejects.toThrow(CompileScopeContextError);
    expect(backend.calls).toHaveLength(0);
  });

  it('runModulePlanner prompt guard throws before the harness is called', async () => {
    const backend = new StubHarness([{ text: 'not reached' }]);
    await expect(collectEvents(runModulePlanner({
      harness: backend,
      cwd: makeTempDir(),
      planSetName: 'large',
      moduleId: 'mod-a',
      moduleDescription: 'Large module',
      moduleDependsOn: [],
      architectureContent: '# Architecture',
      sourceContent: '# PRD\nLarge source',
      contextGuard: { stage: 'module-planner', limits: { maxPromptBytes: 1 } },
    }))).rejects.toThrow(CompileScopeContextError);
    expect(backend.calls).toHaveLength(0);
  });

  it('composePipeline live usage guard throws bounded pipeline-composer failure', async () => {
    const backend = new UsageHarness([usageEvent('pipeline-composer', { input: 20, total: 20 }, false)]);
    try {
      await collectEvents(composePipeline({
        harness: backend,
        source: '# PRD',
        cwd: makeTempDir(),
        contextGuard: { stage: 'pipeline-composer', limits: { maxObservedInputTokens: 10, maxExplanationBytes: 300 } },
      }));
      throw new Error('expected composePipeline to throw');
    } catch (err) {
      expect(err).toBeInstanceOf(CompileScopeContextError);
      const failure = (err as CompileScopeContextError).failure;
      expect(failure.stage).toBe('pipeline-composer');
      expect(failure.observed?.inputTokens).toBeGreaterThan(10);
      expect(Buffer.byteLength(failure.explanation, 'utf8')).toBeLessThanOrEqual(300);
    }
    expect(backend.calls).toHaveLength(1);
  });

  it('runModulePlanner default guard preserves small prompt and completes', async () => {
    const backend = new StubHarness([{ text: 'module planned' }]);
    await collectEvents(runModulePlanner({
      harness: backend,
      cwd: makeTempDir(),
      planSetName: 'small',
      moduleId: 'mod-a',
      moduleDescription: 'Small module',
      moduleDependsOn: [],
      architectureContent: '# Architecture',
      sourceContent: '# PRD\nSmall source',
    }));

    expect(backend.calls).toHaveLength(1);
    expect(backend.prompts[0]).toContain('# PRD\nSmall source');
  });
});

function usageEvent(agent: AgentRole, usage: { input: number; total: number }, final: boolean, numTurns = 1): EforgeEvent {
  return {
    type: 'agent:usage',
    agentId: 'agent-1',
    agent,
    usage: { ...USAGE, ...usage },
    costUsd: 0,
    numTurns,
    final,
    timestamp: new Date().toISOString(),
  };
}

function risk(): CompilePreflightRisk {
  return {
    level: 'elevated',
    sourceBytes: 100,
    promptSourceBytes: 90,
    acceptanceCriteriaCount: 1,
    score: 50,
    generatedInventory: { detected: false, contentHashes: [], pathReferences: [], headings: [], blockCount: 0, sidecarCount: 0, omittedBytes: 0 },
    subsystemBreadth: { count: 1, subsystems: ['api'], evidence: ['api'] },
    reasons: ['test'],
    recommendation: { action: 'retry-as-expedition', eligible: true, reason: 'test recovery' },
  };
}

class UsageHarness implements AgentHarness {
  readonly calls: AgentRunOptions[] = [];

  constructor(private readonly events: EforgeEvent[]) {}

  effectiveCustomToolName(name: string): string {
    return name;
  }

  async *run(options: AgentRunOptions, agent: AgentRole, planId?: string): AsyncGenerator<EforgeEvent> {
    this.calls.push(options);
    const agentId = 'agent-usage';
    yield { type: 'agent:start', planId, agent, agentId, model: 'stub-model', harness: 'claude-sdk', harnessSource: 'tier', tier: 'stub', tierSource: 'tier', timestamp: new Date().toISOString() };
    for (const event of this.events) yield { ...event, agent, agentId, planId };
    yield { type: 'agent:result', planId, agent, agentId, result: { durationMs: 1, durationApiMs: 1, numTurns: 1, totalCostUsd: 0, usage: USAGE, modelUsage: {}, resultText: '{"scope":"errand","compile":["planner"],"defaultBuild":["implement"],"defaultReview":{"strategy":"single","perspectives":["code"],"maxRounds":1,"evaluatorStrictness":"lenient"},"rationale":"ok"}' } };
    yield { type: 'agent:stop', planId, agent, agentId, timestamp: new Date().toISOString() };
  }
}
