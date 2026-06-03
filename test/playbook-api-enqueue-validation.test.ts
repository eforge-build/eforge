import { describe, it, expect, afterEach } from 'vitest';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { useTempDir } from './test-tmpdir.js';
import { openDatabase } from '@eforge-build/monitor/db';
import { startServer, type MonitorServer, type StartServerOptions, type WorkerTracker } from '@eforge-build/monitor/server';
import { API_ROUTES } from '@eforge-build/client';

import { setupPlaybookApiProject, postJson as post } from './playbook-api-helpers.js';
const makeTempDir = useTempDir('eforge-playbook-api-');

let server: MonitorServer | undefined;

afterEach(async () => {
  await server?.stop();
  server = undefined;
});

async function init(): Promise<{ tmpDir: string; configDir: string }> {
  const tmpDir = makeTempDir();
  const { configDir } = await setupPlaybookApiProject(tmpDir);
  return { tmpDir, configDir };
}

async function start(tmpDir: string, opts: StartServerOptions = {}): Promise<void> {
  const db = openDatabase(resolve(tmpDir, 'monitor.db'));
  server = await startServer(db, 0, { strictPort: true, cwd: tmpDir, ...opts });
}

async function setup(opts: StartServerOptions = {}): Promise<{ tmpDir: string; configDir: string }> {
  const ctx = await init();
  await start(ctx.tmpDir, opts);
  return ctx;
}

describe('POST /api/enqueue - landingAutoMerge validation', () => {
  it('returns 400 when landingAutoMerge is true and landingAction is merge', async () => {
    const tracker = makeRecordingWorkerTracker();
    await setup({ workerTracker: tracker });

    const res = await post(`http://localhost:${server.port}${API_ROUTES.enqueue}`, {
      source: 'implement a new feature',
      landingAction: 'merge',
      landingAutoMerge: true,
    });
    expect(res.status).toBe(400);

    const data = await res.json() as { error: string };
    expect(data.error).toContain('landingAutoMerge');
    expect(data.error).toContain('pr');
    expect(tracker.calls).toHaveLength(0);
  });

  it('returns 400 when landingAutoMerge is a non-boolean value', async () => {
    const tracker = makeRecordingWorkerTracker();
    await setup({ workerTracker: tracker });

    const res = await post(`http://localhost:${server.port}${API_ROUTES.enqueue}`, {
      source: 'implement a new feature',
      landingAutoMerge: 'yes',
    });
    expect(res.status).toBe(400);

    const data = await res.json() as { error: string };
    expect(data.error).toContain('landingAutoMerge');
    expect(data.error).toContain('boolean');
    expect(tracker.calls).toHaveLength(0);
  });

  it('returns 400 when landingAutoMerge is true and policy is never', async () => {
    const { tmpDir, configDir } = await init();

    // Set landing.pr.autoMerge: never in project config
    await writeFile(resolve(configDir, 'config.yaml'), 'landing:\n  pr:\n    autoMerge: never\n', 'utf-8');

    const tracker = makeRecordingWorkerTracker();
    await start(tmpDir, { workerTracker: tracker });

    const res = await post(`http://localhost:${server.port}${API_ROUTES.enqueue}`, {
      source: 'implement a new feature',
      landingAction: 'pr',
      landingAutoMerge: true,
    });
    expect(res.status).toBe(400);

    const data = await res.json() as { error: string };
    expect(data.error).toContain("never");
    expect(tracker.calls).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Route: POST /api/enqueue — afterQueueId validation
// ---------------------------------------------------------------------------

// Recording workerTracker so tests can inspect spawned args
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


describe('POST /api/enqueue - afterQueueId validation', () => {
  it('returns 400 when afterQueueId is not a string (number)', async () => {
    const tracker = makeRecordingWorkerTracker();
    await setup({ workerTracker: tracker });

    const res = await post(`http://localhost:${server.port}${API_ROUTES.enqueue}`, {
      source: 'implement a new feature',
      afterQueueId: 42,
    });
    expect(res.status).toBe(400);

    const data = await res.json() as { error: string };
    expect(data.error).toContain('afterQueueId');
    expect(data.error).toContain('string');
    expect(tracker.calls).toHaveLength(0);
  });

  it('returns 400 when afterQueueId is not a string (boolean)', async () => {
    const tracker = makeRecordingWorkerTracker();
    await setup({ workerTracker: tracker });

    const res = await post(`http://localhost:${server.port}${API_ROUTES.enqueue}`, {
      source: 'implement a new feature',
      afterQueueId: true,
    });
    expect(res.status).toBe(400);

    const data = await res.json() as { error: string };
    expect(data.error).toContain('afterQueueId');
    expect(tracker.calls).toHaveLength(0);
  });

  it('returns 400 with the invalid id in error text for an unknown afterQueueId', async () => {
    const { tmpDir } = await init();
    // Initialize git repo so loadQueue works
    execFileSync('git', ['init', '-b', 'main'], { cwd: tmpDir });
    execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: tmpDir });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: tmpDir });
    const tracker = makeRecordingWorkerTracker();
    await start(tmpDir, { workerTracker: tracker });

    const res = await post(`http://localhost:${server.port}${API_ROUTES.enqueue}`, {
      source: 'implement a new feature',
      afterQueueId: 'nonexistent-q-abc',
    });
    expect(res.status).toBe(400);

    const data = await res.json() as { error: string };
    expect(data.error).toContain('nonexistent-q-abc');
    expect(tracker.calls).toHaveLength(0);
  });

  it('passes --after <id> to enqueue worker when afterQueueId is valid (active root item)', async () => {
    const { tmpDir, configDir } = await init();
    execFileSync('git', ['init', '-b', 'main'], { cwd: tmpDir });
    execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: tmpDir });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: tmpDir });

    // Write an active PRD to the queue root
    const queueDir = resolve(tmpDir, '.eforge', 'queue');
    await mkdir(queueDir, { recursive: true });
    await writeFile(
      resolve(queueDir, 'active-upstream.md'),
      '---\ntitle: active-upstream\ncreated: 2026-01-01\n---\n\n# Active upstream\n',
      'utf-8',
    );

    const tracker = makeRecordingWorkerTracker();
    await start(tmpDir, { workerTracker: tracker });

    const res = await post(`http://localhost:${server.port}${API_ROUTES.enqueue}`, {
      source: 'implement a dependent feature',
      afterQueueId: 'active-upstream',
    });
    expect(res.status).toBe(200);

    // Worker should have been spawned with --after active-upstream
    const call = tracker.calls.find((c) => c.command === 'enqueue');
    expect(call).toBeDefined();
    expect(call!.args).toContain('--after');
    const afterIdx = call!.args.indexOf('--after');
    expect(call!.args[afterIdx + 1]).toBe('active-upstream');
  });
});

