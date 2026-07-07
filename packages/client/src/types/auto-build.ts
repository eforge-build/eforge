import type { EforgeEvent } from '../events.js';

export type AutoBuildDesired = 'enabled' | 'disabled';
export type AutoBuildRuntimeMode =
  | 'disabled'
  | 'starting'
  | 'running'
  | 'paused'
  | 'stopping'
  | 'restarting'
  | 'faulted';

export interface AutoBuildSchedulerState {
  alive: boolean;
  paused: boolean;
  lastMutationReason?: string;
  /** Number of builds currently running, as reported by the scheduler. */ runningCount?: number;
  /** Maximum concurrent build limit configured in the daemon, as reported by the scheduler. */ limit?: number;
}

export interface AutoBuildTransitionDetail {
  at: string;
  previousMode: AutoBuildRuntimeMode;
  nextMode: AutoBuildRuntimeMode;
  desired: AutoBuildDesired;
  reason?: string;
  source: string;
}

export type RecoveryAutoResumeStopReason = Extract<EforgeEvent, { type: 'recovery:auto-resume:stopped' }>['reason'];
export type RecoveryAutoResumeLastDecision = 'evaluate' | 'queued' | 'stopped';

export interface RecoveryAutoResumeProjectionState {
  /** Whether daemon policy allows automatic continue-and-repair recovery attempts. */
  enabled: boolean;
  /** Configured bounded attempt budget for automatic recovery. */
  maxAttempts: number;
  /** Attempts already recorded for the latest projected recovery decision. */
  attempts: number;
  /** Last automatic policy decision observed by monitor projections. */
  lastDecision?: RecoveryAutoResumeLastDecision;
  /** PRD associated with the latest automatic recovery decision, when known. */
  prdId?: string;
  /** Plan set associated with the latest automatic recovery decision, when known. */
  setName?: string;
  /** User-visible stop reason for disabled/stopped automatic recovery. */
  stopReason?: RecoveryAutoResumeStopReason;
  /** Additional user-visible explanation supplied by the daemon. */
  message?: string;
}

export interface AutoBuildState {
  /** Desired auto-build toggle. Remains true during scheduler pauses; use mode/scheduler.paused for runtime pause state. */
  enabled: boolean;
  watcher: {
    running: boolean;
    pid: number | null;
    sessionId: string | null;
  };
  desired?: AutoBuildDesired;
  mode?: AutoBuildRuntimeMode;
  scheduler?: AutoBuildSchedulerState;
  lastTransition?: AutoBuildTransitionDetail;
  reason?: string;
  recoveryAutoResume?: RecoveryAutoResumeProjectionState;
}
