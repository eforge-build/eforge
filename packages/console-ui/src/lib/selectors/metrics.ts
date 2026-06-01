/**
 * Metrics-panel selector — derives at-a-glance health visuals from existing
 * snapshot data: a land-vs-fail breakdown from Git stack history and a
 * recent-run duration series for the throughput bars. Pure; no I/O.
 */
import type { NowRecentRunItem, NowStackSummary } from './now';

export type RunOutcome = 'completed' | 'failed' | 'running' | 'other';

export interface MetricsSuccessSlice {
  key: 'landed' | 'failed' | 'other';
  label: string;
  value: number;
  color: string;
}

export interface MetricsRunBar {
  id: string;
  label: string;
  /** Duration in minutes (>= 0); null durations are treated as 0. */
  durationMin: number;
  outcome: RunOutcome;
  color: string;
}

export interface NowMetricsPanel {
  hasStack: boolean;
  landed: number;
  failed: number;
  total: number;
  /** Fraction in [0, 1], or null when there is no completed stack history. */
  landRate: number | null;
  successSlices: MetricsSuccessSlice[];
  runBars: MetricsRunBar[];
}

const SUCCESS_STATUSES = new Set(['landed', 'merged', 'built', 'complete', 'completed']);
const FAILED_STATUSES = new Set(['failed', 'failure', 'error']);

const OUTCOME_COLOR: Record<RunOutcome, string> = {
  completed: 'var(--color-green)',
  failed: 'var(--color-red)',
  running: 'var(--color-blue)',
  other: 'var(--color-muted-foreground)',
};

/** Max number of recent runs plotted in the throughput strip. */
const MAX_RUN_BARS = 24;

function runOutcome(status: string): RunOutcome {
  const s = status.toLowerCase();
  if (FAILED_STATUSES.has(s) || s.includes('fail') || s.includes('error')) return 'failed';
  if (SUCCESS_STATUSES.has(s) || s.includes('complete') || s.includes('success') || s.includes('succeed')) {
    return 'completed';
  }
  if (s.includes('run')) return 'running';
  return 'other';
}

export function selectNowMetricsPanel(
  stack: NowStackSummary | null,
  allRuns: NowRecentRunItem[],
): NowMetricsPanel {
  let landed = 0;
  let failed = 0;
  let other = 0;

  if (stack) {
    for (const [status, count] of Object.entries(stack.byStatus)) {
      const s = status.toLowerCase();
      if (FAILED_STATUSES.has(s)) failed += count;
      else if (SUCCESS_STATUSES.has(s)) landed += count;
      else other += count;
    }
  }

  const total = landed + failed + other;
  const landRate = landed + failed > 0 ? landed / (landed + failed) : null;

  const successSlices: MetricsSuccessSlice[] = (
    [
      { key: 'landed', label: 'Landed', value: landed, color: 'var(--color-green)' },
      { key: 'failed', label: 'Failed', value: failed, color: 'var(--color-red)' },
      { key: 'other', label: 'Other', value: other, color: 'var(--color-muted-foreground)' },
    ] satisfies MetricsSuccessSlice[]
  ).filter((slice) => slice.value > 0);

  // Newest-first input -> take most recent, then reverse to oldest -> newest.
  const runBars: MetricsRunBar[] = allRuns
    .slice(0, MAX_RUN_BARS)
    .reverse()
    .map((run) => {
      const outcome = runOutcome(run.status);
      return {
        id: run.id,
        label: run.planSet,
        durationMin: run.durationMs != null ? Math.max(0, run.durationMs / 60_000) : 0,
        outcome,
        color: OUTCOME_COLOR[outcome],
      };
    });

  return {
    hasStack: stack != null && total > 0,
    landed,
    failed,
    total,
    landRate,
    successSlices,
    runBars,
  };
}
