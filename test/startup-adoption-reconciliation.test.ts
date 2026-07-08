import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { openDatabase } from '@eforge-build/monitor/db';
import { loadQueueItemsForCwdSync } from '@eforge-build/monitor/projections/queue-items';
import { reconcileOrphanedState, replayPersistedOrphanQueueCompletions, writeDaemonEvent } from '@eforge-build/monitor/server-main';
import { loadArtifactRegistry, loadCompletionRegistry, upsertArtifact, upsertCompletion } from '@eforge-build/engine/artifacts';
import { useTempDir } from './test-tmpdir';
import { makeDeadPid } from './process-helpers';
import { createTestEnv, makeQueuedPrd, waitForSpawnCallCount, writeQueuedPrdFile } from './queue-scheduler-helpers';

const DEAD_PID = makeDeadPid();
const makeTempDir = useTempDir('eforge-startup-adoption-');

function openTempDb(cwd: string) {
  mkdirSync(join(cwd, '.eforge'), { recursive: true });
  return openDatabase(join(cwd, '.eforge', 'monitor.db'));
}

function writeLock(cwd: string, prdId: string, payload: string): string {
  const lockDir = join(cwd, '.eforge', 'queue-locks');
  mkdirSync(lockDir, { recursive: true });
  const lockPath = join(lockDir, `${prdId}.lock`);
  writeFileSync(lockPath, payload, 'utf-8');
  return lockPath;
}

describe('startup queued-build adoption reconciliation', () => {
  it('adopts live prior-generation queue locks without deleting or redispatching them', async () => {
    const cwd = makeTempDir();
    const db = openTempDb(cwd);
    const lockPath = writeLock(cwd, 'live-root', String(process.pid));

    const report = await reconcileOrphanedState(db, cwd);

    expect(report.locksAdopted).toEqual([{ path: lockPath, pid: process.pid, prdId: 'live-root' }]);
    expect(report.locksRemoved).toEqual([]);
    expect(existsSync(lockPath)).toBe(true);
    expect(readFileSync(lockPath, 'utf-8')).toBe(String(process.pid));
    db.close();
  });

  it('reconciles dead and corrupt locks with exact diagnostics and removes only invalid locks', async () => {
    const cwd = makeTempDir();
    const db = openTempDb(cwd);
    const deadLock = writeLock(cwd, 'dead-root', String(DEAD_PID));
    const corruptLock = writeLock(cwd, 'corrupt-root', '{not-json-or-pid}');
    const liveLock = writeLock(cwd, 'live-root', String(process.pid));

    const report = await reconcileOrphanedState(db, cwd);

    expect(report.locksRemoved).toEqual(expect.arrayContaining([
      { path: deadLock, pid: DEAD_PID, reason: 'dead-pid' },
      { path: corruptLock, reason: 'corrupt-payload' },
    ]));
    expect(report.locksRemoved).toHaveLength(2);
    expect(report.locksAdopted).toEqual([{ path: liveLock, pid: process.pid, prdId: 'live-root' }]);
    expect(existsSync(deadLock)).toBe(false);
    expect(existsSync(corruptLock)).toBe(false);
    expect(existsSync(liveLock)).toBe(true);
    db.close();
  });

  it('degrades absent queue-lock state for a running queued build projection', async () => {
    const cwd = makeTempDir();
    const db = openTempDb(cwd);
    db.insertRun({
      id: 'run-missing-lock',
      sessionId: 'session-missing-lock',
      planSet: 'missing-lock',
      command: 'eforge queue exec missing-lock',
      status: 'running',
      startedAt: new Date().toISOString(),
      cwd,
      pid: process.pid,
    });

    const report = await reconcileOrphanedState(db, cwd);

    expect(report.runsFailed).toEqual([{ 
      runId: 'run-missing-lock',
      sessionId: 'session-missing-lock',
      planSet: 'missing-lock',
      reason: 'reconciled: running queued build has no queue lock at daemon startup',
    }]);
    expect(db.getRun('run-missing-lock')?.status).toBe('failed');
    expect(report.locksRemoved).toEqual([]);
    expect(report.locksAdopted).toEqual([]);
    expect(report.durationMs).toBeGreaterThanOrEqual(0);
    db.close();
  });

  it.each([
    { name: 'matching live', payload: String(process.pid), runPid: process.pid, status: 'running', reason: undefined, removed: [], adopted: true },
    { name: 'pid mismatch', payload: String(process.pid), runPid: DEAD_PID, status: 'failed', reason: 'reconciled: running queued build queue lock PID does not match run PID at daemon startup', removed: [], adopted: false },
    { name: 'corrupt', payload: 'bad-pid', runPid: process.pid, status: 'failed', reason: 'reconciled: running queued build has corrupt queue lock at daemon startup', removed: [], adopted: false },
    { name: 'dead', payload: String(DEAD_PID), runPid: process.pid, status: 'failed', reason: 'reconciled: running queued build queue lock PID is not alive at daemon startup', removed: [], adopted: false },
  ])('reconciles running queued projection with $name lock', async ({ payload, runPid, status, reason, removed, adopted }) => {
    const cwd = makeTempDir();
    const db = openTempDb(cwd);
    mkdirSync(join(cwd, '.eforge', 'queue'), { recursive: true });
    writeFileSync(join(cwd, '.eforge', 'queue', 'matrix-root.md'), '---\ntitle: Matrix Root\n---\n# Matrix Root\n', 'utf-8');
    const lockPath = writeLock(cwd, 'matrix-root', payload);
    db.insertRun({
      id: 'run-matrix-root',
      sessionId: 'session-matrix-root',
      planSet: 'matrix-root',
      command: 'build',
      status: 'running',
      startedAt: new Date().toISOString(),
      cwd,
      pid: runPid,
    });

    const report = await reconcileOrphanedState(db, cwd);

    expect(db.getRun('run-matrix-root')?.status).toBe(status);
    if (reason) {
      expect(report.runsFailed).toEqual([{ runId: 'run-matrix-root', sessionId: 'session-matrix-root', planSet: 'matrix-root', reason }]);
      expect(JSON.parse(db.getEventsByType('run-matrix-root', 'phase:end')[0].data)).toMatchObject({ result: { status: 'failed', summary: reason } });
    } else {
      expect(report.runsFailed).toEqual([]);
      expect(db.getEventsByType('run-matrix-root', 'phase:end')).toHaveLength(0);
    }
    expect(report.locksRemoved).toEqual(removed.map((entry) => ({ path: lockPath, ...entry })));
    expect(report.locksAdopted).toEqual(adopted ? [{ path: lockPath, pid: process.pid, prdId: 'matrix-root' }] : []);
    db.close();
  });

  it('finalizes proven dead adopted queued runs through the shared failed finalizer', async () => {
    const cwd = makeTempDir();
    const db = openTempDb(cwd);
    const queueDir = '.eforge/queue';
    mkdirSync(join(cwd, queueDir, 'waiting'), { recursive: true });
    writeFileSync(join(cwd, queueDir, 'dead-root.md'), '---\ntitle: Dead Root\n---\n# Dead Root\n', 'utf-8');
    writeFileSync(join(cwd, queueDir, 'waiting', 'dependent.md'), '---\ntitle: Dependent\ndepends_on: ["dead-root"]\n---\n# Dependent\n', 'utf-8');
    const lockPath = writeLock(cwd, 'dead-root', String(DEAD_PID));
    db.insertRun({
      id: 'run-dead-root-finalizer',
      sessionId: 'session-dead-root-finalizer',
      planSet: 'dead-root',
      command: 'build',
      status: 'running',
      startedAt: new Date().toISOString(),
      cwd,
      pid: DEAD_PID,
    });

    const report = await reconcileOrphanedState(db, cwd, { queueDir });

    expect(report.runsFailed).toEqual([{ 
      runId: 'run-dead-root-finalizer',
      sessionId: 'session-dead-root-finalizer',
      planSet: 'dead-root',
      reason: 'reconciled: running queued build queue lock PID is not alive at daemon startup',
    }]);
    expect(existsSync(join(cwd, queueDir, 'failed', 'dead-root.md'))).toBe(true);
    const recovery = JSON.parse(readFileSync(join(cwd, queueDir, 'failed', 'dead-root.recovery.json'), 'utf-8')) as { verdict: { verdict: string; rationale: string } };
    expect(recovery.verdict).toMatchObject({ verdict: 'manual' });
    expect(recovery.verdict.rationale).toContain('shared finalizer replay without build evidence');
    expect(existsSync(lockPath)).toBe(false);
    expect((await loadCompletionRegistry(cwd)).completions['dead-root']).toMatchObject({ status: 'failed' });
    expect(existsSync(join(cwd, queueDir, 'skipped', 'dependent.md'))).toBe(true);
    db.close();
  });

  it('marks dead queued running projections failed with missing-lock startup reconciliation diagnostics', async () => {
    const cwd = makeTempDir();
    const db = openTempDb(cwd);
    mkdirSync(join(cwd, '.eforge', 'queue'), { recursive: true });
    writeFileSync(join(cwd, '.eforge', 'queue', 'dead-root.md'), '---\ntitle: Dead Root\n---\n# Dead Root\n', 'utf-8');
    db.insertRun({
      id: 'run-dead-root',
      sessionId: 'session-dead-root',
      planSet: 'dead-root',
      command: 'build',
      status: 'running',
      startedAt: new Date().toISOString(),
      cwd,
      pid: DEAD_PID,
    });

    const report = await reconcileOrphanedState(db, cwd);

    expect(report.runsFailed).toEqual([{ 
      runId: 'run-dead-root',
      sessionId: 'session-dead-root',
      planSet: 'dead-root',
      reason: 'reconciled: running queued build has no queue lock at daemon startup',
    }]);
    expect(db.getRun('run-dead-root')?.status).toBe('failed');
    const phaseEnd = db.getEventsByType('run-dead-root', 'phase:end');
    expect(phaseEnd).toHaveLength(1);
    expect(JSON.parse(phaseEnd[0].data)).toMatchObject({
      result: { status: 'failed', summary: 'reconciled: running queued build has no queue lock at daemon startup' },
    });
    db.close();
  });

  it('does not fail dead startup runs without queued command, PRD file, or lock context', async () => {
    const cwd = makeTempDir();
    const db = openTempDb(cwd);
    db.insertRun({
      id: 'run-dead-nonqueued',
      sessionId: 'session-dead-nonqueued',
      planSet: 'dead-nonqueued',
      command: 'build',
      status: 'running',
      startedAt: new Date().toISOString(),
      cwd,
      pid: DEAD_PID,
    });

    const report = await reconcileOrphanedState(db, cwd);

    expect(report.runsFailed).toEqual([]);
    expect(db.getRun('run-dead-nonqueued')?.status).toBe('running');
    expect(db.getEventsByType('run-dead-nonqueued', 'phase:end')).toHaveLength(0);
    db.close();
  });

  it('replays persisted orphan queue completions as one external wake and ignores clean-shutdown history', async () => {
    const cwd = makeTempDir();
    const db = openTempDb(cwd);
    const wakeReasons: string[] = [];
    const autoBuildController = {
      notifyQueueMutation(reason: string) {
        wakeReasons.push(reason);
      },
    };

    writeDaemonEvent(db, { type: 'queue:prd:complete', prdId: 'before-clean-shutdown', status: 'completed' }, 'daemon-test');
    writeDaemonEvent(db, { type: 'daemon:lifecycle:shutdown:complete' }, 'daemon-test');
    writeDaemonEvent(db, { type: 'queue:prd:complete', prdId: 'orphan-a', status: 'completed' }, 'daemon-test');
    writeDaemonEvent(db, { type: 'queue:prd:complete', prdId: 'orphan-b', status: 'failed' }, 'daemon-test');
    const startupCursor = db.getMaxDaemonEventId();
    writeDaemonEvent(db, { type: 'queue:prd:complete', prdId: 'future-generation', status: 'completed' }, 'daemon-test');

    const replayed = await replayPersistedOrphanQueueCompletions(db, autoBuildController as never, startupCursor);

    expect(replayed).toBe(2);
    expect(wakeReasons).toEqual(['external']);
    db.close();
  });

  it('replays orphan completions through finalizer before the external wake', async () => {
    const cwd = makeTempDir();
    const db = openTempDb(cwd);
    const queueDir = '.eforge/queue';
    mkdirSync(join(cwd, queueDir, 'waiting'), { recursive: true });
    writeFileSync(join(cwd, queueDir, 'failed-root.md'), '---\ntitle: Failed Root\n---\n# Failed Root\n', 'utf-8');
    writeFileSync(join(cwd, queueDir, 'waiting', 'dependent.md'), '---\ntitle: Dependent\ndepends_on: ["failed-root"]\n---\n# Dependent\n', 'utf-8');
    const lockPath = writeLock(cwd, 'failed-root', String(DEAD_PID));
    const wakeReasons: string[] = [];
    const autoBuildController = {
      notifyQueueMutation(reason: string) {
        expect(existsSync(lockPath)).toBe(false);
        expect(existsSync(join(cwd, queueDir, 'failed', 'failed-root.md'))).toBe(true);
        expect(existsSync(join(cwd, queueDir, 'failed', 'failed-root.recovery.json'))).toBe(true);
        expect(existsSync(join(cwd, queueDir, 'skipped', 'dependent.md'))).toBe(true);
        wakeReasons.push(reason);
      },
    };

    writeDaemonEvent(db, { type: 'queue:prd:complete', prdId: 'failed-root', status: 'failed' }, 'daemon-test');
    const startupCursor = db.getMaxDaemonEventId();

    const replayed = await replayPersistedOrphanQueueCompletions(db, autoBuildController as never, startupCursor, { cwd, queueDir });

    expect(replayed).toBe(1);
    expect(wakeReasons).toEqual(['external']);
    db.close();
  });

  it('preserves successful adopted root artifacts and completion state while unblocking dependents without rerunning root', async () => {
    const { cwd, spawnPrdChild, makeScheduler } = await createTestEnv();
    const db = openTempDb(cwd);
    const queueDir = 'eforge/queue';
    const rootPath = await writeQueuedPrdFile(cwd, 'adopted-root');
    const transientChildPath = await writeQueuedPrdFile(cwd, 'dependent-child', ['adopted-root']);
    mkdirSync(join(cwd, queueDir, 'waiting'), { recursive: true });
    await writeFile(join(cwd, queueDir, 'waiting', 'dependent-child.md'), readFileSync(transientChildPath, 'utf-8'), 'utf-8');
    await rm(transientChildPath, { force: true });
    const lockPath = writeLock(cwd, 'adopted-root', String(DEAD_PID));
    const recordedAt = '2025-01-01T00:00:00.000Z';
    await upsertArtifact(cwd, {
      prdId: 'adopted-root',
      artifactBranch: 'eforge/adopted-root',
      commitSha: 'abc123',
      resolvedBase: 'main',
      landingAction: 'pr',
      status: 'built',
      recordedAt,
      updatedAt: recordedAt,
    });
    await upsertCompletion(cwd, {
      prdId: 'adopted-root',
      status: 'completed',
      artifactAvailable: true,
      artifactBranch: 'eforge/adopted-root',
      completedAt: recordedAt,
      updatedAt: recordedAt,
    });
    db.insertRun({
      id: 'run-adopted-root',
      sessionId: 'session-adoption',
      planSet: 'adopted-root',
      command: 'eforge queue exec adopted-root',
      status: 'completed',
      startedAt: recordedAt,
      cwd,
      pid: DEAD_PID,
    });
    const artifactBefore = await loadArtifactRegistry(cwd);
    const completionBefore = await loadCompletionRegistry(cwd);
    const wakeReasons: string[] = [];
    const autoBuildController = {
      notifyQueueMutation(reason: string) {
        wakeReasons.push(reason);
      },
    };

    writeDaemonEvent(db, { type: 'queue:prd:complete', prdId: 'adopted-root', status: 'completed' }, 'daemon-test');
    const startupCursor = db.getMaxDaemonEventId();

    const replayed = await replayPersistedOrphanQueueCompletions(db, autoBuildController as never, startupCursor, { cwd, queueDir });

    expect(replayed).toBe(1);
    expect(wakeReasons).toEqual(['external']);
    expect(existsSync(rootPath)).toBe(false);
    expect(existsSync(lockPath)).toBe(false);
    expect(existsSync(join(cwd, queueDir, 'waiting', 'dependent-child.md'))).toBe(false);
    expect(existsSync(join(cwd, queueDir, 'dependent-child.md'))).toBe(true);
    expect(await loadArtifactRegistry(cwd)).toEqual(artifactBefore);
    expect(await loadCompletionRegistry(cwd)).toEqual(completionBefore);
    expect(db.getRun('run-adopted-root')).toMatchObject({ planSet: 'adopted-root', sessionId: 'session-adoption', status: 'completed' });
    const projectedQueue = loadQueueItemsForCwdSync(cwd, queueDir);
    expect(projectedQueue.find((item) => item.id === 'adopted-root')).toBeUndefined();
    expect(projectedQueue.find((item) => item.id === 'dependent-child')).toMatchObject({ id: 'dependent-child', status: 'pending' });

    const scheduler = makeScheduler([makeQueuedPrd('dependent-child', ['adopted-root'], join(cwd, queueDir, 'dependent-child.md'))]);
    await scheduler.start();
    await waitForSpawnCallCount(spawnPrdChild, 1);
    expect(spawnPrdChild.mock.calls.map(([prd]) => prd.id)).toEqual(['dependent-child']);
    db.close();
  });

  it('does not wake adoption when persisted completions are already behind a clean shutdown', async () => {
    const cwd = makeTempDir();
    const db = openTempDb(cwd);
    const wakeReasons: string[] = [];
    const autoBuildController = {
      notifyQueueMutation(reason: string) {
        wakeReasons.push(reason);
      },
    };

    writeDaemonEvent(db, { type: 'queue:prd:complete', prdId: 'already-handled', status: 'completed' }, 'daemon-test');
    writeDaemonEvent(db, { type: 'daemon:lifecycle:shutdown:complete' }, 'daemon-test');
    const startupCursor = db.getMaxDaemonEventId();

    const replayed = await replayPersistedOrphanQueueCompletions(db, autoBuildController as never, startupCursor);

    expect(replayed).toBe(0);
    expect(wakeReasons).toEqual([]);
    db.close();
  });
});
