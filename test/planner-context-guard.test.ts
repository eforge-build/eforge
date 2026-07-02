import { describe, it, expect } from 'vitest';

import type { AgentRole, EforgeEvent } from '@eforge-build/engine/events';
import {
  createPlannerContextObservationState,
  observePlannerContextUsage,
  setPlannerContextPromptBytes,
} from '@eforge-build/engine/compile-resilience/context-guard';

const USAGE = { input: 0, output: 0, total: 0, cacheRead: 0, cacheCreation: 0 };

describe('planner-family context observation state', () => {

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
