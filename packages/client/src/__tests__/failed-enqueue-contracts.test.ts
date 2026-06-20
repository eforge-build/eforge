import { describe, expect, it } from 'vitest';
import { API_ROUTES, buildPath, type FailedEnqueueInfo, type FailedEnqueueReenqueueResponse } from '../index.js';
import { DAEMON_EVENT_TYPES, eventRegistry, getEventSummary, type ProjectableState } from '../event-registry.js';
import { safeParseDaemonStreamSnapshot, safeParseEforgeEvent } from '../events.js';

const failedEnqueue: FailedEnqueueInfo = {
  runId: 'run-1',
  sessionId: 'session-1',
  sourceLabel: 'prd.md',
  provenance: { label: 'prd.md' },
  failureReason: 'enqueue failed',
  failedAt: '2026-06-19T10:00:00.000Z',
  canReenqueue: true,
  nextCommand: { executable: 'eforge', args: ['enqueue', 'prd.md'] },
};

function snapshot(extra: Record<string, unknown> = {}) {
  return {
    cursor: 1,
    liveness: {
      type: 'daemon:heartbeat', timestamp: '2026-06-19T10:00:00.000Z', uptime: 1, queueDepth: 0, runningBuilds: 0,
      autoBuild: { enabled: true, paused: false }, subscribers: 1,
    },
    recentActivity: [], runs: [], queue: [], sessionMetadata: {},
    autoBuild: { enabled: true, watcher: { running: false, pid: null, sessionId: null } },
    stackLayers: [],
      failedEnqueues: [],
    ...extra,
  };
}

describe('failed enqueue contracts', () => {
  it('exposes routes and response wire types', () => {
    expect(API_ROUTES.failedEnqueues).toBe('/api/enqueue/failed');
    expect(buildPath(API_ROUTES.failedEnqueueReenqueue, { runId: 'run/1' })).toBe('/api/enqueue/failed/run%2F1/reenqueue');
    const response: FailedEnqueueReenqueueResponse = { enqueued: true, failedEnqueue, queue: [], runs: [], newRunId: 'run-2' };
    expect(response.newRunId).toBe('run-2');
  });

  it('parses snapshot and event schemas', () => {
    expect(safeParseDaemonStreamSnapshot(snapshot({ failedEnqueues: [failedEnqueue, { ...failedEnqueue, runId: 'run-2' }] }))).toMatchObject({ success: true });
    expect(safeParseEforgeEvent({ timestamp: failedEnqueue.failedAt, type: 'daemon:failed-enqueue:upsert', failedEnqueue })).toMatchObject({ success: true });
    expect(safeParseEforgeEvent({ timestamp: failedEnqueue.failedAt, type: 'daemon:failed-enqueue:resolved', runId: 'run-1', resolvedAt: failedEnqueue.failedAt, newRunId: 'run-2' })).toMatchObject({ success: true });
    expect(safeParseEforgeEvent({ timestamp: failedEnqueue.failedAt, type: 'daemon:failed-enqueue:upsert', failedEnqueue: { ...failedEnqueue, source: { source: 'secret.md', flags: ['--token=secret'] } } })).toMatchObject({ success: false });
    expect(safeParseEforgeEvent({ timestamp: failedEnqueue.failedAt, type: 'daemon:failed-enqueue:upsert', failedEnqueue: { ...failedEnqueue, nextCommand: 'eforge enqueue prd.md' } })).toMatchObject({ success: false });
    expect(safeParseEforgeEvent({ timestamp: failedEnqueue.failedAt, type: 'daemon:failed-enqueue:upsert', failedEnqueue: { runId: 'bad' } })).toMatchObject({ success: false });
  });

  it('registers failed enqueue projectors keyed by runId', () => {
    expect(DAEMON_EVENT_TYPES).toContain('daemon:failed-enqueue:upsert');
    expect(DAEMON_EVENT_TYPES).toContain('daemon:failed-enqueue:resolved');
    const state: ProjectableState = { runs: [], queue: [], autoBuild: null, latestHeartbeat: null, stackLayers: [] };
    const first = eventRegistry['daemon:failed-enqueue:upsert'].project!({ timestamp: failedEnqueue.failedAt, type: 'daemon:failed-enqueue:upsert', failedEnqueue }, state);
    const second = eventRegistry['daemon:failed-enqueue:upsert'].project!({ timestamp: failedEnqueue.failedAt, type: 'daemon:failed-enqueue:upsert', failedEnqueue: { ...failedEnqueue, failureReason: 'newer' } }, { ...state, ...first });
    expect(second?.failedEnqueues).toHaveLength(1);
    const tied = eventRegistry['daemon:failed-enqueue:upsert'].project!({ timestamp: failedEnqueue.failedAt, type: 'daemon:failed-enqueue:upsert', failedEnqueue: { ...failedEnqueue, runId: 'run-0' } }, { ...state, ...second });
    expect(tied?.failedEnqueues?.map((item) => item.runId)).toEqual(['run-0', 'run-1']);
    const resolved = eventRegistry['daemon:failed-enqueue:resolved'].project!({ timestamp: failedEnqueue.failedAt, type: 'daemon:failed-enqueue:resolved', runId: 'run-1', resolvedAt: '2026-06-19T11:00:00.000Z' }, { ...state, ...second });
    expect(resolved?.failedEnqueues).toEqual([]);
    expect(getEventSummary({ timestamp: failedEnqueue.failedAt, type: 'daemon:failed-enqueue:resolved', runId: 'run-1', resolvedAt: failedEnqueue.failedAt, newRunId: 'run-2' })).toContain('run-2');
  });
});
