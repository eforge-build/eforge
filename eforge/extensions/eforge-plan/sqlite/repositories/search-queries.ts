import type { EforgePlanStore, SearchDocumentType } from '../types.js';
import { SEARCH_DOCUMENT_TYPES } from '../types.js';
import { EforgePlanStoreError } from '../errors.js';
import { all, cleanUndefined, one, optionalString } from './sql.js';

export interface SearchQueryFilters { types?: SearchDocumentType[]; itemIds?: string[]; epicIds?: string[]; sessions?: string[]; recommendationRefs?: string[]; includeHistoricalRecommendations?: boolean }
export interface SearchHitRow { documentType: SearchDocumentType; documentId: string; title: string; rank?: number; snippet?: string; updatedAt?: string; itemIdsText?: string; epicIdsText?: string; recommendationRefsText?: string; recommendationRunId?: string }
export interface SearchQueryInput extends SearchQueryFilters { match?: string; limit: number; offset: number }

function validateTypes(types?: readonly SearchDocumentType[]) { for (const type of types ?? []) if (!SEARCH_DOCUMENT_TYPES.includes(type)) throw new EforgePlanStoreError('invalid-input', `Invalid search document type: ${type}`); }
function splitWords(value?: string): string[] { return (value ?? '').split(/\s+/).map((v) => v.trim()).filter(Boolean); }
function escapeLike(value: string): string { return value.replace(/[\\%_]/g, (match) => `\\${match}`); }
function tokenFilter(column: string, values: readonly string[], params: unknown[]): string { params.push(...values.map((value) => `% ${escapeLike(value)} %`)); return `(${values.map(() => `(' ' || COALESCE(${column}, '') || ' ') LIKE ? ESCAPE '\\'`).join(' OR ')})`; }
function where(input: SearchQueryInput, params: unknown[]): string {
  validateTypes(input.types);
  const clauses: string[] = [];
  if (input.match) clauses.push('search_documents_fts MATCH ?'), params.push(input.match);
  if (input.types?.length) clauses.push(`sd.document_type IN (${input.types.map(() => '?').join(',')})`), params.push(...input.types);
  if (input.sessions?.length) clauses.push(`(sd.document_type = 'session_plan' AND sd.document_id IN (${input.sessions.map(() => '?').join(',')}))`), params.push(...input.sessions);
  if (input.itemIds?.length) clauses.push(tokenFilter('sd.item_ids_text', input.itemIds, params));
  if (input.epicIds?.length) clauses.push(tokenFilter('sd.epic_ids_text', input.epicIds, params));
  if (input.recommendationRefs?.length) clauses.push(tokenFilter('sd.recommendation_refs_text', input.recommendationRefs, params));
  if (input.includeHistoricalRecommendations !== true) clauses.push(`(sd.document_type <> 'recommendation' OR EXISTS (SELECT 1 FROM recommendation_lanes rl JOIN recommendation_runs rr ON rr.run_id = rl.run_id WHERE rl.lane_id = sd.document_id AND rr.is_current = 1))`);
  return clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
}
function baseSql(input: SearchQueryInput, params: unknown[]): string { const whereSql = where(input, params); return `FROM search_documents_fts JOIN search_documents sd ON sd.document_type = search_documents_fts.document_type AND sd.document_id = search_documents_fts.document_id ${whereSql}`; }
export function querySearchDocuments(store: EforgePlanStore, input: SearchQueryInput): SearchHitRow[] {
  const params: unknown[] = [];
  const from = baseSql(input, params);
  const rankExpr = input.match ? 'bm25(search_documents_fts, 0, 0, 8, 5, 2, 1, 4, 4, 4)' : 'NULL';
  const snippetExpr = input.match ? "snippet(search_documents_fts, -1, '<mark>', '</mark>', '…', 24)" : 'NULL';
  const rows = all<Record<string, unknown>>(store, `SELECT sd.document_type, sd.document_id, COALESCE(sd.title, sd.document_id) AS title, ${rankExpr} AS rank, ${snippetExpr} AS snippet, sd.updated_at, sd.item_ids_text, sd.epic_ids_text, sd.recommendation_refs_text, (SELECT rl.run_id FROM recommendation_lanes rl WHERE rl.lane_id = sd.document_id) AS recommendation_run_id ${from} ORDER BY ${input.match ? 'rank ASC,' : ''} CASE sd.document_type WHEN 'backlog_item' THEN 0 WHEN 'epic' THEN 1 WHEN 'session_plan' THEN 2 ELSE 3 END, COALESCE(sd.updated_at,'') DESC, sd.document_id ASC LIMIT ? OFFSET ?`, ...(params as never[]), input.limit, input.offset);
  return rows.map(rowToSearchHitRow);
}
export function countSearchDocuments(store: EforgePlanStore, input: Omit<SearchQueryInput, 'limit' | 'offset'>): number { const params: unknown[] = []; const from = baseSql({ ...input, limit: 1, offset: 0 }, params); return one<{ count: number }>(store, `SELECT COUNT(*) AS count ${from}`, ...(params as never[]))?.count ?? 0; }
export function countSearchDocumentsByType(store: EforgePlanStore, input: Omit<SearchQueryInput, 'limit' | 'offset'>): Partial<Record<SearchDocumentType, number>> { const params: unknown[] = []; const from = baseSql({ ...input, limit: 1, offset: 0 }, params); const rows = all<{ document_type: SearchDocumentType; count: number }>(store, `SELECT sd.document_type, COUNT(*) AS count ${from} GROUP BY sd.document_type`, ...(params as never[])); return Object.fromEntries(rows.map((r) => [r.document_type, r.count])) as Partial<Record<SearchDocumentType, number>>; }
export function getSearchDirtyStatus(store: EforgePlanStore): { dirtyCount: number; dirtyTypes: SearchDocumentType[]; dirtySince?: string; dirtyReason?: string; lastRebuiltAt?: string; dirty: boolean } { const state = one<Record<string, unknown>>(store, 'SELECT * FROM search_index_state WHERE id = 1')!; const rows = all<{ document_type: SearchDocumentType }>(store, 'SELECT DISTINCT document_type FROM search_index_dirty_records ORDER BY document_type'); const dirtyCount = one<{ count: number }>(store, 'SELECT COUNT(*) AS count FROM search_index_dirty_records')?.count ?? 0; return cleanUndefined({ dirty: Number(state.dirty) === 1 || dirtyCount > 0, dirtyCount, dirtyTypes: rows.map((r) => r.document_type), dirtySince: optionalString(state.dirty_since), dirtyReason: optionalString(state.dirty_reason), lastRebuiltAt: optionalString(state.last_rebuilt_at) }); }
export function rowToSearchHitRow(row: Record<string, unknown>): SearchHitRow { return cleanUndefined({ documentType: row.document_type as SearchDocumentType, documentId: row.document_id as string, title: row.title as string, rank: typeof row.rank === 'number' ? row.rank : undefined, snippet: optionalString(row.snippet), updatedAt: optionalString(row.updated_at), itemIdsText: optionalString(row.item_ids_text), epicIdsText: optionalString(row.epic_ids_text), recommendationRefsText: optionalString(row.recommendation_refs_text), recommendationRunId: optionalString(row.recommendation_run_id) }); }
export function hitRefs(row: SearchHitRow) { return cleanUndefined({ itemIds: splitWords(row.itemIdsText), epicIds: splitWords(row.epicIdsText), ...(row.documentType === 'session_plan' ? { session: row.documentId } : {}), recommendationRef: splitWords(row.recommendationRefsText)[0], ...(row.documentType === 'recommendation' ? { runId: row.recommendationRunId } : {}) }); }
