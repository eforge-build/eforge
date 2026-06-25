import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { getSessionPlanLifecycleProjection, listPlanningArtifactsProjection, showSessionPlanProjection } from '../projections/index.js';
import { openEforgePlanStore } from '../sqlite/index.js';
import { seedProjectionBacklog, withTempProjectionProject, writeSessionPlan } from './sqlite-projection-fixtures.js';

describe('SQLite session-plan projections', () => {
  it('lists flat session-plan lifecycle rows from SQLite with bounded pagination', async () => {
    await withTempProjectionProject(async (cwd) => {
      seedProjectionBacklog(cwd);
      writeSessionPlan(cwd, 'plan-extra', ['candidate', 'planned'], { recommendationRef: 'lane:extra' });

      const output = await listPlanningArtifactsProjection(cwd, { limit: 2, offset: 0, includeSubmitted: true });
      const second = await listPlanningArtifactsProjection(cwd, { limit: 2, offset: 2, includeSubmitted: true });

      expect(output).toMatchObject({ limit: 2, offset: 0, total: expect.any(Number), pagination: expect.objectContaining({ returned: 2, hasMore: true, nextOffset: 2 }) });
      expect(output.plans.length).toBeLessThanOrEqual(2);
      expect([...output.artifacts, ...second.artifacts]).toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: 'plan', session: 'plan-extra', lifecycle: expect.objectContaining({ itemIds: ['candidate', 'planned'], state: 'partial' }) }),
      ]));
    });
  });

  it('shows SQLite source refs and lifecycle while loading the body from the Markdown artifact', async () => {
    await withTempProjectionProject(async (cwd) => {
      seedProjectionBacklog(cwd);
      const path = writeSessionPlan(cwd, 'plan-body', ['candidate', 'running'], { recommendationRef: 'lane:body' });
      writeFileSync(path, '---\nsession: plan-body\nstatus: ready\n---\n# Artifact Body\n\nThis text must come from Markdown.\n');

      const output = await showSessionPlanProjection(cwd, 'plan-body');

      expect(output).toMatchObject({ session: 'plan-body', path: expect.stringContaining('.eforge/session-plans/plan-body.md') });
      expect(output.body).toContain('This text must come from Markdown.');
      expect(output.sourceRefs).toMatchObject({ sourceItemIds: ['candidate', 'running'], sourceEpicIds: [], recommendationRef: 'lane:body' });
      expect(output.sourceRefRows).toEqual(expect.arrayContaining([
        expect.objectContaining({ itemRef: 'candidate', provenance: 'selected-item', sourceRecommendationRef: 'lane:body' }),
        expect.objectContaining({ itemRef: 'running', provenance: 'selected-item', sourceRecommendationRef: 'lane:body' }),
      ]));
      expect(output.lifecycle).toMatchObject({ session: 'plan-body', itemIds: ['candidate', 'running'], state: 'partial' });
      expect(output.lifecycle.associatedLinks).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'build-run', runId: 'run-1' })]));
    });
  });

  it('hides imported trace-sidecar placeholders from active artifact lists', async () => {
    await withTempProjectionProject(async (cwd) => {
      seedProjectionBacklog(cwd);
      const store = openEforgePlanStore(cwd);
      const db = new DatabaseSync(store.path);
      store.close();
      try {
        db.prepare("INSERT INTO session_plans (session, path, topic, status, frontmatter_json, import_origin) VALUES (?, ?, ?, ?, '{}', ?)")
          .run('trace-placeholder', '.eforge/session-plans/archive/trace-placeholder.md', 'Trace placeholder', 'ready', 'trace-sidecar');
      } finally { db.close(); }

      const output = await listPlanningArtifactsProjection(cwd, { limit: 100, includeSubmitted: true });

      expect(output.artifacts.some((artifact: { session?: string }) => artifact.session === 'trace-placeholder')).toBe(false);
    });
  });

  it('keeps plan-set artifacts from the input adapter alongside SQL flat plans', async () => {
    await withTempProjectionProject(async (cwd) => {
      seedProjectionBacklog(cwd);
      const planSetDir = join(cwd, '.eforge/session-plans/set-a');
      mkdirSync(planSetDir, { recursive: true });
      writeFileSync(join(planSetDir, 'plan-set.yaml'), 'id: set-a\ntitle: Set A\nstatus: planning\nstrategy: dag\nchildren: []\n');

      const output = await listPlanningArtifactsProjection(cwd, { limit: 100, includeSubmitted: true });

      expect(output.artifacts).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'plan', session: 'plan-planned' })]));
      expect(output.artifacts.some((artifact: { kind: string }) => artifact.kind === 'plan-set')).toBe(true);
    });
  });

  it('returns lifecycle for partial multi-item session plans with per-item links', async () => {
    await withTempProjectionProject(async (cwd) => {
      seedProjectionBacklog(cwd);
      writeSessionPlan(cwd, 'plan-partial', ['candidate', 'running']);

      const lifecycle = await getSessionPlanLifecycleProjection(cwd, 'plan-partial');

      expect(lifecycle).toMatchObject({ session: 'plan-partial', itemIds: ['candidate', 'running'], state: 'partial' });
      expect(lifecycle.associatedLinks).toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: 'session-plan', session: 'plan-partial' }),
        expect.objectContaining({ kind: 'build-session', buildSessionId: 'build-session-1' }),
      ]));
    });
  });
});
