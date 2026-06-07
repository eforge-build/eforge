import { mkdir, mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createSessionPlanningWorkflowAdapter } from '../../../../packages/input/src/index.js';
import { dispatchExtensionAction } from '../../../../packages/engine/src/extensions/action-runtime.js';
import { createExtensionRecorder } from '../../../../packages/engine/src/extensions/recorder.js';
import type { NativeExtensionRecorderState, NativeExtensionRegistry } from '../../../../packages/engine/src/extensions/types.js';
import { parseExtensionAgentTaskRecord, type ExtensionAgentTaskRecord } from '../../../../packages/client/src/extension-agent-tasks.js';
import eforgePlanExtension from '../index.js';
import { readBacklogItem, writeBacklogEpic, writeBacklogItem } from '../markdown-store.js';
import { createEmptyRecommendationModel, readRecommendations } from '../recommendations-store.js';

async function withTempProject<T>(fn: (cwd: string) => Promise<T>): Promise<T> {
  const cwd = await mkdtemp(join(tmpdir(), 'eforge-plan-agent-task-'));
  try { return await fn(cwd); } finally { await rm(cwd, { recursive: true, force: true }); }
}

function load(): NativeExtensionRegistry {
  const { api, state } = createExtensionRecorder('eforge-plan', '/project/eforge/extensions/eforge-plan/index.ts');
  eforgePlanExtension(api as never);
  expect(state.diagnostics).toEqual([]);
  return registryFromRecorderState(state);
}

function registryFromRecorderState(state: NativeExtensionRecorderState): NativeExtensionRegistry {
  return { ...state, extensions: [], candidates: [] };
}

function runningTask(taskId = 'task-running'): ExtensionAgentTaskRecord {
  return { taskId, kind: 'eforge-plan.planning-draft', status: 'running', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', startedAt: '2026-01-01T00:00:00.000Z' };
}

function completedTask(overrides: Partial<ExtensionAgentTaskRecord> = {}): ExtensionAgentTaskRecord {
  return parseExtensionAgentTaskRecord({
    taskId: 'task-complete',
    kind: 'eforge-plan.planning-draft',
    status: 'completed',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:01.000Z',
    startedAt: '2026-01-01T00:00:00.000Z',
    completedAt: '2026-01-01T00:00:01.000Z',
    result: {
      summary: 'Generated planning output.',
      assumptionsOpenQuestions: [],
      recommendations: { ...createEmptyRecommendationModel(), readyCandidates: [{ itemId: 'item-one', rationale: 'Ready.' }] },
      handoffDrafts: [{ selection: { itemIds: ['item-one'], status: 'active' }, session: 'task-handoff' }],
      sessionPlanPatch: { sections: [{ dimension: 'scope', content: 'Generated scope.' }] },
    },
    ...overrides,
  });
}

describe('planning agent task actions', () => {
  it('prepares planner context before starting a daemon-owned planning task', async () => {
    await withTempProject(async (cwd) => {
      await mkdir(join(cwd, 'docs'), { recursive: true });
      await writeBacklogItem(cwd, { id: 'item-one', status: 'planned', body: '# Item One\n\n## Claim\n\nPlan it.\n' });
      const calls: Array<{ kind: string; input: Record<string, unknown> }> = [];
      const result = await dispatchExtensionAction(load(), {
        actionId: 'eforge-plan:start-planning-agent-task',
        input: { userGoal: 'Plan item one', itemIds: ['item-one'], includeRoadmap: true },
        requestedBy: { host: 'console' },
        cwd,
        timeoutMs: 1000,
        agentTasks: () => ({
          async start(request) {
            calls.push(request as { kind: string; input: Record<string, unknown> });
            const source = JSON.parse(String(request.input.sourceText));
            expect(source).toMatchObject({ userGoal: 'Plan item one', context: { schemaVersion: 1, selection: { itemIds: ['item-one'] } } });
            expect(source.context.items[0]).toMatchObject({ id: 'item-one', sections: { Claim: 'Plan it.' } });
            return { task: runningTask('task-started') };
          },
          async get() { throw new Error('unexpected get'); },
          async cancel() { throw new Error('unexpected cancel'); },
        }),
      });
      expect(result).toMatchObject({ kind: 'success', output: { task: { taskId: 'task-started' } } });
      expect(calls).toEqual([expect.objectContaining({ kind: 'eforge-plan.planning-draft', input: expect.objectContaining({ topic: 'Plan item one' }) })]);
    });
  });

  it('bounds planner context before starting a daemon-owned planning task', async () => {
    await withTempProject(async (cwd) => {
      const longBody = `# Long\n\n## Claim\n\n${'x'.repeat(5000)}\n`;
      const shortBody = '# Short\n\n## Claim\n\nSmall.\n';
      for (let index = 0; index < 30; index += 1) {
        await writeBacklogItem(cwd, { id: `item-${index}`, status: 'planned', body: index === 0 ? longBody : shortBody });
      }
      for (let index = 0; index < 12; index += 1) {
        await writeBacklogEpic(cwd, { id: `epic-${index}`, status: 'planned', body: shortBody });
      }
      let sourceText = '';
      const result = await dispatchExtensionAction(load(), {
        actionId: 'eforge-plan:start-planning-agent-task',
        input: { userGoal: 'Bound context', includeRoadmap: false },
        requestedBy: { host: 'console' },
        cwd,
        timeoutMs: 1000,
        agentTasks: () => ({
          async start(request) { sourceText = String(request.input.sourceText); return { task: runningTask('task-bounded') }; },
          async get() { throw new Error('unexpected get'); },
          async cancel() { throw new Error('unexpected cancel'); },
        }),
      });
      const parsed = JSON.parse(sourceText);
      expect(result).toMatchObject({ kind: 'success' });
      expect(sourceText.length).toBeLessThanOrEqual(60000);
      expect(parsed.context.items).toHaveLength(25);
      expect(parsed.context.epics).toHaveLength(10);
      expect(parsed.truncation).toMatchObject({ omittedItems: 5, omittedEpics: 2 });
      expect(parsed.truncation.truncatedStrings).toBeGreaterThan(0);
      expect(sourceText).toContain('…[truncated]');
    });
  });

  it('does not start a daemon task when planner selection is invalid', async () => {
    await withTempProject(async (cwd) => {
      let starts = 0;
      const result = await dispatchExtensionAction(load(), {
        actionId: 'eforge-plan:start-planning-agent-task',
        input: { userGoal: 'Missing item', itemIds: ['missing-item'] },
        requestedBy: { host: 'console' },
        cwd,
        timeoutMs: 1000,
        agentTasks: () => ({
          async start() { starts += 1; throw new Error('unexpected start'); },
          async get() { throw new Error('unexpected get'); },
          async cancel() { throw new Error('unexpected cancel'); },
        }),
      });
      expect(result.kind).toBe('handler-error');
      expect(starts).toBe(0);
    });
  });

  it('delegates get and cancel to the daemon task API', async () => {
    await withTempProject(async (cwd) => {
      const calls: string[] = [];
      const registry = load();
      const agentTasks = () => ({
        async start() { throw new Error('unexpected start'); },
        async get(taskId: string) { calls.push(`get:${taskId}`); return { task: runningTask(taskId) }; },
        async cancel(taskId: string, reason?: string) { calls.push(`cancel:${taskId}:${reason}`); return { task: { ...runningTask(taskId), status: 'cancelled' as const, cancelledAt: '2026-01-01T00:00:01.000Z', errorMessage: reason } }; },
      });
      const getResult = await dispatchExtensionAction(registry, { actionId: 'eforge-plan:get-planning-agent-task', input: { taskId: 'task-one' }, requestedBy: { host: 'console' }, cwd, timeoutMs: 1000, agentTasks });
      const cancelResult = await dispatchExtensionAction(registry, { actionId: 'eforge-plan:cancel-planning-agent-task', input: { taskId: 'task-one', reason: 'user' }, requestedBy: { host: 'console' }, cwd, timeoutMs: 1000, agentTasks });
      expect(getResult).toMatchObject({ kind: 'success', output: { task: { taskId: 'task-one', status: 'running' } } });
      expect(cancelResult).toMatchObject({ kind: 'success', output: { task: { taskId: 'task-one', status: 'cancelled', errorMessage: 'user' } } });
      expect(calls).toEqual(['get:task-one', 'cancel:task-one:user']);
    });
  });

  it('applies selected recommendations and session-plan sections without enqueueing builds or shipping backlog items', async () => {
    await withTempProject(async (cwd) => {
      await writeBacklogItem(cwd, { id: 'item-one', status: 'planned', body: '# Item One\n\n## Claim\n\nPlan it.\n' });
      await createSessionPlanningWorkflowAdapter().flat.create({ cwd, session: 'session-one', topic: 'Item one' });
      const result = await dispatchExtensionAction(load(), {
        actionId: 'eforge-plan:apply-planning-agent-task-result',
        input: { taskId: 'task-complete', applyRecommendations: true, applySessionPlanDrafts: [{ session: 'session-one', sections: ['scope'] }] },
        requestedBy: { host: 'console' },
        cwd,
        timeoutMs: 1000,
        agentTasks: () => ({
          async start() { throw new Error('unexpected start'); },
          async get() { return { task: completedTask() }; },
          async cancel() { throw new Error('unexpected cancel'); },
        }),
      });
      expect(result).toMatchObject({ kind: 'success', output: { applied: { recommendations: true, sessionPlanSections: 1 } } });
      expect(await readRecommendations(cwd)).toMatchObject({ readyCandidates: [{ itemId: 'item-one' }] });
      const markdown = await readFile(join(cwd, '.eforge', 'session-plans', 'session-one.md'), 'utf-8');
      expect(markdown).toContain('Generated scope.');
      expect((await readBacklogItem(cwd, 'item-one'))?.status).toBe('planned');
    });
  });

  it('validates all selected task output before applying any local writes', async () => {
    await withTempProject(async (cwd) => {
      await createSessionPlanningWorkflowAdapter().flat.create({ cwd, session: 'session-one', topic: 'Item one' });
      const result = await dispatchExtensionAction(load(), {
        actionId: 'eforge-plan:apply-planning-agent-task-result',
        input: { taskId: 'task-complete', applyRecommendations: true, applySessionPlanDrafts: [{ session: 'session-one', sections: ['missing-section'] }] },
        requestedBy: { host: 'console' },
        cwd,
        timeoutMs: 1000,
        agentTasks: () => ({
          async start() { throw new Error('unexpected start'); },
          async get() { return { task: completedTask() }; },
          async cancel() { throw new Error('unexpected cancel'); },
        }),
      });
      expect(result.kind).toBe('handler-error');
      expect(await readRecommendations(cwd)).toBeNull();
    });
  });

  it('rejects apply requests without a selected generated output section', async () => {
    await withTempProject(async (cwd) => {
      for (const input of [{ taskId: 'task-complete' }, { taskId: 'task-complete', applyRecommendations: false }]) {
        const result = await dispatchExtensionAction(load(), {
          actionId: 'eforge-plan:apply-planning-agent-task-result',
          input,
          requestedBy: { host: 'console' },
          cwd,
          timeoutMs: 1000,
          agentTasks: () => ({ async start() { throw new Error('unexpected start'); }, async get() { throw new Error('unexpected get'); }, async cancel() { throw new Error('unexpected cancel'); } }),
        });
        expect(result).toMatchObject({ kind: 'handler-error' });
      }
    });
  });

  it('rejects non-completed, failed, cancelled, wrong-kind, and missing-result task records', async () => {
    await withTempProject(async (cwd) => {
      const cases: ExtensionAgentTaskRecord[] = [
        runningTask('task-running'),
        { ...runningTask('task-failed'), status: 'failed', completedAt: '2026-01-01T00:00:01.000Z', errorCode: 'failed', errorMessage: 'failed' } as ExtensionAgentTaskRecord,
        { ...runningTask('task-cancelled'), status: 'cancelled', cancelledAt: '2026-01-01T00:00:01.000Z' } as ExtensionAgentTaskRecord,
        { ...completedTask({ taskId: 'task-wrong-kind' }), kind: 'other.kind' } as unknown as ExtensionAgentTaskRecord,
        { ...completedTask({ taskId: 'task-missing-result' }), result: undefined } as unknown as ExtensionAgentTaskRecord,
      ];
      for (const task of cases) {
        const result = await dispatchExtensionAction(load(), {
          actionId: 'eforge-plan:apply-planning-agent-task-result',
          input: { taskId: task.taskId, applyRecommendations: true },
          requestedBy: { host: 'console' },
          cwd,
          timeoutMs: 1000,
          agentTasks: () => ({ async start() { throw new Error('unexpected start'); }, async get() { return { task }; }, async cancel() { throw new Error('unexpected cancel'); } }),
        });
        expect(result.kind).toBe('handler-error');
      }
    });
  });
});
