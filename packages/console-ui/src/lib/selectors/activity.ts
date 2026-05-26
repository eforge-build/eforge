/**
 * Activity view selectors: display model types, family/scope/attention
 * classification, identifier extraction, event summary helper, timestamp
 * helpers, filtering, grouping, and sorting.
 *
 * All imports come from browser-safe client exports only.
 */
import type { EforgeEvent } from '@eforge-build/client/browser';
import { getEventSummary, eventRegistry } from '@eforge-build/client/browser';
import type { EventScope } from '@eforge-build/client/browser';
import type { ConsoleActivityEntry } from '@/lib/types';
import { selectPrdDisplayLabel } from '@/lib/selectors/labels';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ActivityFamily =
  | 'all'
  | 'daemon'
  | 'scheduler'
  | 'queue'
  | 'session'
  | 'agent'
  | 'extension'
  | 'stack'
  | 'other';

export interface ActivityFilterState {
  family: ActivityFamily;
  attentionOnly: boolean;
  typeQuery: string;
  identifierQuery: string;
}

export const defaultActivityFilters: ActivityFilterState = {
  family: 'all',
  attentionOnly: false,
  typeQuery: '',
  identifierQuery: '',
};

export interface ActivityEventRowModel {
  id: string;
  event: EforgeEvent;
  eventType: EforgeEvent['type'];
  family: Exclude<ActivityFamily, 'all'>;
  scope: EventScope | 'unknown';
  summary: string;
  timestampLabel: string;
  receivedLabel: string;
  identifiers: Array<{ label: string; value: string; rawValue?: string }>;
  source: string | null;
  attention: boolean;
  rawJson: string;
  receivedAt: number;
}

export type ActivityGroupCounts = Record<ActivityFamily, number>;

// ---------------------------------------------------------------------------
// Family classification
// ---------------------------------------------------------------------------

/**
 * Session-scoped event type prefixes. All events whose type starts with one of
 * these prefixes are classified as the 'session' family.
 */
const SESSION_PREFIXES = [
  'session:',
  'phase:',
  'planning:',
  'plan:',
  'expedition:',
  'landing:',
  'merge:',
  'validation:',
  'prd_validation:',
  'gap_close:',
  'acceptance_validation:',
  'reconciliation:',
  'cleanup:',
  'approval:',
  'recovery:',
  'schedule:',
  'config:',
] as const;

export function classifyFamily(event: EforgeEvent): Exclude<ActivityFamily, 'all'> {
  const t = event.type;

  if (t.startsWith('agent:')) return 'agent';
  if (t.startsWith('extension:')) return 'extension';
  if (t.startsWith('stack:')) return 'stack';

  // Scheduler: daemon:auto-build:*, daemon:scheduler:*, queue:*, and daemon:error
  // with source === 'scheduler' or 'auto-build'.
  if (t.startsWith('daemon:auto-build:') || t.startsWith('daemon:scheduler:')) return 'scheduler';
  if (t.startsWith('queue:')) return 'scheduler';
  if (t === 'daemon:error') {
    const e = event as unknown as Record<string, unknown>;
    const src = typeof e['source'] === 'string' ? e['source'] : '';
    if (src === 'scheduler' || src === 'auto-build') return 'scheduler';
  }

  // Queue: enqueue:* events (user-facing enqueueing actions)
  if (t.startsWith('enqueue:')) return 'queue';

  // Daemon: remaining daemon:* events (lifecycle, recovery, orphan, warning, error)
  if (t.startsWith('daemon:')) return 'daemon';

  // Session: session-scoped build events
  for (const prefix of SESSION_PREFIXES) {
    if (t.startsWith(prefix)) return 'session';
  }

  return 'other';
}

// ---------------------------------------------------------------------------
// Attention classification
// ---------------------------------------------------------------------------

const ATTENTION_TYPE_KEYWORDS = [
  'error',
  'failed',
  'failure',
  'warning',
  'blocked',
  'timeout',
  'cancel',
] as const;

const ATTENTION_STATUSES = new Set([
  'failed',
  'failure',
  'error',
  'cancelled',
  'canceled',
]);

export function classifyAttention(event: EforgeEvent): boolean {
  const t = event.type.toLowerCase();
  for (const keyword of ATTENTION_TYPE_KEYWORDS) {
    if (t.includes(keyword)) return true;
  }

  const e = event as unknown as Record<string, unknown>;

  const status = typeof e['status'] === 'string' ? e['status'] : undefined;
  if (status && ATTENTION_STATUSES.has(status.toLowerCase())) return true;

  const result = e['result'];
  if (result && typeof result === 'object' && result !== null) {
    const resultRecord = result as Record<string, unknown>;
    const resultStatus =
      typeof resultRecord['status'] === 'string' ? resultRecord['status'] : undefined;
    if (resultStatus && ATTENTION_STATUSES.has(resultStatus.toLowerCase())) return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Identifier extraction
// ---------------------------------------------------------------------------

const IDENTIFIER_FIELDS: Array<[string, string]> = [
  ['sessionId', 'Session'],
  ['runId', 'Run'],
  ['planId', 'Plan'],
  ['prdId', 'PRD'],
  ['planSet', 'Plan Set'],
  ['queueId', 'Queue'],
  ['id', 'ID'],
  ['agent', 'Agent'],
  ['source', 'Source'],
];

export function extractIdentifiers(event: EforgeEvent): Array<{ label: string; value: string; rawValue?: string }> {
  const e = event as unknown as Record<string, unknown>;
  const identifiers: Array<{ label: string; value: string; rawValue?: string }> = [];

  for (const [field, label] of IDENTIFIER_FIELDS) {
    const val = e[field];
    if (typeof val === 'string' && val) {
      // PRD and plan-set identifiers are typically slug-like; normalise them to
      // human-readable display labels while leaving other identifier fields raw.
      if (field === 'prdId' || field === 'planSet') {
        const displayValue = selectPrdDisplayLabel(undefined, val);
        // Preserve the raw slug so identifier searches against the original
        // value (e.g. "add-mcp-server-support") still match the row.
        identifiers.push({ label, value: displayValue, rawValue: val });
      } else {
        identifiers.push({ label, value: val });
      }
    }
  }

  return identifiers;
}

// ---------------------------------------------------------------------------
// Scope lookup
// ---------------------------------------------------------------------------

function getEventScope(event: EforgeEvent): EventScope | 'unknown' {
  const meta = (eventRegistry as Record<string, { scope: EventScope } | undefined>)[event.type];
  return meta?.scope ?? 'unknown';
}

// ---------------------------------------------------------------------------
// Summary helper
// ---------------------------------------------------------------------------

export function getActivityEventSummary(event: EforgeEvent): string {
  try {
    const summary = getEventSummary(event);
    if (summary !== undefined) return summary;
  } catch {
    // Registry summary function threw on an incomplete event payload — use fallback.
  }
  return `Event ${event.type}`;
}

// ---------------------------------------------------------------------------
// Timestamp helpers
// ---------------------------------------------------------------------------

export function formatTimestamp(ms: number): string {
  return new Date(ms).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

export function formatRelativeAge(ms: number, now: number): string {
  const diff = Math.max(0, now - ms);
  if (diff < 1000) return 'just now';
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  return `${Math.floor(diff / 3_600_000)}h ago`;
}

// ---------------------------------------------------------------------------
// Main selector: project activity entries to display rows
// ---------------------------------------------------------------------------

/**
 * Convert the raw activity ring buffer into sorted, decorated display rows.
 *
 * - Excludes daemon:heartbeat entries.
 * - Sorts newest-first by receivedAt, then by id descending for ties.
 * - `now` defaults to Date.now() and can be overridden for deterministic tests.
 */
export function selectActivityRows(
  activity: ConsoleActivityEntry[],
  now: number = Date.now(),
): ActivityEventRowModel[] {
  return activity
    .filter((entry) => entry.event.type !== 'daemon:heartbeat')
    .map((entry): ActivityEventRowModel => {
      const { event, id, receivedAt } = entry;
      const family = classifyFamily(event);
      const scope = getEventScope(event);
      const identifiers = extractIdentifiers(event);
      const e = event as unknown as Record<string, unknown>;
      const source = typeof e['source'] === 'string' ? e['source'] : null;

      return {
        id,
        event,
        eventType: event.type,
        family,
        scope,
        summary: getActivityEventSummary(event),
        timestampLabel: formatTimestamp(receivedAt),
        receivedLabel: formatRelativeAge(receivedAt, now),
        identifiers,
        source,
        attention: classifyAttention(event),
        rawJson: JSON.stringify(event, null, 2),
        receivedAt,
      };
    })
    .sort((a, b) => {
      const diff = b.receivedAt - a.receivedAt;
      if (diff !== 0) return diff;
      // Secondary: id descending for stable ordering when times match
      // Compare numerically when both ids are numeric strings to avoid
      // lexicographic ordering issues (e.g. "9" > "10" lexicographically).
      const bNum = Number(b.id);
      const aNum = Number(a.id);
      if (!isNaN(bNum) && !isNaN(aNum)) return bNum - aNum > 0 ? 1 : bNum - aNum < 0 ? -1 : 0;
      if (b.id > a.id) return 1;
      if (b.id < a.id) return -1;
      return 0;
    });
}

// ---------------------------------------------------------------------------
// Filter
// ---------------------------------------------------------------------------

/**
 * Apply client-side filters to a set of activity rows.
 * Returns a new array containing only rows that pass all active filters.
 */
export function filterActivityRows(
  rows: ActivityEventRowModel[],
  filters: ActivityFilterState,
): ActivityEventRowModel[] {
  return rows.filter((row) => {
    if (filters.family !== 'all' && row.family !== filters.family) return false;
    if (filters.attentionOnly && !row.attention) return false;
    if (filters.typeQuery) {
      const q = filters.typeQuery.toLowerCase();
      if (!row.eventType.toLowerCase().includes(q)) return false;
    }
    if (filters.identifierQuery) {
      const q = filters.identifierQuery.toLowerCase();
      // Include both normalized display values and raw slugs so that users can
      // search by either the human-readable label or the original identifier.
      const searchable = row.identifiers
        .flatMap((i) => (i.rawValue ? [i.value, i.rawValue] : [i.value]))
        .join(' ')
        .toLowerCase();
      if (!searchable.includes(q)) return false;
    }
    return true;
  });
}

// ---------------------------------------------------------------------------
// Group / count
// ---------------------------------------------------------------------------

const ZERO_COUNTS: ActivityGroupCounts = {
  all: 0,
  daemon: 0,
  scheduler: 0,
  queue: 0,
  session: 0,
  agent: 0,
  extension: 0,
  stack: 0,
  other: 0,
};

/**
 * Count rows per family. `all` equals total row count.
 * Pass the unfiltered row set to get per-chip totals.
 */
export function groupActivityRows(rows: ActivityEventRowModel[]): ActivityGroupCounts {
  const counts: ActivityGroupCounts = { ...ZERO_COUNTS, all: rows.length };
  for (const row of rows) {
    counts[row.family]++;
  }
  return counts;
}
