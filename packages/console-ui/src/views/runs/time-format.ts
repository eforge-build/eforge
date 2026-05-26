// --- eforge:region runs-build-entrypoints ---

/**
 * Format an ISO timestamp as a localized absolute date-time string.
 * Returns the raw string unchanged if it cannot be parsed.
 */
export function formatAbsolute(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Format a duration in seconds.
 * Renders as "Xm Ys" when >= 60s, else "Xs".
 */
export function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return `${Math.round(seconds)}s`;
  }
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

/**
 * Format a timestamp as a relative age string, e.g. "2m ago".
 * `nowMs` defaults to `Date.now()` for testability.
 */
export function formatRelativeAge(iso: string, nowMs: number = Date.now()): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const diffSeconds = Math.floor((nowMs - d.getTime()) / 1000);
  if (diffSeconds < 5) return 'just now';
  if (diffSeconds < 60) return `${diffSeconds}s ago`;
  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes}m ago`;
  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}
// --- eforge:endregion runs-build-entrypoints ---
