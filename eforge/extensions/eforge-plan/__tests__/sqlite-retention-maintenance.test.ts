import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { compactPlanningStore, normalizeMaintenancePolicy } from '../maintenance/index.js';
import { count, CUTOFF, readArchiveLines, rawDb, scalar, seedRetentionMaintenanceStore, withTempMaintenanceProject } from './sqlite-maintenance-fixtures.js';

describe('SQLite retention maintenance compaction', () => {
  it('normalizes the dry-run-first retention policy with bounded limits and timestamp overrides', () => {
    const policy = normalizeMaintenancePolicy({ olderThan: CUTOFF, rowLimit: 50000, sampleLimit: 500 });

    expect(policy).toMatchObject({ dryRun: true, cutoff: CUTOFF, rowLimit: 10000, sampleLimit: 100 });
    expect(policy.categories).toEqual([
      'lifecycle-event-payloads',
      'planning-task-payloads',
      'superseded-recommendation-runs',
    ]);
    expect(() => normalizeMaintenancePolicy({ olderThan: 'not-an-iso-date' })).toThrow(/olderThan/i);
  });

  it('dry-runs by default with bounded samples and no row, archive, or maintenance-run mutations', async () => {
    await withTempMaintenanceProject(async (cwd) => {
      seedRetentionMaintenanceStore(cwd);
      const before = rawDb(cwd);
      const beforePayloads = count(before, 'SELECT count(*) AS count FROM lifecycle_events WHERE payload_json IS NOT NULL');
      before.close();

      const report = await compactPlanningStore(cwd, { olderThan: CUTOFF, sampleLimit: 1, keepLatestRecommendationRuns: 0 });

      expect(report).toMatchObject({ schemaVersion: 1, status: 'dry-run', dryRun: true, archive: false, sampleLimit: 1 });
      expect(report.prunedCounts).toMatchObject({
        'lifecycle-event-payloads': 1,
        'planning-task-payloads': 1,
        'superseded-recommendation-runs': 1,
      });
      expect(report.samples['lifecycle-event-payloads']).toHaveLength(1);
      expect(JSON.stringify(report)).not.toMatch(/RAW_LIFECYCLE_PAYLOAD|RAW_TASK_REQUEST|HISTORICAL_RAW_MODEL/);
      expect(existsSync(join(cwd, '.eforge/storage/extensions/eforge-plan/archives'))).toBe(false);

      const after = rawDb(cwd);
      expect(count(after, 'SELECT count(*) AS count FROM store_maintenance_runs')).toBe(0);
      expect(count(after, 'SELECT count(*) AS count FROM lifecycle_events WHERE payload_json IS NOT NULL')).toBe(beforePayloads);
      after.close();
    });
  });

  it('applies compaction only to eligible raw data while preserving canonical rows and summaries', async () => {
    await withTempMaintenanceProject(async (cwd) => {
      seedRetentionMaintenanceStore(cwd);
      const before = rawDb(cwd);
      const protectedBefore = {
        items: count(before, 'SELECT count(*) AS count FROM backlog_items'),
        epics: count(before, 'SELECT count(*) AS count FROM epics'),
        dependencies: count(before, 'SELECT count(*) AS count FROM item_dependencies'),
        sessionPlans: count(before, 'SELECT count(*) AS count FROM session_plans'),
        sessionPlanItems: count(before, 'SELECT count(*) AS count FROM session_plan_items'),
        sessionPlanEpics: count(before, 'SELECT count(*) AS count FROM session_plan_epics'),
        queuePrds: count(before, 'SELECT count(*) AS count FROM queue_prds'),
        buildRuns: count(before, 'SELECT count(*) AS count FROM build_runs'),
        buildSessions: count(before, 'SELECT count(*) AS count FROM build_sessions'),
        landingLinks: count(before, 'SELECT count(*) AS count FROM landing_links'),
        currentEvidence: count(before, 'SELECT count(*) AS count FROM lifecycle_evidence WHERE is_current = 1'),
      };
      before.close();

      const report = await compactPlanningStore(cwd, { dryRun: false, olderThan: CUTOFF, archive: true, keepLatestRecommendationRuns: 0 });

      expect(report).toMatchObject({ status: 'applied', dryRun: false, archive: true });
      expect(report.archivePaths.map((entry) => entry.category).sort()).toEqual([
        'lifecycle-event-payloads',
        'planning-task-payloads',
        'superseded-recommendation-runs',
      ]);
      for (const archive of report.archivePaths) {
        expect(archive.path).toMatch(/^\.eforge\/storage\/extensions\/eforge-plan\/archives\/maintenance\//);
        expect(await readArchiveLines(cwd, archive.path)).toHaveLength(archive.rowCount);
      }

      const db = rawDb(cwd);
      expect(scalar<null>(db, 'SELECT payload_json FROM lifecycle_events WHERE event_key = ?', 'old-prunable-event')).toBeNull();
      expect(scalar<string>(db, 'SELECT payload_json FROM lifecycle_events WHERE event_key = ?', 'old-protected-event')).toContain('PROTECTED_LIFECYCLE_PAYLOAD');
      expect(scalar<string>(db, 'SELECT payload_json FROM lifecycle_events WHERE event_key = ?', 'new-prunable-event')).toContain('NEW_LIFECYCLE_PAYLOAD');
      expect(scalar<null>(db, 'SELECT raw_request_json FROM planning_tasks WHERE task_id = ?', 'old-terminal-task')).toBeNull();
      expect(scalar<null>(db, 'SELECT raw_result_json FROM planning_tasks WHERE task_id = ?', 'old-terminal-task')).toBeNull();
      expect(db.prepare('SELECT purpose,status_snapshot,selection_summary_json,compact_result_summary_json,applied_at FROM planning_tasks WHERE task_id = ?').get('old-terminal-task')).toMatchObject({ purpose: 'session-plan-creation', status_snapshot: 'applied', applied_at: '2025-01-01T00:00:00.000Z' });
      expect(scalar<string>(db, 'SELECT raw_request_json FROM planning_tasks WHERE task_id = ?', 'active-task')).toContain('ACTIVE_TASK_REQUEST');
      expect(count(db, 'SELECT count(*) AS count FROM recommendation_runs WHERE run_id = ?', 'rec-old')).toBe(0);
      expect(count(db, 'SELECT count(*) AS count FROM recommendation_runs WHERE run_id = ? AND is_current = 1', 'rec-current')).toBe(1);
      expect(scalar<string>(db, 'SELECT retained_summary_json FROM lifecycle_evidence WHERE evidence_key = ?', 'evidence-current')).toMatch(/active-build|Current lifecycle summary|build-session-keep/);
      expect(count(db, 'SELECT count(*) AS count FROM store_maintenance_runs WHERE status = ?', 'applied')).toBe(1);
      expect({
        items: count(db, 'SELECT count(*) AS count FROM backlog_items'),
        epics: count(db, 'SELECT count(*) AS count FROM epics'),
        dependencies: count(db, 'SELECT count(*) AS count FROM item_dependencies'),
        sessionPlans: count(db, 'SELECT count(*) AS count FROM session_plans'),
        sessionPlanItems: count(db, 'SELECT count(*) AS count FROM session_plan_items'),
        sessionPlanEpics: count(db, 'SELECT count(*) AS count FROM session_plan_epics'),
        queuePrds: count(db, 'SELECT count(*) AS count FROM queue_prds'),
        buildRuns: count(db, 'SELECT count(*) AS count FROM build_runs'),
        buildSessions: count(db, 'SELECT count(*) AS count FROM build_sessions'),
        landingLinks: count(db, 'SELECT count(*) AS count FROM landing_links'),
        currentEvidence: count(db, 'SELECT count(*) AS count FROM lifecycle_evidence WHERE is_current = 1'),
      }).toEqual(protectedBefore);
      db.close();
    });
  });
});
