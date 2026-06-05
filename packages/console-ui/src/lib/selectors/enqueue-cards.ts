/**
 * Selector for pre-build "enqueue" runs — the formatter/validator pass that
 * normalizes a PRD before it joins the build queue. Kept separate from the
 * active-build selector in now.ts: an enqueue run has no plan set, lifecycle,
 * or plans, so it gets a lighter card rather than the build rail.
 */
import type { RunInfo, EforgeEvent } from '@eforge-build/client/browser';
import type { ConnectionStatus } from '@/lib/types';
import type { ActiveSessionDetail } from '@/hooks/use-active-session-streams';
import type { RunState } from '@/lib/run-state';
import { getSummaryStats } from '@/lib/run-state';
import { isTerminalStatus } from '@/lib/selectors/active-builds';

/** The `command` value the daemon assigns to a PRD enqueue/formatting run. */
export const ENQUEUE_COMMAND = 'enqueue';

/**
 * A pre-build enqueue run. Deliberately lighter than a build card — it carries
 * only a current step and spend, not the PRD→Plans→…→Land rail.
 */
export interface NowEnqueueCard {
  sessionId: string;
  runId: string;
  /** PRD title once known (enqueue:complete), else its source, else a placeholder. */
  title: string;
  durationMs: number;
  streamStatus: ConnectionStatus | 'connecting';
  /** Human label for the active enqueue step, derived from the running agent. */
  step: string | null;
  /** enqueue:failed / enqueue:commit-failed message, or null. */
  latestError: string | null;
  tokens: number;
  cost: number;
}

/** Maps the agent running during enqueue to a human step label. */
const ENQUEUE_STEP_BY_AGENT: Record<string, string> = {
  formatter: 'Formatting PRD',
  'prd-validator': 'Extracting acceptance criteria',
  'dependency-detector': 'Detecting dependencies',
};

function enqueueStepLabel(agent: string | null): string | null {
  if (!agent) return null;
  return ENQUEUE_STEP_BY_AGENT[agent] ?? null;
}

function latestAgentRole(runState: RunState): string | null {
  for (let i = runState.events.length - 1; i >= 0; i--) {
    const e = runState.events[i].event;
    if (e.type === 'agent:start') {
      return (e as Extract<EforgeEvent, { type: 'agent:start' }>).agent;
    }
  }
  return null;
}

/** PRD title once enqueue:complete fires; otherwise the enqueue source. */
function extractEnqueueTitle(runState: RunState, fallback: string): string {
  let source: string | null = null;
  for (let i = runState.events.length - 1; i >= 0; i--) {
    const e = runState.events[i].event;
    if (e.type === 'enqueue:complete') {
      return (e as Extract<EforgeEvent, { type: 'enqueue:complete' }>).title;
    }
    if (e.type === 'enqueue:start' && source == null) {
      source = (e as Extract<EforgeEvent, { type: 'enqueue:start' }>).source;
    }
  }
  return source ?? fallback;
}

function extractEnqueueError(runState: RunState): string | null {
  for (let i = runState.events.length - 1; i >= 0; i--) {
    const e = runState.events[i].event;
    if (e.type === 'enqueue:failed') {
      return (e as Extract<EforgeEvent, { type: 'enqueue:failed' }>).error;
    }
    if (e.type === 'enqueue:commit-failed') {
      return (e as Extract<EforgeEvent, { type: 'enqueue:commit-failed' }>).error;
    }
  }
  return null;
}

/** In-progress runs (have a session, not completed/terminal), by unique session. */
function activeRunSessions(runs: RunInfo[]): RunInfo[] {
  return runs.filter((r) => !r.completedAt && r.sessionId && !isTerminalStatus(r.status));
}

/** Count of in-progress PRD intake (enqueue/formatting) runs — pipeline stage 1. */
export function countActiveIntakeRuns(runs: RunInfo[]): number {
  return new Set(
    activeRunSessions(runs)
      .filter((r) => r.command === ENQUEUE_COMMAND)
      .map((r) => r.sessionId),
  ).size;
}

/** Count of in-progress build runs (intake excluded so it is not double-counted). */
export function countActiveBuildRuns(runs: RunInfo[]): number {
  return new Set(
    activeRunSessions(runs)
      .filter((r) => r.command !== ENQUEUE_COMMAND)
      .map((r) => r.sessionId),
  ).size;
}

export function selectNowEnqueueCards(
  runs: RunInfo[],
  activeDetails: Record<string, ActiveSessionDetail>,
  now: number = Date.now(),
): NowEnqueueCard[] {
  const enqueueRuns = runs.filter(
    (r) => !r.completedAt && r.sessionId && !isTerminalStatus(r.status) && r.command === ENQUEUE_COMMAND,
  );

  // Group by sessionId, newest startedAt wins.
  const bySession = new Map<string, RunInfo>();
  for (const run of enqueueRuns) {
    const sid = run.sessionId!;
    const existing = bySession.get(sid);
    if (!existing || run.startedAt > existing.startedAt) bySession.set(sid, run);
  }

  const entries = Array.from(bySession.entries()).sort(([, a], [, b]) => {
    if (a.startedAt > b.startedAt) return -1;
    if (a.startedAt < b.startedAt) return 1;
    return 0;
  });

  return entries.map(([sessionId, run]) => {
    const detail = activeDetails[sessionId];
    const startMs = new Date(run.startedAt).getTime();
    const durationMs = isNaN(startMs) ? 0 : now - startMs;
    const fallbackTitle = run.planSet?.trim() || 'New PRD';

    let streamStatus: NowEnqueueCard['streamStatus'] = 'connecting';
    let step: string | null = null;
    let latestError: string | null = null;
    let title = fallbackTitle;
    let tokens = 0;
    let cost = 0;

    if (detail) {
      streamStatus = detail.connectionStatus;
      const rs = detail.runState;
      step = enqueueStepLabel(latestAgentRole(rs));
      latestError = extractEnqueueError(rs);
      title = extractEnqueueTitle(rs, fallbackTitle);
      const stats = getSummaryStats(rs);
      tokens = stats.tokensIn;
      cost = stats.totalCost;
    }

    return { sessionId, runId: run.id, title, durationMs, streamStatus, step, latestError, tokens, cost };
  });
}
