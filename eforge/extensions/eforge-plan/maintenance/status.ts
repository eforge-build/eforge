import { existsSync, statSync } from 'node:fs';
import { resolveEforgePlanStorePath, openEforgePlanStore, getEforgePlanSchemaVersion } from '../sqlite/db.js';
import { listRecentMaintenanceRuns } from '../sqlite/repositories/maintenance.js';
import { listTableCounts, retentionEligibilityCounts } from '../sqlite/repositories/maintenance-pruning.js';
import { getSearchIndexStatus } from '../search/index.js';
import { normalizeMaintenancePolicy } from './policy.js';
import type { GetStoreStatusInput, PlanningStoreStatus } from './types.js';

export async function getPlanningStoreStatus(cwd: string, input: GetStoreStatusInput = {}): Promise<PlanningStoreStatus> {
  const storePath = resolveEforgePlanStorePath(cwd);
  if (!existsSync(storePath)) {
    return { schemaVersion: 1, initialized: false, storePath, fileSizes: fileSizes(storePath), tableCounts: [], retentionEligibilityCounts: {}, recentMaintenanceRuns: [] };
  }
  const policy = normalizeMaintenancePolicy({});
  const store = openEforgePlanStore(cwd, { create: false, readonly: true });
  try {
    return {
      schemaVersion: 1,
      initialized: true,
      storePath,
      fileSizes: fileSizes(storePath),
      sqliteSchemaVersion: getEforgePlanSchemaVersion(store),
      tableCounts: listTableCounts(store),
      retentionEligibilityCounts: retentionEligibilityCounts(store, policy),
      searchIndexStatus: getSearchIndexStatus(store),
      recentMaintenanceRuns: listRecentMaintenanceRuns(store, input.recentRunLimit ?? 10) as never,
    };
  } finally { store.close(); }
}

export function fileSizes(storePath: string) {
  return { dbBytes: size(storePath), walBytes: size(`${storePath}-wal`), shmBytes: size(`${storePath}-shm`) };
}
function size(path: string): number { return existsSync(path) ? statSync(path).size : 0; }
