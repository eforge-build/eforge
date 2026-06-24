import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createSessionPlanningWorkflowAdapter } from '@eforge-build/input';
import { dispatchExtensionAction } from '@eforge-build/engine/extensions/action-runtime.js';
import { createExtensionRecorder } from '@eforge-build/engine/extensions/recorder.js';
import type { NativeExtensionRecorderState, NativeExtensionRegistry } from '@eforge-build/engine/extensions/types.js';
import { parseExtensionAgentTaskRecord, type ExtensionAgentTaskRecord } from '@eforge-build/client';
import eforgePlanExtension from '../index.js';
import { readBacklogItem, writeBacklogItem } from '../markdown-store.js';
import { readPlanningTaskWorkflowIndex, recordPlanningTaskWorkflowEntry } from '../planning-task-workflow-store.js';
import { readRecommendations } from '../recommendations-store.js';

async function withTempProject<T>(fn: (cwd: string) => Promise<T>): Promise<T> {
  const cwd = await mkdtemp(join(tmpdir(), 'eforge-plan-agent-task-'));
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
function creationDraftTask(taskId = 'task-creation', session = 'created-session'): ExtensionAgentTaskRecord {
  return parseExtensionAgentTaskRecord({
    taskId, kind: 'eforge-plan.planning-draft', status: 'completed', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:01.000Z', startedAt: '2026-01-01T00:00:00.000Z', completedAt: '2026-01-01T00:00:01.000Z',
    result: { summary: 'Drafted a plan.', assumptionsOpenQuestions: ['Assumes API stable.'], decision: 'ready', sessionPlanCreationDraft: { session, topic: 'Created topic', planningType: 'feature', planningDepth: 'focused', sections: [
      { dimension: 'problem-statement', content: 'The generated feature needs a clear implementation plan.' },
      { dimension: 'scope', content: 'Generated scope content.' },
      { dimension: 'acceptance-criteria', content: '- Feature session plan includes every required readiness section.' },
      { dimension: 'code-impact', content: 'Update extension apply behavior and tests.' },
      { dimension: 'design-decisions', content: 'Validate generated drafts before persistence.' },
      { dimension: 'assumptions-and-validation', content: 'Run extension action tests and type checking.' },
    ] } },
  });
}

describe('planning agent creation draft actions', () => {
  it('applies an AI creation draft to a fresh session without enqueueing builds, shipping items, or submitting the plan', async () => {
    await withTempProject(async (cwd) => {
      await writeBacklogItem(cwd, { id: 'item-one', status: 'planned', body: '# Item One\n\n## Claim\n\nPlan it.\n' });
      const task = creationDraftTask();
      const result = await dispatchExtensionAction(load(), {
        actionId: 'eforge-plan:apply-planning-agent-task-result',
        input: { taskId: 'task-creation', applySessionPlanCreationDraft: {} },
        requestedBy: { host: 'console' },
        cwd,
        timeoutMs: 1000,
        agentTasks: () => ({
          async start() { throw new Error('unexpected start'); },
          async get() { return { task }; },
          async cancel() { throw new Error('unexpected cancel'); },
        }),
      });
      expect(result).toMatchObject({ kind: 'success', output: { sessionPlanCreationDraft: { session: 'created-session', relativePath: '.eforge/session-plans/created-session.md' } } });
      const markdown = await readFile(join(cwd, '.eforge', 'session-plans', 'created-session.md'), 'utf-8');
      expect(markdown).toContain('Generated scope content.');
      expect(markdown).not.toContain('status: submitted');
      expect((await readBacklogItem(cwd, 'item-one'))?.status).toBe('planned');
    });
  });

  it('rejects creation draft apply when the target session already exists', async () => {
    await withTempProject(async (cwd) => {
      await createSessionPlanningWorkflowAdapter().flat.create({ cwd, session: 'created-session', topic: 'Existing' });
      const task = creationDraftTask();
      const result = await dispatchExtensionAction(load(), {
        actionId: 'eforge-plan:apply-planning-agent-task-result',
        input: { taskId: 'task-creation', applyRecommendations: true, applySessionPlanCreationDraft: {} },
        requestedBy: { host: 'console' },
        cwd,
        timeoutMs: 1000,
        agentTasks: () => ({
          async start() { throw new Error('unexpected start'); },
          async get() { return { task }; },
          async cancel() { throw new Error('unexpected cancel'); },
        }),
      });
      expect(result.kind).toBe('invalid-input');
      expect(await readRecommendations(cwd)).toBeNull();
    });
  });

  it('marks a workflow-indexed session-plan creation draft applied and hides it from normal task lists', async () => {
    await withTempProject(async (cwd) => {
      await writeBacklogItem(cwd, { id: 'item-one', status: 'planned', body: '# Item One\n\n## Claim\n\nPlan it.\n' });
      await recordPlanningTaskWorkflowEntry(cwd, { taskId: 'task-creation', createdAt: '2026-01-01T00:00:00.000Z', originalRequest: '', derivedRequest: 'Draft a session plan for Item One.', selection: { itemIds: ['item-one'] }, requestedOutputSections: ['sessionPlanCreationDraft'] });
      const task = creationDraftTask();
      const registry = load();
      const agentTasks = () => ({
        async start() { throw new Error('unexpected start'); },
        async get() { return { task }; },
        async cancel() { throw new Error('unexpected cancel'); },
      });
      const applied = await dispatchExtensionAction(registry, { actionId: 'eforge-plan:apply-planning-agent-task-result', input: { taskId: 'task-creation', applySessionPlanCreationDraft: {} }, requestedBy: { host: 'console' }, cwd, timeoutMs: 1000, agentTasks });
      expect(applied).toMatchObject({ kind: 'success', output: { sessionPlanCreationDraft: { session: 'created-session' } } });
      const entry = (await readPlanningTaskWorkflowIndex(cwd)).entries.find((candidate) => candidate.taskId === 'task-creation');
      expect(entry?.appliedAt).toEqual(expect.any(String));
      const listed = await dispatchExtensionAction(registry, { actionId: 'eforge-plan:list-planning-agent-tasks', input: {}, requestedBy: { host: 'console' }, cwd, timeoutMs: 1000, agentTasks });
      expect(listed).toMatchObject({ kind: 'success', output: { tasks: [] } });
    });
  });

  it('rejects reapplying an already-consumed creation draft even with a different session override', async () => {
    await withTempProject(async (cwd) => {
      await recordPlanningTaskWorkflowEntry(cwd, { taskId: 'task-creation', createdAt: '2026-01-01T00:00:00.000Z', originalRequest: '', derivedRequest: 'Draft a session plan.', selection: {}, requestedOutputSections: ['sessionPlanCreationDraft'], appliedAt: '2026-01-01T00:00:02.000Z' });
      const result = await dispatchExtensionAction(load(), {
        actionId: 'eforge-plan:apply-planning-agent-task-result',
        input: { taskId: 'task-creation', applySessionPlanCreationDraft: { session: 'different-session' } },
        requestedBy: { host: 'console' },
        cwd,
        timeoutMs: 1000,
        agentTasks: () => ({ async start() { throw new Error('unexpected start'); }, async get() { return { task: creationDraftTask() }; }, async cancel() { throw new Error('unexpected cancel'); } }),
      });
      expect(result.kind).toBe('invalid-input');
      await expect(readFile(join(cwd, '.eforge', 'session-plans', 'different-session.md'), 'utf-8')).rejects.toThrow();
    });
  });

  it('leaves a failed creation apply visible and manually dismissible', async () => {
    await withTempProject(async (cwd) => {
      await createSessionPlanningWorkflowAdapter().flat.create({ cwd, session: 'created-session', topic: 'Existing' });
      await recordPlanningTaskWorkflowEntry(cwd, { taskId: 'task-creation', createdAt: '2026-01-01T00:00:00.000Z', originalRequest: '', derivedRequest: 'Draft a session plan.', selection: {}, requestedOutputSections: ['sessionPlanCreationDraft'] });
      const registry = load();
      const agentTasks = () => ({ async start() { throw new Error('unexpected start'); }, async get() { return { task: creationDraftTask() }; }, async cancel() { throw new Error('unexpected cancel'); } });
      const failed = await dispatchExtensionAction(registry, { actionId: 'eforge-plan:apply-planning-agent-task-result', input: { taskId: 'task-creation', applySessionPlanCreationDraft: {} }, requestedBy: { host: 'console' }, cwd, timeoutMs: 1000, agentTasks });
      expect(failed.kind).toBe('invalid-input');
      expect((await readPlanningTaskWorkflowIndex(cwd)).entries[0]?.appliedAt).toBeUndefined();
      const listed = await dispatchExtensionAction(registry, { actionId: 'eforge-plan:list-planning-agent-tasks', input: {}, requestedBy: { host: 'console' }, cwd, timeoutMs: 1000, agentTasks });
      expect(listed).toMatchObject({ kind: 'success', output: { tasks: [expect.objectContaining({ entry: expect.objectContaining({ taskId: 'task-creation' }) })] } });
      const removed = await dispatchExtensionAction(registry, { actionId: 'eforge-plan:remove-planning-agent-task', input: { taskId: 'task-creation' }, requestedBy: { host: 'console' }, cwd, timeoutMs: 1000, agentTasks });
      expect(removed).toMatchObject({ kind: 'success', output: { removed: true } });
    });
  });
});
