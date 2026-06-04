import { describe, it, expect } from 'vitest';
import {
  eforgeReducer,
  initialRunState,
  getSummaryStats,
  type RunState,
  type RunAction,
} from '@eforge-build/console-ui/lib/run-state';
import type { EforgeEvent } from '@eforge-build/client';
import { isAlwaysYieldedAgentEvent } from '@eforge-build/client';
import { dispatch } from './monitor-reducer-helpers';

describe('agent:usage event handling', () => {
  it('isAlwaysYieldedAgentEvent returns true for agent:usage', () => {
    const event: EforgeEvent = {
      type: 'agent:usage',
      agentId: 'a1',
      agent: 'builder',
      usage: { input: 100, output: 50, total: 150, cacheRead: 10, cacheCreation: 5 },
      costUsd: 0.01,
      numTurns: 1,
    } as unknown as EforgeEvent;
    expect(isAlwaysYieldedAgentEvent(event)).toBe(true);
  });

  it('initialRunState has empty liveAgentUsage', () => {
    expect(initialRunState.liveAgentUsage).toEqual({});
  });

  it('sets liveAgentUsage entry on agent:usage event', () => {
    const state = eforgeReducer(initialRunState, {
      type: 'ADD_EVENT',
      event: {
        type: 'agent:usage',
        agentId: 'a1',
        agent: 'builder',
        usage: { input: 500, output: 200, total: 700, cacheRead: 50, cacheCreation: 10 },
        costUsd: 0.05,
        numTurns: 2,
      } as unknown as EforgeEvent,
      eventId: '1',
    });
    expect(state.liveAgentUsage['a1']).toEqual({
      input: 500,
      output: 200,
      cacheRead: 50,
      cacheCreation: 10,
      cost: 0.05,
      turns: 2,
    });
  });

  it('replaces liveAgentUsage when a final:true agent:usage arrives (last-wins cumulative)', () => {
    // Per the unified cadence contract, an agent:usage event with
    // final: true is the authoritative cumulative total and should
    // replace any running delta sums last-wins.
    let state = eforgeReducer(initialRunState, {
      type: 'ADD_EVENT',
      event: {
        type: 'agent:usage',
        agentId: 'a1',
        agent: 'builder',
        usage: { input: 500, output: 200, total: 700, cacheRead: 50, cacheCreation: 10 },
        costUsd: 0.05,
        numTurns: 2,
      } as unknown as EforgeEvent,
      eventId: '1',
    });
    state = eforgeReducer(state, {
      type: 'ADD_EVENT',
      event: {
        type: 'agent:usage',
        agentId: 'a1',
        agent: 'builder',
        usage: { input: 1000, output: 400, total: 1400, cacheRead: 100, cacheCreation: 20 },
        costUsd: 0.10,
        numTurns: 4,
        final: true,
      } as unknown as EforgeEvent,
      eventId: '2',
    });
    // Final event replaces the running delta total last-wins.
    expect(state.liveAgentUsage['a1']).toEqual({
      input: 1000,
      output: 400,
      cacheRead: 100,
      cacheCreation: 20,
      cost: 0.10,
      turns: 4,
    });
  });

  it('sums non-final agent:usage deltas into the running live totals', () => {
    // Non-final agent:usage events carry per-turn deltas under the
    // unified cadence contract; the reducer must additively accumulate
    // them into the running live overlay, seeding from zero when the
    // entry is missing.
    let state = eforgeReducer(initialRunState, {
      type: 'ADD_EVENT',
      event: {
        type: 'agent:usage',
        agentId: 'a1',
        agent: 'builder',
        usage: { input: 500, output: 200, total: 700, cacheRead: 50, cacheCreation: 10 },
        costUsd: 0.05,
        numTurns: 1,
      } as unknown as EforgeEvent,
      eventId: '1',
    });
    state = eforgeReducer(state, {
      type: 'ADD_EVENT',
      event: {
        type: 'agent:usage',
        agentId: 'a1',
        agent: 'builder',
        usage: { input: 300, output: 150, total: 450, cacheRead: 20, cacheCreation: 5 },
        costUsd: 0.03,
        numTurns: 1,
      } as unknown as EforgeEvent,
      eventId: '2',
    });
    // Deltas summed (500+300 in, 200+150 out, etc.).
    expect(state.liveAgentUsage['a1']).toEqual({
      input: 800,
      output: 350,
      cacheRead: 70,
      cacheCreation: 15,
      cost: 0.08,
      turns: 2,
    });
  });

  it('sum of non-final deltas equals the authoritative final cumulative total', () => {
    // This mirrors how PiHarness emits: per-turn deltas whose sum equals
    // the final: true cumulative emission that lands just before agent:result.
    const deltas = [
      { input: 500, output: 200, cacheRead: 50, cacheCreation: 10, cost: 0.05 },
      { input: 300, output: 100, cacheRead: 20, cacheCreation: 5, cost: 0.03 },
      { input: 400, output: 200, cacheRead: 30, cacheCreation: 5, cost: 0.07 },
    ];
    let state = initialRunState;
    deltas.forEach((d, i) => {
      state = eforgeReducer(state, {
        type: 'ADD_EVENT',
        event: {
          type: 'agent:usage',
          agentId: 'a1',
          agent: 'builder',
          usage: { input: d.input, output: d.output, total: d.input + d.output, cacheRead: d.cacheRead, cacheCreation: d.cacheCreation },
          costUsd: d.cost,
          numTurns: 1,
        } as unknown as EforgeEvent,
        eventId: `delta-${i}`,
      });
    });
    // Expected cumulative total derived from deltas.
    const expected = deltas.reduce(
      (acc, d) => ({
        input: acc.input + d.input,
        output: acc.output + d.output,
        cacheRead: acc.cacheRead + d.cacheRead,
        cacheCreation: acc.cacheCreation + d.cacheCreation,
        cost: acc.cost + d.cost,
      }),
      { input: 0, output: 0, cacheRead: 0, cacheCreation: 0, cost: 0 },
    );
    const live = state.liveAgentUsage['a1'];
    expect(live?.input).toBe(expected.input);
    expect(live?.output).toBe(expected.output);
    expect(live?.cacheRead).toBe(expected.cacheRead);
    expect(live?.cacheCreation).toBe(expected.cacheCreation);
    expect(live?.cost).toBeCloseTo(expected.cost);
    expect(live?.turns).toBe(deltas.length);
  });

  it('deletes liveAgentUsage entry on agent:stop', () => {
    let state = eforgeReducer(initialRunState, {
      type: 'ADD_EVENT',
      event: {
        type: 'agent:usage',
        agentId: 'a1',
        agent: 'builder',
        usage: { input: 500, output: 200, total: 700, cacheRead: 50, cacheCreation: 10 },
        costUsd: 0.05,
        numTurns: 2,
      } as unknown as EforgeEvent,
      eventId: '1',
    });
    expect(state.liveAgentUsage['a1']).toBeDefined();

    state = eforgeReducer(state, {
      type: 'ADD_EVENT',
      event: {
        type: 'agent:stop',
        agentId: 'a1',
        agent: 'builder',
        timestamp: '2024-01-01T00:01:00Z',
      } as unknown as EforgeEvent,
      eventId: '2',
    });
    expect(state.liveAgentUsage['a1']).toBeUndefined();
  });

  it('updates AgentThread with live usage on agent:usage', () => {
    let state = eforgeReducer(initialRunState, {
      type: 'ADD_EVENT',
      event: {
        type: 'agent:start',
        agentId: 'a1',
        agent: 'builder',
        model: 'claude',
        agentRuntime: 'default',
        harness: 'pi',
        timestamp: '2024-01-01T00:00:00Z',
      } as unknown as EforgeEvent,
      eventId: '1',
    });
    state = eforgeReducer(state, {
      type: 'ADD_EVENT',
      event: {
        type: 'agent:usage',
        agentId: 'a1',
        agent: 'builder',
        usage: { input: 500, output: 200, total: 700, cacheRead: 50, cacheCreation: 10 },
        costUsd: 0.05,
        numTurns: 2,
      } as unknown as EforgeEvent,
      eventId: '2',
    });

    const thread = state.agentThreads.find((t) => t.agentId === 'a1');
    expect(thread).toBeDefined();
    expect(thread!.inputTokens).toBe(500);
    expect(thread!.outputTokens).toBe(200);
    expect(thread!.totalTokens).toBe(700);
    expect(thread!.cacheRead).toBe(50);
    expect(thread!.costUsd).toBe(0.05);
    expect(thread!.numTurns).toBe(2);
  });

  it('full lifecycle: agent:start, agent:usage x2, agent:result produces correct totals', () => {
    const events: Array<{ event: EforgeEvent; eventId: string }> = [
      {
        event: {
          type: 'agent:start',
          agentId: 'a1',
          agent: 'builder',
          planId: 'plan-01',
          model: 'claude',
          agentRuntime: 'default',
          harness: 'pi',
          timestamp: '2024-01-01T00:00:00Z',
        } as unknown as EforgeEvent,
        eventId: '1',
      },
      {
        event: {
          type: 'agent:usage',
          agentId: 'a1',
          agent: 'builder',
          planId: 'plan-01',
          usage: { input: 500, output: 200, total: 700, cacheRead: 50, cacheCreation: 10 },
          costUsd: 0.05,
          numTurns: 2,
        } as unknown as EforgeEvent,
        eventId: '2',
      },
      {
        event: {
          type: 'agent:usage',
          agentId: 'a1',
          agent: 'builder',
          planId: 'plan-01',
          usage: { input: 1200, output: 500, total: 1700, cacheRead: 120, cacheCreation: 25 },
          costUsd: 0.15,
          numTurns: 4,
        } as unknown as EforgeEvent,
        eventId: '3',
      },
      {
        event: {
          type: 'agent:result',
          agent: 'builder',
          planId: 'plan-01',
          result: {
            durationMs: 3000,
            durationApiMs: 2500,
            numTurns: 4,
            totalCostUsd: 0.15,
            usage: { input: 1200, output: 500, total: 1700, cacheRead: 120, cacheCreation: 25 },
            modelUsage: {},
          },
        } as unknown as EforgeEvent,
        eventId: '4',
      },
    ];

    const state = dispatch(initialRunState, events);

    // Live overlay cleared
    expect(Object.keys(state.liveAgentUsage)).toHaveLength(0);

    // Finalized counters from agent:result
    expect(state.tokensIn).toBe(1200);
    expect(state.tokensOut).toBe(500);
    expect(state.cacheRead).toBe(120);
    expect(state.cacheCreation).toBe(25);
    expect(state.totalCost).toBeCloseTo(0.15);

    // getSummaryStats should match finalized (no live overlay)
    const stats = getSummaryStats(state);
    expect(stats.tokensIn).toBe(1200);
    expect(stats.tokensOut).toBe(500);
    expect(stats.totalCost).toBeCloseTo(0.15);
    expect(stats.totalTurns).toBe(4);
  });

  it('BATCH_LOAD handles agent:usage events correctly', () => {
    const events: Array<{ event: EforgeEvent; eventId: string }> = [
      {
        event: {
          type: 'agent:start',
          agentId: 'a1',
          agent: 'builder',
          planId: 'plan-01',
          model: 'claude',
          agentRuntime: 'default',
          harness: 'pi',
          timestamp: '2024-01-01T00:00:00Z',
        } as unknown as EforgeEvent,
        eventId: '1',
      },
      {
        event: {
          type: 'agent:usage',
          agentId: 'a1',
          agent: 'builder',
          planId: 'plan-01',
          usage: { input: 800, output: 300, total: 1100, cacheRead: 80, cacheCreation: 15 },
          costUsd: 0.08,
          numTurns: 3,
        } as unknown as EforgeEvent,
        eventId: '2',
      },
    ];

    const state = eforgeReducer(initialRunState, {
      type: 'BATCH_LOAD',
      events,
    });

    // Live overlay should be set (no agent:result to clear it)
    expect(state.liveAgentUsage['a1']).toEqual({
      input: 800,
      output: 300,
      cacheRead: 80,
      cacheCreation: 15,
      cost: 0.08,
      turns: 3,
    });

    // getSummaryStats includes live overlay
    const stats = getSummaryStats(state);
    expect(stats.tokensIn).toBe(800);
    expect(stats.tokensOut).toBe(300);
    expect(stats.totalCost).toBeCloseTo(0.08);
  });
});

describe('effort/thinking fields on AgentThread', () => {
  it('populates effort and effortSource from agent:start event', () => {
    const state = eforgeReducer(initialRunState, {
      type: 'ADD_EVENT',
      event: {
        type: 'agent:start',
        agentId: 'a1',
        agent: 'builder',
        planId: 'plan-01',
        model: 'claude',
        agentRuntime: 'default',
        harness: 'pi',
        timestamp: '2024-01-01T00:00:00Z',
        effort: 'xhigh',
        effortSource: 'planner',
      } as unknown as EforgeEvent,
      eventId: '1',
    });

    const thread = state.agentThreads.find((t) => t.agentId === 'a1');
    expect(thread).toBeDefined();
    expect(thread!.effort).toBe('xhigh');
    expect(thread!.effortSource).toBe('planner');
  });

  it('populates effortClamped and effortOriginal from agent:start event', () => {
    const state = eforgeReducer(initialRunState, {
      type: 'ADD_EVENT',
      event: {
        type: 'agent:start',
        agentId: 'a1',
        agent: 'builder',
        planId: 'plan-01',
        model: 'claude',
        agentRuntime: 'default',
        harness: 'pi',
        timestamp: '2024-01-01T00:00:00Z',
        effort: 'xhigh',
        effortClamped: true,
        effortOriginal: 'max',
        effortSource: 'planner',
      } as unknown as EforgeEvent,
      eventId: '1',
    });

    const thread = state.agentThreads.find((t) => t.agentId === 'a1');
    expect(thread).toBeDefined();
    expect(thread!.effort).toBe('xhigh');
    expect(thread!.effortClamped).toBe(true);
    expect(thread!.effortOriginal).toBe('max');
    expect(thread!.effortSource).toBe('planner');
  });

  it('populates thinking from agent:start event', () => {
    const state = eforgeReducer(initialRunState, {
      type: 'ADD_EVENT',
      event: {
        type: 'agent:start',
        agentId: 'a1',
        agent: 'builder',
        planId: 'plan-01',
        model: 'claude',
        agentRuntime: 'default',
        harness: 'pi',
        timestamp: '2024-01-01T00:00:00Z',
        thinking: 'adaptive',
      } as unknown as EforgeEvent,
      eventId: '1',
    });

    const thread = state.agentThreads.find((t) => t.agentId === 'a1');
    expect(thread).toBeDefined();
    expect(thread!.thinking).toBe('adaptive');
  });

  it('leaves effort/thinking undefined when agent:start omits them (older engine)', () => {
    const state = eforgeReducer(initialRunState, {
      type: 'ADD_EVENT',
      event: {
        type: 'agent:start',
        agentId: 'a1',
        agent: 'builder',
        planId: 'plan-01',
        model: 'claude',
        harness: 'pi',
        timestamp: '2024-01-01T00:00:00Z',
      } as unknown as EforgeEvent,
      eventId: '1',
    });

    const thread = state.agentThreads.find((t) => t.agentId === 'a1');
    expect(thread).toBeDefined();
    expect(thread!.effort).toBeUndefined();
    expect(thread!.thinking).toBeUndefined();
    expect(thread!.effortClamped).toBeUndefined();
    expect(thread!.effortOriginal).toBeUndefined();
    expect(thread!.effortSource).toBeUndefined();
    expect(thread!.thinkingSource).toBeUndefined();
    expect(thread!.harnessSource).toBeUndefined();
  });

  it('populates harness from agent:start event', () => {
    const state = eforgeReducer(initialRunState, {
      type: 'ADD_EVENT',
      event: {
        type: 'agent:start',
        agentId: 'a1',
        agent: 'builder',
        planId: 'plan-01',
        model: 'claude',
        harness: 'claude-sdk',
        timestamp: '2024-01-01T00:00:00Z',
      } as unknown as EforgeEvent,
      eventId: '1',
    });

    const thread = state.agentThreads.find((t) => t.agentId === 'a1');
    expect(thread).toBeDefined();
    expect(thread!.harness).toBe('claude-sdk');
    expect(thread!.harnessSource).toBeUndefined();
  });

  it('populates harnessSource from agent:start event', () => {
    const state = eforgeReducer(initialRunState, {
      type: 'ADD_EVENT',
      event: {
        type: 'agent:start',
        agentId: 'a1',
        agent: 'builder',
        planId: 'plan-01',
        model: 'claude',
        harness: 'pi',
        harnessSource: 'tier',
        timestamp: '2024-01-01T00:00:00Z',
      } as unknown as EforgeEvent,
      eventId: '1',
    });

    const thread = state.agentThreads.find((t) => t.agentId === 'a1');
    expect(thread).toBeDefined();
    expect(thread!.harness).toBe('pi');
    expect(thread!.harnessSource).toBe('tier');
  });

  it('handles effortSource values for config sources', () => {
    const state = eforgeReducer(initialRunState, {
      type: 'ADD_EVENT',
      event: {
        type: 'agent:start',
        agentId: 'a1',
        agent: 'builder',
        planId: 'plan-01',
        model: 'claude',
        agentRuntime: 'default',
        harness: 'pi',
        timestamp: '2024-01-01T00:00:00Z',
        effort: 'high',
        effortSource: 'role-config',
      } as unknown as EforgeEvent,
      eventId: '1',
    });

    const thread = state.agentThreads.find((t) => t.agentId === 'a1');
    expect(thread).toBeDefined();
    expect(thread!.effort).toBe('high');
    expect(thread!.effortSource).toBe('role-config');
  });

  it('handles thinking with budget token string', () => {
    const state = eforgeReducer(initialRunState, {
      type: 'ADD_EVENT',
      event: {
        type: 'agent:start',
        agentId: 'a1',
        agent: 'builder',
        planId: 'plan-01',
        model: 'claude',
        agentRuntime: 'default',
        harness: 'pi',
        timestamp: '2024-01-01T00:00:00Z',
        thinking: 'enabled (10k tokens)',
      } as unknown as EforgeEvent,
      eventId: '1',
    });

    const thread = state.agentThreads.find((t) => t.agentId === 'a1');
    expect(thread).toBeDefined();
    expect(thread!.thinking).toBe('enabled (10k tokens)');
  });

  it('populates effort/thinking fields via BATCH_LOAD', () => {
    const events: Array<{ event: EforgeEvent; eventId: string }> = [
      {
        event: {
          type: 'agent:start',
          agentId: 'a1',
          agent: 'builder',
          planId: 'plan-01',
          model: 'claude',
          agentRuntime: 'default',
          harness: 'pi',
          timestamp: '2024-01-01T00:00:00Z',
          effort: 'xhigh',
          thinking: 'adaptive',
          effortClamped: true,
          effortOriginal: 'max',
          effortSource: 'planner',
        } as unknown as EforgeEvent,
        eventId: '1',
      },
    ];

    const state = eforgeReducer(initialRunState, {
      type: 'BATCH_LOAD',
      events,
    });

    const thread = state.agentThreads.find((t) => t.agentId === 'a1');
    expect(thread).toBeDefined();
    expect(thread!.effort).toBe('xhigh');
    expect(thread!.thinking).toBe('adaptive');
    expect(thread!.effortClamped).toBe(true);
    expect(thread!.effortOriginal).toBe('max');
    expect(thread!.effortSource).toBe('planner');
  });

  it('populates thinkingSource from agent:start event', () => {
    const state = eforgeReducer(initialRunState, {
      type: 'ADD_EVENT',
      event: {
        type: 'agent:start',
        agentId: 'a1',
        agent: 'builder',
        planId: 'plan-01',
        model: 'claude',
        agentRuntime: 'default',
        harness: 'pi',
        timestamp: '2024-01-01T00:00:00Z',
        thinking: 'adaptive',
        thinkingSource: 'planner',
      } as unknown as EforgeEvent,
      eventId: '1',
    });

    const thread = state.agentThreads.find((t) => t.agentId === 'a1');
    expect(thread).toBeDefined();
    expect(thread!.thinking).toBe('adaptive');
    expect(thread!.thinkingSource).toBe('planner');
  });

  it('leaves thinkingSource undefined when agent:start omits it (backward compat)', () => {
    const state = eforgeReducer(initialRunState, {
      type: 'ADD_EVENT',
      event: {
        type: 'agent:start',
        agentId: 'a1',
        agent: 'builder',
        planId: 'plan-01',
        model: 'claude',
        agentRuntime: 'default',
        harness: 'pi',
        timestamp: '2024-01-01T00:00:00Z',
        thinking: 'adaptive',
      } as unknown as EforgeEvent,
      eventId: '1',
    });

    const thread = state.agentThreads.find((t) => t.agentId === 'a1');
    expect(thread).toBeDefined();
    expect(thread!.thinking).toBe('adaptive');
    expect(thread!.thinkingSource).toBeUndefined();
  });
});
