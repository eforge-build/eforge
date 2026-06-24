import type { EforgePlanStore } from '../sqlite/index.js';
import { assertProtectedCountsUnchanged, getProtectedCounts, preserveLifecycleEvidenceSummariesInStore } from '../sqlite/repositories/maintenance-pruning.js';

export function preserveLifecycleEvidenceSummaries(store: EforgePlanStore): number {
  return preserveLifecycleEvidenceSummariesInStore(store);
}

export function snapshotProtectedCounts(store: EforgePlanStore) { return getProtectedCounts(store); }
export function validateProtectedCounts(before: ReturnType<typeof snapshotProtectedCounts>, store: EforgePlanStore): void { assertProtectedCountsUnchanged(before, getProtectedCounts(store)); }
