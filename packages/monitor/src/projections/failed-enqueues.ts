import { basename, dirname } from 'node:path';
import type { EforgeEvent, FailedEnqueueInfo, FailedEnqueueRecoveryCommand, RunInfo } from '@eforge-build/client';
import type { MonitorDB } from '../db.js';
import { hydrateEforgeEvent } from './event-hydration.js';

interface FailedEnqueueEvidence {
  run: RunInfo;
  source?: string;
  error?: string;
  failedAt?: string;
  summary?: string;
}

export interface FailedEnqueueProjectionOptions { includeResolved?: boolean }

type DaemonFailedEnqueueResolvedEvent = EforgeEvent & { type: 'daemon:failed-enqueue:resolved'; runId: string; resolvedAt: string; newRunId?: string };
type DaemonFailedEnqueueUpsertEvent = EforgeEvent & { type: 'daemon:failed-enqueue:upsert'; failedEnqueue: FailedEnqueueInfo };

export function projectFailedEnqueues(db: MonitorDB, options: FailedEnqueueProjectionOptions = {}): FailedEnqueueInfo[] {
  const resolved = resolvedByRunId(db);
  const rows = db.getRuns()
    .filter((run) => run.command === 'enqueue' && run.status === 'failed')
    .map((run) => projectRun(db, run, resolved.get(run.id)))
    .filter((item): item is FailedEnqueueInfo => item !== undefined)
    .filter((item) => options.includeResolved === true || item.resolvedAt === undefined);
  rows.sort((a, b) => b.failedAt.localeCompare(a.failedAt) || a.runId.localeCompare(b.runId));
  return rows;
}

export function projectFailedEnqueueByRunId(db: MonitorDB, runId: string, options: FailedEnqueueProjectionOptions = {}): FailedEnqueueInfo | undefined {
  return projectFailedEnqueues(db, { includeResolved: options.includeResolved }).find((item) => item.runId === runId);
}

export function getFailedEnqueueSource(db: MonitorDB, runId: string): string | undefined {
  const run = db.getRunById(runId);
  if (!run || run.command !== 'enqueue' || run.status !== 'failed') return undefined;
  return collectEvidence(db, run).source;
}

export function buildFailedEnqueueUpsertEvent(db: MonitorDB, runId: string): DaemonFailedEnqueueUpsertEvent | undefined {
  const failedEnqueue = projectFailedEnqueueByRunId(db, runId, { includeResolved: true });
  if (!failedEnqueue) return undefined;
  return { type: 'daemon:failed-enqueue:upsert', timestamp: failedEnqueue.failedAt, failedEnqueue };
}

export function buildFailedEnqueueResolvedEvent(runId: string, resolvedAt: string, newRunId?: string): DaemonFailedEnqueueResolvedEvent {
  return { type: 'daemon:failed-enqueue:resolved', timestamp: resolvedAt, runId, resolvedAt, ...(newRunId !== undefined ? { newRunId } : {}) };
}

export function recordFailedEnqueueUpsert(db: MonitorDB, runId: string): DaemonFailedEnqueueUpsertEvent | undefined {
  const event = buildFailedEnqueueUpsertEvent(db, runId);
  if (!event) return undefined;
  db.insertDaemonEvent({ type: event.type, data: JSON.stringify(event), timestamp: event.timestamp });
  return event;
}

export function recordFailedEnqueueResolved(db: MonitorDB, runId: string, resolvedAt: string, newRunId?: string): DaemonFailedEnqueueResolvedEvent {
  const event = buildFailedEnqueueResolvedEvent(runId, resolvedAt, newRunId);
  db.insertDaemonEvent({ type: event.type, data: JSON.stringify(event), timestamp: event.timestamp });
  return event;
}

function resolvedByRunId(db: MonitorDB): Map<string, string> {
  const result = new Map<string, string>();
  for (const row of db.getDaemonEventsAfter(0)) {
    if (row.type !== 'daemon:failed-enqueue:resolved') continue;
    const event = hydrateEforgeEvent(row) as DaemonFailedEnqueueResolvedEvent | null;
    if (event?.type === 'daemon:failed-enqueue:resolved') result.set(event.runId, event.resolvedAt);
  }
  return result;
}

function projectRun(db: MonitorDB, run: RunInfo, resolvedAt?: string): FailedEnqueueInfo | undefined {
  const evidence = collectEvidence(db, run);
  const failedAt = evidence.failedAt ?? run.completedAt ?? run.startedAt;
  const failureReason = safeProjectionText(evidence.error ?? evidence.summary ?? 'Enqueue failed', 500);
  const hasSource = typeof evidence.source === 'string' && evidence.source.trim().length > 0;
  const item: FailedEnqueueInfo = {
    runId: run.id,
    ...(run.sessionId !== undefined ? { sessionId: run.sessionId } : {}),
    sourceLabel: sourceLabel(evidence.source, run.planSet),
    provenance: { label: hasSource ? 'enqueue:start source' : 'run history' },
    failureReason,
    failedAt,
    canReenqueue: hasSource && resolvedAt === undefined,
    ...(resolvedAt !== undefined ? { resolvedAt } : {}),
  };
  if (hasSource) item.nextCommand = nextCommandForSource();
  else item.nextCommand = { executable: 'eforge', args: ['history', 'show', run.id] };
  if (!item.canReenqueue) item.disabledReason = resolvedAt !== undefined ? 'This failed enqueue has already been re-enqueued.' : 'Original enqueue source was not recorded; inspect Build history and rerun the original enqueue command.';
  return item;
}

function collectEvidence(db: MonitorDB, run: RunInfo): FailedEnqueueEvidence {
  const evidence: FailedEnqueueEvidence = { run };
  for (const row of db.getEvents(run.id)) {
    const event = hydrateEforgeEvent(row);
    if (!event) continue;
    if (event.type === 'enqueue:start' && typeof event.source === 'string' && event.source.trim()) evidence.source = event.source;
    if (event.type === 'enqueue:failed') {
      if (typeof event.error === 'string' && event.error.trim()) evidence.error = event.error;
      evidence.failedAt = event.timestamp;
    }
    if (event.type === 'session:end' && event.result && typeof event.result === 'object') {
      const summary = (event.result as { summary?: unknown }).summary;
      if (typeof summary === 'string' && summary.trim()) evidence.summary = summary;
    }
  }
  return evidence;
}

function sourceLabel(source: string | undefined, planSet: string): string {
  const trimmed = source?.trim();
  if (!trimmed) return safeProjectionText(planSet.trim() || 'Unknown source', 120);
  if (!trimmed.includes('\n') && resemblesPath(trimmed)) {
    const base = basename(trimmed);
    const parent = basename(dirname(trimmed));
    return safeProjectionText(parent && parent !== '.' ? `${parent}/${base}` : base, 120);
  }
  return trimmed.includes('\n') ? 'Inline enqueue source (redacted)' : 'Enqueue source (redacted)';
}

function resemblesPath(value: string): boolean {
  return value.length <= 240
    && !/[\s=:]/u.test(value)
    && !/(?:token|secret|password|passwd|pwd|authorization|api[_-]?key)/iu.test(value)
    && (value.includes('/') || value.includes('\\') || /\.[\w-]+$/.test(value));
}

function nextCommandForSource(): FailedEnqueueRecoveryCommand {
  return { executable: 'eforge', args: ['enqueue', '<redacted-source>'] };
}

function safeProjectionText(value: string, maxLength: number): string {
  const redacted = value
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+\/=-]{16,}/giu, '$1[REDACTED]')
    .replace(/\b((?:[A-Za-z0-9_.-]*(?:password|passwd|pwd|token|secret|authorization|api[_-]?key|access[_-]?key|private[_-]?key)[A-Za-z0-9_.-]*)\s*(?:=|:)\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s"',;]+)/giu, '$1[REDACTED]')
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/gu, '[REDACTED_JWT]')
    .replace(/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9_]{20,}\b/gu, '[REDACTED_GITHUB_TOKEN]')
    .replace(/\bnpm_[A-Za-z0-9]{20,}\b/gu, '[REDACTED_NPM_TOKEN]')
    .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  return redacted.length > maxLength ? `${redacted.slice(0, maxLength - 1)}…` : redacted;
}
