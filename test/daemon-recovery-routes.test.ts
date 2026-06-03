// Split from daemon-recovery.test.ts.
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { writeFile, mkdir, readFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { useTempDir } from './test-tmpdir.js';
import { openDatabase } from '@eforge-build/monitor/db';
import { startServer, type WorkerTracker, type MonitorServer } from '@eforge-build/monitor/server';
import { moveFailedWithSidecar, type QueuedPrd } from '@eforge-build/engine/prd-queue';
import { EforgeEngine } from '@eforge-build/engine/eforge';
import { StubHarness } from './stub-harness.js';
import { API_ROUTES } from '@eforge-build/client';
import type { EforgeEvent } from '@eforge-build/engine/events';
import { collectDaemonRecoveryEvents as collectEvents, initDaemonRecoveryGitRepo as initGitRepo } from './daemon-recovery-helpers.js';



interface SpawnCall {
  command: string;
  args: string[];
  sessionId: string;
  pid: number;
}


function makeStubTracker(): { tracker: WorkerTracker; calls: SpawnCall[] } {
  const calls: SpawnCall[] = [];
  let pidCounter = 10000;
  let sessionCounter = 0;

  const tracker: WorkerTracker = {
    spawnWorker(command: string, args: string[]): { sessionId: string; pid: number } {
      const sessionId = `stub-${++sessionCounter}`;
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





const makeTempDir = useTempDir();

let tmpDir: string;
let dbPath: string;
let server: MonitorServer;
let tracker: WorkerTracker;
let spawnCalls: SpawnCall[];

async function setupServer(): Promise<void> {
  const { tracker: t, calls } = makeStubTracker();
  tracker = t;
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
});

afterEach(async () => {
  await server?.stop();
});

describe('POST /api/recover', () => {
  beforeEach(async () => {
    await setupServer();
  });

  it('spawns recover with setName and prdId and returns sessionId + pid', async () => {
    const res = await fetch(`http://localhost:${server.port}${API_ROUTES.recover}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ setName: 'my-set', prdId: 'plan-01' }),
    });

    expect(res.status).toBe(200);
    const data = await res.json() as { sessionId: string; pid: number };
    expect(typeof data.sessionId).toBe('string');
    expect(typeof data.pid).toBe('number');

    expect(spawnCalls).toHaveLength(1);
    expect(spawnCalls[0].command).toBe('recover');
    expect(spawnCalls[0].args).toEqual(['my-set', 'plan-01']);
  });

  it('returns 400 when setName is missing', async () => {
    const res = await fetch(`http://localhost:${server.port}${API_ROUTES.recover}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prdId: 'plan-01' }),
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 when prdId is missing', async () => {
    const res = await fetch(`http://localhost:${server.port}${API_ROUTES.recover}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ setName: 'my-set' }),
    });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/recovery/sidecar', () => {
  function makeV2Sidecar(prdId = 'test-prd') {
    return {
      schemaVersion: 2,
      summary: { prdId, setName: 'test-set', featureBranch: 'eforge/test-set', baseBranch: 'main', plans: [{ planId: 'plan-01', status: 'failed' }], failingPlan: { planId: 'plan-01' }, landedCommits: [], diffStat: '', modelsUsed: [], failedAt: new Date(0).toISOString(), partial: true },
      verdict: { verdict: 'manual', confidence: 'low', rationale: 'Missing context', completedWork: [], remainingWork: [], risks: [], partial: true, recoveryError: 'context was incomplete' },
      generatedAt: new Date().toISOString(),
    };
  }

  async function writeSidecarFiles(prdId: string, jsonContent: string): Promise<void> {
    const failedDir = join(tmpDir, '.eforge', 'queue', 'failed');
    await mkdir(failedDir, { recursive: true });
    await writeFile(join(failedDir, `${prdId}.recovery.md`), `# Recovery Analysis: ${prdId}\n\nPartial summary.`);
    await writeFile(join(failedDir, `${prdId}.recovery.json`), jsonContent);
  }

  async function fetchSidecar(prdId: string): Promise<Response> {
    return fetch(`http://localhost:${server.port}${API_ROUTES.readRecoverySidecar}?prdId=${prdId}`);
  }

  beforeEach(async () => {
    await setupServer();
  });

  it('reads v2 sidecar (schemaVersion: 2, partial: true)', async () => {
    const v2Sidecar = makeV2Sidecar();
    await writeSidecarFiles('test-prd', JSON.stringify(v2Sidecar, null, 2));

    const res = await fetchSidecar('test-prd');

    expect(res.status).toBe(200);
    const data = await res.json() as { markdown: string; json: typeof v2Sidecar };
    expect(data.json.schemaVersion).toBe(2);
    expect(data.json.verdict.partial).toBe(true);
    expect(data.markdown).toContain('Recovery Analysis');
  });

  it('returns 404 when sidecar files do not exist', async () => {
    const url = `http://localhost:${server.port}${API_ROUTES.readRecoverySidecar}?prdId=plan-99`;
    const res = await fetch(url);
    expect(res.status).toBe(404);
  });

  it('returns 400 when query params are missing', async () => {
    const url = `http://localhost:${server.port}${API_ROUTES.readRecoverySidecar}?`;
    const res = await fetch(url);
    expect(res.status).toBe(400);
  });

  it('returns 500 for malformed sidecar JSON and remains usable', async () => {
    await writeSidecarFiles('bad-json', '{ not valid json');

    const res = await fetchSidecar('bad-json');

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ error: 'Recovery sidecar JSON is malformed for prdId: bad-json' });
    await expect(fetchSidecar('missing-after-bad-json').then((r) => r.status)).resolves.toBe(404);
  });

  it.each([
    ['summary', { summary: { prdId: 'invalid-summary' } }, 'Recovery sidecar summary is invalid for prdId: invalid-summary'],
    ['verdict', { verdict: { verdict: 'unknown', confidence: 'low', rationale: 'bad', completedWork: [], remainingWork: [], risks: [] } }, 'Recovery sidecar verdict is invalid for prdId: invalid-verdict'],
  ])('returns 500 for schema-invalid sidecar %s and remains usable', async (_field, overrides, expectedError) => {
    const prdId = expectedError.includes('invalid-summary') ? 'invalid-summary' : 'invalid-verdict';
    const sidecar = { ...makeV2Sidecar(prdId), ...overrides };
    await writeSidecarFiles(prdId, JSON.stringify(sidecar, null, 2));

    const res = await fetchSidecar(prdId);

    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ error: expectedError });
    await expect(fetchSidecar('missing-after-invalid-sidecar').then((r) => r.status)).resolves.toBe(404);
  });
});
