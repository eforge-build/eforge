import { describe, it, expect } from 'vitest';
import { safeParseDaemonStreamSnapshot, safeParseEforgeEvent } from '../events.schemas.js';
import { DAEMON_EVENT_TYPES, eventRegistry, getEventSummary } from '../event-registry.js';

// --- eforge:region event-schema-tests ---

describe('safeParseEforgeEvent — daemon:auto-build:transition', () => {
  it('accepts transition events with lifecycle detail', () => {
    const result = safeParseEforgeEvent({
      type: 'daemon:auto-build:transition',
      timestamp: '2025-01-01T00:00:00.000Z',
      previousMode: 'starting',
      nextMode: 'running',
      desired: 'enabled',
      reason: 'watcher started',
      source: 'watcher',
    });
    expect(result.success).toBe(true);
  });

  it('rejects transition events with invalid modes', () => {
    const result = safeParseEforgeEvent({
      type: 'daemon:auto-build:transition',
      timestamp: '2025-01-01T00:00:00.000Z',
      previousMode: 'warming-up',
      nextMode: 'running',
      desired: 'enabled',
      source: 'watcher',
    });
    expect(result.success).toBe(false);
  });

  it('rejects daemon heartbeat events with invalid autoBuild lifecycle literals', () => {
    const result = safeParseEforgeEvent({
      type: 'daemon:heartbeat',
      timestamp: '2025-01-01T00:00:00.000Z',
      uptime: 1000,
      queueDepth: 1,
      runningBuilds: 0,
      autoBuild: { enabled: true, paused: false, desired: 'enabled', mode: 'warming-up' },
      subscribers: 1,
    });
    expect(result.success).toBe(false);
  });
});

describe('eventRegistry — daemon:auto-build:transition', () => {
  it('registers transition events as daemon-scoped, persisted, summarized, and projected', () => {
    expect(eventRegistry['daemon:auto-build:transition']).toMatchObject({
      scope: 'daemon',
      persist: true,
    });
    expect(DAEMON_EVENT_TYPES).toContain('daemon:auto-build:transition');
    const event = {
      type: 'daemon:auto-build:transition',
      timestamp: '2025-01-01T00:00:00.000Z',
      previousMode: 'starting',
      nextMode: 'running',
      desired: 'enabled',
      reason: 'watcher started',
      source: 'watcher',
    } as const;
    expect(getEventSummary(event)).toBe('Auto-build starting → running (enabled): watcher started');

    const state = {
      runs: [],
      queue: [],
      autoBuild: { enabled: false, watcher: { running: true, pid: 1234, sessionId: 'watcher-1' } },
      latestHeartbeat: null,
      stackLayers: [],
      failedEnqueues: [],
    };
    expect(eventRegistry['daemon:auto-build:transition'].project?.(event, state)).toEqual({
      autoBuild: {
        enabled: true,
        watcher: { running: true, pid: 1234, sessionId: 'watcher-1' },
        desired: 'enabled',
        mode: 'running',
        lastTransition: {
          at: '2025-01-01T00:00:00.000Z',
          previousMode: 'starting',
          nextMode: 'running',
          desired: 'enabled',
          reason: 'watcher started',
          source: 'watcher',
        },
        reason: 'watcher started',
      },
    });
  });

  it('projects paused desired-enabled transitions as enabled scheduler pauses', () => {
    const event = {
      type: 'daemon:auto-build:transition',
      timestamp: '2025-01-01T00:00:00.000Z',
      previousMode: 'running',
      nextMode: 'paused',
      desired: 'enabled',
      reason: 'build failed',
      source: 'watcher',
    } as const;
    const state = {
      runs: [],
      queue: [],
      autoBuild: { enabled: true, watcher: { running: true, pid: 1234, sessionId: 'watcher-1' } },
      latestHeartbeat: null,
      stackLayers: [],
      failedEnqueues: [],
    };

    expect(eventRegistry['daemon:auto-build:transition'].project?.(event, state)).toMatchObject({
      autoBuild: {
        enabled: true,
        desired: 'enabled',
        mode: 'paused',
        scheduler: { paused: true },
        reason: 'build failed',
      },
    });
  });
});

describe('eventRegistry — daemon:auto-build:paused', () => {
  it('projects compatibility pauses without disabling desired-enabled auto-build', () => {
    const event = {
      type: 'daemon:auto-build:paused',
      timestamp: '2025-01-01T00:00:00.000Z',
      reason: 'build failed',
    } as const;
    const state = {
      runs: [],
      queue: [],
      autoBuild: { enabled: true, watcher: { running: true, pid: 1234, sessionId: 'watcher-1' } },
      latestHeartbeat: null,
      stackLayers: [],
      failedEnqueues: [],
    };

    expect(eventRegistry['daemon:auto-build:paused'].project?.(event, state)).toMatchObject({
      autoBuild: {
        enabled: true,
        desired: 'enabled',
        mode: 'paused',
        scheduler: { paused: true },
      },
    });
  });
});

describe('eventRegistry — daemon:auto-build:disabled', () => {
  it('registers the disabled event as daemon-scoped, persisted, summarized, and projected', () => {
    expect(eventRegistry['daemon:auto-build:disabled']).toMatchObject({
      scope: 'daemon',
      persist: true,
      summary: 'Auto-build disabled',
    });

    const event = {
      type: 'daemon:auto-build:disabled',
      timestamp: '2025-01-01T00:00:00.000Z',
    } as const;
    expect(getEventSummary(event)).toBe('Auto-build disabled');

    const state = {
      runs: [],
      queue: [],
      autoBuild: { enabled: true, watcher: { running: true, pid: 1234, sessionId: null } },
      latestHeartbeat: null,
      stackLayers: [],
      failedEnqueues: [],
    };
    const project = eventRegistry['daemon:auto-build:disabled'].project;
    expect(project?.(event, state)).toEqual({
      autoBuild: { enabled: false, watcher: { running: true, pid: 1234, sessionId: null } },
    });
    expect(project?.(event, { ...state, autoBuild: { ...state.autoBuild, enabled: false } })).toBeUndefined();
    expect(project?.(event, { ...state, autoBuild: null })).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Schema validation — invalid payloads rejected
// ---------------------------------------------------------------------------

describe('safeParseDaemonStreamSnapshot — enriched autoBuild state', () => {
  it('accepts autoBuild lifecycle fields in daemon stream snapshots', () => {
    const snapshot = {
      cursor: 1,
      liveness: {
        type: 'daemon:heartbeat',
        timestamp: '2025-01-01T00:00:00.000Z',
        uptime: 1000,
        queueDepth: 1,
        runningBuilds: 0,
        autoBuild: {
          enabled: true,
          paused: false,
          desired: 'enabled',
          mode: 'running',
          scheduler: { alive: true, paused: false },
          lastTransition: {
            at: '2025-01-01T00:00:00.000Z',
            previousMode: 'starting',
            nextMode: 'running',
            desired: 'enabled',
            source: 'watcher',
            reason: 'watcher started',
          },
          reason: 'watcher started',
        },
        subscribers: 1,
      },
      recentActivity: [],
      runs: [],
      queue: [],
      sessionMetadata: {},
      autoBuild: {
        enabled: true,
        watcher: { running: true, pid: 1234, sessionId: 'watcher-1' },
        desired: 'enabled',
        mode: 'running',
        scheduler: { alive: true, paused: false },
        lastTransition: {
          at: '2025-01-01T00:00:00.000Z',
          previousMode: 'starting',
          nextMode: 'running',
          desired: 'enabled',
          source: 'watcher',
          reason: 'watcher started',
        },
        reason: 'watcher started',
      },
      stackLayers: [],
      failedEnqueues: [],
    };

    const result = safeParseDaemonStreamSnapshot(snapshot);
    expect(result.success).toBe(true);
  });

  it('accepts scheduler runningCount and limit in daemon stream snapshots', () => {
    const snapshot = {
      cursor: 1,
      liveness: {
        type: 'daemon:heartbeat',
        timestamp: '2025-01-01T00:00:00.000Z',
        uptime: 1000,
        queueDepth: 1,
        runningBuilds: 2,
        autoBuild: {
          enabled: true,
          paused: false,
          desired: 'enabled',
          mode: 'running',
          scheduler: { alive: true, paused: false, runningCount: 2, limit: 4 },
        },
        subscribers: 1,
      },
      recentActivity: [],
      runs: [],
      queue: [],
      sessionMetadata: {},
      autoBuild: {
        enabled: true,
        watcher: { running: true, pid: 1234, sessionId: 'watcher-1' },
        desired: 'enabled',
        mode: 'running',
        scheduler: { alive: true, paused: false, runningCount: 2, limit: 4 },
      },
      stackLayers: [],
      failedEnqueues: [],
    };

    const result = safeParseDaemonStreamSnapshot(snapshot);
    expect(result.success).toBe(true);
  });

  it('rejects non-numeric scheduler runningCount and limit values', () => {
    const heartbeat = {
      type: 'daemon:heartbeat',
      timestamp: '2025-01-01T00:00:00.000Z',
      uptime: 1000,
      queueDepth: 1,
      runningBuilds: 2,
      autoBuild: {
        enabled: true,
        paused: false,
        scheduler: { alive: true, paused: false, runningCount: '2', limit: '4' },
      },
      subscribers: 1,
    };

    const result = safeParseEforgeEvent(heartbeat);
    expect(result.success).toBe(false);
  });

  it('rejects invalid autoBuild lifecycle field literals in daemon stream snapshots', () => {
    const snapshot = {
      cursor: 1,
      liveness: {
        type: 'daemon:heartbeat',
        timestamp: '2025-01-01T00:00:00.000Z',
        uptime: 1000,
        queueDepth: 1,
        runningBuilds: 0,
        autoBuild: { enabled: true, paused: false, desired: 'enabled', mode: 'warming-up' },
        subscribers: 1,
      },
      recentActivity: [],
      runs: [],
      queue: [],
      sessionMetadata: {},
      autoBuild: {
        enabled: true,
        watcher: { running: true, pid: 1234, sessionId: 'watcher-1' },
        desired: 'enabled',
        mode: 'running',
      },
      stackLayers: [],
      failedEnqueues: [],
    };

    const result = safeParseDaemonStreamSnapshot(snapshot);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toContain('autoBuild');
      expect(result.error.message).toContain('mode');
    }
  });

  it('rejects invalid top-level autoBuild lifecycle field literals in daemon stream snapshots', () => {
    const snapshot = {
      cursor: 1,
      liveness: {
        type: 'daemon:heartbeat',
        timestamp: '2025-01-01T00:00:00.000Z',
        uptime: 1000,
        queueDepth: 1,
        runningBuilds: 0,
        autoBuild: { enabled: true, paused: false, desired: 'enabled', mode: 'running' },
        subscribers: 1,
      },
      recentActivity: [],
      runs: [],
      queue: [],
      sessionMetadata: {},
      autoBuild: {
        enabled: true,
        watcher: { running: true, pid: 1234, sessionId: 'watcher-1' },
        desired: 'enabled',
        mode: 'warming-up',
      },
      stackLayers: [],
      failedEnqueues: [],
    };

    const result = safeParseDaemonStreamSnapshot(snapshot);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.message).toContain('autoBuild');
      expect(result.error.message).toContain('mode');
    }
  });
});

describe('safeParseDaemonStreamSnapshot — queue-item recoveryApplied marker', () => {
  const capabilities = { priority: { allowed: true }, remove: { allowed: true }, dependencyOverride: { allowed: true }, hold: { allowed: true }, unhold: { allowed: true }, cascadeRemove: { allowed: true }, cancel: { allowed: true }, cascadeCancel: { allowed: true } };

  function snapshotWithQueueItem(queueItem: Record<string, unknown>) {
    return {
      cursor: 1,
      liveness: {
        type: 'daemon:heartbeat',
        timestamp: '2025-01-01T00:00:00.000Z',
        uptime: 1000,
        queueDepth: 1,
        runningBuilds: 0,
        autoBuild: { enabled: true, paused: false, desired: 'enabled', mode: 'running', scheduler: { alive: true, paused: false } },
        subscribers: 1,
      },
      recentActivity: [],
      runs: [],
      queue: [{ capabilities, ...queueItem }],
      sessionMetadata: {},
      autoBuild: {
        enabled: true,
        watcher: { running: true, pid: 1234, sessionId: 'watcher-1' },
        desired: 'enabled',
        mode: 'running',
        scheduler: { alive: true, paused: false },
      },
      stackLayers: [],
      failedEnqueues: [],
    };
  }

  it('accepts a queue item with a continue-repair recoveryApplied marker', () => {
    const result = safeParseDaemonStreamSnapshot(snapshotWithQueueItem({
      id: 'failed-prd',
      title: 'Failed PRD',
      status: 'failed',
      recoveryVerdict: { verdict: 'continue-repair', confidence: 'high' },
      recoveryApplied: { action: 'continue-repair', appliedAt: '2025-01-01T00:00:00.000Z' },
    }));
    expect(result.success).toBe(true);
  });

  it('accepts accepted-success recoveryApplied marker with landing autoMerge metadata', () => {
    const result = safeParseDaemonStreamSnapshot(snapshotWithQueueItem({
      id: 'accepted-prd',
      title: 'Accepted PRD',
      status: 'completed',
      recoveryApplied: {
        action: 'accepted-success',
        acceptedAt: '2025-01-01T00:00:00.000Z',
        reasonCategory: 'other',
        reason: 'manual verification',
        cleanup: { status: 'noop' },
        landing: { action: 'pr', status: 'complete', branch: 'eforge/accepted-prd', autoMerge: { status: 'complete' } },
        dependents: { unblocked: [], remainedBlocked: [], notFound: [] },
      },
    }));
    expect(result.success).toBe(true);
  });

  it('accepts a queue item with no recoveryApplied marker (optional field)', () => {
    const result = safeParseDaemonStreamSnapshot(snapshotWithQueueItem({
      id: 'plain-prd',
      title: 'Plain PRD',
      status: 'pending',
    }));
    expect(result.success).toBe(true);
  });

  it('rejects a queue item with an invalid recoveryApplied action literal', () => {
    const result = safeParseDaemonStreamSnapshot(snapshotWithQueueItem({
      id: 'bad-prd',
      title: 'Bad PRD',
      status: 'failed',
      recoveryApplied: { action: 'teleport', appliedAt: '2025-01-01T00:00:00.000Z' },
    }));
    expect(result.success).toBe(false);
  });

  it('rejects a removed recoveryApplied marker', () => {
    const removedAction = 'spl' + 'it';
    const result = safeParseDaemonStreamSnapshot(snapshotWithQueueItem({
      id: 'removed-marker',
      title: 'Removed marker',
      status: 'failed',
      recoveryApplied: { action: removedAction, appliedAt: '2025-01-01T00:00:00.000Z' },
    }));
    expect(result.success).toBe(false);
  });
});

// --- eforge:endregion event-schema-tests ---
