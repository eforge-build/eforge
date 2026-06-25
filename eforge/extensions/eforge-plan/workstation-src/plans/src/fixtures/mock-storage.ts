import type { JsonObject, SearchPlanningRecordsResponse } from '@/types';
import type { MaintenanceActionReport, PlanningStoreStatus } from '@/workstation-view-model-types';

export const mockStoreStatus: PlanningStoreStatus = {
  schemaVersion: 1,
  initialized: true,
  storePath: '.eforge/storage/extensions/eforge-plan/eforge-plan-private.sqlite',
  fileSizes: { dbBytes: 262144, walBytes: 32768, shmBytes: 32768 },
  sqliteSchemaVersion: 1,
  tableCounts: [],
  searchIndexStatus: { dirty: true, dirtyCount: 3, dirtyTypes: ['backlog_item', 'session_plan'], dirtySince: '2026-06-07T00:00:00.000Z', lastRebuiltAt: '2026-06-06T00:00:00.000Z' },
  retentionEligibilityCounts: { 'lifecycle-event-payloads': 3, 'planning-task-payloads': 2 },
  recentMaintenanceRuns: [{ actionId: 'compact-planning-store', status: 'dry-run', completedAt: '2026-06-07T00:10:00.000Z', summary: '5 records eligible for compaction.' }],
};

export const mockMissingStoreStatus: PlanningStoreStatus = {
  schemaVersion: 1,
  initialized: false,
  storePath: '.eforge/storage/extensions/eforge-plan/eforge-plan-private.sqlite',
  fileSizes: { dbBytes: 0, walBytes: 0, shmBytes: 0 },
  tableCounts: [],
  retentionEligibilityCounts: {},
  recentMaintenanceRuns: [],
};

export const mockSearchResults: SearchPlanningRecordsResponse = {
  schemaVersion: 1,
  results: [
    { type: 'backlog_item', id: 'add-import-preview', title: 'Add import preview', rank: 9.2, snippet: { text: 'Add <mark>import</mark> preview before writes.', field: 'summary', highlights: ['import'] }, refs: { itemIds: ['add-import-preview'] }, updatedAt: '2026-06-07T00:00:00.000Z' },
    { type: 'epic', id: 'planning', title: 'Planning workstation', rank: 7.1, snippet: { text: '<mark>Planning</mark> storage and search.', field: 'title', highlights: ['Planning'] }, refs: { epicIds: ['planning'] } },
    { type: 'session_plan', id: '2026-06-07-import-preview', title: 'Import preview plan', rank: 6.4, snippet: { text: 'Session plan for <mark>import</mark> workflow.', field: 'body', highlights: ['import'] }, refs: { session: '2026-06-07-import-preview', itemIds: ['add-import-preview'] } },
    { type: 'recommendation', id: 'next-import-preview', title: 'Recommend import preview', rank: 5.5, snippet: { text: 'Recommendation mentions <mark>import</mark> preview.', field: 'body', highlights: ['import'] }, refs: { recommendationRef: 'next-import-preview' } },
  ],
  total: 4,
  countsByType: { backlog_item: 1, epic: 1, session_plan: 1, recommendation: 1 },
  page: { limit: 20, offset: 0, returned: 4, hasMore: false },
  indexDirty: true,
  indexStatus: { dirty: true, dirtyCount: 3, dirtyTypes: ['backlog_item', 'session_plan'] },
};

export function searchMockPlanningRecords(input: JsonObject = {}): SearchPlanningRecordsResponse {
  const query = typeof input.query === 'string' ? input.query.trim().toLowerCase() : '';
  const limit = typeof input.limit === 'number' ? Math.min(input.limit, 20) : 20;
  const offset = typeof input.offset === 'number' ? input.offset : 0;
  const types = Array.isArray(input.types) ? new Set(input.types.map(String)) : null;
  const results = mockSearchResults.results.filter((result) => (!types || types.has(result.type)) && (!query || `${result.title} ${result.snippet?.text ?? ''}`.toLowerCase().includes(query)));
  const pageResults = results.slice(offset, offset + limit);
  return { ...mockSearchResults, results: pageResults, total: results.length, countsByType: countByType(results), page: { limit, offset, returned: pageResults.length, hasMore: offset + pageResults.length < results.length, ...(offset + pageResults.length < results.length ? { nextOffset: offset + pageResults.length } : {}) } };
}

export function mockMaintenanceReport(actionId: string, input: JsonObject = {}): MaintenanceActionReport {
  return { schemaVersion: 1, actionId, dryRun: input.dryRun === true, summary: `${actionId} completed in mock bridge.`, counts: { inspected: 5, changed: input.dryRun === true ? 0 : 3 }, samples: [{ id: 'add-import-preview', action: input.dryRun === true ? 'would-compact' : 'updated' }] };
}

function countByType(results: SearchPlanningRecordsResponse['results']): SearchPlanningRecordsResponse['countsByType'] {
  return results.reduce<SearchPlanningRecordsResponse['countsByType']>((counts, result) => ({ ...counts, [result.type]: (counts[result.type] ?? 0) + 1 }), {});
}
