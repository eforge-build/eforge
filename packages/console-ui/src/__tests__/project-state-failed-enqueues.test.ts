import { describe, expect, it } from 'vitest';
import type { DaemonStreamSnapshot, EforgeEvent, FailedEnqueueInfo } from '@eforge-build/client/browser';
import { consoleProjectReducer, initialConsoleProjectState } from '@/lib/project-state';
import { dedupeFailedEnqueuesByRunId } from '@/lib/failed-enqueues';

const older = '2026-06-19T10:00:00.000Z';
const newer = '2026-06-19T11:00:00.000Z';

function failed(overrides: Partial<FailedEnqueueInfo> = {}): FailedEnqueueInfo {
  return {
    runId: 'run-1',
    sessionId: 'session-1',
    sourceLabel: 'docs/prd.md',
    provenance: { label: 'enqueue:start source' },
    failureReason: 'Invalid PRD',
    failedAt: older,
    canReenqueue: true,
    nextCommand: { executable: 'eforge', args: ['enqueue', '<redacted-source>'] },
    ...overrides,
  };
}

function snapshot(failedEnqueues: FailedEnqueueInfo[]): DaemonStreamSnapshot {
  return {
    cursor: 1,
    liveness: { uptime: 1, queueDepth: 0, runningBuilds: 0, autoBuild: false, subscribers: 1 },
    recentActivity: [],
    runs: [],
    queue: [],
    sessionMetadata: {},
    autoBuild: null,
    stackLayers: [],
    failedEnqueues,
  } as unknown as DaemonStreamSnapshot;
}

describe('failed enqueue project-state ingestion', () => {
  it('dedupes by runId, keeps resolved rows over unresolved duplicates, and sorts newest first', () => {
    expect(dedupeFailedEnqueuesByRunId([
      failed({ runId: 'run-b', failedAt: older }),
      failed({ runId: 'run-a', failedAt: newer }),
      failed({ runId: 'run-b', failedAt: newer, resolvedAt: newer, canReenqueue: false }),
    ])).toMatchObject([
      { runId: 'run-a', failedAt: newer },
      { runId: 'run-b', resolvedAt: newer },
    ]);
  });

  it('seeds failedEnqueues from stream snapshots using the durable projection field', () => {
    const next = consoleProjectReducer(initialConsoleProjectState, {
      type: 'SNAPSHOT_RECEIVED',
      snapshot: snapshot([
        failed({ runId: 'run-1', failedAt: older, failureReason: 'old' }),
        failed({ runId: 'run-1', failedAt: newer, failureReason: 'new' }),
      ]),
      receivedAt: 100,
    });

    expect(next.failedEnqueues).toEqual([expect.objectContaining({ runId: 'run-1', failureReason: 'new' })]);
  });

  it('applies live upsert and resolved events through the client event projector', () => {
    const upsert: EforgeEvent = {
      timestamp: newer,
      type: 'daemon:failed-enqueue:upsert',
      failedEnqueue: failed({ runId: 'run-live', failedAt: newer }),
    } as EforgeEvent;
    const resolved: EforgeEvent = {
      timestamp: newer,
      type: 'daemon:failed-enqueue:resolved',
      runId: 'run-live',
      resolvedAt: newer,
    } as EforgeEvent;

    const withUpsert = consoleProjectReducer(initialConsoleProjectState, {
      type: 'EVENT_RECEIVED',
      event: upsert,
      eventId: '1',
      receivedAt: 200,
    });
    expect(withUpsert.failedEnqueues).toEqual([expect.objectContaining({ runId: 'run-live' })]);

    const withResolved = consoleProjectReducer(withUpsert, {
      type: 'EVENT_RECEIVED',
      event: resolved,
      eventId: '2',
      receivedAt: 300,
    });
    expect(withResolved.failedEnqueues).toEqual([]);
  });

  it('replaces failedEnqueues and runs on explicit REST refresh actions', () => {
    const state = { ...initialConsoleProjectState, failedEnqueues: [failed({ runId: 'old' })] };
    const refreshed = consoleProjectReducer(state, {
      type: 'FAILED_ENQUEUES_REFRESH_RECEIVED',
      failedEnqueues: [failed({ runId: 'new', failedAt: newer })],
    });
    expect(refreshed.failedEnqueues).toMatchObject([{ runId: 'new' }]);

    const runs = [{ id: 'run-new', sessionId: 's', planSet: 'p', command: 'build', status: 'running', startedAt: newer, cwd: '/repo' }];
    const runsRefreshed = consoleProjectReducer(refreshed, { type: 'RUNS_REFRESH_RECEIVED', runs });
    expect(runsRefreshed.runs).toEqual(runs);
  });
});
