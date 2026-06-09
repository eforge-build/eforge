const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Compact relative form ("just now", "18m ago", "3h ago", "2d ago") for
 * daemon-produced ISO timestamps. Falls back to a short calendar date past a
 * week. Call sites keep the precise timestamp available via a title attribute.
 */
export function formatRelativeTime(iso: string | undefined | null, nowMs: number = Date.now()): string | null {
  if (!iso) return null;
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return null;
  const diff = nowMs - then;
  const elapsed = Math.abs(diff);
  if (elapsed < MINUTE) return 'just now';
  if (elapsed >= 7 * DAY) {
    const date = new Date(then);
    const sameYear = date.getFullYear() === new Date(nowMs).getFullYear();
    return date.toLocaleDateString(undefined, sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' });
  }
  const value = elapsed < HOUR ? `${Math.floor(elapsed / MINUTE)}m`
    : elapsed < DAY ? `${Math.floor(elapsed / HOUR)}h`
    : `${Math.floor(elapsed / DAY)}d`;
  return diff < 0 ? `in ${value}` : `${value} ago`;
}

/**
 * Compact display form for daemon task ids: UUID-shaped ids like
 * "task-1eed3666-7341-4916-8c19-e66e4a93220d" collapse to "task-1eed3666";
 * anything else passes through unchanged.
 */
export function shortTaskId(taskId: string): string {
  const match = /^(task-[0-9a-f]{8})-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.exec(taskId);
  return match ? match[1] : taskId;
}
