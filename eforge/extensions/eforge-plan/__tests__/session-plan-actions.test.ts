import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { dispatchExtensionAction } from '@eforge-build/engine/extensions/action-runtime.js';
import { createExtensionRecorder } from '@eforge-build/engine/extensions/recorder.js';
import type { NativeExtensionRecorderState, NativeExtensionRegistry } from '@eforge-build/engine/extensions/types.js';
import eforgePlanExtension from '../index.js';
import { writeBacklogEpic, writeBacklogItem } from '../markdown-store.js';
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

async function dispatch(cwd: string, actionId: string, input: Record<string, unknown>, options: { enqueue?: (source: string) => Promise<{ sessionId: string; pid: number; autoBuild: boolean }> } = {}) {
  const result = await dispatchExtensionAction(registry(), {
    actionId: `eforge-plan:${actionId}`,
    input,
    requestedBy: { host: 'pi' },
    cwd,
    timeoutMs: 1000,
    ...(options.enqueue && { buildQueue: () => ({ enqueue: (request) => options.enqueue!(request.source) }) }),
  });
  expect(result).toMatchObject({ kind: 'success' });
  if (result.kind !== 'success') throw new Error(result.message);
  return result.output as Record<string, unknown>;
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
  it('lists flat plans and plan sets as JSON-safe planning artifact keys', async () => {
    await withTempProject(async (cwd) => {
      await writeBacklogItem(cwd, { id: 'backlog-one', status: 'planned', body: '# Backlog One\n\n## Claim\n\nPlan it.\n' });
      await writeSessionPlanRaw(cwd, 'flat-one', readyBody());
      await writePlanSet(cwd, 'set-one');

      const output = await dispatch(cwd, 'list-planning-artifacts', { includeArchive: false });

      expect(collectUndefinedPaths(output)).toEqual([]);
      expect((output.artifacts as Array<{ key: string }>).map((artifact) => artifact.key).sort()).toEqual(['plan-set:set-one', 'plan:flat-one']);
      expect('board' in output).toBe(false);
      expect(JSON.stringify(output)).not.toContain('Plan it.');
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
        ['item-two', 'planned'],
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
    });
  });

  it('replaces duplicate dimension headings with exactly one canonical section', async () => {
    await withTempProject(async (cwd) => {
      await writeSessionPlanRaw(cwd, 'dupe-plan', `${readyBody()}\n## Scope\n\nDuplicate scope.\n`);

      await dispatch(cwd, 'set-session-plan-section', { session: 'dupe-plan', dimension: 'scope', content: 'Only this scope remains.' });
      const raw = await readFile(join(cwd, '.eforge', 'session-plans', 'dupe-plan.md'), 'utf-8');

      expect(raw.match(/^## Scope$/gm)).toHaveLength(1);
      expect(raw).toContain('Only this scope remains.');
      expect(raw).not.toContain('Duplicate scope.');
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
      const listed = await dispatch(cwd, 'list-planning-artifacts', {});
      const raw = await readFile(join(cwd, '.eforge', 'session-plans', 'delete-me.md'), 'utf-8');

      expect(deleted).toMatchObject({ kind: 'deleted', session: 'delete-me', status: 'abandoned', plan: { status: 'abandoned' } });
      expect(raw).toContain('status: abandoned');
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
        enqueue: async (source) => {
          enqueuedSources.push(source);
          return { sessionId: 'build-session-1', pid: 1234, autoBuild: true };
        },
      });
      const raw = await readFile(join(cwd, '.eforge', 'session-plans', 'ready-plan.md'), 'utf-8');

      expect(ready).toMatchObject({ kind: 'ready', status: 'ready' });
      expect(handoff).toMatchObject({ kind: 'enqueued', session: 'ready-plan', sourcePath: '.eforge/session-plans/ready-plan.md', absolutePath: resolve(cwd, '.eforge', 'session-plans', 'ready-plan.md'), queueSessionId: 'build-session-1', pid: 1234, autoBuild: true });
      expect(enqueuedSources).toEqual(['.eforge/session-plans/ready-plan.md']);
      expect(collectUndefinedPaths(handoff)).toEqual([]);
      expect(raw).toContain('status: ready');
      expect(raw).not.toContain('status: submitted');
    });
  });

  it('returns an enqueue-failed handoff when the build queue is unavailable', async () => {
    await withTempProject(async (cwd) => {
      await writeSessionPlanRaw(cwd, 'ready-plan', readyBody(), 'ready');

      const handoff = await dispatch(cwd, 'handoff-session-plan', { session: 'ready-plan' });

      expect(handoff).toMatchObject({ kind: 'enqueue-failed', session: 'ready-plan', sourcePath: '.eforge/session-plans/ready-plan.md' });
      expect(String(handoff.message)).toContain('enqueue failed');
      expect(String(handoff.command)).toContain('.eforge/session-plans/ready-plan.md');
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
