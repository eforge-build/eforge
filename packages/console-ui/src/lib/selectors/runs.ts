// --- eforge:region runs-build-entrypoints ---
import type { RunInfo, SessionMetadata } from '@eforge-build/client/browser';
import { pluralize } from '@/lib/format';
import { selectPrdDisplayLabel } from '@/lib/selectors/labels';

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
// normalizePlanSetKey
// ---------------------------------------------------------------------------

/**
 * Derive a stable, canonical key from a planSet slug or display title.
 * Strips timestamp prefixes and file extensions, lowercases, replaces all
 * non-alphanumeric characters (including whitespace) with hyphens, collapses
 * consecutive hyphens, and trims leading/trailing hyphens so that both
 * title variants ("Feature X") and slug variants ("feature-x") produce the
 * same key.
 */
function normalizePlanSetKey(planSet: string): string {
  if (!planSet) return '';
  const trimmed = planSet.trim();
  const withoutTimestamp = trimmed.replace(/^\d{4}[-_]\d{2}[-_]\d{2}[-_]|^\d{8}[-_]/, '');
  const withoutExtension = withoutTimestamp.replace(/\.(md|txt|yaml|yml|json)$/i, '');
  return withoutExtension
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
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
// buildRunGroup — internal helper
// ---------------------------------------------------------------------------

/**
 * Build a RunGroupViewModel from a set of runs that belong to the same group.
 * Runs are sorted chronologically within the group (tie-broken by command order).
 */
function buildRunGroup(
  key: string,
  groupRuns: RunInfo[],
  metadataMap: Record<string, SessionMetadata>,
  isSession: boolean,
): RunGroupViewModel {
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
  const sessionId = isSession ? firstRun.sessionId : undefined;

  // Human-readable label: apply display label normalization to plan set slugs
  const label = firstRun.planSet
    ? selectPrdDisplayLabel(undefined, firstRun.planSet)
    : sessionId || firstRun.id;

  // Canonical detail identifier used for selection and REST fetches.
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
    metadata?.planCount != null ? pluralize(metadata.planCount, 'plan') : undefined;
  const profileLabel = metadata?.baseProfile ?? undefined;

  return {
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
  };
}

// ---------------------------------------------------------------------------
// selectRunGroups
// ---------------------------------------------------------------------------

/** Five-minute window for coalescing plan-set runs (in milliseconds). */
const PLAN_SET_COALESCE_WINDOW_MS = 5 * 60 * 1000;

/**
 * Group runs by session id, normalised plan set, or individual run id, and
 * return `RunGroupViewModel[]` sorted by newest `startedAt` descending.
 *
 * Non-session runs sharing a normalised plan-set slug are coalesced into a
 * single group when their `startedAt` values are within a five-minute window.
 * Runs further apart start a new group.
 */
export function selectRunGroups(
  runs: RunInfo[],
  metadataMap: Record<string, SessionMetadata>,
): RunGroupViewModel[] {
  // Phase 1: Separate runs into three buckets
  const sessionBuckets = new Map<string, RunInfo[]>();
  const planSetBuckets = new Map<string, RunInfo[]>(); // key: normalizePlanSetKey(planSet)
  const soloRuns: RunInfo[] = [];

  for (const run of runs) {
    if (run.sessionId) {
      const existing = sessionBuckets.get(run.sessionId);
      if (existing) {
        existing.push(run);
      } else {
        sessionBuckets.set(run.sessionId, [run]);
      }
    } else if (run.planSet) {
      const normalizedKey = normalizePlanSetKey(run.planSet);
      const existing = planSetBuckets.get(normalizedKey);
      if (existing) {
        existing.push(run);
      } else {
        planSetBuckets.set(normalizedKey, [run]);
      }
    } else {
      soloRuns.push(run);
    }
  }

  const groups: RunGroupViewModel[] = [];

  // Phase 2: Build session groups (one group per sessionId)
  for (const [sessionId, sessionRuns] of sessionBuckets.entries()) {
    groups.push(buildRunGroup(`session:${sessionId}`, sessionRuns, metadataMap, true));
  }

  // Phase 3: Build plan-set groups with five-minute time windowing
  for (const [normalizedKey, planRuns] of planSetBuckets.entries()) {
    // Sort runs by startedAt ascending to determine window boundaries
    const sorted = [...planRuns].sort((a, b) => {
      const at = a.startedAt ? new Date(a.startedAt).getTime() : 0;
      const bt = b.startedAt ? new Date(b.startedAt).getTime() : 0;
      return at - bt;
    });

    // Split into time windows: a new window starts when the gap from the
    // current window's first run exceeds PLAN_SET_COALESCE_WINDOW_MS.
    let windowRuns: RunInfo[] = [];
    let windowStart = 0;
    let windowIdx = 0;

    const emitWindow = (runsInWindow: RunInfo[], idx: number): void => {
      // The first window uses the clean key; subsequent windows get a
      // startedAt-based suffix to ensure unique keys.
      const key =
        idx === 0
          ? `planSet:${normalizedKey}`
          : `planSet:${normalizedKey}:${runsInWindow[0].startedAt ?? idx}`;
      groups.push(buildRunGroup(key, runsInWindow, metadataMap, false));
    };

    for (const run of sorted) {
      const t = run.startedAt ? new Date(run.startedAt).getTime() : 0;
      if (windowRuns.length === 0) {
        windowRuns = [run];
        windowStart = t;
      } else if (t - windowStart <= PLAN_SET_COALESCE_WINDOW_MS) {
        windowRuns.push(run);
      } else {
        emitWindow(windowRuns, windowIdx);
        windowIdx++;
        windowRuns = [run];
        windowStart = t;
      }
    }
    if (windowRuns.length > 0) {
      emitWindow(windowRuns, windowIdx);
    }
  }

  // Phase 4: Solo runs (no sessionId, no planSet)
  for (const run of soloRuns) {
    groups.push(buildRunGroup(`run:${run.id}`, [run], metadataMap, false));
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

// ---------------------------------------------------------------------------
// Filter types, constants, and filterRunGroups
// ---------------------------------------------------------------------------

export type RunStatusFilter = 'all' | 'running' | 'failed' | 'completed';
export type RunCommandFilter = 'all' | 'enqueue' | 'compile' | 'build';

export interface RunFilterState {
  status: RunStatusFilter;
  command: RunCommandFilter;
  search: string;
}

export const STATUS_CHIP_OPTIONS: readonly RunStatusFilter[] = [
  'all',
  'running',
  'failed',
  'completed',
] as const;

export const COMMAND_CHIP_OPTIONS: readonly RunCommandFilter[] = [
  'all',
  'enqueue',
  'compile',
  'build',
] as const;

/**
 * Filter a list of RunGroupViewModels by status, command, and search text.
 * Returns a new array — does not mutate the input.
 */
export function filterRunGroups(
  groups: RunGroupViewModel[],
  filter: RunFilterState,
): RunGroupViewModel[] {
  return groups.filter((group) => {
    if (filter.status !== 'all' && group.status !== filter.status) {
      return false;
    }
    if (filter.command !== 'all' && !group.commands.includes(filter.command)) {
      return false;
    }
    const q = filter.search.trim().toLowerCase();
    if (q) {
      const labelMatch = group.label.toLowerCase().includes(q);
      const sessionMatch = group.sessionId?.toLowerCase().includes(q) ?? false;
      if (!labelMatch && !sessionMatch) {
        return false;
      }
    }
    return true;
  });
}

// ---------------------------------------------------------------------------
// Day bucketing — bucketRunGroupsByDay
// ---------------------------------------------------------------------------

export type DayBucket = 'Today' | 'Yesterday' | 'Older';

export interface DayGroupedRuns {
  bucket: DayBucket;
  groups: RunGroupViewModel[];
}

function isSameCalendarDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * Bucket a sorted list of RunGroupViewModels into Today / Yesterday / Older
 * day sections.  Pass `now` for deterministic tests; defaults to `new Date()`.
 * Only non-empty buckets are included in the result.
 */
export function bucketRunGroupsByDay(
  groups: RunGroupViewModel[],
  now: Date = new Date(),
): DayGroupedRuns[] {
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);

  const todayGroups: RunGroupViewModel[] = [];
  const yesterdayGroups: RunGroupViewModel[] = [];
  const olderGroups: RunGroupViewModel[] = [];

  for (const group of groups) {
    if (!group.startedAt) {
      olderGroups.push(group);
      continue;
    }
    const d = new Date(group.startedAt);
    if (isSameCalendarDay(d, now)) {
      todayGroups.push(group);
    } else if (isSameCalendarDay(d, yesterday)) {
      yesterdayGroups.push(group);
    } else {
      olderGroups.push(group);
    }
  }

  const result: DayGroupedRuns[] = [];
  if (todayGroups.length > 0) result.push({ bucket: 'Today', groups: todayGroups });
  if (yesterdayGroups.length > 0) result.push({ bucket: 'Yesterday', groups: yesterdayGroups });
  if (olderGroups.length > 0) result.push({ bucket: 'Older', groups: olderGroups });

  return result;
}

// ---------------------------------------------------------------------------
// projectBasename — extract directory name from cwd path
// ---------------------------------------------------------------------------

/**
 * Return the last path segment of a cwd string (equivalent to `basename`).
 * Works with both Unix and Windows path separators.
 * Returns `null` for empty or null input.
 */
export function projectBasename(cwd: string | null): string | null {
  if (!cwd) return null;
  const trimmed = cwd.replace(/[/\\]+$/, '');
  const lastSlash = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  if (lastSlash === -1) return trimmed || null;
  const base = trimmed.slice(lastSlash + 1);
  return base || null;
}
// --- eforge:endregion runs-build-entrypoints ---
