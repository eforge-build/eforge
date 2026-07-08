import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AutoBuildState } from '@eforge-build/client';
import { createMonitorContext } from '../context.js';
import { openDatabase, type MonitorDB } from '../db.js';
import { createStreamHub, type StreamHub } from '../streams/stream-hub.js';

const ts = '2026-01-01T00:00:00.000Z';
const tempDirs: string[] = [];
const servers: Server[] = [];
const hubs: StreamHub[] = [];

function tempDb(): MonitorDB { const dir = mkdtempSync(join(tmpdir(), 'eforge-stream-hub-')); tempDirs.push(dir); return openDatabase(join(dir, 'monitor.db')); }
function event(extra: Record<string, unknown> = {}): string { return JSON.stringify({ type: 'enqueue:complete', timestamp: ts, id: 'prd-1', filePath: '/q/prd-1.md', title: 'PRD 1', planSet: 'PRD 1', ...extra }); }
function completionEvent(): string { return JSON.stringify({ type: 'queue:prd:complete', timestamp: ts, prdId: 'prd-1', status: 'completed' }); }
function insertRun(db: MonitorDB): void { db.insertRun({ id: 'run-1', sessionId: 'session-1', planSet: 'set', command: 'build', status: 'running', startedAt: ts, cwd: process.cwd() }); }
function insertSessionEvent(db: MonitorDB): void { db.insertEvent({ runId: 'run-1', type: 'phase:start', data: JSON.stringify({ type: 'phase:start', timestamp: ts, runId: 'run-1', planSet: 'set', command: 'build' }), timestamp: ts }); }
function controller(calls: string[]) {
  const state: AutoBuildState = { enabled: true, watcher: { running: false, pid: null, sessionId: null }, desired: 'enabled', mode: 'running', scheduler: { alive: true, paused: false } };
  return { getSnapshot: () => state, notifyQueueMutation: (reason: string) => { calls.push(reason); return state; } } as never;
}
async function start(db: MonitorDB, calls: string[] = [], finalizeQueuePrdCompletion?: () => Promise<void> | void): Promise<{ url: string; hub: StreamHub }> {
  const context = await createMonitorContext(db, 0, { daemonState: { autoBuildController: controller(calls), finalizeQueuePrdCompletion } });
  const hub = createStreamHub(context, { pollIntervalMs: 20, heartbeatIntervalMs: 60_000, clock: { now: () => Date.parse(ts) } });
  hubs.push(hub);
  const server = createServer((req, res) => {
    if (req.url === '/daemon') hub.attachDaemon(req, res);
    else hub.attachSession(req, res, 'session-1');
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('missing port');
  return { url: `http://127.0.0.1:${address.port}`, hub };
}
async function readBlocks(url: string, count = 1): Promise<{ blocks: string[]; cancel: () => void }> {
  const controller = new AbortController();
  const res = await fetch(url, { signal: controller.signal });
  const reader = res.body?.getReader();
  if (!reader) throw new Error('missing body');
  let text = ''; const blocks: string[] = [];
  while (blocks.length < count) {
    const next = await reader.read();
    if (next.done) break;
    text += new TextDecoder().decode(next.value);
    let idx: number;
    while ((idx = text.indexOf('\n\n')) >= 0) { blocks.push(text.slice(0, idx)); text = text.slice(idx + 2); }
  }
  return { blocks, cancel: () => controller.abort() };
}
afterEach(async () => {
  for (const hub of hubs.splice(0)) hub.stop();
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('stream hub lifecycle and reactions', () => {
  it('counts session and daemon subscribers and decrements after close', async () => {
    const db = tempDb(); insertRun(db); insertSessionEvent(db);
    const { url, hub } = await start(db);
    const session = await readBlocks(url); const daemon = await readBlocks(`${url}/daemon`);
    expect(hub.subscriberCount()).toBe(2);
    session.cancel(); daemon.cancel();
    await vi.waitFor(() => expect(hub.subscriberCount()).toBe(0));
  });

  it('broadcasts named frames only to session subscribers', async () => {
    const db = tempDb(); insertRun(db); insertSessionEvent(db);
    const { url, hub } = await start(db);
    const sessionPromise = readBlocks(url, 2);
    const daemonPromise = readBlocks(`${url}/daemon`, 2);
    await vi.waitFor(() => expect(hub.subscriberCount()).toBe(2));
    hub.broadcast('monitor:shutdown-pending', 'soon');
    await hub.flush();
    const session = await sessionPromise;
    const daemon = await daemonPromise;
    session.cancel(); daemon.cancel();
    expect(session.blocks[1]).toContain('event: monitor:shutdown-pending');
    expect(daemon.blocks[1]).toContain('"type":"daemon:heartbeat"');
    expect(daemon.blocks.join('\n')).not.toContain('monitor:shutdown-pending');
  });

  it('stops open responses, clears subscribers, and is idempotent', async () => {
    const db = tempDb(); insertRun(db); insertSessionEvent(db);
    const { url, hub } = await start(db);
    const stream = await readBlocks(url);
    expect(hub.subscriberCount()).toBe(1);
    hub.stop(); hub.stop(); stream.cancel();
    expect(hub.subscriberCount()).toBe(0);
  });

  it('reacts once for post-start enqueue:complete with zero subscribers', async () => {
    const db = tempDb(); const calls: string[] = [];
    const { hub } = await start(db, calls);
    db.insertDaemonEvent({ type: 'enqueue:complete', data: event(), timestamp: ts });
    await hub.flush();
    expect(calls).toEqual(['enqueue']);
  });

  it('does not react to pre-existing enqueue:complete rows', async () => {
    const db = tempDb(); const calls: string[] = [];
    db.insertDaemonEvent({ type: 'enqueue:complete', data: event(), timestamp: ts });
    const { hub } = await start(db, calls);
    await hub.flush();
    expect(calls).toEqual([]);
  });

  it('advances past malformed rows and reacts to the later valid row once', async () => {
    const db = tempDb(); const calls: string[] = [];
    const { hub } = await start(db, calls);
    db.insertDaemonEvent({ type: 'enqueue:complete', data: '{', timestamp: ts });
    db.insertDaemonEvent({ type: 'enqueue:complete', data: event({ id: 'prd-2' }), timestamp: ts });
    await hub.flush();
    expect(calls).toEqual(['enqueue']);
  });

  it('finishes runtime queue completion finalization before external notification', async () => {
    const db = tempDb(); const calls: string[] = []; const order: string[] = [];
    const { hub } = await start(db, calls, async () => {
      order.push('finalize:start');
      await Promise.resolve();
      order.push('finalize:end');
    });
    db.insertDaemonEvent({ type: 'queue:prd:complete', data: completionEvent(), timestamp: ts });

    await hub.flush();

    expect(order).toEqual(['finalize:start', 'finalize:end']);
    expect(calls).toEqual(['external']);
  });
});
