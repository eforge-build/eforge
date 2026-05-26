import type { RunInfo } from '@eforge-build/client/browser';

/** Lowercase terminal status strings — runs with these statuses are not active. */
const TERMINAL_STATUSES = new Set([
  'completed',
  'complete',
  'success',
  'succeeded',
  'failed',
  'failure',
  'error',
  'errored',
  'killed',
  'cancelled',
  'canceled',
  'stopped',
]);

/** Return true when a run status string indicates the run has terminated. */
export function isTerminalStatus(status: string): boolean {
  return TERMINAL_STATUSES.has(status.toLowerCase());
}

/**
 * Derive the sorted unique active session IDs from a list of runs.
 *
 * Rules:
 * - Ignore runs without a `sessionId`.
 * - Ignore runs with `completedAt` set.
 * - Ignore runs whose status (lowercased) is in the terminal set.
 * - Include all other runs as active.
 * - Return sorted unique session IDs for stable hook dependencies.
 */
export function selectActiveSessionIds(runs: RunInfo[]): string[] {
  const seen = new Set<string>();
  for (const run of runs) {
    if (!run.sessionId) continue;
    if (run.completedAt) continue;
    if (isTerminalStatus(run.status)) continue;
    seen.add(run.sessionId);
  }
  return Array.from(seen).sort();
}
