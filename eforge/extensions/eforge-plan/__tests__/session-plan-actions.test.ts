import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { dispatchExtensionAction } from '@eforge-build/engine/extensions/action-runtime.js';
import { createExtensionRecorder } from '@eforge-build/engine/extensions/recorder.js';
import type { NativeExtensionRecorderState, NativeExtensionRegistry, ExtensionProfilesApiShape } from '@eforge-build/engine/extensions/types.js';
import type { ProfileListResponse } from '@eforge-build/client';
import eforgePlanExtension from '../index.js';
import { writeBacklogEpic, writeBacklogItem } from '../markdown-store.js';
import { synchronizeRemovedQueuePrdCoverage } from '../canonical/queue-removal-cleanup.js';
import { getSessionPlan, openEforgePlanStore, recordLifecycleEvidence, upsertBuildRun, upsertBuildSession, upsertQueuePrd } from '../sqlite/index.js';
import { getDatabase } from '../sqlite/store-internal.js';
import { createTraceSidecar, writeTraceSidecar } from '../trace-store.js';

async function withTempProject<T>(fn: (cwd: string) => Promise<T>): Promise<T> {
  const cwd = await mkdtemp(join(tmpdir(), 'eforge-plan-session-actions-'));
  try { return await fn(cwd); } finally { await rm(cwd, { recursive: true, force: true }); }
}

function registry(): NativeExtensionRegistry {
  const { api, state } = createExtensionRecorder('eforge-plan', '/project/eforge/extensions/eforge-plan/index.ts');
  eforgePlanExtension(api as never);
  expect(state.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')).toEqual([]);
  return { ...(state as NativeExtensionRecorderState), extensions: [], candidates: [] };
}

async function dispatch(cwd: string, actionId: string, input: Record<string, unknown>, options: { enqueue?: (request: { source: string; suppressSessionPlanSubmissionMark?: boolean }) => Promise<{ sessionId: string; pid: number; autoBuild: boolean }>; profiles?: ExtensionProfilesApiShape } = {}) {
  const result = await dispatchExtensionAction(registry(), {
    actionId: `eforge-plan:${actionId}`,
    input,
    requestedBy: { host: 'pi' },
    cwd,
    timeoutMs: 1000,
    ...(options.enqueue && { buildQueue: () => ({ enqueue: (request) => options.enqueue!({ source: request.source, suppressSessionPlanSubmissionMark: request.suppressSessionPlanSubmissionMark }) }) }),
    ...(options.profiles && { profiles: () => options.profiles! }),
  });
  expect(result).toMatchObject({ kind: 'success' });
  if (result.kind !== 'success') throw new Error(result.message);
  return result.output as Record<string, unknown>;
}

function storedReadiness(cwd: string, session: string): unknown {
  const store = openEforgePlanStore(cwd);
  try { return getSessionPlan(store, session)?.readinessSummary; } finally { store.close(); }
}

function storedStatus(cwd: string, session: string): string | undefined {
  const store = openEforgePlanStore(cwd);
  try { return getSessionPlan(store, session)?.status; } finally { store.close(); }
}

function storedSessionPlanCount(cwd: string, session: string): number {
  const store = openEforgePlanStore(cwd);
  try { return (getDatabase(store).prepare('SELECT count(*) AS count FROM session_plans WHERE session = ?').get(session) as { count: number }).count; } finally { store.close(); }
}

function storedQueueRows(cwd: string, session: string): Array<{ prd_id: string; status: string | null }> {
  const store = openEforgePlanStore(cwd);
  try { return getDatabase(store).prepare('SELECT prd_id, status FROM queue_prds WHERE session = ? ORDER BY prd_id').all(session) as Array<{ prd_id: string; status: string | null }>; } finally { store.close(); }
}

function storedSubmittedEvidenceRows(cwd: string, session: string): Array<{ queue_prd_id: string | null; is_current: number; is_terminal: number; superseded_at: string | null }> {
  const store = openEforgePlanStore(cwd);
  try { return getDatabase(store).prepare("SELECT queue_prd_id, is_current, is_terminal, superseded_at FROM lifecycle_evidence WHERE session = ? AND reason_code = 'submitted-session-plan' ORDER BY queue_prd_id").all(session) as Array<{ queue_prd_id: string | null; is_current: number; is_terminal: number; superseded_at: string | null }>; } finally { store.close(); }
}

function storedCurrentEvidenceRows(cwd: string, session: string): Array<{ queue_prd_id: string | null; lifecycle_state: string; is_current: number; is_terminal: number; superseded_at: string | null }> {
  const store = openEforgePlanStore(cwd);
  try { return getDatabase(store).prepare("SELECT queue_prd_id, lifecycle_state, is_current, is_terminal, superseded_at FROM lifecycle_evidence WHERE session = ? ORDER BY evidence_key").all(session) as Array<{ queue_prd_id: string | null; lifecycle_state: string; is_current: number; is_terminal: number; superseded_at: string | null }>; } finally { store.close(); }
}

function expectStoredReadiness(cwd: string, session: string, readiness: unknown): void {
  expect(storedReadiness(cwd, session)).toEqual(JSON.parse(JSON.stringify(readiness)));
}

function collectUndefinedPaths(value: unknown, path = '$'): string[] {
  if (value === undefined) return [path];
  if (value === null || typeof value !== 'object') return [];
  if (Array.isArray(value)) return value.flatMap((entry, index) => collectUndefinedPaths(entry, `${path}[${index}]`));
  return Object.entries(value).flatMap(([key, entry]) => collectUndefinedPaths(entry, `${path}.${key}`));
}

async function writeSessionPlanRaw(cwd: string, session: string, body: string, status = 'planning') {
  const dir = join(cwd, '.eforge', 'session-plans');
  await mkdir(dir, { recursive: true });
  const raw = `---\nsession: ${session}\ntopic: ${session}\nstatus: ${status}\nplanning_type: feature\nplanning_depth: quick\nrequired_dimensions:\n  - problem-statement\n  - scope\n  - acceptance-criteria\n  - assumptions-and-validation\noptional_dimensions: []\nskipped_dimensions: []\nopen_questions: []\nprofile: null\n---\n${body}`;
  await writeFile(join(dir, `${session}.md`), raw, 'utf-8');
}

function readyBody(title = 'Ready Plan') {
  return [
    `# ${title}`,
    '',
    '## Problem Statement',
    '',
    'The specific user-visible failure is documented with source evidence.',
    '',
    '## Scope',
    '',
    'Update eforge/extensions/eforge-plan/session-plan-actions.ts only.',
    '',
    '## Acceptance Criteria',
    '',
    '- `pnpm type-check` exits 0.',
    '- eforge/extensions/eforge-plan/session-plan-actions.ts contains the handoff action.',
    '',
    '## Assumptions And Validation',
    '',
    'Validation uses the existing TypeScript type-check command.',
    '',
  ].join('\n');
}

describe('eforge-plan session-plan extension actions', () => {
  it('lists agent runtime profile options through the kernel profile context service', async () => {
    await withTempProject(async (cwd) => {
      const calls: unknown[] = [];
      const response: ProfileListResponse = {
        active: 'team',
        source: 'project',
        profiles: [
          { name: 'team', harness: 'pi', path: '/repo/eforge/profiles/team.yaml', scope: 'project', metadata: { description: 'Team runtime profile', tags: ['team'] } },
          { name: 'base', harness: 'claude-sdk', path: '/home/user/.config/eforge/profiles/base.yaml', scope: 'user', shadowedBy: 'project', metadata: { description: 'Base profile', whenToUse: ['fallback'] } },
        ],
      };
      const output = await dispatch(cwd, 'list-agent-runtime-profiles', { scope: 'all' }, {
        profiles: { async list(request) { calls.push(request); return response; } },
      });

      expect(calls).toEqual([{ scope: 'all' }]);
      expect(output).toEqual(response);
      expect(output.profiles).toEqual(expect.arrayContaining([
        expect.objectContaining({ name: 'team', scope: 'project', harness: 'pi', metadata: expect.objectContaining({ description: 'Team runtime profile' }) }),
        expect.objectContaining({ name: 'base', scope: 'user', harness: 'claude-sdk', shadowedBy: 'project' }),
      ]));
    });
  });

  it.each([
    ['omitted', {}, undefined],
    ['local', { scope: 'local' }, { scope: 'local' }],
    ['project', { scope: 'project' }, { scope: 'project' }],
    ['user', { scope: 'user' }, { scope: 'user' }],
    ['all', { scope: 'all' }, { scope: 'all' }],
  ])('forwards %s profile-list scope to the kernel profile context service', async (_label, input, expectedRequest) => {
    await withTempProject(async (cwd) => {
      const calls: unknown[] = [];
      const response: ProfileListResponse = { active: null, source: 'none', profiles: [] };
      await dispatch(cwd, 'list-agent-runtime-profiles', input, {
        profiles: { async list(request) { calls.push(request); return response; } },
      });

      expect(calls).toEqual([expectedRequest]);
    });
  });

  it('lists flat plans and plan sets as JSON-safe planning artifact keys', async () => {
    await withTempProject(async (cwd) => {
      await writeBacklogItem(cwd, { id: 'backlog-one', status: 'planned', body: '# Backlog One\n\n## Claim\n\nPlan it.\n' });
      await writeSessionPlanRaw(cwd, 'flat-one', readyBody());
      await writePlanSet(cwd, 'set-one');

      const output = await dispatch(cwd, 'list-planning-artifacts', { includeArchive: false });

      expect(collectUndefinedPaths(output)).toEqual([]);
      expect((output.artifacts as Array<{ key: string }>).map((artifact) => artifact.key).sort()).toEqual(['plan-set:set-one', 'plan:flat-one']);
      expect(output).toMatchObject({ total: 2, limit: 50, offset: 0 });
      expect('board' in output).toBe(false);
      expect(JSON.stringify(output)).not.toContain('Plan it.');
    });
  });

  it('paginates planning artifacts and derives plans and plan sets from the same returned page', async () => {
    await withTempProject(async (cwd) => {
      await writeSessionPlanRaw(cwd, 'flat-one', readyBody('Flat One'));
      await writeSessionPlanRaw(cwd, 'flat-two', readyBody('Flat Two'));
      await writePlanSet(cwd, 'set-one');

      const output = await dispatch(cwd, 'list-planning-artifacts', { limit: 1, offset: 2 });

      expect(collectUndefinedPaths(output)).toEqual([]);
      expect(output).toMatchObject({ total: 3, limit: 1, offset: 2 });
      expect(output.artifacts).toHaveLength(1);
      expect((output.plans as unknown[]).length + (output.planSets as unknown[]).length).toBe(1);
      expect(new Set([...(output.plans as Array<{ key: string }>), ...(output.planSets as Array<{ key: string }>)].map((artifact) => artifact.key))).toEqual(new Set((output.artifacts as Array<{ key: string }>).map((artifact) => artifact.key)));
      expect(JSON.stringify(output)).not.toContain('Flat One');
      expect(JSON.stringify(output)).not.toContain('Flat Two');
    });
  });

  it('returns the legacy rich board only when explicitly requested', async () => {
    await withTempProject(async (cwd) => {
      await writeBacklogEpic(cwd, { id: 'epic-one', status: 'active', body: '# Epic One\n' });
      await writeBacklogEpic(cwd, { id: 'epic-two', status: 'active', body: '# Epic Two\n' });
      await writeBacklogItem(cwd, { id: 'backlog-one', status: 'planned', epic: 'epic-one', body: '# Backlog One\n\n## Claim\n\nPlan it.\n' });
      await writeBacklogItem(cwd, { id: 'backlog-two', status: 'planned', epic: 'epic-two', body: '# Backlog Two\n' });
      await writeBacklogItem(cwd, { id: 'archived-one', status: 'stale', epic: 'epic-one', body: '# Archived One\n' });
      await writeSessionPlanRaw(cwd, 'flat-one', readyBody());

      const output = await dispatch(cwd, 'list-planning-artifacts', { includeArchive: false, includeBoard: true, epic: 'epic-one' });

      expect(collectUndefinedPaths(output)).toEqual([]);
      expect(output.board).toEqual(expect.any(Object));
      const board = output.board as { lanes: Array<{ lane: string; items: Array<{ id: string }> }> };
      expect(board.lanes.map((lane) => lane.lane)).not.toContain('archive');
      expect(board.lanes.flatMap((lane) => lane.items.map((item) => item.id))).toEqual(['backlog-one']);
    });
  });

  it('shows flat session plans with body, frontmatter, readiness, sections, and absolute path', async () => {
    await withTempProject(async (cwd) => {
      await writeSessionPlanRaw(cwd, 'flat-detail', readyBody('Flat Detail'));

      const output = await dispatch(cwd, 'show-session-plan', { session: 'flat-detail' });

      expect(collectUndefinedPaths(output)).toEqual([]);
      expect(output.path).toBe(resolve(cwd, '.eforge', 'session-plans', 'flat-detail.md'));
      expect(output.readiness).toMatchObject({ ready: true });
      expect(output.plan).toMatchObject({ session: 'flat-detail', topic: 'flat-detail', status: 'planning', body: expect.stringContaining('Flat Detail'), sections: expect.any(Object) });
    });
  });

  it('shows linked source refs and partial lifecycle evidence for session plans', async () => {
    await withTempProject(async (cwd) => {
      await writeBacklogEpic(cwd, { id: 'epic-one', status: 'active', body: '# Epic One\n' });
      await writeBacklogItem(cwd, { id: 'item-one', status: 'shipped', epic: 'epic-one', body: '# Item One\n' });
      await writeBacklogItem(cwd, { id: 'item-two', status: 'planned', epic: 'epic-one', body: '# Item Two\n' });
      const trace = createTraceSidecar('item-one', 'epic-one');
      trace.promotedSessionPlans.push({ session: 'linked-plan', path: '.eforge/session-plans/linked-plan.md', status: 'submitted', promotedAt: '2026-01-01T00:00:00.000Z' });
      trace.landingResults.push({ featureBranch: 'feature/one', commitSha: 'abc123', status: 'landed', landedAt: '2026-01-01T00:01:00.000Z' });
      await writeTraceSidecar(cwd, trace);
      await mkdir(join(cwd, '.eforge', 'session-plans'), { recursive: true });
      await writeFile(join(cwd, '.eforge', 'session-plans', 'linked-plan.md'), `---\nsession: linked-plan\ntopic: linked-plan\nstatus: planning\nplanning_type: feature\nplanning_depth: quick\nrequired_dimensions:\n  - problem-statement\n  - scope\n  - acceptance-criteria\n  - assumptions-and-validation\noptional_dimensions: []\nskipped_dimensions: []\nopen_questions: []\nprofile: null\neforge_plan:\n  source_item_ids:\n    - item-one\n    - item-two\n  source_epic_ids:\n    - epic-one\n  source_recommendation_ref: group-one\n  promoted_at: 2026-01-01T00:00:00.000Z\n---\n${readyBody('Linked Plan')}`, 'utf-8');

      const output = await dispatch(cwd, 'show-session-plan', { session: 'linked-plan' });

      expect(collectUndefinedPaths(output)).toEqual([]);
      expect(output.sourceRefs).toEqual({
        sourceItemIds: ['item-one', 'item-two'],
        sourceEpicIds: ['epic-one'],
        recommendationRef: 'group-one',
        promotedAt: '2026-01-01T00:00:00.000Z',
      });
      const lifecycle = output.lifecycle as Record<string, unknown>;
      expect(lifecycle.lifecycleState).toBe('partial');
      expect((lifecycle.itemRows as Array<Record<string, unknown>>).map((row) => [row.itemId, row.lifecycleState])).toEqual([
        ['item-one', 'shipped'],
        ['item-two', 'none'],
      ]);
      expect(lifecycle.linkRows).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'session-plan', session: 'linked-plan', affectedItemIds: ['item-one'] })]));
    });
  });

  it('shows plan-set projections with summary, validation, anchor content, and child metadata', async () => {
    await withTempProject(async (cwd) => {
      await writePlanSet(cwd, 'set-detail');

      const output = await dispatch(cwd, 'show-session-plan-set', { planSetId: 'set-detail' });

      expect(collectUndefinedPaths(output)).toEqual([]);
      expect(output).toMatchObject({ dir: resolve(cwd, '.eforge', 'session-plans', 'set-detail'), manifestPath: resolve(cwd, '.eforge', 'session-plans', 'set-detail', 'plan-set.yaml'), anchorContent: expect.stringContaining('Umbrella') });
      expect(output.planSet).toMatchObject({ id: 'set-detail', title: 'Set Detail', children: [expect.objectContaining({ id: 'child-one', status: 'planning', buildable: true })] });
      expect(output.validation).toMatchObject({ ok: true });
    });
  });

  it('creates session plans using the existing flat session-plan format', async () => {
    await withTempProject(async (cwd) => {
      const output = await dispatch(cwd, 'create-session-plan', { session: 'new-plan', topic: 'New Plan', planningType: 'feature', planningDepth: 'focused', agentProfile: 'builder' });
      const raw = await readFile(join(cwd, '.eforge', 'session-plans', 'new-plan.md'), 'utf-8');

      expect(output).toMatchObject({ session: 'new-plan', path: resolve(cwd, '.eforge', 'session-plans', 'new-plan.md') });
      expect(raw).toContain('session: new-plan');
      expect(raw).toContain('agent_profile: builder');
      expect(raw).toContain('# New Plan');
      expectStoredReadiness(cwd, 'new-plan', output.readiness);
    });
  });

  it('replaces duplicate dimension headings with exactly one canonical section', async () => {
    await withTempProject(async (cwd) => {
      await writeSessionPlanRaw(cwd, 'dupe-plan', `${readyBody()}\n## Scope\n\nDuplicate scope.\n`);

      await dispatch(cwd, 'set-session-plan-section', { session: 'dupe-plan', dimension: 'scope', content: 'Only this scope remains.' });
      const raw = await readFile(join(cwd, '.eforge', 'session-plans', 'dupe-plan.md'), 'utf-8');

      const output = await dispatch(cwd, 'show-session-plan', { session: 'dupe-plan' });

      expect(raw.match(/^## Scope$/gm)).toHaveLength(1);
      expect(raw).toContain('Only this scope remains.');
      expect(raw).not.toContain('Duplicate scope.');
      expectStoredReadiness(cwd, 'dupe-plan', output.readiness);
    });
  });

  it('persists readiness after dimension selection and metadata updates', async () => {
    await withTempProject(async (cwd) => {
      const dir = join(cwd, '.eforge', 'session-plans');
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, 'metadata-plan.md'), `---
session: metadata-plan
topic: metadata-plan
status: planning
planning_type: feature
planning_depth: quick
required_dimensions:
  - problem-statement
  - scope
  - acceptance-criteria
  - assumptions-and-validation
optional_dimensions: []
skipped_dimensions: []
open_questions: []
profile: errand
custom_flag: keep-me
eforge_plan:
  source_item_ids: [item-one]
  source_recommendation_ref: lane:42
  planning_dimension_metadata:
    scope:
      owner: team-a
---
${readyBody()}`, 'utf-8');

      const selected = await dispatch(cwd, 'select-session-plan-dimensions', { session: 'metadata-plan', planningType: 'feature', planningDepth: 'focused', overwrite: true });
      expectStoredReadiness(cwd, 'metadata-plan', selected.readiness);

      const updated = await dispatch(cwd, 'update-session-plan-metadata', { session: 'metadata-plan', agentProfile: 'planner', openQuestions: ['Confirm rollout.'] });
      const rawAfterSet = await readFile(join(cwd, '.eforge', 'session-plans', 'metadata-plan.md'), 'utf-8');
      expect(updated.plan).toMatchObject({ agent_profile: 'planner', open_questions: ['Confirm rollout.'] });
      expect(rawAfterSet).toContain('agent_profile: planner');
      expect(rawAfterSet).toContain('custom_flag: keep-me');
      expect(rawAfterSet).toContain('source_item_ids:');
      expect(rawAfterSet).toContain('source_recommendation_ref: lane:42');
      expect(rawAfterSet).toContain('planning_dimension_metadata:');
      expectStoredReadiness(cwd, 'metadata-plan', updated.readiness);

      const cleared = await dispatch(cwd, 'update-session-plan-metadata', { session: 'metadata-plan', agentProfile: null });
      const raw = await readFile(join(cwd, '.eforge', 'session-plans', 'metadata-plan.md'), 'utf-8');
      expect(cleared.plan).toMatchObject({ open_questions: ['Confirm rollout.'] });
      expect((cleared.plan as { agent_profile?: unknown }).agent_profile).toBeUndefined();
      expect(raw).not.toContain('agent_profile:');
      expect(raw).toContain('custom_flag: keep-me');
      expect(raw).toContain('source_item_ids:');
      expect(raw).toContain('source_recommendation_ref: lane:42');
      expect(raw).toContain('planning_dimension_metadata:');
      expect(raw).toContain('owner: team-a');
      expectStoredReadiness(cwd, 'metadata-plan', cleared.readiness);
    });
  });

  it('persists skipped dimension readiness through SQL-backed plan projections', async () => {
    await withTempProject(async (cwd) => {
      await writeSessionPlanRaw(cwd, 'skip-plan', readyBody().replace('## Assumptions And Validation\n\nValidation uses the existing TypeScript type-check command.\n', ''));

      const skipped = await dispatch(cwd, 'skip-dimension', { session: 'skip-plan', dimension: 'assumptions-and-validation', reason: 'No external assumptions need validation.' });
      const show = await dispatch(cwd, 'show-session-plan', { session: 'skip-plan' });
      const listed = await dispatch(cwd, 'list-planning-artifacts', { includeSubmitted: true });
      const listedPlan = (listed.plans as Array<{ session: string; readiness: unknown }>).find((plan) => plan.session === 'skip-plan');

      expect(skipped.readiness).toMatchObject({ ready: true, skippedDimensions: ['assumptions-and-validation'] });
      expectStoredReadiness(cwd, 'skip-plan', skipped.readiness);
      expect(show.readiness).toEqual(skipped.readiness);
      expect(listedPlan).toMatchObject({ readiness: skipped.readiness });
      expect(collectUndefinedPaths(skipped)).toEqual([]);
    });
  });

  it('returns acceptance-criteria diagnostics for grouping labels, bare commands, vague criteria, and manual-only criteria', async () => {
    await withTempProject(async (cwd) => {
      await writeSessionPlanRaw(cwd, 'bad-ac', readyBody().replace('- `pnpm type-check` exits 0.\n- eforge/extensions/eforge-plan/session-plan-actions.ts contains the handoff action.', '- Tests cover:\n- `pnpm type-check`.\n- Works correctly.\n- Manually verify in browser.'));

      const output = await dispatch(cwd, 'check-session-plan-readiness', { session: 'bad-ac' });
      const diagnostics = ((output.readiness as Record<string, unknown>).acDiagnostics as Array<{ kind: string }>).map((diagnostic) => diagnostic.kind).sort();

      expect(diagnostics).toEqual(['bare-command', 'grouping-label', 'manual-only', 'vague']);
    });
  });

  it('deletes flat plans from active lists by marking them abandoned', async () => {
    await withTempProject(async (cwd) => {
      await writeSessionPlanRaw(cwd, 'delete-me', readyBody());

      const deleted = await dispatch(cwd, 'delete-session-plan', { session: 'delete-me' });
      const deletedReadiness = await dispatch(cwd, 'check-session-plan-readiness', { session: 'delete-me' });
      const listed = await dispatch(cwd, 'list-planning-artifacts', {});
      const raw = await readFile(join(cwd, '.eforge', 'session-plans', 'delete-me.md'), 'utf-8');

      expect(deleted).toMatchObject({ kind: 'deleted', session: 'delete-me', status: 'abandoned', plan: { status: 'abandoned' } });
      expect(raw).toContain('status: abandoned');
      expectStoredReadiness(cwd, 'delete-me', deletedReadiness.readiness);
      expect((listed.artifacts as Array<{ key: string }>).map((artifact) => artifact.key)).not.toContain('plan:delete-me');
      expect(collectUndefinedPaths(deleted)).toEqual([]);
    });
  });

  it('leaves non-ready plans unchanged when setting ready or handing off', async () => {
    await withTempProject(async (cwd) => {
      await writeSessionPlanRaw(cwd, 'not-ready', '# Not Ready\n\n## Scope\n\nOnly one section.\n');

      const setReady = await dispatch(cwd, 'set-session-plan-ready', { session: 'not-ready' });
      const handoff = await dispatch(cwd, 'handoff-session-plan', { session: 'not-ready' });
      const raw = await readFile(join(cwd, '.eforge', 'session-plans', 'not-ready.md'), 'utf-8');

      expect(setReady).toMatchObject({ kind: 'not-ready', session: 'not-ready' });
      expect(handoff).toMatchObject({ kind: 'not-ready', session: 'not-ready' });
      expect(raw).toContain('status: planning');
    });
  });

  it('sets ready status and enqueues ready fixtures through the build queue', async () => {
    await withTempProject(async (cwd) => {
      await writeSessionPlanRaw(cwd, 'ready-plan', readyBody());
      const enqueuedSources: string[] = [];

      const ready = await dispatch(cwd, 'set-session-plan-ready', { session: 'ready-plan' });
      const handoff = await dispatch(cwd, 'handoff-session-plan', { session: 'ready-plan' }, {
        enqueue: async (request) => {
          if (request.suppressSessionPlanSubmissionMark !== true) throw new Error('test enqueue would auto-submit session-plan Markdown without suppression');
          enqueuedSources.push(request.source);
          return { sessionId: 'build-session-1', pid: 1234, autoBuild: true };
        },
      });
      const raw = await readFile(join(cwd, '.eforge', 'session-plans', 'ready-plan.md'), 'utf-8');
      const listed = await dispatch(cwd, 'list-planning-artifacts', {});

      expect(ready).toMatchObject({ kind: 'ready', status: 'ready', readyAt: expect.any(String) });
      expect(handoff).toMatchObject({ kind: 'enqueued', session: 'ready-plan', sourcePath: '.eforge/session-plans/ready-plan.md', absolutePath: resolve(cwd, '.eforge', 'session-plans', 'ready-plan.md'), queueSessionId: 'build-session-1', pid: 1234, autoBuild: true, submittedAt: expect.any(String) });
      expect(enqueuedSources).toEqual(['.eforge/session-plans/ready-plan.md']);
      expect(collectUndefinedPaths(handoff)).toEqual([]);
      expect(raw).toContain('status: ready');
      expect(raw).not.toContain('status: submitted');
      expect(storedStatus(cwd, 'ready-plan')).toBe('submitted');
      expect((listed.artifacts as Array<{ key: string }>).map((artifact) => artifact.key)).not.toContain('plan:ready-plan');
      expectStoredReadiness(cwd, 'ready-plan', ready.readiness);
      const shown = await dispatch(cwd, 'show-session-plan', { session: 'ready-plan' });
      expect(shown.readyAt).toBe(ready.readyAt);
    });
  });

  it('rejects repeat handoff when canonical status is already submitted', async () => {
    await withTempProject(async (cwd) => {
      await writeSessionPlanRaw(cwd, 'ready-plan', readyBody());
      await dispatch(cwd, 'set-session-plan-ready', { session: 'ready-plan' });
      await dispatch(cwd, 'handoff-session-plan', { session: 'ready-plan' }, { enqueue: async () => ({ sessionId: 'build-session-1', pid: 1234, autoBuild: false }) });
      const enqueuedSources: string[] = [];

      const second = await dispatch(cwd, 'handoff-session-plan', { session: 'ready-plan' }, {
        enqueue: async (request) => {
          enqueuedSources.push(request.source);
          return { sessionId: 'build-session-2', pid: 5678, autoBuild: false };
        },
      });

      expect(second).toMatchObject({ kind: 'not-ready', session: 'ready-plan', message: expect.stringContaining('canonical status is submitted') });
      expect(enqueuedSources).toEqual([]);
      expect(storedStatus(cwd, 'ready-plan')).toBe('submitted');
    });
  });

  it('resubmits an existing submitted plan after terminal failed build evidence without duplicating identity or provenance', async () => {
    await withTempProject(async (cwd) => {
      await writeBacklogItem(cwd, { id: 'item-one', title: 'Item one', status: 'planned' });
      await writeBacklogEpic(cwd, { id: 'epic-one', title: 'Epic one', status: 'planned' });
      await mkdir(join(cwd, '.eforge', 'session-plans'), { recursive: true });
      await writeFile(join(cwd, '.eforge', 'session-plans', 'recover-plan.md'), `---\nsession: recover-plan\ntopic: Recover Plan\nstatus: ready\nplanning_type: feature\nplanning_depth: quick\nrequired_dimensions:\n  - problem-statement\n  - scope\n  - acceptance-criteria\n  - assumptions-and-validation\noptional_dimensions: []\nskipped_dimensions: []\nopen_questions: []\nprofile: null\neforge_plan:\n  source_item_ids:\n    - item-one\n  source_epic_ids:\n    - epic-one\n  source_recommendation_ref: rec-one\n---\n${readyBody('Recover Plan')}`, 'utf-8');
      await dispatch(cwd, 'set-session-plan-ready', { session: 'recover-plan' });
      await dispatch(cwd, 'handoff-session-plan', { session: 'recover-plan' }, { enqueue: async () => ({ sessionId: 'old-queue', pid: 1, autoBuild: false }) });
      const store = openEforgePlanStore(cwd, { create: true, migrate: true });
      try {
        upsertBuildRun(store, { runId: 'old-run', session: 'recover-plan', queuePrdId: 'old-queue', status: 'failed', finishedAt: '2099-01-01T00:00:00.000Z' });
        recordLifecycleEvidence(store, { evidenceKey: 'failed:old-run:item-one', itemRef: 'item-one', session: 'recover-plan', queuePrdId: 'old-queue', runId: 'old-run', lifecycleState: 'failed', reasonCode: 'failed-result', evidenceKind: 'build-run', status: 'failed', isCurrent: true, isTerminal: true, occurredAt: '2099-01-01T00:00:00.000Z' });
      } finally { store.close(); }
      await writeFile(join(cwd, '.eforge', 'session-plans', 'recover-plan.md'), `---\nsession: recover-plan\ntopic: Recover Plan\nstatus: ready\nplanning_type: feature\nplanning_depth: quick\nrequired_dimensions:\n  - problem-statement\n  - scope\n  - acceptance-criteria\n  - assumptions-and-validation\noptional_dimensions: []\nskipped_dimensions: []\nopen_questions: []\nprofile: null\n---\n${readyBody('Recover Plan')}`, 'utf-8');

      const enqueueCalls: Array<{ source: string; suppressSessionPlanSubmissionMark?: boolean }> = [];
      const resubmitted = await dispatch(cwd, 'resubmit-session-plan', { session: 'recover-plan' }, { enqueue: async (request) => { enqueueCalls.push(request); return { sessionId: 'new-queue', pid: 2, autoBuild: true }; } });
      const shown = await dispatch(cwd, 'show-session-plan', { session: 'recover-plan' });
      const list = await dispatch(cwd, 'list-planning-artifacts', { includeSubmitted: true });
      const listedPlan = (list.artifacts as Array<{ key: string; lifecycle?: { lifecycleState?: string } }>).find((artifact) => artifact.key === 'plan:recover-plan');

      expect(resubmitted).toMatchObject({ kind: 'enqueued', session: 'recover-plan', queueSessionId: 'new-queue', sourcePath: '.eforge/session-plans/recover-plan.md' });
      expect(enqueueCalls).toEqual([{ source: '.eforge/session-plans/recover-plan.md', suppressSessionPlanSubmissionMark: true }]);
      expect(storedStatus(cwd, 'recover-plan')).toBe('submitted');
      expect(storedSessionPlanCount(cwd, 'recover-plan')).toBe(1);
      expect(storedQueueRows(cwd, 'recover-plan')).toEqual([
        { prd_id: 'new-queue', status: 'queued' },
        { prd_id: 'old-queue', status: 'queued' },
      ]);
      expect(storedSubmittedEvidenceRows(cwd, 'recover-plan')).toEqual([
        { queue_prd_id: 'new-queue', is_current: 1, is_terminal: 0, superseded_at: null },
        { queue_prd_id: 'old-queue', is_current: 0, is_terminal: 1, superseded_at: expect.any(String) },
      ]);
      expect(storedCurrentEvidenceRows(cwd, 'recover-plan')).toEqual(expect.arrayContaining([
        expect.objectContaining({ queue_prd_id: 'old-queue', lifecycle_state: 'submitted', is_current: 0, is_terminal: 1, superseded_at: expect.any(String) }),
        expect.objectContaining({ queue_prd_id: 'old-queue', lifecycle_state: 'failed', is_current: 0, is_terminal: 1, superseded_at: expect.any(String) }),
        expect.objectContaining({ queue_prd_id: 'new-queue', lifecycle_state: 'submitted', is_current: 1, is_terminal: 0, superseded_at: null }),
      ]));
      expect(shown.sourceRefs).toMatchObject({ sourceItemIds: ['item-one'], sourceEpicIds: ['epic-one'], recommendationRef: 'rec-one' });
      expect(shown.lifecycle).toMatchObject({ lifecycleState: 'partial' });
      expect(shown.lifecycle).toMatchObject({ itemRows: [expect.objectContaining({ itemId: 'item-one', lifecycleState: 'queue' })] });
      expect(JSON.stringify(shown.lifecycle)).toContain('new-queue');
      expect(JSON.stringify(shown.lifecycle)).not.toContain('old-queue');
      expect(JSON.stringify(shown.lifecycle)).not.toContain('old-run');
      expect((shown.sourceRefRows as Array<{ itemRef?: string }>).filter((row) => row.itemRef === 'item-one')).toEqual([expect.objectContaining({ itemRef: 'item-one', provenance: 'canonical-sync', sourceRecommendationRef: 'rec-one', promotedAt: expect.any(String) })]);
      expect((list.artifacts as Array<{ key: string; lifecycle?: { lifecycleState?: string } }>).filter((artifact) => artifact.key === 'plan:recover-plan')).toHaveLength(1);
      expect(JSON.stringify(listedPlan)).toContain('new-queue');
      expect(JSON.stringify(listedPlan)).not.toContain('old-queue');
      expect(JSON.stringify(listedPlan)).not.toContain('old-run');
      const second = await dispatch(cwd, 'resubmit-session-plan', { session: 'recover-plan' }, { enqueue: async () => ({ sessionId: 'duplicate-queue', pid: 3, autoBuild: false }) });
      expect(second).toMatchObject({ kind: 'not-recoverable', session: 'recover-plan', message: expect.stringContaining('Active queue/build evidence') });
      expect(storedQueueRows(cwd, 'recover-plan').map((row) => row.prd_id)).not.toContain('duplicate-queue');
    });
  });

  it('resubmits a submitted plan after removed queue evidence and keeps the stale record separate from the fresh queue record', async () => {
    await withTempProject(async (cwd) => {
      await writeBacklogItem(cwd, { id: 'item-one', title: 'Item one', status: 'planned' });
      await writeBacklogEpic(cwd, { id: 'epic-one', title: 'Epic one', status: 'planned' });
      await mkdir(join(cwd, '.eforge', 'session-plans'), { recursive: true });
      await writeFile(join(cwd, '.eforge', 'session-plans', 'removed-queue-plan.md'), `---\nsession: removed-queue-plan\ntopic: Removed Queue Plan\nstatus: ready\nplanning_type: feature\nplanning_depth: quick\nrequired_dimensions:\n  - problem-statement\n  - scope\n  - acceptance-criteria\n  - assumptions-and-validation\noptional_dimensions: []\nskipped_dimensions: []\nopen_questions: []\nprofile: null\neforge_plan:\n  source_item_ids:\n    - item-one\n  source_epic_ids:\n    - epic-one\n  source_recommendation_ref: rec-one\n---\n${readyBody('Removed Queue Plan')}`, 'utf-8');
      await dispatch(cwd, 'set-session-plan-ready', { session: 'removed-queue-plan' });
      await dispatch(cwd, 'handoff-session-plan', { session: 'removed-queue-plan' }, { enqueue: async () => ({ sessionId: 'removed-queue', pid: 1, autoBuild: false }) });
      await synchronizeRemovedQueuePrdCoverage(cwd, 'removed-queue', { timestamp: '2099-01-01T00:00:00.000Z' });
      expect(storedStatus(cwd, 'removed-queue-plan')).toBe('removed');
      await writeFile(join(cwd, '.eforge', 'session-plans', 'removed-queue-plan.md'), `---\nsession: removed-queue-plan\ntopic: Removed Queue Plan\nstatus: ready\nplanning_type: feature\nplanning_depth: quick\nrequired_dimensions:\n  - problem-statement\n  - scope\n  - acceptance-criteria\n  - assumptions-and-validation\noptional_dimensions: []\nskipped_dimensions: []\nopen_questions: []\nprofile: null\n---\n${readyBody('Removed Queue Plan')}`, 'utf-8');
      await dispatch(cwd, 'check-session-plan-readiness', { session: 'removed-queue-plan' });
      expect(storedStatus(cwd, 'removed-queue-plan')).toBe('removed');
      const enqueueCalls: Array<{ source: string; suppressSessionPlanSubmissionMark?: boolean }> = [];

      const resubmitted = await dispatch(cwd, 'resubmit-session-plan', { session: 'removed-queue-plan' }, { enqueue: async (request) => { enqueueCalls.push(request); return { sessionId: 'fresh-queue', pid: 2, autoBuild: false }; } });
      const shown = await dispatch(cwd, 'show-session-plan', { session: 'removed-queue-plan' });

      expect(resubmitted).toMatchObject({ kind: 'enqueued', session: 'removed-queue-plan', queueSessionId: 'fresh-queue' });
      expect(enqueueCalls).toEqual([{ source: '.eforge/session-plans/removed-queue-plan.md', suppressSessionPlanSubmissionMark: true }]);
      expect(storedStatus(cwd, 'removed-queue-plan')).toBe('submitted');
      expect(storedQueueRows(cwd, 'removed-queue-plan')).toEqual([
        { prd_id: 'fresh-queue', status: 'queued' },
        { prd_id: 'removed-queue', status: 'removed' },
      ]);
      expect(storedSessionPlanCount(cwd, 'removed-queue-plan')).toBe(1);
      expect(shown.sourceRefs).toMatchObject({ sourceItemIds: ['item-one'], sourceEpicIds: ['epic-one'], recommendationRef: 'rec-one' });
      expect((shown.sourceRefRows as Array<{ itemRef?: string }>).filter((row) => row.itemRef === 'item-one')).toEqual([expect.objectContaining({ itemRef: 'item-one', provenance: 'canonical-sync', sourceRecommendationRef: 'rec-one' })]);
    });
  });

  it('resubmits a submitted plan after failed queue evidence without a build run', async () => {
    await withTempProject(async (cwd) => {
      await writeSessionPlanRaw(cwd, 'failed-queue-plan', readyBody('Failed Queue Plan'));
      await dispatch(cwd, 'set-session-plan-ready', { session: 'failed-queue-plan' });
      await dispatch(cwd, 'handoff-session-plan', { session: 'failed-queue-plan' }, { enqueue: async () => ({ sessionId: 'failed-queue', pid: 1, autoBuild: false }) });
      const store = openEforgePlanStore(cwd, { create: true, migrate: true });
      try { upsertQueuePrd(store, { prdId: 'failed-queue', session: 'failed-queue-plan', status: 'failed', updatedAt: '2099-01-01T00:00:00.000Z' }); } finally { store.close(); }
      const calls: Array<{ source: string; suppressSessionPlanSubmissionMark?: boolean }> = [];

      const resubmitted = await dispatch(cwd, 'resubmit-session-plan', { session: 'failed-queue-plan' }, { enqueue: async (request) => { calls.push(request); return { sessionId: 'fresh-failed-queue', pid: 2, autoBuild: false }; } });

      expect(resubmitted).toMatchObject({ kind: 'enqueued', session: 'failed-queue-plan', queueSessionId: 'fresh-failed-queue' });
      expect(calls).toEqual([{ source: '.eforge/session-plans/failed-queue-plan.md', suppressSessionPlanSubmissionMark: true }]);
      expect(storedSessionPlanCount(cwd, 'failed-queue-plan')).toBe(1);
      expect(storedQueueRows(cwd, 'failed-queue-plan')).toEqual([
        { prd_id: 'failed-queue', status: 'failed' },
        { prd_id: 'fresh-failed-queue', status: 'queued' },
      ]);
    });
  });

  it('resubmits after failed build-session evidence supersedes a stale queued row', async () => {
    await withTempProject(async (cwd) => {
      await writeSessionPlanRaw(cwd, 'failed-session-plan', readyBody('Failed Session Plan'));
      await dispatch(cwd, 'set-session-plan-ready', { session: 'failed-session-plan' });
      await dispatch(cwd, 'handoff-session-plan', { session: 'failed-session-plan' }, { enqueue: async () => ({ sessionId: 'stale-queue', pid: 1, autoBuild: false }) });
      const store = openEforgePlanStore(cwd, { create: true, migrate: true });
      try { upsertBuildSession(store, { buildSessionId: 'failed-build-session', session: 'failed-session-plan', status: 'failed', finishedAt: '2099-01-01T00:00:00.000Z' }); } finally { store.close(); }

      const resubmitted = await dispatch(cwd, 'resubmit-session-plan', { session: 'failed-session-plan' }, { enqueue: async () => ({ sessionId: 'fresh-session-queue', pid: 2, autoBuild: false }) });

      expect(resubmitted).toMatchObject({ kind: 'enqueued', session: 'failed-session-plan', queueSessionId: 'fresh-session-queue' });
      expect(storedQueueRows(cwd, 'failed-session-plan')).toEqual([
        { prd_id: 'fresh-session-queue', status: 'queued' },
        { prd_id: 'stale-queue', status: 'queued' },
      ]);
    });
  });

  it('does not treat successful completed build evidence as recoverable', async () => {
    await withTempProject(async (cwd) => {
      await writeSessionPlanRaw(cwd, 'completed-plan', readyBody('Completed Plan'));
      await dispatch(cwd, 'set-session-plan-ready', { session: 'completed-plan' });
      await dispatch(cwd, 'handoff-session-plan', { session: 'completed-plan' }, { enqueue: async () => ({ sessionId: 'completed-queue', pid: 1, autoBuild: false }) });
      const store = openEforgePlanStore(cwd, { create: true, migrate: true });
      try {
        upsertQueuePrd(store, { prdId: 'completed-queue', session: 'completed-plan', status: 'completed', updatedAt: '2099-01-01T00:00:00.000Z' });
        upsertBuildRun(store, { runId: 'completed-run', session: 'completed-plan', queuePrdId: 'completed-queue', status: 'completed', finishedAt: '2099-01-01T00:01:00.000Z' });
      } finally { store.close(); }
      const calls: string[] = [];

      const resubmitted = await dispatch(cwd, 'resubmit-session-plan', { session: 'completed-plan' }, { enqueue: async (request) => { calls.push(request.source); return { sessionId: 'unexpected', pid: 2, autoBuild: false }; } });

      expect(resubmitted).toMatchObject({ kind: 'not-recoverable', session: 'completed-plan', message: expect.stringContaining('No terminal failed or removed queue/build evidence') });
      expect(calls).toEqual([]);
    });
  });

  it('returns enqueue-failed for recoverable resubmit without creating fresh evidence', async () => {
    await withTempProject(async (cwd) => {
      await writeSessionPlanRaw(cwd, 'recoverable-enqueue-fail', readyBody('Recoverable Enqueue Fail'));
      await dispatch(cwd, 'set-session-plan-ready', { session: 'recoverable-enqueue-fail' });
      await dispatch(cwd, 'handoff-session-plan', { session: 'recoverable-enqueue-fail' }, { enqueue: async () => ({ sessionId: 'old-failed-queue', pid: 1, autoBuild: false }) });
      const store = openEforgePlanStore(cwd, { create: true, migrate: true });
      try { upsertQueuePrd(store, { prdId: 'old-failed-queue', session: 'recoverable-enqueue-fail', status: 'failed', updatedAt: '2099-01-01T00:00:00.000Z' }); } finally { store.close(); }
      const beforeEvidence = storedSubmittedEvidenceRows(cwd, 'recoverable-enqueue-fail');

      const resubmitted = await dispatch(cwd, 'resubmit-session-plan', { session: 'recoverable-enqueue-fail' }, { enqueue: async () => { throw new Error('daemon unavailable'); } });

      expect(resubmitted).toMatchObject({ kind: 'enqueue-failed', session: 'recoverable-enqueue-fail', sourcePath: '.eforge/session-plans/recoverable-enqueue-fail.md' });
      expect(String(resubmitted.message)).toContain('Session plan is recoverable, but enqueue failed');
      expect(String(resubmitted.command)).toContain('.eforge/session-plans/recoverable-enqueue-fail.md');
      expect(storedStatus(cwd, 'recoverable-enqueue-fail')).toBe('submitted');
      expect(storedQueueRows(cwd, 'recoverable-enqueue-fail')).toEqual([{ prd_id: 'old-failed-queue', status: 'failed' }]);
      expect(storedSubmittedEvidenceRows(cwd, 'recoverable-enqueue-fail')).toEqual(beforeEvidence);
    });
  });

  it('does not resubmit when newer successful terminal evidence follows older recoverable evidence', async () => {
    await withTempProject(async (cwd) => {
      await writeSessionPlanRaw(cwd, 'newer-success-plan', readyBody('Newer Success Plan'));
      await dispatch(cwd, 'set-session-plan-ready', { session: 'newer-success-plan' });
      await dispatch(cwd, 'handoff-session-plan', { session: 'newer-success-plan' }, { enqueue: async () => ({ sessionId: 'older-failed-queue', pid: 1, autoBuild: false }) });
      const store = openEforgePlanStore(cwd, { create: true, migrate: true });
      try {
        upsertQueuePrd(store, { prdId: 'older-failed-queue', session: 'newer-success-plan', status: 'failed', updatedAt: '2099-01-01T00:00:00.000Z' });
        upsertBuildSession(store, { buildSessionId: 'newer-success-session', session: 'newer-success-plan', status: 'completed', finishedAt: '2099-01-01T00:01:00.000Z' });
      } finally { store.close(); }
      const calls: string[] = [];

      const resubmitted = await dispatch(cwd, 'resubmit-session-plan', { session: 'newer-success-plan' }, { enqueue: async (request) => { calls.push(request.source); return { sessionId: 'unexpected', pid: 2, autoBuild: false }; } });

      expect(resubmitted).toMatchObject({ kind: 'not-recoverable', session: 'newer-success-plan', message: expect.stringContaining('No terminal failed or removed queue/build evidence') });
      expect(calls).toEqual([]);
    });
  });

  it('does not resubmit an active submitted plan until terminal failed or removed queue/build evidence exists', async () => {
    await withTempProject(async (cwd) => {
      await writeSessionPlanRaw(cwd, 'active-submitted-plan', readyBody('Active Submitted Plan'));
      await dispatch(cwd, 'set-session-plan-ready', { session: 'active-submitted-plan' });
      await dispatch(cwd, 'handoff-session-plan', { session: 'active-submitted-plan' }, { enqueue: async () => ({ sessionId: 'active-queue', pid: 1, autoBuild: false }) });
      const enqueueCalls: string[] = [];

      const resubmitted = await dispatch(cwd, 'resubmit-session-plan', { session: 'active-submitted-plan' }, {
        enqueue: async (request) => {
          enqueueCalls.push(request.source);
          return { sessionId: 'unexpected-queue', pid: 2, autoBuild: false };
        },
      });

      expect(resubmitted).toMatchObject({ kind: 'not-recoverable', session: 'active-submitted-plan', status: 'submitted', message: expect.stringContaining('Active queue/build evidence') });
      expect(enqueueCalls).toEqual([]);
      expect(storedQueueRows(cwd, 'active-submitted-plan')).toEqual([{ prd_id: 'active-queue', status: 'queued' }]);
    });
  });

  it('does not resubmit a recoverable submitted plan when the current body is not ready', async () => {
    await withTempProject(async (cwd) => {
      await writeSessionPlanRaw(cwd, 'non-ready-resubmit', readyBody('Non Ready Resubmit'));
      await dispatch(cwd, 'set-session-plan-ready', { session: 'non-ready-resubmit' });
      await dispatch(cwd, 'handoff-session-plan', { session: 'non-ready-resubmit' }, { enqueue: async () => ({ sessionId: 'old-failed', pid: 1, autoBuild: false }) });
      await writeSessionPlanRaw(cwd, 'non-ready-resubmit', '# Missing required sections', 'ready');
      const store = openEforgePlanStore(cwd, { create: true, migrate: true });
      try { upsertQueuePrd(store, { prdId: 'old-failed', session: 'non-ready-resubmit', status: 'failed', updatedAt: '2099-01-01T00:00:00.000Z' }); } finally { store.close(); }
      const calls: string[] = [];
      const beforeEvidence = storedSubmittedEvidenceRows(cwd, 'non-ready-resubmit');

      const resubmitted = await dispatch(cwd, 'resubmit-session-plan', { session: 'non-ready-resubmit' }, { enqueue: async (request) => { calls.push(request.source); return { sessionId: 'unexpected-fresh', pid: 2, autoBuild: false }; } });

      expect(resubmitted).toMatchObject({ kind: 'not-ready', session: 'non-ready-resubmit' });
      expect(calls).toEqual([]);
      expect(storedQueueRows(cwd, 'non-ready-resubmit')).toEqual([{ prd_id: 'old-failed', status: 'failed' }]);
      expect(storedSubmittedEvidenceRows(cwd, 'non-ready-resubmit')).toEqual(beforeEvidence);
    });
  });

  it('does not resubmit a ready plan with non-recoverable canonical status', async () => {
    await withTempProject(async (cwd) => {
      await writeSessionPlanRaw(cwd, 'ready-status-resubmit', readyBody('Ready Status Resubmit'));
      await dispatch(cwd, 'set-session-plan-ready', { session: 'ready-status-resubmit' });
      const store = openEforgePlanStore(cwd, { create: true, migrate: true });
      try { upsertQueuePrd(store, { prdId: 'old-failed', session: 'ready-status-resubmit', status: 'failed', updatedAt: '2099-01-01T00:00:00.000Z' }); } finally { store.close(); }
      const calls: string[] = [];

      const resubmitted = await dispatch(cwd, 'resubmit-session-plan', { session: 'ready-status-resubmit' }, { enqueue: async (request) => { calls.push(request.source); return { sessionId: 'unexpected-fresh', pid: 2, autoBuild: false }; } });

      expect(resubmitted).toMatchObject({ kind: 'not-recoverable', session: 'ready-status-resubmit', status: 'ready' });
      expect(calls).toEqual([]);
      expect(storedQueueRows(cwd, 'ready-status-resubmit')).toEqual([{ prd_id: 'old-failed', status: 'failed' }]);
    });
  });

  it('allows deleting a submitted flat plan by updating canonical status to abandoned', async () => {
    await withTempProject(async (cwd) => {
      await writeSessionPlanRaw(cwd, 'submitted-delete', readyBody());
      await dispatch(cwd, 'set-session-plan-ready', { session: 'submitted-delete' });
      await dispatch(cwd, 'handoff-session-plan', { session: 'submitted-delete' }, { enqueue: async () => ({ sessionId: 'build-session-delete', pid: 4321, autoBuild: false }) });

      const deleted = await dispatch(cwd, 'delete-session-plan', { session: 'submitted-delete' });
      const raw = await readFile(join(cwd, '.eforge', 'session-plans', 'submitted-delete.md'), 'utf-8');

      expect(deleted).toMatchObject({ kind: 'deleted', session: 'submitted-delete', status: 'abandoned' });
      expect(raw).toContain('status: abandoned');
      expect(storedStatus(cwd, 'submitted-delete')).toBe('abandoned');
    });
  });

  it('returns an enqueue-failed handoff when the build queue is unavailable', async () => {
    await withTempProject(async (cwd) => {
      await writeSessionPlanRaw(cwd, 'ready-plan', readyBody(), 'ready');
      await dispatch(cwd, 'set-session-plan-ready', { session: 'ready-plan' });

      const handoff = await dispatch(cwd, 'handoff-session-plan', { session: 'ready-plan' });
      const listed = await dispatch(cwd, 'list-planning-artifacts', {});

      expect(handoff).toMatchObject({ kind: 'enqueue-failed', session: 'ready-plan', sourcePath: '.eforge/session-plans/ready-plan.md' });
      expect(String(handoff.message)).toContain('enqueue failed');
      expect(String(handoff.command)).toContain('.eforge/session-plans/ready-plan.md');
      expect(storedStatus(cwd, 'ready-plan')).toBe('ready');
      expect((listed.artifacts as Array<{ key: string }>).map((artifact) => artifact.key)).toContain('plan:ready-plan');
      expect(collectUndefinedPaths(handoff)).toEqual([]);
    });
  });
});

async function writePlanSet(cwd: string, planSetId: string) {
  const dir = join(cwd, '.eforge', 'session-plans', planSetId);
  await mkdir(join(dir, 'plans'), { recursive: true });
  const title = planSetId.split('-').map((part) => part[0].toUpperCase() + part.slice(1)).join(' ');
  await writeFile(join(dir, 'plan-set.yaml'), [
    `id: ${planSetId}`,
    `title: ${title}`,
    'status: planning',
    'strategy: sequential',
    'anchor: umbrella.md',
    'children:',
    '  - id: child-one',
    '    title: Child One',
    '    file: plans/child-one.md',
    '    kind: plan',
    '    buildable: true',
    '    status: planning',
    '    dependsOn: []',
    '',
  ].join('\n'), 'utf-8');
  await writeFile(join(dir, 'umbrella.md'), '# Umbrella\n\nAnchor content.\n', 'utf-8');
  await writeFile(join(dir, 'plans', 'child-one.md'), '---\nstatus: planning\n---\n# Child One\n', 'utf-8');
}
