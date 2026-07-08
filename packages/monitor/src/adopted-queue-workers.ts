import { isPidAlive } from '@eforge-build/client';
import { readPrdLockStatus } from '@eforge-build/engine/prd-queue';
import { consumeQueuePrdCancellation } from '@eforge-build/engine/queue/cancellation';
import { finalizeQueuedPrd, type QueueFinalizerStatus } from '@eforge-build/engine/queue/finalizer';

import type { MonitorDB } from './db.js';
import type { AutoBuildController } from './auto-build-supervisor.js';
import { findLatestPersistedQueueCompletion } from './startup-reconciliation.js';

export interface AdoptedQueueLock {
  path: string;
  pid: number;
  prdId: string;
}

export interface AdoptedQueueWorkerMonitorOptions {
  db: MonitorDB;
  cwd: string;
  queueDir: string;
  locks: AdoptedQueueLock[];
  autoBuildController: Pick<AutoBuildController, 'notifyQueueMutation'>;
  baseBranch?: string;
  afterCursor?: number;
  pollIntervalMs?: number;
}

export interface AdoptedQueueWorkerMonitor {
  stop(): void;
  pendingCount(): number;
}

const DEFAULT_POLL_INTERVAL_MS = 1000;

export function startAdoptedQueueWorkerMonitor(options: AdoptedQueueWorkerMonitorOptions): AdoptedQueueWorkerMonitor {
  const pending = new Map<string, AdoptedQueueLock>();
  for (const lock of options.locks) pending.set(lock.prdId, lock);
  let stopped = false;
  let pollInProgress = false;

  const timer = setInterval(() => {
    void poll();
  }, options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS);
  timer.unref?.();

  async function poll(): Promise<void> {
    if (stopped || pollInProgress || pending.size === 0) return;
    pollInProgress = true;
    try {
      for (const lock of [...pending.values()]) {
        if (isPidAlive(lock.pid)) continue;
        const finalized = await tryFinalizeLock(options, lock);
        if (finalized) pending.delete(lock.prdId);
      }
    } finally {
      pollInProgress = false;
    }
  }

  void poll();

  return {
    stop() {
      stopped = true;
      clearInterval(timer);
    },
    pendingCount() {
      return pending.size;
    },
  };
}

async function tryFinalizeLock(options: AdoptedQueueWorkerMonitorOptions, lock: AdoptedQueueLock): Promise<boolean> {
  try {
    const currentLock = await readPrdLockStatus(lock.prdId, options.cwd);
    if (currentLock.state === 'live' && currentLock.pid === lock.pid) return false;
    if (currentLock.state !== 'stale') return true;
    if (currentLock.pid !== lock.pid) return true;

    const status = await determineFinalStatus(options, lock);
    await finalizeQueuedPrd({ cwd: options.cwd, queueDir: options.queueDir, prdId: lock.prdId, status, releaseLock: true, ...(options.baseBranch !== undefined ? { baseBranch: options.baseBranch } : {}) });
    options.autoBuildController.notifyQueueMutation('external');
    return true;
  } catch {
    return false;
  }
}

async function determineFinalStatus(options: AdoptedQueueWorkerMonitorOptions, lock: AdoptedQueueLock): Promise<QueueFinalizerStatus> {
  const persisted = findLatestPersistedQueueCompletion(options.db, lock.prdId, options.afterCursor);
  if (persisted !== undefined) return persisted.status;

  const cancellation = await consumeQueuePrdCancellation({
    cwd: options.cwd,
    prdId: lock.prdId,
    expectedPid: lock.pid,
  });
  return cancellation === null ? 'failed' : 'skipped';
}
