import { mkdir, mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
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
import { createEmptyRecommendationModel, readRecommendations, writeRecommendations } from '../recommendations-store.js';
import { readPlanningTaskWorkflowIndex, recordPlanningTaskWorkflowEntry } from '../planning-task-workflow-store.js';

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

function needsInputTask(taskId: string): ExtensionAgentTaskRecord {
  return parseExtensionAgentTaskRecord({
    taskId,
    kind: 'eforge-plan.planning-draft',
    status: 'completed',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:01.000Z',
    startedAt: '2026-01-01T00:00:00.000Z',
    completedAt: '2026-01-01T00:00:01.000Z',
    result: {
      summary: 'Need more detail before drafting.',
      assumptionsOpenQuestions: ['Assumes REST transport.'],
      decision: 'needs-input',
      clarificationQuestions: [{ question: 'What is the target API surface?' }],
      rationale: 'Scope is ambiguous.',
    },
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

  it('records a durable workflow index entry when starting from selected items without a user goal', async () => {
    await withTempProject(async (cwd) => {
      await writeBacklogItem(cwd, { id: 'item-one', status: 'planned', body: '# Item One\n\n## Claim\n\nPlan it.\n' });
      const result = await dispatchExtensionAction(load(), {
        actionId: 'eforge-plan:start-planning-agent-task',
        input: { itemIds: ['item-one'], includeRoadmap: false },
        requestedBy: { host: 'console' },
        cwd,
        timeoutMs: 1000,
        agentTasks: () => ({
          async start(request) {
            expect(typeof request.input.topic).toBe('string');
            expect(String(request.input.topic)).toContain('Item One');
            expect(request.input.requestedOutputSections).toEqual(['sessionPlanCreationDraft']);
            return { task: runningTask('task-derived') };
          },
          async get() { throw new Error('unexpected get'); },
          async cancel() { throw new Error('unexpected cancel'); },
        }),
      });
      expect(result.kind).toBe('success');
      // Inspect the on-disk index directly (not through the resolver the implementation
      // uses) to prove the entry is written to the required project-local extension
      // storage path rather than wherever the shared resolver happens to point.
      const indexPath = join(cwd, '.eforge', 'storage', 'extensions', 'eforge-plan', 'planning-tasks', 'index.json');
      const rawIndex = JSON.parse(await readFile(indexPath, 'utf-8')) as { entries: Array<Record<string, unknown>> };
      expect(rawIndex.entries).toHaveLength(1);
      expect(rawIndex.entries[0]).toMatchObject({
        taskId: 'task-derived',
        selection: { itemIds: ['item-one'] },
        requestedOutputSections: ['sessionPlanCreationDraft'],
        originalRequest: '',
      });
      const index = await readPlanningTaskWorkflowIndex(cwd);
      expect(index.entries).toHaveLength(1);
      const entry = index.entries[0]!;
      expect(entry.taskId).toBe('task-derived');
      expect(entry.selection.itemIds).toEqual(['item-one']);
      expect(entry.requestedOutputSections).toEqual(['sessionPlanCreationDraft']);
      expect(entry.derivedRequest).toContain('Item One');
      expect(entry.originalRequest).toBe('');
      expect(typeof entry.createdAt).toBe('string');
      expect(entry.createdAt.length).toBeGreaterThan(0);
    });
  });

  it('derives a goal from a recommendation ref and records its selection when no user goal is supplied', async () => {
    await withTempProject(async (cwd) => {
      await writeBacklogItem(cwd, { id: 'item-one', status: 'planned', body: '# Item One\n\n## Claim\n\nPlan it.\n' });
      await writeRecommendations(cwd, { ...createEmptyRecommendationModel(), recommendedNextSequence: [{ ref: 'next-one', itemId: 'item-one', rationale: 'Best next.' }] });
      const result = await dispatchExtensionAction(load(), {
        actionId: 'eforge-plan:start-planning-agent-task',
        input: { recommendationRef: 'next-one', includeRoadmap: false },
        requestedBy: { host: 'console' },
        cwd,
        timeoutMs: 1000,
        agentTasks: () => ({
          async start(request) {
            expect(String(request.input.topic)).toContain('recommendation next-one');
            expect(request.input.requestedOutputSections).toEqual(['sessionPlanCreationDraft']);
            const source = JSON.parse(String(request.input.sourceText));
            expect(source.context.selection).toMatchObject({ kind: 'recommendationRef', recommendationRef: 'next-one' });
            return { task: runningTask('task-rec') };
          },
          async get() { throw new Error('unexpected get'); },
          async cancel() { throw new Error('unexpected cancel'); },
        }),
      });
      expect(result.kind).toBe('success');
      const entry = (await readPlanningTaskWorkflowIndex(cwd)).entries[0]!;
      expect(entry.taskId).toBe('task-rec');
      expect(entry.selection.recommendationRef).toBe('next-one');
      expect(entry.requestedOutputSections).toEqual(['sessionPlanCreationDraft']);
      expect(entry.originalRequest).toBe('');
      expect(entry.derivedRequest).toContain('recommendation next-one');
    });
  });

  it('derives a goal from an epic id and records its selection when no user goal is supplied', async () => {
    await withTempProject(async (cwd) => {
      await writeBacklogEpic(cwd, { id: 'epic-one', status: 'planned', body: '# Epic One\n\n## Goal\n\nDo epic.\n' });
      await writeBacklogItem(cwd, { id: 'item-one', status: 'planned', epic: 'epic-one', body: '# Item One\n\n## Claim\n\nPlan it.\n' });
      const result = await dispatchExtensionAction(load(), {
        actionId: 'eforge-plan:start-planning-agent-task',
        input: { epicId: 'epic-one', includeRoadmap: false },
        requestedBy: { host: 'console' },
        cwd,
        timeoutMs: 1000,
        agentTasks: () => ({
          async start(request) {
            expect(String(request.input.topic)).toContain('epic epic-one');
            expect(request.input.requestedOutputSections).toEqual(['sessionPlanCreationDraft']);
            const source = JSON.parse(String(request.input.sourceText));
            expect(source.context.selection).toMatchObject({ kind: 'epicId' });
            return { task: runningTask('task-epic') };
          },
          async get() { throw new Error('unexpected get'); },
          async cancel() { throw new Error('unexpected cancel'); },
        }),
      });
      expect(result.kind).toBe('success');
      const entry = (await readPlanningTaskWorkflowIndex(cwd)).entries[0]!;
      expect(entry.taskId).toBe('task-epic');
      expect(entry.selection.epicId).toBe('epic-one');
      expect(entry.requestedOutputSections).toEqual(['sessionPlanCreationDraft']);
      expect(entry.originalRequest).toBe('');
      expect(entry.derivedRequest).toContain('epic epic-one');
    });
  });

  it('lists indexed running, completed, failed, cancelled, and missing daemon task records without a caller-supplied task id', async () => {
    await withTempProject(async (cwd) => {
      const base = { originalRequest: 'Plan', derivedRequest: 'Draft a session plan.', selection: { itemIds: ['item-one'] }, requestedOutputSections: ['sessionPlanCreationDraft' as const] };
      await recordPlanningTaskWorkflowEntry(cwd, { taskId: 'task-running', createdAt: '2026-01-01T00:00:00.000Z', ...base });
      await recordPlanningTaskWorkflowEntry(cwd, { taskId: 'task-complete', createdAt: '2026-01-02T00:00:00.000Z', ...base });
      await recordPlanningTaskWorkflowEntry(cwd, { taskId: 'task-failed', createdAt: '2026-01-03T00:00:00.000Z', ...base });
      await recordPlanningTaskWorkflowEntry(cwd, { taskId: 'task-cancelled', createdAt: '2026-01-04T00:00:00.000Z', ...base });
      await recordPlanningTaskWorkflowEntry(cwd, { taskId: 'task-missing', createdAt: '2026-01-05T00:00:00.000Z', ...base });
      const records: Record<string, ExtensionAgentTaskRecord> = {
        'task-running': runningTask('task-running'),
        'task-complete': completedTask(),
        'task-failed': { ...runningTask('task-failed'), status: 'failed', completedAt: '2026-01-03T00:00:01.000Z', errorCode: 'failed', errorMessage: 'boom' } as ExtensionAgentTaskRecord,
        'task-cancelled': { ...runningTask('task-cancelled'), status: 'cancelled', cancelledAt: '2026-01-04T00:00:01.000Z' } as ExtensionAgentTaskRecord,
      };
      const result = await dispatchExtensionAction(load(), {
        actionId: 'eforge-plan:list-planning-agent-tasks',
        input: {},
        requestedBy: { host: 'console' },
        cwd,
        timeoutMs: 1000,
        agentTasks: () => ({
          async start() { throw new Error('unexpected start'); },
          async get(taskId: string) {
            const record = records[taskId];
            if (record === undefined) throw new Error(`No such task ${taskId}`);
            return { task: record };
          },
          async cancel() { throw new Error('unexpected cancel'); },
        }),
      });
      expect(result.kind).toBe('success');
      if (result.kind !== 'success') throw new Error(result.message);
      const tasks = (result.output as { tasks: Array<Record<string, unknown>> }).tasks;
      expect(tasks.map((task) => (task.entry as { taskId: string }).taskId)).toEqual(['task-missing', 'task-cancelled', 'task-failed', 'task-complete', 'task-running']);
      const byId = new Map(tasks.map((task) => [(task.entry as { taskId: string }).taskId, task]));
      expect(byId.get('task-running')).toMatchObject({ available: true, status: 'running' });
      expect(byId.get('task-complete')).toMatchObject({ available: true, status: 'completed' });
      expect(byId.get('task-failed')).toMatchObject({ available: true, status: 'failed' });
      expect(byId.get('task-cancelled')).toMatchObject({ available: true, status: 'cancelled' });
      expect(byId.get('task-missing')).toMatchObject({ available: false });
      expect(typeof (byId.get('task-missing') as { staleReason?: unknown }).staleReason).toBe('string');
    });
  });

  it.each([
    { includeRoadmap: false },
    { includeRoadmap: true },
  ])('retries a planning task preserving its selection, roadmap flag (%o), session, planning dimensions, and requested output sections', async ({ includeRoadmap }) => {
    await withTempProject(async (cwd) => {
      await mkdir(join(cwd, 'docs'), { recursive: true });
      await writeFile(join(cwd, 'docs', 'roadmap.md'), '# Roadmap\n\n## Planning\n\nShip planner retries.\n');
      await writeBacklogItem(cwd, { id: 'item-one', status: 'planned', body: '# Item One\n\n## Claim\n\nPlan it.\n' });
      await recordPlanningTaskWorkflowEntry(cwd, {
        taskId: 'task-original',
        createdAt: '2026-01-01T00:00:00.000Z',
        originalRequest: 'Original goal',
        derivedRequest: 'Draft a session plan for Item One.',
        selection: { itemIds: ['item-one'] },
        requestedOutputSections: ['sessionPlanCreationDraft'],
        session: 'session-x',
        planningType: 'feature',
        planningDepth: 'deep',
        includeRoadmap,
      });
      let started: { kind: string; input: Record<string, unknown> } | undefined;
      const result = await dispatchExtensionAction(load(), {
        actionId: 'eforge-plan:retry-planning-agent-task',
        input: { taskId: 'task-original' },
        requestedBy: { host: 'console' },
        cwd,
        timeoutMs: 1000,
        agentTasks: () => ({
          async start(request) { started = request as { kind: string; input: Record<string, unknown> }; return { task: runningTask('task-retry') }; },
          async get() { throw new Error('unexpected get'); },
          async cancel() { throw new Error('unexpected cancel'); },
        }),
      });
      expect(result.kind).toBe('success');
      if (result.kind !== 'success') throw new Error(result.message);
      expect(started?.input).toMatchObject({ topic: 'Draft a session plan for Item One.', session: 'session-x', planningType: 'feature', planningDepth: 'deep', requestedOutputSections: ['sessionPlanCreationDraft'] });
      // Parse the serialized planner context to prove the preserved roadmap flag is honored:
      // a regression that ignored includeRoadmap would surface roadmap evidence in both cases.
      const source = JSON.parse(String(started?.input.sourceText));
      expect(source.context.roadmapEvidence.exists).toBe(includeRoadmap);
      if (includeRoadmap) {
        expect(source.context.roadmapEvidence.headings).toContain('Roadmap');
      } else {
        expect(source.context.roadmapEvidence).toMatchObject({ path: 'docs/roadmap.md', exists: false, headings: [], excerpts: [] });
      }
      expect((result.output as { entry: { parentTaskId?: string; selection: { itemIds?: string[] } } }).entry).toMatchObject({ parentTaskId: 'task-original', selection: { itemIds: ['item-one'] } });
      const index = await readPlanningTaskWorkflowIndex(cwd);
      expect(index.entries.map((entry) => entry.taskId).sort()).toEqual(['task-original', 'task-retry']);
    });
  });

  it('retries from the preserved workflow entry without consulting the daemon parent status (status validation out of scope)', async () => {
    await withTempProject(async (cwd) => {
      await writeBacklogItem(cwd, { id: 'item-one', status: 'planned', body: '# Item One\n\n## Claim\n\nPlan it.\n' });
      await recordPlanningTaskWorkflowEntry(cwd, {
        taskId: 'task-original',
        createdAt: '2026-01-01T00:00:00.000Z',
        originalRequest: 'Original goal',
        derivedRequest: 'Draft a session plan for Item One.',
        selection: { itemIds: ['item-one'] },
        requestedOutputSections: ['sessionPlanCreationDraft'],
      });
      const result = await dispatchExtensionAction(load(), {
        actionId: 'eforge-plan:retry-planning-agent-task',
        input: { taskId: 'task-original' },
        requestedBy: { host: 'console' },
        cwd,
        timeoutMs: 1000,
        agentTasks: () => ({
          async start() { return { task: runningTask('task-retry') }; },
          async get() { throw new Error('unexpected get'); },
          async cancel() { throw new Error('unexpected cancel'); },
        }),
      });
      expect(result.kind).toBe('success');
    });
  });

  it('redrafts from a needs-input parent including the original request, prior summary or questions, and user answers and steering', async () => {
    await withTempProject(async (cwd) => {
      await writeBacklogItem(cwd, { id: 'item-one', status: 'planned', body: '# Item One\n\n## Claim\n\nPlan it.\n' });
      await recordPlanningTaskWorkflowEntry(cwd, {
        taskId: 'task-needs-input',
        createdAt: '2026-01-01T00:00:00.000Z',
        originalRequest: 'Plan the auth refactor',
        derivedRequest: 'Draft a session plan for Item One.',
        selection: { itemIds: ['item-one'] },
        requestedOutputSections: ['sessionPlanCreationDraft'],
      });
      let started: { input: Record<string, unknown> } | undefined;
      const result = await dispatchExtensionAction(load(), {
        actionId: 'eforge-plan:redraft-planning-agent-task',
        input: { taskId: 'task-needs-input', answers: ['Use REST endpoints'], steering: 'Focus on the backend first' },
        requestedBy: { host: 'console' },
        cwd,
        timeoutMs: 1000,
        agentTasks: () => ({
          async start(request) { started = request as { input: Record<string, unknown> }; return { task: runningTask('task-redraft') }; },
          async get(taskId: string) { return { task: needsInputTask(taskId) }; },
          async cancel() { throw new Error('unexpected cancel'); },
        }),
      });
      expect(result.kind).toBe('success');
      if (result.kind !== 'success') throw new Error(result.message);
      const sourceText = String(started?.input.sourceText);
      expect(sourceText).toContain('Plan the auth refactor');
      expect(sourceText).toContain('Need more detail before drafting.');
      expect(sourceText).toContain('What is the target API surface?');
      expect(sourceText).toContain('Use REST endpoints');
      expect(sourceText).toContain('Focus on the backend first');
      expect((result.output as { entry: { parentTaskId?: string } }).entry.parentTaskId).toBe('task-needs-input');
    });
  });

  it('bounds oversized redraft context within the configured source-text cap while preserving essential fields', async () => {
    await withTempProject(async (cwd) => {
      await writeBacklogItem(cwd, { id: 'item-one', status: 'planned', body: '# Item One\n\n## Claim\n\nPlan it.\n' });
      await recordPlanningTaskWorkflowEntry(cwd, {
        taskId: 'task-needs-input',
        createdAt: '2026-01-01T00:00:00.000Z',
        originalRequest: 'Plan the auth refactor',
        derivedRequest: 'Draft a session plan for Item One.',
        selection: { itemIds: ['item-one'] },
        requestedOutputSections: ['sessionPlanCreationDraft'],
      });
      // Oversized parent clarification result plus oversized user answers/steering so the
      // first-pass serialized context blows past the cap and forces the redraft summary path.
      const oversizedParent = parseExtensionAgentTaskRecord({
        taskId: 'task-needs-input',
        kind: 'eforge-plan.planning-draft',
        status: 'completed',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:01.000Z',
        startedAt: '2026-01-01T00:00:00.000Z',
        completedAt: '2026-01-01T00:00:01.000Z',
        result: {
          summary: `Prior summary ${'s'.repeat(9000)}`,
          assumptionsOpenQuestions: ['Assumes REST transport.'],
          decision: 'needs-input',
          clarificationQuestions: Array.from({ length: 40 }, (_, index) => ({ question: `Question ${index} ${'q'.repeat(5000)}` })),
          rationale: 'Scope is ambiguous.',
        },
      });
      let started: { input: Record<string, unknown> } | undefined;
      const result = await dispatchExtensionAction(load(), {
        actionId: 'eforge-plan:redraft-planning-agent-task',
        input: {
          taskId: 'task-needs-input',
          answers: Array.from({ length: 40 }, (_, index) => `Answer ${index} ${'a'.repeat(5000)}`),
          steering: `Focus on the backend ${'b'.repeat(9000)}`,
        },
        requestedBy: { host: 'console' },
        cwd,
        timeoutMs: 1000,
        agentTasks: () => ({
          async start(request) { started = request as { input: Record<string, unknown> }; return { task: runningTask('task-redraft') }; },
          async get() { return { task: oversizedParent }; },
          async cancel() { throw new Error('unexpected cancel'); },
        }),
      });
      expect(result.kind).toBe('success');
      if (result.kind !== 'success') throw new Error(result.message);
      const sourceText = String(started?.input.sourceText);
      expect(sourceText.length).toBeLessThanOrEqual(60000);
      const parsed = JSON.parse(sourceText);
      // Summary/truncation metadata records that the oversized payload was bounded.
      expect(parsed.truncation).toMatchObject({ sourceTextTruncated: true, redraftSummarized: true });
      expect(parsed.truncation.omittedRedraftQuestions).toBeGreaterThan(0);
      expect(parsed.truncation.omittedRedraftAnswers).toBeGreaterThan(0);
      // Essential redraft fields survive the summary pass.
      expect(parsed.redraft.parentTaskId).toBe('task-needs-input');
      expect(parsed.redraft.originalRequest).toBe('Plan the auth refactor');
      expect(parsed.redraft.previousQuestions.length).toBeLessThanOrEqual(10);
      expect(parsed.redraft.userAnswers.length).toBeLessThanOrEqual(10);
      expect(String(parsed.redraft.steering)).toContain('…[truncated]');
      expect(String(parsed.redraft.steering).length).toBeLessThanOrEqual(1100);
      // Essential context fields preserved; oversized item/epic detail dropped.
      expect(parsed.context).toMatchObject({ schemaVersion: 1, selection: { itemIds: ['item-one'] } });
      expect(parsed.context.items).toBeUndefined();
    });
  });

  it('rejects redraft when the parent is not a completed needs-input clarification result and starts no new task', async () => {
    await withTempProject(async (cwd) => {
      await writeBacklogItem(cwd, { id: 'item-one', status: 'planned', body: '# Item One\n\n## Claim\n\nPlan it.\n' });
      await recordPlanningTaskWorkflowEntry(cwd, {
        taskId: 'task-parent',
        createdAt: '2026-01-01T00:00:00.000Z',
        originalRequest: 'Plan the auth refactor',
        derivedRequest: 'Draft a session plan for Item One.',
        selection: { itemIds: ['item-one'] },
        requestedOutputSections: ['sessionPlanCreationDraft'],
      });
      const readyResult = parseExtensionAgentTaskRecord({
        taskId: 'task-parent',
        kind: 'eforge-plan.planning-draft',
        status: 'completed',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:01.000Z',
        startedAt: '2026-01-01T00:00:00.000Z',
        completedAt: '2026-01-01T00:00:01.000Z',
        result: {
          summary: 'Ready to draft.',
          assumptionsOpenQuestions: [],
          decision: 'ready',
          sessionPlanCreationDraft: { session: 'task-parent', topic: 'Topic', planningType: 'feature', planningDepth: 'focused', sections: [{ dimension: 'scope', content: 'Scope.' }] },
        },
      });
      // needs-input requires >= 1 clarification question at the schema level, so an
      // empty-questions record can only be hand-crafted through unknown to exercise
      // the handler guard's question check.
      const needsInputNoQuestions = {
        taskId: 'task-parent',
        kind: 'eforge-plan.planning-draft',
        status: 'completed',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:01.000Z',
        startedAt: '2026-01-01T00:00:00.000Z',
        completedAt: '2026-01-01T00:00:01.000Z',
        result: { summary: 'Need more detail.', assumptionsOpenQuestions: [], decision: 'needs-input', clarificationQuestions: [], rationale: 'Ambiguous.' },
      } as unknown as ExtensionAgentTaskRecord;
      const parents: ExtensionAgentTaskRecord[] = [
        runningTask('task-parent'),
        { ...runningTask('task-parent'), status: 'failed', completedAt: '2026-01-01T00:00:01.000Z', errorCode: 'failed', errorMessage: 'boom' } as ExtensionAgentTaskRecord,
        completedTask({ taskId: 'task-parent' }),
        readyResult,
        needsInputNoQuestions,
      ];
      for (const parent of parents) {
        let starts = 0;
        const result = await dispatchExtensionAction(load(), {
          actionId: 'eforge-plan:redraft-planning-agent-task',
          input: { taskId: 'task-parent', steering: 'Refocus on the backend' },
          requestedBy: { host: 'console' },
          cwd,
          timeoutMs: 1000,
          agentTasks: () => ({
            async start() { starts += 1; throw new Error('unexpected start'); },
            async get() { return { task: parent }; },
            async cancel() { throw new Error('unexpected cancel'); },
          }),
        });
        expect(result.kind).toBe('handler-error');
        expect(starts).toBe(0);
      }
    });
  });

  it('applies an AI creation draft to a fresh session without enqueueing builds, shipping items, or submitting the plan', async () => {
    await withTempProject(async (cwd) => {
      await writeBacklogItem(cwd, { id: 'item-one', status: 'planned', body: '# Item One\n\n## Claim\n\nPlan it.\n' });
      const task = parseExtensionAgentTaskRecord({
        taskId: 'task-creation',
        kind: 'eforge-plan.planning-draft',
        status: 'completed',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:01.000Z',
        startedAt: '2026-01-01T00:00:00.000Z',
        completedAt: '2026-01-01T00:00:01.000Z',
        result: {
          summary: 'Drafted a plan.',
          assumptionsOpenQuestions: ['Assumes API stable.'],
          decision: 'ready',
          sessionPlanCreationDraft: {
            session: 'created-session',
            topic: 'Created topic',
            planningType: 'feature',
            planningDepth: 'focused',
            sections: [{ dimension: 'scope', content: 'Generated scope content.' }],
          },
        },
      });
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
      const task = parseExtensionAgentTaskRecord({
        taskId: 'task-creation',
        kind: 'eforge-plan.planning-draft',
        status: 'completed',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:01.000Z',
        startedAt: '2026-01-01T00:00:00.000Z',
        completedAt: '2026-01-01T00:00:01.000Z',
        result: {
          summary: 'Drafted a plan.',
          assumptionsOpenQuestions: [],
          decision: 'ready',
          recommendations: { ...createEmptyRecommendationModel(), readyCandidates: [{ itemId: 'item-one', rationale: 'Ready.' }] },
          sessionPlanCreationDraft: {
            session: 'created-session',
            topic: 'Created topic',
            planningType: 'feature',
            planningDepth: 'focused',
            sections: [{ dimension: 'scope', content: 'Generated scope content.' }],
          },
        },
      });
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
      expect(result.kind).toBe('handler-error');
      expect(await readRecommendations(cwd)).toBeNull();
    });
  });
});
