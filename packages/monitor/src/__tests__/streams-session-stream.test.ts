import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { createMonitorContext } from '../context.js';
import { openDatabase, type MonitorDB } from '../db.js';
import { createStreamHub, type StreamHub } from '../streams/stream-hub.js';

const ts = '2026-01-01T00:00:00.000Z';
const tempDirs: string[] = [];
const servers: Server[] = [];
const hubs: StreamHub[] = [];

function tempDb(): { db: MonitorDB; dir: string } {
  const dir = mkdtempSync(join(tmpdir(), 'eforge-stream-session-'));
  tempDirs.push(dir);
  return { db: openDatabase(join(dir, 'monitor.db')), dir };
}

function insertRun(db: MonitorDB, id: string, sessionId: string, status = 'running'): void {
  db.insertRun({ id, sessionId, planSet: 'set', command: 'build', status, startedAt: ts, cwd: process.cwd() });
}

function insertEvent(db: MonitorDB, runId: string, type = 'phase:start'): number {
  return db.insertEvent({ runId, type, data: JSON.stringify({ type, timestamp: ts, runId, planSet: 'set', command: 'build' }), timestamp: ts });
}

async function start(db: MonitorDB): Promise<{ url: string; hub: StreamHub }> {
  const context = await createMonitorContext(db);
  const hub = createStreamHub(context, { pollIntervalMs: 25, heartbeatIntervalMs: 1000, clock: { now: () => Date.parse(ts) } });
  hubs.push(hub);
  const server = createServer((req, res) => hub.attachSession(req, res, req.url?.slice(1) || 'session'));
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('missing port');
  return { url: `http://127.0.0.1:${address.port}`, hub };
}

async function readBlocks(url: string, headers?: Record<string, string>, count = 1): Promise<{ blocks: string[]; cancel: () => void }> {
  const controller = new AbortController();
  const res = await fetch(url, { headers, signal: controller.signal });
  const reader = res.body?.getReader();
  if (!reader) throw new Error('missing body');
  let text = '';
  const blocks: string[] = [];
  while (blocks.length < count) {
    const next = await reader.read();
    if (next.done) break;
    text += new TextDecoder().decode(next.value);
    let idx: number;
    while ((idx = text.indexOf('\n\n')) >= 0) {
      blocks.push(text.slice(0, idx));
      text = text.slice(idx + 2);
    }
  }
  return { blocks, cancel: () => controller.abort() };
}

afterEach(async () => {
  for (const hub of hubs.splice(0)) hub.stop();
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('session stream module', () => {
  it('writes stream:hello first and skips historical replay on fresh running connect', async () => {
    const { db } = tempDb();
    insertRun(db, 'run-1', 'session-1');
    insertEvent(db, 'run-1');
    const { url } = await start(db);
    const { blocks, cancel } = await readBlocks(`${url}/session-1`);
    cancel();
    expect(blocks[0].startsWith('event: stream:hello')).toBe(true);
    expect(blocks[0]).not.toContain('\nid:');
    expect(JSON.parse(blocks[0].split('data: ')[1]).events).toHaveLength(1);
  });

  it('closes terminal completed and failed sessions without subscribers', async () => {
    for (const status of ['completed', 'failed']) {
      const { db } = tempDb();
      insertRun(db, `run-${status}`, `session-${status}`, status);
      const { url, hub } = await start(db);
      const { blocks } = await readBlocks(`${url}/session-${status}`);
      expect(blocks[0]).toContain('event: stream:hello');
      expect(hub.subscriberCount()).toBe(0);
    }
  });

  it('replays only events after Last-Event-ID', async () => {
    const { db } = tempDb();
    insertRun(db, 'run-1', 'session-1');
    const first = insertEvent(db, 'run-1');
    insertEvent(db, 'run-1');
    const { url } = await start(db);
    const { blocks, cancel } = await readBlocks(`${url}/session-1`, { 'Last-Event-ID': String(first) }, 2);
    cancel();
    expect(blocks[0]).toContain('event: stream:hello');
    expect(blocks[1]).toContain(`id: ${first + 1}`);
  });

  it('resolves run ids to session ids', async () => {
    const { db } = tempDb();
    insertRun(db, 'run-alias', 'session-real');
    insertEvent(db, 'run-alias');
    const { url } = await start(db);
    const { blocks, cancel } = await readBlocks(`${url}/run-alias`);
    cancel();
    expect(JSON.parse(blocks[0].split('data: ')[1]).events).toHaveLength(1);
  });
});
