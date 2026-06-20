import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { API_ROUTES } from '@eforge-build/client';
import type { EventRecord } from '../db.js';
import { buildDaemonHello } from '../streams/daemon-stream.js';
import { latestQueueDispatchFailuresFromEvents, overlayQueueDispatchFailures } from '../projections/queue-dispatch-failures.js';
import { startControlRouteHarness, type ControlRouteHarness } from './routes-control-harness.js';

let harness: ControlRouteHarness | undefined;
afterEach(async () => { await harness?.close(); harness = undefined; });

function row(id: number, prdId: string, reason: string, timestamp: string): EventRecord {
  return {
    id,
    runId: null,
    origin: 'daemon',
    type: 'queue:prd:dispatch-failed',
    data: JSON.stringify({ type: 'queue:prd:dispatch-failed', prdId, title: prdId, reason, stage: 'stacking-validation', timestamp }),
    timestamp,
  };
}

function discoveredRow(id: number, prdId: string, timestamp: string): EventRecord {
  return {
    id,
    runId: null,
    origin: 'daemon',
    type: 'queue:prd:discovered',
    data: JSON.stringify({ type: 'queue:prd:discovered', prdId, title: prdId, timestamp }),
    timestamp,
  };
}

function prd(title: string): string {
  return `---\ntitle: ${title}\ncreated: "2026-01-01"\n---\n# ${title}`;
}

function seedQueue(cwd: string): void {
  const queueDir = join(cwd, '.eforge', 'queue');
  mkdirSync(join(queueDir, 'failed'), { recursive: true });
  mkdirSync(join(cwd, '.eforge', 'locks'), { recursive: true });
  writeFileSync(join(queueDir, 'failed', 'failed-prd.md'), prd('Failed PRD'));
  writeFileSync(join(queueDir, 'pending-prd.md'), prd('Pending PRD'));
}

describe('queue dispatch failure projection', () => {
  it('selects the latest persisted dispatch failure by timestamp then row id', () => {
    const latest = latestQueueDispatchFailuresFromEvents([
      row(1, 'prd-1', 'older', '2026-01-01T00:00:00.000Z'),
      row(2, 'prd-1', 'same-time-later-row', '2026-01-01T00:00:00.000Z'),
      row(3, 'prd-1', 'newer', '2026-01-02T00:00:00.000Z'),
    ]);
    expect(latest.get('prd-1')?.reason).toBe('newer');
  });

  it('overlays only failed queue items and suppresses stale data after requeue', () => {
    const rows = [row(1, 'prd-1', 'blocked', '2026-01-01T00:00:00.000Z')];
    expect(overlayQueueDispatchFailures([{ id: 'prd-1', title: 'PRD', status: 'failed' }], rows)[0]?.dispatchFailure?.reason).toBe('blocked');
    expect(overlayQueueDispatchFailures([{ id: 'prd-1', title: 'PRD', status: 'pending' }], rows)[0]?.dispatchFailure).toBeUndefined();
    expect(overlayQueueDispatchFailures([{ id: 'prd-1', title: 'PRD', status: 'skipped' }], rows)[0]?.dispatchFailure).toBeUndefined();
  });

  it('clears stale dispatch failures after rediscovery until a newer dispatch failure arrives', () => {
    const rediscoveredRows = [
      row(1, 'prd-1', 'blocked', '2026-01-01T00:00:00.000Z'),
      discoveredRow(2, 'prd-1', '2026-01-02T00:00:00.000Z'),
    ];
    expect(latestQueueDispatchFailuresFromEvents(rediscoveredRows).get('prd-1')).toBeUndefined();
    expect(overlayQueueDispatchFailures([{ id: 'prd-1', title: 'PRD', status: 'failed' }], rediscoveredRows)[0]?.dispatchFailure).toBeUndefined();

    expect(latestQueueDispatchFailuresFromEvents([
      row(1, 'prd-1', 'blocked', '2026-01-01T00:00:00.000Z'),
      discoveredRow(2, 'prd-1', '2026-01-02T00:00:00.000Z'),
      row(3, 'prd-1', 'blocked-again', '2026-01-03T00:00:00.000Z'),
    ]).get('prd-1')?.reason).toBe('blocked-again');
  });

  it('returns the original array when no queue items change', () => {
    const items = [{ id: 'prd-1', title: 'PRD', status: 'pending' }];
    expect(overlayQueueDispatchFailures(items, [row(1, 'prd-1', 'blocked', '2026-01-01T00:00:00.000Z')])).toBe(items);
  });

  it('ignores malformed persisted events', () => {
    const malformed: EventRecord = { ...row(1, 'prd-1', 'blocked', '2026-01-01T00:00:00.000Z'), data: '{' };
    expect(latestQueueDispatchFailuresFromEvents([malformed]).size).toBe(0);
  });

  it('projects persisted dispatch failures through GET /api/queue and stream hello snapshots with parity', async () => {
    harness = await startControlRouteHarness();
    seedQueue(harness.cwd);
    harness.db.insertDaemonEvent({
      type: 'queue:prd:dispatch-failed',
      timestamp: '2026-01-02T00:00:00.000Z',
      data: JSON.stringify({ type: 'queue:prd:dispatch-failed', timestamp: '2026-01-02T00:00:00.000Z', prdId: 'failed-prd', title: 'Failed PRD', reason: 'stack_parent is required', stage: 'stacking-validation' }),
    });
    harness.db.insertDaemonEvent({
      type: 'queue:prd:dispatch-failed',
      timestamp: '2026-01-01T00:00:00.000Z',
      data: JSON.stringify({ type: 'queue:prd:dispatch-failed', timestamp: '2026-01-01T00:00:00.000Z', prdId: 'pending-prd', title: 'Pending PRD', reason: 'stale blocker', stage: 'dispatch' }),
    });

    const restQueue = await (await harness.get(API_ROUTES.queue)).json();
    const helloQueue = (await buildDaemonHello(harness.context, { startedAtMs: 0, subscriberCount: 0, clock: { now: () => 0 } })).snapshot.queue;

    expect(helloQueue).toEqual(restQueue);
    expect(restQueue.find((item: { id: string }) => item.id === 'failed-prd')?.dispatchFailure).toEqual({
      reason: 'stack_parent is required',
      stage: 'stacking-validation',
      timestamp: '2026-01-02T00:00:00.000Z',
    });
    expect(restQueue.find((item: { id: string }) => item.id === 'pending-prd')?.dispatchFailure).toBeUndefined();
  });
});
