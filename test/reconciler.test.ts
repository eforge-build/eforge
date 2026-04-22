/**
 * Tests for the daemon startup reconciler — the sole cleanup path for
 * orphaned queue state (runs in DB whose PIDs are dead, lock files whose
 * PIDs are dead). Verifies that a crash or hard-kill leaves the daemon
 * self-healing on restart.
 */

import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '@eforge-build/monitor/db';
import { reconcileOrphanedState } from '@eforge-build/monitor/server-main';

function makeTmpCwd(): string {
  const dir = mkdtempSync(join(tmpdir(), 'eforge-reconciler-'));
  mkdirSync(join(dir, '.eforge'), { recursive: true });
  return dir;
}

const DEAD_PID = 999999;

describe('reconcileOrphanedState', () => {
  it('marks DB runs as failed when their PID is not alive', () => {
    const cwd = makeTmpCwd();
    const db = openDatabase(join(cwd, '.eforge', 'monitor.db'));

    db.insertRun({
      id: 'run-dead',
      planSet: 'test',
      command: 'build',
      status: 'running',
      startedAt: new Date().toISOString(),
      cwd,
      pid: DEAD_PID,
    });
    db.insertRun({
      id: 'run-alive',
      planSet: 'test',
      command: 'build',
      status: 'running',
      startedAt: new Date().toISOString(),
      cwd,
      pid: process.pid,
    });

    reconcileOrphanedState(db, cwd);

    const dead = db.getRun('run-dead');
    const alive = db.getRun('run-alive');
    expect(dead?.status).toBe('failed');
    expect(alive?.status).toBe('running');
    db.close();
  });

  it('inserts a phase:end event explaining why the run was reconciled', () => {
    const cwd = makeTmpCwd();
    const db = openDatabase(join(cwd, '.eforge', 'monitor.db'));

    db.insertRun({
      id: 'run-dead',
      planSet: 'test',
      command: 'build',
      status: 'running',
      startedAt: new Date().toISOString(),
      cwd,
      pid: DEAD_PID,
    });

    reconcileOrphanedState(db, cwd);

    const events = db.getEventsByType('run-dead', 'phase:end');
    expect(events.length).toBeGreaterThan(0);
    const parsed = JSON.parse(events[0].data) as { result: { status: string; summary: string } };
    expect(parsed.result.status).toBe('failed');
    expect(parsed.result.summary).toMatch(/reconciled/);
    db.close();
  });

  it('deletes lock files whose PID is not alive', () => {
    const cwd = makeTmpCwd();
    const db = openDatabase(join(cwd, '.eforge', 'monitor.db'));
    const lockDir = join(cwd, '.eforge', 'queue-locks');
    mkdirSync(lockDir, { recursive: true });

    const staleLock = join(lockDir, 'prd-stale.lock');
    const liveLock = join(lockDir, 'prd-live.lock');
    writeFileSync(staleLock, String(DEAD_PID));
    writeFileSync(liveLock, String(process.pid));

    reconcileOrphanedState(db, cwd);

    expect(existsSync(staleLock)).toBe(false);
    expect(existsSync(liveLock)).toBe(true);
    expect(readFileSync(liveLock, 'utf-8')).toBe(String(process.pid));
    db.close();
  });

  it('deletes lock files with corrupt content', () => {
    const cwd = makeTmpCwd();
    const db = openDatabase(join(cwd, '.eforge', 'monitor.db'));
    const lockDir = join(cwd, '.eforge', 'queue-locks');
    mkdirSync(lockDir, { recursive: true });

    const corruptLock = join(lockDir, 'prd-corrupt.lock');
    writeFileSync(corruptLock, 'not-a-pid');

    reconcileOrphanedState(db, cwd);

    expect(existsSync(corruptLock)).toBe(false);
    db.close();
  });

  it('tolerates a missing queue-locks directory', () => {
    const cwd = makeTmpCwd();
    const db = openDatabase(join(cwd, '.eforge', 'monitor.db'));

    // No queue-locks dir created — should not throw
    expect(() => reconcileOrphanedState(db, cwd)).not.toThrow();
    db.close();
  });

  it('leaves PRD files in queue/ root (does not move to queue/failed/)', () => {
    const cwd = makeTmpCwd();
    const db = openDatabase(join(cwd, '.eforge', 'monitor.db'));
    const queueDir = join(cwd, 'eforge', 'queue');
    mkdirSync(queueDir, { recursive: true });
    const prdPath = join(queueDir, 'prd-orphan.md');
    writeFileSync(prdPath, '---\ntitle: Orphan\n---\n\n# Orphan');

    const lockDir = join(cwd, '.eforge', 'queue-locks');
    mkdirSync(lockDir, { recursive: true });
    writeFileSync(join(lockDir, 'prd-orphan.lock'), String(DEAD_PID));

    reconcileOrphanedState(db, cwd);

    // PRD file stays in queue/ root so the next scheduling pass can re-claim it
    expect(existsSync(prdPath)).toBe(true);
    expect(existsSync(join(cwd, 'eforge', 'queue', 'failed', 'prd-orphan.md'))).toBe(false);
    db.close();
  });
});
