import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { dispatchExtensionAction } from '@eforge-build/engine/extensions/action-runtime.js';
import { createExtensionRecorder } from '@eforge-build/engine/extensions/recorder.js';
import type { NativeExtensionRecorderState, NativeExtensionRegistry } from '@eforge-build/engine/extensions/types.js';
import { createEforgeProjectPaths, type EventHookContext } from '@eforge-build/extension-sdk';
import { parseExtensionAgentTaskRecord, type ExtensionAgentTaskRecord } from '@eforge-build/client';
import eforgePlanExtension from '../index.js';
import { captureCanonicalBacklogItem, updateCanonicalBacklogItem, upsertCanonicalEpic } from '../canonical/backlog-records.js';
import { writeBacklogEpic, writeBacklogItem } from '../markdown-store.js';
import { createEmptyRecommendationModel, resolveRecommendationsPathForCwd } from '../recommendations-store.js';
import { resolveRecommendationStatusPathForCwd } from '../recommendation-status.js';
import { createTraceSidecar, readTraceSidecar, writeTraceSidecar } from '../trace-store.js';

async function withTempProject<T>(fn: (cwd: string) => Promise<T>): Promise<T> {
  const cwd = await mkdtemp(join(tmpdir(), 'eforge-plan-invalidation-'));
  try { return await fn(cwd); } finally { await rm(cwd, { recursive: true, force: true }); }
}

function loadState(): NativeExtensionRecorderState {
  const { api, state } = createExtensionRecorder('eforge-plan', '/project/eforge/extensions/eforge-plan/index.ts');
  eforgePlanExtension(api as never);
  expect(state.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')).toEqual([]);
  return state;
}

function load(): NativeExtensionRegistry {
  return { ...loadState(), extensions: [], candidates: [] };
}

function validModel(itemId = 'item-one') {
  return { ...createEmptyRecommendationModel(), recommendedNextSequence: [{ itemId, rationale: 'Preserve this model.' }], rationaleAndAssumptions: ['Baseline.'] };
}

async function seedBacklog(cwd: string): Promise<void> {
  upsertCanonicalEpic(cwd, { id: 'epic-one', status: 'planned', title: 'Epic One', body: '# Epic One\n' });
  captureCanonicalBacklogItem(cwd, { id: 'item-one', status: 'candidate', epic: 'epic-one', title: 'Item One', body: '# Item One\n\n## Claim\n\nFirst.\n' });
  captureCanonicalBacklogItem(cwd, { id: 'item-two', status: 'candidate', title: 'Item Two', body: '# Item Two\n\n## Claim\n\nSecond.\n' });
  await writeBacklogEpic(cwd, { id: 'epic-one', status: 'planned', body: '# Epic One\n' });
  await writeBacklogItem(cwd, { id: 'item-one', status: 'candidate', epic: 'epic-one', body: '# Item One\n\n## Claim\n\nFirst.\n' });
  await writeBacklogItem(cwd, { id: 'item-two', status: 'candidate', body: '# Item Two\n\n## Claim\n\nSecond.\n' });
}

async function putBaseline(cwd: string): Promise<void> {
  const result = await dispatchExtensionAction(load(), { actionId: 'eforge-plan:put-recommendations', input: validModel(), requestedBy: { host: 'pi' }, cwd, timeoutMs: 1000 });
  expect(result).toMatchObject({ kind: 'success', output: { status: { state: 'fresh' } } });
}

async function getRecommendations(cwd: string): Promise<Record<string, unknown>> {
  const result = await dispatchExtensionAction(load(), { actionId: 'eforge-plan:get-recommendations', input: {}, requestedBy: { host: 'pi' }, cwd, timeoutMs: 1000 });
  expect(result.kind).toBe('success');
  if (result.kind !== 'success') throw new Error(result.message);
  return result.output as Record<string, unknown>;
}

function completedRecommendationTask(taskId: string, itemId = 'item-one'): ExtensionAgentTaskRecord {
  return parseExtensionAgentTaskRecord({
    taskId,
    kind: 'eforge-plan.planning-draft',
    status: 'completed',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:01.000Z',
    startedAt: '2026-01-01T00:00:00.000Z',
    completedAt: '2026-01-01T00:00:01.000Z',
    result: { summary: 'Generated recommendations.', assumptionsOpenQuestions: [], recommendations: validModel(itemId) },
  });
}

async function startRefresh(cwd: string, taskId: string): Promise<void> {
  const queued = parseExtensionAgentTaskRecord({ taskId, kind: 'eforge-plan.planning-draft', status: 'queued', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' });
  const result = await dispatchExtensionAction(load(), {
    actionId: 'eforge-plan:refresh-recommendations',
    input: {},
    requestedBy: { host: 'pi' },
    cwd,
    timeoutMs: 1000,
    agentTasks: () => ({
      async start() { return { task: queued }; },
      async get() { throw new Error('unexpected get before applying refresh'); },
      async cancel() { throw new Error('unexpected cancel'); },
    }),
  });
  expect(result).toMatchObject({ kind: 'success', output: { task: { taskId } } });
}

describe('recommendation invalidation', () => {
  it('marks recommendations stale after an open backlog item update without rewriting current.json or the legacy recommendation file', async () => {
    await withTempProject(async (cwd) => {
      await seedBacklog(cwd);
      await putBaseline(cwd);
      const beforeCurrent = await readFile(resolveRecommendationsPathForCwd(cwd), 'utf-8');

      const update = await dispatchExtensionAction(load(), {
        actionId: 'eforge-plan:update-item',
        input: { id: 'item-one', tags: ['changed'] },
        requestedBy: { host: 'pi' },
        cwd,
        timeoutMs: 1000,
      });
      expect(update).toMatchObject({ kind: 'success' });

      const output = await getRecommendations(cwd);
      expect(output.status).toMatchObject({ state: 'stale' });
      expect(JSON.stringify(output.status)).toMatch(/backlog|update-item|item-one|mutation/i);
      expect(await readFile(resolveRecommendationsPathForCwd(cwd), 'utf-8')).toBe(beforeCurrent);
      expect(existsSync(join(cwd, '.backlog', 'recommendations.json'))).toBe(false);
    });
  });

  it('marks recommendations stale after capture, epic, item update, item promotion, and selection promotion mutations', async () => {
    const cases: Array<{ name: string; prepare?: (cwd: string) => Promise<void>; actionId: string; input: Record<string, unknown>; match: RegExp }> = [
      { name: 'capture', actionId: 'eforge-plan:capture-item', input: { id: 'captured', title: 'Add captured work item', claim: 'Add a captured work item so recommendation invalidation covers capture mutations.', acceptanceCriteria: 'The capture action succeeds and recommendation status records a stale backlog mutation.' }, match: /capture-item|captured|backlog|mutation/i },
      { name: 'epic', actionId: 'eforge-plan:upsert-epic', input: { id: 'epic-one', title: 'Epic One', body: '# Epic One\n\nChanged.\n' }, match: /upsert-epic|epic-one|backlog|mutation/i },
      { name: 'update', actionId: 'eforge-plan:update-item', input: { id: 'item-one', priority: 'high' }, match: /update-item|item-one|backlog|mutation/i },
      { name: 'promote item', actionId: 'eforge-plan:promote-item', input: { itemId: 'item-one', session: 'session-one' }, match: /promote-item|item-one|backlog|mutation/i },
      { name: 'promote selection', actionId: 'eforge-plan:promote-selection', input: { itemIds: ['item-one'], session: 'session-selection', title: 'Selection' }, match: /promote-selection|item-one|backlog|mutation/i },
    ];

    for (const entry of cases) {
      await withTempProject(async (cwd) => {
        await seedBacklog(cwd);
        await putBaseline(cwd);
        const beforeCurrent = await readFile(resolveRecommendationsPathForCwd(cwd), 'utf-8');
        if (entry.prepare !== undefined) await entry.prepare(cwd);
        const result = await dispatchExtensionAction(load(), { actionId: entry.actionId, input: entry.input, requestedBy: { host: 'pi' }, cwd, timeoutMs: 1000 });
        expect(result.kind, entry.name).toBe('success');
        const status = (await getRecommendations(cwd)).status;
        expect(status, entry.name).toMatchObject({ state: 'stale' });
        expect(JSON.stringify(status), entry.name).toMatch(entry.match);
        expect(await readFile(resolveRecommendationsPathForCwd(cwd), 'utf-8')).toBe(beforeCurrent);
      });
    }
  }, 10_000);

  it('records lifecycle stale reasons for correlated enqueue, queue PRD, session, landing, and auto-merge updates', async () => {
    const events = [
      { event: { type: 'enqueue:start', source: '/project/.eforge/session-plans/session-one.md', timestamp: '2026-01-01T00:00:00.000Z' }, match: /enqueue|session-one|item-one|lifecycle/i },
      { event: { type: 'queue:prd:complete', prdId: 'prd-one', status: 'completed', timestamp: '2026-01-01T00:00:00.000Z' }, match: /queue|prd-one|item-one|lifecycle/i },
      { event: { type: 'session:end', runId: 'run-one', sessionId: 'build-session-one', timestamp: '2026-01-01T00:00:00.000Z' }, match: /session|run-one|item-one|lifecycle/i },
      { event: { type: 'landing:complete', action: 'merge', featureBranch: 'feature/one', commitSha: 'commit-one', timestamp: '2026-01-01T00:00:00.000Z' }, match: /landing:complete|feature\/one|item-one|lifecycle/i },
      { event: { type: 'landing:auto-merge:complete', featureBranch: 'feature/one', commitSha: 'commit-one', timestamp: '2026-01-01T00:00:00.000Z' }, match: /auto-merge|feature\/one|item-one|lifecycle/i },
    ];

    for (const { event, match } of events) {
      await withTempProject(async (cwd) => {
        await seedBacklog(cwd);
        await putBaseline(cwd);
        const trace = createTraceSidecar('item-one', 'epic-one');
        trace.promotedSessionPlans.push({ session: 'session-one', path: '/project/.eforge/session-plans/session-one.md', status: 'ready' });
        trace.queuePrds.push({ prdId: 'prd-one', status: 'queued' });
        trace.buildRunIds = ['run-one'];
        trace.buildRuns.push({ runId: 'run-one', sessionId: 'build-session-one', status: 'running' });
        trace.buildSessionIds = ['build-session-one'];
        trace.landingResults.push({ featureBranch: 'feature/one', commitSha: 'commit-one', status: 'started' });
        await writeTraceSidecar(cwd, trace);

        const beforeTrace = JSON.stringify(await readTraceSidecar(cwd, 'item-one'));
        const beforeCurrent = await readFile(resolveRecommendationsPathForCwd(cwd), 'utf-8');
        await invokeRegisteredHook(cwd, event);

        expect(JSON.stringify(await readTraceSidecar(cwd, 'item-one'))).toBe(beforeTrace);
        const status = (await getRecommendations(cwd)).status;
        expect(status).toMatchObject({ state: 'stale' });
        expect(JSON.stringify(status)).toMatch(match);
        expect(await readFile(resolveRecommendationsPathForCwd(cwd), 'utf-8')).toBe(beforeCurrent);
      });
    }
  });

  it('records structured lifecycle reason fields after correlated lifecycle mutation', async () => {
    await withTempProject(async (cwd) => {
      await seedBacklog(cwd);
      await putBaseline(cwd);
      const trace = createTraceSidecar('item-one', 'epic-one');
      trace.buildRunIds = ['run-one'];
      trace.buildRuns.push({ runId: 'run-one', sessionId: 'build-session-one', status: 'running' });
      trace.buildSessionIds = ['build-session-one'];
      await writeTraceSidecar(cwd, trace);
      const beforeTrace = JSON.stringify(await readTraceSidecar(cwd, 'item-one'));

      await invokeRegisteredHook(cwd, {
        type: 'session:end',
        runId: 'run-one',
        sessionId: 'build-session-one',
        timestamp: '2026-01-01T00:00:00.000Z',
      });

      expect(JSON.stringify(await readTraceSidecar(cwd, 'item-one'))).toBe(beforeTrace);
      const output = await getRecommendations(cwd);
      const status = output.status as { state?: unknown; reasons?: Array<Record<string, unknown>>; staleReasons?: Array<Record<string, unknown>> };
      const reason = status.reasons?.find((entry) => entry.eventType === 'session:end');
      expect(status.state).toBe('stale');
      expect(reason).toMatchObject({
        eventType: 'session:end',
        itemIds: ['item-one'],
        correlationKind: 'single',
        timestamp: '2026-01-01T00:00:00.000Z',
        code: 'lifecycle:session:end',
      });
      expect(String(reason?.summary)).toContain('single lifecycle update session:end for item-one');
      expect(reason?.refs).toEqual(expect.arrayContaining(['run-one', 'build-session-one']));
      expect(status.staleReasons).toEqual(status.reasons);
    });
  });

  it('leaves freshness metadata byte-for-byte unchanged for uncorrelated or ambiguous lifecycle events', async () => {
    for (const traces of [['item-one'], ['item-one', 'item-two']] as const) {
      await withTempProject(async (cwd) => {
        await seedBacklog(cwd);
        await putBaseline(cwd);
        for (const itemId of traces) {
          const trace = createTraceSidecar(itemId);
          trace.queuePrds.push({ prdId: 'shared-prd', status: 'queued' });
          if (traces.length > 1) trace.lastEvent = { id: 'shared-event' };
          await writeTraceSidecar(cwd, trace);
        }
        const statusPath = resolveRecommendationStatusPathForCwd(cwd);
        const before = await readFile(statusPath, 'utf-8');
        const event = traces.length === 1
          ? { type: 'landing:complete', action: 'merge', featureBranch: 'unmatched', commitSha: 'none', timestamp: '2026-01-01T00:00:00.000Z' }
          : { type: 'enqueue:complete', id: 'shared-event', timestamp: '2026-01-01T00:00:00.000Z' };

        await invokeRegisteredHook(cwd, event);

        expect(await readFile(statusPath, 'utf-8')).toBe(before);
      });
    }
  });

  it('does not expose daemon agent task APIs to lifecycle hooks', async () => {
    await withTempProject(async (cwd) => {
      await seedBacklog(cwd);
      await putBaseline(cwd);
      const trace = createTraceSidecar('item-one');
      trace.landingResults.push({ featureBranch: 'feature/one', status: 'started' });
      await writeTraceSidecar(cwd, trace);

      await invokeRegisteredHook(cwd, { type: 'landing:complete', action: 'merge', featureBranch: 'feature/one', timestamp: '2026-01-01T00:00:00.000Z' }, true);

      expect(await readTraceSidecar(cwd, 'item-one')).toBeDefined();
    });
  });

  it('applies completed recommendation-only refresh tasks as fresh for matching fingerprints and stale for drifted fingerprints', async () => {
    await withTempProject(async (cwd) => {
      await seedBacklog(cwd);
      await putBaseline(cwd);
      await startRefresh(cwd, 'refresh-match');
      const freshApply = await dispatchExtensionAction(load(), {
        actionId: 'eforge-plan:apply-planning-agent-task-result',
        input: { taskId: 'refresh-match', applyRecommendations: true },
        requestedBy: { host: 'pi' },
        cwd,
        timeoutMs: 3000,
        agentTasks: () => ({
          async start() { throw new Error('apply must not start tasks'); },
          async get() { return { task: completedRecommendationTask('refresh-match') }; },
          async cancel() { throw new Error('unexpected cancel'); },
        }),
      });
      expect(freshApply).toMatchObject({ kind: 'success', output: { recommendations: { status: { state: 'fresh' } } } });

      await startRefresh(cwd, 'refresh-drift');
      updateCanonicalBacklogItem(cwd, 'item-two', { body: '# Item Two\n\n## Claim\n\nDrifted after refresh.\n' });
      const driftApply = await dispatchExtensionAction(load(), {
        actionId: 'eforge-plan:apply-planning-agent-task-result',
        input: { taskId: 'refresh-drift', applyRecommendations: true },
        requestedBy: { host: 'pi' },
        cwd,
        timeoutMs: 3000,
        agentTasks: () => ({
          async start() { throw new Error('apply must not start tasks'); },
          async get() { return { task: completedRecommendationTask('refresh-drift') }; },
          async cancel() { throw new Error('unexpected cancel'); },
        }),
      });
      expect(driftApply).toMatchObject({ kind: 'success', output: { recommendations: { status: { state: 'stale' } } } });
      expect(JSON.stringify(driftApply)).toMatch(/drift|fingerprint|source/i);
      expect(existsSync(join(cwd, '.backlog', 'recommendations.json'))).toBe(false);
    });
  });

  it('rejects completed recommendation-only refresh tasks with unknown refs before current.json changes', async () => {
    await withTempProject(async (cwd) => {
      await seedBacklog(cwd);
      await putBaseline(cwd);
      await startRefresh(cwd, 'refresh-unknown-ref');
      const before = await readFile(resolveRecommendationsPathForCwd(cwd), 'utf-8');

      const result = await dispatchExtensionAction(load(), {
        actionId: 'eforge-plan:apply-planning-agent-task-result',
        input: { taskId: 'refresh-unknown-ref', applyRecommendations: true },
        requestedBy: { host: 'pi' },
        cwd,
        timeoutMs: 1000,
        agentTasks: () => ({
          async start() { throw new Error('apply must not start tasks'); },
          async get() { return { task: completedRecommendationTask('refresh-unknown-ref', 'missing-item') }; },
          async cancel() { throw new Error('unexpected cancel'); },
        }),
      });

      expect(result.kind).toBe('invalid-input');
      expect(JSON.stringify(result)).toMatch(/missing-item|unknown|existing item id/i);
      expect(await readFile(resolveRecommendationsPathForCwd(cwd), 'utf-8')).toBe(before);
    });
  });
});

async function invokeRegisteredHook(cwd: string, event: Record<string, unknown>, hostileAgentTasks = false): Promise<void> {
  const state = loadState();
  const hook = state.eventHooks.find((entry) => entry.value.pattern === event.type);
  expect(hook, `missing hook for ${String(event.type)}`).toBeDefined();
  const ctx: Record<string, unknown> = {
    event,
    paths: createEforgeProjectPaths({ cwd, extensionName: 'eforge-plan' }),
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    exec: { async run() { return { stdout: cwd, stderr: '', exitCode: 0 }; } },
  };
  if (hostileAgentTasks) {
    Object.defineProperty(ctx, 'agentTasks', { get() { throw new Error('lifecycle hooks must not access daemon agent task APIs'); } });
  }
  await hook!.value.handler(event, ctx as unknown as EventHookContext);
}
