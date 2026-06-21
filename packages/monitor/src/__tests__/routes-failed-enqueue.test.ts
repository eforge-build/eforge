import { afterEach, describe, expect, it, vi } from 'vitest';
import { API_ROUTES, buildPath } from '@eforge-build/client';
import { startControlRouteHarness, type ControlRouteHarness } from './routes-control-harness.js';

let harness: ControlRouteHarness | undefined;
afterEach(async () => { await harness?.close(); harness = undefined; });

const t1 = '2026-06-19T10:00:00.000Z';
const t2 = '2026-06-19T11:00:00.000Z';

function reenqueuePath(runId: string): string {
  return buildPath(API_ROUTES.failedEnqueueReenqueue, { runId });
}

function dismissPath(runId: string): string {
  return buildPath(API_ROUTES.failedEnqueueDismiss, { runId });
}

function insertFailedEnqueue(runId: string, options: { source?: string; error?: string; summary?: string } = {}): void {
  harness!.db.insertRun({ id: runId, sessionId: `${runId}-session`, planSet: 'source-plan-set', command: 'enqueue', status: 'failed', startedAt: t1, cwd: harness!.cwd });
  if (options.source !== undefined) {
    harness!.db.insertEvent({ runId, type: 'enqueue:start', timestamp: t1, data: JSON.stringify({ type: 'enqueue:start', timestamp: t1, source: options.source }) });
  }
  if (options.error !== undefined) {
    harness!.db.insertEvent({ runId, type: 'enqueue:failed', timestamp: t2, data: JSON.stringify({ type: 'enqueue:failed', timestamp: t2, error: options.error }) });
  }
  if (options.summary !== undefined) {
    harness!.db.insertEvent({ runId, type: 'session:end', timestamp: t2, data: JSON.stringify({ type: 'session:end', timestamp: t2, sessionId: `${runId}-session`, result: { status: 'failed', summary: options.summary } }) });
  }
}

describe('failed enqueue routes', () => {
  it('rejects cross-site reads and mutations', async () => {
    harness = await startControlRouteHarness();

    expect((await harness.rawGet(API_ROUTES.failedEnqueues, { host: 'evil.example' })).status).toBe(403);
    expect((await harness.rawPost(reenqueuePath('run-1'), JSON.stringify({ confirm: true }), { host: 'evil.example', 'content-type': 'application/json' })).status).toBe(403);
    expect((await harness.rawPost(dismissPath('run-1'), JSON.stringify({ confirm: true }), { host: 'evil.example', 'content-type': 'application/json' })).status).toBe(403);
  });

  it('lists unresolved failed enqueue projections from durable DB state', async () => {
    harness = await startControlRouteHarness();
    insertFailedEnqueue('run-1', { source: 'docs/prd.md', error: 'invalid PRD' });

    const res = await harness.get(API_ROUTES.failedEnqueues);

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject([
      { runId: 'run-1', sessionId: 'run-1-session', sourceLabel: 'docs/prd.md', failureReason: 'invalid PRD', canReenqueue: true },
    ]);
  });

  it('validates re-enqueue and dismiss bodies and returns 404 for unknown run ids', async () => {
    harness = await startControlRouteHarness();

    expect((await harness.postJson(reenqueuePath('run-1'), {})).status).toBe(400);
    expect((await harness.postJson(reenqueuePath('run-1'), { confirm: false })).status).toBe(400);
    expect((await harness.rawPost(reenqueuePath('run-1'), '{not-json', { 'content-type': 'application/json' })).status).toBe(400);
    expect((await harness.postJson(reenqueuePath('../bad'), { confirm: true })).status).toBe(400);
    expect((await harness.postJson(reenqueuePath('missing'), { confirm: true })).status).toBe(404);
    expect((await harness.postJson(dismissPath('run-1'), {})).status).toBe(400);
    expect((await harness.postJson(dismissPath('../bad'), { confirm: true })).status).toBe(400);
    expect((await harness.postJson(dismissPath('missing'), { confirm: true })).status).toBe(404);
  });

  it('returns disabled metadata, queue, runs, and next command when source data is missing', async () => {
    harness = await startControlRouteHarness();
    insertFailedEnqueue('run-1', { summary: 'enqueue session failed' });

    const res = await harness.postJson(reenqueuePath('run-1'), { confirm: true });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      enqueued: false,
      failedEnqueue: { runId: 'run-1', canReenqueue: false, disabledReason: expect.stringContaining('Original enqueue source') },
      runs: [{ id: 'run-1', command: 'enqueue', status: 'failed' }],
      queue: [],
      nextCommand: { executable: 'eforge', args: ['history', 'show', 'run-1'] },
    });
    expect(harness.db.getDaemonEventsAfter(0).filter((row) => row.type === 'daemon:failed-enqueue:resolved')).toEqual([]);
  });

  it('rejects re-enqueue when worker spawning is unavailable without resolving the attention row', async () => {
    harness = await startControlRouteHarness();
    insertFailedEnqueue('run-1', { source: 'docs/prd.md', error: 'bad source' });

    const res = await harness.postJson(reenqueuePath('run-1'), { confirm: true });

    expect(res.status).toBe(503);
    expect(await res.text()).toContain('worker spawning is unavailable');
    expect(harness.db.getDaemonEventsAfter(0).filter((row) => row.type === 'daemon:failed-enqueue:resolved')).toEqual([]);
  });

  it('reports the spawned worker session separately from run ids when re-enqueue succeeds', async () => {
    harness = await startControlRouteHarness({ serverOptions: { workerTracker: { spawnWorker: () => ({ sessionId: 'spawned-session-1', pid: 123 }), cancelWorker: () => false } } });
    insertFailedEnqueue('run-1', { source: 'docs/prd.md', error: 'bad source' });

    const res = await harness.postJson(reenqueuePath('run-1'), { confirm: true });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ enqueued: true, spawnedSessionId: 'spawned-session-1' });
    const [eventRow] = harness.db.getDaemonEventsAfter(0).filter((row) => row.type === 'daemon:failed-enqueue:resolved');
    expect(JSON.parse(eventRow!.data)).toMatchObject({ runId: 'run-1', spawnedSessionId: 'spawned-session-1' });
  });

  it('dismisses a failed enqueue without spawning a worker', async () => {
    const spawnWorker = vi.fn(() => ({ sessionId: 'should-not-spawn', pid: 123 }));
    harness = await startControlRouteHarness({ serverOptions: { workerTracker: { spawnWorker, cancelWorker: () => false } } });
    insertFailedEnqueue('run-1', { source: 'docs/prd.md', error: 'bad source' });

    const res = await harness.postJson(dismissPath('run-1'), { confirm: true });

    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ dismissed: true, failedEnqueue: { runId: 'run-1', canReenqueue: false, resolvedAt: expect.any(String), disabledReason: expect.stringContaining('has been dismissed') } });
    expect(spawnWorker).not.toHaveBeenCalled();
    expect((await (await harness.get(API_ROUTES.failedEnqueues)).json())).toEqual([]);
    const [eventRow] = harness.db.getDaemonEventsAfter(0).filter((row) => row.type === 'daemon:failed-enqueue:resolved');
    expect(JSON.parse(eventRow!.data)).toMatchObject({ runId: 'run-1' });
    expect(JSON.parse(eventRow!.data).spawnedSessionId).toBeUndefined();
  });
});
