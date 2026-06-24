import { describe, expect, it } from 'vitest';
import { invokeMaintenanceAction, seedRetentionMaintenanceStore, withTempMaintenanceProject } from './sqlite-maintenance-fixtures.js';

describe('SQLite maintenance projection preservation', () => {
  it('preserves current board lanes, recommendation actionability, and item detail projections after compaction', async () => {
    await withTempMaintenanceProject(async (cwd) => {
      seedRetentionMaintenanceStore(cwd);
      await invokeMaintenanceAction(cwd, 'rebuild-search-index', { types: ['backlog_item', 'epic', 'recommendation'] });

      const boardBefore = await invokeMaintenanceAction(cwd, 'list-board-compact', { limit: 50, includeArchive: true });
      const itemBefore = await invokeMaintenanceAction(cwd, 'get-item', { id: 'item-current', includeLifecycleRows: true, includeDependencies: true });
      const recommendationsBefore = await invokeMaintenanceAction(cwd, 'get-recommendations');
      const searchBefore = await invokeMaintenanceAction(cwd, 'search-planning-records', { query: 'Current lane', types: ['recommendation'], limit: 10 });

      await invokeMaintenanceAction(cwd, 'compact-planning-store', { dryRun: false, olderThan: '2026-01-01T00:00:00.000Z', keepLatestRecommendationRuns: 0, keepLatestImportRuns: 0 });

      const boardAfter = await invokeMaintenanceAction(cwd, 'list-board-compact', { limit: 50, includeArchive: true });
      const itemAfter = await invokeMaintenanceAction(cwd, 'get-item', { id: 'item-current', includeLifecycleRows: true, includeDependencies: true });
      const recommendationsAfter = await invokeMaintenanceAction(cwd, 'get-recommendations');
      const searchAfter = await invokeMaintenanceAction(cwd, 'search-planning-records', { query: 'Current lane', types: ['recommendation'], limit: 10 });
      const oldSearchAfter = await invokeMaintenanceAction(cwd, 'search-planning-records', { query: 'Historical lane', types: ['recommendation'], limit: 10 });

      expect(JSON.stringify(boardAfter)).toContain('item-current');
      expect(JSON.stringify(boardAfter)).toContain('active-build');
      expect(JSON.stringify(boardAfter)).toContain('active');
      expect(JSON.stringify(boardAfter)).toBe(JSON.stringify(boardBefore));
      expect(itemAfter).toEqual(itemBefore);
      expect(JSON.stringify(recommendationsAfter)).toContain('next:item-current');
      expect(JSON.stringify(recommendationsAfter)).toContain('item-current');
      expect(JSON.stringify(recommendationsAfter)).toContain('reasonCode');
      expect(recommendationsAfter).toEqual(recommendationsBefore);
      expect(JSON.stringify(searchBefore)).toContain('lane-current');
      expect(JSON.stringify(searchAfter)).toContain('lane-current');
      expect(JSON.stringify(oldSearchAfter)).not.toContain('lane-old');
      expect(JSON.stringify(boardAfter)).not.toMatch(/RAW_LIFECYCLE_PAYLOAD|RAW_TASK_REQUEST|HISTORICAL_RAW_MODEL/);
    });
  });
});
