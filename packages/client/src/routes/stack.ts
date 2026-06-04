import type { StackLayerWire } from '../events.js';

/** Response for GET /api/stack/layers */
export interface StackLayersResponse {
  layers: StackLayerWire[];
}

/** A single provider command recorded in a POST /api/stack/sync response. */
export interface StackSyncProviderCommandWire {
  /** The resolved executable path. */
  command: string;
  /** The argv passed to the command (without the executable). */
  args: string[];
  /** True when the command was not executed (dry-run mode). */
  dryRun: boolean;
  /** True when the command was actually executed. Always false in dry-run mode. */
  ran: boolean;
  /** Captured stdout from the command (absent in dry-run). */
  stdout?: string;
  /** Captured stderr from the command (absent in dry-run). */
  stderr?: string;
  /** Exit code. Always 0 on success; absent in dry-run mode. */
  exitCode?: number;
}

/** An active-build skip entry in POST /api/stack/sync response. */
export interface StackSyncActiveBuildSkipWire {
  /** Branch prefix that was excluded (e.g. 'eforge/my-plan-set'). */
  branch: string;
  /** Worktree path associated with the active build, when available. */
  worktree?: string;
  /** Human-readable reason for the exclusion. */
  reason: string;
}

/** Outcome of a POST /api/stack/sync operation. */
export type StackSyncOutcomeWire = 'skipped' | 'complete' | 'failed' | 'conflict' | 'deferred';

/** Request body for POST /api/stack/sync */
export interface StackSyncRequest {
  /**
   * When true, determine what commands would run but do not execute them.
   * Branch SHAs are left unchanged.
   */
  dryRun?: boolean;
  /** The trigger that initiated this sync (propagated to the durable status record). */
  trigger?: 'manual' | 'after-build' | 'scheduled' | 'retry-deferred';
  /**
   * How to handle active-build overlap in wet mode.
   * 'skip' (default) — return 'skipped' outcome when excluded candidates exist.
   * 'defer'          — return 'deferred' outcome instead; retry when builds complete.
   * Dry-runs always use 'skip' semantics.
   */
  activeBuildPolicy?: 'skip' | 'defer';
}

/** Durable stack sync status record as returned by the status route. */
export interface StackSyncStatusWire {
  /** Unique identifier for this sync operation. */
  id: string;
  /** Trigger that initiated the sync. */
  trigger?: 'manual' | 'after-build' | 'scheduled' | 'retry-deferred';
  /** Active-build policy used for this sync. */
  activeBuildPolicy?: 'skip' | 'defer';
  /** ISO timestamp when the sync started. */
  startedAt: string;
  /** ISO timestamp when the sync completed (absent for in-progress syncs). */
  completedAt?: string;
  /**
   * Overall outcome. Absent for in-progress (current) records that have not
   * yet completed. Always present on terminal (last) records.
   */
  outcome?: StackSyncOutcomeWire;
  /** Human-readable reason (present for non-complete outcomes). */
  reason?: string;
  /** Error message when outcome is 'failed' or 'conflict'. */
  error?: string;
  /** Whether the sync was a dry run. */
  dryRun: boolean;
  /** SHA of the local trunk branch, when available. */
  localTrunkSha?: string;
  /** SHA of origin/<trunk>, when available. */
  originTrunkSha?: string;
  /** Whether the local trunk was at or behind origin. */
  fastForward?: boolean;
  /** Artifact branches eligible for restack after exclusion filtering. */
  restackCandidates: string[];
  /** Branches and worktrees skipped because active builds are using them (present on terminal records). */
  activeBuildSkips?: StackSyncActiveBuildSkipWire[];
  /** Provider commands that were executed or would be executed in dry-run mode (present on terminal records). */
  providerCommands?: StackSyncProviderCommandWire[];
}

/** Response for GET /api/stack/sync/status */
export interface StackSyncStatusResponse {
  /** The most recently completed (terminal) sync status. Absent when no sync has completed. */
  last?: StackSyncStatusWire;
  /** The currently in-progress sync status. Absent when no sync is running. */
  current?: StackSyncStatusWire;
}

/** Response for POST /api/stack/sync */
export interface StackSyncResponse {
  /** Overall outcome. */
  outcome: StackSyncOutcomeWire;
  /** Human-readable reason (always present for 'skipped', 'failed', 'conflict', 'deferred'). */
  reason?: string;
  /** True when stacking is enabled and active (false for 'skipped' outcome). */
  stackingActive: boolean;
  /** Whether the sync was a dry run. */
  dryRun: boolean;
  /** SHA of the local trunk branch, when available. */
  localTrunkSha?: string;
  /** SHA of origin/<trunk>, when available. */
  originTrunkSha?: string;
  /** Whether the local trunk is already at or behind origin (fast-forward eligible). */
  fastForward?: boolean;
  /** Artifact branches eligible for restack (after active-build exclusions). */
  restackCandidates: string[];
  /** Branches and worktrees skipped because active builds are using them. */
  activeBuildSkips: StackSyncActiveBuildSkipWire[];
  /** Provider commands that were executed or would be executed in dry-run mode. */
  providerCommands: StackSyncProviderCommandWire[];
  /** Error message when outcome is 'failed' or 'conflict'. */
  error?: string;
  /** Unique sync operation ID (present when routed through the daemon service). */
  syncId?: string;
  /** The trigger that initiated this sync (present when supplied in the request). */
  trigger?: 'manual' | 'after-build' | 'scheduled' | 'retry-deferred';
  /** Active-build policy used (present when supplied in the request). */
  activeBuildPolicy?: 'skip' | 'defer';
  /** ISO timestamp when the sync started (present when routed through the daemon service). */
  startedAt?: string;
  /** ISO timestamp when the sync completed (present when routed through the daemon service). */
  completedAt?: string;
}
