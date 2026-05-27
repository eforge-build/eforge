/**
 * Core reducer verification tests.
 *
 * Covers the five assertions from the plan's verification section:
 *   1. Two agent:result events accumulate tokensIn, tokensOut, cacheRead, cacheCreation, totalCost as sum
 *   2. Plan lifecycle events transition planStatuses[planId] through pending → running → completed
 *   3. session:end with result.status === 'failed' produces RunState.resultStatus === 'failed'
 *   4. agent:start + agent:result produces AgentThread with populated startedAt, durationMs,
 *      inputTokens, outputTokens, costUsd, numTurns, model
 *   5. Re-receiving a stream:hello snapshot frame (BATCH_LOAD) resets RunState and replays
 *      without double-counting tokens or cost
 */
import { describe, it, expect } from 'vitest';
import { eforgeReducer, initialRunState, createInitialRunState, reduce } from '../reducer';
import type { EforgeEvent } from '../types';

function makeEvent<T extends EforgeEvent['type']>(
  type: T,
  extra: object,
): Extract<EforgeEvent, { type: T }> {
  return { type, timestamp: '2024-01-15T10:00:00.000Z', sessionId: 's1', ...extra } as unknown as Extract<EforgeEvent, { type: T }>;
}

function addEvent(
  state: ReturnType<typeof createInitialRunState>,
  event: EforgeEvent,
  eventId: string,
) {
  return eforgeReducer(state, { type: 'ADD_EVENT', event, eventId });
}

const PLAN_A = 'plan-01';
const PLAN_B = 'plan-02';

// ---------------------------------------------------------------------------
// Verification 1: token accumulation across multiple agent:result events
// ---------------------------------------------------------------------------
describe('verification 1: token accumulation across agent:result events', () => {
  it('two agent:result events accumulate tokensIn, tokensOut, cacheRead, cacheCreation, totalCost as sum', () => {
    // Setup: two agents for two plans
    let state = initialRunState;

    // Agent 1: start
    state = addEvent(state, makeEvent('agent:start', {
      planId: PLAN_A,
      agentId: 'agent-001',
      agent: 'builder',
      model: 'claude-sonnet-4-5',
      harness: 'claude-sdk',
      harnessSource: 'tier',
      tier: 'heavy',
      tierSource: 'role',
      effort: 'high',
      effortSource: 'role',
      effortClamped: false,
      effortOriginal: 'high',
    }), 'ev-1');

    // Agent 1: result
    state = addEvent(state, makeEvent('agent:result', {
      planId: PLAN_A,
      agent: 'builder',
      result: {
        durationMs: 60000,
        durationApiMs: 55000,
        numTurns: 2,
        totalCostUsd: 0.01,
        usage: { input: 2000, output: 1000, total: 3000, cacheRead: 400, cacheCreation: 100 },
        modelUsage: {},
      },
    }), 'ev-2');

    // Agent 2: start
    state = addEvent(state, makeEvent('agent:start', {
      planId: PLAN_B,
      agentId: 'agent-002',
      agent: 'builder',
      model: 'claude-sonnet-4-5',
      harness: 'claude-sdk',
      harnessSource: 'tier',
      tier: 'heavy',
      tierSource: 'role',
      effort: 'high',
      effortSource: 'role',
      effortClamped: false,
      effortOriginal: 'high',
    }), 'ev-3');

    // Agent 2: result
    state = addEvent(state, makeEvent('agent:result', {
      planId: PLAN_B,
      agent: 'builder',
      result: {
        durationMs: 90000,
        durationApiMs: 85000,
        numTurns: 3,
        totalCostUsd: 0.015,
        usage: { input: 3000, output: 1500, total: 4500, cacheRead: 600, cacheCreation: 200 },
        modelUsage: {},
      },
    }), 'ev-4');

    expect(state.tokensIn).toBe(5000);      // 2000 + 3000
    expect(state.tokensOut).toBe(2500);     // 1000 + 1500
    expect(state.cacheRead).toBe(1000);     // 400 + 600
    expect(state.cacheCreation).toBe(300);  // 100 + 200
    expect(state.totalCost).toBeCloseTo(0.025, 8);  // 0.01 + 0.015
  });
});

// ---------------------------------------------------------------------------
// Verification 2: plan lifecycle events transition planStatuses
// ---------------------------------------------------------------------------
describe('verification 2: plan lifecycle events transition planStatuses', () => {
  it('plan:status:change events transition planStatuses[planId] through running → complete', () => {
    let state = initialRunState;

    // Initial: no status
    expect(state.planStatuses[PLAN_A]).toBeUndefined();

    // running → implement
    state = addEvent(state, makeEvent('plan:status:change', { planId: PLAN_A, status: 'running' }), 'ev-1');
    expect(state.planStatuses[PLAN_A]).toBe('implement');

    // completed → complete
    state = addEvent(state, makeEvent('plan:status:change', { planId: PLAN_A, status: 'completed' }), 'ev-2');
    expect(state.planStatuses[PLAN_A]).toBe('complete');
  });

  it('plan:status:change failed → planStatuses[planId] === "failed"', () => {
    let state = initialRunState;

    state = addEvent(state, makeEvent('plan:status:change', { planId: PLAN_A, status: 'running' }), 'ev-1');
    state = addEvent(state, makeEvent('plan:status:change', { planId: PLAN_A, status: 'failed' }), 'ev-2');
    expect(state.planStatuses[PLAN_A]).toBe('failed');
  });

  it('plan:status:change pending → planStatuses[planId] remains undefined (pending is not a PipelineStage)', () => {
    // The handler deliberately maps engine 'pending' to undefined so the UI
    // does not render a pipeline stage for plans that have not yet started.
    // This test verifies that dispatching a pending event is a no-op for
    // planStatuses (i.e., pending events are intentionally invisible to the UI).
    let state = initialRunState;

    // pending on fresh state → still undefined
    state = addEvent(state, makeEvent('plan:status:change', { planId: PLAN_A, status: 'pending' }), 'ev-1');
    expect(state.planStatuses[PLAN_A]).toBeUndefined();

    // pending after running → should not overwrite the existing stage
    state = addEvent(state, makeEvent('plan:status:change', { planId: PLAN_A, status: 'running' }), 'ev-2');
    state = addEvent(state, makeEvent('plan:status:change', { planId: PLAN_A, status: 'pending' }), 'ev-3');
    expect(state.planStatuses[PLAN_A]).toBe('implement');
  });
});

// ---------------------------------------------------------------------------
// Verification 3: session:end with failed result
// ---------------------------------------------------------------------------
describe('verification 3: session:end failed result', () => {
  it('session:end with result.status === "failed" produces resultStatus === "failed"', () => {
    let state = initialRunState;

    state = addEvent(state, makeEvent('session:end', {
      result: { status: 'failed', summary: 'Build pipeline failed' },
    }), 'ev-1');

    expect(state.resultStatus).toBe('failed');
    expect(state.isComplete).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Verification 4: agent:start + agent:result produces populated AgentThread
// ---------------------------------------------------------------------------
describe('verification 4: agent:start + agent:result produces populated AgentThread', () => {
  it('produces AgentThread with startedAt, durationMs, inputTokens, outputTokens, costUsd, numTurns, model', () => {
    let state = initialRunState;

    state = addEvent(state, makeEvent('agent:start', {
      planId: PLAN_A,
      agentId: 'agent-001',
      agent: 'builder',
      model: 'claude-sonnet-4-5',
      harness: 'claude-sdk',
      harnessSource: 'tier',
      tier: 'heavy',
      tierSource: 'role',
      effort: 'high',
      effortSource: 'role',
      effortClamped: false,
      effortOriginal: 'high',
    }), 'ev-1');

    state = addEvent(state, makeEvent('agent:result', {
      planId: PLAN_A,
      agent: 'builder',
      result: {
        durationMs: 120000,
        durationApiMs: 110000,
        numTurns: 5,
        totalCostUsd: 0.02,
        usage: { input: 4000, output: 2000, total: 6000, cacheRead: 800, cacheCreation: 200 },
        modelUsage: {},
      },
    }), 'ev-2');

    expect(state.agentThreads).toHaveLength(1);
    const thread = state.agentThreads[0];
    expect(thread).toBeDefined();
    expect(thread.startedAt).toBe('2024-01-15T10:00:00.000Z');
    expect(thread.durationMs).toBe(120000);
    expect(thread.inputTokens).toBe(4000);
    expect(thread.outputTokens).toBe(2000);
    expect(thread.costUsd).toBe(0.02);
    expect(thread.numTurns).toBe(5);
    expect(thread.model).toBe('claude-sonnet-4-5');
    expect(thread.planId).toBe(PLAN_A);
  });
});

// ---------------------------------------------------------------------------
// Verification 5: BATCH_LOAD resets RunState and replays without double-counting
// ---------------------------------------------------------------------------
describe('verification 5: BATCH_LOAD resets and replays without double-counting', () => {
  it('BATCH_LOAD after iterative ADD_EVENTs produces correct token totals (no double-count)', () => {
    // First: build up state via ADD_EVENT
    const agentStartEvent = makeEvent('agent:start', {
      planId: PLAN_A,
      agentId: 'agent-001',
      agent: 'builder',
      model: 'claude-sonnet-4-5',
      harness: 'claude-sdk',
      harnessSource: 'tier',
      tier: 'heavy',
      tierSource: 'role',
      effort: 'high',
      effortSource: 'role',
      effortClamped: false,
      effortOriginal: 'high',
    });

    const agentResultEvent = makeEvent('agent:result', {
      planId: PLAN_A,
      agent: 'builder',
      result: {
        durationMs: 60000,
        durationApiMs: 55000,
        numTurns: 2,
        totalCostUsd: 0.01,
        usage: { input: 2000, output: 1000, total: 3000, cacheRead: 400, cacheCreation: 100 },
        modelUsage: {},
      },
    });

    // Iterative state
    let iterState = initialRunState;
    iterState = addEvent(iterState, agentStartEvent, 'ev-1');
    iterState = addEvent(iterState, agentResultEvent, 'ev-2');

    expect(iterState.tokensIn).toBe(2000);
    expect(iterState.totalCost).toBeCloseTo(0.01, 8);

    // Now: simulate re-receiving same events via BATCH_LOAD (stream:hello reset)
    const batchState = eforgeReducer(initialRunState, {
      type: 'BATCH_LOAD',
      events: [
        { event: agentStartEvent, eventId: 'ev-1' },
        { event: agentResultEvent, eventId: 'ev-2' },
      ],
    });

    // BATCH_LOAD resets first, then replays — no double-counting
    expect(batchState.tokensIn).toBe(2000);
    expect(batchState.tokensOut).toBe(1000);
    expect(batchState.cacheRead).toBe(400);
    expect(batchState.cacheCreation).toBe(100);
    expect(batchState.totalCost).toBeCloseTo(0.01, 8);
  });

  it('BATCH_LOAD after prior state produces the same result as fresh replay from empty', () => {
    const events: Array<{ event: EforgeEvent; eventId: string }> = [
      {
        event: makeEvent('agent:start', {
          planId: PLAN_A,
          agentId: 'agent-001',
          agent: 'builder',
          model: 'claude-sonnet-4-5',
          harness: 'claude-sdk',
          harnessSource: 'tier',
          tier: 'heavy',
          tierSource: 'role',
          effort: 'high',
          effortSource: 'role',
          effortClamped: false,
          effortOriginal: 'high',
        }),
        eventId: 'ev-1',
      },
      {
        event: makeEvent('agent:result', {
          planId: PLAN_A,
          agent: 'builder',
          result: {
            durationMs: 60000,
            durationApiMs: 55000,
            numTurns: 2,
            totalCostUsd: 0.01,
            usage: { input: 2000, output: 1000, total: 3000, cacheRead: 400, cacheCreation: 100 },
            modelUsage: {},
          },
        }),
        eventId: 'ev-2',
      },
    ];

    // State before BATCH_LOAD has different prior data
    const priorState = { ...initialRunState, tokensIn: 9999, totalCost: 100 };

    // BATCH_LOAD should reset and replay cleanly, ignoring priorState data
    const batchState = eforgeReducer(priorState, { type: 'BATCH_LOAD', events });

    // Should equal fresh iterative replay
    const freshState = events.reduce(
      (acc, { event, eventId }) => eforgeReducer(acc, { type: 'ADD_EVENT', event, eventId }),
      initialRunState,
    );

    expect(batchState.tokensIn).toBe(freshState.tokensIn);
    expect(batchState.totalCost).toBeCloseTo(freshState.totalCost, 8);
    expect(batchState.agentThreads).toEqual(freshState.agentThreads);
  });
});

// ---------------------------------------------------------------------------
// createInitialRunState factory and reduce convenience wrapper
// ---------------------------------------------------------------------------
describe('createInitialRunState / reduce', () => {
  it('createInitialRunState produces a fresh empty state', () => {
    const state = createInitialRunState();
    expect(state.tokensIn).toBe(0);
    expect(state.agentThreads).toHaveLength(0);
    expect(state.events).toHaveLength(0);
    expect(state.planStatuses).toEqual({});
  });

  it('reduce(state, event) is equivalent to eforgeReducer ADD_EVENT with auto-generated eventId', () => {
    const event = makeEvent('session:end', {
      result: { status: 'completed', summary: 'done' },
    });
    const state = reduce(initialRunState, event);
    expect(state.resultStatus).toBe('completed');
    expect(state.isComplete).toBe(true);
  });
});
