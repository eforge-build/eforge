import { createHash } from 'node:crypto';
import type { EforgePlanStore, SearchDocumentUpsert } from '../sqlite/index.js';
import { listBacklogItemSearchProjectionRows, listEpicSearchProjectionRows, listRecommendationSearchProjectionRows, listSessionPlanSearchProjectionRows, type BacklogItemSearchProjectionRow, type EpicSearchProjectionRow, type RecommendationSearchProjectionRow, type SessionPlanSearchProjectionRow } from '../sqlite/repositories/search-document-projections.js';
import type { SearchDocumentProjection, SearchDocumentType } from './types.js';

function text(values: Array<unknown>): string { return values.flatMap((value): string[] => Array.isArray(value) ? value.map(String) : value === undefined || value === null ? [] : [typeof value === 'string' ? value : JSON.stringify(value)]).join('\n').replace(/\s+/g, ' ').trim(); }
function sourceHash(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex'); }
function sectionText(sections: Array<{ name: string; content: string }>): string { return text(sections.map((s) => `${s.name}\n${s.content}`)); }

export function backlogItemSearchDocument(row: BacklogItemSearchProjectionRow): SearchDocumentUpsert {
  const source = { ...row };
  return { documentType: 'backlog_item', documentId: row.id, title: row.title, tagsText: text([...row.tags, row.priority, row.userStatus]), summaryText: text([row.id, row.epicId, row.epicRef, row.dependencies]), bodyText: text([row.body, sectionText(row.sections)]), itemIdsText: text([row.id]), epicIdsText: text([row.epicId, row.epicRef]), sourceSha256: sourceHash(source), updatedAt: row.updatedAt, dirty: false };
}
export function epicSearchDocument(row: EpicSearchProjectionRow): SearchDocumentUpsert {
  const source = { ...row };
  return { documentType: 'epic', documentId: row.id, title: row.title, tagsText: text([...row.tags, row.priority, row.userStatus]), summaryText: text([row.id, row.itemIds]), bodyText: text([row.body, sectionText(row.sections)]), itemIdsText: text(row.itemIds), epicIdsText: text([row.id]), sourceSha256: sourceHash(source), updatedAt: row.updatedAt, dirty: false };
}
export function sessionPlanSearchDocument(row: SessionPlanSearchProjectionRow): SearchDocumentUpsert {
  const source = { ...row };
  return { documentType: 'session_plan', documentId: row.session, title: row.topic ?? row.session, tagsText: text([row.status, row.planningType, row.planningDepth, row.profile]), summaryText: text([row.session, row.path, row.summaryText, row.readinessSummary]), bodyText: '', itemIdsText: text(row.itemIds), epicIdsText: text(row.epicIds), recommendationRefsText: text(row.recommendationRefs), sourceSha256: sourceHash(source), updatedAt: row.updatedAt, dirty: false };
}
export function recommendationSearchDocument(row: RecommendationSearchProjectionRow): SearchDocumentUpsert {
  const source = { ...row };
  return { documentType: 'recommendation', documentId: row.laneId, title: row.title ?? row.laneRef ?? row.laneKind, tagsText: text([row.laneKind, row.profile, row.laneRef]), summaryText: text([row.runId, row.laneId, row.rationale, row.itemRationales, row.runSummary]), bodyText: '', itemIdsText: text([...row.itemRefs, ...row.itemIds]), recommendationRefsText: text(row.recommendationRefs), sourceSha256: sourceHash(source), updatedAt: row.updatedAt, dirty: false };
}

export function buildSearchDocuments(store: EforgePlanStore, input: { types?: SearchDocumentType[]; records?: Array<{ type: SearchDocumentType; id: string }>; includeHistoricalRecommendations?: boolean } = {}): SearchDocumentUpsert[] {
  const types = input.types ?? (input.records ? Array.from(new Set(input.records.map((r) => r.type))) : ['backlog_item', 'epic', 'session_plan', 'recommendation']);
  const idsFor = (type: SearchDocumentType) => input.records?.filter((r) => r.type === type).map((r) => r.id);
  return [
    ...(types.includes('backlog_item') ? listBacklogItemSearchProjectionRows(store, idsFor('backlog_item')).map(backlogItemSearchDocument) : []),
    ...(types.includes('epic') ? listEpicSearchProjectionRows(store, idsFor('epic')).map(epicSearchDocument) : []),
    ...(types.includes('session_plan') ? listSessionPlanSearchProjectionRows(store, idsFor('session_plan')).map(sessionPlanSearchDocument) : []),
    ...(types.includes('recommendation') ? listRecommendationSearchProjectionRows(store, idsFor('recommendation'), input.includeHistoricalRecommendations ?? true).map(recommendationSearchDocument) : []),
  ];
}

export function documentProjectionForResult(doc: SearchDocumentUpsert): SearchDocumentProjection { return { documentType: doc.documentType, documentId: doc.documentId, title: doc.title, tagsText: doc.tagsText, summaryText: doc.summaryText, bodyText: doc.bodyText, itemIdsText: doc.itemIdsText, epicIdsText: doc.epicIdsText, recommendationRefsText: doc.recommendationRefsText, updatedAt: doc.updatedAt, source: JSON.parse(JSON.stringify(doc)) }; }
