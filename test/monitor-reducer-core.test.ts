import { describe, it, expect } from 'vitest';
import {
  eforgeReducer,
  initialRunState,
  getSummaryStats,
  type RunState,
  type RunAction,
} from '@eforge-build/monitor-ui/lib/reducer';
import type { EforgeEvent } from '@eforge-build/client';
import { isAlwaysYieldedAgentEvent } from '@eforge-build/client';
import { dispatch } from './monitor-reducer-helpers';

describe('eforgeReducer', () => {
  it('starts with initial state', () => {
    expect(initialRunState.events).toEqual([]);
    expect(initialRunState.startTime).toBeNull();
    expect(initialRunState.tokensIn).toBe(0);
    expect(initialRunState.tokensOut).toBe(0);
    expect(initialRunState.totalCost).toBe(0);
    expect(initialRunState.isComplete).toBe(false);
  });

  it('resets state', () => {
    const modified: RunState = {
      ...initialRunState,
      tokensIn: 100,
      events: [{ event: { type: 'planning:start', source: 'test' }, eventId: '1' }],
    };
    const result = eforgeReducer(modified, { type: 'RESET' });
    expect(result.tokensIn).toBe(0);
    expect(result.events).toEqual([]);
  });

  it('tracks start time from phase:start', () => {
    const event: EforgeEvent = {
      type: 'phase:start',
      runId: 'run-1',
      planSet: 'test',
      command: 'build',
      timestamp: '2024-01-01T00:00:00Z',
    };
    const result = eforgeReducer(initialRunState, {
      type: 'ADD_EVENT',
      event,
      eventId: '1',
    });
    expect(result.startTime).toBe(new Date('2024-01-01T00:00:00Z').getTime());
  });

  it('marks complete on session:end', () => {
    const event: EforgeEvent = {
      type: 'session:end',
      sessionId: 'session-1',
      result: { status: 'completed', summary: 'All done' },
      timestamp: '2024-01-01T00:01:00Z',
    };
    const result = eforgeReducer(initialRunState, {
      type: 'ADD_EVENT',
      event,
      eventId: '2',
    });
    expect(result.isComplete).toBe(true);
  });

  it('does not mark complete on phase:end', () => {
    const event: EforgeEvent = {
      type: 'phase:end',
      runId: 'run-1',
      result: { status: 'completed', summary: 'All done' },
      timestamp: '2024-01-01T00:01:00Z',
    };
    const result = eforgeReducer(initialRunState, {
      type: 'ADD_EVENT',
      event,
      eventId: '2',
    });
    expect(result.isComplete).toBe(false);
  });

  it('sets resultStatus from session:end result', () => {
    const event: EforgeEvent = {
      type: 'session:end',
      sessionId: 'session-1',
      result: { status: 'failed', summary: 'Build failed' },
      timestamp: '2024-01-01T00:01:00Z',
    };
    const result = eforgeReducer(initialRunState, {
      type: 'ADD_EVENT',
      event,
      eventId: '3',
    });
    expect(result.isComplete).toBe(true);
    expect(result.resultStatus).toBe('failed');
  });

  it('initializes planStatuses from plan:complete', () => {
    const event: EforgeEvent = {
      type: 'planning:complete',
      plans: [
        { id: 'plan-a', description: 'First plan', dependsOn: [] },
        { id: 'plan-b', description: 'Second plan', dependsOn: ['plan-a'] },
      ],
    };
    const result = eforgeReducer(initialRunState, {
      type: 'ADD_EVENT',
      event,
      eventId: '4',
    });
    expect(result.planStatuses).toEqual({
      'plan-a': 'plan',
      'plan-b': 'plan',
    });
  });

  it('accumulates tokens and cost from agent:result', () => {
    const events = [
      {
        event: {
          type: 'agent:result' as const,
          agent: 'builder' as const,
          result: {
            durationMs: 1000,
            durationApiMs: 800,
            numTurns: 5,
            totalCostUsd: 0.5,
            usage: { input: 1000, output: 500, total: 1500 },
            modelUsage: {},
          },
        },
        eventId: '1',
      },
      {
        event: {
          type: 'agent:result' as const,
          agent: 'reviewer' as const,
          result: {
            durationMs: 500,
            durationApiMs: 400,
            numTurns: 1,
            totalCostUsd: 0.25,
            usage: { input: 2000, output: 300, total: 2300 },
            modelUsage: {},
          },
        },
        eventId: '2',
      },
    ];

    const result = dispatch(initialRunState, events);
    expect(result.tokensIn).toBe(3000);
    expect(result.tokensOut).toBe(800);
    expect(result.totalCost).toBeCloseTo(0.75);
    expect(result.events).toHaveLength(2);
  });

  it('tracks plan statuses through build lifecycle', () => {
    // planStatuses is now driven exclusively by plan:status:change lifecycle events.
    // Build events (plan:build:start, plan:build:review:start, etc.) no longer set status.
    // plan:status:change maps engine PlanStatus → UI PipelineStage:
    //   running   → 'implement'
    //   completed → 'complete'
    //   failed    → 'failed'
    let state = initialRunState;

    // plan:status:change(running) → UI stage 'implement'
    state = eforgeReducer(state, {
      type: 'ADD_EVENT',
      event: { type: 'plan:status:change', planId: 'plan-01', status: 'running' },
      eventId: '1',
    });
    expect(state.planStatuses['plan-01']).toBe('implement');

    // plan:build:review:start still advances the visible pipeline stage within a run
    state = eforgeReducer(state, {
      type: 'ADD_EVENT',
      event: { type: 'plan:build:review:start', planId: 'plan-01' },
      eventId: '2',
    });
    expect(state.planStatuses['plan-01']).toBe('review');

    // plan:build:review:complete advances to evaluate
    state = eforgeReducer(state, {
      type: 'ADD_EVENT',
      event: { type: 'plan:build:review:complete', planId: 'plan-01', issues: [] },
      eventId: '3',
    });
    expect(state.planStatuses['plan-01']).toBe('evaluate');

    // plan:status:change(completed) → UI stage 'complete'
    state = eforgeReducer(state, {
      type: 'ADD_EVENT',
      event: { type: 'plan:status:change', planId: 'plan-01', status: 'completed' },
      eventId: '4',
    });
    expect(state.planStatuses['plan-01']).toBe('complete');
  });

  it('tracks failed plan status', () => {
    const state = eforgeReducer(initialRunState, {
      type: 'ADD_EVENT',
      event: { type: 'plan:status:change', planId: 'plan-01', status: 'failed' },
      eventId: '1',
    });
    expect(state.planStatuses['plan-01']).toBe('failed');
  });

  it('handles events without planId (no status update)', () => {
    const state = eforgeReducer(initialRunState, {
      type: 'ADD_EVENT',
      event: { type: 'planning:start', source: 'test.md' },
      eventId: '1',
    });
    expect(Object.keys(state.planStatuses)).toHaveLength(0);
    expect(state.events).toHaveLength(1);
  });

  it('handles unknown event types gracefully', () => {
    const state = eforgeReducer(initialRunState, {
      type: 'ADD_EVENT',
      event: { type: 'totally:unknown' } as unknown as import('@eforge-build/client').EforgeEvent,
      eventId: '1',
    });
    expect(state.events).toHaveLength(1);
  });

  it('processes config:warning event without throwing and records it', () => {
    const event: EforgeEvent = {
      type: 'config:warning',
      message: 'eforge config warning: some fields were invalid and will be ignored',
      source: 'loadConfig',
      timestamp: '2024-01-01T00:00:00Z',
    };
    const state = eforgeReducer(initialRunState, {
      type: 'ADD_EVENT',
      event,
      eventId: 'cw-1',
    });
    // Event is recorded in state
    expect(state.events).toHaveLength(1);
    expect(state.events[0].event.type).toBe('config:warning');
    // State is otherwise unmodified
    expect(state.isComplete).toBe(false);
    expect(state.tokensIn).toBe(0);
  });

  it('processes plan:warning event without throwing and records it', () => {
    const event: EforgeEvent = {
      type: 'planning:warning',
      planId: 'plan-01',
      message: '[eforge] Plan file /path/to/plan.md: malformed agents block will be ignored',
      source: 'parsePlanFile',
      timestamp: '2024-01-01T00:00:00Z',
    };
    const state = eforgeReducer(initialRunState, {
      type: 'ADD_EVENT',
      event,
      eventId: 'pw-1',
    });
    // Event is recorded in state
    expect(state.events).toHaveLength(1);
    expect(state.events[0].event.type).toBe('planning:warning');
    // State is otherwise unmodified
    expect(state.isComplete).toBe(false);
  });

  it('processes plan:warning event without planId', () => {
    const event: EforgeEvent = {
      type: 'planning:warning',
      message: '[eforge] Plan orchestration warning: malformed agents block will be ignored',
      source: 'parseOrchestrationConfig',
      timestamp: '2024-01-01T00:00:00Z',
    };
    const state = eforgeReducer(initialRunState, {
      type: 'ADD_EVENT',
      event,
      eventId: 'pw-2',
    });
    expect(state.events).toHaveLength(1);
    expect(state.events[0].event.type).toBe('planning:warning');
  });

  it('populates fileChanges on build:files_changed', () => {
    const state = eforgeReducer(initialRunState, {
      type: 'ADD_EVENT',
      event: { type: 'plan:build:files_changed', planId: 'plan-01', files: ['src/a.ts', 'src/b.ts'] },
      eventId: '1',
    });
    expect(state.fileChanges.get('plan-01')).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('handles multiple build:files_changed for different plans', () => {
    let state = eforgeReducer(initialRunState, {
      type: 'ADD_EVENT',
      event: { type: 'plan:build:files_changed', planId: 'plan-01', files: ['src/a.ts'] },
      eventId: '1',
    });
    state = eforgeReducer(state, {
      type: 'ADD_EVENT',
      event: { type: 'plan:build:files_changed', planId: 'plan-02', files: ['src/b.ts'] },
      eventId: '2',
    });
    expect(state.fileChanges.get('plan-01')).toEqual(['src/a.ts']);
    expect(state.fileChanges.get('plan-02')).toEqual(['src/b.ts']);
  });

  it('is idempotent for duplicate build:files_changed events', () => {
    let state = eforgeReducer(initialRunState, {
      type: 'ADD_EVENT',
      event: { type: 'plan:build:files_changed', planId: 'plan-01', files: ['src/a.ts'] },
      eventId: '1',
    });
    state = eforgeReducer(state, {
      type: 'ADD_EVENT',
      event: { type: 'plan:build:files_changed', planId: 'plan-01', files: ['src/a.ts', 'src/b.ts'] },
      eventId: '2',
    });
    // Latest event overwrites
    expect(state.fileChanges.get('plan-01')).toEqual(['src/a.ts', 'src/b.ts']);
    expect(state.fileChanges.size).toBe(1);
  });

  it('marks plan as complete via plan:status:change after merge', () => {
    let state = eforgeReducer(initialRunState, {
      type: 'ADD_EVENT',
      event: { type: 'planning:complete', plans: [{ id: 'plan-01', name: 'Plan 1', branch: 'b', dependsOn: [], body: '', filePath: '' }] },
      eventId: '1',
    });
    expect(state.planStatuses['plan-01']).toBe('plan');

    // plan:merge:complete no longer sets status; plan:status:change drives it
    // 'merged' status maps to UI stage 'complete'
    state = eforgeReducer(state, {
      type: 'ADD_EVENT',
      event: { type: 'plan:status:change', planId: 'plan-01', status: 'merged' },
      eventId: '2',
    });
    expect(state.planStatuses['plan-01']).toBe('complete');
  });
});
