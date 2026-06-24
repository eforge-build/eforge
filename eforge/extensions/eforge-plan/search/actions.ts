import { CONTRIBUTION_OUTPUT_PROFILES, defineExtensionAction, type Static } from '@eforge-build/extension-sdk';
import { listAllCompactEpicsFromStore, hydrateCompactItemSearchResults, withProjectionStore } from '../projections/index.js';
import { getSearchDirtyStatus, hitRefs, querySearchDocuments, countSearchDocuments, countSearchDocumentsByType, type SearchHitRow } from '../sqlite/repositories/search-queries.js';
import { toJsonSafeObject } from '../json-safe.js';
import { buildFtsQuery } from './query-builder.js';
import { SearchItemsInputSchema, SearchItemsOutputSchema, SearchPlanningRecordsInputSchema, SearchPlanningRecordsOutputSchema } from './schemas.js';
import { clampSearchLimit, searchPage, type SearchItemsInput, type SearchItemsOutput, type SearchPlanningRecordsInput, type SearchPlanningRecordsOutput, type SearchResult, type SearchSelectedField, type SearchSnippet } from './types.js';

function emptyStatus() { return { dirty: false, dirtyCount: 0, dirtyTypes: [] as string[] }; }
function isBlankQuery(query: string | undefined): boolean { return query === undefined || query.trim().length === 0; }
function assertNoEmptyFilters(input: { epic?: string; tags?: string[]; types?: string[]; itemIds?: string[]; epicIds?: string[]; sessions?: string[]; recommendationRefs?: string[]; fields?: string[] }): void {
  if (input.epic !== undefined && input.epic.trim().length === 0) throw new Error('search filter "epic" must not be empty');
  for (const key of ['tags', 'types', 'itemIds', 'epicIds', 'sessions', 'recommendationRefs', 'fields'] as const) {
    const values = input[key];
    if (values?.some((value) => value.trim().length === 0)) throw new Error(`search filter "${key}" must not contain empty strings`);
  }
}
function snippetFromHit(hit: SearchHitRow): SearchSnippet | undefined {
  if (!hit.snippet || !hit.snippet.includes('<mark>')) return undefined;
  const highlights = Array.from(hit.snippet.matchAll(/<mark>(.*?)<\/mark>/g), (m) => m[1]).filter(Boolean);
  return { text: hit.snippet, highlights };
}
function applyFields(result: SearchResult, fields: readonly SearchSelectedField[] | undefined): SearchResult {
  if (!fields) return result;
  const include = new Set(fields);
  return { type: result.type, id: result.id, title: result.title, ...(include.has('rank') && result.rank !== undefined ? { rank: result.rank } : {}), ...(include.has('snippet') && result.snippet ? { snippet: result.snippet } : {}), ...(include.has('refs') && result.refs ? { refs: result.refs } : {}), ...(include.has('updatedAt') && result.updatedAt ? { updatedAt: result.updatedAt } : {}) };
}

export async function searchItems(cwd: string, input: SearchItemsInput): Promise<SearchItemsOutput> {
  assertNoEmptyFilters(input);
  return withProjectionStore<SearchItemsOutput>(cwd, (store) => {
    const status = getSearchDirtyStatus(store);
    const fts = buildFtsQuery(input.query, { searchBody: input.searchBody === true });
    if (fts.empty && !isBlankQuery(input.query)) { const page = clampSearchLimit(input); return { schemaVersion: 1, items: [], total: 0, limit: page.limit, offset: page.offset, counts: { total: 0 }, pagination: searchPage(page.limit, page.offset, 0, 0), indexDirty: status.dirty, indexStatus: status }; }
    const hitRows = fts.empty ? [] : querySearchDocuments(store, { match: fts.expression, types: ['backlog_item'], limit: 1000, offset: 0 });
    const hitById = new Map(hitRows.map((hit) => [hit.documentId, hit]));
    const hydrated = hydrateCompactItemSearchResults(store, { ids: fts.empty ? undefined : hitRows.map((hit) => hit.documentId), includeArchive: input.includeArchive, epic: input.epic, status: input.status, lane: input.lane, tags: input.tags, includeDependencies: input.includeDependencies, includeLinks: true, limit: input.limit, offset: input.offset });
    const items = hydrated.items.map((item) => { const hit = hitById.get(item.id); const snippet = hit ? snippetFromHit(hit) : undefined; return { ...item, ...(hit?.rank !== undefined ? { rank: hit.rank } : {}), ...(snippet ? { snippet, matchedFields: ['text'] } : {}) }; });
    const snippets = Object.fromEntries(items.map((item) => [item.id, item.snippet]).filter((entry): entry is [string, SearchSnippet] => entry[1] !== undefined));
    const pagination = searchPage(hydrated.limit, hydrated.offset, items.length, hydrated.total);
    return { schemaVersion: 1, items, ...(input.includeEpics === true ? { epics: listAllCompactEpicsFromStore(store).filter((epic) => items.some((item) => item.epic === epic.id)) } : {}), total: hydrated.total, limit: hydrated.limit, offset: hydrated.offset, ...(Object.keys(snippets).length ? { snippets } : {}), counts: { total: hydrated.total }, pagination, indexDirty: status.dirty, indexStatus: status };
  }, () => { const page = clampSearchLimit(input); return { schemaVersion: 1, items: [], total: 0, limit: page.limit, offset: page.offset, counts: { total: 0 }, pagination: searchPage(page.limit, page.offset, 0, 0), indexDirty: false, indexStatus: emptyStatus() as never }; });
}

export async function searchPlanningRecords(cwd: string, input: SearchPlanningRecordsInput): Promise<SearchPlanningRecordsOutput> {
  assertNoEmptyFilters(input);
  return withProjectionStore<SearchPlanningRecordsOutput>(cwd, (store) => {
    const page = clampSearchLimit(input);
    const fts = buildFtsQuery(input.query, { searchBody: true });
    if (fts.empty) { const status = getSearchDirtyStatus(store); return { schemaVersion: 1, results: [], total: 0, countsByType: {}, page: searchPage(page.limit, page.offset, 0, 0), indexDirty: status.dirty, indexStatus: status }; }
    const query = { match: fts.expression, types: input.types, itemIds: input.itemIds, epicIds: input.epicIds, sessions: input.sessions, recommendationRefs: input.recommendationRefs, includeHistoricalRecommendations: input.includeHistoricalRecommendations, limit: page.limit, offset: page.offset };
    const status = getSearchDirtyStatus(store);
    const total = countSearchDocuments(store, query);
    const countsByType = countSearchDocumentsByType(store, query);
    const results = querySearchDocuments(store, query).map((hit) => applyFields({ type: hit.documentType, id: hit.documentId, title: hit.title, rank: hit.rank, snippet: snippetFromHit(hit), refs: hitRefs(hit), updatedAt: hit.updatedAt }, input.fields));
    return { schemaVersion: 1, results, total, countsByType, page: searchPage(page.limit, page.offset, results.length, total), indexDirty: status.dirty, indexStatus: status };
  }, () => { const page = clampSearchLimit(input); return { schemaVersion: 1, results: [], total: 0, countsByType: {}, page: searchPage(page.limit, page.offset, 0, 0), indexDirty: false, indexStatus: emptyStatus() as never }; });
}

export const searchItemsAction = defineExtensionAction({ id: 'search-items', title: 'Search compact backlog items', description: 'Search SQL/FTS-backed compact backlog item summaries with ranked snippets, counts, filters, pagination, and explicit stale-index metadata.', inputSchema: SearchItemsInputSchema, outputSchema: SearchItemsOutputSchema, outputProfile: CONTRIBUTION_OUTPUT_PROFILES.agentPaginated, sideEffects: ['local-read'], async handler(input: Static<typeof SearchItemsInputSchema>, ctx) { return toJsonSafeObject(await searchItems(ctx.cwd, input)) as never; } });
export const searchPlanningRecordsAction = defineExtensionAction({ id: 'search-planning-records', title: 'Search planning records', description: 'Search SQL/FTS-backed backlog items, epics, session-plan summaries, and recommendation text with bounded ranked output.', inputSchema: SearchPlanningRecordsInputSchema, outputSchema: SearchPlanningRecordsOutputSchema, outputProfile: CONTRIBUTION_OUTPUT_PROFILES.agentPaginated, sideEffects: ['local-read'], async handler(input: Static<typeof SearchPlanningRecordsInputSchema>, ctx) { return toJsonSafeObject(await searchPlanningRecords(ctx.cwd, input)) as never; } });
export const searchActions = [searchItemsAction, searchPlanningRecordsAction] as const;
