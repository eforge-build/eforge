/**
 * Tests for POST /api/auto-build daemon-mode mutations.
 *
 * Follows AGENTS.md conventions:
 * - Real SQLite DB via openDatabase. Real HTTP via startServer.
 * - Constructs inputs inline.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { API_ROUTES } from '@eforge-build/client';
import { openDatabase, type MonitorDB } from '../db.js';
import { startServer } from '../server.js';
import type { DaemonState, MonitorServer, WorkerTracker } from '../server.js';
import { AutoBuildSupervisor, type AutoBuildWatcherState } from '../auto-build-supervisor.js';

function makeTmpCwd(): string {
  const dir = mkdtempSync(join(tmpdir(), 'eforge-auto-build-route-'));
  mkdirSync(join(dir, '.eforge'), { recursive: true });
  return dir;
}

function makeDaemonState(options: {
  desired?: 'enabled' | 'disabled';
  mode?: 'disabled' | 'starting' | 'running' | 'paused' | 'stopping' | 'restarting' | 'faulted';
  watcher?: AutoBuildWatcherState;
  schedulerAlive?: boolean;
} = {}): { daemonState: DaemonState; calls: string[] } {
  const calls: string[] = [];
  let watcher = options.watcher ?? { running: false, pid: null, sessionId: null };
  let schedulerAlive = options.schedulerAlive ?? watcher.running;

  const controller = new AutoBuildSupervisor({
    initialState: {
      desired: options.desired ?? 'disabled',
      mode: options.mode ?? 'disabled',
      watcher,
      scheduler: { alive: schedulerAlive, paused: false },
    },
    effects: {
      now: () => '2025-01-01T00:00:00.000Z',
      getWatcher: () => watcher,
      isSchedulerAlive: () => schedulerAlive,
      spawnWatcher: () => {
        calls.push('spawn-watcher');
        watcher = { running: true, pid: null, sessionId: 'watcher-spawned' };
        schedulerAlive = true;
      },
      stopWatcher: () => {
        calls.push('stop-watcher');
        watcher = { running: false, pid: null, sessionId: null };
        schedulerAlive = false;
      },
      restartWatcher: () => {
        calls.push('restart-watcher');
        watcher = { running: true, pid: null, sessionId: 'watcher-restarted' };
        schedulerAlive = true;
      },
      pauseScheduler: () => calls.push('pause-scheduler'),
      resumeScheduler: () => {
        calls.push('resume-scheduler');
        schedulerAlive = true;
      },
      emitSchedulerMutation: (reason) => calls.push(`mutation:${reason}`),
      emitEvent: (event) => calls.push(`event:${event.type}`),
    },
  });

  return { daemonState: { autoBuildController: controller }, calls };
}

function insertEnqueueCompleteEvent(db: MonitorDB, id: string, title = 'Reaction Test PRD'): number {
  const ts = new Date().toISOString();
  return db.insertDaemonEvent({
    type: 'enqueue:complete',
    data: JSON.stringify({
      type: 'enqueue:complete',
      timestamp: ts,
      id,
      filePath: `eforge/queue/${id}.md`,
      title,
      planSet: id.replace(/^prd-/, ''),
    }),
    timestamp: ts,
  });
}

function countCalls(calls: string[], expected: string): number {
  return calls.filter((call) => call === expected).length;
}

async function waitForCall(calls: string[], expected: string, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (calls.includes(expected)) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${expected}; observed calls: ${calls.join(', ')}`);
}

async function waitForCount(getCount: () => number, expected: number, label: string, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (getCount() === expected) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${label} count ${expected}; observed count: ${getCount()}`);
}

const servers: MonitorServer[] = [];

afterEach(async () => {
  for (const server of servers) {
    try {
      await server.stop();
    } catch {
      // best-effort cleanup
    }
  }
  servers.length = 0;
  vi.restoreAllMocks();
});

describe('POST /api/auto-build', () => {
  it('manual disable delegates to the controller and returns AutoBuildState', async () => {
    const cwd = makeTmpCwd();
    const db = openDatabase(join(cwd, '.eforge', 'monitor.db'));
    const { daemonState, calls } = makeDaemonState({
      desired: 'enabled',
      mode: 'running',
      watcher: { running: true, pid: 1234, sessionId: 'watcher-session' },
      schedulerAlive: true,
    });

    const server = await startServer(db, 0, { cwd, daemonState });
    servers.push(server);

    const response = await fetch(`http://127.0.0.1:${server.port}${API_ROUTES.autoBuildSet}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      enabled: false,
      desired: 'disabled',
      mode: 'disabled',
      watcher: { running: false, pid: null, sessionId: null },
    });
    expect(calls).toEqual([
      'event:daemon:auto-build:transition',
      'pause-scheduler',
      'stop-watcher',
      'event:daemon:auto-build:transition',
      'event:daemon:auto-build:disabled',
    ]);

    db.close();
  });

  it('manual enable delegates to the controller and returns the controller snapshot', async () => {
    const cwd = makeTmpCwd();
    const db = openDatabase(join(cwd, '.eforge', 'monitor.db'));
    const { daemonState, calls } = makeDaemonState();

    const server = await startServer(db, 0, { cwd, daemonState });
    servers.push(server);

    const response = await fetch(`http://127.0.0.1:${server.port}${API_ROUTES.autoBuildSet}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      enabled: true,
      desired: 'enabled',
      mode: 'running',
      watcher: { running: true, pid: null, sessionId: 'watcher-spawned' },
    });
    expect(calls).toContain('spawn-watcher');
    expect(calls).toContain('event:daemon:auto-build:enabled');

    db.close();
  });

  it('rejects invalid bodies without calling the controller', async () => {
    const cwd = makeTmpCwd();
    const db = openDatabase(join(cwd, '.eforge', 'monitor.db'));
    const { daemonState, calls } = makeDaemonState();
    const server = await startServer(db, 0, { cwd, daemonState });
    servers.push(server);

    const response = await fetch(`http://127.0.0.1:${server.port}${API_ROUTES.autoBuildSet}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: 'yes' }),
    });

    expect(response.status).toBe(400);
    expect(calls).toEqual([]);

    db.close();
  });

  it('enabling an inert running watcher restarts the watcher generation', async () => {
    const cwd = makeTmpCwd();
    const db = openDatabase(join(cwd, '.eforge', 'monitor.db'));
    const { daemonState, calls } = makeDaemonState({
      desired: 'enabled',
      mode: 'running',
      watcher: { running: true, pid: null, sessionId: 'watcher-inert' },
      schedulerAlive: false,
    });
    const server = await startServer(db, 0, { cwd, daemonState });
    servers.push(server);

    const response = await fetch(`http://127.0.0.1:${server.port}${API_ROUTES.autoBuildSet}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
    });

    expect(response.status).toBe(200);
    const body = await response.json() as { mode?: string; watcher?: { sessionId?: string | null } };
    expect(body.mode).toBe('running');
    expect(body.watcher?.sessionId).toBe('watcher-spawned');
    expect(calls).toContain('spawn-watcher');

    db.close();
  });
});

describe('POST /api/enqueue', () => {
  // --- eforge:region plan-01-semantic-enqueue-wake ---
  it('enqueue route does not pass an onExit callback to spawnWorker', async () => {
    const cwd = makeTmpCwd();
    const db = openDatabase(join(cwd, '.eforge', 'monitor.db'));
    const { daemonState } = makeDaemonState({
      desired: 'enabled',
      mode: 'running',
      watcher: { running: true, pid: null, sessionId: 'watcher-live' },
      schedulerAlive: true,
    });
    const workerExitCallbacks: Array<() => void> = [];
    const workerTracker: WorkerTracker = {
      spawnWorker: (_command, _args, onExit) => {
        if (onExit) workerExitCallbacks.push(onExit);
        return { sessionId: 'enqueue-session', pid: 12345 };
      },
      cancelWorker: () => false,
    };
    const server = await startServer(db, 0, { cwd, daemonState, workerTracker });
    servers.push(server);

    const response = await fetch(`http://127.0.0.1:${server.port}${API_ROUTES.enqueue}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ source: '# Test PRD' }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ sessionId: 'enqueue-session', autoBuild: true });
    // Wake is now driven by the persisted enqueue:complete event — no onExit
    // callback should be registered by the enqueue route.
    expect(workerExitCallbacks).toHaveLength(0);

    db.close();
  });

  it('persisted enqueue:complete event triggers mutation:enqueue with zero SSE subscribers', async () => {
    const cwd = makeTmpCwd();
    const db = openDatabase(join(cwd, '.eforge', 'monitor.db'));
    const { daemonState, calls } = makeDaemonState({
      desired: 'enabled',
      mode: 'running',
      watcher: { running: true, pid: null, sessionId: 'watcher-live' },
      schedulerAlive: true,
    });
    const server = await startServer(db, 0, { cwd, daemonState });
    servers.push(server);

    // Confirm no SSE subscribers are connected (reaction must not depend on them).
    expect(server.subscriberCount).toBe(0);
    expect(calls).not.toContain('mutation:enqueue');

    // A non-enqueue daemon event should not wake auto-build; only the following
    // enqueue:complete row should produce mutation:enqueue.
    const warningTs = new Date().toISOString();
    db.insertDaemonEvent({
      type: 'daemon:warning',
      data: JSON.stringify({
        type: 'daemon:warning',
        timestamp: warningTs,
        source: 'test',
        message: 'not a queue mutation',
      }),
      timestamp: warningTs,
    });

    // Insert a persisted enqueue:complete daemon event after server start.
    // The reaction cursor was initialized to db.getMaxDaemonEventId() at start,
    // so this newly inserted row will be picked up by the next poll tick.
    insertEnqueueCompleteEvent(db, 'prd-reaction-test-001');

    await waitForCall(calls, 'mutation:enqueue');
    // Allow another poll tick to prove the row-id cursor dedupes the reaction.
    await new Promise<void>((resolve) => setTimeout(resolve, 250));

    expect(countCalls(calls, 'mutation:enqueue')).toBe(1);

    db.close();
  });

  it('does not replay enqueue:complete events that existed before server start', async () => {
    const cwd = makeTmpCwd();
    const db = openDatabase(join(cwd, '.eforge', 'monitor.db'));
    // This row predates server startup and must be skipped by the reaction cursor.
    insertEnqueueCompleteEvent(db, 'prd-old-before-start', 'Old PRD');
    const { daemonState, calls } = makeDaemonState({
      desired: 'enabled',
      mode: 'running',
      watcher: { running: true, pid: null, sessionId: 'watcher-live' },
      schedulerAlive: true,
    });
    const server = await startServer(db, 0, { cwd, daemonState });
    servers.push(server);

    expect(server.subscriberCount).toBe(0);
    insertEnqueueCompleteEvent(db, 'prd-new-after-start', 'New PRD');

    await waitForCall(calls, 'mutation:enqueue');
    await new Promise<void>((resolve) => setTimeout(resolve, 250));

    // Only the post-start row should wake auto-build; the pre-start row must not replay.
    expect(countCalls(calls, 'mutation:enqueue')).toBe(1);

    db.close();
  });

  it('continues reacting to later enqueue:complete rows after a malformed daemon event row', async () => {
    const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const cwd = makeTmpCwd();
    const db = openDatabase(join(cwd, '.eforge', 'monitor.db'));
    const { daemonState, calls } = makeDaemonState({
      desired: 'enabled',
      mode: 'running',
      watcher: { running: true, pid: null, sessionId: 'watcher-live' },
      schedulerAlive: true,
    });
    const server = await startServer(db, 0, { cwd, daemonState });
    servers.push(server);

    const ts = new Date().toISOString();
    db.insertDaemonEvent({
      type: 'enqueue:complete',
      data: '{not-json',
      timestamp: ts,
    });
    // Wait until the malformed row has actually been examined before inserting
    // the valid row; otherwise the test could pass by processing both rows in
    // the same poll batch without proving that the cursor advanced past the bad row.
    await waitForCount(() => stderrSpy.mock.calls.length, 1, 'malformed daemon event parse failure');
    expect(countCalls(calls, 'mutation:enqueue')).toBe(0);

    insertEnqueueCompleteEvent(db, 'prd-after-malformed-row');

    await waitForCall(calls, 'mutation:enqueue');

    expect(countCalls(calls, 'mutation:enqueue')).toBe(1);
    expect(stderrSpy).toHaveBeenCalledTimes(1);

    db.close();
  });
  // --- eforge:endregion plan-01-semantic-enqueue-wake ---

  // --- eforge:region plan-02-enqueue-preprocessing-runtime ---
  it('passes the original source string to spawnWorker without route-side transformation', async () => {
    const cwd = makeTmpCwd();
    const db = openDatabase(join(cwd, '.eforge', 'monitor.db'));
    const { daemonState } = makeDaemonState();

    const spawnedArgs: string[][] = [];
    const workerTracker: WorkerTracker = {
      spawnWorker: (_command, args) => {
        spawnedArgs.push(args);
        return { sessionId: 'test-session', pid: 99999 };
      },
      cancelWorker: () => false,
    };
    const server = await startServer(db, 0, { cwd, daemonState, workerTracker });
    servers.push(server);

    // Extension reference — daemon must NOT attempt to resolve it (no adapters in daemon)
    const extensionRef = 'eforge://input/static/ISSUE-1';
    const response = await fetch(`http://127.0.0.1:${server.port}${API_ROUTES.enqueue}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ source: extensionRef }),
    });

    expect(response.status).toBe(200);
    expect(spawnedArgs).toHaveLength(1);
    // First arg to the worker must be the original source — not transformed
    expect(spawnedArgs[0]![0]).toBe(extensionRef);

    db.close();
  });

  it('passes the original session-plan path to spawnWorker (not normalized content)', async () => {
    const cwd = makeTmpCwd();
    // Write a valid session plan
    const { writeFileSync, mkdirSync } = require('node:fs');
    mkdirSync(join(cwd, '.eforge', 'session-plans'), { recursive: true });
    const sessionPlanPath = join(cwd, '.eforge', 'session-plans', '2026-01-01-test.md');
    writeFileSync(sessionPlanPath, [
      '---',
      'session: 2026-01-01-test',
      'topic: "Test"',
      'status: ready',
      'planning_type: feature',
      'planning_depth: focused',
      'required_dimensions: []',
      'optional_dimensions: []',
      'skipped_dimensions: []',
      'open_questions: []',
      'profile: null',
      '---',
      '',
      '# Test',
      '',
    ].join('\n'), 'utf-8');

    const db = openDatabase(join(cwd, '.eforge', 'monitor.db'));
    const { daemonState } = makeDaemonState();

    const spawnedArgs: string[][] = [];
    const workerTracker: WorkerTracker = {
      spawnWorker: (_command, args) => {
        spawnedArgs.push(args);
        return { sessionId: 'test-session', pid: 88888 };
      },
      cancelWorker: () => false,
    };
    const server = await startServer(db, 0, { cwd, daemonState, workerTracker });
    servers.push(server);

    const relativePath = '.eforge/session-plans/2026-01-01-test.md';
    const response = await fetch(`http://127.0.0.1:${server.port}${API_ROUTES.enqueue}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ source: relativePath }),
    });

    expect(response.status).toBe(200);
    expect(spawnedArgs).toHaveLength(1);
    // Worker receives the original relative path, not the normalized markdown content
    expect(spawnedArgs[0]![0]).toBe(relativePath);
    expect(spawnedArgs[0]![0]).not.toContain('# Test'); // not inline normalized content

    db.close();
  });
  // --- eforge:endregion plan-02-enqueue-preprocessing-runtime ---
});

describe('POST /api/scheduler/kick', () => {
  it('delegates queue mutation wakes to the auto-build controller', async () => {
    const cwd = makeTmpCwd();
    const db = openDatabase(join(cwd, '.eforge', 'monitor.db'));
    const { daemonState, calls } = makeDaemonState({
      desired: 'enabled',
      mode: 'running',
      watcher: { running: true, pid: null, sessionId: 'watcher-live' },
      schedulerAlive: true,
    });
    const server = await startServer(db, 0, { cwd, daemonState });
    servers.push(server);

    const response = await fetch(`http://127.0.0.1:${server.port}${API_ROUTES.schedulerKick}`, { method: 'POST' });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(calls).toContain('mutation:external');

    db.close();
  });
});
