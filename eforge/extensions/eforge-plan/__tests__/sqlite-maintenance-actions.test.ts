import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { invokeMaintenanceAction, seedRetentionMaintenanceStore, storeExists, withTempMaintenanceProject } from './sqlite-maintenance-fixtures.js';

describe('SQLite maintenance extension actions', () => {
  it('reports an uninitialized store without creating storage directories', async () => {
    await withTempMaintenanceProject(async (cwd) => {
      const output = await invokeMaintenanceAction(cwd, 'get-store-status');

      expect(output).toMatchObject({ schemaVersion: 1, initialized: false, tableCounts: [], retentionEligibilityCounts: {}, recentMaintenanceRuns: [] });
      expect(output.storePath).toContain('.eforge/storage/extensions/eforge-plan/eforge-plan-private.sqlite');
      expect(storeExists(cwd)).toBe(false);
      expect(existsSync(join(cwd, '.eforge/storage/extensions/eforge-plan'))).toBe(false);
    });
  });

  it('dispatches compact-planning-store with capped limits and action-safe output', async () => {
    await withTempMaintenanceProject(async (cwd) => {
      seedRetentionMaintenanceStore(cwd);

      const output = await invokeMaintenanceAction(cwd, 'compact-planning-store', { dryRun: false, olderThan: '2026-01-01T00:00:00.000Z', rowLimit: 50000, sampleLimit: 500, keepLatestRecommendationRuns: 0 });

      expect(output).toMatchObject({ schemaVersion: 1, status: 'applied', dryRun: false, rowLimit: 10000, sampleLimit: 100 });
      expect(output.prunedCounts).toMatchObject({
        'lifecycle-event-payloads': 1,
        'planning-task-payloads': 1,
        'superseded-recommendation-runs': 1,
      });
      expect(JSON.stringify(output)).not.toMatch(/payload_json|raw_request_json|raw_result_json|raw_model_json|verbose_report_json|details_json/);
      expect(JSON.stringify(output)).not.toMatch(/RAW_LIFECYCLE_PAYLOAD|RAW_TASK_REQUEST|RAW_TASK_RESULT|HISTORICAL_RAW_MODEL/);
    });
  });

  it('reports populated store status with sizes, table counts, eligibility counts, search state, and recent runs', async () => {
    await withTempMaintenanceProject(async (cwd) => {
      seedRetentionMaintenanceStore(cwd);
      await invokeMaintenanceAction(cwd, 'compact-planning-store', { dryRun: false, olderThan: '2026-01-01T00:00:00.000Z', keepLatestRecommendationRuns: 0 });

      const status = await invokeMaintenanceAction(cwd, 'get-store-status', { recentRunLimit: 5 });

      expect(status).toMatchObject({
        schemaVersion: 1,
        initialized: true,
        fileSizes: { dbBytes: expect.any(Number), walBytes: expect.any(Number), shmBytes: expect.any(Number) },
        searchIndexStatus: expect.objectContaining({ dirty: expect.any(Boolean) }),
      });
      expect(status.tableCounts).toEqual(expect.arrayContaining([expect.objectContaining({ table: 'backlog_items', count: expect.any(Number) }), expect.objectContaining({ table: 'store_maintenance_runs', count: 1 })]));
      expect(status.retentionEligibilityCounts).toMatchObject({
        'lifecycle-event-payloads': expect.any(Number),
        'planning-task-payloads': expect.any(Number),
        'superseded-recommendation-runs': expect.any(Number),
      });
      expect(status.recentMaintenanceRuns).toEqual([expect.objectContaining({ status: 'applied' })]);
      expect(JSON.stringify(status)).not.toMatch(/RAW_LIFECYCLE_PAYLOAD|RAW_TASK_REQUEST|HISTORICAL_RAW_MODEL/);
    });
  });
});
