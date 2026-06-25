import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { createSessionPlanningWorkflowAdapter } from '@eforge-build/input';
import { syncSessionPlanArtifact } from '../canonical/session-plan-records.js';
import { getSessionPlanLifecycleProjection, listPlanningArtifactsProjection, showSessionPlanProjection } from '../projections/index.js';
import { openEforgePlanStore } from '../sqlite/index.js';
import { seedProjectionBacklog, withTempProjectionProject, writeSessionPlan } from './sqlite-projection-fixtures.js';

function readinessPlanContent(session: string, body: string, status = 'planning'): string {
  return `---\nsession: ${session}\ntopic: ${session}\nstatus: ${status}\nplanning_type: feature\nplanning_depth: quick\nrequired_dimensions:\n  - problem-statement\n  - scope\n  - acceptance-criteria\n  - assumptions-and-validation\noptional_dimensions: []\nskipped_dimensions: []\nopen_questions: []\nprofile: null\n---\n${body}`;
}

function readyBody(title = 'Ready Plan'): string {
  return [`# ${title}`, '', '## Problem Statement', '', 'The specific user-visible failure is documented with source evidence.', '', '## Scope', '', 'Update eforge/extensions/eforge-plan/projections/session-plans.ts only.', '', '## Acceptance Criteria', '', '- `pnpm type-check` exits 0.', '- eforge/extensions/eforge-plan/projections/session-plans.ts exposes readiness metadata.', '', '## Assumptions And Validation', '', 'Validation uses the existing TypeScript type-check command.', ''].join('\n');
}

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

  it('projects cached, missing, and stale readiness freshness for show and list artifacts', async () => {
    await withTempProjectionProject(async (cwd) => {
      const dir = join(cwd, '.eforge/session-plans');
      mkdirSync(dir, { recursive: true });
      const freshPath = join(dir, 'fresh-ready.md');
      const missingPath = join(dir, 'missing-ready.md');
      const stalePath = join(dir, 'stale-ready.md');
      const fresh = readinessPlanContent('fresh-ready', readyBody('Fresh Ready'));
      const missing = readinessPlanContent('missing-ready', readyBody('Missing Ready'));
      const staleOriginal = readinessPlanContent('stale-ready', readyBody('Stale Ready'));
      const staleCurrent = readinessPlanContent('stale-ready', '# Stale Ready\n\n## Scope\n\nOnly one section.\n');
      writeFileSync(freshPath, fresh);
      writeFileSync(missingPath, missing);
      writeFileSync(stalePath, staleOriginal);
      syncSessionPlanArtifact(cwd, { session: 'fresh-ready', path: freshPath, content: fresh, readinessSummary: { ready: true, missingDimensions: [], coveredDimensions: ['problem-statement'], skippedDimensions: [] } });
      syncSessionPlanArtifact(cwd, { session: 'missing-ready', path: missingPath, content: missing });
      syncSessionPlanArtifact(cwd, { session: 'stale-ready', path: stalePath, content: staleOriginal, readinessSummary: { ready: true, missingDimensions: [], coveredDimensions: ['problem-statement'], skippedDimensions: [] } });
      writeFileSync(stalePath, staleCurrent);

      const expectedMissingReadiness = await createSessionPlanningWorkflowAdapter().flat.readiness({ cwd, session: 'missing-ready' });
      const expectedStaleReadiness = await createSessionPlanningWorkflowAdapter().flat.readiness({ cwd, session: 'stale-ready' });
      const freshOutput = await showSessionPlanProjection(cwd, 'fresh-ready');
      const missingOutput = await showSessionPlanProjection(cwd, 'missing-ready');
      const staleOutput = await showSessionPlanProjection(cwd, 'stale-ready');
      const listed = await listPlanningArtifactsProjection(cwd, { limit: 100, includeSubmitted: true });
      const listedFresh = (listed.plans as Array<Record<string, unknown>>).find((plan) => plan.session === 'fresh-ready');
      const listedMissing = (listed.plans as Array<Record<string, unknown>>).find((plan) => plan.session === 'missing-ready');
      const listedStale = (listed.plans as Array<Record<string, unknown>>).find((plan) => plan.session === 'stale-ready');

      expect(freshOutput).toMatchObject({ readiness: expect.objectContaining({ ready: true }), readinessSource: 'cache', readinessFreshness: expect.objectContaining({ state: 'fresh' }) });
      expect(missingOutput).toMatchObject({ readinessSource: 'markdown', readinessFreshness: expect.objectContaining({ state: 'missing' }) });
      expect(missingOutput.readiness).toEqual(expectedMissingReadiness);
      expect(staleOutput).toMatchObject({ readinessSource: 'markdown', readinessFreshness: expect.objectContaining({ state: 'stale' }) });
      expect(staleOutput.readiness).toEqual(expectedStaleReadiness);
      expect(listedFresh).toMatchObject({ readinessSource: 'cache', readinessFreshness: expect.objectContaining({ state: 'fresh' }) });
      expect(listedMissing).toMatchObject({ readinessSource: 'markdown', readinessFreshness: expect.objectContaining({ state: 'missing' }) });
      expect((listedMissing as any).readiness).toEqual(expectedMissingReadiness);
      expect(listedStale).toMatchObject({ readinessSource: 'markdown', readinessFreshness: expect.objectContaining({ state: 'stale' }) });
      expect((listedStale as any).readiness).toEqual(expectedStaleReadiness);
    });
  });

  it('does not preserve a fresh readiness cache when content changes without recomputed readiness', async () => {
    await withTempProjectionProject(async (cwd) => {
      const dir = join(cwd, '.eforge/session-plans');
      mkdirSync(dir, { recursive: true });
      const path = join(dir, 'changed-no-readiness.md');
      const original = readinessPlanContent('changed-no-readiness', readyBody('Changed Ready'));
      const changed = readinessPlanContent('changed-no-readiness', '# Changed Ready\n\n## Scope\n\nOnly one section.\n');
      writeFileSync(path, original);
      syncSessionPlanArtifact(cwd, { session: 'changed-no-readiness', path, content: original, readinessSummary: { ready: true, missingDimensions: [], coveredDimensions: ['problem-statement'], skippedDimensions: [] } });
      writeFileSync(path, changed);
      syncSessionPlanArtifact(cwd, { session: 'changed-no-readiness', path, content: changed });

      const output = await showSessionPlanProjection(cwd, 'changed-no-readiness');

      expect(output).toMatchObject({ readiness: expect.objectContaining({ ready: false }), readinessSource: 'markdown', readinessFreshness: expect.objectContaining({ state: 'missing' }) });
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
