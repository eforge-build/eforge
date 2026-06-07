import { describe, expect, it } from 'vitest';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  SESSION_PLANNING_WORKFLOW_ADAPTER_DESCRIPTOR,
  createSessionPlanningWorkflowAdapter,
  isSessionPlanReadinessError,
  serializeSessionPlan,
} from '@eforge-build/input';
import { useTempDir } from './test-tmpdir.js';

function legacyPlanRaw(session: string): string {
  return `---
session: ${session}
topic: "Legacy Plan"
status: planning
planning_type: unknown
planning_depth: focused
dimensions:
  scope: true
required_dimensions: []
optional_dimensions: []
skipped_dimensions: []
open_questions: []
profile: null
---

# Legacy Plan

## Scope

Existing scope.
`;
}

function planSetManifest(status: string): string {
  return `id: ${status}-set
title: ${status} Set
status: ${status}
strategy: dag
children: []
`;
}

async function writePlanSet(cwd: string, dirName: string, status: string): Promise<void> {
  const dir = resolve(cwd, '.eforge', 'session-plans', dirName);
  await mkdir(dir, { recursive: true });
  await writeFile(resolve(dir, 'plan-set.yaml'), planSetManifest(status), 'utf-8');
}

describe('session planning workflow adapter', () => {
  const makeTempDir = useTempDir('session-planning-workflow-');

  it('exposes the bundled descriptor and read-only plan-set surface', () => {
    expect(SESSION_PLANNING_WORKFLOW_ADAPTER_DESCRIPTOR).toEqual({
      id: 'builtin:session-planning',
      kind: 'workflow-input-adapter',
      sourceScope: 'project-local',
    });
    expect(Object.keys(createSessionPlanningWorkflowAdapter().planSets).sort()).toEqual(['list', 'load', 'validate', 'validateLoaded']);
  });

  it('creates, loads, updates, skips, selects dimensions, migrates legacy, and resolves flat plan paths', async () => {
    const cwd = makeTempDir();
    const adapter = createSessionPlanningWorkflowAdapter();

    const created = await adapter.flat.create({
      cwd,
      session: '2026-01-01-adapter-plan',
      topic: 'Adapter Plan',
      planningType: 'feature',
      planningDepth: 'quick',
    });
    expect(created.path).toBe(resolve(cwd, '.eforge', 'session-plans', '2026-01-01-adapter-plan.md'));
    expect(adapter.flat.resolveStorageRoot(cwd)).toBe(resolve(cwd, '.eforge', 'session-plans'));
    expect(adapter.flat.resolvePath({ cwd, session: created.plan.session })).toBe(created.path);

    const selected = await adapter.flat.selectDimensions({ cwd, session: created.plan.session, planningType: 'feature', planningDepth: 'quick', overwrite: true });
    expect(selected.plan.required_dimensions).toContain('acceptance-criteria');

    const section = await adapter.flat.setSection({ cwd, session: created.plan.session, dimension: 'acceptance-criteria', content: '- The adapter returns persisted session-plan content.' });
    expect(section.readiness.coveredDimensions).toContain('acceptance-criteria');

    const skipped = await adapter.flat.skipDimension({ cwd, session: created.plan.session, dimension: 'assumptions-and-validation', reason: 'No risky assumptions.' });
    expect(skipped.readiness.skippedDimensions).toContain('assumptions-and-validation');

    const loaded = await adapter.flat.load({ cwd, session: created.plan.session });
    expect(loaded.path).toBe(created.path);
    expect(loaded.plan.session).toBe(created.plan.session);

    const listed = await adapter.flat.list({ cwd });
    expect(listed.map((entry) => entry.session)).toContain(created.plan.session);
    expect(listed[0].missingDimensions).toEqual(expect.any(Array));

    const legacyPath = adapter.flat.resolvePath({ cwd, session: 'legacy-plan' });
    await writeFile(legacyPath, legacyPlanRaw('legacy-plan'), 'utf-8');
    const migrated = await adapter.flat.migrateLegacy({ cwd, session: 'legacy-plan' });
    expect(migrated.migrated).toBe(true);
    expect(migrated.plan.required_dimensions).toContain('assumptions-and-validation');
  });

  it('fails clearly instead of overwriting an existing flat plan on create', async () => {
    const cwd = makeTempDir();
    const adapter = createSessionPlanningWorkflowAdapter();
    const created = await adapter.flat.create({ cwd, session: 'duplicate-plan', topic: 'Original Plan' });

    await expect(adapter.flat.create({ cwd, session: 'duplicate-plan', topic: 'Replacement Plan' })).rejects.toMatchObject({ code: 'EEXIST' });

    const content = await readFile(created.path, 'utf-8');
    expect(content).toContain('topic: Original Plan');
    expect(content).not.toContain('Replacement Plan');
  });

  it('normalizes flat session-plan build sources and returns agent profile frontmatter', async () => {
    const cwd = makeTempDir();
    const adapter = createSessionPlanningWorkflowAdapter();
    const created = await adapter.flat.create({ cwd, session: 'profiled-plan', topic: 'Profiled Plan', agentProfile: 'docs-heavy' });
    const withSection = await adapter.flat.setSection({ cwd, session: created.plan.session, dimension: 'scope', content: 'Document the adapter behavior.' });
    await writeFile(created.path, serializeSessionPlan(withSection.plan), 'utf-8');

    const content = await readFile(created.path, 'utf-8');
    const normalized = adapter.flat.normalizeBuildSource({ sourcePath: created.path, content });
    expect(normalized.content).toContain('# Profiled Plan');
    expect(normalized.content).not.toMatch(/^---/);
    expect(normalized.agentProfile).toBe('docs-heavy');
  });

  it('filters flat submitted plans unless requested and exposes readiness details', async () => {
    const cwd = makeTempDir();
    const adapter = createSessionPlanningWorkflowAdapter();
    await adapter.flat.create({ cwd, session: 'active-plan', topic: 'Active Plan' });
    const submitted = await adapter.flat.create({ cwd, session: 'submitted-plan', topic: 'Submitted Plan' });
    await adapter.flat.setStatus({ cwd, session: submitted.plan.session, status: 'submitted', metadata: { eforge_session: 'run-123' } });

    const active = await adapter.flat.list({ cwd });
    expect(active.map((entry) => entry.session)).toEqual(['active-plan']);

    const withSubmitted = await adapter.flat.list({ cwd, includeSubmitted: true });
    expect(withSubmitted.map((entry) => entry.session)).toEqual(['active-plan', 'submitted-plan']);
    expect(withSubmitted.find((entry) => entry.session === 'submitted-plan')?.eforge_session).toBe('run-123');

    const readiness = await adapter.flat.readiness({ cwd, session: 'active-plan' });
    expect(readiness.ready).toBe(false);
    expect(readiness.missingDimensions).toEqual(expect.any(Array));
  });

  it('exposes read-only plan-set list, load, and validate operations with route-list filtering', async () => {
    const cwd = makeTempDir();
    const adapter = createSessionPlanningWorkflowAdapter();
    await writePlanSet(cwd, 'planning-set', 'planning');
    await writePlanSet(cwd, 'submitted-set', 'submitted');
    await writePlanSet(cwd, 'abandoned-set', 'abandoned');

    const active = await adapter.planSets.list({ cwd });
    expect(active.map((entry) => entry.planSetId)).toEqual(['planning-set']);

    const withSubmitted = await adapter.planSets.list({ cwd, includeSubmitted: true });
    expect(withSubmitted.map((entry) => entry.planSetId).sort()).toEqual(['planning-set', 'submitted-set']);

    const loaded = await adapter.planSets.load({ cwd, planSetId: 'planning-set' });
    expect(loaded.manifest.status).toBe('planning');
    const validation = await adapter.planSets.validate({ cwd, planSetId: 'planning-set' });
    expect(validation.ok).toBe(true);
  });

  it('throws a domain readiness error when setting ready with missing required dimensions', async () => {
    const cwd = makeTempDir();
    const adapter = createSessionPlanningWorkflowAdapter();
    const created = await adapter.flat.create({ cwd, session: 'missing-dimension-ready-plan', topic: 'Missing Dimension Ready' });

    await expect(adapter.flat.setStatus({ cwd, session: created.plan.session, status: 'ready' })).rejects.toSatisfy(
      (err: unknown) => isSessionPlanReadinessError(err) && err.readiness.missingDimensions.length > 0,
    );
  });

  it('throws a domain readiness error when setting ready with invalid acceptance criteria', async () => {
    const cwd = makeTempDir();
    const adapter = createSessionPlanningWorkflowAdapter();
    const created = await adapter.flat.create({ cwd, session: 'bad-ready-plan', topic: 'Bad Ready' });
    await adapter.flat.selectDimensions({ cwd, session: created.plan.session, planningType: 'feature', planningDepth: 'quick', overwrite: true });
    await adapter.flat.setSection({ cwd, session: created.plan.session, dimension: 'acceptance-criteria', content: 'Manual checks:\n- Manually verify the UI looks good.' });

    await expect(adapter.flat.setStatus({ cwd, session: created.plan.session, status: 'ready' })).rejects.toSatisfy(
      (err: unknown) => isSessionPlanReadinessError(err) && err.readiness.acDiagnostics !== undefined,
    );
  });

  it('does not import the daemon client package', async () => {
    const source = await readFile('packages/input/src/session-planning-workflow.ts', 'utf-8');
    expect(source).not.toContain('@eforge-build/client');
  });
});
