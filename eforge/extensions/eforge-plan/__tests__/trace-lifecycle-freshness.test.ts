import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { dispatchExtensionAction } from '@eforge-build/engine/extensions/action-runtime.js';
import { createExtensionRecorder } from '@eforge-build/engine/extensions/recorder.js';
import { createSessionPlanningWorkflowAdapter } from '@eforge-build/input';
import { buildBoard } from '../board-actions.js';
import { isActiveLandingTraceEntry, isActiveQueueOrBuildTraceEntry, isActiveSessionPlanTraceEntry } from '../lifecycle-projection.js';
import { writeBacklogItem } from '../markdown-store.js';
import { preparePlannerContext } from '../planner-orchestration.js';
import { buildBacklogCurationSource } from '../backlog-curation-source.js';
import { createTraceSidecar, summarizeTrace, writeTraceSidecar } from '../trace-store.js';
import { summarizeProjectTraces } from '../trace-activity.js';
import eforgePlanExtension from '../index.js';

async function withTempProject<T>(fn: (cwd: string) => Promise<T>): Promise<T> {
  const cwd = await mkdtemp(join(tmpdir(), 'eforge-plan-trace-lifecycle-'));
  try { return await fn(cwd); } finally { await rm(cwd, { recursive: true, force: true }); }
}

function registry() {
  const { api, state } = createExtensionRecorder('eforge-plan', '/project/eforge/extensions/eforge-plan/index.ts');
  eforgePlanExtension(api as never);
  expect(state.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')).toEqual([]);
  return { ...state, extensions: [], candidates: [] };
}

async function listBoardCompact(cwd: string) {
  const result = await dispatchExtensionAction(registry(), {
    actionId: 'eforge-plan:list-board-compact',
    input: { includeClosed: true, includeArchive: true },
    requestedBy: { host: 'pi' },
    cwd,
    timeoutMs: 1000,
  });
  expect(result.kind).toBe('success');
  if (result.kind !== 'success') throw new Error(result.message);
  return result.output as { items: Array<{ id: string; lane: string }> };
}

describe('trace lifecycle freshness', () => {
  it('classifies session-plan traces as active only with editable plan evidence', () => {
    expect(isActiveSessionPlanTraceEntry({ session: 's', status: 'submitted' }, { liveEditableSessionIds: new Set(['s']) })).toBe(false);
    expect(isActiveSessionPlanTraceEntry({ session: 's', status: 'abandoned' }, { liveEditableSessionIds: new Set(['s']) })).toBe(false);
    expect(isActiveSessionPlanTraceEntry({ session: 's', status: 'ready' }, { liveEditableSessionIds: new Set(['s']) })).toBe(true);
    expect(isActiveSessionPlanTraceEntry({ session: 's', status: 'ready' }, { liveEditableSessionIds: new Set() })).toBe(false);
  });

  it('classifies queue, build, and landing activity from active statuses', () => {
    expect(isActiveQueueOrBuildTraceEntry({ status: 'running' })).toBe(true);
    expect(isActiveQueueOrBuildTraceEntry({ status: 'completed' })).toBe(false);
    expect(isActiveQueueOrBuildTraceEntry({ status: 'running', completedAt: '2026-01-01T00:00:00.000Z' })).toBe(false);
    expect(isActiveLandingTraceEntry({ status: 'pr-open', prUrl: 'https://example.com/pr/1' })).toBe(true);
    expect(isActiveLandingTraceEntry({ status: 'started' })).toBe(true);
    expect(isActiveLandingTraceEntry({ status: 'landed' })).toBe(false);
    expect(isActiveLandingTraceEntry({ status: 'auto-merged' })).toBe(false);
  });

  it('keeps submitted-only session-plan traces historical in summaries and board lanes', async () => {
    await withTempProject(async (cwd) => {
      await writeBacklogItem(cwd, { id: 'item-one', status: 'candidate', body: '# Item One\n' });
      const trace = { ...createTraceSidecar('item-one'), promotedSessionPlans: [{ session: 'session-one', status: 'submitted', path: '.eforge/session-plans/session-one.md' }] };
      await writeTraceSidecar(cwd, trace);

      const summary = summarizeTrace(trace, { liveEditableSessionIds: new Set() });
      expect(summary).toMatchObject({ hasActiveSessionPlan: false, hasActiveTrace: false, activeReasons: [], lifecycleState: 'none' });
      expect(summary?.linkRows).toHaveLength(1);

      const board = await buildBoard(cwd, { includeArchive: true });
      expect(board.lanes.find((lane) => lane.lane === 'in-progress')?.items.map((item) => item.id)).not.toContain('item-one');
      expect(board.lanes.find((lane) => lane.lane === 'inbox')?.items.map((item) => item.id)).toContain('item-one');
      expect((await listBoardCompact(cwd)).items.find((item) => item.id === 'item-one')?.lane).toBe('inbox');

    });
  });

  it('activates ready session-plan traces only when the flat plan is editable', async () => {
    await withTempProject(async (cwd) => {
      await createSessionPlanningWorkflowAdapter().flat.create({ cwd, session: 'session-one', topic: 'Session One' });
      const trace = { ...createTraceSidecar('item-one'), promotedSessionPlans: [{ session: 'session-one', status: 'ready', path: '.eforge/session-plans/session-one.md' }] };
      const [summary] = await summarizeProjectTraces(cwd, [trace]);
      expect(summary).toMatchObject({ hasActiveSessionPlan: true, hasActiveTrace: true, lifecycleState: 'planned' });
      expect(summary.activeReasons).toContain('active session-plan trace session-one');
    });
  });

  it('attributes activity to queue, build, and PR rows instead of stale submitted plan rows', async () => {
    await withTempProject(async (cwd) => {
      const trace = createTraceSidecar('item-one');
      trace.promotedSessionPlans.push({ session: 'stale-session', status: 'submitted' });
      trace.queuePrds.push({ prdId: 'prd-one', status: 'queued' });
      trace.buildRuns.push({ runId: 'run-one', sessionId: 'build-session', status: 'running' });
      trace.landingResults.push({ featureBranch: 'feature/one', status: 'pr-open', prUrl: 'https://example.com/pr/1' });
      const [summary] = await summarizeProjectTraces(cwd, [trace]);
      expect(summary.activeReasons).not.toContain('active session-plan trace stale-session');
      expect(summary.activeReasons).toEqual(expect.arrayContaining(['active queue trace prd-one', 'active build run trace run-one', 'active PR trace https://example.com/pr/1']));
      expect(summary.lifecycleState).toBe('pr-open');
    });
  });

  it('reports only the live queue reason when submitted plan history is paired with queue evidence', async () => {
    await withTempProject(async (cwd) => {
      const trace = createTraceSidecar('item-one');
      trace.promotedSessionPlans.push({ session: 'stale-session', status: 'submitted' });
      trace.queuePrds.push({ prdId: 'prd-one', status: 'queued' });

      const [summary] = await summarizeProjectTraces(cwd, [trace]);

      expect(summary).toMatchObject({ hasActiveTrace: true, hasActiveSessionPlan: false, hasActiveQueuePrd: true, lifecycleState: 'queue' });
      expect(summary.activeReasons).toEqual(['active queue trace prd-one']);
    });
  });

  it('reports only the live build reason when submitted plan history is paired with build evidence', async () => {
    await withTempProject(async (cwd) => {
      const trace = createTraceSidecar('item-one');
      trace.promotedSessionPlans.push({ session: 'stale-session', status: 'submitted' });
      trace.buildRuns.push({ runId: 'run-one', sessionId: 'build-session', status: 'running' });

      const [summary] = await summarizeProjectTraces(cwd, [trace]);

      expect(summary).toMatchObject({ hasActiveTrace: true, hasActiveSessionPlan: false, hasActiveBuildRun: true, lifecycleState: 'build' });
      expect(summary.activeReasons).toEqual(['active build run trace run-one']);
    });
  });

  it('reports active lifecycle state for started and running landing evidence', async () => {
    await withTempProject(async (cwd) => {
      for (const status of ['started', 'running'] as const) {
        const trace = createTraceSidecar(`item-${status}`);
        trace.landingResults.push({ featureBranch: `feature/${status}`, status });

        const [summary] = await summarizeProjectTraces(cwd, [trace]);

        expect(summary).toMatchObject({ hasActiveTrace: true, hasActiveSessionPlan: false, lifecycleState: 'active' });
        expect(summary.activeReasons).toEqual([`active landing trace feature/${status}`]);
      }
    });
  });

  it('reports only the active PR reason when submitted plan history is paired with PR evidence', async () => {
    await withTempProject(async (cwd) => {
      const trace = createTraceSidecar('item-one');
      trace.promotedSessionPlans.push({ session: 'stale-session', status: 'submitted' });
      trace.landingResults.push({ featureBranch: 'feature/one', status: 'pr-open', prUrl: 'https://example.com/pr/1' });

      const [summary] = await summarizeProjectTraces(cwd, [trace]);

      expect(summary).toMatchObject({ hasActiveTrace: true, hasActiveSessionPlan: false, lifecycleState: 'pr-open' });
      expect(summary.activeReasons).toEqual(['active PR trace https://example.com/pr/1']);
    });
  });

  it('loads stored trace sidecars once and returns deterministic summaries when traces are omitted', async () => {
    await withTempProject(async (cwd) => {
      await writeTraceSidecar(cwd, { ...createTraceSidecar('item-b'), promotedSessionPlans: [{ session: 'session-b', status: 'submitted' }] });
      await writeTraceSidecar(cwd, { ...createTraceSidecar('item-a'), buildSessions: [{ sessionId: 'build-session-a', status: 'running' }] });

      const summaries = await summarizeProjectTraces(cwd);

      expect(summaries.map((summary) => summary.itemId)).toEqual(['item-a', 'item-b']);
      expect(summaries[0]).toMatchObject({ hasActiveBuildSession: true, activeReasons: ['active build session trace build-session-a'], lifecycleState: 'build' });
      expect(summaries[1]).toMatchObject({ hasActiveSessionPlan: false, hasActiveTrace: false, activeReasons: [], lifecycleState: 'none' });
    });
  });

  it('preserves historical trace rows in planner and curation source projections without active session reasons', async () => {
    await withTempProject(async (cwd) => {
      await writeBacklogItem(cwd, { id: 'item-one', status: 'candidate', body: '# Item One\n' });
      await writeTraceSidecar(cwd, { ...createTraceSidecar('item-one'), promotedSessionPlans: [{ session: 'session-one', status: 'submitted' }] });
      const planner = await preparePlannerContext(cwd, {});
      expect(JSON.stringify(planner.traceSummaries)).toContain('session-one');
      expect(JSON.stringify(planner.traceSummaries)).not.toContain('active session-plan trace');
      const curation = await buildBacklogCurationSource(cwd);
      expect(JSON.stringify(curation.source.traceSummaries)).toContain('session-one');
      expect(JSON.stringify(curation.source.traceSummaries)).not.toContain('active session-plan trace');
    });
  });
});
