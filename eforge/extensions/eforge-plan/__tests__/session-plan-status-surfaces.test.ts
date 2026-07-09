import { resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { captureCanonicalBacklogItem } from '../canonical/backlog-records.js';
import { recordCanonicalLifecycleEvent } from '../canonical/lifecycle-records.js';
import { listPlanningArtifactsProjection, showSessionPlanProjection } from '../projections/index.js';
import { seedProjectionBacklog, withTempProjectionProject, writeSessionPlan } from './sqlite-projection-fixtures.js';

const STATUS_SOURCE_DISCLOSURE = 'status source = canonical eforge-plan SQLite session-plan status records in the eforge-plan extension store; lifecycle/projection records, monitor events, event-tail output, and status fields are derived evidence or diagnostics.';

describe('session-plan status surface projections', () => {
  it('exposes canonical status-source disclosure on list and show surfaces', async () => {
    await withTempProjectionProject(async (cwd) => {
      seedProjectionBacklog(cwd);
      writeSessionPlan(cwd, 'status-source-plan', ['planned'], { status: 'ready' });

      const listed = await listPlanningArtifactsProjection(cwd, { includeSubmitted: true, limit: 100 });
      const artifact = listed.artifacts.find((entry: { session?: string }) => entry.session === 'status-source-plan');
      const shown = await showSessionPlanProjection(cwd, 'status-source-plan');

      expect(artifact).toMatchObject({
        session: 'status-source-plan',
        status: 'ready',
        statusSource: 'eforge-plan-sqlite-session-plan-status',
        statusSourceDisclosure: STATUS_SOURCE_DISCLOSURE,
      });
      expect(shown).toMatchObject({
        session: 'status-source-plan',
        statusSource: 'eforge-plan-sqlite-session-plan-status',
        statusSourceDisclosure: STATUS_SOURCE_DISCLOSURE,
        plan: expect.objectContaining({ status: 'ready' }),
      });
    });
  });

  it('uses canonical SQLite status when Markdown frontmatter diverges', async () => {
    await withTempProjectionProject(async (cwd) => {
      seedProjectionBacklog(cwd);
      writeSessionPlan(cwd, 'divergent-status-source-plan', ['planned'], { status: 'ready' });
      const db = new DatabaseSync(resolve(cwd, '.eforge/storage/extensions/eforge-plan/eforge-plan-private.sqlite'));
      try {
        db.prepare('UPDATE session_plans SET status = ? WHERE session = ?').run('submitted', 'divergent-status-source-plan');
      } finally {
        db.close();
      }

      const listed = await listPlanningArtifactsProjection(cwd, { includeSubmitted: true, limit: 100 });
      const artifact = listed.artifacts.find((entry: { session?: string }) => entry.session === 'divergent-status-source-plan');
      const shown = await showSessionPlanProjection(cwd, 'divergent-status-source-plan');

      expect(artifact).toMatchObject({ session: 'divergent-status-source-plan', status: 'submitted', statusSource: 'eforge-plan-sqlite-session-plan-status' });
      expect(shown.plan).toMatchObject({ status: 'submitted' });
      expect(shown.statusSourceDisclosure).toBe(STATUS_SOURCE_DISCLOSURE);
    });
  });

  it('keeps mixed planned and shipped source evidence partial with explanatory reasons and item rows', async () => {
    await withTempProjectionProject(async (cwd) => {
      seedProjectionBacklog(cwd);
      writeSessionPlan(cwd, 'mixed-planned-shipped', ['planned', 'shipped']);

      const shown = await showSessionPlanProjection(cwd, 'mixed-planned-shipped');

      expect(shown.lifecycle).toMatchObject({
        state: 'partial',
        partialReasons: [expect.objectContaining({
          code: 'mixed-source-states',
          message: expect.stringContaining('mixed lifecycle states'),
        })],
      });
      expect(shown.lifecycle.itemRows).toEqual(expect.arrayContaining([
        expect.objectContaining({ itemId: 'planned', lifecycleState: 'planned' }),
        expect.objectContaining({ itemId: 'shipped', lifecycleState: 'shipped' }),
      ]));
    });
  });

  it('projects same-state recovered source items to their shared lifecycle state', async () => {
    await withTempProjectionProject(async (cwd) => {
      seedProjectionBacklog(cwd);
      captureCanonicalBacklogItem(cwd, { id: 'running-copy', title: 'Running Copy', status: 'active', epicId: 'epic-a' });
      writeSessionPlan(cwd, 'two-running-items', ['running', 'running-copy']);
      recordCanonicalLifecycleEvent(cwd, {
        eventKey: 'running-copy-1',
        type: 'session:start',
        session: 'two-running-items',
        sessionId: 'build-session-copy',
        runId: 'run-copy',
        timestamp: '2027-01-01T00:08:00.000Z',
      }, ['running-copy']);

      const shown = await showSessionPlanProjection(cwd, 'two-running-items');

      expect(shown.lifecycle).toMatchObject({
        state: 'build',
        lifecycleState: 'build',
        partialReasons: [],
      });
      expect(shown.lifecycle.itemRows).toEqual(expect.arrayContaining([
        expect.objectContaining({ itemId: 'running', lifecycleState: 'build' }),
        expect.objectContaining({ itemId: 'running-copy', lifecycleState: 'build' }),
      ]));
    });
  });
});
