// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { RunInfo, EforgeEvent } from '@eforge-build/client/browser';
import type { ActiveSessionDetail } from '@/hooks/use-active-session-streams';
import { selectNowActiveBuildCards } from '@/lib/selectors/now';
import { createInitialRunState, eforgeReducer } from '@/lib/run-state';

function makeRun(overrides: Partial<RunInfo> = {}): RunInfo {
  return {
    id: 'run-1',
    sessionId: 's1',
    planSet: 'my-plans',
    command: 'build',
    status: 'running',
    startedAt: '2025-01-01T00:00:00.000Z',
    cwd: '/project',
    ...overrides,
  };
}

function makeActiveDetail(sessionId: string, runState = createInitialRunState()): ActiveSessionDetail {
  return {
    sessionId,
    connectionStatus: 'connected',
    status: 'running',
    runState,
    lastEventAt: Date.parse('2025-01-01T00:00:00.000Z'),
    error: null,
  };
}

describe('selectNowActiveBuildCards — direct base-sync labels', () => {
  it('derives latest progress from direct base-sync events', () => {
    const event = {
      type: 'base-sync:resolver:start',
      timestamp: '2025-01-01T00:00:00.000Z',
      remote: 'origin',
      baseBranch: 'main',
      featureBranch: 'eforge/feature-x',
      attempt: 1,
      maxAttempts: 3,
    } as unknown as EforgeEvent;
    const runState = eforgeReducer(createInitialRunState(), { type: 'ADD_EVENT', event, eventId: '1' });

    const cards = selectNowActiveBuildCards([makeRun()], {}, { s1: makeActiveDetail('s1', runState) }, Date.parse('2025-01-01T00:01:00.000Z'));

    expect(cards[0].latestProgress).toBe('Direct PR base sync resolver started (1/3)');
  });

  it('surfaces plan-less base-sync merge resolvers as feature branch lanes', () => {
    const runState = eforgeReducer(createInitialRunState(), {
      type: 'BATCH_LOAD',
      events: [
        { eventId: '1', event: {
          type: 'base-sync:resolver:start',
          timestamp: '2025-01-01T00:00:00.000Z',
          remote: 'origin',
          baseBranch: 'main',
          featureBranch: 'eforge/feature-x',
          attempt: 1,
          maxAttempts: 3,
        } as unknown as EforgeEvent },
        { eventId: '2', event: {
          type: 'agent:start',
          timestamp: '2025-01-01T00:00:01.000Z',
          agentId: 'resolver-1',
          agent: 'merge-conflict-resolver',
          model: 'test-model',
          harness: 'pi',
          harnessSource: 'tier',
          tier: 'planning',
          tierSource: 'tier',
        } as unknown as EforgeEvent },
      ],
    });

    const cards = selectNowActiveBuildCards([makeRun()], {}, { s1: makeActiveDetail('s1', {
      ...runState,
      earlyOrchestration: {
        mode: 'compile',
        pipeline: { scope: 'plan', build: [], review: { strategy: 'auto', maxRounds: 1 } },
        plans: [],
      },
    }) }, Date.parse('2025-01-01T00:01:00.000Z'));

    expect(cards[0].planLanes).toContainEqual(expect.objectContaining({
      planId: 'eforge/feature-x',
      planName: 'Feature branch: eforge/feature-x',
      agents: [{ agent: 'merge-conflict-resolver', tokens: 0, running: true }],
    }));
  });
});
