// @vitest-environment node
import { describe, it, expect } from 'vitest';
import type { RunInfo, EforgeEvent } from '@eforge-build/client/browser';
import type { ActiveSessionDetail } from '@/hooks/use-active-session-streams';
import { selectNowActiveBuildCards } from '@/lib/selectors/now';
import { eforgeReducer, createInitialRunState } from '@/lib/run-state';

describe('now planning row derivation', () => {
  it('shows the planning row when the only activity is pre-planning agent threads (no planning events, no orchestration)', () => {
    const run: RunInfo = {
      id: 'r1',
      sessionId: 's1',
      planSet: 'my-plans',
      command: 'build',
      status: 'running',
      startedAt: new Date(Date.now() - 10_000).toISOString(),
      cwd: '/project',
    };
    const gateStart: EforgeEvent = {
      type: 'agent:start',
      agentId: 'agent-1',
      agent: 'planner',
      planId: 'satisfaction-gate',
      timestamp: '2024-01-01T00:00:00.000Z',
      model: 'test-model',
    } as unknown as EforgeEvent;
    const rs = eforgeReducer(createInitialRunState(), { type: 'ADD_EVENT', event: gateStart, eventId: '1' });
    const detail: ActiveSessionDetail = {
      sessionId: 's1',
      connectionStatus: 'connected',
      status: 'running',
      runState: rs,
      lastEventAt: Date.now(),
      error: null,
    };

    const cards = selectNowActiveBuildCards([run], {}, { s1: detail }, Date.now());

    // No earlyOrchestration and no planning:* events — the row is driven
    // purely by the folded pre-planning agent threads.
    expect(rs.earlyOrchestration == null).toBe(true);
    expect(rs.events.some((e) => e.event.type.startsWith('planning:'))).toBe(false);
    expect(cards[0].hasPlanningRow).toBe(true);
    expect(cards[0].planning.agents).toEqual([{ agent: 'satisfaction-gate', tokens: 0, running: true }]);
  });
});
