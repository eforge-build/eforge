import { describe, expect, it } from 'vitest';
import { autoBuildHeartbeatToWire, autoBuildStateToWire, buildDaemonHeartbeatObject } from '../projections/auto-build-state.js';
import type { AutoBuildState } from '@eforge-build/client';

describe('auto-build state projections', () => {
  it('projects disabled defaults with capacity', () => {
    expect(autoBuildStateToWire({ capacity: { runningCount: 2, limit: 4 } })).toMatchObject({ enabled: false, scheduler: { runningCount: 2, limit: 4 } });
  });
  it('enriches controller snapshots and heartbeat pause state', () => {
    const snapshot: AutoBuildState = { enabled: true, watcher: { running: true, pid: 1, sessionId: 's' }, desired: 'enabled', mode: 'paused', scheduler: { alive: true, paused: false } };
    const input = { state: { autoBuildController: { getSnapshot: () => snapshot } }, capacity: { runningCount: 1, limit: 3 } };
    expect(autoBuildStateToWire(input).scheduler).toEqual({ alive: true, paused: false, runningCount: 1, limit: 3 });
    expect(autoBuildHeartbeatToWire(input).paused).toBe(true);
  });
  it('builds daemon heartbeat liveness with injected timestamps', () => {
    expect(buildDaemonHeartbeatObject({ now: 2000, startedAtMs: 500, queueDepth: 7, runningBuilds: 2, subscriberCount: 3, capacity: { runningCount: 2, limit: 5 } })).toMatchObject({ timestamp: '1970-01-01T00:00:02.000Z', uptime: 1500, queueDepth: 7, runningBuilds: 2, subscribers: 3 });
  });
});
