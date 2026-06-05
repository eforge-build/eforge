export type StackSyncTriggerWire = 'manual' | 'after-build' | 'scheduled' | 'retry-deferred';
export type StackSyncActiveBuildPolicyWire = 'skip' | 'defer';
export type StackSyncOutcomeWire = 'skipped' | 'complete' | 'failed' | 'conflict' | 'deferred';
/** Wire shape of a stack sync status record (matches StackSyncStatus from engine). */
export interface StackSyncStatusWire {
  id: string;
  trigger?: StackSyncTriggerWire;
  activeBuildPolicy?: StackSyncActiveBuildPolicyWire;
  startedAt: string;
  completedAt?: string;
  /** Overall outcome. Absent for in-progress (current) records that have not yet completed. */
  outcome?: StackSyncOutcomeWire;
  reason?: string;
  error?: string;
  dryRun: boolean;
  localTrunkSha?: string;
  originTrunkSha?: string;
  fastForward?: boolean;
  restackCandidates: string[];
  /** Branches and worktrees skipped because active builds are using them (present on terminal records). */
  activeBuildSkips?: Array<{ branch: string; worktree?: string; reason: string }>;
  /** Provider commands that were executed or would be executed in dry-run mode (present on terminal records). */
  providerCommands?: Array<{
    command: string;
    args: string[];
    dryRun: boolean;
    ran: boolean;
    stdout?: string;
    stderr?: string;
    exitCode?: number;
  }>;
}

// ---------------------------------------------------------------------------
// Re-export constants and utilities
