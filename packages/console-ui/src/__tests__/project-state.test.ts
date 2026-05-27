import { describe, it, expect } from 'vitest';
import {
  consoleProjectReducer,
  initialConsoleProjectState,
  ACTIVITY_BUFFER_CAP,
  type ConsoleProjectState,
} from '@/lib/project-state';
import type { DaemonStreamSnapshot, EforgeEvent } from '@eforge-build/client/browser';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSnapshot(overrides: Partial<DaemonStreamSnapshot> = {}): DaemonStreamSnapshot {
  return {
    runs: [],
    queue: [],
    sessionMetadata: {},
    autoBuild: null,
    liveness: {
      uptime: 100,
      queueDepth: 0,
      runningBuilds: 0,
      autoBuild: false,
      subscribers: 1,
    },
    recentActivity: [],
    stackLayers: [],
    ...overrides,
  } as unknown as DaemonStreamSnapshot;
}

function makePlanQueuedEvent(): EforgeEvent {
  return { type: 'plan:queued', planId: 'p1' } as unknown as EforgeEvent;
}

function makeHeartbeatEvent(uptime = 42): EforgeEvent {
  return {
    type: 'daemon:heartbeat',
    uptime,
    queueDepth: 0,
    runningBuilds: 0,
    autoBuild: false,
    subscribers: 1,
  } as unknown as EforgeEvent;
}

// ---------------------------------------------------------------------------
// CONNECTING
// ---------------------------------------------------------------------------

describe('consoleProjectReducer – CONNECTING', () => {
  it('sets connectionStatus to connecting', () => {
    const state: ConsoleProjectState = {
      ...initialConsoleProjectState,
      connectionStatus: 'disconnected',
      error: 'previous error',
    };
    const next = consoleProjectReducer(state, { type: 'CONNECTING' });
    expect(next.connectionStatus).toBe('connecting');
  });

  it('clears error', () => {
    const state: ConsoleProjectState = {
      ...initialConsoleProjectState,
      error: 'some error',
    };
    const next = consoleProjectReducer(state, { type: 'CONNECTING' });
    expect(next.error).toBeNull();
  });

  it('preserves other state fields', () => {
    const state: ConsoleProjectState = {
      ...initialConsoleProjectState,
      lastSnapshotAt: 12345,
    };
    const next = consoleProjectReducer(state, { type: 'CONNECTING' });
    expect(next.lastSnapshotAt).toBe(12345);
  });
});

// ---------------------------------------------------------------------------
// STREAM_ERROR
// ---------------------------------------------------------------------------

describe('consoleProjectReducer – STREAM_ERROR', () => {
  it('sets connectionStatus to disconnected', () => {
    const next = consoleProjectReducer(initialConsoleProjectState, {
      type: 'STREAM_ERROR',
      error: 'connection refused',
    });
    expect(next.connectionStatus).toBe('disconnected');
  });

  it('stores error message', () => {
    const next = consoleProjectReducer(initialConsoleProjectState, {
      type: 'STREAM_ERROR',
      error: 'connection refused',
    });
    expect(next.error).toBe('connection refused');
  });

  it('preserves existing data fields', () => {
    const state: ConsoleProjectState = {
      ...initialConsoleProjectState,
      lastSnapshotAt: 9999,
      recentActivity: [{ id: 'x', event: makePlanQueuedEvent(), receivedAt: 1 }],
    };
    const next = consoleProjectReducer(state, { type: 'STREAM_ERROR', error: 'err' });
    expect(next.lastSnapshotAt).toBe(9999);
    expect(next.recentActivity).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// SNAPSHOT_RECEIVED
// ---------------------------------------------------------------------------

describe('consoleProjectReducer – SNAPSHOT_RECEIVED', () => {
  it('replaces runs from snapshot', () => {
    const run = { id: 'r1', sessionId: 's1', status: 'running' };
    const snapshot = makeSnapshot({ runs: [run] as unknown as DaemonStreamSnapshot['runs'] });
    const next = consoleProjectReducer(initialConsoleProjectState, {
      type: 'SNAPSHOT_RECEIVED',
      snapshot,
      receivedAt: 1000,
    });
    expect(next.runs).toHaveLength(1);
    expect(next.runs[0]).toMatchObject({ id: 'r1' });
  });

  it('replaces queue from snapshot', () => {
    const item = { id: 'q1', planId: 'p1' };
    const snapshot = makeSnapshot({ queue: [item] as unknown as DaemonStreamSnapshot['queue'] });
    const next = consoleProjectReducer(initialConsoleProjectState, {
      type: 'SNAPSHOT_RECEIVED',
      snapshot,
      receivedAt: 1000,
    });
    expect(next.queue).toHaveLength(1);
    expect(next.queue[0]).toMatchObject({ id: 'q1' });
  });

  it('replaces sessionMetadata from snapshot', () => {
    const metadata = { s1: { sessionId: 's1', planId: 'p1' } };
    const snapshot = makeSnapshot({
      sessionMetadata: metadata as unknown as DaemonStreamSnapshot['sessionMetadata'],
    });
    const next = consoleProjectReducer(initialConsoleProjectState, {
      type: 'SNAPSHOT_RECEIVED',
      snapshot,
      receivedAt: 1000,
    });
    expect(next.sessionMetadata).toMatchObject({ s1: { sessionId: 's1' } });
  });

  it('replaces autoBuild from snapshot', () => {
    const autoBuild = { enabled: true, watchDir: '/foo' };
    const snapshot = makeSnapshot({
      autoBuild: autoBuild as unknown as DaemonStreamSnapshot['autoBuild'],
    });
    const next = consoleProjectReducer(initialConsoleProjectState, {
      type: 'SNAPSHOT_RECEIVED',
      snapshot,
      receivedAt: 1000,
    });
    expect(next.autoBuild).toMatchObject({ enabled: true });
  });

  it('sets liveness from snapshot', () => {
    const liveness = { uptime: 200, queueDepth: 1, runningBuilds: 2, autoBuild: true, subscribers: 3 };
    const snapshot = makeSnapshot({ liveness });
    const next = consoleProjectReducer(initialConsoleProjectState, {
      type: 'SNAPSHOT_RECEIVED',
      snapshot,
      receivedAt: 1000,
    });
    expect(next.liveness).toMatchObject({ uptime: 200, runningBuilds: 2 });
  });

  it('sets latestHeartbeat from liveness fields', () => {
    const liveness = { uptime: 50, queueDepth: 0, runningBuilds: 1, autoBuild: false, subscribers: 2 };
    const snapshot = makeSnapshot({ liveness });
    const next = consoleProjectReducer(initialConsoleProjectState, {
      type: 'SNAPSHOT_RECEIVED',
      snapshot,
      receivedAt: 5000,
    });
    expect(next.latestHeartbeat).not.toBeNull();
    expect(next.latestHeartbeat?.at).toBe(5000);
    expect(next.latestHeartbeat?.payload.uptime).toBe(50);
    expect(next.latestHeartbeat?.payload.runningBuilds).toBe(1);
  });

  it('replaces stackLayers from snapshot', () => {
    const layer = { id: 'l1', name: 'base' };
    const snapshot = makeSnapshot({
      stackLayers: [layer] as unknown as DaemonStreamSnapshot['stackLayers'],
    });
    const next = consoleProjectReducer(initialConsoleProjectState, {
      type: 'SNAPSHOT_RECEIVED',
      snapshot,
      receivedAt: 1000,
    });
    expect(next.stackLayers).toHaveLength(1);
    expect(next.stackLayers[0]).toMatchObject({ id: 'l1' });
  });

  it('sets connectionStatus to connected', () => {
    const next = consoleProjectReducer(initialConsoleProjectState, {
      type: 'SNAPSHOT_RECEIVED',
      snapshot: makeSnapshot(),
      receivedAt: 1000,
    });
    expect(next.connectionStatus).toBe('connected');
  });

  it('sets lastSnapshotAt to receivedAt', () => {
    const next = consoleProjectReducer(initialConsoleProjectState, {
      type: 'SNAPSHOT_RECEIVED',
      snapshot: makeSnapshot(),
      receivedAt: 7777,
    });
    expect(next.lastSnapshotAt).toBe(7777);
  });

  it('clears error on snapshot', () => {
    const state: ConsoleProjectState = {
      ...initialConsoleProjectState,
      error: 'previous error',
    };
    const next = consoleProjectReducer(state, {
      type: 'SNAPSHOT_RECEIVED',
      snapshot: makeSnapshot(),
      receivedAt: 1000,
    });
    expect(next.error).toBeNull();
  });

  it('seeds recentActivity from snapshot recentActivity', () => {
    const event = makePlanQueuedEvent();
    const snapshot = makeSnapshot({
      recentActivity: [{ id: 1, event }] as unknown as DaemonStreamSnapshot['recentActivity'],
    });
    const next = consoleProjectReducer(initialConsoleProjectState, {
      type: 'SNAPSHOT_RECEIVED',
      snapshot,
      receivedAt: 1000,
    });
    expect(next.recentActivity).toHaveLength(1);
    expect(next.recentActivity[0].id).toBe('1');
    expect(next.recentActivity[0].receivedAt).toBe(1000);
  });

  it('deduplicates recentActivity by id when snapshot overlaps existing entries', () => {
    const event = makePlanQueuedEvent();
    const existing: ConsoleProjectState = {
      ...initialConsoleProjectState,
      recentActivity: [{ id: '1', event, receivedAt: 500 }],
    };
    const snapshot = makeSnapshot({
      recentActivity: [
        { id: 1, event },
        { id: 2, event },
      ] as unknown as DaemonStreamSnapshot['recentActivity'],
    });
    const next = consoleProjectReducer(existing, {
      type: 'SNAPSHOT_RECEIVED',
      snapshot,
      receivedAt: 1000,
    });
    // id '1' already present; only id '2' added
    expect(next.recentActivity).toHaveLength(2);
    expect(next.recentActivity.map((e) => e.id)).toContain('1');
    expect(next.recentActivity.map((e) => e.id)).toContain('2');
  });
});

// ---------------------------------------------------------------------------
// EVENT_RECEIVED – non-heartbeat
// ---------------------------------------------------------------------------

describe('consoleProjectReducer – EVENT_RECEIVED (non-heartbeat)', () => {
  it('appends entry to recentActivity', () => {
    const event = makePlanQueuedEvent();
    const next = consoleProjectReducer(initialConsoleProjectState, {
      type: 'EVENT_RECEIVED',
      event,
      eventId: 'ev-1',
      receivedAt: 2000,
    });
    expect(next.recentActivity).toHaveLength(1);
    expect(next.recentActivity[0]).toMatchObject({ id: 'ev-1', receivedAt: 2000 });
  });

  it('sets lastEventAt to receivedAt', () => {
    const event = makePlanQueuedEvent();
    const next = consoleProjectReducer(initialConsoleProjectState, {
      type: 'EVENT_RECEIVED',
      event,
      eventId: 'ev-2',
      receivedAt: 3333,
    });
    expect(next.lastEventAt).toBe(3333);
  });

  it('enforces activity buffer cap: oldest entry removed at capacity', () => {
    // Fill buffer to capacity
    const filledActivity = Array.from({ length: ACTIVITY_BUFFER_CAP }, (_, i) => ({
      id: `e${i}`,
      event: makePlanQueuedEvent(),
      receivedAt: i,
    }));
    const fullState: ConsoleProjectState = {
      ...initialConsoleProjectState,
      recentActivity: filledActivity,
    };
    const event = makePlanQueuedEvent();
    const next = consoleProjectReducer(fullState, {
      type: 'EVENT_RECEIVED',
      event,
      eventId: 'new-event',
      receivedAt: 9999,
    });
    expect(next.recentActivity).toHaveLength(ACTIVITY_BUFFER_CAP);
    // Oldest entry removed
    expect(next.recentActivity[0].id).toBe('e1');
    // Newest entry appended
    expect(next.recentActivity[ACTIVITY_BUFFER_CAP - 1].id).toBe('new-event');
  });

  it('does not update latestHeartbeat for non-heartbeat events', () => {
    const state: ConsoleProjectState = {
      ...initialConsoleProjectState,
      latestHeartbeat: { at: 100, payload: { uptime: 10, queueDepth: 0, runningBuilds: 0, autoBuild: false, subscribers: 1 } },
    };
    const next = consoleProjectReducer(state, {
      type: 'EVENT_RECEIVED',
      event: makePlanQueuedEvent(),
      eventId: 'ev-3',
      receivedAt: 200,
    });
    expect(next.latestHeartbeat?.at).toBe(100);
  });
});

// ---------------------------------------------------------------------------
// EVENT_RECEIVED – empty eventId fallback
// ---------------------------------------------------------------------------

describe('consoleProjectReducer – EVENT_RECEIVED (empty eventId)', () => {
  it('generates a non-empty fallback id when eventId is empty', () => {
    const event = makePlanQueuedEvent();
    const next = consoleProjectReducer(initialConsoleProjectState, {
      type: 'EVENT_RECEIVED',
      event,
      eventId: '',
      receivedAt: 2000,
    });
    expect(next.recentActivity).toHaveLength(1);
    expect(next.recentActivity[0].id).not.toBe('');
    expect(next.recentActivity[0].id).toBeTruthy();
  });

  it('generates distinct fallback ids for consecutive empty-eventId events at the same timestamp', () => {
    const event = makePlanQueuedEvent();
    const state1 = consoleProjectReducer(initialConsoleProjectState, {
      type: 'EVENT_RECEIVED',
      event,
      eventId: '',
      receivedAt: 2000,
    });
    const state2 = consoleProjectReducer(state1, {
      type: 'EVENT_RECEIVED',
      event,
      eventId: '',
      receivedAt: 2000,
    });
    const ids = state2.recentActivity.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('fallback id does not collide with snapshot numeric ids', () => {
    const event = makePlanQueuedEvent();
    const next = consoleProjectReducer(initialConsoleProjectState, {
      type: 'EVENT_RECEIVED',
      event,
      eventId: '',
      receivedAt: 2000,
    });
    // Snapshot ids are plain numeric strings; fallback id should be namespaced
    expect(next.recentActivity[0].id).toMatch(/^live-/);
  });
});

// ---------------------------------------------------------------------------
// EVENT_RECEIVED – heartbeat
// ---------------------------------------------------------------------------

describe('consoleProjectReducer – EVENT_RECEIVED (daemon:heartbeat)', () => {
  it('does NOT append to recentActivity', () => {
    const next = consoleProjectReducer(initialConsoleProjectState, {
      type: 'EVENT_RECEIVED',
      event: makeHeartbeatEvent(),
      eventId: 'hb-1',
      receivedAt: 5000,
    });
    expect(next.recentActivity).toHaveLength(0);
  });

  it('updates latestHeartbeat with uptime from heartbeat event', () => {
    const next = consoleProjectReducer(initialConsoleProjectState, {
      type: 'EVENT_RECEIVED',
      event: makeHeartbeatEvent(99),
      eventId: 'hb-2',
      receivedAt: 6000,
    });
    expect(next.latestHeartbeat).not.toBeNull();
    expect(next.latestHeartbeat?.at).toBe(6000);
    expect(next.latestHeartbeat?.payload.uptime).toBe(99);
  });

  it('sets lastEventAt for heartbeat events', () => {
    const next = consoleProjectReducer(initialConsoleProjectState, {
      type: 'EVENT_RECEIVED',
      event: makeHeartbeatEvent(),
      eventId: 'hb-3',
      receivedAt: 7000,
    });
    expect(next.lastEventAt).toBe(7000);
  });

  it('does not update latestHeartbeat when uptime is not a number', () => {
    const event = {
      type: 'daemon:heartbeat',
      uptime: 'not-a-number',
      queueDepth: 0,
      runningBuilds: 0,
      autoBuild: false,
      subscribers: 1,
    } as unknown as EforgeEvent;
    const prior = { at: 1, payload: { uptime: 5, queueDepth: 0, runningBuilds: 0, autoBuild: false, subscribers: 0 } };
    const state: ConsoleProjectState = { ...initialConsoleProjectState, latestHeartbeat: prior };
    const next = consoleProjectReducer(state, {
      type: 'EVENT_RECEIVED',
      event,
      eventId: 'hb-4',
      receivedAt: 8000,
    });
    // latestHeartbeat unchanged when uptime is not a number
    expect(next.latestHeartbeat?.at).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// SNAPSHOT_RECEIVED – stack sync seeding
// ---------------------------------------------------------------------------

describe('consoleProjectReducer – SNAPSHOT_RECEIVED (stackSync)', () => {
  it('seeds stackSync from snapshot stackSyncStatus', () => {
    const stackSyncStatus = {
      last: {
        id: 'sync-1',
        trigger: 'after-build' as const,
        startedAt: '2024-01-01T00:00:00Z',
        completedAt: '2024-01-01T00:00:01Z',
        outcome: 'complete' as const,
        dryRun: false,
        restackCandidates: ['feat/a', 'feat/b'],
      },
    };
    const snapshot = makeSnapshot({
      stackSyncStatus: stackSyncStatus as unknown as DaemonStreamSnapshot['stackSyncStatus'],
    });
    const next = consoleProjectReducer(initialConsoleProjectState, {
      type: 'SNAPSHOT_RECEIVED',
      snapshot,
      receivedAt: 1000,
    });
    expect(next.stackSync).not.toBeNull();
    expect(next.stackSync?.last?.id).toBe('sync-1');
    expect(next.stackSync?.last?.outcome).toBe('complete');
  });

  it('sets stackSync to null when snapshot has no stackSyncStatus', () => {
    const snapshot = makeSnapshot();
    const next = consoleProjectReducer(initialConsoleProjectState, {
      type: 'SNAPSHOT_RECEIVED',
      snapshot,
      receivedAt: 1000,
    });
    expect(next.stackSync).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// EVENT_RECEIVED – stack sync event projection
// ---------------------------------------------------------------------------

describe('consoleProjectReducer – EVENT_RECEIVED (stack:sync:complete)', () => {
  it('updates stackSync.last with complete outcome', () => {
    const event = {
      type: 'stack:sync:complete',
      syncId: 'sync-complete-1',
      trigger: 'manual' as const,
      dryRun: false,
      restackCandidates: ['feat/x'],
      localTrunkSha: 'abc123',
      originTrunkSha: 'abc123',
      fastForward: true,
    } as unknown as EforgeEvent;
    const next = consoleProjectReducer(initialConsoleProjectState, {
      type: 'EVENT_RECEIVED',
      event,
      eventId: 'ev-sync-1',
      receivedAt: 2000,
    });
    expect(next.stackSync?.last?.id).toBe('sync-complete-1');
    expect(next.stackSync?.last?.outcome).toBe('complete');
    expect(next.stackSync?.last?.trigger).toBe('manual');
    expect(next.stackSync?.last?.dryRun).toBe(false);
    expect(next.stackSync?.last?.restackCandidates).toEqual(['feat/x']);
    expect(next.stackSync?.current).toBeUndefined();
  });
});

describe('consoleProjectReducer – EVENT_RECEIVED (stack:sync:failed)', () => {
  it('updates stackSync.last with failed outcome', () => {
    const event = {
      type: 'stack:sync:failed',
      syncId: 'sync-failed-1',
      trigger: 'after-build' as const,
      dryRun: false,
      outcome: 'failed' as const,
      reason: 'provider command failed',
      error: 'git command exited with code 1',
    } as unknown as EforgeEvent;
    const next = consoleProjectReducer(initialConsoleProjectState, {
      type: 'EVENT_RECEIVED',
      event,
      eventId: 'ev-sync-2',
      receivedAt: 3000,
    });
    expect(next.stackSync?.last?.id).toBe('sync-failed-1');
    expect(next.stackSync?.last?.outcome).toBe('failed');
    expect(next.stackSync?.last?.reason).toBe('provider command failed');
    expect(next.stackSync?.last?.error).toBe('git command exited with code 1');
    expect(next.stackSync?.current).toBeUndefined();
  });

  it('updates stackSync.last with conflict outcome', () => {
    const event = {
      type: 'stack:sync:failed',
      syncId: 'sync-conflict-1',
      trigger: 'manual' as const,
      dryRun: false,
      outcome: 'conflict' as const,
      reason: 'merge conflict on feat/a',
    } as unknown as EforgeEvent;
    const next = consoleProjectReducer(initialConsoleProjectState, {
      type: 'EVENT_RECEIVED',
      event,
      eventId: 'ev-sync-3',
      receivedAt: 4000,
    });
    expect(next.stackSync?.last?.outcome).toBe('conflict');
    expect(next.stackSync?.last?.reason).toBe('merge conflict on feat/a');
  });
});

describe('consoleProjectReducer – EVENT_RECEIVED (stack:sync:deferred)', () => {
  it('updates stackSync.last with deferred outcome', () => {
    const event = {
      type: 'stack:sync:deferred',
      syncId: 'sync-deferred-1',
      trigger: 'after-build' as const,
      reason: 'active build in progress',
    } as unknown as EforgeEvent;
    const next = consoleProjectReducer(initialConsoleProjectState, {
      type: 'EVENT_RECEIVED',
      event,
      eventId: 'ev-sync-4',
      receivedAt: 5000,
    });
    expect(next.stackSync?.last?.id).toBe('sync-deferred-1');
    expect(next.stackSync?.last?.outcome).toBe('deferred');
    expect(next.stackSync?.last?.reason).toBe('active build in progress');
    expect(next.stackSync?.last?.dryRun).toBe(false);
    expect(next.stackSync?.current).toBeUndefined();
  });
});

describe('consoleProjectReducer – EVENT_RECEIVED (stack:sync:skipped)', () => {
  it('updates stackSync.last with skipped outcome and clears current', () => {
    const startEvent = {
      type: 'stack:sync:start',
      syncId: 'sync-skipped-1',
      trigger: 'manual' as const,
      dryRun: false,
      timestamp: new Date(4000).toISOString(),
    } as unknown as EforgeEvent;
    const stateWithCurrent = consoleProjectReducer(initialConsoleProjectState, {
      type: 'EVENT_RECEIVED',
      event: startEvent,
      eventId: 'ev-sync-start',
      receivedAt: 4000,
    });
    const event = {
      type: 'stack:sync:skipped',
      syncId: 'sync-skipped-1',
      trigger: 'manual' as const,
      dryRun: false,
      reason: 'no candidates to restack after active-build exclusions',
      restackCandidates: [],
      timestamp: new Date(5000).toISOString(),
    } as unknown as EforgeEvent;
    const next = consoleProjectReducer(stateWithCurrent, {
      type: 'EVENT_RECEIVED',
      event,
      eventId: 'ev-sync-skipped',
      receivedAt: 5000,
    });
    expect(next.stackSync?.last?.id).toBe('sync-skipped-1');
    expect(next.stackSync?.last?.outcome).toBe('skipped');
    expect(next.stackSync?.last?.reason).toBe('no candidates to restack after active-build exclusions');
    expect(next.stackSync?.last?.dryRun).toBe(false);
    expect(next.stackSync?.current).toBeUndefined();
  });
});
