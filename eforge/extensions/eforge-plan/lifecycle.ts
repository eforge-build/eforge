import { readFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import type { EforgeEvent } from '@eforge-build/extension-sdk';
import { parseMarkdownRecord, readBacklogItem } from './markdown-store.js';
import { listTraceSidecars, type TraceSidecar } from './trace-store.js';
import { recordCanonicalLifecycleEvent } from './canonical/lifecycle-records.js';
import { withCanonicalTransaction } from './canonical/store.js';
import { getDatabase } from './sqlite/store-internal.js';
import type { BacklogItem, BacklogStatus } from './backlog-domain.js';
import { markRecommendationsStaleForLifecycleUpdate } from './recommendation-status.js';

export interface LifecycleCorrelation {
  kind: 'none' | 'single' | 'multi' | 'ambiguous';
  itemId?: string;
  itemIds?: string[];
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
  if (matches.length > 1 && canApplyMultiSourceCorrelation(matches, keys)) {
    return { kind: 'multi', itemIds: matches.map((trace) => trace.itemId), reason: 'matched shared promoted plan trace evidence' };
  }
  if (matches.length > 1) return { kind: 'ambiguous', reason: `matched ${matches.length} trace sidecars` };
  const directItemId = directInputItemId(event);
  if (directItemId) return { kind: 'single', itemId: directItemId, reason: 'matched eforge-plan input source item id' };
  return { kind: 'none', reason: 'no matching trace evidence' };
}

export function decideLifecycleUpdate(event: EforgeEvent | Record<string, unknown>, traces: readonly TraceSidecar[], cwd?: string): LifecycleDecision {
  const correlation = correlateLifecycleEvent(event, traces, cwd);
  const trace = correlation.kind === 'single' || correlation.kind === 'multi' ? traceMutationForEvent(event) : undefined;
  const status = correlation.kind === 'single' || correlation.kind === 'multi' ? statusForEvent(event) : undefined;
  return { correlation, trace, status };
}

export async function applyLifecycleEvent(cwd: string, event: EforgeEvent | Record<string, unknown>): Promise<LifecycleDecision> {
  const traces = await listTraceSidecars(cwd);
  const decision = decideLifecycleUpdate(event, traces, cwd);
  let itemIds = decision.correlation.kind === 'single'
    ? [decision.correlation.itemId].filter((itemId): itemId is string => itemId !== undefined)
    : decision.correlation.kind === 'multi'
      ? decision.correlation.itemIds ?? []
      : [];
  let bootstrapped: { itemIds: string[]; epicIdsByItemId: Map<string, string | undefined> } | undefined;
  if (itemIds.length === 0 && decision.correlation.kind === 'none') {
    itemIds = canonicalLifecycleItemRefs(cwd, event);
  }
  if (itemIds.length === 0 && decision.correlation.kind === 'none') {
    bootstrapped = await bootstrapItemFromQueuedPrd(cwd, event);
    itemIds = bootstrapped?.itemIds ?? [];
  }
  if (itemIds.length === 0) {
    return decision;
  }
  const traceMutation = decision.trace ?? (bootstrapped ? traceMutationForEvent(event) : undefined);
  void traceMutation;
  recordCanonicalLifecycleEvent(cwd, event, itemIds);
  const effectiveCorrelation = decision.correlation.kind === 'none' && bootstrapped
    ? bootstrapped.itemIds.length === 1
      ? { kind: 'single' as const, itemId: bootstrapped.itemIds[0]!, reason: 'bootstrapped from queued eforge-plan PRD' }
      : { kind: 'multi' as const, itemIds: bootstrapped.itemIds, reason: 'bootstrapped from queued eforge-plan PRD source items' }
    : decision.correlation;
  if (itemIds.length > 0) {
    const eventType = stringValue(valueAt(event, 'type')) ?? 'unknown';
    await markRecommendationsStaleForLifecycleUpdate(cwd, {
      eventType,
      itemIds,
      correlationKind: bootstrapped ? 'bootstrapped' : effectiveCorrelation.kind === 'multi' ? 'multi' : 'single',
      timestamp: timestampOf(event),
      summary: lifecycleReasonSummary(eventType, itemIds, bootstrapped ? 'bootstrapped' : effectiveCorrelation.kind === 'multi' ? 'multi' : 'single', lifecycleReasonRefs(event)),
      refs: lifecycleReasonRefs(event),
    });
  }
  return decision.correlation.kind === 'none' && bootstrapped
    ? { ...decision, correlation: effectiveCorrelation, trace: traceMutation }
    : decision;
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
  return traceMatchesSharedLifecycleEvidence(trace, keys)
    || hasAny(keys, [trace.lastEvent?.sessionId, trace.lastEvent?.runId, trace.lastEvent?.source, trace.lastEvent?.filePath, trace.lastEvent?.path, trace.lastEvent?.id]);
}

function canApplyMultiSourceCorrelation(matches: readonly TraceSidecar[], keys: Set<string>): boolean {
  return matches.every((trace) => traceMatchesSharedLifecycleEvidence(trace, keys));
}

function traceMatchesSharedLifecycleEvidence(trace: TraceSidecar, keys: Set<string>): boolean {
  return trace.promotedSessionPlans.some((entry) => hasAny(keys, [entry.session, entry.path]))
    || trace.queuePrds.some((entry) => hasAny(keys, [entry.prdId, entry.path]))
    || trace.buildRuns.some((entry) => hasAny(keys, [entry.runId, entry.sessionId]))
    || trace.buildSessions.some((entry) => hasAny(keys, [entry.sessionId, entry.runId]))
    || trace.landingResults.some((entry) => hasAny(keys, [entry.featureBranch, entry.commitSha]));
}

function canonicalLifecycleItemRefs(cwd: string, event: EforgeEvent | Record<string, unknown>): string[] {
  const keys = [...eventCorrelationKeys(event, cwd)];
  if (keys.length === 0) return [];
  return withCanonicalTransaction(cwd, (store) => {
    const db = getDatabase(store);
    const refs = new Set<string>();
    for (const key of keys) {
      const rows = db.prepare(`SELECT DISTINCT spi.item_ref FROM session_plan_items spi JOIN session_plans sp ON sp.session = spi.session LEFT JOIN queue_prds qp ON qp.session = sp.session LEFT JOIN build_runs br ON br.queue_prd_id = qp.prd_id OR br.session = sp.session LEFT JOIN build_sessions bs ON bs.session = sp.session LEFT JOIN landing_links ll ON ll.session = sp.session WHERE sp.session = ? OR sp.path = ? OR qp.prd_id = ? OR qp.source_path = ? OR br.run_id = ? OR bs.build_session_id = ? OR ll.landing_id = ? OR ll.pr_url = ? OR ll.feature_branch = ? OR ll.commit_sha = ?`).all(key, key, key, key, key, key, key, key, key, key) as Array<{ item_ref?: unknown }>;
      for (const row of rows) if (typeof row.item_ref === 'string') refs.add(row.item_ref);
    }
    return [...refs];
  });
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
    return landingMutation(stringValue(valueAt(event, 'featureBranch')), stringValue(valueAt(event, 'commitSha')), 'auto-merged', timestamp, stringValue(valueAt(event, 'prUrl')));
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

function landingStatus(event: EforgeEvent | Record<string, unknown>): string {
  if (stringValue(valueAt(event, 'prUrl')) && valueAt(event, 'action') === 'pr') return 'pr-open';
  if (valueAt(event, 'action') === 'merge' && stringValue(valueAt(event, 'commitSha'))) return 'merged';
  return String(valueAt(event, 'action') ?? 'complete');
}

function sessionEndStatus(event: EforgeEvent | Record<string, unknown>): string {
  const result = valueAt(event, 'result');
  return result && typeof result === 'object' && 'status' in result ? String((result as { status?: unknown }).status ?? 'completed') : 'completed';
}

function directInputItemId(event: EforgeEvent | Record<string, unknown>): string | undefined {
  const source = stringValue(valueAt(event, 'source'));
  if (!source?.startsWith('eforge://input/eforge-plan/')) return undefined;
  return decodeURIComponent(source.slice('eforge://input/eforge-plan/'.length));
}

function lifecycleReasonRefs(event: EforgeEvent | Record<string, unknown>): string[] {
  return ['source', 'filePath', 'path', 'prdId', 'id', 'sessionId', 'runId', 'featureBranch', 'commitSha']
    .map((field) => stringValue(valueAt(event, field)))
    .filter((value): value is string => value !== undefined);
}

function lifecycleReasonSummary(eventType: string, itemIds: readonly string[], correlationKind: 'single' | 'multi' | 'bootstrapped', refs: readonly string[]): string {
  const refSummary = refs.length > 0 ? `; refs: ${refs.slice(0, 5).join(', ')}` : '';
  return `Recommendations are stale after ${correlationKind} lifecycle update ${eventType} for ${itemIds.join(', ')}${refSummary}.`.slice(0, 500);
}

async function bootstrapItemFromQueuedPrd(cwd: string, event: EforgeEvent | Record<string, unknown>): Promise<{ itemIds: string[]; epicIdsByItemId: Map<string, string | undefined> } | undefined> {
  if (valueAt(event, 'type') !== 'enqueue:complete') return undefined;
  const filePath = stringValue(valueAt(event, 'filePath'));
  if (!filePath) return undefined;
  try {
    const raw = await readFile(isAbsolute(filePath) ? filePath : resolve(cwd, filePath), 'utf-8');
    const itemIds = extractSourceItemIds(raw);
    if (itemIds.length === 0) return undefined;
    const items = (await Promise.all(itemIds.map((itemId) => readBacklogItem(cwd, itemId)))).filter((item): item is BacklogItem => item !== null);
    return items.length > 0 ? { itemIds: items.map((item) => item.id), epicIdsByItemId: new Map(items.map((item) => [item.id, item.epic])) } : undefined;
  } catch {
    return undefined;
  }
}

function extractSourceItemIds(markdown: string): string[] {
  const eforgePlan = parseMarkdownRecord(markdown).frontmatter.eforge_plan;
  if (eforgePlan && typeof eforgePlan === 'object') {
    const sourceItemIds = (eforgePlan as { source_item_ids?: unknown }).source_item_ids;
    if (Array.isArray(sourceItemIds)) return sourceItemIds.filter((itemId): itemId is string => typeof itemId === 'string' && itemId.length > 0);
    const sourceItemId = (eforgePlan as { source_item_id?: unknown }).source_item_id;
    if (typeof sourceItemId === 'string' && sourceItemId.length > 0) return [sourceItemId];
  }
  const itemId = firstRegexCapture(markdown, /Backlog item id:\s*([^\s]+)/i);
  return itemId ? [itemId] : [];
}

function firstRegexCapture(value: string, pattern: RegExp): string | undefined {
  const match = value.match(pattern);
  return match?.[1];
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
