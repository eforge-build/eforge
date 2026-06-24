import { existsSync } from 'node:fs';
import { userActionError } from '../action-errors.js';
import { openEforgePlanStore, resolveEforgePlanStorePath } from '../sqlite/db.js';
import { recordMaintenanceRun } from '../sqlite/repositories/maintenance.js';
import { optimizeSearchIndex, rebuildSearchIndex } from '../search/index.js';
import type { RebuildSearchIndexInput, SearchIndexMaintenanceActionReport } from './types.js';

function assertStore(cwd: string): void { if (!existsSync(resolveEforgePlanStorePath(cwd))) throw userActionError('eforge-plan SQLite store is not initialized; search maintenance requires an existing store.', { details: { initialized: false } }); }
function runId(prefix: string): string { return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`; }

export async function rebuildPlanningSearchIndex(cwd: string, input: RebuildSearchIndexInput = {}): Promise<SearchIndexMaintenanceActionReport> {
  assertStore(cwd);
  const id = runId('search-rebuild');
  const store = openEforgePlanStore(cwd, { create: false });
  const startedAt = new Date().toISOString();
  try {
    const searchRefresh = rebuildSearchIndex(store, input);
    recordMaintenanceRun(store, { runId: id, categories: ['search-rebuild'], startedAt, finishedAt: new Date().toISOString(), prunedCounts: { refreshed: searchRefresh.refreshed, deleted: searchRefresh.deleted, clearedDirty: searchRefresh.clearedDirty }, archivedCounts: {}, preservedEvidenceCounts: {}, status: 'applied' });
    return { schemaVersion: 1, runId: id, category: 'search-rebuild', status: 'applied', searchRefresh };
  } catch (error) {
    try { recordMaintenanceRun(store, { runId: id, categories: ['search-rebuild'], startedAt, finishedAt: new Date().toISOString(), prunedCounts: {}, archivedCounts: {}, preservedEvidenceCounts: {}, status: 'failed', errorSummary: error instanceof Error ? error.message : String(error) }); } catch {}
    throw error;
  } finally { store.close(); }
}

export async function optimizePlanningSearchIndex(cwd: string): Promise<SearchIndexMaintenanceActionReport> {
  assertStore(cwd);
  const id = runId('search-optimize');
  const store = openEforgePlanStore(cwd, { create: false });
  const startedAt = new Date().toISOString();
  try {
    const report = optimizeSearchIndex(store);
    recordMaintenanceRun(store, { runId: id, categories: ['search-optimize'], startedAt, finishedAt: new Date().toISOString(), prunedCounts: {}, archivedCounts: {}, preservedEvidenceCounts: {}, status: 'applied' });
    return { schemaVersion: 1, runId: id, category: 'search-optimize', status: 'applied', optimizedAt: report.optimizedAt, ok: report.ok };
  } catch (error) {
    try { recordMaintenanceRun(store, { runId: id, categories: ['search-optimize'], startedAt, finishedAt: new Date().toISOString(), prunedCounts: {}, archivedCounts: {}, preservedEvidenceCounts: {}, status: 'failed', errorSummary: error instanceof Error ? error.message : String(error) }); } catch {}
    throw error;
  } finally { store.close(); }
}
