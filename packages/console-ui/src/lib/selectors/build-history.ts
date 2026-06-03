/**
 * Build rollup selector: collapse a session's per-phase "runs" (compile, build,
 * resume; successful enqueue bookkeeping excluded) into a single build row.
 *
 * The daemon records one run per phase, tied together by `sessionId`. The Build
 * history surfaces each session as one cohesive build, matching how the Build
 * detail page already aggregates a session's phases.
 *
 * No React imports. No DOM imports.
 */
import type { RunInfo } from '@eforge-build/client/browser';
import { selectPrdDisplayLabel } from '@/lib/selectors/labels';

/** Newest-first comparator on the ISO `startedAt` timestamp. */
function byStartedAtDesc(a: { startedAt: string }, b: { startedAt: string }): number {
  if (a.startedAt > b.startedAt) return -1;
  if (a.startedAt < b.startedAt) return 1;
  return 0;
}

/** A single phase run (one row per enqueue/compile/build/resume command). */
export interface NowRecentRunItem {
  id: string;
  sessionId: string | undefined;
  planSet: string;
  command: string;
  status: string;
  startedAt: string;
  durationMs: number | null;
}

/**
 * All phase runs sorted newest first (no limit). Feeds the Build health metrics,
 * which read per-phase outcomes rather than the per-build rollup below.
 */
export function selectAllNowRunItems(runs: RunInfo[], now: number = Date.now()): NowRecentRunItem[] {
  const sorted = [...runs].sort(byStartedAtDesc);
  return sorted.map((run) => {
    let durationMs: number | null = null;
    if (run.completedAt) {
      const start = new Date(run.startedAt).getTime();
      const end = new Date(run.completedAt).getTime();
      if (!isNaN(start) && !isNaN(end)) durationMs = end - start;
    } else {
      const start = new Date(run.startedAt).getTime();
      if (!isNaN(start)) durationMs = now - start;
    }
    return {
      id: run.id,
      sessionId: run.sessionId,
      planSet: selectPrdDisplayLabel(undefined, run.planSet),
      command: run.command,
      status: run.status,
      startedAt: run.startedAt,
      durationMs,
    };
  });
}

/**
 * One build = one session, rolled up from its phase runs. This is the
 * build-level view the Build history surfaces.
 */
export interface NowBuildItem {
  /** Stable id for keys + navigation (the session id when present). */
  id: string;
  sessionId: string | undefined;
  planSet: string;
  /** Rolled-up build status: 'running' | 'failed' | 'completed'. */
  status: string;
  /**
   * The phase the build is currently in (when running) or failed at (when
   * failed). `null` once the build has completed — a finished build needs no
   * phase qualifier.
   */
  phase: string | null;
  /** Earliest phase start for the build. */
  startedAt: string;
  /** Wall-clock span: earliest phase start → latest completion (or now if live). */
  durationMs: number | null;
}

/** The three build-level outcomes the Build history surfaces. */
export type BuildStatusClass = 'running' | 'failed' | 'completed';

/**
 * Classify any raw run/build status string into one of the three build-level
 * outcomes. This is the single source of truth for status classification,
 * shared by the rollup here and the row presentation in `build-history/shared`.
 *
 * Substring matching keeps it tolerant of the daemon's status vocabulary
 * variants (failed/failure/error, completed/complete/success/succeeded); any
 * status that matches neither is treated as still in flight.
 */
export function classifyBuildStatus(status: string): BuildStatusClass {
  const s = status.toLowerCase();
  if (s.includes('fail') || s.includes('error')) return 'failed';
  if (s.includes('complete') || s.includes('success') || s.includes('succeed')) return 'completed';
  return 'running';
}

/**
 * Roll a session's phase runs up into a single build, or `null` when the session
 * isn't a build at all.
 *
 * The `enqueue` phase runs in its own session (a different `sessionId` than the
 * compile/build/resume it spawns), so a successful enqueue lands here as an
 * enqueue-only session. That's pre-build setup, not a build — drop it so it
 * doesn't double up with the real build's row. A *failed* enqueue is kept: the
 * build never got created, which is worth surfacing.
 *
 * The representative phase is the newest run; status and the phase qualifier are
 * read from it.
 */
function rollupBuild(runs: RunInfo[], now: number): NowBuildItem | null {
  // A build needs an actual build phase (compile/build/resume) or a failed
  // enqueue. A session of only successful/in-flight enqueue runs is setup, not
  // a build.
  const window = runs.filter((r) => r.command !== 'enqueue' || classifyBuildStatus(r.status) === 'failed');
  if (window.length === 0) return null;

  const rep = window.reduce((a, b) => (b.startedAt > a.startedAt ? b : a));
  const startedAt = window.reduce(
    (min, r) => (r.startedAt < min ? r.startedAt : min),
    window[0].startedAt,
  );

  const startMs = new Date(startedAt).getTime();
  const anyLive = window.some((r) => !r.completedAt);
  let durationMs: number | null = null;
  if (!isNaN(startMs)) {
    if (anyLive) {
      durationMs = now - startMs;
    } else {
      const latestEnd = window.reduce((max, r) => {
        const end = r.completedAt ? new Date(r.completedAt).getTime() : NaN;
        return !isNaN(end) && end > max ? end : max;
      }, 0);
      if (latestEnd > 0) durationMs = latestEnd - startMs;
    }
  }

  let status: string;
  let phase: string | null;
  if (!rep.completedAt) {
    // Still in flight: report the phase it's currently working through.
    status = 'running';
    phase = rep.command;
  } else if (classifyBuildStatus(rep.status) === 'failed') {
    // Failed: report the phase it broke in.
    status = 'failed';
    phase = rep.command;
  } else {
    status = 'completed';
    phase = null;
  }

  return {
    id: rep.sessionId ?? rep.id,
    sessionId: rep.sessionId,
    planSet: selectPrdDisplayLabel(undefined, rep.planSet),
    status,
    phase,
    startedAt,
    durationMs,
  };
}

export function selectAllNowBuildItems(runs: RunInfo[], now: number = Date.now()): NowBuildItem[] {
  const groups = new Map<string, RunInfo[]>();
  for (const run of runs) {
    // Runs without a session id each stand alone as their own build.
    const key = run.sessionId ?? `__run:${run.id}`;
    const arr = groups.get(key);
    if (arr) arr.push(run);
    else groups.set(key, [run]);
  }

  const builds = Array.from(groups.values())
    .map((group) => rollupBuild(group, now))
    .filter((b): b is NowBuildItem => b !== null);
  builds.sort(byStartedAtDesc);
  return builds;
}
