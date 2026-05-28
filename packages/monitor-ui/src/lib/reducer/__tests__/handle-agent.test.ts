import { describe, it, expect } from 'vitest';
import { handleAgentStart, handleAgentUsage, handleAgentResult, handleAgentActivity, handleAgentStop } from '../handle-agent';
import { initialRunState } from '../../reducer';
import type { AgentThread } from '../../reducer';
import type { EforgeEvent } from '../../types';

function makeEvent<T extends EforgeEvent['type']>(
  type: T,
  extra: object,
): Extract<EforgeEvent, { type: T }> {
  return { type, timestamp: '2024-01-15T10:00:00.000Z', sessionId: 's1', ...extra } as unknown as Extract<EforgeEvent, { type: T }>;
}

function makeThread(overrides: Partial<AgentThread> = {}): AgentThread {
  return {
    agentId: 'a1',
    agent: 'builder',
    planId: 'plan-01',
    startedAt: '2024-01-15T10:00:00.000Z',
    endedAt: null,
    durationMs: null,
    inputTokens: null,
    outputTokens: null,
    totalTokens: null,
    cacheRead: null,
    cacheCreation: null,
    costUsd: null,
    numTurns: null,
    model: 'claude-sonnet',
    ...overrides,
  };
}

describe('handle-agent smoke', () => {
  it('handleAgentStart records runtime metadata and toolbelt fields on the new thread', () => {
    const event = makeEvent('agent:start', {
      agentId: 'a1',
      agent: 'builder',
      planId: 'plan-01',
      model: 'claude-sonnet-4-5',
      harness: 'claude-sdk',
      harnessSource: 'tier',
      tier: 'heavy',
      tierSource: 'role',
      effort: 'high',
      effortSource: 'role',
      thinking: { type: 'enabled', budgetTokens: 8000 },
      thinkingSource: 'role',
      effortClamped: false,
      effortOriginal: 'high',
      toolbelt: 'browser-ui',
      toolbeltSource: 'tier',
      projectMcpSelection: 'toolbelt',
      projectMcpServerNames: ['playwright'],
    });
    const delta = handleAgentStart(event, initialRunState);
    const thread = delta?.agentThreads?.[0];
    expect(thread?.tier).toBe('heavy');
    expect(thread?.harness).toBe('claude-sdk');
    expect(thread?.thinking).toBe('enabled (8.0k tokens)');
    expect(thread?.toolbelt).toBe('browser-ui');
    expect(thread?.projectMcpSelection).toBe('toolbelt');
    expect(thread?.endedAt).toBeNull();
  });

  it('handleAgentUsage final path overwrites live usage and updates thread token fields', () => {
    const state = {
      ...initialRunState,
      agentThreads: [makeThread({ agentId: 'a1' })],
      liveAgentUsage: { a1: { input: 100, output: 50, cacheRead: 0, cacheCreation: 0, cost: 0.001, turns: 1 } },
    };
    const event = makeEvent('agent:usage', {
      agentId: 'a1',
      agent: 'builder',
      usage: { input: 2000, output: 1000, total: 3000, cacheRead: 400, cacheCreation: 100 },
      costUsd: 0.02,
      numTurns: 5,
      final: true,
    });
    const delta = handleAgentUsage(event, state);
    expect(delta?.liveAgentUsage?.['a1']?.input).toBe(2000);
    expect(delta?.agentThreads?.[0]?.inputTokens).toBe(2000);
    expect(delta?.agentThreads?.[0]?.totalTokens).toBe(3000);
  });

  it('handleAgentResult accumulates global token totals and updates matched thread with durationMs and resultText', () => {
    const thread = makeThread({ agentId: 'a1', agent: 'builder', planId: 'plan-01', durationMs: null });
    const state = { ...initialRunState, agentThreads: [thread], tokensIn: 100 };
    const event = makeEvent('agent:result', {
      agentId: 'a1',
      agent: 'builder',
      planId: 'plan-01',
      result: {
        durationMs: 5000,
        durationApiMs: 4500,
        numTurns: 2,
        totalCostUsd: 0.01,
        usage: { input: 1000, output: 500, total: 1500, cacheRead: 200, cacheCreation: 50 },
        modelUsage: {},
        resultText: 'Done.',
      },
    });
    const delta = handleAgentResult(event, state);
    expect(delta?.tokensIn).toBe(1100);
    expect(delta?.agentThreads?.[0]?.durationMs).toBe(5000);
    expect(delta?.agentThreads?.[0]?.resultText).toBe('Done.');
  });

  it('handleAgentActivity attaches activity facts to the matched thread by agentId', () => {
    const thread = makeThread({ agentId: 'a1' });
    const state = { ...initialRunState, agentThreads: [thread] };
    const event = makeEvent('agent:activity', {
      agentId: 'a1',
      agent: 'builder',
      planId: 'plan-01',
      attribution: 'exact',
      files: [{ path: 'src/index.ts', additions: 5, deletions: 1 }],
      totals: { filesChanged: 1, additions: 5, deletions: 1 },
    });
    const delta = handleAgentActivity(event, state);
    expect(delta?.agentThreads?.[0]?.activity?.files).toHaveLength(1);
    expect(delta?.agentThreads?.[0]?.activity?.attribution).toBe('exact');
  });

  it('handleAgentStop sets endedAt on matched thread and removes liveAgentUsage entry', () => {
    const thread = makeThread({ agentId: 'a1' });
    const state = {
      ...initialRunState,
      agentThreads: [thread],
      liveAgentUsage: { a1: { input: 100, output: 50, cacheRead: 0, cacheCreation: 0, cost: 0.001, turns: 1 } },
    };
    const event = makeEvent('agent:stop', { agentId: 'a1', agent: 'builder' });
    const delta = handleAgentStop(event, state);
    expect(delta?.agentThreads?.[0]?.endedAt).toBe('2024-01-15T10:00:00.000Z');
    expect(delta?.liveAgentUsage?.['a1']).toBeUndefined();
  });
});
