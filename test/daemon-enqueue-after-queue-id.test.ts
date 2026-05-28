/**
 * Daemon route tests for explicit build dependency handoff via afterQueueId.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { API_ROUTES } from '@eforge-build/client';
import { upsertArtifact } from '@eforge-build/engine/artifacts';
import { openDatabase } from '@eforge-build/monitor/db';
import { startServer, type MonitorServer, type StartServerOptions, type WorkerTracker } from '@eforge-build/monitor/server';
import { useTempDir } from './test-tmpdir.js';

const makeTempDir = useTempDir('eforge-daemon-enqueue-after-');

let server: MonitorServer | undefined;

afterEach(async () => {
  await server?.stop();
  server = undefined;
});

async function setupProject(tmpDir: string): Promise<void> {
  const gitOpts = { cwd: tmpDir };
  execFileSync('git', ['init', '-b', 'main'], gitOpts);
  execFileSync('git', ['config', 'user.email', 'test@example.com'], gitOpts);
  execFileSync('git', ['config', 'user.name', 'Test'], gitOpts);
  execFileSync('git', ['commit', '--allow-empty', '-m', 'chore: initial commit'], gitOpts);

  await mkdir(resolve(tmpDir, 'eforge'), { recursive: true });
  await writeFile(resolve(tmpDir, 'eforge', 'config.yaml'), '', 'utf-8');
}

async function start(tmpDir: string, opts: StartServerOptions = {}): Promise<void> {
  const db = openDatabase(resolve(tmpDir, 'monitor.db'));
  server = await startServer(db, 0, { strictPort: true, cwd: tmpDir, ...opts });
}

async function post(url: string, body: unknown): Promise<Response> {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function makeRecordingWorkerTracker(): WorkerTracker & { calls: Array<{ command: string; args: string[] }> } {
  const calls: Array<{ command: string; args: string[] }> = [];
  return {
    calls,
    spawnWorker(command: string, args: string[]): { sessionId: string; pid: number } {
      calls.push({ command, args });
      return { sessionId: 'rec-session', pid: 88888 };
    },
    cancelWorker(_sessionId: string): boolean {
      return false;
    },
  };
}

async function recordBuiltArtifact(cwd: string, prdId: string): Promise<void> {
  const now = new Date().toISOString();
  await upsertArtifact(cwd, {
    prdId,
    artifactBranch: `eforge/${prdId}`,
    commitSha: 'abc123',
    resolvedBase: 'main',
    landingAction: 'leave',
    status: 'built',
    recordedAt: now,
    updatedAt: now,
  });
}

async function writeTerminalQueuePrd(tmpDir: string, state: 'failed' | 'skipped', id: string): Promise<void> {
  const terminalDir = resolve(tmpDir, '.eforge', 'queue', state);
  await mkdir(terminalDir, { recursive: true });
  await writeFile(
    resolve(terminalDir, `${id}.md`),
    `---\ntitle: ${id}\ncreated: 2026-01-01\n---\n\n# ${id}\n`,
    'utf-8',
  );
}

describe('POST /api/enqueue — afterQueueId dependency states', () => {
  it('accepts a completed-artifact upstream and forwards --after to the enqueue worker', async () => {
    const tmpDir = makeTempDir();
    await setupProject(tmpDir);
    await recordBuiltArtifact(tmpDir, 'completed-upstream');

    const tracker = makeRecordingWorkerTracker();
    await start(tmpDir, { workerTracker: tracker });

    const res = await post(`http://localhost:${server!.port}${API_ROUTES.enqueue}`, {
      source: 'implement a dependent feature',
      afterQueueId: 'completed-upstream',
    });
    expect(res.status).toBe(200);

    const call = tracker.calls.find((entry) => entry.command === 'enqueue');
    expect(call).toBeDefined();
    expect(call!.args).toContain('--after');
    const afterIdx = call!.args.indexOf('--after');
    expect(call!.args[afterIdx + 1]).toBe('completed-upstream');
  });

  it('rejects a failed upstream before spawning an enqueue worker', async () => {
    const tmpDir = makeTempDir();
    await setupProject(tmpDir);
    await writeTerminalQueuePrd(tmpDir, 'failed', 'failed-upstream');

    const tracker = makeRecordingWorkerTracker();
    await start(tmpDir, { workerTracker: tracker });

    const res = await post(`http://localhost:${server!.port}${API_ROUTES.enqueue}`, {
      source: 'implement a dependent feature',
      afterQueueId: 'failed-upstream',
    });
    expect(res.status).toBe(400);

    const data = await res.json() as { error: string };
    expect(data.error).toContain('failed-upstream');
    expect(tracker.calls).toHaveLength(0);
  });

  it('rejects a skipped upstream before spawning an enqueue worker', async () => {
    const tmpDir = makeTempDir();
    await setupProject(tmpDir);
    await writeTerminalQueuePrd(tmpDir, 'skipped', 'skipped-upstream');

    const tracker = makeRecordingWorkerTracker();
    await start(tmpDir, { workerTracker: tracker });

    const res = await post(`http://localhost:${server!.port}${API_ROUTES.enqueue}`, {
      source: 'implement a dependent feature',
      afterQueueId: 'skipped-upstream',
    });
    expect(res.status).toBe(400);

    const data = await res.json() as { error: string };
    expect(data.error).toContain('skipped-upstream');
    expect(tracker.calls).toHaveLength(0);
  });
});
