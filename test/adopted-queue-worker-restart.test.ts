import { afterEach, describe, expect, it, vi } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { openDatabase, type MonitorDB } from '@eforge-build/monitor/db';
import { writeDaemonEvent } from '@eforge-build/monitor/daemon-events';
import { startAdoptedQueueWorkerMonitor, type AdoptedQueueWorkerMonitor } from '@eforge-build/monitor/adopted-queue-workers';
import { reconcileOrphanedState } from '@eforge-build/monitor/server-main';
import { loadArtifactRegistry, loadCompletionRegistry, upsertArtifact, upsertCompletion } from '@eforge-build/engine/artifacts';
import { useTempDir } from './test-tmpdir';

const makeTempDir = useTempDir('eforge-adopted-worker-');
const children: ChildProcess[] = [];
const monitors: AdoptedQueueWorkerMonitor[] = [];

function openTempDb(cwd: string): MonitorDB {
  mkdirSync(join(cwd, '.eforge'), { recursive: true });
  return openDatabase(join(cwd, '.eforge', 'monitor.db'));
}

function writePrd(cwd: string, queueDir: string, id: string, dependsOn: string[] = []): string {
  const dependsLine = dependsOn.length > 0 ? `depends_on: [${dependsOn.map((dep) => `"${dep}"`).join(', ')}]\n` : '';
  const path = join(cwd, queueDir, `${id}.md`);
  mkdirSync(join(cwd, queueDir), { recursive: true });
  writeFileSync(path, `---\ntitle: ${id}\n${dependsLine}---\n\n# ${id}\n`, 'utf-8');
  return path;
}

async function moveToWaiting(cwd: string, queueDir: string, id: string): Promise<void> {
  mkdirSync(join(cwd, queueDir, 'waiting'), { recursive: true });
  const root = join(cwd, queueDir, `${id}.md`);
  await writeFile(join(cwd, queueDir, 'waiting', `${id}.md`), readFileSync(root, 'utf-8'), 'utf-8');
  await rm(root, { force: true });
}

function spawnLockChild(cwd: string, prdId: string, exitCode: number): { child: ChildProcess; doneFile: string; lockPath: string } {
  const doneFile = join(cwd, `.done-${prdId}`);
  const script = `
    const { mkdirSync, writeFileSync, existsSync } = require('node:fs');
    const { join } = require('node:path');
    const cwd = ${JSON.stringify(cwd)};
    const prdId = ${JSON.stringify(prdId)};
    const doneFile = ${JSON.stringify(doneFile)};
    mkdirSync(join(cwd, '.eforge', 'queue-locks'), { recursive: true });
    writeFileSync(join(cwd, '.eforge', 'queue-locks', prdId + '.lock'), String(process.pid), 'utf-8');
    const timer = setInterval(() => {
      if (existsSync(doneFile)) {
        clearInterval(timer);
        process.exit(${exitCode});
      }
    }, 20);
  `;
  const child = spawn(process.execPath, ['-e', script], { cwd, stdio: 'ignore' });
  children.push(child);
  return { child, doneFile, lockPath: join(cwd, '.eforge', 'queue-locks', `${prdId}.lock`) };
}

async function waitForChildExit(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return;
  await new Promise<void>((resolve) => child.once('exit', () => resolve()));
}

async function seedCompletedArtifact(cwd: string, prdId: string): Promise<void> {
  const recordedAt = '2026-01-01T00:00:00.000Z';
  await upsertArtifact(cwd, {
    prdId,
    artifactBranch: `eforge/${prdId}`,
    commitSha: 'abc123',
    resolvedBase: 'main',
    landingAction: 'pr',
    status: 'built',
    recordedAt,
    updatedAt: recordedAt,
  });
  await upsertCompletion(cwd, {
    prdId,
    status: 'completed',
    artifactAvailable: true,
    artifactBranch: `eforge/${prdId}`,
    completedAt: recordedAt,
    updatedAt: recordedAt,
  });
}

async function adoptAndMonitor(db: MonitorDB, cwd: string, queueDir: string, prdId: string, wakeReasons: string[]): Promise<AdoptedQueueWorkerMonitor> {
  const report = await reconcileOrphanedState(db, cwd, { queueDir });
  expect(report.locksAdopted.map((lock) => lock.prdId)).toContain(prdId);
  const monitor = startAdoptedQueueWorkerMonitor({
    db,
    cwd,
    queueDir,
    locks: report.locksAdopted,
    autoBuildController: { notifyQueueMutation: (reason: string) => { wakeReasons.push(reason); } } as never,
    pollIntervalMs: 20,
  });
  monitors.push(monitor);
  return monitor;
}

afterEach(async () => {
  for (const monitor of monitors.splice(0)) monitor.stop();
  for (const child of children.splice(0)) {
    if (child.exitCode === null && child.pid) {
      try { process.kill(child.pid, 'SIGTERM'); } catch { /* already exited */ }
      await waitForChildExit(child).catch(() => undefined);
    }
  }
});

describe('adopted queue worker restart monitor', () => {
  it('finalizes an adopted successful child exactly once and does not redispatch the root', async () => {
    const cwd = makeTempDir();
    const queueDir = '.eforge/queue';
    const db = openTempDb(cwd);
    const rootPath = writePrd(cwd, queueDir, 'adopted-root');
    writePrd(cwd, queueDir, 'dependent-child', ['adopted-root']);
    await moveToWaiting(cwd, queueDir, 'dependent-child');
    const { child, doneFile, lockPath } = spawnLockChild(cwd, 'adopted-root', 0);
    await vi.waitFor(() => expect(existsSync(lockPath)).toBe(true));
    await seedCompletedArtifact(cwd, 'adopted-root');
    const artifactsBefore = await loadArtifactRegistry(cwd);
    const completionsBefore = await loadCompletionRegistry(cwd);
    const wakeReasons: string[] = [];
    const monitor = await adoptAndMonitor(db, cwd, queueDir, 'adopted-root', wakeReasons);

    writeDaemonEvent(db, { type: 'queue:prd:complete', prdId: 'adopted-root', status: 'completed' }, 'daemon-test');
    await writeFile(doneFile, 'done', 'utf-8');
    await waitForChildExit(child);

    await vi.waitFor(() => expect(monitor.pendingCount()).toBe(0));
    expect(existsSync(lockPath)).toBe(false);
    expect(existsSync(rootPath)).toBe(false);
    expect(existsSync(join(cwd, queueDir, 'dependent-child.md'))).toBe(true);
    expect(existsSync(join(cwd, queueDir, 'waiting', 'dependent-child.md'))).toBe(false);
    expect(await loadArtifactRegistry(cwd)).toEqual(artifactsBefore);
    expect(await loadCompletionRegistry(cwd)).toEqual(completionsBefore);
    expect(wakeReasons).toEqual(['external']);
    db.close();
  });

  it('finalizes an adopted failed child with recovery sidecar and dependent skip propagation', async () => {
    const cwd = makeTempDir();
    const queueDir = '.eforge/queue';
    const db = openTempDb(cwd);
    writePrd(cwd, queueDir, 'failed-root');
    writePrd(cwd, queueDir, 'dependent-child', ['failed-root']);
    await moveToWaiting(cwd, queueDir, 'dependent-child');
    const { child, doneFile, lockPath } = spawnLockChild(cwd, 'failed-root', 7);
    await vi.waitFor(() => expect(existsSync(lockPath)).toBe(true));
    const wakeReasons: string[] = [];
    const monitor = await adoptAndMonitor(db, cwd, queueDir, 'failed-root', wakeReasons);

    writeDaemonEvent(db, { type: 'queue:prd:complete', prdId: 'failed-root', status: 'failed' }, 'daemon-test');
    await writeFile(doneFile, 'done', 'utf-8');
    await waitForChildExit(child);

    await vi.waitFor(() => expect(monitor.pendingCount()).toBe(0));
    expect(existsSync(lockPath)).toBe(false);
    expect(existsSync(join(cwd, queueDir, 'failed', 'failed-root.md'))).toBe(true);
    expect(existsSync(join(cwd, queueDir, 'failed', 'failed-root.recovery.json'))).toBe(true);
    expect(existsSync(join(cwd, queueDir, 'skipped', 'dependent-child.md'))).toBe(true);
    expect((await loadCompletionRegistry(cwd)).completions['failed-root']).toMatchObject({ status: 'failed' });
    expect(wakeReasons).toEqual(['external']);
    db.close();
  });

  it('monitors an adopted lock even when no running DB row exists', async () => {
    const cwd = makeTempDir();
    const queueDir = '.eforge/queue';
    const db = openTempDb(cwd);
    writePrd(cwd, queueDir, 'lock-only-root');
    const { child, doneFile, lockPath } = spawnLockChild(cwd, 'lock-only-root', 0);
    await vi.waitFor(() => expect(existsSync(lockPath)).toBe(true));
    const wakeReasons: string[] = [];
    const monitor = await adoptAndMonitor(db, cwd, queueDir, 'lock-only-root', wakeReasons);

    writeDaemonEvent(db, { type: 'queue:prd:complete', prdId: 'lock-only-root', status: 'failed' }, 'daemon-test');
    await writeFile(doneFile, 'done', 'utf-8');
    await waitForChildExit(child);

    await vi.waitFor(() => expect(monitor.pendingCount()).toBe(0));
    expect(existsSync(lockPath)).toBe(false);
    expect(existsSync(join(cwd, queueDir, 'failed', 'lock-only-root.md'))).toBe(true);
    expect(wakeReasons).toEqual(['external']);
    expect(db.getRunningRuns()).toEqual([]);
    db.close();
  });
});
