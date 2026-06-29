import { getCurrentRecommendationRun, upsertRecommendationRun, type EforgePlanStore } from '../sqlite/index.js';
import { getDatabase } from '../sqlite/store-internal.js';
import { isCurrentResultLifecycleState, isLiveQueuePrdStatus, isTerminalBuildStatus } from '../planning-state-policy.js';
import { markRecommendationsStaleForLifecycleUpdate } from '../recommendation-status.js';
import { markCanonicalSearchDirty, markRecommendationDirty } from './search-dirty.js';
import { canonicalNowIso, withCanonicalTransaction } from './store.js';

export interface RemovedQueuePrdCoverageSummary {
  prdId: string;
  affectedItemRefs: string[];
  affectedSessionIds: string[];
  updatedQueuePrdRows: number;
  updatedSessionPlanRows: number;
  supersededLifecycleRows: number;
  markedRecommendationStale: boolean;
}

export interface RemovedQueuePrdCoverageOptions {
  timestamp?: string;
}

interface QueuePrdRow { prd_id: string; session?: string | null; status?: string | null }
interface LifecycleCleanupRow { evidence_key: string; item_ref: string; item_id?: string | null; session?: string | null; queue_prd_id?: string | null; run_id?: string | null; build_session_id?: string | null; landing_id?: string | null; lifecycle_state: string; status?: string | null; links_json?: string | null }
interface StatusRow { status?: string | null }
interface LifecycleBuildLinkRow { status?: string | null; run_id?: string | null; build_session_id?: string | null }

export async function synchronizeRemovedQueuePrdCoverage(cwd: string, prdId: string, options: RemovedQueuePrdCoverageOptions = {}): Promise<RemovedQueuePrdCoverageSummary> {
  const timestamp = options.timestamp ?? canonicalNowIso();
  const summary = withCanonicalTransaction(cwd, (store) => synchronizeRemovedQueuePrdCoverageRecord(store, prdId, timestamp));
  if (summary.affectedItemRefs.length === 0) return summary;
  const stale = await markRecommendationsStaleForLifecycleUpdate(cwd, {
    eventType: 'queue:prd:removed',
    itemIds: summary.affectedItemRefs,
    correlationKind: summary.affectedItemRefs.length > 1 ? 'multi' : 'single',
    timestamp,
    summary: `Recommendations are stale after queue PRD removal ${prdId} for ${summary.affectedItemRefs.join(', ')}.`,
    refs: [prdId],
  });
  return { ...summary, markedRecommendationStale: stale !== null };
}

export function synchronizeRemovedQueuePrdCoverageRecord(store: EforgePlanStore, prdId: string, timestamp = canonicalNowIso()): RemovedQueuePrdCoverageSummary {
  const db = getDatabase(store);
  const queueRows = db.prepare('SELECT prd_id, session, status FROM queue_prds WHERE prd_id = ?').all(prdId) as unknown as QueuePrdRow[];
  const affectedSessions = new Set(queueRows.map((row) => stringValue(row.session)).filter((session): session is string => session !== undefined));
  const affectedItems = new Set<string>();
  for (const session of affectedSessions) for (const itemRef of itemRefsForSession(store, session)) affectedItems.add(itemRef);

  const lifecycleRows = (db.prepare(`SELECT * FROM lifecycle_evidence WHERE is_current = 1 AND (
    queue_prd_id = ?
    OR run_id IN (SELECT run_id FROM build_runs WHERE queue_prd_id = ?)
    OR build_session_id IN (SELECT build_session_id FROM build_runs WHERE queue_prd_id = ? AND build_session_id IS NOT NULL)
    OR (links_json IS NOT NULL AND json_valid(links_json) AND EXISTS (
      SELECT 1 FROM json_tree(lifecycle_evidence.links_json)
      WHERE json_tree.value = ? AND json_tree.key IN ('queuePrdId', 'prdId', 'id')
    ))
  )`).all(prdId, prdId, prdId, prdId) as unknown as LifecycleCleanupRow[])
    .filter((row) => row.queue_prd_id === prdId || rowLinksReferenceQueuePrd(row, prdId) || rowBuildLinkReferencesQueuePrd(store, row, prdId));
  for (const row of lifecycleRows) {
    affectedItems.add(row.item_ref);
    const session = stringValue(row.session);
    if (session !== undefined) affectedSessions.add(session);
  }

  const updatedQueuePrdRows = Number(db.prepare(`UPDATE queue_prds SET status = 'removed', updated_at = ? WHERE prd_id = ? AND COALESCE(status, '') <> 'removed'`).run(timestamp, prdId).changes);
  const updatedSessionPlanRows = markSessionsRemovedWhenQueueOnly(store, [...affectedSessions], prdId, timestamp);
  const supersededLifecycleRows = supersedeRemovedQueueLifecycleRows(store, lifecycleRows, prdId, timestamp);

  const sortedItems = [...affectedItems].sort();
  const sortedSessions = [...affectedSessions].sort();
  if (sortedItems.length > 0 || sortedSessions.length > 0) {
    markCanonicalSearchDirty(store, [
      ...sortedItems.map((documentId) => ({ documentType: 'backlog_item' as const, documentId, reason: 'queue-prd-removed' })),
      ...sortedSessions.map((documentId) => ({ documentType: 'session_plan' as const, documentId, reason: 'queue-prd-removed' })),
    ], timestamp);
    markCurrentRecommendationRunStale(store, prdId, sortedItems, timestamp);
  }

  return { prdId, affectedItemRefs: sortedItems, affectedSessionIds: sortedSessions, updatedQueuePrdRows, updatedSessionPlanRows, supersededLifecycleRows, markedRecommendationStale: false };
}

function itemRefsForSession(store: EforgePlanStore, session: string): string[] {
  return (getDatabase(store).prepare('SELECT DISTINCT item_ref FROM session_plan_items WHERE session = ?').all(session) as Array<{ item_ref?: unknown }>)
    .map((row) => stringValue(row.item_ref))
    .filter((itemRef): itemRef is string => itemRef !== undefined);
}

function markSessionsRemovedWhenQueueOnly(store: EforgePlanStore, sessions: readonly string[], removedPrdId: string, timestamp: string): number {
  const db = getDatabase(store);
  let changed = 0;
  for (const session of sessions) {
    if (hasLiveQueueOrBuildLink(store, session, removedPrdId)) continue;
    changed += Number(db.prepare(`UPDATE session_plans SET status = 'removed', updated_at = ? WHERE session = ? AND status = 'submitted'`).run(timestamp, session).changes);
  }
  return changed;
}

function supersedeRemovedQueueLifecycleRows(store: EforgePlanStore, rows: readonly LifecycleCleanupRow[], prdId: string, timestamp: string): number {
  const db = getDatabase(store);
  const keys = rows.filter((row) => isEvidenceTiedOnlyToRemovedQueue(store, row, prdId)).map((row) => row.evidence_key).sort();
  let changed = 0;
  for (const key of keys) {
    changed += Number(db.prepare(`UPDATE lifecycle_evidence SET is_current = 0, is_terminal = 1, status = 'removed', superseded_at = ? WHERE evidence_key = ? AND is_current = 1`).run(timestamp, key).changes);
  }
  return changed;
}

function isEvidenceTiedOnlyToRemovedQueue(store: EforgePlanStore, row: LifecycleCleanupRow, prdId: string): boolean {
  if (isCurrentResultLifecycleState(row.lifecycle_state) || stringValue(row.landing_id) !== undefined) return false;
  const runStatus = buildRunStatus(store, stringValue(row.run_id));
  const buildSessionStatus = buildSessionStatusForId(store, stringValue(row.build_session_id));
  if (runStatus !== undefined && !isTerminalBuildStatus(runStatus)) return false;
  if (buildSessionStatus !== undefined && !isTerminalBuildStatus(buildSessionStatus)) return false;
  if (runStatus === undefined && buildSessionStatus === undefined && (stringValue(row.run_id) !== undefined || stringValue(row.build_session_id) !== undefined) && !isTerminalBuildStatus(row.status)) return false;
  if (row.queue_prd_id !== prdId && !rowLinksReferenceQueuePrd(row, prdId) && !rowBuildLinkReferencesQueuePrd(store, row, prdId)) return false;
  const linkRefs = parseLifecycleLinks(row.links_json);
  if (linkRefs.queuePrdIds.some((id) => id !== prdId && isLiveQueuePrd(store, id))) return false;
  if (linkRefs.runIds.some((id) => isLiveBuildRun(store, id))) return false;
  if (linkRefs.buildSessionIds.some((id) => isLiveBuildSession(store, id))) return false;
  return true;
}

function rowLinksReferenceQueuePrd(row: LifecycleCleanupRow, prdId: string): boolean {
  return parseLifecycleLinks(row.links_json).queuePrdIds.includes(prdId);
}

function rowBuildLinkReferencesQueuePrd(store: EforgePlanStore, row: LifecycleCleanupRow, prdId: string): boolean {
  const runId = stringValue(row.run_id);
  if (runId !== undefined) {
    const run = getDatabase(store).prepare('SELECT queue_prd_id FROM build_runs WHERE run_id = ?').get(runId) as { queue_prd_id?: string | null } | undefined;
    if (run?.queue_prd_id === prdId) return true;
  }
  const buildSessionId = stringValue(row.build_session_id);
  if (buildSessionId === undefined) return false;
  const run = getDatabase(store).prepare('SELECT queue_prd_id FROM build_runs WHERE build_session_id = ? AND queue_prd_id = ?').get(buildSessionId, prdId) as { queue_prd_id?: string | null } | undefined;
  return run?.queue_prd_id === prdId;
}

function parseLifecycleLinks(linksJson: string | null | undefined): { queuePrdIds: string[]; runIds: string[]; buildSessionIds: string[] } {
  if (!linksJson) return { queuePrdIds: [], runIds: [], buildSessionIds: [] };
  try { return collectLifecycleLinkRefs(JSON.parse(linksJson)); } catch { return { queuePrdIds: [], runIds: [], buildSessionIds: [] }; }
}

function collectLifecycleLinkRefs(value: unknown): { queuePrdIds: string[]; runIds: string[]; buildSessionIds: string[] } {
  const refs = { queuePrdIds: [] as string[], runIds: [] as string[], buildSessionIds: [] as string[] };
  const visit = (entry: unknown): void => {
    if (Array.isArray(entry)) { for (const item of entry) visit(item); return; }
    if (!entry || typeof entry !== 'object') return;
    const record = entry as Record<string, unknown>;
    const kind = stringValue(record.kind);
    const queuePrdId = stringValue(record.queuePrdId) ?? stringValue(record.prdId) ?? (kind === 'queue-prd' ? stringValue(record.id) : undefined);
    if (queuePrdId) refs.queuePrdIds.push(queuePrdId);
    const runId = stringValue(record.runId) ?? (kind === 'build-run' ? stringValue(record.id) : undefined);
    if (runId) refs.runIds.push(runId);
    const buildSessionId = stringValue(record.buildSessionId) ?? (kind === 'build-session' ? stringValue(record.id) : undefined);
    if (buildSessionId) refs.buildSessionIds.push(buildSessionId);
    for (const item of Object.values(record)) visit(item);
  };
  visit(value);
  return refs;
}

function isLiveQueuePrd(store: EforgePlanStore, prdId: string): boolean {
  const row = getDatabase(store).prepare('SELECT status FROM queue_prds WHERE prd_id = ?').get(prdId) as StatusRow | undefined;
  return row !== undefined && isLiveQueuePrdStatus(row.status);
}

function hasLiveQueueOrBuildLink(store: EforgePlanStore, session: string, removedPrdId: string): boolean {
  const db = getDatabase(store);
  const queueRows = db.prepare('SELECT status FROM queue_prds WHERE session = ? AND prd_id <> ?').all(session, removedPrdId) as StatusRow[];
  if (queueRows.some((row) => isLiveQueuePrdStatus(row.status))) return true;
  const runRows = db.prepare('SELECT status FROM build_runs WHERE session = ? OR queue_prd_id = ?').all(session, removedPrdId) as StatusRow[];
  if (runRows.some((row) => !isTerminalBuildStatus(row.status))) return true;
  const sessionRows = db.prepare('SELECT status FROM build_sessions WHERE session = ?').all(session) as StatusRow[];
  if (sessionRows.some((row) => !isTerminalBuildStatus(row.status))) return true;
  const lifecycleRows = db.prepare('SELECT status, run_id, build_session_id FROM lifecycle_evidence WHERE is_current = 1 AND session = ? AND (run_id IS NOT NULL OR build_session_id IS NOT NULL)').all(session) as LifecycleBuildLinkRow[];
  return lifecycleRows.some((row) => hasLiveBuildEvidenceLink(store, row));
}

function hasLiveBuildEvidenceLink(store: EforgePlanStore, row: LifecycleBuildLinkRow): boolean {
  const runStatus = buildRunStatus(store, stringValue(row.run_id));
  const buildSessionStatus = buildSessionStatusForId(store, stringValue(row.build_session_id));
  if (runStatus !== undefined) return !isTerminalBuildStatus(runStatus);
  if (buildSessionStatus !== undefined) return !isTerminalBuildStatus(buildSessionStatus);
  return !isTerminalBuildStatus(row.status);
}

function isLiveBuildRun(store: EforgePlanStore, runId: string | undefined): boolean {
  const status = buildRunStatus(store, runId);
  return status !== undefined && !isTerminalBuildStatus(status);
}

function isLiveBuildSession(store: EforgePlanStore, buildSessionId: string | undefined): boolean {
  const status = buildSessionStatusForId(store, buildSessionId);
  return status !== undefined && !isTerminalBuildStatus(status);
}

function buildRunStatus(store: EforgePlanStore, runId: string | undefined): string | undefined {
  if (runId === undefined) return undefined;
  const row = getDatabase(store).prepare('SELECT status FROM build_runs WHERE run_id = ?').get(runId) as StatusRow | undefined;
  return stringValue(row?.status);
}

function buildSessionStatusForId(store: EforgePlanStore, buildSessionId: string | undefined): string | undefined {
  if (buildSessionId === undefined) return undefined;
  const row = getDatabase(store).prepare('SELECT status FROM build_sessions WHERE build_session_id = ?').get(buildSessionId) as StatusRow | undefined;
  return stringValue(row?.status);
}

function markCurrentRecommendationRunStale(store: EforgePlanStore, prdId: string, itemIds: readonly string[], timestamp: string): void {
  const current = getCurrentRecommendationRun(store);
  if (current === undefined) return;
  upsertRecommendationRun(store, { ...current, freshness: { status: 'stale', reason: `queue PRD ${prdId} was removed`, refs: [prdId, ...itemIds], updatedAt: timestamp }, isCurrent: true });
  markRecommendationDirty(store, current.runId, 'queue-prd-removed');
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
