/**
 * Daemon-owned stack sync service.
 *
 * Provides a serialized, persisted, and event-emitting entry point for stack
 * sync operations. All wet mutations go through this service - no external
 * code invokes performStackSync() directly against the project root from the
 * daemon request handler.
 *
 * Wet mutex: a module-level in-progress flag ensures concurrent wet stack sync
 * requests are rejected with a 409-style deferred outcome rather than running
 * provider commands concurrently. Dry-runs bypass the mutex.
 *
 * After each sync the status is persisted to `.eforge/stacks/sync-status.json`
 * so the status route can serve durable state after a daemon restart.
 */

// --- eforge:region plan-01-core-daemon-stack-sync ---

import { randomBytes } from 'node:crypto';
import type { MonitorDB } from './db.js';
import type { EforgeConfig } from '@eforge-build/engine/config';
import type { StackSyncRequest, StackSyncResponse } from '@eforge-build/client';
import { isPersistedDaemonEventType } from '@eforge-build/client';
import { redactProviderMessage } from '@eforge-build/engine/stacking/git-spice';
import {
  setCurrentSyncStatus,
  completeCurrentSyncStatus,
  loadStackSyncStatus,
  loadStackSyncStatusSync,
  type StackSyncStatus,
  type StackSyncStatusFile,
} from '@eforge-build/engine/stacking/sync-state';

// ---------------------------------------------------------------------------
// Wet sync mutex — one wet sync at a time per daemon process
// ---------------------------------------------------------------------------

let wetSyncInProgress = false;

/**
 * Returns true when a wet stack sync is already in progress. Callers that
 * receive true should return a 'deferred' response immediately without
 * attempting to run provider commands.
 */
export function isWetSyncInProgress(): boolean {
  return wetSyncInProgress;
}

// ---------------------------------------------------------------------------
// Event emission helper
// ---------------------------------------------------------------------------

/**
 * Write a daemon-scoped stack sync lifecycle event to the DB.
 * Best-effort: DB errors are swallowed to avoid crashing on event write failure.
 */
function writeSyncEvent(
  db: MonitorDB,
  event: { type: string } & Record<string, unknown>,
  daemonSessionId: string,
): void {
  try {
    if (!isPersistedDaemonEventType(event.type)) return;
    const now = new Date().toISOString();
    db.insertDaemonEvent({
      type: event.type,
      data: JSON.stringify({ sessionId: daemonSessionId, ...event, timestamp: now }),
      timestamp: now,
    });
  } catch {
    // Best-effort
  }
}

// ---------------------------------------------------------------------------
// Main service entry point
// ---------------------------------------------------------------------------

/**
 * Options for running a daemon-owned stack sync.
 */
export interface StackSyncServiceOptions {
  db: MonitorDB;
  config: EforgeConfig;
  cwd: string;
  request: StackSyncRequest;
  /**
   * Daemon session ID used for event correlation. When omitted a transient
   * ID is generated for the sync so events are still persisted correctly.
   */
  daemonSessionId?: string;
}

/**
 * Run a stack sync operation through the daemon service.
 *
 * Responsibilities:
 *   1. Reject concurrent wet syncs (return deferred immediately without mutex).
 *   2. Collect active-build exclusions from running DB runs.
 *   3. Acquire wet mutex for non-dry-run syncs.
 *   4. Generate a stable syncId and record started status.
 *   5. Emit stack:sync:start event.
 *   6. Invoke performStackSync() from options.cwd.
 *   7. Persist completed status, emit terminal event.
 *   8. Release mutex and return the response.
 *
 * Always runs from `cwd` (the daemon's project root), never from a caller-
 * supplied arbitrary directory.
 */
export async function runStackSync(opts: StackSyncServiceOptions): Promise<StackSyncResponse> {
  const { db, config, cwd, request } = opts;
  const daemonSessionId = opts.daemonSessionId ?? `sync-session-${randomBytes(4).toString('hex')}`;
  const dryRun = request.dryRun === true;
  const trigger = request.trigger ?? 'manual';
  const activeBuildPolicy = request.activeBuildPolicy ?? 'skip';

  // --- Collect active-build exclusions ---
  const runningRuns = db.getRunningRuns();
  const { computeWorktreeBase } = await import('@eforge-build/engine/worktree-ops');
  const activeBuildSkips: Array<{ branch: string; worktree?: string; reason: string }> = [];
  const excludedBranchPrefixes: string[] = [];

  for (const run of runningRuns) {
    const branchPrefix = `eforge/${run.planSet}`;
    const worktreeBase = computeWorktreeBase(cwd, run.planSet);
    activeBuildSkips.push({
      branch: branchPrefix,
      worktree: run.cwd,
      reason: `Active build: run ${run.id} (planSet: ${run.planSet}, cwd: ${run.cwd})`,
    });
    if (worktreeBase !== run.cwd) {
      activeBuildSkips.push({
        branch: branchPrefix,
        worktree: worktreeBase,
        reason: `Active build worktree base: run ${run.id} (planSet: ${run.planSet})`,
      });
    }
    if (!excludedBranchPrefixes.includes(branchPrefix)) {
      excludedBranchPrefixes.push(branchPrefix);
    }
  }

  // --- Wet mutex check ---
  // Concurrent wet syncs: return deferred immediately without running commands.
  if (!dryRun && wetSyncInProgress) {
    const syncId = `sync-${randomBytes(6).toString('hex')}`;
    const startedAt = new Date().toISOString();
    const deferredReason = 'stack sync deferred: another wet sync is already in progress';

    writeSyncEvent(db, {
      type: 'stack:sync:deferred',
      syncId,
      trigger,
      reason: deferredReason,
      excludedCandidates: [],
    }, daemonSessionId);

    return {
      outcome: 'deferred',
      reason: deferredReason,
      stackingActive: true,
      dryRun: false,
      restackCandidates: [],
      activeBuildSkips,
      providerCommands: [],
      syncId,
      trigger,
      activeBuildPolicy,
      startedAt,
      completedAt: new Date().toISOString(),
    };
  }

  // --- Acquire wet mutex immediately (synchronous, before any await) ---
  // This must happen before any await so that two concurrent wet requests
  // cannot both pass the wetSyncInProgress check above.
  if (!dryRun) {
    wetSyncInProgress = true;
  }

  // --- Generate sync ID and record started status ---
  const syncId = `sync-${randomBytes(6).toString('hex')}`;
  const startedAt = new Date().toISOString();

  // In-progress status: outcome is intentionally absent (no completed outcome yet).
  const startedStatus: StackSyncStatus = {
    id: syncId,
    trigger,
    activeBuildPolicy: activeBuildPolicy !== 'skip' ? activeBuildPolicy : undefined,
    startedAt,
    dryRun,
    restackCandidates: [],
  };

  // Wrap all wet-sync bookkeeping in a try/finally so the mutex is held through
  // terminal status persistence and event emission, then released in one place.
  try {
    // Persist current status (best-effort — sync may still succeed if disk write fails)
    if (!dryRun) {
      try {
        await setCurrentSyncStatus(cwd, startedStatus);
      } catch {
        // Non-fatal: sync proceeds even if persistence fails
      }
    }

    // Emit start event
    writeSyncEvent(db, {
      type: 'stack:sync:start',
      syncId,
      trigger,
      dryRun,
    }, daemonSessionId);

    let report: Awaited<ReturnType<typeof import('@eforge-build/engine/stacking/sync').performStackSync>>;

    try {
      const { performStackSync } = await import('@eforge-build/engine/stacking/sync');
      report = await performStackSync(config, {
        cwd,
        dryRun,
        excludedBranchPrefixes,
        trigger,
        activeBuildPolicy,
      });
    } catch (err) {
      // Unexpected error (not a provider failure — those are caught inside performStackSync)
      const rawErrorMsg = err instanceof Error ? err.message : String(err);
      const errorMsg = redactProviderMessage(rawErrorMsg);
      const completedAt = new Date().toISOString();

      const failedStatus: StackSyncStatus = {
        ...startedStatus,
        completedAt,
        outcome: 'failed',
        reason: `Unexpected sync error: ${errorMsg}`,
        error: errorMsg,
      };

      if (!dryRun) {
        try {
          await completeCurrentSyncStatus(cwd, failedStatus);
        } catch {
          // Non-fatal
        }
      }

      writeSyncEvent(db, {
        type: 'stack:sync:failed',
        syncId,
        trigger,
        dryRun,
        outcome: 'failed' as const,
        reason: `Unexpected sync error: ${errorMsg}`,
        error: errorMsg,
      }, daemonSessionId);

      return {
        outcome: 'failed',
        reason: `Unexpected sync error: ${errorMsg}`,
        stackingActive: true,
        dryRun,
        restackCandidates: [],
        activeBuildSkips,
        providerCommands: [],
        error: errorMsg,
        syncId,
        trigger,
        activeBuildPolicy,
        startedAt,
        completedAt,
      };
    }

    // --- Process report ---
    const completedAt = new Date().toISOString();
    const { excludedCandidates, ...reportForResponse } = report;

    // Filter activeBuildSkips to only include those whose branches actually
    // matched stack candidates that were excluded.
    const filteredActiveBuildSkips = activeBuildSkips.filter((skip) =>
      excludedCandidates.some(
        (candidate) => candidate === skip.branch || candidate.startsWith(`${skip.branch}/`),
      ),
    );

    // Persist terminal status
    if (!dryRun) {
      const terminalStatus: StackSyncStatus = {
        id: syncId,
        trigger,
        activeBuildPolicy: activeBuildPolicy !== 'skip' ? activeBuildPolicy : undefined,
        startedAt,
        completedAt,
        outcome: report.outcome,
        reason: report.reason,
        error: report.error,
        dryRun: false,
        localTrunkSha: report.localTrunkSha,
        originTrunkSha: report.originTrunkSha,
        fastForward: report.fastForward,
        restackCandidates: report.restackCandidates,
        activeBuildSkips: filteredActiveBuildSkips,
        providerCommands: report.providerCommands,
      };
      try {
        await completeCurrentSyncStatus(cwd, terminalStatus);
      } catch {
        // Non-fatal
      }
    }

    // Emit terminal lifecycle event
    if (report.outcome === 'complete') {
      writeSyncEvent(db, {
        type: 'stack:sync:complete',
        syncId,
        trigger,
        dryRun,
        restackCandidates: report.restackCandidates,
        excludedCandidates,
        ...(report.localTrunkSha !== undefined && { localTrunkSha: report.localTrunkSha }),
        ...(report.originTrunkSha !== undefined && { originTrunkSha: report.originTrunkSha }),
        ...(report.fastForward !== undefined && { fastForward: report.fastForward }),
        ...(report.reason !== undefined && { reason: report.reason }),
      }, daemonSessionId);
    } else if (report.outcome === 'deferred') {
      writeSyncEvent(db, {
        type: 'stack:sync:deferred',
        syncId,
        trigger,
        reason: report.reason ?? 'stack sync deferred',
        excludedCandidates,
      }, daemonSessionId);
    } else if (report.outcome === 'skipped') {
      writeSyncEvent(db, {
        type: 'stack:sync:skipped',
        syncId,
        trigger,
        dryRun,
        reason: report.reason ?? 'stack sync skipped',
        restackCandidates: report.restackCandidates,
        excludedCandidates,
      }, daemonSessionId);
    } else {
      // failed or conflict
      writeSyncEvent(db, {
        type: 'stack:sync:failed',
        syncId,
        trigger,
        dryRun,
        outcome: report.outcome as 'failed' | 'conflict',
        reason: report.reason ?? `stack sync ${report.outcome}`,
        ...(report.error !== undefined && { error: report.error }),
      }, daemonSessionId);
    }

    return {
      ...reportForResponse,
      activeBuildSkips: filteredActiveBuildSkips,
      syncId,
      trigger,
      ...(activeBuildPolicy !== 'skip' && { activeBuildPolicy }),
      startedAt,
      completedAt,
    };
  } finally {
    // Release mutex after all terminal bookkeeping (status persistence + events)
    // has completed — whether the sync succeeded, failed, or threw unexpectedly.
    if (!dryRun) {
      wetSyncInProgress = false;
    }
  }
}

// ---------------------------------------------------------------------------
// Status load helper
// ---------------------------------------------------------------------------

/**
 * Load the current/last stack sync status from disk for the given cwd.
 * Returns an empty status file when no status has been written yet.
 */
export async function loadSyncStatusForRoute(cwd: string): Promise<StackSyncStatusFile> {
  try {
    return await loadStackSyncStatus(cwd);
  } catch {
    return { version: 1 };
  }
}

/**
 * Synchronously load the current/last stack sync status from disk.
 * Used in synchronous SSE stream:hello snapshot builders.
 * Returns an empty status file when no status has been written yet.
 */
export function loadSyncStatusForRouteSync(cwd: string): StackSyncStatusFile {
  try {
    return loadStackSyncStatusSync(cwd);
  } catch {
    return { version: 1 };
  }
}

// --- eforge:endregion plan-01-core-daemon-stack-sync ---
