import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  daemonReducer,
  initialDaemonState,
  selectLatestSessionId,
  selectAutoBuildEnabled,
  selectQueueItems,
  selectRuns,
  selectDaemonActivity,
  selectHeartbeatStaleness,
  selectStackLayers,
  ACTIVITY_BUFFER_CAP,
  type DaemonState,
  type HeartbeatPayload,
} from '../daemon-reducer';
import type { EforgeEvent } from '../types';
import type { AutoBuildState } from '../api';
import type { QueueItem, StackLayerWire } from '../types';
import {
  makeAutoBuildState,
  makeEvent,
  makeHeartbeatPayload,
  makeQueueItem,
  makeRun,
} from './daemon-reducer-test-helpers';

// --- eforge:region daemon-reducer-activity-lifecycle ---
describe('daemonActivity ring buffer', () => {
  it('appends non-heartbeat events to daemonActivity', () => {
    const event = makeEvent('daemon:lifecycle:starting', {
      pid: 42,
      port: 8080,
      version: '1.0.0',
      mode: 'development',
    });

    const next = daemonReducer(initialDaemonState, {
      type: 'ADD_EVENT',
      event,
      eventId: 'e1',
    });

    expect(next.daemonActivity).toHaveLength(1);
    expect(next.daemonActivity[0].id).toBe('e1');
    expect(next.daemonActivity[0].event).toBe(event);
    expect(typeof next.daemonActivity[0].receivedAt).toBe('number');
  });

  it('caps at 500 entries and drops the oldest on overflow', () => {
    let state = initialDaemonState;
    for (let i = 0; i < 501; i++) {
      const event = makeEvent('daemon:lifecycle:starting', {
        pid: i,
        port: 8080,
        version: '1.0.0',
        mode: 'dev',
      });
      state = daemonReducer(state, {
        type: 'ADD_EVENT',
        event,
        eventId: `e${i}`,
      });
    }

    expect(state.daemonActivity).toHaveLength(500);
    // e0 was dropped; e1 is the oldest remaining
    expect(state.daemonActivity[0].id).toBe('e1');
    // e500 is the newest
    expect(state.daemonActivity[499].id).toBe('e500');
  });
});

describe('ADD_EVENT: daemon:heartbeat — autoBuild scheduler merge', () => {
  it('merges heartbeat lifecycle and scheduler capacity fields into existing state.autoBuild', () => {
    const state: DaemonState = {
      ...initialDaemonState,
      autoBuild: {
        ...makeAutoBuildState(true),
        scheduler: { alive: false, paused: true },
      },
    };
    const heartbeatTransition = {
      at: '2024-01-15T10:00:00.000Z',
      previousMode: 'running',
      nextMode: 'paused',
      desired: 'enabled' as const,
      reason: 'capacity reached',
      source: 'scheduler',
    };
    const event = makeEvent('daemon:heartbeat', {
      uptime: 5_000,
      queueDepth: 1,
      runningBuilds: 2,
      autoBuild: {
        enabled: false,
        paused: true,
        desired: 'enabled',
        mode: 'paused',
        scheduler: {
          alive: true,
          paused: false,
          lastMutationReason: 'apply-recovery',
          runningCount: 2,
          limit: 4,
        },
        lastTransition: heartbeatTransition,
        reason: 'capacity reached',
      },
      subscribers: 1,
    });

    const next = daemonReducer(state, { type: 'ADD_EVENT', event, eventId: 'hb1' });

    expect(next.latestHeartbeat).not.toBeNull();
    expect(next.latestHeartbeat!.payload.runningBuilds).toBe(2);
    expect(next.autoBuild).toMatchObject({
      enabled: false,
      desired: 'enabled',
      mode: 'paused',
      reason: 'capacity reached',
      lastTransition: heartbeatTransition,
      scheduler: {
        alive: true,
        paused: false,
        lastMutationReason: 'apply-recovery',
        runningCount: 2,
        limit: 4,
      },
    });
    expect(next.autoBuild?.watcher).toEqual(state.autoBuild?.watcher);
    expect(next.daemonActivity).toHaveLength(0);
  });

  it('does not update autoBuild when state.autoBuild is null', () => {
    const event = makeEvent('daemon:heartbeat', {
      uptime: 5_000,
      queueDepth: 0,
      runningBuilds: 0,
      autoBuild: {
        enabled: false,
        paused: false,
        scheduler: { alive: false, paused: false, runningCount: 0, limit: 2 },
      },
      subscribers: 0,
    });

    const next = daemonReducer(initialDaemonState, { type: 'ADD_EVENT', event, eventId: 'hb1' });

    expect(next.autoBuild).toBeNull();
    expect(next.latestHeartbeat).not.toBeNull();
  });

  it('preserves existing scheduler details when an older heartbeat omits scheduler fields', () => {
    const state: DaemonState = {
      ...initialDaemonState,
      autoBuild: {
        ...makeAutoBuildState(true),
        scheduler: {
          alive: true,
          paused: false,
          lastMutationReason: 'playbook-enqueue',
          runningCount: 3,
          limit: 5,
        },
      },
    };
    const event = makeEvent('daemon:heartbeat', {
      uptime: 1_000,
      queueDepth: 0,
      runningBuilds: 0,
      autoBuild: {
        enabled: false,
        paused: true,
        desired: 'enabled',
        mode: 'paused',
        reason: 'older heartbeat without scheduler capacity',
      },
      subscribers: 1,
    });

    const next = daemonReducer(state, { type: 'ADD_EVENT', event, eventId: 'hb1' });

    expect(next.autoBuild).toMatchObject({
      enabled: false,
      desired: 'enabled',
      mode: 'paused',
      reason: 'older heartbeat without scheduler capacity',
      scheduler: {
        alive: true,
        paused: false,
        lastMutationReason: 'playbook-enqueue',
        runningCount: 3,
        limit: 5,
      },
    });
    expect(next.daemonActivity).toHaveLength(0);
  });
});

describe('ADD_EVENT: daemon:heartbeat', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('updates latestHeartbeat and does NOT append to daemonActivity', () => {
    const event = makeEvent('daemon:heartbeat', {
      uptime: 5_000,
      queueDepth: 2,
      runningBuilds: 1,
      autoBuild: { enabled: true, paused: false },
      subscribers: 3,
    });

    const next = daemonReducer(initialDaemonState, {
      type: 'ADD_EVENT',
      event,
      eventId: 'hb1',
    });

    expect(next.latestHeartbeat).not.toBeNull();
    expect(next.latestHeartbeat!.payload.uptime).toBe(5_000);
    expect(next.latestHeartbeat!.payload.queueDepth).toBe(2);
    expect(next.latestHeartbeat!.payload.runningBuilds).toBe(1);
    expect(next.latestHeartbeat!.payload.autoBuild).toEqual({ enabled: true, paused: false });
    expect(next.latestHeartbeat!.payload.subscribers).toBe(3);
    // heartbeat must NOT go into the activity buffer
    expect(next.daemonActivity).toHaveLength(0);
  });

  it('overwrites latestHeartbeat on successive heartbeats', () => {
    const event1 = makeEvent('daemon:heartbeat', makeHeartbeatPayload({ uptime: 1_000 }));
    const event2 = makeEvent('daemon:heartbeat', makeHeartbeatPayload({ uptime: 2_000 }));

    const s1 = daemonReducer(initialDaemonState, {
      type: 'ADD_EVENT',
      event: event1,
      eventId: 'hb1',
    });
    const s2 = daemonReducer(s1, {
      type: 'ADD_EVENT',
      event: event2,
      eventId: 'hb2',
    });

    expect(s2.latestHeartbeat!.payload.uptime).toBe(2_000);
    expect(s2.daemonActivity).toHaveLength(0);
  });
});

describe('ADD_EVENT: daemon:lifecycle events', () => {
  it('appends daemon:lifecycle:starting to daemonActivity with no other state change', () => {
    const event = makeEvent('daemon:lifecycle:starting', {
      pid: 1,
      port: 8080,
      version: '1.0.0',
      mode: 'production',
    });

    const next = daemonReducer(initialDaemonState, {
      type: 'ADD_EVENT',
      event,
      eventId: 'e1',
    });

    expect(next.daemonActivity).toHaveLength(1);
    expect(next.runs).toEqual(initialDaemonState.runs);
    expect(next.queue).toEqual(initialDaemonState.queue);
    expect(next.autoBuild).toBeNull();
  });

  it('appends daemon:lifecycle:ready to daemonActivity', () => {
    const event = makeEvent('daemon:lifecycle:ready', {
      pid: 1,
      port: 8080,
      version: '1.0.0',
      mode: 'production',
      recoveryDurationMs: 50,
    });

    const next = daemonReducer(initialDaemonState, {
      type: 'ADD_EVENT',
      event,
      eventId: 'e2',
    });

    expect(next.daemonActivity).toHaveLength(1);
    expect(next.daemonActivity[0].event.type).toBe('daemon:lifecycle:ready');
  });

  it('appends daemon:lifecycle:shutdown:start to daemonActivity', () => {
    const event = makeEvent('daemon:lifecycle:shutdown:start', {
      signal: 'SIGTERM',
      reason: 'user request',
    });

    const next = daemonReducer(initialDaemonState, {
      type: 'ADD_EVENT',
      event,
      eventId: 'e3',
    });

    expect(next.daemonActivity).toHaveLength(1);
  });

  it('appends daemon:lifecycle:shutdown:complete to daemonActivity', () => {
    const event = makeEvent('daemon:lifecycle:shutdown:complete', { durationMs: 200 });

    const next = daemonReducer(initialDaemonState, {
      type: 'ADD_EVENT',
      event,
      eventId: 'e4',
    });

    expect(next.daemonActivity).toHaveLength(1);
  });
});

describe('ADD_EVENT: daemon:scheduler events', () => {
  it('appends daemon:scheduler:dequeued to daemonActivity', () => {
    const event = makeEvent('daemon:scheduler:dequeued', {
      prdId: 'prd-1',
      queueDepth: 1,
      capacityRemaining: 1,
    });

    const next = daemonReducer(initialDaemonState, {
      type: 'ADD_EVENT',
      event,
      eventId: 'e1',
    });

    expect(next.daemonActivity).toHaveLength(1);
  });

  it('appends daemon:scheduler:capacity-blocked to daemonActivity', () => {
    const event = makeEvent('daemon:scheduler:capacity-blocked', {
      queueDepth: 3,
      runningCount: 2,
      limit: 2,
    });

    const next = daemonReducer(initialDaemonState, {
      type: 'ADD_EVENT',
      event,
      eventId: 'e2',
    });

    expect(next.daemonActivity).toHaveLength(1);
  });

  it('appends daemon:scheduler:dependency-blocked to daemonActivity', () => {
    const event = makeEvent('daemon:scheduler:dependency-blocked', {
      prdId: 'prd-2',
      blockedBy: ['prd-1'],
    });

    const next = daemonReducer(initialDaemonState, {
      type: 'ADD_EVENT',
      event,
      eventId: 'e3',
    });

    expect(next.daemonActivity).toHaveLength(1);
  });
});

describe('ADD_EVENT: daemon:auto-build extensions', () => {
  it('daemon:auto-build:enabled sets autoBuild.enabled = true and appends to activity', () => {
    const state: DaemonState = {
      ...initialDaemonState,
      autoBuild: makeAutoBuildState(false),
    };
    const event = makeEvent('daemon:auto-build:enabled', {});

    const next = daemonReducer(state, { type: 'ADD_EVENT', event, eventId: 'e1' });

    expect(next.autoBuild?.enabled).toBe(true);
    expect(next.daemonActivity).toHaveLength(1);
  });

  it('daemon:auto-build:enabled is a no-op when autoBuild is null', () => {
    const event = makeEvent('daemon:auto-build:enabled', {});
    const next = daemonReducer(initialDaemonState, { type: 'ADD_EVENT', event, eventId: 'e1' });

    expect(next.autoBuild).toBeNull();
    expect(next.daemonActivity).toHaveLength(1); // activity still appended
  });

  it('daemon:auto-build:disabled sets autoBuild.enabled = false and appends to activity', () => {
    const state: DaemonState = {
      ...initialDaemonState,
      autoBuild: makeAutoBuildState(true),
    };
    const event = makeEvent('daemon:auto-build:disabled', {});

    const next = daemonReducer(state, { type: 'ADD_EVENT', event, eventId: 'e1' });

    expect(next.autoBuild?.enabled).toBe(false);
    expect(next.daemonActivity).toHaveLength(1);
  });

  it('daemon:auto-build:disabled is a no-op when autoBuild is null', () => {
    const event = makeEvent('daemon:auto-build:disabled', {});
    const next = daemonReducer(initialDaemonState, { type: 'ADD_EVENT', event, eventId: 'e1' });

    expect(next.autoBuild).toBeNull();
    expect(next.daemonActivity).toHaveLength(1); // activity still appended
  });

  it('daemon:auto-build:resumed sets autoBuild.enabled = true and appends to activity', () => {
    const state: DaemonState = {
      ...initialDaemonState,
      autoBuild: makeAutoBuildState(false),
    };
    const event = makeEvent('daemon:auto-build:resumed', {});

    const next = daemonReducer(state, { type: 'ADD_EVENT', event, eventId: 'e1' });

    expect(next.autoBuild?.enabled).toBe(true);
    expect(next.daemonActivity).toHaveLength(1);
  });

  it('daemon:auto-build:triggered appends to activity with no autoBuild change', () => {
    const state: DaemonState = {
      ...initialDaemonState,
      autoBuild: makeAutoBuildState(true),
    };
    const event = makeEvent('daemon:auto-build:triggered', {
      trigger: 'file',
      prdsEnqueued: 1,
    });

    const next = daemonReducer(state, { type: 'ADD_EVENT', event, eventId: 'e1' });

    expect(next.autoBuild?.enabled).toBe(true); // unchanged
    expect(next.daemonActivity).toHaveLength(1);
  });

  it('daemon:auto-build:transition projects enriched FSM fields without replacing watcher detail', () => {
    const state: DaemonState = {
      ...initialDaemonState,
      autoBuild: makeAutoBuildState(false),
    };
    const event = makeEvent('daemon:auto-build:transition', {
      previousMode: 'starting',
      nextMode: 'running',
      desired: 'enabled',
      reason: 'watcher ready',
      source: 'scheduler',
    });

    const next = daemonReducer(state, { type: 'ADD_EVENT', event, eventId: 'e1' });

    expect(next.autoBuild).toMatchObject({
      enabled: true,
      desired: 'enabled',
      mode: 'running',
      watcher: state.autoBuild?.watcher,
      lastTransition: {
        at: '2024-01-15T10:00:00.000Z',
        previousMode: 'starting',
        nextMode: 'running',
        desired: 'enabled',
        reason: 'watcher ready',
        source: 'scheduler',
      },
      reason: 'watcher ready',
    });
    expect(next.daemonActivity).toHaveLength(1);
  });
});

describe('selectDaemonActivity', () => {
  it('returns the daemonActivity array', () => {
    expect(selectDaemonActivity(initialDaemonState)).toEqual([]);

    const event = makeEvent('daemon:lifecycle:starting', {
      pid: 1,
      port: 8080,
      version: '1.0.0',
      mode: 'dev',
    });
    const next = daemonReducer(initialDaemonState, {
      type: 'ADD_EVENT',
      event,
      eventId: 'e1',
    });

    expect(selectDaemonActivity(next)).toBe(next.daemonActivity);
    expect(selectDaemonActivity(next)).toHaveLength(1);
  });
});

describe('selectHeartbeatStaleness', () => {
  const now = 1_000_000;

  it('returns dead when latestHeartbeat is null', () => {
    expect(selectHeartbeatStaleness(initialDaemonState, now)).toBe('dead');
  });

  it('returns fresh for age < 15 000 ms', () => {
    const state: DaemonState = {
      ...initialDaemonState,
      latestHeartbeat: { at: now - 5_000, payload: makeHeartbeatPayload() },
    };
    expect(selectHeartbeatStaleness(state, now)).toBe('fresh');
  });

  it('returns fresh at exactly 0 ms', () => {
    const state: DaemonState = {
      ...initialDaemonState,
      latestHeartbeat: { at: now, payload: makeHeartbeatPayload() },
    };
    expect(selectHeartbeatStaleness(state, now)).toBe('fresh');
  });

  it('returns fresh at 14 999 ms', () => {
    const state: DaemonState = {
      ...initialDaemonState,
      latestHeartbeat: { at: now - 14_999, payload: makeHeartbeatPayload() },
    };
    expect(selectHeartbeatStaleness(state, now)).toBe('fresh');
  });

  it('returns stale at exactly 15 000 ms', () => {
    const state: DaemonState = {
      ...initialDaemonState,
      latestHeartbeat: { at: now - 15_000, payload: makeHeartbeatPayload() },
    };
    expect(selectHeartbeatStaleness(state, now)).toBe('stale');
  });

  it('returns stale for 15 000 – 29 999 ms', () => {
    const state: DaemonState = {
      ...initialDaemonState,
      latestHeartbeat: { at: now - 20_000, payload: makeHeartbeatPayload() },
    };
    expect(selectHeartbeatStaleness(state, now)).toBe('stale');
  });

  it('returns dead at exactly 30 000 ms', () => {
    const state: DaemonState = {
      ...initialDaemonState,
      latestHeartbeat: { at: now - 30_000, payload: makeHeartbeatPayload() },
    };
    expect(selectHeartbeatStaleness(state, now)).toBe('dead');
  });

  it('returns dead for age > 30 000 ms', () => {
    const state: DaemonState = {
      ...initialDaemonState,
      latestHeartbeat: { at: now - 60_000, payload: makeHeartbeatPayload() },
    };
    expect(selectHeartbeatStaleness(state, now)).toBe('dead');
  });

  it('uses Date.now() as default when now is omitted', () => {
    const at = Date.now() - 5_000;
    const state: DaemonState = {
      ...initialDaemonState,
      latestHeartbeat: { at, payload: makeHeartbeatPayload() },
    };
    expect(selectHeartbeatStaleness(state)).toBe('fresh');
  });
});
// --- eforge:endregion daemon-reducer-activity-lifecycle ---
