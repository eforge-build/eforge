/**
 * Tests for the refactored reconcileOrphanedState (structured-report contract)
 * and the caller's daemon:recovery:* emission sequence.
 *
 * Follows AGENTS.md conventions:
 * - No mocks. Real SQLite DB via openDatabase. Real filesystem for lock dirs.
 * - Constructs synthetic input rows inline (no fixtures).
 */

import { describe, it, expect } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../db.js';
import { reconcileOrphanedState, writeDaemonEvent, type ReconciliationReport } from '../server-main.js';

// A PID that is guaranteed to be dead (no process ever runs with this id in tests).
const DEAD_PID = 999999;

function makeTmpCwd(): string {
  const dir = mkdtempSync(join(tmpdir(), 'eforge-recovery-emit-'));
  mkdirSync(join(dir, '.eforge'), { recursive: true });
  return dir;
}

// ---------------------------------------------------------------------------
// 1. Structured-report shape
// ---------------------------------------------------------------------------

describe('reconcileOrphanedState returns structured report', () => {
  it('returns the correct shape with runsFailed, locksRemoved, durationMs', async () => {
    const cwd = makeTmpCwd();
    const db = openDatabase(join(cwd, '.eforge', 'monitor.db'));

    // Insert a run whose PID is dead
    db.insertRun({
      id: 'run-dead',
      sessionId: 'sess-dead',
      planSet: 'test-set',
      command: 'eforge queue exec test-set',
      status: 'running',
      startedAt: new Date().toISOString(),
      cwd,
      pid: DEAD_PID,
    });

    // Create a stale lock file
    const lockDir = join(cwd, '.eforge', 'queue-locks');
    mkdirSync(lockDir, { recursive: true });
    const lockPath = join(lockDir, 'prd-stale.lock');
    writeFileSync(lockPath, String(DEAD_PID));

    const report = await reconcileOrphanedState(db, cwd);

    // runsFailed shape
    expect(Array.isArray(report.runsFailed)).toBe(true);
    expect(report.runsFailed).toHaveLength(1);
    expect(report.runsFailed[0]).toMatchObject({
      runId: 'run-dead',
      sessionId: 'sess-dead',
      planSet: 'test-set',
      reason: expect.stringContaining('reconciled'),
    });

    // locksRemoved shape
    expect(Array.isArray(report.locksRemoved)).toBe(true);
    expect(report.locksRemoved).toHaveLength(1);
    expect(report.locksRemoved[0]).toMatchObject({
      path: lockPath,
      pid: DEAD_PID,
    });

    // durationMs is a non-negative number
    expect(typeof report.durationMs).toBe('number');
    expect(report.durationMs).toBeGreaterThanOrEqual(0);

    const runUpserts = db.getDaemonEventsAfter(0).filter((e) => e.type === 'daemon:run:upsert');
    expect(runUpserts).toHaveLength(1);
    const payload = JSON.parse(runUpserts[0].data) as { run: { id: string; status: string; completedAt?: string } };
    expect(payload.run).toMatchObject({ id: 'run-dead', status: 'failed' });
    expect(payload.run.completedAt).toBeDefined();

    db.close();
  });

  it('returns empty arrays when nothing needs reconciling', async () => {
    const cwd = makeTmpCwd();
    const db = openDatabase(join(cwd, '.eforge', 'monitor.db'));

    // Insert a run whose PID is the current process (alive)
    db.insertRun({
      id: 'run-alive',
      planSet: 'test-set',
      command: 'build',
      status: 'running',
      startedAt: new Date().toISOString(),
      cwd,
      pid: process.pid,
    });

    const report = await reconcileOrphanedState(db, cwd);

    expect(report.runsFailed).toHaveLength(0);
    expect(report.locksRemoved).toHaveLength(0);
    expect(typeof report.durationMs).toBe('number');

    db.close();
  });

  it('emits no daemon:recovery:* events itself (emission is the caller\'s responsibility)', async () => {
    const cwd = makeTmpCwd();
    const db = openDatabase(join(cwd, '.eforge', 'monitor.db'));

    // Insert a dead run to ensure reconciliation actually does something
    db.insertRun({
      id: 'run-dead-2',
      planSet: 'test-set',
      command: 'eforge queue exec test-set',
      status: 'running',
      startedAt: new Date().toISOString(),
      cwd,
      pid: DEAD_PID,
    });

    await reconcileOrphanedState(db, cwd);

    // No daemon:recovery:* events should exist in DB (only phase:end inserted by reconciler)
    const allEvents = db.getDaemonEventsAfter(0);
    const recoveryEvents = allEvents.filter((e) =>
      e.type.startsWith('daemon:recovery:'),
    );
    expect(recoveryEvents).toHaveLength(0);

    db.close();
  });

  it('tolerates missing queue-locks directory and returns empty locksRemoved', async () => {
    const cwd = makeTmpCwd();
    const db = openDatabase(join(cwd, '.eforge', 'monitor.db'));

    // No lock dir created
    const report = await reconcileOrphanedState(db, cwd);

    expect(report.locksRemoved).toHaveLength(0);
    expect(typeof report.durationMs).toBe('number');

    db.close();
  });
});

// ---------------------------------------------------------------------------
// 2. Caller emission sequence and counts
// ---------------------------------------------------------------------------

describe('caller emission sequence', () => {
  it('emits daemon:recovery:start, per-item events, daemon:recovery:complete in correct sequence', async () => {
    const cwd = makeTmpCwd();
    const db = openDatabase(join(cwd, '.eforge', 'monitor.db'));

    // Insert two dead runs
    db.insertRun({
      id: 'run-dead-a',
      sessionId: 'sess-a',
      planSet: 'set-a',
      command: 'eforge queue exec set-a',
      status: 'running',
      startedAt: new Date().toISOString(),
      cwd,
      pid: DEAD_PID,
    });
    db.insertRun({
      id: 'run-dead-b',
      sessionId: 'sess-b',
      planSet: 'set-b',
      command: 'eforge queue exec set-b',
      status: 'running',
      startedAt: new Date().toISOString(),
      cwd,
      pid: DEAD_PID,
    });

    // Create two stale lock files and one live lock that should be adopted.
    const lockDir = join(cwd, '.eforge', 'queue-locks');
    mkdirSync(lockDir, { recursive: true });
    const lockPath1 = join(lockDir, 'prd-a.lock');
    const lockPath2 = join(lockDir, 'prd-b.lock');
    const liveLockPath = join(lockDir, 'prd-live.lock');
    writeFileSync(lockPath1, String(DEAD_PID));
    writeFileSync(lockPath2, String(DEAD_PID));
    writeFileSync(liveLockPath, String(process.pid));

    const daemonSessionId = `daemon-test-${Date.now()}`;

    // Simulate what main() does: reconcile, then emit the sequence
    const report: ReconciliationReport = await reconcileOrphanedState(db, cwd);

    writeDaemonEvent(db, { type: 'daemon:recovery:start' }, daemonSessionId);
    for (const run of report.runsFailed) {
      writeDaemonEvent(db, {
        type: 'daemon:recovery:run-marked-failed',
        runId: run.runId,
        planSet: run.planSet,
        reason: run.reason,
      }, daemonSessionId);
    }
    for (const lock of report.locksRemoved) {
      writeDaemonEvent(db, {
        type: 'daemon:recovery:lock-removed',
        path: lock.path,
        pid: lock.pid,
      }, daemonSessionId);
    }
    for (const lock of report.locksAdopted) {
      writeDaemonEvent(db, {
        type: 'daemon:recovery:lock-adopted',
        path: lock.path,
        pid: lock.pid,
        prdId: lock.prdId,
      }, daemonSessionId);
    }
    writeDaemonEvent(db, {
      type: 'daemon:recovery:complete',
      runsFailed: report.runsFailed.length,
      locksRemoved: report.locksRemoved.length,
      durationMs: report.durationMs,
    }, daemonSessionId);

    // Assert the DB contains the correct daemon:recovery:* events
    const daemonEvents = db.getDaemonEventsAfter(0).filter((e) =>
      e.type.startsWith('daemon:recovery:'),
    );

    // Should have: 1 start + 2 run-marked-failed + 2 lock-removed + 1 lock-adopted + 1 complete = 7
    expect(daemonEvents).toHaveLength(7);
    expect(daemonEvents[0].type).toBe('daemon:recovery:start');
    expect(daemonEvents[daemonEvents.length - 1].type).toBe('daemon:recovery:complete');

    // Middle events are run-marked-failed and lock-removed (order follows insertion order)
    const markedFailed = daemonEvents.filter((e) => e.type === 'daemon:recovery:run-marked-failed');
    const locksRemoved = daemonEvents.filter((e) => e.type === 'daemon:recovery:lock-removed');
    const locksAdopted = daemonEvents.filter((e) => e.type === 'daemon:recovery:lock-adopted');
    expect(markedFailed).toHaveLength(2);
    expect(locksRemoved).toHaveLength(2);
    expect(locksAdopted).toHaveLength(1);
    expect(locksAdopted[0].origin).toBe('daemon');
    expect(JSON.parse(locksAdopted[0].data)).toMatchObject({ path: liveLockPath, pid: process.pid, prdId: 'prd-live', sessionId: daemonSessionId });

    // Validate complete event payload
    const completeEvent = daemonEvents[daemonEvents.length - 1];
    const completePayload = JSON.parse(completeEvent.data) as { runsFailed: number; locksRemoved: number; durationMs: number };
    expect(completePayload.runsFailed).toBe(2);
    expect(completePayload.locksRemoved).toBe(2);
    expect(typeof completePayload.durationMs).toBe('number');

    // All events are daemon-owned (runId=null, origin='daemon').
    // The daemonSessionId is embedded in the JSON payload for correlation,
    // but is no longer stored as run_id in the DB row.
    for (const event of daemonEvents) {
      expect(event.runId).toBeNull();
      expect(event.origin).toBe('daemon');
      // Verify the daemonSessionId is preserved in the JSON payload
      const payload = JSON.parse(event.data) as { sessionId?: string };
      expect(payload.sessionId).toBe(daemonSessionId);
    }

    db.close();
  });

  it('writeDaemonEvent inserts events with correct type, runId, and JSON data', () => {
    const cwd = makeTmpCwd();
    const db = openDatabase(join(cwd, '.eforge', 'monitor.db'));

    const daemonSessionId = `daemon-test-write-${Date.now()}`;

    writeDaemonEvent(db, {
      type: 'daemon:lifecycle:starting',
      pid: 12345,
      port: 4567,
      version: '1.0.0',
      mode: 'persistent',
    }, daemonSessionId);

    const events = db.getDaemonEventsAfter(0);
    const lifecycleEvent = events.find((e) => e.type === 'daemon:lifecycle:starting');
    expect(lifecycleEvent).toBeDefined();
    // writeDaemonEvent now stores rows as daemon-owned (runId=null, origin='daemon')
    expect(lifecycleEvent!.runId).toBeNull();
    expect(lifecycleEvent!.origin).toBe('daemon');

    const payload = JSON.parse(lifecycleEvent!.data) as {
      type: string;
      pid: number;
      port: number;
      version: string;
      mode: string;
      sessionId: string;
    };
    expect(payload.type).toBe('daemon:lifecycle:starting');
    expect(payload.pid).toBe(12345);
    expect(payload.port).toBe(4567);
    // daemonSessionId is embedded in the JSON payload for correlation
    expect(payload.sessionId).toBe(daemonSessionId);

    db.close();
  });
});
