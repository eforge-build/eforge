import type { EforgePlanStore, SearchDocumentType } from '../sqlite/index.js';
import { markSearchIndexDirty, markSearchIndexDirtyBatch } from '../sqlite/index.js';
import { canonicalNowIso } from './store.js';

export interface DirtyDocumentRef { documentType: SearchDocumentType; documentId: string; reason?: string }

export function markCanonicalSearchDirty(store: EforgePlanStore, refs: readonly DirtyDocumentRef[], markedAt = canonicalNowIso()): void {
  markSearchIndexDirtyBatch(store, refs.map((ref) => ({ ...ref, markedAt })));
}

export function markItemDirty(store: EforgePlanStore, itemId: string, reason = 'canonical-backlog-write'): void {
  markSearchIndexDirty(store, { documentType: 'backlog_item', documentId: itemId, reason });
}

export function markEpicDirty(store: EforgePlanStore, epicId: string, reason = 'canonical-epic-write'): void {
  markSearchIndexDirty(store, { documentType: 'epic', documentId: epicId, reason });
}

export function markSessionPlanDirty(store: EforgePlanStore, session: string, reason = 'canonical-session-plan-write'): void {
  markSearchIndexDirty(store, { documentType: 'session_plan', documentId: session, reason });
}

export function markRecommendationDirty(store: EforgePlanStore, runId: string, reason = 'canonical-recommendation-write'): void {
  markSearchIndexDirty(store, { documentType: 'recommendation', documentId: runId, reason });
}
