import { existsSync } from 'node:fs';
import { userActionError } from '../action-errors.js';
import { openEforgePlanStore, resolveEforgePlanStorePath } from '../sqlite/db.js';
import { recordMaintenanceRun } from '../sqlite/repositories/maintenance.js';
import { runVacuum, runWalCheckpoint } from '../sqlite/repositories/maintenance-pruning.js';
import { fileSizes } from './status.js';
import type { VacuumPlanningStoreInput, VacuumStoreReport } from './types.js';

export async function vacuumPlanningStore(cwd: string, input: VacuumPlanningStoreInput = {}): Promise<VacuumStoreReport> {
  const storePath = resolveEforgePlanStorePath(cwd);
  if (!existsSync(storePath)) throw userActionError('eforge-plan SQLite store is not initialized; VACUUM requires an existing store.', { details: { initialized: false } });
  const runId = `vacuum-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const before = fileSizes(storePath);
  const store = openEforgePlanStore(cwd, { create: false });
  const startedAt = new Date().toISOString();
  try {
    if (input.checkpointWal !== false) runWalCheckpoint(store);
    const afterCheckpoint = fileSizes(storePath);
    runVacuum(store);
    if (input.checkpointWal !== false) runWalCheckpoint(store);
    recordMaintenanceRun(store, { runId, categories: ['vacuum'], startedAt, finishedAt: new Date().toISOString(), prunedCounts: {}, archivedCounts: {}, preservedEvidenceCounts: {}, status: 'applied' });
    if (input.checkpointWal !== false) runWalCheckpoint(store);
    const after = fileSizes(storePath);
    return { schemaVersion: 1, runId, status: 'applied', beforeBytes: before.dbBytes, afterBytes: after.dbBytes, walBytesBefore: before.walBytes, walBytesAfter: after.walBytes, shmBytesBefore: before.shmBytes, shmBytesAfter: after.shmBytes, ...(input.checkpointWal !== false ? { checkpoint: { requested: true, walBytesBefore: before.walBytes, walBytesAfter: afterCheckpoint.walBytes } } : {}) };
  } catch (error) {
    try { recordMaintenanceRun(store, { runId, categories: ['vacuum'], startedAt, finishedAt: new Date().toISOString(), prunedCounts: {}, archivedCounts: {}, preservedEvidenceCounts: {}, status: 'failed', errorSummary: error instanceof Error ? error.message : String(error) }); } catch {}
    throw error;
  } finally { store.close(); }
}
