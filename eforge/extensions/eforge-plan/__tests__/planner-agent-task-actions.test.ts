import { mkdir, mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createSessionPlanningWorkflowAdapter } from '@eforge-build/input';
import { dispatchExtensionAction } from '@eforge-build/engine/extensions/action-runtime.js';
import { createExtensionRecorder } from '@eforge-build/engine/extensions/recorder.js';
import type { NativeExtensionRegistry } from '@eforge-build/engine/extensions/types.js';
import { parseExtensionAgentTaskRecord, safeParseWithSchema, type ExtensionAgentTaskRecord } from '@eforge-build/client';
import eforgePlanExtension from '../index.js';
import { readBacklogItem, writeBacklogEpic, writeBacklogItem } from '../markdown-store.js';
import { createEmptyRecommendationModel, readRecommendations, writeRecommendations } from '../recommendations-store.js';
import { readPlanningTaskWorkflowIndex, recordPlanningTaskWorkflowEntry } from '../planning-task-workflow-store.js';
import { ApplyPlanningAgentTaskResultInputSchema } from '../planning-agent-task-schemas.js';
import { buildBacklogCurationSource, writeBacklogCurationSourcePreviewMetadata } from '../backlog-curation-source.js';
import { updateSessionPlanSourceMetadata } from '../session-plan-metadata.js';
async function withTempProject<T>(fn: (cwd: string) => Promise<T>): Promise<T> {
  const cwd = await mkdtemp(join(tmpdir(), 'eforge-plan-agent-task-'));
  try { return await fn(cwd); } finally { await rm(cwd, { recursive: true, force: true }); }
}
function load(): NativeExtensionRegistry {
  const { api, state } = createExtensionRecorder('eforge-plan', '/project/eforge/extensions/eforge-plan/index.ts');
  eforgePlanExtension(api as never);
  expect(state.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')).toEqual([]);
  return { ...state, extensions: [], candidates: [] };
}
function runningTask(taskId = 'task-running'): ExtensionAgentTaskRecord {
  return { taskId, kind: 'eforge-plan.planning-draft', status: 'running', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', startedAt: '2026-01-01T00:00:00.000Z' };
}
function expectSuppressedInvalidInput(result: unknown, expected: { reasonCode: string; lifecycleState: string; associatedLink: Record<string, unknown> }): void {
  expect(result).toMatchObject({ kind: 'invalid-input', validationErrors: [expect.objectContaining({ path: 'itemIds', suppressedItems: [expect.objectContaining({ itemId: 'item-one', state: 'non-actionable', reasonCode: expected.reasonCode, reasonMessage: expect.stringMatching(/\S/), lifecycleState: expected.lifecycleState, associatedLinks: expect.arrayContaining([expect.objectContaining(expected.associatedLink)]) })] })] });
}
const completedTimestamps = { createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:01.000Z', startedAt: '2026-01-01T00:00:00.000Z', completedAt: '2026-01-01T00:00:01.000Z' };
function completedTask(overrides: Partial<ExtensionAgentTaskRecord> = {}): ExtensionAgentTaskRecord {
  return parseExtensionAgentTaskRecord({
    taskId: 'task-complete', kind: 'eforge-plan.planning-draft', status: 'completed', ...completedTimestamps,
    result: {
      summary: 'Generated planning output.', assumptionsOpenQuestions: [],
      recommendations: { ...createEmptyRecommendationModel(), readyCandidates: [{ itemId: 'item-one', rationale: 'Ready.' }] },
      handoffDrafts: [{ selection: { itemIds: ['item-one'], status: 'active' }, session: 'task-handoff' }],
      sessionPlanPatch: { sections: [{ dimension: 'scope', content: 'Generated scope.' }] },
    },
    ...overrides,
  });
}
function curationCompletedTask(taskId = 'task-curation'): ExtensionAgentTaskRecord {
  return parseExtensionAgentTaskRecord({
    taskId, kind: 'eforge-plan.planning-draft', status: 'completed', ...completedTimestamps,
    result: {
      summary: 'Drafted backlog curation.', assumptionsOpenQuestions: [],
      backlogCurationDraft: { schemaVersion: 1, sourceFingerprint: '1111111111111111111111111111111111111111111111111111111111111111', summary: [], itemChanges: [], epicChanges: [], noOpRechecks: [], skipped: [], needsInput: [] },
      recommendations: { ...createEmptyRecommendationModel(), readyCandidates: [{ itemId: 'item-one', rationale: 'Ready after curation.' }] },
    },
  });
}
function needsInputTask(taskId: string): ExtensionAgentTaskRecord {
  return parseExtensionAgentTaskRecord({
    taskId, kind: 'eforge-plan.planning-draft', status: 'completed', ...completedTimestamps,
    result: { summary: 'Need more detail before drafting.', assumptionsOpenQuestions: ['Assumes REST transport.'], decision: 'needs-input', clarificationQuestions: [{ question: 'What is the target API surface?' }], rationale: 'Scope is ambiguous.' },
  });
}
function creationDraftTask(taskId = 'task-creation', session = 'created-session'): ExtensionAgentTaskRecord {
  return parseExtensionAgentTaskRecord({
    taskId, kind: 'eforge-plan.planning-draft', status: 'completed', ...completedTimestamps,
    result: {
      summary: 'Drafted a plan.', assumptionsOpenQuestions: ['Assumes API stable.'], decision: 'ready',
      sessionPlanCreationDraft: {
        session, topic: 'Created topic', planningType: 'feature', planningDepth: 'focused',
        sections: [
          { dimension: 'problem-statement', content: 'The generated feature needs a clear implementation plan.' },
          { dimension: 'scope', content: 'Generated scope content.' },
          { dimension: 'acceptance-criteria', content: '- Feature session plan includes every required readiness section.' },
          { dimension: 'code-impact', content: 'Update extension apply behavior and tests.' },
          { dimension: 'design-decisions', content: 'Validate generated drafts before persistence.' },
          { dimension: 'assumptions-and-validation', content: 'Run extension action tests and type checking.' },
        ],
      },
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
  it('does not start a daemon task when selected work is already covered by a session plan', async () => {
    await withTempProject(async (cwd) => {
      await writeBacklogItem(cwd, { id: 'item-one', status: 'candidate', body: '# Item One\n\n## Claim\n\nPlan it.\n' });
      await createSessionPlanningWorkflowAdapter().flat.create({ cwd, session: 'planned-session', topic: 'Existing plan' });
      await updateSessionPlanSourceMetadata({ cwd, session: 'planned-session', sourceItemIds: ['item-one'], sourceEpicIds: [], promotedAt: '2026-01-01T00:00:00.000Z' });
      let starts = 0;
      const result = await dispatchExtensionAction(load(), {
        actionId: 'eforge-plan:start-planning-agent-task',
        input: { itemIds: ['item-one'], includeRoadmap: false },
        requestedBy: { host: 'console' },
        cwd,
        timeoutMs: 1000,
        agentTasks: () => ({
          async start() { starts += 1; throw new Error('unexpected start'); },
          async get() { throw new Error('unexpected get'); },
          async cancel() { throw new Error('unexpected cancel'); },
        }),
      });
      expectSuppressedInvalidInput(result, { reasonCode: 'planned-session-plan', lifecycleState: 'planned', associatedLink: { kind: 'session-plan', session: 'planned-session', status: 'planning' } });
      expect(starts).toBe(0);
    });
  });
  it('does not start a daemon task when selected work has an active planning task', async () => {
    await withTempProject(async (cwd) => {
      await writeBacklogItem(cwd, { id: 'item-one', status: 'candidate', body: '# Item One\n\n## Claim\n\nPlan it.\n' });
      await recordPlanningTaskWorkflowEntry(cwd, { taskId: 'task-active', createdAt: '2026-01-01T00:00:00.000Z', originalRequest: 'Plan', derivedRequest: 'Plan item one.', selection: { itemIds: ['item-one'] }, requestedOutputSections: ['handoffDrafts'] });
      let starts = 0;
      const result = await dispatchExtensionAction(load(), {
        actionId: 'eforge-plan:start-planning-agent-task',
        input: { itemIds: ['item-one'], includeRoadmap: false },
        requestedBy: { host: 'console' },
        cwd,
        timeoutMs: 1000,
        agentTasks: () => ({
          async start() { starts += 1; throw new Error('unexpected start'); },
          async get(taskId: string) { return { task: runningTask(taskId) }; },
          async cancel() { throw new Error('unexpected cancel'); },
        }),
      });
      expectSuppressedInvalidInput(result, { reasonCode: 'active-planning-task', lifecycleState: 'active', associatedLink: { kind: 'planning-task', taskId: 'task-active', status: 'running' } });
      expect(starts).toBe(0);
    });
  });
  it('starts a user-goal planning task even when contextual backlog work is already planned', async () => {
    await withTempProject(async (cwd) => {
      await writeBacklogItem(cwd, { id: 'item-one', status: 'candidate', body: '# Item One\n\n## Claim\n\nPlan it.\n' });
      await createSessionPlanningWorkflowAdapter().flat.create({ cwd, session: 'planned-session', topic: 'Existing plan' });
      await updateSessionPlanSourceMetadata({ cwd, session: 'planned-session', sourceItemIds: ['item-one'], sourceEpicIds: [], promotedAt: '2026-01-01T00:00:00.000Z' });
      let starts = 0;
      const result = await dispatchExtensionAction(load(), {
        actionId: 'eforge-plan:start-planning-agent-task',
        input: { userGoal: 'Explore broad planning options', includeRoadmap: false },
        requestedBy: { host: 'console' },
        cwd,
        timeoutMs: 1000,
        agentTasks: () => ({
          async start() { starts += 1; return { task: runningTask('task-user-goal') }; },
          async get() { throw new Error('unexpected get'); },
          async cancel() { throw new Error('unexpected cancel'); },
        }),
      });
      expect(result).toMatchObject({ kind: 'success', output: { task: { taskId: 'task-user-goal' } } });
      expect(starts).toBe(1);
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
      expect(result.kind).toBe('invalid-input');
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
      expect(result.kind).toBe('invalid-input');
      expect(await readRecommendations(cwd)).toBeNull();
    });
  });
  it('encodes apply-selection requirements in the action input schema', () => {
    const schema = ApplyPlanningAgentTaskResultInputSchema as unknown as { anyOf?: unknown[]; not?: { anyOf?: unknown[] } };
    expect(schema.anyOf).toEqual(expect.arrayContaining([
      expect.objectContaining({ required: ['applyBacklogCurationDraft'] }),
      expect.objectContaining({ required: ['applyHandoffDrafts'] }),
    ]));
    expect(schema.not?.anyOf).toEqual(expect.arrayContaining([
      expect.objectContaining({ required: ['applyBacklogCurationDraft', 'applySessionPlanCreationDraft'] }),
      expect.objectContaining({ required: ['applyBacklogCurationDraft', 'applyHandoffDrafts'] }),
    ]));
    expect(safeParseWithSchema(ApplyPlanningAgentTaskResultInputSchema, { taskId: 'task-complete', applyRecommendations: true }).success).toBe(true);
    expect(safeParseWithSchema(ApplyPlanningAgentTaskResultInputSchema, { taskId: 'task-complete', applyBacklogCurationDraft: { previewAcknowledged: true, confirmApply: true } }).success).toBe(true);
    expect(safeParseWithSchema(ApplyPlanningAgentTaskResultInputSchema, { taskId: 'task-complete', applyBacklogCurationDraft: { previewAcknowledged: true, confirmApply: true, applyCurationOnly: true } }).success).toBe(true);
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
        expect(result).toMatchObject({ kind: 'invalid-input' });
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
        expect(result.kind).toBe('invalid-input');
      }
    });
  });
  it('returns invalid input instead of handler error for invalid backlog curation task state', async () => {
    await withTempProject(async (cwd) => {
      await recordPlanningTaskWorkflowEntry(cwd, { taskId: 'task-curation', originalRequest: '', derivedRequest: 'curate', selection: {}, requestedOutputSections: ['backlogCurationDraft', 'recommendations'], includeRoadmap: true, purpose: 'backlog-curation', sourceFingerprint: '1111111111111111111111111111111111111111111111111111111111111111', createdAt: 'now' });
      const result = await dispatchExtensionAction(load(), {
        actionId: 'eforge-plan:apply-planning-agent-task-result',
        input: { taskId: 'task-curation', applyBacklogCurationDraft: { previewAcknowledged: true, confirmApply: true } },
        requestedBy: { host: 'console' },
        cwd,
        timeoutMs: 1000,
        agentTasks: () => ({
          async start() { throw new Error('unexpected start'); },
          async get() { return { task: runningTask('task-curation') }; },
          async cancel() { throw new Error('unexpected cancel'); },
        }),
      });
      expect(result).toMatchObject({ kind: 'invalid-input' });
      expect(JSON.stringify(result)).toContain('only completed tasks can be applied');
    });
  });
  it('rejects backlog curation apply selection when the workflow entry is not a backlog-curation workflow', async () => {
    await withTempProject(async (cwd) => {
      const result = await dispatchExtensionAction(load(), {
        actionId: 'eforge-plan:apply-planning-agent-task-result',
        input: { taskId: 'task-curation', applyBacklogCurationDraft: { previewAcknowledged: true, confirmApply: true } },
        requestedBy: { host: 'console' },
        cwd,
        timeoutMs: 1000,
        agentTasks: () => ({
          async start() { throw new Error('unexpected start'); },
          async get() { return { task: curationCompletedTask() }; },
          async cancel() { throw new Error('unexpected cancel'); },
        }),
      });
      expect(result.kind).toBe('invalid-input');
      expect(await readRecommendations(cwd)).toBeNull();
    });
  });
  it('rejects standalone recommendation apply for a backlog-curation workflow entry', async () => {
    await withTempProject(async (cwd) => {
      await writeBacklogItem(cwd, { id: 'item-one', status: 'candidate', body: '# Item One\n\n## Claim\n\nCurate it.\n' });
      await recordPlanningTaskWorkflowEntry(cwd, {
        taskId: 'task-curation',
        createdAt: '2026-01-01T00:00:00.000Z',
        originalRequest: '',
        derivedRequest: 'Analyze and curate all open eforge-plan backlog records.',
        selection: {},
        requestedOutputSections: ['backlogCurationDraft', 'recommendations'],
        includeRoadmap: true,
        purpose: 'backlog-curation',
        sourceFingerprint: '1111111111111111111111111111111111111111111111111111111111111111',
      });
      const result = await dispatchExtensionAction(load(), {
        actionId: 'eforge-plan:apply-planning-agent-task-result',
        input: { taskId: 'task-curation', applyRecommendations: true },
        requestedBy: { host: 'console' },
        cwd,
        timeoutMs: 1000,
        agentTasks: () => ({
          async start() { throw new Error('unexpected start'); },
          async get() { return { task: curationCompletedTask() }; },
          async cancel() { throw new Error('unexpected cancel'); },
        }),
      });
      expect(result.kind).toBe('invalid-input');
      expect(await readRecommendations(cwd)).toBeNull();
    });
  });
  it('reports recommendations applied when confirmed backlog curation writes generated recommendations', async () => {
    await withTempProject(async (cwd) => {
      await writeBacklogItem(cwd, { id: 'item-one', status: 'candidate', body: '# Item One\n\n## Claim\n\nCurate it.\n' });
      const source = await buildBacklogCurationSource(cwd);
      const precondition = ((source.source as { preconditions: { items: Array<Record<string, unknown>> } }).preconditions.items[0]);
      await recordPlanningTaskWorkflowEntry(cwd, {
        taskId: 'task-curation',
        createdAt: '2026-01-01T00:00:00.000Z',
        originalRequest: '',
        derivedRequest: 'Analyze and curate all open eforge-plan backlog records.',
        selection: {},
        requestedOutputSections: ['backlogCurationDraft', 'recommendations'],
        includeRoadmap: true,
        purpose: 'backlog-curation',
        sourceFingerprint: source.sourceFingerprint,
      });
      const task = curationCompletedTask('task-curation');
      task.result = {
        summary: 'Drafted backlog curation and recommendations.',
        assumptionsOpenQuestions: [],
        backlogCurationDraft: {
          schemaVersion: 1,
          sourceFingerprint: source.sourceFingerprint,
          summary: [],
          itemChanges: [],
          epicChanges: [],
          noOpRechecks: [{ id: 'item-one', kind: 'item', precondition: { ...precondition, sourceFingerprint: source.sourceFingerprint }, last_checked: '2026-01-01', stale_after: '2026-02-01' }],
          skipped: [],
          needsInput: [],
        },
        recommendations: { ...createEmptyRecommendationModel(), readyCandidates: [{ itemId: 'item-one', rationale: 'Ready after curation.' }] },
      };
      const result = await dispatchExtensionAction(load(), {
        actionId: 'eforge-plan:apply-planning-agent-task-result',
        input: { taskId: 'task-curation', applyBacklogCurationDraft: { previewAcknowledged: true, confirmApply: true } },
        requestedBy: { host: 'console' },
        cwd,
        timeoutMs: 1000,
        agentTasks: () => ({
          async start() { throw new Error('unexpected start'); },
          async get() { return { task }; },
          async cancel() { throw new Error('unexpected cancel'); },
        }),
      });
      expect(result).toMatchObject({ kind: 'success', output: { applied: { recommendations: true, backlogCuration: 1 } } });
      expect(await readRecommendations(cwd)).toMatchObject({ readyCandidates: [{ itemId: 'item-one' }] });
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
  it('includes the canonical creation-readiness contract when starting a recommendation-lane creation draft', async () => {
    await withTempProject(async (cwd) => {
      await writeBacklogItem(cwd, { id: 'item-one', status: 'planned', body: '# Item One\n\n## Claim\n\nPlan it.\n' });
      await writeRecommendations(cwd, { ...createEmptyRecommendationModel(), safeParallelizableGroups: [{ ref: 'group-fast-ux-bugfixes', title: 'Fast UX fixes', itemIds: ['item-one'], rationale: 'Plan together.' }] });
      let taskInput: Record<string, unknown> | undefined;
      const result = await dispatchExtensionAction(load(), {
        actionId: 'eforge-plan:start-planning-agent-task',
        input: {
          recommendationRef: 'group-fast-ux-bugfixes',
          includeRoadmap: false,
          planningType: 'bugfix',
          planningDepth: 'focused',
          requestedOutputSections: ['sessionPlanCreationDraft'],
        },
        requestedBy: { host: 'console' },
        cwd,
        timeoutMs: 1000,
        agentTasks: () => ({
          async start(request) { taskInput = request.input as Record<string, unknown>; return { task: runningTask('task-creation-readiness') }; },
          async get() { throw new Error('unexpected get'); },
          async cancel() { throw new Error('unexpected cancel'); },
        }),
      });
      expect(result.kind).toBe('success');
      const readiness = taskInput?.sessionPlanCreationReadiness as {
        dimensionContract: Record<string, Record<string, { requiredDimensions: string[]; optionalDimensions: string[] }>>;
        resolved: { planningType: string; planningDepth: string; requiredDimensions: string[]; optionalDimensions: string[] };
      };
      expect(readiness.dimensionContract.bugfix.focused.requiredDimensions).toEqual([
        'problem-statement',
        'reproduction-steps',
        'root-cause',
        'acceptance-criteria',
        'assumptions-and-validation',
      ]);
      expect(readiness.resolved).toMatchObject({
        planningType: 'bugfix',
        planningDepth: 'focused',
        requiredDimensions: ['problem-statement', 'reproduction-steps', 'root-cause', 'acceptance-criteria', 'assumptions-and-validation'],
      });
    });
  });
  it('plans an explicit ready item subset while preserving its source recommendation ref', async () => {
    await withTempProject(async (cwd) => {
      await writeBacklogItem(cwd, { id: 'item-one', status: 'planned', body: '# Item One\n\n## Claim\n\nPlan it.\n' });
      const result = await dispatchExtensionAction(load(), {
        actionId: 'eforge-plan:start-planning-agent-task',
        input: { itemIds: ['item-one'], sourceRecommendationRef: 'group-one', includeRoadmap: false },
        requestedBy: { host: 'console' },
        cwd,
        timeoutMs: 1000,
        agentTasks: () => ({
          async start(request) {
            expect(String(request.input.topic)).toContain('recommendation group-one');
            expect(request.input.requestedOutputSections).toEqual(['sessionPlanCreationDraft']);
            const source = JSON.parse(String(request.input.sourceText));
            expect(source.context.selection).toMatchObject({ kind: 'itemIds', itemIds: ['item-one'], sourceRecommendationRef: 'group-one' });
            return { task: runningTask('task-rec-subset') };
          },
          async get() { throw new Error('unexpected get'); },
          async cancel() { throw new Error('unexpected cancel'); },
        }),
      });
      expect(result.kind).toBe('success');
      const entry = (await readPlanningTaskWorkflowIndex(cwd)).entries[0]!;
      expect(entry.selection).toMatchObject({ itemIds: ['item-one'], sourceRecommendationRef: 'group-one' });
      expect(entry.selection).not.toHaveProperty('recommendationRef');
    });
  });
  it('rejects source recommendation provenance without an explicit item selection', async () => {
    await withTempProject(async (cwd) => {
      const result = await dispatchExtensionAction(load(), {
        actionId: 'eforge-plan:start-planning-agent-task',
        input: { sourceRecommendationRef: 'group-one', includeRoadmap: false },
        requestedBy: { host: 'console' },
        cwd,
        timeoutMs: 1000,
        agentTasks: () => ({
          async start() { throw new Error('unexpected start'); },
          async get() { throw new Error('unexpected get'); },
          async cancel() { throw new Error('unexpected cancel'); },
        }),
      });
      expect(result.kind).toBe('invalid-input');
      expect(JSON.stringify(result)).toContain('sourceRecommendationRef requires itemIds');
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
      expect((result.output as { total: number; limit: number; offset: number })).toMatchObject({ total: 5, limit: 50, offset: 0 });
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

  it('defaults planning task lists to compact paginated summaries for agent callers', async () => {
    await withTempProject(async (cwd) => {
      const base = { originalRequest: 'Plan', derivedRequest: 'Draft a session plan.', selection: { itemIds: ['item-one'] }, requestedOutputSections: ['sessionPlanCreationDraft' as const] };
      await recordPlanningTaskWorkflowEntry(cwd, { taskId: 'task-one', createdAt: '2026-01-01T00:00:00.000Z', ...base });
      await recordPlanningTaskWorkflowEntry(cwd, { taskId: 'task-two', createdAt: '2026-01-02T00:00:00.000Z', ...base });
      const records: Record<string, ExtensionAgentTaskRecord> = {
        'task-one': completedTask({ taskId: 'task-one' } as Partial<ExtensionAgentTaskRecord>),
        'task-two': completedTask({ taskId: 'task-two' } as Partial<ExtensionAgentTaskRecord>),
      };
      const result = await dispatchExtensionAction(load(), {
        actionId: 'eforge-plan:list-planning-agent-tasks',
        input: { limit: 1 },
        requestedBy: { host: 'pi' },
        cwd,
        timeoutMs: 1000,
        agentTasks: () => ({
          async start() { throw new Error('unexpected start'); },
          async get(taskId: string) { return { task: records[taskId]! }; },
          async cancel() { throw new Error('unexpected cancel'); },
        }),
      });
      expect(result.kind).toBe('success');
      if (result.kind !== 'success') throw new Error(result.message);
      expect(result.output).toMatchObject({ total: 2, returned: 1, limit: 1, offset: 0, hasMore: true, nextOffset: 1 });
      const [task] = (result.output as { tasks: Array<Record<string, unknown>> }).tasks;
      expect(task).toMatchObject({ available: true, status: 'completed', entrySummary: { taskId: 'task-two', selection: { itemCount: 1 } }, taskSummary: { taskId: 'task-two', resultSummary: { outputKeys: expect.arrayContaining(['recommendations', 'sessionPlanPatch']) } } });
      expect(task).not.toHaveProperty('entry');
      expect(task).not.toHaveProperty('task');
    });
  });

  it('paginates planning task list rows and only fetches daemon records for the page', async () => {
    await withTempProject(async (cwd) => {
      const base = { originalRequest: 'Plan', derivedRequest: 'Draft a session plan.', selection: { itemIds: ['item-one'] }, requestedOutputSections: ['sessionPlanCreationDraft' as const] };
      await recordPlanningTaskWorkflowEntry(cwd, { taskId: 'task-oldest', createdAt: '2026-01-01T00:00:00.000Z', ...base });
      await recordPlanningTaskWorkflowEntry(cwd, { taskId: 'task-middle', createdAt: '2026-01-02T00:00:00.000Z', ...base });
      await recordPlanningTaskWorkflowEntry(cwd, { taskId: 'task-newest', createdAt: '2026-01-03T00:00:00.000Z', ...base });
      const fetched: string[] = [];
      const result = await dispatchExtensionAction(load(), {
        actionId: 'eforge-plan:list-planning-agent-tasks',
        input: { limit: 1, offset: 1 },
        requestedBy: { host: 'console' },
        cwd,
        timeoutMs: 1000,
        agentTasks: () => ({
          async start() { throw new Error('unexpected start'); },
          async get(taskId: string) { fetched.push(taskId); return { task: runningTask(taskId) }; },
          async cancel() { throw new Error('unexpected cancel'); },
        }),
      });
      expect(result.kind).toBe('success');
      if (result.kind !== 'success') throw new Error(result.message);
      expect(result.output).toMatchObject({ total: 3, returned: 1, limit: 1, offset: 1, hasMore: true, nextOffset: 2 });
      const tasks = (result.output as { tasks: Array<Record<string, unknown>> }).tasks;
      expect(tasks).toHaveLength(1);
      expect((tasks[0]!.entry as { taskId: string }).taskId).toBe('task-middle');
      expect(fetched).toEqual(['task-middle']);
    });
  });
  it('keeps non-heavy planning task list results and omits verbose completed payloads', async () => {
    const cases: Array<{ name: string; task: ExtensionAgentTaskRecord; requestedOutputSections: Array<'sessionPlanCreationDraft' | 'planDrafts' | 'playbookDraft'>; resultKey?: string; omitted: boolean }> = [
      { name: 'ready sessionPlanCreationDraft', task: creationDraftTask('task-creation-compact'), requestedOutputSections: ['sessionPlanCreationDraft'], resultKey: 'sessionPlanCreationDraft', omitted: false },
      { name: 'needs-input clarification', task: needsInputTask('task-needs-input-compact'), requestedOutputSections: ['sessionPlanCreationDraft'], resultKey: 'clarificationQuestions', omitted: false },
      { name: 'planDrafts', task: completedTask({ taskId: 'task-plan-drafts-compact', result: { summary: 'Drafted a plan.', assumptionsOpenQuestions: [], planDrafts: [{ title: 'Implement the feature', body: '# Plan\n\nDo the work.' }] } }), requestedOutputSections: ['planDrafts'], omitted: true },
      { name: 'playbookDraft', task: completedTask({ taskId: 'task-playbook-compact', result: { summary: 'Drafted a playbook.', assumptionsOpenQuestions: [], playbookDraft: { name: 'planning-playbook', body: '# Playbook\n\nUse it.' } } }), requestedOutputSections: ['playbookDraft'], omitted: true },
    ];
    for (const testCase of cases) {
      await withTempProject(async (cwd) => {
        await recordPlanningTaskWorkflowEntry(cwd, { taskId: testCase.task.taskId, createdAt: '2026-01-01T00:00:00.000Z', originalRequest: 'Plan', derivedRequest: 'Draft planning output.', selection: { itemIds: ['item-one'] }, requestedOutputSections: testCase.requestedOutputSections });
        const result = await dispatchExtensionAction(load(), {
          actionId: 'eforge-plan:list-planning-agent-tasks',
          input: {},
          requestedBy: { host: 'console' },
          cwd,
          timeoutMs: 1000,
          agentTasks: () => ({
            async start() { throw new Error('unexpected start'); },
            async get() { return { task: testCase.task }; },
            async cancel() { throw new Error('unexpected cancel'); },
          }),
        });
        expect(result.kind).toBe('success');
        if (result.kind !== 'success') throw new Error(result.message);
        const [row] = (result.output as { tasks: Array<Record<string, unknown>> }).tasks;
        expect(row).toMatchObject({ available: true, status: 'completed' });
        const task = row?.task as Record<string, unknown> | undefined;
        expect(task).toMatchObject({ taskId: testCase.task.taskId, status: 'completed', createdAt: testCase.task.createdAt, updatedAt: testCase.task.updatedAt, completedAt: testCase.task.completedAt });
        if (testCase.omitted) {
          expect(row).toMatchObject({ resultOmitted: true });
          expect(task).not.toHaveProperty('result');
        } else {
          expect(row?.resultOmitted).toBeUndefined();
          expect((task?.result as Record<string, unknown> | undefined)?.[testCase.resultKey!]).toBeDefined();
        }
      });
    }
  });
  it('previews backlog curation validation on demand without coupling it to task list rendering', async () => {
    await withTempProject(async (cwd) => {
      await writeBacklogItem(cwd, { id: 'closed-dep', status: 'shipped', body: '# Closed Dependency\n' });
      await writeBacklogItem(cwd, { id: 'item-one', status: 'candidate', body: '# Item One\n\n## Claim\n\nCurate it.\n' });
      const source = await buildBacklogCurationSource(cwd);
      await writeBacklogCurationSourcePreviewMetadata(cwd, source);
      const base = { originalRequest: '', derivedRequest: 'Analyze and curate all open eforge-plan backlog records.', selection: {}, requestedOutputSections: ['backlogCurationDraft' as const, 'recommendations' as const], includeRoadmap: true, purpose: 'backlog-curation' as const, sourceFingerprint: source.sourceFingerprint };
      await recordPlanningTaskWorkflowEntry(cwd, { taskId: 'task-curation-valid-preview', createdAt: '2026-01-01T00:00:00.000Z', ...base });
      await recordPlanningTaskWorkflowEntry(cwd, { taskId: 'task-curation-malformed-preview', createdAt: '2026-01-02T00:00:00.000Z', ...base });
      const validPreviewTask = parseExtensionAgentTaskRecord({
        taskId: 'task-curation-valid-preview',
        kind: 'eforge-plan.planning-draft',
        status: 'completed',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:01.000Z',
        startedAt: '2026-01-01T00:00:00.000Z',
        completedAt: '2026-01-01T00:00:01.000Z',
        result: {
          summary: 'Drafted backlog curation.',
          assumptionsOpenQuestions: [],
          backlogCurationDraft: { schemaVersion: 1, sourceFingerprint: source.sourceFingerprint, summary: [], itemChanges: [], epicChanges: [], noOpRechecks: [], skipped: [], needsInput: [] },
          recommendations: { ...createEmptyRecommendationModel(), blockedChains: [{ ref: 'closed-chain', itemIds: ['item-one'], blockedBy: ['closed-dep'], rationale: 'Historical dependency.' }] },
        },
      });
      const malformedTask = parseExtensionAgentTaskRecord({
        taskId: 'task-curation-malformed-preview',
        kind: 'eforge-plan.planning-draft',
        status: 'completed',
        createdAt: '2026-01-02T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:01.000Z',
        startedAt: '2026-01-02T00:00:00.000Z',
        completedAt: '2026-01-02T00:00:01.000Z',
        result: { summary: 'Malformed.', assumptionsOpenQuestions: [], recommendations: createEmptyRecommendationModel() },
      });
      const records: Record<string, ExtensionAgentTaskRecord> = { [validPreviewTask.taskId]: validPreviewTask, [malformedTask.taskId]: malformedTask };
      const agentTasks = () => ({
        async start() { throw new Error('unexpected start'); },
        async get(taskId: string) { return { task: records[taskId]! }; },
        async cancel() { throw new Error('unexpected cancel'); },
      });
      const list = await dispatchExtensionAction(load(), {
        actionId: 'eforge-plan:list-planning-agent-tasks',
        input: {},
        requestedBy: { host: 'console' },
        cwd,
        timeoutMs: 1000,
        agentTasks,
      });
      expect(list.kind).toBe('success');
      if (list.kind !== 'success') throw new Error(list.message);
      const tasks = (list.output as { tasks: Array<Record<string, unknown>>; total: number; limit: number; offset: number }).tasks;
      expect(list.output).toMatchObject({ total: 2, limit: 50, offset: 0 });
      expect(tasks).toHaveLength(2);
      expect(tasks.every((task) => task.backlogCurationPreview === undefined)).toBe(true);
      for (const row of tasks) {
        expect(row).toMatchObject({ available: true, status: 'completed', resultOmitted: true });
        const task = row.task as Record<string, unknown> | undefined;
        expect(task).toBeDefined();
        expect(task).toMatchObject({ taskId: expect.any(String), status: 'completed', createdAt: expect.any(String), updatedAt: expect.any(String), completedAt: expect.any(String) });
        expect(task).not.toHaveProperty('result');
      }
      const validDetail = await dispatchExtensionAction(load(), {
        actionId: 'eforge-plan:get-planning-agent-task',
        input: { taskId: 'task-curation-valid-preview' },
        requestedBy: { host: 'console' },
        cwd,
        timeoutMs: 1000,
        agentTasks,
      });
      expect(validDetail).toMatchObject({ kind: 'success', output: { task: { result: { backlogCurationDraft: expect.any(Object), recommendations: expect.any(Object) } } } });
      const validPreview = await dispatchExtensionAction(load(), {
        actionId: 'eforge-plan:preview-backlog-curation-task',
        input: { taskId: 'task-curation-valid-preview' },
        requestedBy: { host: 'console' },
        cwd,
        timeoutMs: 1000,
        agentTasks,
      });
      const malformedPreview = await dispatchExtensionAction(load(), {
        actionId: 'eforge-plan:preview-backlog-curation-task',
        input: { taskId: 'task-curation-malformed-preview' },
        requestedBy: { host: 'console' },
        cwd,
        timeoutMs: 1000,
        agentTasks,
      });
      expect(validPreview).toMatchObject({ kind: 'success', output: { valid: false, recommendationFreshness: { comparedSourceFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/) }, gitDelta: { baseline: expect.any(Object) }, generatedRecommendationValidation: { issues: [{ path: 'blockedChains.closed-chain.blockedBy', id: 'closed-dep', reason: 'closed', status: 'shipped' }] }, recommendationProjection: { effectiveRecommendations: expect.objectContaining({ blockedChains: [{ ref: 'closed-chain', itemIds: ['item-one'], blockedBy: ['closed-dep'], rationale: 'Historical dependency.' }] }), validation: { issues: [{ path: 'blockedChains.closed-chain.blockedBy', id: 'closed-dep', reason: 'closed', status: 'shipped' }] } } } });
      expect(malformedPreview).toMatchObject({ kind: 'success', output: { valid: false, errors: expect.any(Array) } });
    });
  });
  it('removes non-running planning tasks from the workflow index and rejects running tasks', async () => {
    await withTempProject(async (cwd) => {
      const base = { originalRequest: 'Plan', derivedRequest: 'Draft a session plan.', selection: { itemIds: ['item-one'] }, requestedOutputSections: ['sessionPlanCreationDraft' as const] };
      await recordPlanningTaskWorkflowEntry(cwd, { taskId: 'task-failed', createdAt: '2026-01-01T00:00:00.000Z', ...base });
      await recordPlanningTaskWorkflowEntry(cwd, { taskId: 'task-running', createdAt: '2026-01-02T00:00:00.000Z', ...base });
      const registry = load();
      const agentTasks = () => ({
        async start() { throw new Error('unexpected start'); },
        async get(taskId: string) {
          if (taskId === 'task-failed') return { task: { ...runningTask(taskId), status: 'failed' as const, completedAt: '2026-01-01T00:00:01.000Z', errorCode: 'failed', errorMessage: 'boom' } };
          return { task: runningTask(taskId) };
        },
        async cancel() { throw new Error('unexpected cancel'); },
      });
      const removed = await dispatchExtensionAction(registry, { actionId: 'eforge-plan:remove-planning-agent-task', input: { taskId: 'task-failed' }, requestedBy: { host: 'console' }, cwd, timeoutMs: 1000, agentTasks });
      expect(removed).toMatchObject({ kind: 'success', output: { taskId: 'task-failed', removed: true } });
      expect((await readPlanningTaskWorkflowIndex(cwd)).entries.map((entry) => entry.taskId)).toEqual(['task-running']);
      const rejected = await dispatchExtensionAction(registry, { actionId: 'eforge-plan:remove-planning-agent-task', input: { taskId: 'task-running' }, requestedBy: { host: 'console' }, cwd, timeoutMs: 1000, agentTasks });
      expect(rejected.kind).toBe('invalid-input');
      expect((await readPlanningTaskWorkflowIndex(cwd)).entries.map((entry) => entry.taskId)).toEqual(['task-running']);
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
      // Parse the serialized planner context to prove the preserved roadmap flag is honored.
      const source = JSON.parse(String(started?.input.sourceText));
      expect(source.context.roadmapContext.discoveredContextSources.length).toBe(includeRoadmap ? 1 : 0);
      if (includeRoadmap) {
        expect(source.context.roadmapContext.discoveredContextSources[0].headings).toContain('Roadmap');
      } else {
        expect(source.context.roadmapContext.assumptions.join('\n')).toMatch(/includeRoadmap was false/);
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
  it('retries a backlog-curation workflow with current curation source and preserved purpose', async () => {
    await withTempProject(async (cwd) => {
      await writeBacklogItem(cwd, { id: 'item-one', status: 'candidate', body: '# Item One\n\n## Claim\n\nCurate it.\n' });
      await recordPlanningTaskWorkflowEntry(cwd, {
        taskId: 'task-curation-original',
        createdAt: '2026-01-01T00:00:00.000Z',
        originalRequest: '',
        derivedRequest: 'Analyze and curate all open eforge-plan backlog records.',
        selection: {},
        requestedOutputSections: ['backlogCurationDraft', 'recommendations'],
        includeRoadmap: true,
        purpose: 'backlog-curation',
        itemAuditConcurrency: 6,
        sourceFingerprint: 'old-fingerprint',
      });
      let started: { input: Record<string, unknown> } | undefined;
      const result = await dispatchExtensionAction(load(), {
        actionId: 'eforge-plan:retry-planning-agent-task',
        input: { taskId: 'task-curation-original' },
        requestedBy: { host: 'console' },
        cwd,
        timeoutMs: 1000,
        agentTasks: () => ({
          async start(request) { started = request as { input: Record<string, unknown> }; return { task: runningTask('task-curation-retry') }; },
          async get() { throw new Error('unexpected get'); },
          async cancel() { throw new Error('unexpected cancel'); },
        }),
      });
      expect(result).toMatchObject({ kind: 'success', output: { entry: { parentTaskId: 'task-curation-original', purpose: 'backlog-curation', itemAuditConcurrency: 6, requestedOutputSections: ['backlogCurationDraft', 'recommendations'] } } });
      expect((result as { output: { entry: { sourceFingerprint?: string } } }).output.entry.sourceFingerprint).toBeUndefined();
      expect(started?.input).toMatchObject({ requestedOutputSections: ['backlogCurationDraft', 'recommendations'], includeRoadmap: true, sourceProvider: { module: './dist/backlog-curation-source-provider.js', exportName: 'buildSource', input: { itemAuditConcurrency: 6 } } });
      expect(started?.input.sourceText).toBeUndefined();
    });
  });
  it('redrafts a completed backlog curation task with prior draft context and steering', async () => {
    await withTempProject(async (cwd) => {
      await writeBacklogItem(cwd, { id: 'item-one', status: 'candidate', body: '# Item One\n\n## Claim\n\nCurate it.\n' });
      await recordPlanningTaskWorkflowEntry(cwd, {
        taskId: 'task-curation',
        createdAt: '2026-01-01T00:00:00.000Z',
        originalRequest: '',
        derivedRequest: 'Analyze and curate all open eforge-plan backlog records.',
        selection: {},
        requestedOutputSections: ['backlogCurationDraft', 'recommendations'],
        includeRoadmap: true,
        purpose: 'backlog-curation',
        itemAuditConcurrency: 7,
        sourceFingerprint: '1111111111111111111111111111111111111111111111111111111111111111',
      });
      let started: { input: Record<string, unknown> } | undefined;
      const result = await dispatchExtensionAction(load(), {
        actionId: 'eforge-plan:redraft-planning-agent-task',
        input: { taskId: 'task-curation', steering: 'Prefer conservative status changes.' },
        requestedBy: { host: 'console' },
        cwd,
        timeoutMs: 1000,
        agentTasks: () => ({
          async start(request) { started = request as { input: Record<string, unknown> }; return { task: runningTask('task-curation-redraft') }; },
          async get() { return { task: curationCompletedTask('task-curation') }; },
          async cancel() { throw new Error('unexpected cancel'); },
        }),
      });
      expect(result).toMatchObject({ kind: 'success', output: { entry: { parentTaskId: 'task-curation', purpose: 'backlog-curation', itemAuditConcurrency: 7, requestedOutputSections: ['backlogCurationDraft', 'recommendations'] } } });
      expect((result as { output: { entry: { sourceFingerprint?: string } } }).output.entry.sourceFingerprint).toBeUndefined();
      expect(started?.input.sourceText).toBeUndefined();
      expect(started?.input).toMatchObject({ sourceProvider: { module: './dist/backlog-curation-source-provider.js', exportName: 'buildSource', input: { itemAuditConcurrency: 7, redraft: { parentTaskId: 'task-curation', steering: 'Prefer conservative status changes.', previousBacklogCurationDraft: expect.any(Object) } } } });
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
      await recordPlanningTaskWorkflowEntry(cwd, { taskId: 'task-parent', createdAt: '2026-01-01T00:00:00.000Z', originalRequest: 'Plan the auth refactor', derivedRequest: 'Draft a session plan for Item One.', selection: { itemIds: ['item-one'] }, requestedOutputSections: ['sessionPlanCreationDraft'] });
      const readyResult = parseExtensionAgentTaskRecord({
        taskId: 'task-parent', kind: 'eforge-plan.planning-draft', status: 'completed', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:01.000Z', startedAt: '2026-01-01T00:00:00.000Z', completedAt: '2026-01-01T00:00:01.000Z',
        result: { summary: 'Ready to draft.', assumptionsOpenQuestions: [], decision: 'ready', sessionPlanCreationDraft: { session: 'task-parent', topic: 'Topic', planningType: 'feature', planningDepth: 'focused', sections: [{ dimension: 'scope', content: 'Scope.' }] } },
      });
      const needsInputNoQuestions = {
        taskId: 'task-parent', kind: 'eforge-plan.planning-draft', status: 'completed', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:01.000Z', startedAt: '2026-01-01T00:00:00.000Z', completedAt: '2026-01-01T00:00:01.000Z',
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
        expect(result.kind).toBe('invalid-input');
        expect(starts).toBe(0);
      }
    });
  });
});
