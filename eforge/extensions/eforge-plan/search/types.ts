import type { JsonValue, SearchDocumentType as SqliteSearchDocumentType } from '../sqlite/types.js';
import type { CompactItemProjection } from '../projections/types.js';
import type { KanbanLane } from '../schema.js';
import type { UserStatus } from '../sqlite/index.js';

export type SearchDocumentType = SqliteSearchDocumentType;
export type SearchSelectedField = 'rank' | 'snippet' | 'refs' | 'updatedAt';

export interface SearchSnippet { text: string; field?: 'title' | 'tags' | 'summary' | 'body' | 'itemIds' | 'epicIds' | 'recommendationRefs'; highlights: string[] }
export interface SearchIndexStatus { dirty: boolean; dirtyCount: number; dirtyTypes: SearchDocumentType[]; dirtySince?: string; dirtyReason?: string; lastRebuiltAt?: string }
export interface SearchPage { limit: number; offset: number; returned: number; hasMore: boolean; nextOffset?: number }
export interface SearchCounts { total: number; byType?: Partial<Record<SearchDocumentType, number>> }
export interface SearchResultRefs { itemIds?: string[]; epicIds?: string[]; session?: string; recommendationRef?: string; runId?: string }
export interface SearchResult { type: SearchDocumentType; id: string; title: string; rank?: number; snippet?: SearchSnippet; refs?: SearchResultRefs; updatedAt?: string }

export interface SearchItemsInput { query?: string; epic?: string; status?: UserStatus; lane?: KanbanLane; tags?: string[]; includeArchive?: boolean; searchBody?: boolean; includeEpics?: boolean; includeDependencies?: boolean; limit?: number; offset?: number }
export type CompactItemSearchResult = CompactItemProjection & { rank?: number; snippet?: SearchSnippet; matchedFields?: string[] };
export interface SearchItemsOutput { schemaVersion: 1; items: CompactItemSearchResult[]; epics?: unknown[]; total: number; limit: number; offset: number; snippets?: Record<string, SearchSnippet>; counts?: { total: number }; pagination: SearchPage; indexDirty: boolean; indexStatus: SearchIndexStatus }

export interface SearchPlanningRecordsInput { query?: string; types?: SearchDocumentType[]; itemIds?: string[]; epicIds?: string[]; sessions?: string[]; recommendationRefs?: string[]; includeHistoricalRecommendations?: boolean; fields?: SearchSelectedField[]; limit?: number; offset?: number }
export interface SearchPlanningRecordsOutput { schemaVersion: 1; results: SearchResult[]; total: number; countsByType: Partial<Record<SearchDocumentType, number>>; page: SearchPage; indexDirty: boolean; indexStatus: SearchIndexStatus }

export interface RefreshSearchDocumentsInput { types?: SearchDocumentType[]; records?: Array<{ type: SearchDocumentType; id: string }>; reason?: string }
export interface SearchRefreshReport { refreshed: number; deleted: number; clearedDirty: number; types: SearchDocumentType[]; rebuiltAt: string }
export interface SearchMaintenanceReport { optimizedAt: string; ok: boolean }

export interface SearchDocumentProjection { documentType: SearchDocumentType; documentId: string; title?: string; tagsText?: string; summaryText?: string; bodyText?: string; itemIdsText?: string; epicIdsText?: string; recommendationRefsText?: string; updatedAt?: string; refs?: SearchResultRefs; source: JsonValue }

export function clampSearchLimit(input?: { limit?: number; offset?: number }): { limit: number; offset: number } { return { limit: Math.min(Math.max(Math.trunc(input?.limit ?? 20), 1), 100), offset: Math.max(Math.trunc(input?.offset ?? 0), 0) }; }
export function searchPage(limit: number, offset: number, returned: number, total: number): SearchPage { const nextOffset = offset + returned; return { limit, offset, returned, hasMore: nextOffset < total, ...(nextOffset < total ? { nextOffset } : {}) }; }
