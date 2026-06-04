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

describe('enqueue events in reducer', () => {
  it('sets enqueueStatus to running on enqueue:start', () => {
    const event: EforgeEvent = {
      type: 'enqueue:start',
      source: '/tmp/my-prd.md',
    } as unknown as EforgeEvent;
    const result = eforgeReducer(initialRunState, {
      type: 'ADD_EVENT',
      event,
      eventId: 'eq-1',
    });
    expect(result.enqueueStatus).toBe('running');
    expect(result.enqueueSource).toBe('/tmp/my-prd.md');
  });

  it('sets enqueueStatus to complete and enqueueTitle on enqueue:complete', () => {
    let state = eforgeReducer(initialRunState, {
      type: 'ADD_EVENT',
      event: { type: 'enqueue:start', source: '/tmp/my-prd.md' } as unknown as EforgeEvent,
      eventId: 'eq-1',
    });
    state = eforgeReducer(state, {
      type: 'ADD_EVENT',
      event: { type: 'enqueue:complete', id: 'prd-001', filePath: '/tmp/queue/prd-001.md', title: 'My Feature', planSet: 'My Feature' } as unknown as EforgeEvent,
      eventId: 'eq-2',
    });
    expect(state.enqueueStatus).toBe('complete');
    expect(state.enqueueTitle).toBe('My Feature');
  });

  it('sets startTime from session:start when no phase:start has arrived', () => {
    const event: EforgeEvent = {
      type: 'session:start',
      sessionId: 'session-1',
      timestamp: '2024-06-01T12:00:00Z',
    } as unknown as EforgeEvent;
    const result = eforgeReducer(initialRunState, {
      type: 'ADD_EVENT',
      event,
      eventId: 'ss-1',
    });
    expect(result.startTime).toBe(new Date('2024-06-01T12:00:00Z').getTime());
  });
});

describe('BATCH_LOAD with serverStatus', () => {
  it('sets resultStatus and isComplete from serverStatus when no session:end event', () => {
    const events = [
      {
        event: {
          type: 'phase:start' as const,
          runId: 'run-1',
          planSet: 'test',
          command: 'build' as const,
          timestamp: '2024-01-01T00:00:00Z',
        },
        eventId: '1',
      },
    ];
    const result = eforgeReducer(initialRunState, {
      type: 'BATCH_LOAD',
      events,
      serverStatus: 'completed',
    });
    expect(result.resultStatus).toBe('completed');
    expect(result.isComplete).toBe(true);
  });

  it('sets resultStatus to failed from serverStatus when no session:end event', () => {
    const events = [
      {
        event: {
          type: 'phase:start' as const,
          runId: 'run-1',
          planSet: 'test',
          command: 'build' as const,
          timestamp: '2024-01-01T00:00:00Z',
        },
        eventId: '1',
      },
    ];
    const result = eforgeReducer(initialRunState, {
      type: 'BATCH_LOAD',
      events,
      serverStatus: 'failed',
    });
    expect(result.resultStatus).toBe('failed');
    expect(result.isComplete).toBe(true);
  });

  it('preserves resultStatus from session:end when no serverStatus provided', () => {
    const events: Array<{ event: EforgeEvent; eventId: string }> = [
      {
        event: {
          type: 'session:end',
          sessionId: 'session-1',
          result: { status: 'completed', summary: 'Done' },
          timestamp: '2024-01-01T00:01:00Z',
        } as unknown as EforgeEvent,
        eventId: '1',
      },
    ];
    const result = eforgeReducer(initialRunState, {
      type: 'BATCH_LOAD',
      events,
    });
    expect(result.resultStatus).toBe('completed');
    expect(result.isComplete).toBe(true);
  });

  it('does not override session:end result with serverStatus', () => {
    const events: Array<{ event: EforgeEvent; eventId: string }> = [
      {
        event: {
          type: 'session:end',
          sessionId: 'session-1',
          result: { status: 'failed', summary: 'Build failed' },
          timestamp: '2024-01-01T00:01:00Z',
        } as unknown as EforgeEvent,
        eventId: '1',
      },
    ];
    const result = eforgeReducer(initialRunState, {
      type: 'BATCH_LOAD',
      events,
      serverStatus: 'completed',
    });
    // session:end already set isComplete, so serverStatus override is skipped
    expect(result.resultStatus).toBe('failed');
    expect(result.isComplete).toBe(true);
  });

  it('ignores serverStatus when it is "running"', () => {
    const events = [
      {
        event: {
          type: 'phase:start' as const,
          runId: 'run-1',
          planSet: 'test',
          command: 'build' as const,
          timestamp: '2024-01-01T00:00:00Z',
        },
        eventId: '1',
      },
    ];
    const result = eforgeReducer(initialRunState, {
      type: 'BATCH_LOAD',
      events,
      serverStatus: 'running',
    });
    expect(result.resultStatus).toBeNull();
    expect(result.isComplete).toBe(false);
  });
});

describe('getSummaryStats', () => {
  it('returns defaults for empty state', () => {
    const stats = getSummaryStats(initialRunState);
    expect(stats.duration).toBe('--');
    expect(stats.tokensIn).toBe(0);
    expect(stats.tokensOut).toBe(0);
    expect(stats.totalCost).toBe(0);
    expect(stats.plansTotal).toBe(0);
  });

  it('calculates plan counts correctly', () => {
    const state: RunState = {
      ...initialRunState,
      planStatuses: {
        'plan-01': 'complete',
        'plan-02': 'complete',
        'plan-03': 'failed',
        'plan-04': 'implement',
      },
    };
    const stats = getSummaryStats(state);
    expect(stats.plansTotal).toBe(4);
    expect(stats.plansCompleted).toBe(2);
    expect(stats.plansFailed).toBe(1);
  });

  it('overlays liveAgentUsage into summary stats', () => {
    // Simulate one finalized agent result + one live agent
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
          type: 'agent:result',
          agent: 'builder',
          planId: 'plan-01',
          result: {
            durationMs: 1000,
            durationApiMs: 800,
            numTurns: 5,
            totalCostUsd: 0.50,
            usage: { input: 1000, output: 500, total: 1500, cacheRead: 100, cacheCreation: 50 },
            modelUsage: {},
          },
        } as unknown as EforgeEvent,
        eventId: '2',
      },
      {
        event: {
          type: 'agent:start',
          agentId: 'a2',
          agent: 'reviewer',
          model: 'claude',
          agentRuntime: 'default',
          harness: 'pi',
          timestamp: '2024-01-01T00:00:01Z',
        } as unknown as EforgeEvent,
        eventId: '3',
      },
      {
        event: {
          type: 'agent:usage',
          agentId: 'a2',
          agent: 'reviewer',
          usage: { input: 2000, output: 300, total: 2300, cacheRead: 200, cacheCreation: 80 },
          costUsd: 0.25,
          numTurns: 3,
        } as unknown as EforgeEvent,
        eventId: '4',
      },
    ];
    const state = dispatch(initialRunState, events);
    const stats = getSummaryStats(state);

    // Finalized: 1000 in + live: 2000 in
    expect(stats.tokensIn).toBe(3000);
    // Finalized: 500 out + live: 300 out
    expect(stats.tokensOut).toBe(800);
    // Finalized: 100 + live: 200
    expect(stats.cacheRead).toBe(300);
    // Finalized: 50 + live: 80
    expect(stats.cacheCreation).toBe(130);
    // Finalized: 0.50 + live: 0.25
    expect(stats.totalCost).toBeCloseTo(0.75);
    // Finalized turns: 5 (from agentThread) + live: 3
    expect(stats.totalTurns).toBe(8);
  });

  it('clears live overlay after agent:result so no double-counting', () => {
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
          costUsd: 0.10,
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
          usage: { input: 1000, output: 400, total: 1400, cacheRead: 100, cacheCreation: 20 },
          costUsd: 0.20,
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
            durationMs: 2000,
            durationApiMs: 1500,
            numTurns: 4,
            totalCostUsd: 0.20,
            usage: { input: 1000, output: 400, total: 1400, cacheRead: 100, cacheCreation: 20 },
            modelUsage: {},
          },
        } as unknown as EforgeEvent,
        eventId: '4',
      },
    ];
    const state = dispatch(initialRunState, events);

    // Live overlay should be cleared - only finalized values remain
    expect(Object.keys(state.liveAgentUsage)).toHaveLength(0);

    const stats = getSummaryStats(state);
    // Only finalized: 1000 in, 400 out (no double-count from live)
    expect(stats.tokensIn).toBe(1000);
    expect(stats.tokensOut).toBe(400);
    expect(stats.cacheRead).toBe(100);
    expect(stats.cacheCreation).toBe(20);
    expect(stats.totalCost).toBeCloseTo(0.20);
  });
});
