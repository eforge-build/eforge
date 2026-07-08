import { describe, expect, it } from 'vitest';
import { createInitialRunState, eforgeReducer } from '../reducer';
import { selectPlanLanes } from '../selectors/plan-progress';
import { laneLabel } from '../lane-registry';
import type { EforgeEvent } from '../types';

function event<T extends EforgeEvent['type']>(type: T, extra: Record<string, unknown> = {}): EforgeEvent {
  return {
    type,
    timestamp: '2025-01-01T00:00:00.000Z',
    ...extra,
  } as unknown as EforgeEvent;
}

function stored(eventValue: EforgeEvent, eventId: string) {
  return { event: eventValue, eventId };
}

function mergeResolverStart(agentId: string): EforgeEvent {
  return event('agent:start', {
    agentId,
    agent: 'merge-conflict-resolver',
    model: 'test-model',
    harness: 'pi',
    harnessSource: 'tier',
    tier: 'planning',
    tierSource: 'tier',
  });
}

function mergeResolverStop(agentId: string): EforgeEvent {
  return event('agent:stop', { agentId });
}

describe('direct base-sync run-state selectors', () => {
  it('associates replayed plan-less merge resolvers with the active feature branch lane', () => {
    const state = eforgeReducer(createInitialRunState(), {
      type: 'BATCH_LOAD',
      events: [
        stored(event('base-sync:start', {
          remote: 'origin',
          baseBranch: 'main',
          featureBranch: 'eforge/feature-x',
          maxAttempts: 3,
        }), 'base-sync-start'),
        stored(event('base-sync:resolver:start', {
          remote: 'origin',
          baseBranch: 'main',
          featureBranch: 'eforge/feature-x',
          attempt: 1,
          maxAttempts: 3,
        }), 'base-sync-resolver-start'),
        stored(mergeResolverStart('resolver-1'), 'agent-start'),
      ],
    });

    expect(state.agentThreads[0]?.planId).toBe('eforge/feature-x');
    expect(laneLabel('eforge/feature-x')).toBe('Feature branch: eforge/feature-x');

    const lanes = selectPlanLanes({
      ...state,
      earlyOrchestration: {
        mode: 'compile',
        pipeline: { scope: 'plan', build: [], review: { strategy: 'auto', maxRounds: 1 } },
        plans: [],
      },
    });
    expect(lanes).toHaveLength(1);
    expect(lanes[0]).toMatchObject({
      planId: 'eforge/feature-x',
      planName: 'Feature branch: eforge/feature-x',
      agents: [{ agent: 'merge-conflict-resolver', tokens: 0, running: true }],
    });
  });

  it('marks ended feature branch resolver lanes complete', () => {
    const state = eforgeReducer(createInitialRunState(), {
      type: 'BATCH_LOAD',
      events: [
        stored(event('base-sync:resolver:start', {
          remote: 'origin',
          baseBranch: 'main',
          featureBranch: 'eforge/feature-x',
          attempt: 1,
          maxAttempts: 3,
        }), 'base-sync-resolver-start'),
        stored(mergeResolverStart('resolver-1'), 'agent-start'),
        stored(mergeResolverStop('resolver-1'), 'agent-stop'),
      ],
    });

    const lanes = selectPlanLanes({
      ...state,
      earlyOrchestration: {
        mode: 'compile',
        pipeline: { scope: 'plan', build: [], review: { strategy: 'auto', maxRounds: 1 } },
        plans: [],
      },
    });
    expect(lanes[0]).toMatchObject({
      planId: 'eforge/feature-x',
      isComplete: true,
      agents: [{ agent: 'merge-conflict-resolver', tokens: 0, running: false }],
    });
  });

  it.each([
    ['base-sync:success', { baseSha: 'abc123', featureSha: 'def456', rebased: true }],
    ['base-sync:resolver:complete', { attempt: 1, maxAttempts: 3, resolved: false, remainingConflicts: 1 }],
    ['base-sync:budget:exhausted', { attempts: 3, maxAttempts: 3, conflictedFiles: ['src/a.ts'] }],
  ] as const)('does not reuse a completed direct base-sync feature branch after %s for later plan-less resolvers', (type, extra) => {
    const state = eforgeReducer(createInitialRunState(), {
      type: 'BATCH_LOAD',
      events: [
        stored(event('base-sync:resolver:start', {
          remote: 'origin',
          baseBranch: 'main',
          featureBranch: 'eforge/feature-x',
          attempt: 1,
          maxAttempts: 3,
        }), 'base-sync-resolver-start'),
        stored(event(type, {
          remote: 'origin',
          baseBranch: 'main',
          featureBranch: 'eforge/feature-x',
          ...extra,
        }), 'base-sync-terminal'),
        stored(mergeResolverStart('resolver-after-terminal'), 'agent-start'),
      ],
    });

    expect(state.agentThreads[0]?.planId).toBeUndefined();
    expect(selectPlanLanes(state)).toEqual([]);
  });
});
