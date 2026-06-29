import { isFailedRunStatus, safeParseEforgeEvent, type EforgeEvent, type RunInfo, type DaemonStreamSnapshot } from '@eforge-build/client';
import type { EventRecord } from '../db.js';

export function parseEventRow(eventData: string, dbTimestamp: string, dbType: string, rowId?: number): EforgeEvent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(eventData) as unknown;
  } catch {
    process.stderr.write(`[parseEventRow] unparseable JSON${rowId !== undefined ? ` id=${rowId}` : ''}\n`);
    return null;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    process.stderr.write(`[parseEventRow] invalid event${rowId !== undefined ? ` id=${rowId}` : ''}: <root>\n`);
    return null;
  }
  const event = parsed as Record<string, unknown>;
  if (!event.timestamp) event.timestamp = dbTimestamp;
  if (!event.type && dbType) event.type = dbType;
  const result = safeParseEforgeEvent(event);
  if (!result.success) {
    const errorPath = result.error.errors.map((e) => e.path).join(', ');
    process.stderr.write(`[parseEventRow] invalid event${rowId !== undefined ? ` id=${rowId}` : ''}: ${errorPath}\n`);
    return null;
  }
  return result.data;
}

export function hydrateEforgeEvent(row: EventRecord): EforgeEvent | null {
  return parseEventRow(row.data, row.timestamp, row.type, row.id);
}

export function hydrateEventRecordForRunState(row: EventRecord): { id: number; runId: string; type: string; planId?: string; agent?: string; data: string; timestamp: string } | null {
  const parsed = hydrateEforgeEvent(row);
  if (!parsed) return null;
  return { id: row.id, runId: row.runId ?? '', type: row.type, ...(row.planId !== undefined ? { planId: row.planId } : {}), ...(row.agent !== undefined ? { agent: row.agent } : {}), data: JSON.stringify(parsed), timestamp: row.timestamp };
}

export function hydrateRecentDaemonActivity(rows: EventRecord[], helloCursor: number): DaemonStreamSnapshot['recentActivity'] {
  return rows.map((row) => {
    const event = hydrateEforgeEvent(row);
    return event !== null ? { id: row.id, event } : null;
  }).filter((x): x is DaemonStreamSnapshot['recentActivity'][number] => x !== null && x.id <= helloCursor);
}

export function deriveSessionStreamStatus(sessionRuns: RunInfo[]): 'pending' | 'running' | 'failed' | 'completed' {
  if (sessionRuns.length === 0) return 'pending';
  if (sessionRuns.some((r) => r.status === 'running')) return 'running';
  if (sessionRuns.some((r) => isFailedRunStatus(r.status))) return 'failed';
  return 'completed';
}

export function deriveRunStateStatus(sessionRuns: RunInfo[]): 'unknown' | 'running' | 'failed' | 'completed' {
  if (sessionRuns.length === 0) return 'unknown';
  if (sessionRuns.some((r) => r.status === 'running')) return 'running';
  if (sessionRuns.some((r) => isFailedRunStatus(r.status))) return 'failed';
  return 'completed';
}
