import type { EforgePlanStore } from '../sqlite/index.js';
import { listProjectionQueueBuildLinks, listProjectionSessionItems, listProjectionPlanningTaskItems, listLifecycleEvidenceForItems } from '../sqlite/repositories/projections/lifecycle.js';
import type { AssociatedPlanBuildLink } from './types.js';
import { mapReasonCode, reasonForEvidence } from './lifecycle.js';

export function getAssociatedPlanBuildLinksForItemsFromStore(store: EforgePlanStore, itemIds: readonly string[]): AssociatedPlanBuildLink[] {
  const ids = new Set(itemIds);
  const links: AssociatedPlanBuildLink[] = [];
  for (const s of listProjectionSessionItems(store).filter((r) => ids.has(r.itemId ?? r.itemRef))) links.push({ kind: 'session-plan', id: s.session, label: `Session plan ${s.session}`, itemIds: [s.itemId ?? s.itemRef], affectedItemIds: [s.itemId ?? s.itemRef], session: s.session, status: s.status, path: s.path, timestamp: s.promotedAt, reasonCode: s.status === 'submitted' ? 'submitted-session-plan' : 'planned-session-plan', metadata: { role: s.role, provenance: s.provenance, ...(s.sourceRecommendationRef ? { sourceRecommendationRef: s.sourceRecommendationRef } : {}) } });
  for (const t of listProjectionPlanningTaskItems(store).filter((r) => ids.has(r.itemId ?? r.itemRef))) links.push({ kind: 'planning-task', id: t.taskId, label: `Planning task ${t.taskId}`, itemIds: [t.itemId ?? t.itemRef], status: t.status, timestamp: t.updatedAt ?? t.createdAt, reasonCode: 'active-planning-task' });
  const evidence = listLifecycleEvidenceForItems(store, itemIds);
  for (const e of evidence) links.push({ kind: 'lifecycle-evidence', id: e.evidenceKey, itemIds: [e.itemId], session: e.session, status: e.status, timestamp: e.occurredAt, reasonCode: reasonForEvidence(e), metadata: { lifecycleState: e.lifecycleState, ...(e.summary ? { summary: e.summary } : {}) } });
  const sessionItemIds = new Map<string, Set<string>>();
  const addSessionItem = (session: string | undefined, itemId: string | undefined) => { if (!session || !itemId || !ids.has(itemId)) return; const current = sessionItemIds.get(session) ?? new Set<string>(); current.add(itemId); sessionItemIds.set(session, current); };
  for (const s of listProjectionSessionItems(store)) addSessionItem(s.session, s.itemId ?? s.itemRef);
  for (const e of evidence) addSessionItem(e.session, e.itemId ?? e.itemRef);
  for (const link of links) for (const itemId of link.itemIds) addSessionItem(link.session, itemId);
  const sessions = new Set(sessionItemIds.keys());
  for (const q of listProjectionQueueBuildLinks(store).filter((q) => (q.itemId && ids.has(q.itemId)) || (!q.itemId && q.session && sessions.has(q.session)))) {
    const reasonCode = q.kind === 'queue-prd' ? 'queued-build' : q.kind === 'build-session' ? 'active-build-session' : q.kind === 'build-run' ? 'running-build' : q.status === 'merged' ? 'merged-result' : q.status === 'shipped' ? 'shipped-result' : 'open-pr';
    const linkedItemIds = q.itemId ? [q.itemId] : [...(sessionItemIds.get(q.session ?? '') ?? [])];
    if (linkedItemIds.length === 0) continue;
    links.push({ kind: q.kind, id: q.id, label: `${q.kind} ${q.id}`, itemIds: linkedItemIds, affectedItemIds: linkedItemIds, session: q.session, status: q.status, timestamp: q.timestamp, path: q.path, url: q.url, runId: q.runId, buildSessionId: q.buildSessionId, prUrl: q.kind === 'landing' ? q.url : undefined, reasonCode: mapReasonCode(reasonCode) });
  }
  return links.sort((a, b) => (b.timestamp ?? '').localeCompare(a.timestamp ?? '') || a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));
}
