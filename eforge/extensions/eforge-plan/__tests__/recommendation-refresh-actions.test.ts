import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { dispatchExtensionAction } from '@eforge-build/engine/extensions/action-runtime.js';
import { createExtensionRecorder } from '@eforge-build/engine/extensions/recorder.js';
import type { NativeExtensionRecorderState, NativeExtensionRegistry } from '@eforge-build/engine/extensions/types.js';
import { parseExtensionAgentTaskRecord, type ExtensionAgentTaskRecord } from '@eforge-build/client';
import eforgePlanExtension from '../index.js';
import { writeBacklogEpic, writeBacklogItem } from '../markdown-store.js';
import { createEmptyRecommendationModel, writeRecommendations } from '../recommendations-store.js';
import { createTraceSidecar, writeTraceSidecar } from '../trace-store.js';
import { readPlanningTaskWorkflowIndex } from '../planning-task-workflow-store.js';

async function withTempProject<T>(fn: (cwd: string) => Promise<T>): Promise<T> {
  const cwd = await mkdtemp(join(tmpdir(), 'eforge-plan-refresh-actions-'));
  try { return await fn(cwd); } finally { await rm(cwd, { recursive: true, force: true }); }
}

function load(): NativeExtensionRegistry {
  const { api, state } = createExtensionRecorder('eforge-plan', '/project/eforge/extensions/eforge-plan/index.ts');
  eforgePlanExtension(api as never);
  expect(state.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')).toEqual([]);
  return registryFromRecorderState(state);
}

function registryFromRecorderState(state: NativeExtensionRecorderState): NativeExtensionRegistry {
  return { ...state, extensions: [], candidates: [] };
}

function task(taskId: string, status: ExtensionAgentTaskRecord['status']): ExtensionAgentTaskRecord {
  const base = { taskId, kind: 'eforge-plan.planning-draft', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:01.000Z' };
  if (status === 'queued') return parseExtensionAgentTaskRecord({ ...base, status });
  if (status === 'running') return parseExtensionAgentTaskRecord({ ...base, status, startedAt: '2026-01-01T00:00:00.000Z' });
  if (status === 'completed') return parseExtensionAgentTaskRecord({ ...base, status, startedAt: '2026-01-01T00:00:00.000Z', completedAt: '2026-01-01T00:00:01.000Z', result: { summary: 'done', assumptionsOpenQuestions: [], recommendations: createEmptyRecommendationModel() } });
  if (status === 'failed') return parseExtensionAgentTaskRecord({ ...base, status, startedAt: '2026-01-01T00:00:00.000Z', completedAt: '2026-01-01T00:00:01.000Z', errorCode: 'failed', errorMessage: 'failed' });
  return parseExtensionAgentTaskRecord({ ...base, status, startedAt: '2026-01-01T00:00:00.000Z', cancelledAt: '2026-01-01T00:00:01.000Z', errorMessage: 'cancelled' });
}

async function seedRecommendationContext(cwd: string): Promise<void> {
  await mkdir(join(cwd, 'docs'), { recursive: true });
  await writeFile(join(cwd, 'docs', 'roadmap.md'), '# Roadmap\n\n## Next\n\nPrioritize trace-aware planning.\n');
  await writeBacklogEpic(cwd, { id: 'epic-one', status: 'planned', body: '# Epic One\n\n## Outcome\n\nCoordinate refresh work.\n' });
  await writeBacklogItem(cwd, { id: 'item-zero', status: 'planned', body: '# Item Zero\n\n## Claim\n\nDependency.\n' });
  await writeBacklogItem(cwd, { id: 'item-one', status: 'candidate', epic: 'epic-one', depends_on: ['item-zero'], body: '# Item One\n\n## Claim\n\nRefresh recommendations.\n\n## Blockers\n\nNeeds dependency.\n' });
  await writeRecommendations(cwd, { ...createEmptyRecommendationModel(), recommendedNextSequence: [{ itemId: 'item-one', rationale: 'Current recommendation.' }] });
  await writeTraceSidecar(cwd, { ...createTraceSidecar('item-one', 'epic-one'), buildRunIds: ['run-one'], buildRuns: [{ runId: 'run-one', sessionId: 'session-one', status: 'running' }] });
}

async function refresh(cwd: string, agentTasks: () => { start(request: Record<string, unknown>): Promise<{ task: ExtensionAgentTaskRecord }>; get(taskId: string): Promise<{ task: ExtensionAgentTaskRecord }>; cancel(taskId: string, reason?: string): Promise<{ task: ExtensionAgentTaskRecord }> }) {
  return dispatchExtensionAction(load(), {
    actionId: 'eforge-plan:refresh-recommendations',
    input: {},
    requestedBy: { host: 'pi' },
    cwd,
    timeoutMs: 1000,
    agentTasks,
  });
}

describe('recommendation refresh action', () => {
  it('starts a recommendation-only planning task with bounded source context and workflow metadata', async () => {
    await withTempProject(async (cwd) => {
      await seedRecommendationContext(cwd);
      const starts: Array<{ task?: { id: string }; input: Record<string, unknown> }> = [];
      const result = await refresh(cwd, () => ({
        async start(request) { starts.push(request as { task?: { id: string }; input: Record<string, unknown> }); return { task: task('refresh-one', 'queued') }; },
        async get() { throw new Error('no active task should exist before first refresh'); },
        async cancel() { throw new Error('unexpected cancel'); },
      }));

      expect(result).toMatchObject({ kind: 'success', output: { task: { taskId: 'refresh-one', status: 'queued' } } });
      expect(starts).toHaveLength(1);
      expect(starts[0]).toMatchObject({ task: { id: 'recommendation-refresh' }, input: expect.objectContaining({ requestedOutputSections: ['recommendations'] }) });
      const input = starts[0]!.input;
      expect(input.includeRoadmap).toBe(true);
      const sourceText = String(input.sourceText);
      expect(sourceText.length).toBeLessThanOrEqual(60000);
      expect(sourceText).toMatch(/item-one|Epic One|Needs dependency|Roadmap|Current recommendation|run-one|sourceFingerprint|roadmapContext|localSteering|discoveredContextSources/);

      const index = await readPlanningTaskWorkflowIndex(cwd);
      expect(index.entries).toHaveLength(1);
      expect(index.entries[0]).toMatchObject({ taskId: 'refresh-one', requestedOutputSections: ['recommendations'], includeRoadmap: true, purpose: 'recommendation-refresh' });
      expect(JSON.stringify(index.entries[0])).toMatch(/[a-f0-9]{64}/);
    });
  });

  it('reuses a queued or running refresh for the same source fingerprint instead of starting another task', async () => {
    for (const status of ['queued', 'running'] as const) {
      await withTempProject(async (cwd) => {
        await seedRecommendationContext(cwd);
        let starts = 0;
        const active = task(`refresh-${status}`, status);
        const agentTasks = () => ({
          async start() { starts += 1; return { task: active }; },
          async get(taskId: string) { expect(taskId).toBe(active.taskId); return { task: active }; },
          async cancel() { throw new Error('unexpected cancel'); },
        });

        expect(await refresh(cwd, agentTasks)).toMatchObject({ kind: 'success' });
        const second = await refresh(cwd, agentTasks);

        expect(second).toMatchObject({ kind: 'success', output: { task: { taskId: active.taskId, status } } });
        expect(starts).toBe(1);
      });
    }
  });

  it('starts a new refresh when the tracked task is completed, failed, cancelled, missing, or for a different fingerprint', async () => {
    for (const staleStatus of ['completed', 'failed', 'cancelled'] as const) {
      await withTempProject(async (cwd) => {
        await seedRecommendationContext(cwd);
        let sequence = 0;
        const agentTasks = () => ({
          async start() { sequence += 1; return { task: task(sequence === 1 ? 'old-refresh' : `new-after-${staleStatus}`, sequence === 1 ? 'queued' : 'running') }; },
          async get() { return { task: task('old-refresh', staleStatus) }; },
          async cancel() { throw new Error('unexpected cancel'); },
        });
        await refresh(cwd, agentTasks);
        const second = await refresh(cwd, agentTasks);
        expect(second).toMatchObject({ kind: 'success', output: { task: { taskId: `new-after-${staleStatus}` } } });
        expect(sequence).toBe(2);
      });
    }

    await withTempProject(async (cwd) => {
      await seedRecommendationContext(cwd);
      let starts = 0;
      const agentTasks = () => ({
        async start() { starts += 1; return { task: task(starts === 1 ? 'missing-refresh' : 'new-after-missing', 'queued') }; },
        async get() { throw new Error('daemon task no longer exists'); },
        async cancel() { throw new Error('unexpected cancel'); },
      });
      await refresh(cwd, agentTasks);
      expect(await refresh(cwd, agentTasks)).toMatchObject({ kind: 'success', output: { task: { taskId: 'new-after-missing' } } });
      expect(starts).toBe(2);
    });

    await withTempProject(async (cwd) => {
      await seedRecommendationContext(cwd);
      let starts = 0;
      const agentTasks = () => ({
        async start() { starts += 1; return { task: task(starts === 1 ? 'old-fingerprint' : 'new-fingerprint', 'queued') }; },
        async get(taskId: string) { return { task: task(taskId, 'queued') }; },
        async cancel() { throw new Error('unexpected cancel'); },
      });
      await refresh(cwd, agentTasks);
      await writeBacklogItem(cwd, { id: 'item-two', status: 'candidate', body: '# Item Two\n\n## Claim\n\nDifferent source fingerprint.\n' });
      expect(await refresh(cwd, agentTasks)).toMatchObject({ kind: 'success', output: { task: { taskId: 'new-fingerprint' } } });
      expect(starts).toBe(2);
    });
  });

  it('preserves refresh metadata on retry so applying drifted retry output records stale status', async () => {
    await withTempProject(async (cwd) => {
      await seedRecommendationContext(cwd);
      let startCount = 0;
      const agentTasks = () => ({
        async start() {
          startCount += 1;
          return { task: task(startCount === 1 ? 'refresh-original' : 'refresh-retry', 'queued') };
        },
        async get(taskId: string) { return { task: task(taskId, 'completed') }; },
        async cancel() { throw new Error('unexpected cancel'); },
      });
      await refresh(cwd, agentTasks);
      await writeBacklogItem(cwd, { id: 'item-two', status: 'candidate', body: '# Item Two\n\n## Claim\n\nRetry source drift.\n' });

      const retry = await dispatchExtensionAction(load(), {
        actionId: 'eforge-plan:retry-planning-agent-task',
        input: { taskId: 'refresh-original' },
        requestedBy: { host: 'pi' },
        cwd,
        timeoutMs: 1000,
        agentTasks,
      });
      expect(retry).toMatchObject({ kind: 'success', output: { entry: { purpose: 'recommendation-refresh', sourceFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/) } } });
      const retryFingerprint = (retry as { output: { entry: { sourceFingerprint: string } } }).output.entry.sourceFingerprint;
      await writeBacklogItem(cwd, { id: 'item-three', status: 'candidate', body: '# Item Three\n\n## Claim\n\nPost-retry drift.\n' });

      const applied = await dispatchExtensionAction(load(), {
        actionId: 'eforge-plan:apply-planning-agent-task-result',
        input: { taskId: 'refresh-retry', applyRecommendations: true },
        requestedBy: { host: 'pi' },
        cwd,
        timeoutMs: 1000,
        agentTasks,
      });
      expect(applied).toMatchObject({ kind: 'success', output: { recommendations: { status: { state: 'stale', lastAppliedSourceFingerprint: retryFingerprint } } } });
    });
  });

  it('includes a readable active refresh task status in get-recommendations when a tracked task is available', async () => {
    await withTempProject(async (cwd) => {
      await seedRecommendationContext(cwd);
      const active = task('refresh-active', 'running');
      const agentTasks = () => ({
        async start() { return { task: active }; },
        async get(taskId: string) { expect(taskId).toBe('refresh-active'); return { task: active }; },
        async cancel() { throw new Error('unexpected cancel'); },
      });
      await refresh(cwd, agentTasks);

      const result = await dispatchExtensionAction(load(), {
        actionId: 'eforge-plan:get-recommendations',
        input: {},
        requestedBy: { host: 'pi' },
        cwd,
        timeoutMs: 1000,
        agentTasks,
      });

      expect(result).toMatchObject({ kind: 'success', output: { activeRefreshTask: { taskId: 'refresh-active', status: 'running' } } });
    });
  });
});
