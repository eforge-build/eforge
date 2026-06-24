import type { EforgePlanStore, SearchDocumentType } from '../sqlite/index.js';
import { clearSearchIndexDirty, clearSearchIndexDirtyForTypes, clearSearchIndexDirtyRecords, countSearchIndexDirtyRecords, deleteSearchDocument, deleteStaleSearchDocumentsByType, getSearchIndexState, listSearchIndexDirtyRecords, optimizeSearchDocumentsFts, replaceSearchDocuments } from '../sqlite/repositories/search-documents.js';
import { projectionIdsForType } from '../sqlite/repositories/search-document-projections.js';
import { getSearchDirtyStatus } from '../sqlite/repositories/search-queries.js';
import { buildSearchDocuments } from './documents.js';
import type { RefreshSearchDocumentsInput, SearchIndexStatus, SearchMaintenanceReport, SearchRefreshReport } from './types.js';

const ALL_TYPES: SearchDocumentType[] = ['backlog_item', 'epic', 'session_plan', 'recommendation'];
function now() { return new Date().toISOString(); }
function typesFrom(input?: { types?: SearchDocumentType[]; records?: Array<{ type: SearchDocumentType; id: string }> }): SearchDocumentType[] { return input?.types ?? Array.from(new Set(input?.records?.map((r) => r.type) ?? ALL_TYPES)); }

export function getSearchIndexStatus(store: EforgePlanStore): SearchIndexStatus { return getSearchDirtyStatus(store); }

export function refreshSearchDocuments(store: EforgePlanStore, input: RefreshSearchDocumentsInput): void {
  store.transaction(() => {
    const docs = buildSearchDocuments(store, { types: input.types, records: input.records });
    if (input.records?.length) {
      const rebuiltKeys = new Set(docs.map((doc) => `${doc.documentType}\0${doc.documentId}`));
      for (const record of input.records) if (!rebuiltKeys.has(`${record.type}\0${record.id}`)) deleteSearchDocument(store, { documentType: record.type, documentId: record.id });
    } else if (input.types?.length) {
      for (const type of input.types) deleteStaleSearchDocumentsByType(store, type, projectionIdsForType(store, type));
    }
    replaceSearchDocuments(store, docs);
    if (input.records?.length) clearSearchIndexDirtyRecords(store, input.records.map((r) => ({ documentType: r.type, documentId: r.id })));
  });
}

export function refreshDirtySearchDocuments(store: EforgePlanStore, input: { limit?: number; reason?: string } = {}): SearchRefreshReport {
  const records = listSearchIndexDirtyRecords(store, { limit: input.limit });
  const rebuiltAt = now();
  if (records.length === 0) return { refreshed: 0, deleted: 0, clearedDirty: 0, types: [], rebuiltAt };
  const typedRecords = records.map((r) => ({ type: r.documentType, id: r.documentId }));
  const docs = buildSearchDocuments(store, { records: typedRecords });
  const rebuiltKeys = new Set(docs.map((doc) => `${doc.documentType}\0${doc.documentId}`));
  const missing = records.filter((record) => !rebuiltKeys.has(`${record.documentType}\0${record.documentId}`));
  store.transaction(() => {
    replaceSearchDocuments(store, docs);
    for (const record of missing) deleteSearchDocument(store, record);
    clearSearchIndexDirtyRecords(store, records.map((r) => ({ documentType: r.documentType, documentId: r.documentId })));
  });
  return { refreshed: docs.length, deleted: missing.length, clearedDirty: records.length, types: Array.from(new Set(records.map((r) => r.documentType))), rebuiltAt };
}

export function rebuildSearchIndex(store: EforgePlanStore, input: { types?: SearchDocumentType[]; reason?: string } = {}): SearchRefreshReport {
  const rebuiltAt = now();
  if (input.types && input.types.length === 0) return { refreshed: 0, deleted: 0, clearedDirty: 0, types: [], rebuiltAt: getSearchIndexState(store).lastRebuiltAt ?? rebuiltAt };
  const types = typesFrom(input);
  const docs = buildSearchDocuments(store, { types });
  const fullRebuild = input.types === undefined;
  const dirtyBefore = countSearchIndexDirtyRecords(store, fullRebuild ? undefined : types);
  let deleted = 0;
  let clearedDirty = 0;
  store.transaction(() => {
    for (const type of types) deleted += deleteStaleSearchDocumentsByType(store, type, projectionIdsForType(store, type));
    replaceSearchDocuments(store, docs);
    if (fullRebuild) {
      clearSearchIndexDirty(store, { rebuiltAt });
      clearedDirty = dirtyBefore;
    } else {
      clearedDirty = clearSearchIndexDirtyForTypes(store, types);
    }
  });
  return { refreshed: docs.length, deleted, clearedDirty, types, rebuiltAt: getSearchIndexState(store).lastRebuiltAt ?? rebuiltAt };
}

export function optimizeSearchIndex(store: EforgePlanStore): SearchMaintenanceReport { optimizeSearchDocumentsFts(store); return { optimizedAt: now(), ok: true }; }
