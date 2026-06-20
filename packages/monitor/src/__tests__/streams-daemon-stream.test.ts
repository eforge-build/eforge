import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import type { AutoBuildState } from '@eforge-build/client';
import { createMonitorContext } from '../context.js';
import { openDatabase, type MonitorDB } from '../db.js';
import { buildDaemonHello } from '../streams/daemon-stream.js';
import { createStreamHub, type StreamHub } from '../streams/stream-hub.js';

const ts = '2026-01-01T00:00:00.000Z';
const tempDirs: string[] = [];
const servers: Server[] = [];
const hubs: StreamHub[] = [];
const clock = { now: () => Date.parse(ts) };

function tempDir(): string { const dir = mkdtempSync(join(tmpdir(), 'eforge-stream-daemon-')); tempDirs.push(dir); return dir; }
function tempDb(): MonitorDB { return openDatabase(join(tempDir(), 'monitor.db')); }
function event(type = 'enqueue:complete', extra: Record<string, unknown> = {}): string {
  return JSON.stringify({ type, timestamp: ts, id: 'prd-1', filePath: '/queue/prd-1.md', title: 'PRD 1', planSet: 'PRD 1', ...extra });
}
function insertDaemon(db: MonitorDB, type = 'enqueue:complete', data = event(type)): number {
  return db.insertDaemonEvent({ type, data, timestamp: ts });
}
function autoBuild() {
  const state: AutoBuildState = { enabled: false, watcher: { running: false, pid: null, sessionId: null }, desired: 'disabled', mode: 'disabled', scheduler: { alive: true, paused: false } };
  return { getSnapshot: () => state, notifyQueueMutation: () => state } as never;
}
async function start(db: MonitorDB, cwd?: string): Promise<{ url: string; hub: StreamHub }> {
  const context = await createMonitorContext(db, 0, { cwd, daemonState: { autoBuildController: autoBuild() } });
  const hub = createStreamHub(context, { pollIntervalMs: 20, heartbeatIntervalMs: 30, clock });
  hubs.push(hub);
  const server = createServer((req, res) => hub.attachDaemon(req, res));
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('missing port');
  return { url: `http://127.0.0.1:${address.port}`, hub };
}
async function readBlocks(url: string, headers?: Record<string, string>, count = 1, timeoutMs = 500): Promise<{ blocks: string[]; cancel: () => void }> {
  return readBlocksAfter(url, headers, count, undefined, timeoutMs);
}

async function readBlocksAfter(
  url: string,
  headers: Record<string, string> | undefined,
  count: number,
  afterFirst?: () => void,
  timeoutMs = 500,
): Promise<{ blocks: string[]; cancel: () => void }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const res = await fetch(url, { headers, signal: controller.signal });
  const reader = res.body?.getReader();
  if (!reader) throw new Error('missing body');
  let text = ''; const blocks: string[] = [];
  try {
    while (blocks.length < count) {
      const next = await reader.read();
      if (next.done) break;
      text += new TextDecoder().decode(next.value);
      let idx: number;
      while ((idx = text.indexOf('\n\n')) >= 0) {
        blocks.push(text.slice(0, idx));
        text = text.slice(idx + 2);
        if (blocks.length === 1) afterFirst?.();
      }
    }
  } catch { /* timeout */ }
  clearTimeout(timer);
  return { blocks, cancel: () => controller.abort() };
}

afterEach(async () => {
  for (const hub of hubs.splice(0)) hub.stop();
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('daemon stream module', () => {
  it('writes empty hello first and no immediate non-hello frame', async () => {
    const db = tempDb();
    const { url } = await start(db);
    const { blocks, cancel } = await readBlocks(url, undefined, 1);
    cancel();
    const snapshot = JSON.parse(blocks[0].split('data: ')[1]);
    expect(blocks[0].startsWith('event: stream:hello')).toBe(true);
    expect(snapshot.cursor).toBe(0);
    expect(snapshot.recentActivity).toEqual([]);
  });

  it('hydrates recent activity for populated logs', async () => {
    const db = tempDb();
    const id = insertDaemon(db);
    const context = await createMonitorContext(db);
    const hello = await buildDaemonHello(context, { startedAtMs: clock.now(), subscriberCount: 0, clock });
    expect(hello.cursor).toBe(id);
    expect(hello.snapshot.recentActivity[0].id).toBe(id);
  });

  it('replays only rows after Last-Event-ID', async () => {
    const db = tempDb();
    const first = insertDaemon(db);
    insertDaemon(db, 'enqueue:complete', event('enqueue:complete', { id: 'prd-2' }));
    const { url } = await start(db);
    const { blocks, cancel } = await readBlocks(url, { 'Last-Event-ID': String(first) }, 2);
    cancel();
    expect(blocks[0]).toContain('event: stream:hello');
    expect(blocks[1]).toContain(`id: ${first + 1}`);
  });

  it('delivers live rows to daemon subscribers and skips malformed rows', async () => {
    const db = tempDb();
    const { url } = await start(db);
    let valid = 0;
    const { blocks, cancel } = await readBlocksAfter(url, undefined, 4, () => {
      insertDaemon(db, 'enqueue:complete', '{');
      valid = insertDaemon(db);
    }, 1000);
    cancel();
    expect(blocks.some((block) => block.includes(`id: ${valid}`))).toBe(true);
  });

  it('sends live heartbeat frames without an id and includes scheduler capacity', async () => {
    const db = tempDb();
    const { url } = await start(db);
    const { blocks, cancel } = await readBlocks(url, undefined, 2, 1000);
    cancel();
    expect(blocks[1]).not.toContain('id:');
    const heartbeat = JSON.parse(blocks[1].split('data: ')[1]);
    expect(heartbeat.type).toBe('daemon:heartbeat');
    expect(heartbeat.autoBuild.scheduler.limit).toBeGreaterThan(0);
  });

  it('omits and includes stackSyncStatus based on persisted status', async () => {
    const db = tempDb();
    const cwd = tempDir();
    const context = await createMonitorContext(db, 0, { cwd });
    expect((await buildDaemonHello(context, { startedAtMs: 0, subscriberCount: 0, clock })).snapshot.stackSyncStatus).toBeUndefined();
    mkdirSync(join(cwd, '.eforge', 'stacks'), { recursive: true });
    writeFileSync(join(cwd, '.eforge', 'stacks', 'sync-status.json'), JSON.stringify({ version: 1, current: { id: 'sync-1', startedAt: ts, dryRun: true, restackCandidates: [] } }));
    expect((await buildDaemonHello(context, { startedAtMs: 0, subscriberCount: 0, clock })).snapshot.stackSyncStatus?.current?.id).toBe('sync-1');
  });
});
