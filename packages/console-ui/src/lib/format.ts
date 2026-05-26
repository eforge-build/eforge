/**
 * Console-local formatting helpers for relative time, duration, timestamps,
 * status labels, and truncated identifiers.
 *
 * No React imports. No DOM imports.
 */

/**
 * Format a relative time duration in a human-readable form.
 * @param ms - The number of milliseconds in the past.
 */
export function formatRelativeTime(ms: number): string {
  if (ms < 0) return 'just now';
  if (ms < 1_000) return 'just now';
  if (ms < 60_000) return `${Math.floor(ms / 1_000)}s ago`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
  return `${Math.floor(ms / 86_400_000)}d ago`;
}

/**
 * Format a duration in a compact human-readable form.
 * @param durationMs - Duration in milliseconds.
 */
export function formatDuration(durationMs: number): string {
  if (durationMs < 0) return '0s';
  const totalSecs = Math.floor(durationMs / 1_000);
  if (totalSecs < 60) return `${totalSecs}s`;
  const mins = Math.floor(totalSecs / 60);
  const secs = totalSecs % 60;
  if (mins < 60) return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`;
  const hours = Math.floor(mins / 60);
  const remMins = mins % 60;
  return remMins > 0 ? `${hours}h ${remMins}m` : `${hours}h`;
}

/**
 * Format a timestamp string or epoch ms to a short locale string.
 */
export function formatTimestamp(ts: string | number): string {
  try {
    const d = typeof ts === 'number' ? new Date(ts) : new Date(ts);
    if (isNaN(d.getTime())) return String(ts);
    return d.toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return String(ts);
  }
}

/**
 * Capitalize and lightly humanize a status string (e.g. "in_progress" -> "In progress").
 */
export function formatStatusLabel(status: string): string {
  if (!status) return '';
  return status
    .replace(/[_-]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Truncate an identifier to a short prefix for display.
 */
export function truncateId(id: string, length = 8): string {
  if (!id) return '';
  return id.length > length ? id.slice(0, length) : id;
}

/**
 * Return a count string with the correct singular or plural form.
 *
 * @param n        - The count to display.
 * @param singular - The singular noun (e.g. "run").
 * @param plural   - Optional plural form; defaults to `singular + "s"`.
 *
 * @example
 * pluralize(1, 'run')       // "1 run"
 * pluralize(3, 'run')       // "3 runs"
 * pluralize(1, 'activity')  // "1 activity"
 * pluralize(2, 'activity', 'activities') // "2 activities"
 */
export function pluralize(n: number, singular: string, plural?: string): string {
  const form = n === 1 ? singular : (plural ?? `${singular}s`);
  return `${n} ${form}`;
}
