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
 * Format a timestamp string or epoch ms to an absolute date+time locale string.
 * Used where an unambiguous absolute timestamp is needed (e.g. status strip footer).
 */
export function formatAbsoluteTimestamp(ts: string | number): string {
  try {
    const d = typeof ts === 'number' ? new Date(ts) : new Date(ts);
    if (isNaN(d.getTime())) return String(ts);
    return d.toLocaleString(undefined, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
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

/**
 * Compact a token/number count into a short human label.
 *
 * @example
 * compactTokens(950)       // "950"
 * compactTokens(12_400)    // "12.4K"
 * compactTokens(1_395_018) // "1.4M"
 */
export function compactTokens(n: number): string {
  if (!Number.isFinite(n)) return '0';
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return `${Math.round(n)}`;
}

/**
 * Format a USD dollar amount. Cents-precision below $1,000; whole-dollar with
 * thousands separators above (daily/weekly spend totals get large).
 *
 * @example
 * formatUsd(32.18)   // "$32.18"
 * formatUsd(0)       // "$0.00"
 * formatUsd(1214.5)  // "$1,215"
 */
export function formatUsd(n: number): string {
  if (!Number.isFinite(n)) return '$0.00';
  if (Math.abs(n) >= 1_000) return `$${Math.round(n).toLocaleString()}`;
  return `$${n.toFixed(2)}`;
}

/**
 * Shorten a provider model id for a compact label. Drops the redundant
 * `claude-` family prefix; other providers (e.g. `gpt-5.4`) pass through.
 *
 * @example
 * formatModelLabel('claude-opus-4-7') // "opus-4-7"
 * formatModelLabel('gpt-5.4')         // "gpt-5.4"
 */
export function formatModelLabel(model: string): string {
  return model.replace(/^claude-/, '');
}

/**
 * Compact label for the harness + provider that ran a model. Returns null when
 * no harness is known (historical spend), so callers can omit the context line.
 *
 * @example
 * formatHarnessLabel('claude-sdk', null)     // "claude-sdk"
 * formatHarnessLabel('pi', 'openrouter')     // "pi · openrouter"
 * formatHarnessLabel(null, null)             // null
 */
export function formatHarnessLabel(
  harness: string | null,
  provider: string | null,
): string | null {
  if (!harness) return null;
  return provider ? `${harness} · ${provider}` : harness;
}
