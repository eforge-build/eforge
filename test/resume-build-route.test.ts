/**
 * End-to-end tests for POST /api/recover/resume-build.
 *
 * Verifies the daemon route:
 * - Returns 400 for missing prdId
 * - Returns 400 for prdId containing path separators
 * - Returns 400 for setName containing path separators
 * - Spawns a resume worker with correct args when prdId alone is provided
 * - Spawns a resume worker with --set-name args when setName is provided
 * - Returns { sessionId, pid } from the spawned worker
 * - Returns 503 when workerTracker is not configured
 *
 * Follows AGENTS.md conventions:
 * - No mocks. Real SQLite, stub WorkerTracker.
 * - useTempDir for filesystem cleanup.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resolve } from 'node:path';
import { useTempDir } from './test-tmpdir.js';
import { openDatabase } from '@eforge-build/monitor/db';
import {
  startServer,
  type MonitorServer,
  type WorkerTracker,
} from '@eforge-build/monitor/server';
import { API_ROUTES } from '@eforge-build/client';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface SpawnCall {
  command: string;
  args: string[];
  sessionId: string;
  pid: number;
}

/** Stub WorkerTracker that records spawn calls without actually spawning. */
function makeStubTracker(): { tracker: WorkerTracker; calls: SpawnCall[] } {
  const calls: SpawnCall[] = [];
  let pidCounter = 20000;
  let sessionCounter = 0;

  const tracker: WorkerTracker = {
    spawnWorker(command: string, args: string[]): { sessionId: string; pid: number } {
      const sessionId = `stub-resume-${++sessionCounter}`;
      const pid = ++pidCounter;
      calls.push({ command, args, sessionId, pid });
      return { sessionId, pid };
    },
    cancelWorker(_sessionId: string): boolean {
      return false;
    },
  };

  return { tracker, calls };
}

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

const makeTempDir = useTempDir('eforge-resume-route-test-');

let tmpDir: string;
let dbPath: string;
let server: MonitorServer;
let spawnCalls: SpawnCall[];

async function setupServer(): Promise<void> {
  const { tracker, calls } = makeStubTracker();
  spawnCalls = calls;

  server = await startServer(
    openDatabase(dbPath),
    0,
    {
      strictPort: true,
      cwd: tmpDir,
      workerTracker: tracker,
    },
  );
}

beforeEach(async () => {
  tmpDir = makeTempDir();
  dbPath = resolve(tmpDir, 'monitor.db');
  await setupServer();
});

afterEach(async () => {
  await server?.stop();
});

// ---------------------------------------------------------------------------
// POST /api/recover/resume-build — validation: null JSON body
// ---------------------------------------------------------------------------

describe('POST /api/recover/resume-build — null JSON body', () => {
  it('returns 400 when the JSON body is null', async () => {
    const res = await fetch(`http://localhost:${server.port}${API_ROUTES.resumeBuild}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'null',
    });

    expect(res.status).toBe(400);
    const data = await res.json() as { error: string };
    expect(typeof data.error).toBe('string');
    expect(spawnCalls).toHaveLength(0);
  });

  it('returns 400 when the JSON body is an array', async () => {
    const res = await fetch(`http://localhost:${server.port}${API_ROUTES.resumeBuild}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '[]',
    });

    expect(res.status).toBe(400);
    const data = await res.json() as { error: string };
    expect(typeof data.error).toBe('string');
    expect(spawnCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// POST /api/recover/resume-build — validation: missing prdId
// ---------------------------------------------------------------------------

describe('POST /api/recover/resume-build — missing prdId', () => {
  it('returns 400 when prdId is missing from the request body', async () => {
    const res = await fetch(`http://localhost:${server.port}${API_ROUTES.resumeBuild}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
    const data = await res.json() as { error: string };
    expect(data.error).toContain('prdId');
  });
});

// ---------------------------------------------------------------------------
// POST /api/recover/resume-build — validation: path traversal in prdId
// ---------------------------------------------------------------------------

describe('POST /api/recover/resume-build — prdId with path separator', () => {
  it('returns 400 when prdId contains a forward slash', async () => {
    const res = await fetch(`http://localhost:${server.port}${API_ROUTES.resumeBuild}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prdId: 'some/path' }),
    });

    expect(res.status).toBe(400);
    const data = await res.json() as { error: string };
    expect(data.error).toContain('prdId');
    expect(spawnCalls).toHaveLength(0);
  });

  it('returns 400 when prdId contains path traversal (..)', async () => {
    const res = await fetch(`http://localhost:${server.port}${API_ROUTES.resumeBuild}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prdId: '../etc/passwd' }),
    });

    expect(res.status).toBe(400);
    const data = await res.json() as { error: string };
    expect(data.error).toContain('prdId');
    expect(spawnCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// POST /api/recover/resume-build — validation: path traversal in setName
// ---------------------------------------------------------------------------

describe('POST /api/recover/resume-build — setName with path separator', () => {
  it('returns 400 when setName contains a forward slash', async () => {
    const res = await fetch(`http://localhost:${server.port}${API_ROUTES.resumeBuild}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prdId: 'valid-prd', setName: 'some/set' }),
    });

    expect(res.status).toBe(400);
    const data = await res.json() as { error: string };
    expect(data.error).toContain('setName');
    expect(spawnCalls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// POST /api/recover/resume-build — happy path: prdId only
// ---------------------------------------------------------------------------

describe('POST /api/recover/resume-build — happy path (prdId only)', () => {
  it('spawns a resume worker with prdId as the only positional arg', async () => {
    const prdId = 'my-feature-prd';

    const res = await fetch(`http://localhost:${server.port}${API_ROUTES.resumeBuild}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prdId }),
    });

    expect(res.status).toBe(200);
    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0].command).toBe('resume');
    expect(spawnCalls[0].args).toEqual([prdId]);
  });

  it('returns sessionId and pid from the spawned worker', async () => {
    const prdId = 'my-feature-prd';

    const res = await fetch(`http://localhost:${server.port}${API_ROUTES.resumeBuild}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prdId }),
    });

    expect(res.status).toBe(200);
    const data = await res.json() as { sessionId: string; pid: number };
    expect(typeof data.sessionId).toBe('string');
    expect(data.sessionId.length).toBeGreaterThan(0);
    expect(typeof data.pid).toBe('number');
    expect(data.pid).toBeGreaterThan(0);

    // Response matches what the stub tracker returned
    expect(data.sessionId).toBe(spawnCalls[0].sessionId);
    expect(data.pid).toBe(spawnCalls[0].pid);
  });
});

// ---------------------------------------------------------------------------
// POST /api/recover/resume-build — happy path: prdId + setName
// ---------------------------------------------------------------------------

describe('POST /api/recover/resume-build — happy path (prdId + setName)', () => {
  it('spawns a resume worker with --set-name args when setName is provided', async () => {
    const prdId = 'my-feature-prd';
    const setName = 'my-custom-set';

    const res = await fetch(`http://localhost:${server.port}${API_ROUTES.resumeBuild}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prdId, setName }),
    });

    expect(res.status).toBe(200);
    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0].command).toBe('resume');
    expect(spawnCalls[0].args).toEqual([prdId, '--set-name', setName]);
  });
});

// ---------------------------------------------------------------------------
// POST /api/recover/resume-build — 503 without workerTracker
// ---------------------------------------------------------------------------

describe('POST /api/recover/resume-build — 503 without workerTracker', () => {
  it('returns 503 when server is started without workerTracker', async () => {
    const tmpDir2 = makeTempDir();
    const dbPath2 = resolve(tmpDir2, 'monitor.db');
    const server2 = await startServer(
      openDatabase(dbPath2),
      0,
      { strictPort: true, cwd: tmpDir2 },
    );

    try {
      const res = await fetch(`http://localhost:${server2.port}${API_ROUTES.resumeBuild}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prdId: 'any-prd' }),
      });
      expect(res.status).toBe(503);
    } finally {
      await server2.stop();
    }
  });
});
