import type { EforgeEvent } from '@eforge-build/extension-sdk';
import type { EforgePlanStore, JsonValue, LifecycleState } from '../sqlite/index.js';
import { getBacklogItem, recordLifecycleEvent, recordLifecycleEvidence, upsertBacklogItem, upsertBuildRun, upsertBuildSession, upsertLandingLink, upsertQueuePrd } from '../sqlite/index.js';
import { getDatabase } from '../sqlite/store-internal.js';
import { markCanonicalSearchDirty } from './search-dirty.js';
import { canonicalNowIso, stableCanonicalId, withCanonicalTransaction } from './store.js';

export function recordCanonicalLifecycleEvent(cwd: string, event: EforgeEvent | Record<string, unknown>, itemRefs: string[] = []): void {
  withCanonicalTransaction(cwd, (store) => recordCanonicalLifecycleEventRecord(store, event, itemRefs));
}

export function recordCanonicalLifecycleEventRecord(store: EforgePlanStore, event: EforgeEvent | Record<string, unknown>, itemRefs: string[] = []): void {
  const type = stringValue(valueAt(event, 'type')) ?? 'unknown';
  const timestamp = stringValue(valueAt(event, 'timestamp')) ?? canonicalNowIso();
  const session = stringValue(valueAt(event, 'session'));
  const runId = stringValue(valueAt(event, 'runId'));
  const buildSessionId = stringValue(valueAt(event, 'buildSessionId')) ?? (type.startsWith('session:') ? stringValue(valueAt(event, 'sessionId')) : undefined);
  const queuePrdId = stringValue(valueAt(event, 'prdId')) ?? (type === 'enqueue:complete' ? stringValue(valueAt(event, 'id')) : undefined);
  const landingId = landingKey(event);
  const affected = itemRefs.length > 0 ? itemRefs : inferredItemRefs(event);
  const eventKey = stringValue(valueAt(event, 'eventKey')) ?? `${type}:${stableCanonicalId([type, timestamp, session, runId, buildSessionId, queuePrdId, landingId, affected])}`;
  recordLifecycleEvent(store, { eventKey, eventType: type, timestamp, session, runId, buildSessionId, queuePrdId, landingId, affectedItemRefs: affected, payload: jsonValue(event), payloadPrunable: true });
  if (queuePrdId) upsertQueuePrd(store, { prdId: queuePrdId, session, sourcePath: stringValue(valueAt(event, 'filePath')) ?? stringValue(valueAt(event, 'path')), status: statusForEvent(event, 'queued'), updatedAt: timestamp, submittedAt: type === 'enqueue:complete' ? timestamp : undefined });
  if (runId) upsertBuildRun(store, { runId, session, queuePrdId, buildSessionId, status: statusForEvent(event, 'running'), startedAt: type.includes(':start') ? timestamp : undefined, finishedAt: isTerminalEvent(type) ? timestamp : undefined });
  if (buildSessionId) upsertBuildSession(store, { buildSessionId, session, status: statusForEvent(event, 'running'), startedAt: type === 'session:start' ? timestamp : undefined, finishedAt: type === 'session:end' ? timestamp : undefined });
  if (landingId) upsertLandingLink(store, { landingId, session, queuePrdId, runId, buildSessionId, status: landingStatus(event), prUrl: stringValue(valueAt(event, 'prUrl')), featureBranch: stringValue(valueAt(event, 'featureBranch')), commitSha: stringValue(valueAt(event, 'commitSha')), completedAt: timestamp });
  const lifecycleState = lifecycleStateForEvent(event);
  const terminal = lifecycleState === 'failed' || lifecycleState === 'merged' || lifecycleState === 'shipped';
  for (const itemRef of affected) {
    const existing = getBacklogItem(store, itemRef);
    supersedeCurrentLifecycleEvidence(store, itemRef, lifecycleState, timestamp);
    recordLifecycleEvidence(store, { evidenceKey: `${eventKey}:${itemRef}:${lifecycleState}`, itemRef, itemId: existing?.id, session, queuePrdId, runId, buildSessionId, landingId, sourceEventKey: eventKey, lifecycleState, reasonCode: reasonCodeForState(lifecycleState), evidenceKind: 'event', status: statusForEvent(event, lifecycleState), isCurrent: true, isTerminal: terminal, occurredAt: timestamp, summary: resultSummaryForEvent(event), links: jsonValue({ session, queuePrdId, runId, buildSessionId, landingId, prUrl: stringValue(valueAt(event, 'prUrl')) }) });
    if (lifecycleState === 'shipped' && existing) upsertBacklogItem(store, { ...existing, userStatus: 'shipped', updatedAt: timestamp });
  }
  markCanonicalSearchDirty(store, affected.map((documentId) => ({ documentType: 'backlog_item', documentId, reason: 'lifecycle-event' })));
}

function lifecycleStateForEvent(event: EforgeEvent | Record<string, unknown>): LifecycleState {
  const type = stringValue(valueAt(event, 'type')) ?? '';
  if (type === 'enqueue:complete') return 'queued';
  if (type.startsWith('queue:')) return 'queued';
  if (type.startsWith('session:')) return type === 'session:end' && statusForEvent(event, '') === 'failed' ? 'failed' : 'build';
  if (type === 'landing:auto-merge:complete') return 'shipped';
  if (type === 'landing:complete' && valueAt(event, 'action') === 'merge') return 'shipped';
  if (type === 'landing:complete' && landingStatus(event) === 'pr-open') return 'pr-open';
  if (type.includes('fail')) return 'failed';
  return 'active';
}

function reasonCodeForState(state: LifecycleState): string { return state === 'build' ? 'active-build' : state === 'pr-open' ? 'pr-open' : state === 'queued' ? 'queued-build' : state === 'shipped' ? 'shipped' : state; }
function landingStatus(event: EforgeEvent | Record<string, unknown>): string { if (stringValue(valueAt(event, 'prUrl')) && valueAt(event, 'action') === 'pr') return 'pr-open'; if (valueAt(event, 'action') === 'merge') return 'merged'; return 'complete'; }
function statusForEvent(event: EforgeEvent | Record<string, unknown>, fallback: string): string { return stringValue(valueAt(valueAt(event, 'result'), 'status')) ?? stringValue(valueAt(event, 'status')) ?? stringValue(valueAt(event, 'action')) ?? fallback; }
function resultSummaryForEvent(event: EforgeEvent | Record<string, unknown>): string | undefined { return stringValue(valueAt(valueAt(event, 'result'), 'summary')); }
function supersedeCurrentLifecycleEvidence(store: EforgePlanStore, itemRef: string, lifecycleState: LifecycleState, timestamp: string): void {
  getDatabase(store).prepare(`UPDATE lifecycle_evidence SET is_current = 0, superseded_at = ? WHERE is_current = 1 AND item_ref = ? AND lifecycle_state = ?`).run(timestamp, itemRef, lifecycleState);
  if (lifecycleState === 'failed' || lifecycleState === 'merged' || lifecycleState === 'shipped') {
    getDatabase(store).prepare(`UPDATE lifecycle_evidence SET is_current = 0, superseded_at = ? WHERE is_current = 1 AND item_ref = ? AND lifecycle_state IN ('submitted','queued','build','pr-open')`).run(timestamp, itemRef);
  }
}
function landingKey(event: EforgeEvent | Record<string, unknown>): string | undefined { const prUrl = stringValue(valueAt(event, 'prUrl')); const branch = stringValue(valueAt(event, 'featureBranch')); const commit = stringValue(valueAt(event, 'commitSha')); return prUrl ?? branch ?? commit ? `landing-${stableCanonicalId([prUrl, branch, commit])}` : undefined; }
function inferredItemRefs(event: EforgeEvent | Record<string, unknown>): string[] { const source = stringValue(valueAt(event, 'source')); if (source?.startsWith('eforge://input/eforge-plan/')) return [decodeURIComponent(source.slice('eforge://input/eforge-plan/'.length))]; const itemId = stringValue(valueAt(event, 'itemId')); return itemId ? [itemId] : []; }
function isTerminalEvent(type: string): boolean { return type.endsWith(':end') || type.endsWith(':complete') || type.includes('fail'); }
function valueAt(value: unknown, key: string): unknown { return value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined; }
function stringValue(value: unknown): string | undefined { return typeof value === 'string' && value.length > 0 ? value : undefined; }
function jsonValue(value: unknown): JsonValue { return JSON.parse(JSON.stringify(value ?? {}, (_key, entry) => entry === undefined ? undefined : entry)) as JsonValue; }
