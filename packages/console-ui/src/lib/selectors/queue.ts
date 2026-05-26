// --- eforge:region plan-02-queue-view ---
/**
 * Queue view selectors: UI-derived types and pure functions for summarising,
 * grouping, sorting, and filtering QueueItem[] data.
 *
 * All imports come from browser-safe client exports only.
 */
import type { QueueItem } from '@eforge-build/client/browser';
import { selectPrdDisplayLabel } from '@/lib/selectors/labels';

// ---------------------------------------------------------------------------
// UI-derived types
// ---------------------------------------------------------------------------

export interface QueueSummary {
  total: number;
  running: number;
  pending: number;
  failed: number;
  waiting: number;
  withDependencies: number;
  withRecoveryVerdict: number;
  recoveryPending: number;
}

export interface QueueStatusGroup {
  /** The status string for this group (canonical or unknown). */
  status: string;
  /** Display label for the group heading. */
  label: string;
  /** Whether this is a recognised/known status. */
  known: boolean;
  items: QueueItem[];
}

// ---------------------------------------------------------------------------
// Known status sets
// ---------------------------------------------------------------------------

const KNOWN_STATUSES = new Set(['running', 'pending', 'failed', 'waiting']);

/** Canonical display order for known status groups. */
const KNOWN_STATUS_ORDER: string[] = ['running', 'pending', 'waiting', 'failed'];

const STATUS_LABELS: Record<string, string> = {
  running: 'Running',
  pending: 'Pending',
  failed: 'Failed',
  waiting: 'Waiting',
};

// ---------------------------------------------------------------------------
// selectQueueSummary
// ---------------------------------------------------------------------------

/**
 * Derive summary counts from a QueueItem array.
 */
export function selectQueueSummary(items: QueueItem[]): QueueSummary {
  let running = 0;
  let pending = 0;
  let failed = 0;
  let waiting = 0;
  let withDependencies = 0;
  let withRecoveryVerdict = 0;
  let recoveryPending = 0;

  for (const item of items) {
    const s = item.status.toLowerCase();
    if (s === 'running') running++;
    else if (s === 'pending') pending++;
    else if (s === 'failed') failed++;
    else if (s === 'waiting') waiting++;

    if (item.dependsOn && item.dependsOn.length > 0) withDependencies++;

    if (s === 'failed') {
      if (item.recoveryVerdict) {
        withRecoveryVerdict++;
      } else {
        recoveryPending++;
      }
    }
  }

  return {
    total: items.length,
    running,
    pending,
    failed,
    waiting,
    withDependencies,
    withRecoveryVerdict,
    recoveryPending,
  };
}

// ---------------------------------------------------------------------------
// Item sorting helper
// ---------------------------------------------------------------------------

/**
 * Sort QueueItem[] by priority ascending (lower number = higher priority),
 * then by created timestamp ascending for ties. Items missing priority sort
 * after items with priority.
 */
export function sortQueueItems(items: QueueItem[]): QueueItem[] {
  return [...items].sort((a, b) => {
    const aPriority = a.priority ?? Number.MAX_SAFE_INTEGER;
    const bPriority = b.priority ?? Number.MAX_SAFE_INTEGER;
    if (aPriority !== bPriority) return aPriority - bPriority;

    const aTime = a.created ? new Date(a.created).getTime() : 0;
    const bTime = b.created ? new Date(b.created).getTime() : 0;
    return aTime - bTime;
  });
}

// ---------------------------------------------------------------------------
// selectQueueAttentionItems
// ---------------------------------------------------------------------------

/**
 * Return failed items sorted by priority / created time.
 */
export function selectQueueAttentionItems(items: QueueItem[]): QueueItem[] {
  const failed = items.filter((item) => item.status.toLowerCase() === 'failed');
  return sortQueueItems(failed);
}

// ---------------------------------------------------------------------------
// selectQueueStatusGroups
// ---------------------------------------------------------------------------

/**
 * Group QueueItem[] by status. Known statuses are ordered canonically;
 * unknown status strings are appended after the known groups, sorted
 * lexicographically.
 */
export function selectQueueStatusGroups(items: QueueItem[]): QueueStatusGroup[] {
  const groupMap = new Map<string, QueueItem[]>();

  for (const item of items) {
    const rawStatus = item.status;
    const lowerStatus = rawStatus.toLowerCase();
    // Normalize known statuses to canonical lowercase for correct grouping and
    // filtering. Unknown statuses keep their original casing as the map key so
    // the verbatim string is preserved for display in the group label.
    const statusKey = KNOWN_STATUSES.has(lowerStatus) ? lowerStatus : rawStatus;
    const existing = groupMap.get(statusKey);
    if (existing) {
      existing.push(item);
    } else {
      groupMap.set(statusKey, [item]);
    }
  }

  const groups: QueueStatusGroup[] = [];

  // Add known groups in canonical order
  for (const status of KNOWN_STATUS_ORDER) {
    const groupItems = groupMap.get(status);
    if (groupItems && groupItems.length > 0) {
      groups.push({
        status,
        label: STATUS_LABELS[status] ?? status,
        known: true,
        items: sortQueueItems(groupItems),
      });
    }
  }

  // Add unknown status groups in lexicographic order
  const unknownStatuses = [...groupMap.keys()]
    .filter((s) => !KNOWN_STATUSES.has(s))
    .sort();

  for (const status of unknownStatuses) {
    const groupItems = groupMap.get(status)!;
    groups.push({
      status,
      label: status,
      known: false,
      items: sortQueueItems(groupItems),
    });
  }

  return groups;
}
// ---------------------------------------------------------------------------
// selectQueueItemDisplayLabel
// ---------------------------------------------------------------------------

/**
 * Derive a normalised display label for a QueueItem.
 *
 * Resolution order (via `selectPrdDisplayLabel`):
 * 1. `item.title` if present and not markdown-shaped.
 * 2. Slug-derived label from `item.id`.
 */
export function selectQueueItemDisplayLabel(item: QueueItem): string {
  return selectPrdDisplayLabel(item.title, item.id);
}
// --- eforge:endregion plan-02-queue-view ---
