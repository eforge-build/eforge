import { existsSync } from 'node:fs';
import { userActionError } from '../action-errors.js';
import { toJsonSafeObject } from '../json-safe.js';
import { openEforgePlanStore, resolveEforgePlanStorePath } from '../sqlite/db.js';
import { recordMaintenanceRun } from '../sqlite/repositories/maintenance.js';
import { applyMaintenancePruning, collectMaintenanceCandidates } from '../sqlite/repositories/maintenance-pruning.js';
import { all } from '../sqlite/repositories/sql.js';
import { markSearchIndexDirtyBatch } from '../sqlite/repositories/search-documents.js';
import { rebuildSearchIndex } from '../search/index.js';
import { archiveCategoryRows } from './archive.js';
import { preserveLifecycleEvidenceSummaries, snapshotProtectedCounts, validateProtectedCounts } from './evidence.js';
import { normalizeMaintenancePolicy } from './policy.js';
import type { CompactPlanningStoreInput, MaintenanceReport } from './types.js';

export async function compactPlanningStore(cwd: string, input: CompactPlanningStoreInput = {}): Promise<MaintenanceReport> {
  const policy = normalizeMaintenancePolicy(input);
  const runId = `maintenance-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  if (!existsSync(resolveEforgePlanStorePath(cwd))) throw userActionError('eforge-plan SQLite store is not initialized; run a write action before maintenance.', { details: { initialized: false } });
  const store = openEforgePlanStore(cwd, { create: false });
  try {
    const candidates = Object.fromEntries(policy.categories.map((category) => [category, collectMaintenanceCandidates(store, category, policy)])) as Record<string, ReturnType<typeof collectMaintenanceCandidates>>;
    const prunedCounts = Object.fromEntries(policy.categories.map((category) => [category, candidates[category].count]));
    const samples = Object.fromEntries(policy.categories.map((category) => [category, candidates[category].samples]));
    if (policy.dryRun) return baseReport({ runId, policy, status: 'dry-run', prunedCounts, archivedCounts: {}, preservedEvidenceCounts: {}, archivePaths: [], samples });

    const archivePaths: MaintenanceReport['archivePaths'] = [];
    const archivedCounts: Record<string, number> = {};
    let searchRefresh: MaintenanceReport['searchRefresh'];
    const appliedCounts: Record<string, number> = {};
    const preservedEvidenceCounts: Record<string, number> = {};
    const startedAt = new Date().toISOString();
    const recommendationRunIds = candidates['superseded-recommendation-runs']?.ids ?? [];
    const recommendationDirtyRecords = collectRecommendationSearchDirtyRecords(store, recommendationRunIds);
    try {
      if (policy.archive) {
        for (const category of policy.categories) {
          const archivePath = archiveCategoryRows(cwd, runId, category, candidates[category].archiveRows);
          if (archivePath) {
            archivePaths.push(archivePath);
            archivedCounts[archivePath.category] = archivePath.rowCount;
          }
        }
      }
      store.transaction(() => {
        const protectedBefore = snapshotProtectedCounts(store);
        preservedEvidenceCounts.lifecycleEvidence = preserveLifecycleEvidenceSummaries(store);
        if (!policy.rebuildSearchAfter) markSearchIndexDirtyBatch(store, recommendationDirtyRecords);
        for (const category of policy.categories) appliedCounts[category] = applyMaintenancePruning(store, category, candidates[category].ids, policy.cutoff, policy.keepLatestRecommendationRuns, policy.keepLatestImportRuns);
        validateProtectedCounts(protectedBefore, store);
        recordMaintenanceRun(store, { runId, categories: policy.categories, startedAt, finishedAt: new Date().toISOString(), prunedCounts: appliedCounts, archivedCounts, preservedEvidenceCounts, status: 'applied' });
      });
    } catch (error) {
      try { recordMaintenanceRun(store, { runId, categories: policy.categories, startedAt, finishedAt: new Date().toISOString(), prunedCounts: appliedCounts, archivedCounts, preservedEvidenceCounts, status: 'failed', errorSummary: error instanceof Error ? error.message : String(error) }); } catch {}
      throw error;
    }
    const warnings: string[] = [];
    if (policy.rebuildSearchAfter && (appliedCounts['superseded-recommendation-runs'] ?? 0) > 0) {
      try { searchRefresh = rebuildSearchIndex(store, { types: ['recommendation'], reason: 'retention-maintenance' }); }
      catch (error) {
        markSearchIndexDirtyBatch(store, recommendationDirtyRecords);
        warnings.push(`Recommendation search refresh failed after applied compaction: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    return baseReport({ runId, policy, status: 'applied', prunedCounts: appliedCounts, archivedCounts, preservedEvidenceCounts, archivePaths, samples, searchRefresh, warnings });
  } finally { store.close(); }
}

function collectRecommendationSearchDirtyRecords(store: ReturnType<typeof openEforgePlanStore>, runIds: string[]): Array<{ documentType: 'recommendation'; documentId: string; reason: string }> {
  if (runIds.length === 0) return [];
  const placeholders = runIds.map(() => '?').join(',');
  const rows = all<{ lane_id: string }>(store, `SELECT lane_id FROM recommendation_lanes WHERE run_id IN (${placeholders})`, ...(runIds as never[]));
  return rows.map((row) => ({ documentType: 'recommendation', documentId: row.lane_id, reason: 'retention-maintenance' }));
}

function baseReport(input: { runId: string; policy: ReturnType<typeof normalizeMaintenancePolicy>; status: MaintenanceReport['status']; prunedCounts: Record<string, number>; archivedCounts: Record<string, number>; preservedEvidenceCounts: Record<string, number>; archivePaths: MaintenanceReport['archivePaths']; samples: MaintenanceReport['samples']; searchRefresh?: MaintenanceReport['searchRefresh']; warnings?: string[] }): MaintenanceReport {
  return toJsonSafeObject({ schemaVersion: 1, runId: input.runId, status: input.status, dryRun: input.policy.dryRun, categories: input.policy.categories, cutoff: input.policy.cutoff, archive: input.policy.archive, rowLimit: input.policy.rowLimit, sampleLimit: input.policy.sampleLimit, prunedCounts: input.prunedCounts, archivedCounts: input.archivedCounts, preservedEvidenceCounts: input.preservedEvidenceCounts, archivePaths: input.archivePaths, samples: input.samples, ...(input.searchRefresh ? { searchRefresh: input.searchRefresh } : {}), warnings: input.warnings ?? [] }) as MaintenanceReport;
}
