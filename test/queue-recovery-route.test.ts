import { afterEach, describe, expect, it } from 'vitest';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { API_ROUTES, type QueueRecoveryAnalyzeResponse, type QueueRecoveryApplyResponse } from '@eforge-build/client';
import { AutoBuildSupervisor, type AutoBuildQueueMutationReason } from '@eforge-build/monitor/auto-build-supervisor';
import { openDatabase } from '@eforge-build/monitor/db';
import { startServer, type DaemonState, type MonitorServer } from '@eforge-build/monitor/server';
import { useTempDir } from './test-tmpdir.js';

const makeTempDir = useTempDir('eforge-queue-recovery-route-');
let server: MonitorServer | undefined;
let wakeReasons: string[] = [];

class RecordingAutoBuildSupervisor extends AutoBuildSupervisor {
  override notifyQueueMutation(reason?: AutoBuildQueueMutationReason) {
    wakeReasons.push(reason ?? 'external');
    return super.notifyQueueMutation(reason);
  }
}

function daemonState(): DaemonState {
  return { autoBuildController: new RecordingAutoBuildSupervisor() };
}

async function exists(path: string): Promise<boolean> {
  try { await access(path); return true; } catch { return false; }
}

async function writePrd(cwd: string, location: 'failed' | 'skipped', id: string, deps: string[] = []): Promise<void> {
  const dir = join(cwd, '.eforge', 'queue', location);
  await mkdir(dir, { recursive: true });
  const depLine = deps.length > 0 ? `depends_on: [${deps.map((d) => `"${d}"`).join(', ')}]\n` : '';
  await writeFile(join(dir, `${id}.md`), `---\ntitle: ${id}\n${depLine}---\n\n# ${id}\n`, 'utf-8');
}

async function setupServer(cwd: string): Promise<void> {
  wakeReasons = [];
  server = await startServer(openDatabase(resolve(cwd, 'monitor.db')), 0, {
    strictPort: true,
    cwd,
    daemonState: daemonState(),
  });
}

afterEach(async () => {
  await server?.stop();
  server = undefined;
});

describe('queue recovery daemon routes', () => {
  it('analyze returns planned operations and leaves queue files unchanged', async () => {
    const cwd = makeTempDir();
    await writePrd(cwd, 'failed', 'parent');
    await writePrd(cwd, 'skipped', 'child', ['parent']);
    await setupServer(cwd);

    const before = await exists(join(cwd, '.eforge', 'queue', 'failed', 'parent.md'));
    const res = await fetch(`http://localhost:${server!.port}${API_ROUTES.queueRecoveryAnalyze}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selectedPrdId: 'parent' }),
    });

    expect(res.status).toBe(200);
    const body = await res.json() as QueueRecoveryAnalyzeResponse;
    expect(body.eligible).toBe(true);
    expect(body.operations.length).toBeGreaterThan(0);
    expect(await exists(join(cwd, '.eforge', 'queue', 'failed', 'parent.md'))).toBe(before);
    expect(await exists(join(cwd, '.eforge', 'queue', 'skipped', 'child.md'))).toBe(true);
  });

  it('apply returns operation statuses and records apply-recovery wake notification', async () => {
    const cwd = makeTempDir();
    await writePrd(cwd, 'failed', 'parent');
    await writePrd(cwd, 'skipped', 'child', ['parent']);
    await setupServer(cwd);

    const analyzeRes = await fetch(`http://localhost:${server!.port}${API_ROUTES.queueRecoveryAnalyze}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selectedPrdId: 'parent' }),
    });
    const analysis = await analyzeRes.json() as QueueRecoveryAnalyzeResponse;

    const applyRes = await fetch(`http://localhost:${server!.port}${API_ROUTES.queueRecoveryApply}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selectedPrdId: 'parent', expectedOperations: analysis.operations }),
    });

    expect(applyRes.status).toBe(200);
    const applied = await applyRes.json() as QueueRecoveryApplyResponse;
    expect(applied.applied).toBe(true);
    expect(applied.operationResults.some((r) => r.status === 'applied')).toBe(true);
    expect(wakeReasons).toContain('apply-recovery');
  });

  it('apply rejects malformed JSON without waking the queue scheduler', async () => {
    const cwd = makeTempDir();
    await setupServer(cwd);

    const applyRes = await fetch(`http://localhost:${server!.port}${API_ROUTES.queueRecoveryApply}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{',
    });

    expect(applyRes.status).toBe(400);
    expect(wakeReasons).toEqual([]);
  });

  it('returns typed blockers without wake notification when apply is ineligible', async () => {
    const cwd = makeTempDir();
    await setupServer(cwd);

    const applyRes = await fetch(`http://localhost:${server!.port}${API_ROUTES.queueRecoveryApply}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ selectedPrdId: 'missing', expectedOperations: [] }),
    });

    expect(applyRes.status).toBe(200);
    const applied = await applyRes.json() as QueueRecoveryApplyResponse;
    expect(applied.applied).toBe(false);
    expect(applied.blockers.length).toBeGreaterThan(0);
    expect(wakeReasons).toEqual([]);
  });
});
