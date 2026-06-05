import { isAbsolute, relative, resolve } from 'node:path';
import type { EforgeEvent } from '../../../packages/extension-sdk/src/index.js';
import { updateBacklogItemFrontmatter } from './markdown-store.js';
import {
  listTraceSidecars,
  updateLastEventMetadata,
  upsertBuildRun,
  upsertBuildSession,
  upsertLandingResult,
  upsertQueuePrd,
  type TraceLastEventMetadata,
  type TraceSidecar,
} from './trace-store.js';
import type { BacklogStatus } from './backlog-domain.js';

export interface LifecycleCorrelation {
  kind: 'none' | 'single' | 'ambiguous';
  itemId?: string;
  reason: string;
}

export interface LifecycleDecision {
  correlation: LifecycleCorrelation;
  trace?: TraceMutation;
  status?: BacklogStatus;
}

export type TraceMutation =
  | { kind: 'queue-prd'; prdId: string; status: string; path?: string; queuedAt?: string }
  | { kind: 'build-run'; runId: string; sessionId: string; status: string; startedAt?: string; completedAt?: string }
  | { kind: 'build-session'; sessionId: string; runId?: string; status: string; startedAt?: string; completedAt?: string }
  | { kind: 'landing'; featureBranch?: string; commitSha?: string; status: string; landedAt?: string; prUrl?: string };

export function correlateLifecycleEvent(event: EforgeEvent | Record<string, unknown>, traces: readonly TraceSidecar[], cwd?: string): LifecycleCorrelation {
  const keys = eventCorrelationKeys(event, cwd);
  const matches = traces.filter((trace) => traceMatches(trace, keys));
  if (matches.length === 1) return { kind: 'single', itemId: matches[0].itemId, reason: 'matched trace evidence' };
  if (matches.length > 1) return { kind: 'ambiguous', reason: `matched ${matches.length} trace sidecars` };
  const directItemId = directInputItemId(event);
  if (directItemId) return { kind: 'single', itemId: directItemId, reason: 'matched eforge-plan input source item id' };
  return { kind: 'none', reason: 'no matching trace evidence' };
}

export function decideLifecycleUpdate(event: EforgeEvent | Record<string, unknown>, traces: readonly TraceSidecar[], cwd?: string): LifecycleDecision {
  const correlation = correlateLifecycleEvent(event, traces, cwd);
  const trace = correlation.kind === 'single' ? traceMutationForEvent(event) : undefined;
  const status = correlation.kind === 'single' ? statusForEvent(event) : undefined;
  return { correlation, trace, status };
}

export async function applyLifecycleEvent(cwd: string, event: EforgeEvent | Record<string, unknown>): Promise<LifecycleDecision> {
  const traces = await listTraceSidecars(cwd);
  const decision = decideLifecycleUpdate(event, traces, cwd);
  if (decision.correlation.kind !== 'single' || !decision.correlation.itemId) {
    return decision;
  }
  const itemId = decision.correlation.itemId;
  const trace = traces.find((candidate) => candidate.itemId === itemId);
  await applyTraceMutation(cwd, itemId, trace?.epicId, decision.trace);
  await updateLastEventMetadata(cwd, itemId, lastEventMetadata(event), trace?.epicId);
  if (decision.status === 'shipped') {
    await updateBacklogItemFrontmatter(cwd, itemId, { status: 'shipped', updated: timestampOf(event) });
  }
  return decision;
}

export function eventCorrelationKeys(event: EforgeEvent | Record<string, unknown>, cwd?: string): Set<string> {
  const keys = new Set<string>();
  for (const field of ['source', 'filePath', 'path', 'prdId', 'id', 'sessionId', 'runId', 'featureBranch', 'commitSha']) {
    addKey(keys, valueAt(event, field), cwd);
  }
  const source = stringValue(valueAt(event, 'source'));
  if (source?.startsWith('eforge://input/eforge-plan/')) {
    addKey(keys, decodeURIComponent(source.slice('eforge://input/eforge-plan/'.length)), cwd);
  }
  return keys;
}

function traceMatches(trace: TraceSidecar, keys: Set<string>): boolean {
  if (keys.has(trace.itemId)) return true;
  return trace.promotedSessionPlans.some((entry) => hasAny(keys, [entry.session, entry.path]))
    || trace.queuePrds.some((entry) => hasAny(keys, [entry.prdId, entry.path]))
    || trace.buildRuns.some((entry) => hasAny(keys, [entry.runId, entry.sessionId]))
    || trace.buildSessions.some((entry) => hasAny(keys, [entry.sessionId, entry.runId]))
    || trace.landingResults.some((entry) => hasAny(keys, [entry.featureBranch, entry.commitSha]))
    || hasAny(keys, [trace.lastEvent?.sessionId, trace.lastEvent?.runId, trace.lastEvent?.source, trace.lastEvent?.filePath, trace.lastEvent?.path, trace.lastEvent?.id]);
}

function traceMutationForEvent(event: EforgeEvent | Record<string, unknown>): TraceMutation | undefined {
  const type = stringValue(valueAt(event, 'type'));
  const timestamp = timestampOf(event);
  if (type === 'enqueue:complete') {
    const prdId = stringValue(valueAt(event, 'id'));
    return prdId ? { kind: 'queue-prd', prdId, path: stringValue(valueAt(event, 'filePath')), status: 'queued', queuedAt: timestamp } : undefined;
  }
  if (type === 'queue:prd:start' || type === 'queue:prd:complete') {
    const prdId = stringValue(valueAt(event, 'prdId'));
    return prdId ? { kind: 'queue-prd', prdId, status: type === 'queue:prd:start' ? 'running' : stringValue(valueAt(event, 'status')) ?? 'completed', queuedAt: timestamp } : undefined;
  }
  if (type === 'session:start' || type === 'session:end') {
    const sessionId = stringValue(valueAt(event, 'sessionId'));
    const runId = stringValue(valueAt(event, 'runId'));
    if (!sessionId) return undefined;
    return { kind: 'build-session', sessionId, runId, status: type === 'session:start' ? 'running' : sessionEndStatus(event), startedAt: type === 'session:start' ? timestamp : undefined, completedAt: type === 'session:end' ? timestamp : undefined };
  }
  if (type === 'landing:complete') {
    return landingMutation(stringValue(valueAt(event, 'featureBranch')), stringValue(valueAt(event, 'commitSha')), landingStatus(event), timestamp, stringValue(valueAt(event, 'prUrl')));
  }
  if (type === 'landing:auto-merge:complete') {
    return landingMutation(stringValue(valueAt(event, 'featureBranch')), undefined, 'auto-merged', timestamp, stringValue(valueAt(event, 'prUrl')));
  }
  return undefined;
}

function landingMutation(featureBranch: string | undefined, commitSha: string | undefined, status: string, landedAt: string, prUrl?: string): TraceMutation | undefined {
  if (featureBranch) return { kind: 'landing', featureBranch, commitSha, status, landedAt, prUrl };
  if (commitSha) return { kind: 'landing', commitSha, status, landedAt, prUrl };
  return undefined;
}

function statusForEvent(event: EforgeEvent | Record<string, unknown>): BacklogStatus | undefined {
  const type = stringValue(valueAt(event, 'type'));
  if (type === 'landing:auto-merge:complete') return 'shipped';
  if (type === 'landing:complete' && valueAt(event, 'action') === 'merge' && stringValue(valueAt(event, 'commitSha'))) return 'shipped';
  return undefined;
}

async function applyTraceMutation(cwd: string, itemId: string, epicId: string | undefined, mutation: TraceMutation | undefined): Promise<void> {
  if (!mutation) return;
  if (mutation.kind === 'queue-prd') await upsertQueuePrd(cwd, itemId, { prdId: mutation.prdId, path: mutation.path, status: mutation.status, queuedAt: mutation.queuedAt }, epicId);
  if (mutation.kind === 'build-run') await upsertBuildRun(cwd, itemId, { runId: mutation.runId, sessionId: mutation.sessionId, status: mutation.status, startedAt: mutation.startedAt, completedAt: mutation.completedAt }, epicId);
  if (mutation.kind === 'build-session') await upsertBuildSession(cwd, itemId, { sessionId: mutation.sessionId, runId: mutation.runId, status: mutation.status, startedAt: mutation.startedAt, completedAt: mutation.completedAt }, epicId);
  if (mutation.kind === 'landing' && mutation.featureBranch) await upsertLandingResult(cwd, itemId, { featureBranch: mutation.featureBranch, commitSha: mutation.commitSha, status: mutation.status, landedAt: mutation.landedAt, prUrl: mutation.prUrl }, epicId);
  if (mutation.kind === 'landing' && !mutation.featureBranch && mutation.commitSha) await upsertLandingResult(cwd, itemId, { commitSha: mutation.commitSha, status: mutation.status, landedAt: mutation.landedAt, prUrl: mutation.prUrl }, epicId);
}

function landingStatus(event: EforgeEvent | Record<string, unknown>): string {
  if (stringValue(valueAt(event, 'prUrl')) && valueAt(event, 'action') === 'pr') return 'pr-open';
  if (valueAt(event, 'action') === 'merge' && stringValue(valueAt(event, 'commitSha'))) return 'merged';
  return String(valueAt(event, 'action') ?? 'complete');
}

function sessionEndStatus(event: EforgeEvent | Record<string, unknown>): string {
  const result = valueAt(event, 'result');
  return result && typeof result === 'object' && 'status' in result ? String((result as { status?: unknown }).status ?? 'completed') : 'completed';
}

function lastEventMetadata(event: EforgeEvent | Record<string, unknown>): TraceLastEventMetadata {
  return {
    type: stringValue(valueAt(event, 'type')),
    timestamp: timestampOf(event),
    sessionId: stringValue(valueAt(event, 'sessionId')),
    runId: stringValue(valueAt(event, 'runId')),
    source: stringValue(valueAt(event, 'source')),
    filePath: stringValue(valueAt(event, 'filePath')),
    path: stringValue(valueAt(event, 'path')),
    id: stringValue(valueAt(event, 'id')),
    cursor: numberValue(valueAt(event, 'cursor')),
  };
}

function directInputItemId(event: EforgeEvent | Record<string, unknown>): string | undefined {
  const source = stringValue(valueAt(event, 'source'));
  if (!source?.startsWith('eforge://input/eforge-plan/')) return undefined;
  return decodeURIComponent(source.slice('eforge://input/eforge-plan/'.length));
}

function timestampOf(event: EforgeEvent | Record<string, unknown>): string {
  return stringValue(valueAt(event, 'timestamp')) ?? new Date().toISOString();
}

function hasAny(keys: Set<string>, values: Array<string | undefined>): boolean {
  return values.some((value) => value !== undefined && keys.has(value));
}

function addKey(keys: Set<string>, value: unknown, cwd?: string): void {
  const normalized = stringValue(value);
  if (!normalized) return;
  addPathVariants(keys, normalized, cwd);
}

function addPathVariants(keys: Set<string>, value: string, cwd?: string): void {
  keys.add(value);
  keys.add(value.replace(/\\/g, '/'));
  if (!cwd || value.includes('://')) return;
  const absolute = isAbsolute(value) ? value : resolve(cwd, value);
  const projectRelative = relative(cwd, absolute);
  keys.add(absolute);
  keys.add(absolute.replace(/\\/g, '/'));
  keys.add(projectRelative);
  keys.add(projectRelative.replace(/\\/g, '/'));
}

function valueAt(event: EforgeEvent | Record<string, unknown>, field: string): unknown {
  return (event as Record<string, unknown>)[field];
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
