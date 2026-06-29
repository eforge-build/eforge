/** Build/run status classes surfaced by daemon clients and dashboards. */
export type RunStatusClass = 'running' | 'failed' | 'completed';

/**
 * Classify any raw run/build status string into one of the three high-level
 * outcomes used by daemon projections and the console UI.
 *
 * Substring matching keeps this tolerant of status vocabulary variants such as
 * failed/failure/error/killed/cancelled and completed/complete/success/succeeded.
 * Any status that matches neither failed nor completed is treated as still in flight.
 */
export function classifyRunStatus(status: string): RunStatusClass {
  const normalized = status.toLowerCase();
  if (
    normalized.includes('fail') ||
    normalized.includes('error') ||
    normalized.includes('kill') ||
    normalized.includes('cancel') ||
    normalized.includes('stop') ||
    normalized.includes('abort')
  ) return 'failed';
  if (
    normalized.includes('complete') ||
    normalized.includes('success') ||
    normalized.includes('succeed')
  ) return 'completed';
  return 'running';
}

/** Return true when a raw run status represents a failed/terminated outcome. */
export function isFailedRunStatus(status: string): boolean {
  return classifyRunStatus(status) === 'failed';
}
