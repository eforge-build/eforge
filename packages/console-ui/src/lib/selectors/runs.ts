// --- eforge:region runs-build-entrypoints ---
import type { RunInfo, SessionMetadata } from '@eforge-build/client/browser';

export type RunRollupStatus = 'running' | 'failed' | 'completed' | 'unknown';

export interface RunGroupViewModel {
  key: string;
  /** Session id for session groups; planSet key for plan-set groups; run id otherwise. */
  detailId: string;
  sessionId?: string;
  label: string;
  isSession: boolean;
  runs: RunInfo[];
  status: RunRollupStatus;
  startedAt: string | null;
  completedAt: string | null;
  durationSeconds: number | null;
  commands: string[];
  cwd: string | null;
  metadata?: SessionMetadata;
  planCountLabel?: string;
  profileLabel?: string;
}

export interface PartitionedRunGroups {
  active: RunGroupViewModel[];
  history: RunGroupViewModel[];
}

// ---------------------------------------------------------------------------
// Status classification sets
// ---------------------------------------------------------------------------

const TERMINAL_FAILED_STATUSES = new Set([
  'failed',
  'failure',
  'error',
  'errored',
  'killed',
  'cancelled',
  'canceled',
  'stopped',
]);

const TERMINAL_SUCCESS_STATUSES = new Set([
  'completed',
  'complete',
  'success',
  'succeeded',
]);

/** Canonical build command ordering for tie-breaking within a group. */
const COMMAND_ORDER = ['enqueue', 'compile', 'adopt', 'run', 'build'];

function commandSortKey(command: string): number {
  const idx = COMMAND_ORDER.indexOf(command.toLowerCase());
  return idx === -1 ? COMMAND_ORDER.length : idx;
}

// ---------------------------------------------------------------------------
// selectRunStatusRollup
// ---------------------------------------------------------------------------

/**
 * Roll up a collection of runs into a single group status.
 *
 * - `running`  — any run lacks `completedAt` and has a non-terminal status, or
 *               has an unknown non-terminal status.
 * - `failed`   — any run has a failed/killed/cancelled/error terminal status.
 * - `completed`— all runs have success/completed terminal statuses and
 *               `completedAt` set, with no failures.
 * - `unknown`  — none of the above conditions are met.
 */
export function selectRunStatusRollup(runs: RunInfo[]): RunRollupStatus {
  if (runs.length === 0) return 'unknown';

  let anyFailed = false;
  let anyActive = false;
  let allSuccess = true;

  for (const run of runs) {
    const s = run.status.toLowerCase();
    if (TERMINAL_FAILED_STATUSES.has(s)) {
      anyFailed = true;
      allSuccess = false;
    } else if (TERMINAL_SUCCESS_STATUSES.has(s) && run.completedAt) {
      // counts as terminal success — leave allSuccess true
    } else {
      allSuccess = false;
      // Unknown (unrecognized) status with completedAt: treat as terminal-unknown, not active
      if (!TERMINAL_SUCCESS_STATUSES.has(s) && run.completedAt) {
        // leave anyActive unchanged — this run appears terminal but with unknown status
      } else {
        // Known active status or unknown status without completedAt
        anyActive = true;
      }
    }
  }

  if (anyFailed) return 'failed';
  if (anyActive) return 'running';
  if (allSuccess) return 'completed';
  return 'unknown';
}

// ---------------------------------------------------------------------------
// selectRunGroups
// ---------------------------------------------------------------------------

/**
 * Group runs by session id, plan set, or individual run id and return
 * `RunGroupViewModel[]` sorted by newest `startedAt` descending.
 */
export function selectRunGroups(
  runs: RunInfo[],
  metadataMap: Record<string, SessionMetadata>,
): RunGroupViewModel[] {
  const groupMap = new Map<string, RunInfo[]>();

  for (const run of runs) {
    let key: string;
    if (run.sessionId) {
      key = `session:${run.sessionId}`;
    } else if (run.planSet) {
      key = `planSet:${run.planSet}`;
    } else {
      key = `run:${run.id}`;
    }
    const existing = groupMap.get(key);
    if (existing) {
      existing.push(run);
    } else {
      groupMap.set(key, [run]);
    }
  }

  const groups: RunGroupViewModel[] = [];

  for (const [key, groupRuns] of groupMap.entries()) {
    // Sort runs within a group chronologically; tie-break by canonical command order
    const sortedRuns = [...groupRuns].sort((a, b) => {
      const aTime = a.startedAt ? new Date(a.startedAt).getTime() : 0;
      const bTime = b.startedAt ? new Date(b.startedAt).getTime() : 0;
      const diff = aTime - bTime;
      if (Math.abs(diff) <= 1000) {
        return commandSortKey(a.command) - commandSortKey(b.command);
      }
      return diff;
    });

    const firstRun = sortedRuns[0];
    const isSession = key.startsWith('session:');
    const sessionId = isSession ? firstRun.sessionId : undefined;

    // Human-readable label: prefer plan set, then session id, then run id
    const label = firstRun.planSet || sessionId || firstRun.id;

    // Canonical detail identifier used for selection and REST fetches.
    // For multi-run plan-set groups we use the first run's id as a representative
    // so that detail routes receive a valid run/session-style identifier.
    let detailId: string;
    if (sessionId) {
      detailId = sessionId;
    } else {
      detailId = firstRun.id;
    }

    // Start time: earliest run in the group
    const startedAt = sortedRuns[0]?.startedAt ?? null;

    // Completion time: latest completedAt across all runs
    const latestCompleted = sortedRuns.reduce<string | null>((latest, r) => {
      if (!r.completedAt) return latest;
      if (!latest) return r.completedAt;
      return new Date(r.completedAt).getTime() > new Date(latest).getTime()
        ? r.completedAt
        : latest;
    }, null);
    const completedAt = latestCompleted;

    let durationSeconds: number | null = null;
    if (startedAt && completedAt) {
      durationSeconds =
        (new Date(completedAt).getTime() - new Date(startedAt).getTime()) / 1000;
    }

    // Deduplicated command list preserving chronological order
    const commandSet = new Set<string>();
    const commands: string[] = [];
    for (const run of sortedRuns) {
      if (!commandSet.has(run.command)) {
        commandSet.add(run.command);
        commands.push(run.command);
      }
    }

    const cwd = firstRun.cwd ?? null;
    const status = selectRunStatusRollup(sortedRuns);
    const metadata = sessionId ? metadataMap[sessionId] : undefined;
    const planCountLabel =
      metadata?.planCount != null ? `${metadata.planCount} plans` : undefined;
    const profileLabel = metadata?.baseProfile ?? undefined;

    groups.push({
      key,
      detailId,
      sessionId,
      label,
      isSession,
      runs: sortedRuns,
      status,
      startedAt,
      completedAt,
      durationSeconds,
      commands,
      cwd,
      metadata,
      planCountLabel,
      profileLabel,
    });
  }

  // Sort groups newest first
  groups.sort((a, b) => {
    const aTime = a.startedAt ? new Date(a.startedAt).getTime() : 0;
    const bTime = b.startedAt ? new Date(b.startedAt).getTime() : 0;
    return bTime - aTime;
  });

  return groups;
}

// ---------------------------------------------------------------------------
// partitionRunGroups
// ---------------------------------------------------------------------------

/**
 * Split a sorted group list into active session groups and history groups.
 *
 * A group is active when its `sessionId` is in `activeSessionIds`.
 * Non-session groups are always historical.
 */
export function partitionRunGroups(
  groups: RunGroupViewModel[],
  activeSessionIds: string[],
): PartitionedRunGroups {
  const activeSet = new Set(activeSessionIds);
  const active: RunGroupViewModel[] = [];
  const history: RunGroupViewModel[] = [];

  for (const group of groups) {
    if (group.sessionId && activeSet.has(group.sessionId)) {
      active.push(group);
    } else {
      history.push(group);
    }
  }

  return { active, history };
}

// ---------------------------------------------------------------------------
// selectPlanStatusCounts
// ---------------------------------------------------------------------------

export function selectPlanStatusCounts(
  plans: Array<{ id: string; status: 'pending' | 'running' | 'completed' | 'failed' }>,
): { pending: number; running: number; completed: number; failed: number } {
  const counts = { pending: 0, running: 0, completed: 0, failed: 0 };
  for (const plan of plans) {
    if (plan.status in counts) {
      counts[plan.status]++;
    }
  }
  return counts;
}
// --- eforge:endregion runs-build-entrypoints ---
