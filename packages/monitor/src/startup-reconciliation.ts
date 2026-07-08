import { isPidAlive } from '@eforge-build/client';
import { finalizeQueuedPrd } from '@eforge-build/engine/queue/finalizer';
import { basename, relative, resolve, sep } from 'node:path';
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, statSync, unlinkSync } from 'node:fs';

import type { MonitorDB } from './db.js';
import type { DaemonState } from './server.js';
import { writeDaemonEvent } from './daemon-events.js';
import { buildAndPersistRunUpsert } from './recorder.js';

export interface ReconciliationReport {
  runsFailed: Array<{ runId: string; sessionId: string; planSet: string; reason: string }>;
  locksRemoved: Array<{ path: string; pid?: number; reason: 'dead-pid' | 'corrupt-payload' | 'unsafe-path' }>;
  locksAdopted: Array<{ path: string; pid: number; prdId: string }>;
  durationMs: number;
}

/** Reconcile dead runs and queue locks on daemon startup; emits no events directly. */
export async function reconcileOrphanedState(db: MonitorDB, cwd: string, options?: { queueDir?: string }): Promise<ReconciliationReport> {
  const startedAt = Date.now();
  const runsFailed: ReconciliationReport['runsFailed'] = [];
  const locksRemoved: ReconciliationReport['locksRemoved'] = [];
  const locksAdopted: ReconciliationReport['locksAdopted'] = [];

  try {
    const runningRuns = db.getRunningRuns();
    const now = new Date().toISOString();
    for (const run of runningRuns) {
      const queueContext = runningRunQueueContext(cwd, run, options?.queueDir ?? '.eforge/queue');
      const queueLockProblem = queueContext.queued ? runningRunQueueLockProblem(cwd, run, queueContext) : undefined;
      if (queueContext.queued && ((run.pid && !isPidAlive(run.pid)) || queueLockProblem !== undefined)) {
        const reason = queueLockProblem ?? 'reconciled: process not alive at daemon startup';
        try {
          await finalizeQueuedPrd({ cwd, queueDir: options?.queueDir ?? '.eforge/queue', prdId: run.planSet, status: 'failed', releaseLock: true });
          db.updateRunStatus(run.id, 'failed', now);
          buildAndPersistRunUpsert(db, run.id, run.id);
          try {
            db.insertEvent({
              runId: run.id,
              type: 'phase:end',
              data: JSON.stringify({ type: 'phase:end', runId: run.id, result: { status: 'failed', summary: reason }, timestamp: now }),
              timestamp: now,
            });
          } catch { /* best-effort */ }
          runsFailed.push({ runId: run.id, sessionId: run.sessionId ?? run.id, planSet: run.planSet, reason });
        } catch { /* leave running so a later reconciliation can retry finalization */ }
      }
    }
  } catch { /* best-effort */ }

  const lockDir = resolve(cwd, '.eforge', 'queue-locks');
  let entries: string[];
  let realLockDir: string;
  try {
    if (lstatSync(lockDir).isSymbolicLink()) return report(startedAt, runsFailed, locksRemoved, locksAdopted);
    if (!statSync(lockDir).isDirectory()) return report(startedAt, runsFailed, locksRemoved, locksAdopted);
    realLockDir = realpathSync(lockDir);
    entries = readdirSync(lockDir);
  } catch {
    return report(startedAt, runsFailed, locksRemoved, locksAdopted);
  }

  for (const file of entries) {
    if (!isSafeQueueLockBasename(file)) continue;
    const lockPath = resolve(lockDir, file);
    if (!safeRegularLockFile(lockPath, realLockDir)) {
      locksRemoved.push({ path: lockPath, reason: 'unsafe-path' });
      continue;
    }
    let rawPayload: string;
    try { rawPayload = readFileSync(lockPath, 'utf-8').trim(); } catch { rawPayload = ''; }
    const pid = parseInt(rawPayload, 10);
    if (!/^[0-9]+$/.test(rawPayload) || !Number.isFinite(pid) || pid <= 0) {
      try { unlinkSync(lockPath); locksRemoved.push({ path: lockPath, reason: 'corrupt-payload' }); } catch { /* ignore */ }
      continue;
    }
    if (!isPidAlive(pid)) {
      try { unlinkSync(lockPath); locksRemoved.push({ path: lockPath, pid, reason: 'dead-pid' }); } catch { /* ignore */ }
    } else {
      locksAdopted.push({ path: lockPath, pid, prdId: basename(file, '.lock') });
    }
  }

  return report(startedAt, runsFailed, locksRemoved, locksAdopted);
}

export async function replayPersistedOrphanQueueCompletions(
  db: MonitorDB,
  autoBuildController: DaemonState['autoBuildController'],
  beforeStartupCursor: number,
  options?: { cwd: string; queueDir: string; daemonSessionId?: string },
): Promise<number> {
  let rows: ReturnType<MonitorDB['getDaemonEventsAfter']>;
  try { rows = db.getDaemonEventsAfter(0).filter((row) => row.id <= beforeStartupCursor); } catch { return 0; }
  const lastCleanShutdownId = [...rows].reverse().find((row) => row.type === 'daemon:lifecycle:shutdown:complete')?.id ?? 0;
  const orphanCompletions = rows.filter((row) => row.id > lastCleanShutdownId && row.type === 'queue:prd:complete');
  let successfulReplays = 0;
  const replayFailures: string[] = [];
  if (options !== undefined) {
    for (const row of orphanCompletions) {
      const completion = parsePersistedQueueCompletion(row.data);
      if (completion === undefined) continue;
      try {
        await finalizeQueuedPrd({ cwd: options.cwd, queueDir: options.queueDir, prdId: completion.prdId, status: completion.status, releaseLock: true });
        successfulReplays++;
      } catch (err) {
        replayFailures.push(`${completion.prdId}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    if (replayFailures.length > 0 && options.daemonSessionId !== undefined) {
      writeDaemonEvent(db, {
        type: 'daemon:warning',
        source: 'startup-reconciliation',
        message: `Startup queue completion replay failed for ${replayFailures.length} item(s): ${replayFailures.join('; ')}`,
      }, options.daemonSessionId);
    }
  }
  const shouldWake = options === undefined ? orphanCompletions.length > 0 : successfulReplays > 0;
  if (shouldWake) autoBuildController.notifyQueueMutation('external');
  return orphanCompletions.length;
}

interface RunningQueueContext {
  queued: boolean;
  queueExecRun: boolean;
  queuePrdExists: boolean;
  lockExists: boolean;
  lockPath: string;
}

function runningRunQueueContext(cwd: string, run: ReturnType<MonitorDB['getRunningRuns']>[number], queueDir: string): RunningQueueContext {
  const queueExecRun = /\bqueue\s+exec\b/.test(run.command);
  const lockPath = resolve(cwd, '.eforge', 'queue-locks', `${run.planSet}.lock`);
  const queuePrdExists = isSafeQueuedPrdId(run.planSet) && hasQueuePrdContext(cwd, queueDir, run.planSet);
  const lockExists = isSafeQueuedPrdId(run.planSet) && existsSync(lockPath);
  return { queued: queueExecRun || queuePrdExists || lockExists, queueExecRun, queuePrdExists, lockExists, lockPath };
}

function runningRunQueueLockProblem(cwd: string, run: ReturnType<MonitorDB['getRunningRuns']>[number], context: RunningQueueContext): string | undefined {
  if (!isSafeQueuedPrdId(run.planSet)) return context.queueExecRun ? 'reconciled: running queued build has unsafe PRD id at daemon startup' : undefined;
  const lockDir = resolve(cwd, '.eforge', 'queue-locks');
  let realLockDir: string;
  try { realLockDir = realpathSync(lockDir); } catch { realLockDir = lockDir; }
  const lockPath = context.lockPath;
  const lockExists = context.lockExists;
  if (!lockExists) return 'reconciled: running queued build has no queue lock at daemon startup';
  if (!safeRegularLockFile(lockPath, realLockDir)) return 'reconciled: running queued build has unsafe queue lock at daemon startup';
  let rawPayload: string;
  try { rawPayload = readFileSync(lockPath, 'utf-8').trim(); } catch { return 'reconciled: running queued build has no queue lock at daemon startup'; }
  const pid = parseInt(rawPayload, 10);
  if (!/^[0-9]+$/.test(rawPayload) || !Number.isFinite(pid) || pid <= 0) return 'reconciled: running queued build has corrupt queue lock at daemon startup';
  if (!isPidAlive(pid)) return 'reconciled: running queued build queue lock PID is not alive at daemon startup';
  if (run.pid !== undefined && run.pid !== null && run.pid !== pid) return 'reconciled: running queued build queue lock PID does not match run PID at daemon startup';
  return undefined;
}

function isSafeQueueLockBasename(file: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*\.lock$/.test(file) && file !== '.lock' && file !== '..lock';
}

function safeRegularLockFile(lockPath: string, realLockDir: string): boolean {
  try {
    const linkStat = lstatSync(lockPath);
    if (!linkStat.isFile() || linkStat.isSymbolicLink()) return false;
    const realLockPath = realpathSync(lockPath);
    const rel = relative(realLockDir, realLockPath);
    return rel !== '' && !rel.startsWith('..') && !rel.includes(`..${sep}`);
  } catch {
    return false;
  }
}

function parsePersistedQueueCompletion(data: string): { prdId: string; status: 'completed' | 'failed' | 'skipped' } | undefined {
  try {
    const parsed = JSON.parse(data) as { prdId?: unknown; status?: unknown };
    if (typeof parsed.prdId !== 'string' || !isSafeQueuedPrdId(parsed.prdId)) return undefined;
    if (parsed.status !== 'completed' && parsed.status !== 'failed' && parsed.status !== 'skipped') return undefined;
    return { prdId: parsed.prdId, status: parsed.status };
  } catch {
    return undefined;
  }
}

function isSafeQueuedPrdId(prdId: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(prdId) && prdId !== '.' && prdId !== '..';
}

function hasQueuePrdContext(cwd: string, queueDir: string, prdId: string): boolean {
  return [
    resolve(cwd, queueDir, `${prdId}.md`),
    resolve(cwd, queueDir, 'waiting', `${prdId}.md`),
    resolve(cwd, queueDir, 'failed', `${prdId}.md`),
    resolve(cwd, queueDir, 'skipped', `${prdId}.md`),
  ].some((path) => existsSync(path));
}

function report(
  startedAt: number,
  runsFailed: ReconciliationReport['runsFailed'],
  locksRemoved: ReconciliationReport['locksRemoved'],
  locksAdopted: ReconciliationReport['locksAdopted'],
): ReconciliationReport {
  return { runsFailed, locksRemoved, locksAdopted, durationMs: Date.now() - startedAt };
}
