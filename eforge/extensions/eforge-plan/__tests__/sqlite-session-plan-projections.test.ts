import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { createSessionPlanningWorkflowAdapter } from '@eforge-build/input';
import { captureCanonicalBacklogItem } from '../canonical/backlog-records.js';
import { recordCanonicalLifecycleEvent } from '../canonical/lifecycle-records.js';
import { recordSessionPlanSubmitted, syncSessionPlanArtifact } from '../canonical/session-plan-records.js';
import { getSessionPlanLifecycleProjection, listPlanningArtifactsProjection, showSessionPlanProjection } from '../projections/index.js';
import { withCanonicalTransaction } from '../canonical/store.js';
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
        expect.objectContaining({ kind: 'plan', session: 'plan-extra', lifecycle: expect.objectContaining({ itemIds: ['candidate', 'planned'], state: 'planned' }) }),
      ]));
    });
  });

  it('does not reintroduce terminal canonical plans through stale ready Markdown fallback', async () => {
    await withTempProjectionProject(async (cwd) => {
      const dir = join(cwd, '.eforge/session-plans');
      mkdirSync(dir, { recursive: true });
      const path = join(dir, 'removed-stale-ready.md');
      const content = readinessPlanContent('removed-stale-ready', readyBody('Removed Stale Ready'), 'ready');
      writeFileSync(path, content);
      syncSessionPlanArtifact(cwd, { session: 'removed-stale-ready', path, content, status: 'removed', sourceItemIds: [] });

      const output = await listPlanningArtifactsProjection(cwd, { limit: 100, includeSubmitted: true });

      expect((output.plans as Array<{ session?: string }>).map((plan) => plan.session)).not.toContain('removed-stale-ready');
      expect((output.artifacts as Array<{ key?: string }>).map((artifact) => artifact.key)).not.toContain('plan:removed-stale-ready');
    });
  });

  it('shows SQLite source refs and lifecycle while loading the body from the Markdown artifact', async () => {
    await withTempProjectionProject(async (cwd) => {
      seedProjectionBacklog(cwd);
      const path = writeSessionPlan(cwd, 'plan-body', ['candidate', 'running'], { recommendationRef: 'lane:body' });
      writeFileSync(path, '---\nsession: plan-body\nstatus: ready\neforge_plan:\n  ready_at: 2026-01-01T00:02:00.000Z\n---\n# Artifact Body\n\nThis text must come from Markdown.\n');
      syncSessionPlanArtifact(cwd, { session: 'plan-body', path, content: '---\nsession: plan-body\nstatus: ready\neforge_plan:\n  ready_at: 2026-01-01T00:02:00.000Z\n---\n# Artifact Body\n\nThis text must come from Markdown.\n', status: 'ready', sourceItemIds: ['candidate', 'running'], sourceRecommendationRef: 'lane:body', provenance: 'selected-item', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:03:00.000Z', submittedAt: '2026-01-01T00:04:00.000Z' });

      const output = await showSessionPlanProjection(cwd, 'plan-body');

      expect(output).toMatchObject({ session: 'plan-body', path: expect.stringContaining('.eforge/session-plans/plan-body.md'), createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:03:00.000Z', readyAt: '2026-01-01T00:02:00.000Z', submittedAt: '2026-01-01T00:04:00.000Z', plan: expect.objectContaining({ createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:03:00.000Z', readyAt: '2026-01-01T00:02:00.000Z', submittedAt: '2026-01-01T00:04:00.000Z' }) });
      expect(output.body).toContain('This text must come from Markdown.');
      expect(output.sourceRefs).toMatchObject({ sourceItemIds: ['candidate', 'running'], sourceEpicIds: [], recommendationRef: 'lane:body' });
      expect(output.sourceRefRows).toEqual(expect.arrayContaining([
        expect.objectContaining({ itemRef: 'candidate', provenance: 'selected-item', sourceRecommendationRef: 'lane:body' }),
        expect.objectContaining({ itemRef: 'running', provenance: 'selected-item', sourceRecommendationRef: 'lane:body' }),
      ]));
      expect(output.lifecycle).toMatchObject({ session: 'plan-body', itemIds: ['candidate', 'running'], state: 'partial' });
      expect(output.lifecycle.associatedLinks).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'build-run', runId: 'run-1' })]));
      expect(output).not.toHaveProperty('lastBuildActivityAt');
    });
  });

  it('projects lifecycle timestamps on list artifacts and omits missing timestamp fields', async () => {
    await withTempProjectionProject(async (cwd) => {
      const dir = join(cwd, '.eforge/session-plans');
      mkdirSync(dir, { recursive: true });
      const timestampedPath = join(dir, 'timestamped.md');
      const timestampedContent = '---\nsession: timestamped\nstatus: submitted\neforge_plan:\n  ready_at: 2026-01-01T00:01:00.000Z\n---\n# Timestamped\n';
      writeFileSync(timestampedPath, timestampedContent);
      syncSessionPlanArtifact(cwd, { session: 'timestamped', path: timestampedPath, content: timestampedContent, status: 'submitted', sourceItemIds: [], createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:02:00.000Z', submittedAt: '2026-01-01T00:03:00.000Z' });
      const missingPath = join(dir, 'missing-timestamps.md');
      const missingContent = '---\nsession: missing-timestamps\nstatus: planning\nready_at: not-a-date\n---\n# Missing\n';
      writeFileSync(missingPath, missingContent);
      syncSessionPlanArtifact(cwd, { session: 'missing-timestamps', path: missingPath, content: missingContent, status: 'planning', sourceItemIds: [] });
      const submittedNoReadyPath = join(dir, 'submitted-no-ready.md');
      const submittedNoReadyContent = '---\nsession: submitted-no-ready\nstatus: submitted\n---\n# Submitted No Ready\n';
      writeFileSync(submittedNoReadyPath, submittedNoReadyContent);
      syncSessionPlanArtifact(cwd, { session: 'submitted-no-ready', path: submittedNoReadyPath, content: submittedNoReadyContent, status: 'submitted', sourceItemIds: [], updatedAt: '2026-01-01T00:05:00.000Z', submittedAt: '2026-01-01T00:06:00.000Z' });

      const output = await listPlanningArtifactsProjection(cwd, { limit: 100, includeSubmitted: true });
      const timestamped = (output.plans as Array<Record<string, unknown>>).find((plan) => plan.session === 'timestamped');
      const missing = (output.plans as Array<Record<string, unknown>>).find((plan) => plan.session === 'missing-timestamps');
      const submittedNoReady = (output.plans as Array<Record<string, unknown>>).find((plan) => plan.session === 'submitted-no-ready');

      expect(timestamped).toMatchObject({ createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:02:00.000Z', readyAt: '2026-01-01T00:01:00.000Z', submittedAt: '2026-01-01T00:03:00.000Z' });
      expect(submittedNoReady).toMatchObject({ updatedAt: '2026-01-01T00:05:00.000Z', submittedAt: '2026-01-01T00:06:00.000Z' });
      expect(submittedNoReady).not.toHaveProperty('readyAt');
      expect(missing).toBeDefined();
      const missingJson = JSON.stringify(missing);
      expect(missingJson).not.toContain('null');
      expect(missingJson).not.toContain('undefined');
      expect(missingJson).not.toContain('Invalid Date');
      expect(missing).not.toHaveProperty('readyAt');
      expect(missing).not.toHaveProperty('submittedAt');
    });
  });

  it('derives last build activity from session-scoped queue rows for itemless plans', async () => {
    await withTempProjectionProject(async (cwd) => {
      const dir = join(cwd, '.eforge/session-plans');
      mkdirSync(dir, { recursive: true });
      const path = join(dir, 'itemless-activity.md');
      const content = '---\nsession: itemless-activity\nstatus: ready\n---\n# Itemless Activity\n';
      writeFileSync(path, content);
      syncSessionPlanArtifact(cwd, { session: 'itemless-activity', path, content, status: 'ready', sourceItemIds: [] });
      withCanonicalTransaction(cwd, (store) => recordSessionPlanSubmitted(store, { session: 'itemless-activity', queuePrdId: 'itemless-prd', path: '.eforge/session-plans/itemless-activity.md', timestamp: '2027-01-01T00:07:00.000Z' }));

      const output = await showSessionPlanProjection(cwd, 'itemless-activity');
      const listed = await listPlanningArtifactsProjection(cwd, { includeSubmitted: true });
      const listedPlan = (listed.plans as Array<Record<string, unknown>>).find((plan) => plan.session === 'itemless-activity');

      expect(output).toMatchObject({ session: 'itemless-activity', lastBuildActivityAt: '2027-01-01T00:07:00.000Z' });
      expect(listedPlan).toMatchObject({ session: 'itemless-activity', lastBuildActivityAt: '2027-01-01T00:07:00.000Z' });
    });
  });

  it('does not derive last build activity from another session plan sharing the same item', async () => {
    await withTempProjectionProject(async (cwd) => {
      seedProjectionBacklog(cwd);
      writeSessionPlan(cwd, 'shared-a', ['candidate']);
      writeSessionPlan(cwd, 'shared-b', ['candidate']);
      recordCanonicalLifecycleEvent(cwd, { eventKey: 'shared-b-run', type: 'session:start', session: 'shared-b', sessionId: 'build-shared-b', runId: 'run-shared-b', timestamp: '2027-01-01T00:08:00.000Z' }, ['candidate']);

      const first = await showSessionPlanProjection(cwd, 'shared-a');
      const second = await showSessionPlanProjection(cwd, 'shared-b');

      expect(first).not.toHaveProperty('lastBuildActivityAt');
      expect(second).toMatchObject({ lastBuildActivityAt: '2027-01-01T00:08:00.000Z' });
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

  it('returns lifecycle for partial multi-item session plans with per-item links and reason metadata', async () => {
    await withTempProjectionProject(async (cwd) => {
      seedProjectionBacklog(cwd);
      writeSessionPlan(cwd, 'plan-partial', ['candidate', 'running']);

      const lifecycle = await getSessionPlanLifecycleProjection(cwd, 'plan-partial');

      expect(lifecycle).toMatchObject({ session: 'plan-partial', itemIds: ['candidate', 'running'], state: 'partial', partialReasons: [expect.objectContaining({ code: 'mixed-source-states' })] });
      expect(lifecycle.associatedLinks).toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: 'session-plan', session: 'plan-partial' }),
        expect.objectContaining({ kind: 'build-session', buildSessionId: 'build-session-1' }),
      ]));
    });
  });

  it('projects missing source lifecycle evidence as partial with reason metadata', async () => {
    await withTempProjectionProject(async (cwd) => {
      seedProjectionBacklog(cwd);
      writeSessionPlan(cwd, 'plan-missing-lifecycle', ['unresolved-source']);
      const db = new DatabaseSync(join(cwd, '.eforge/storage/extensions/eforge-plan/eforge-plan-private.sqlite'));
      try {
        db.prepare('DELETE FROM lifecycle_evidence WHERE session = ?').run('plan-missing-lifecycle');
      } finally {
        db.close();
      }

      const lifecycle = await getSessionPlanLifecycleProjection(cwd, 'plan-missing-lifecycle');
      const listed = await listPlanningArtifactsProjection(cwd, { includeSubmitted: true, limit: 100 });
      const artifact = listed.artifacts.find((entry: { session?: string }) => entry.session === 'plan-missing-lifecycle');

      expect(lifecycle).toMatchObject({ session: 'plan-missing-lifecycle', state: 'partial', partialReasons: expect.arrayContaining([expect.objectContaining({ code: 'incomplete-coverage' }), expect.objectContaining({ code: 'missing-lifecycle-evidence' })]) });
      expect(artifact).toMatchObject({ session: 'plan-missing-lifecycle', lifecycleState: 'partial', partialReasons: expect.arrayContaining([expect.objectContaining({ code: 'incomplete-coverage' }), expect.objectContaining({ code: 'missing-lifecycle-evidence' })]) });
    });
  });

  it('keeps unresolved source refs partial even when planned lifecycle evidence exists', async () => {
    await withTempProjectionProject(async (cwd) => {
      seedProjectionBacklog(cwd);
      writeSessionPlan(cwd, 'plan-unresolved-with-evidence', ['unresolved-source']);

      const lifecycle = await getSessionPlanLifecycleProjection(cwd, 'plan-unresolved-with-evidence');

      expect(lifecycle).toMatchObject({ session: 'plan-unresolved-with-evidence', state: 'partial', partialReasons: expect.arrayContaining([expect.objectContaining({ code: 'incomplete-coverage' })]) });
      expect(lifecycle.itemRows).toEqual(expect.arrayContaining([expect.objectContaining({ itemId: 'unresolved-source', unresolvedSourceRef: true, lifecycleState: 'planned' })]));
    });
  });

  it('projects homogeneous multi-item lifecycle as the shared state', async () => {
    await withTempProjectionProject(async (cwd) => {
      seedProjectionBacklog(cwd);
      captureCanonicalBacklogItem(cwd, { id: 'shipped-copy', title: 'Shipped Copy', status: 'candidate', epicId: 'epic-a' });
      writeSessionPlan(cwd, 'plan-shipped-together', ['shipped', 'shipped-copy']);
      recordCanonicalLifecycleEvent(cwd, { eventKey: 'shipped-copy-1', type: 'landing:complete', action: 'merge', commitSha: 'def456', timestamp: '2027-01-01T00:07:00.000Z' }, ['shipped-copy']);

      const lifecycle = await getSessionPlanLifecycleProjection(cwd, 'plan-shipped-together');

      expect(lifecycle).toMatchObject({ session: 'plan-shipped-together', itemIds: ['shipped', 'shipped-copy'], state: 'shipped', partialReasons: [] });
    });
  });
});
