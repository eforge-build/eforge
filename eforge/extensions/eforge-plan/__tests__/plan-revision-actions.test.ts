import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { dispatchExtensionAction } from '@eforge-build/engine/extensions/action-runtime.js';
import { createExtensionRecorder } from '@eforge-build/engine/extensions/recorder.js';
import { parseExtensionAgentTaskRecord, type ExtensionAgentTaskRecord } from '@eforge-build/client';
import type { NativeExtensionRecorderState, NativeExtensionRegistry } from '@eforge-build/engine/extensions/types.js';
import eforgePlanExtension from '../index.js';

async function withTempProject<T>(fn: (cwd: string) => Promise<T>): Promise<T> {
  const cwd = await mkdtemp(join(tmpdir(), 'eforge-plan-revision-actions-'));
  try { return await fn(cwd); } finally { await rm(cwd, { recursive: true, force: true }); }
}

function registry(): NativeExtensionRegistry {
  const { api, state } = createExtensionRecorder('eforge-plan', '/project/eforge/extensions/eforge-plan/index.ts');
  eforgePlanExtension(api as never);
  expect(state.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')).toEqual([]);
  return { ...(state as NativeExtensionRecorderState), extensions: [], candidates: [] };
}

async function writeSessionPlanRaw(cwd: string, session: string, scope = 'Existing scope.', status = 'planning', openQuestions: string[] = []) {
  await mkdir(join(cwd, '.eforge', 'session-plans'), { recursive: true });
  const openQuestionsYaml = openQuestions.length === 0 ? ' []' : `\n${openQuestions.map((question) => `  - ${question}`).join('\n')}`;
  await writeFile(join(cwd, '.eforge', 'session-plans', `${session}.md`), `---
session: ${session}
topic: ${session}
status: ${status}
planning_type: feature
planning_depth: quick
required_dimensions:
  - problem-statement
  - scope
  - acceptance-criteria
  - assumptions-and-validation
optional_dimensions: []
skipped_dimensions: []
open_questions:${openQuestionsYaml}
profile: null
---
# ${session}

## Problem Statement

Problem evidence.

## Scope

${scope}

## Acceptance Criteria

- \`pnpm type-check\` exits 0.

## Assumptions And Validation

Validation plan.
`, 'utf-8');
}

function queuedTask(taskId: string): ExtensionAgentTaskRecord {
  return { taskId, kind: 'eforge-plan.planning-draft', status: 'queued', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' };
}

function completedRevisionTask(taskId: string, targetSession: string, basePlanFingerprint: string, sections?: Array<{ dimension: string; content: string }>, openQuestions?: string[]): ExtensionAgentTaskRecord {
  const proposedPatch = sections ? { sections, ...(openQuestions !== undefined && { metadata: { openQuestions } }) } : undefined;
  return parseExtensionAgentTaskRecord({
    taskId,
    kind: 'eforge-plan.planning-draft',
    status: 'completed',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:01.000Z',
    startedAt: '2026-01-01T00:00:00.000Z',
    completedAt: '2026-01-01T00:00:01.000Z',
    result: { summary: 'Revision turn.', assumptionsOpenQuestions: [], planRevisionTurn: { schemaVersion: 1, targetSession, assistantMessage: 'Apply this revision.', basePlanFingerprint, ...(proposedPatch ? { proposedPatch } : { noPatchReason: 'Answer only.' }) } },
  });
}

function completedNeedsInputTask(taskId: string): ExtensionAgentTaskRecord {
  return parseExtensionAgentTaskRecord({
    taskId,
    kind: 'eforge-plan.planning-draft',
    status: 'completed',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:01.000Z',
    startedAt: '2026-01-01T00:00:00.000Z',
    completedAt: '2026-01-01T00:00:01.000Z',
    result: { summary: 'Need clarification.', assumptionsOpenQuestions: [], decision: 'needs-input', clarificationQuestions: [{ question: 'Which section should change?', why: 'The request is ambiguous.' }], rationale: 'The request is ambiguous.' },
  });
}

async function dispatch(cwd: string, actionId: string, input: Record<string, unknown>, tasks: Map<string, ExtensionAgentTaskRecord>, starts: unknown[] = [], buildEnqueues?: unknown[]) {
  const result = await dispatchExtensionAction(registry(), {
    actionId: `eforge-plan:${actionId}`,
    input,
    requestedBy: { host: 'console' },
    cwd,
    timeoutMs: 1000,
    agentTasks: () => ({
      async start(request) {
        starts.push(request);
        const task = queuedTask(`task-${starts.length}`);
        tasks.set(task.taskId, task);
        return { task };
      },
      async get(taskId) {
        const task = tasks.get(taskId);
        if (task === undefined) throw new Error(`missing ${taskId}`);
        return { task };
      },
      async cancel(taskId, reason) {
        const task = { ...queuedTask(taskId), status: 'cancelled' as const, cancelledAt: '2026-01-01T00:00:02.000Z', errorMessage: reason };
        tasks.set(taskId, task);
        return { task };
      },
    }),
    ...(buildEnqueues && { buildQueue: () => ({ async enqueue(request) { buildEnqueues.push(request); throw new Error('plan revision apply must not enqueue builds'); } }) }),
  });
  expect(result).toMatchObject({ kind: 'success' });
  if (result.kind !== 'success') throw new Error(result.message);
  return result.output as Record<string, unknown>;
}

describe('plan revision actions', () => {
  it('starts/list/gets/cancels revision turns with linked read-only planning tasks and bounded context', async () => {
    await withTempProject(async (cwd) => {
      await writeSessionPlanRaw(cwd, 'revise-me');
      const tasks = new Map<string, ExtensionAgentTaskRecord>();
      const starts: unknown[] = [];
      const session = await dispatch(cwd, 'start-plan-revision-session', { session: 'revise-me' }, tasks);
      expect(session).toMatchObject({ targetSession: 'revise-me', plan: expect.any(Object), readiness: expect.any(Object), path: expect.stringContaining('revise-me.md') });

      const turnOutput = await dispatch(cwd, 'start-plan-revision-turn', { session: 'revise-me', message: 'Tighten scope.' }, tasks, starts);
      const started = starts[0] as { task?: { id: string }; input: Record<string, unknown> };
      expect(started).toMatchObject({ task: { id: 'plan-revision' }, input: { session: 'revise-me', planningType: 'feature', planningDepth: 'quick', requestedOutputSections: ['planRevisionTurn'], existingSessionPlan: expect.stringContaining('Existing scope.') } });
      const source = JSON.parse(String(started.input.sourceText));
      expect(source.context).toMatchObject({ purpose: 'plan-revision-turn', targetSession: 'revise-me', userMessage: 'Tighten scope.', basePlanFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/), baseSectionHashes: expect.arrayContaining([expect.objectContaining({ dimension: 'scope' })]) });
      expect(turnOutput).toMatchObject({ turn: { taskId: 'task-1', userMessage: 'Tighten scope.', basePlanFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/) } });

      const blocked = await dispatchExtensionAction(registry(), { actionId: 'eforge-plan:start-plan-revision-turn', input: { session: 'revise-me', message: 'Again.' }, requestedBy: { host: 'console' }, cwd, timeoutMs: 1000, agentTasks: () => ({ async start() { throw new Error('should not start'); }, async get(taskId) { return { task: tasks.get(taskId)! }; }, async cancel() { throw new Error('unexpected'); } }) });
      expect(blocked).toMatchObject({ kind: 'invalid-input' });

      tasks.delete('task-1');
      const missingProjection = await dispatch(cwd, 'get-plan-revision-session', { session: 'revise-me' }, tasks);
      expect(missingProjection.turns).toEqual([expect.objectContaining({ available: false, staleReason: expect.stringContaining('missing task-1') })]);
      tasks.set('task-1', queuedTask('task-1'));

      const listed = await dispatch(cwd, 'list-plan-revision-sessions', {}, tasks);
      expect(listed).toMatchObject({ total: 1, limit: 50, offset: 0 });
      expect(listed.sessions).toEqual([expect.objectContaining({ targetSession: 'revise-me', turns: [expect.objectContaining({ available: true, status: 'queued' })] })]);
      const emptyPage = await dispatch(cwd, 'list-plan-revision-sessions', { limit: 1, offset: 1 }, tasks);
      expect(emptyPage).toMatchObject({ sessions: [], total: 1, limit: 1, offset: 1 });
      const turnId = ((listed.sessions as Array<{ turns: Array<{ turn: { turnId: string } }> }>)[0].turns[0].turn.turnId);
      await dispatch(cwd, 'cancel-plan-revision-turn', { session: 'revise-me', turnId, reason: 'stop' }, tasks);
      expect(tasks.get('task-1')?.status).toBe('cancelled');
      await dispatch(cwd, 'cancel-plan-revision-turn', { session: 'revise-me', taskId: 'task-1', reason: 'stop again' }, tasks);
      expect(tasks.get('task-1')?.status).toBe('cancelled');
    });
  });

  it('allows new revision turns when an old daemon task lookup reports unknown task id', async () => {
    await withTempProject(async (cwd) => {
      await writeSessionPlanRaw(cwd, 'unknown-task');
      const tasks = new Map<string, ExtensionAgentTaskRecord>();
      const first = await dispatch(cwd, 'start-plan-revision-turn', { session: 'unknown-task', message: 'First.' }, tasks, []);
      const firstTurn = first.turn as { taskId: string };
      tasks.delete(firstTurn.taskId);
      const starts: unknown[] = [];
      const result = await dispatchExtensionAction(registry(), {
        actionId: 'eforge-plan:start-plan-revision-turn',
        input: { session: 'unknown-task', message: 'Second.' },
        requestedBy: { host: 'console' },
        cwd,
        timeoutMs: 1000,
        agentTasks: () => ({
          async start(request) {
            starts.push(request);
            const task = queuedTask('task-next');
            tasks.set(task.taskId, task);
            return { task };
          },
          async get(taskId) {
            const task = tasks.get(taskId);
            if (task === undefined) throw new Error(`Unknown task id: ${taskId}`);
            return { task };
          },
          async cancel() { throw new Error('unexpected'); },
        }),
      });
      expect(result).toMatchObject({ kind: 'success', output: { turn: { taskId: 'task-next', userMessage: 'Second.' } } });
      expect(starts).toHaveLength(1);
    });
  });

  it('retries turns and redrafts clarification answers with preserved linkage and bounded context', async () => {
    await withTempProject(async (cwd) => {
      await writeSessionPlanRaw(cwd, 'retry-me');
      const tasks = new Map<string, ExtensionAgentTaskRecord>();
      const starts: unknown[] = [];
      const first = await dispatch(cwd, 'start-plan-revision-turn', { session: 'retry-me', message: 'Clarify scope.' }, tasks, starts);
      const firstTurn = first.turn as { taskId: string; turnId: string };
      tasks.set(firstTurn.taskId, { ...queuedTask(firstTurn.taskId), status: 'cancelled', cancelledAt: '2026-01-01T00:00:02.000Z', errorMessage: 'cancelled for retry' } as ExtensionAgentTaskRecord);

      const retry = await dispatch(cwd, 'retry-plan-revision-turn', { session: 'retry-me', taskId: firstTurn.taskId }, tasks, starts);
      expect(retry).toMatchObject({ turn: { taskId: 'task-2', retryOfTaskId: firstTurn.taskId, userMessage: 'Clarify scope.' } });
      expect((starts[1] as { input: Record<string, unknown> }).input.requestedOutputSections).toEqual(['planRevisionTurn']);
      tasks.set('task-2', completedNeedsInputTask('task-2'));

      const redraft = await dispatch(cwd, 'retry-plan-revision-turn', {
        session: 'retry-me',
        taskId: 'task-2',
        answers: [{ questionId: 'q1', prompt: 'Which section should change?', answer: 'Revise only the scope section.' }],
        steering: 'Keep acceptance criteria unchanged.',
      }, tasks, starts);
      expect(redraft).toMatchObject({ turn: { taskId: 'task-3', redraftOfTaskId: 'task-2', parentTaskId: 'task-2', userMessage: 'Clarify scope.' } });
      const redraftSource = JSON.parse(String((starts[2] as { input: Record<string, unknown> }).input.sourceText));
      expect(redraftSource.redraft).toMatchObject({
        parentTaskId: 'task-2',
        previousQuestions: [expect.objectContaining({ question: 'Which section should change?' })],
        userAnswers: [expect.objectContaining({ answer: 'Revise only the scope section.' })],
        steering: 'Keep acceptance criteria unchanged.',
      });
    });
  });

  it('applies all proposed sections once, is idempotent on re-apply, and treats answer-only turns as not applicable', async () => {
    await withTempProject(async (cwd) => {
      await writeSessionPlanRaw(cwd, 'apply-me');
      const tasks = new Map<string, ExtensionAgentTaskRecord>();
      const start = await dispatch(cwd, 'start-plan-revision-turn', { session: 'apply-me', message: 'Patch scope.' }, tasks, []);
      const turn = start.turn as { taskId: string; basePlanFingerprint: string };
      tasks.set(turn.taskId, completedRevisionTask(turn.taskId, 'apply-me', turn.basePlanFingerprint, [{ dimension: 'scope', content: 'Generated scope only.' }, { dimension: 'acceptance-criteria', content: '- Generated AC.' }]));
      const buildEnqueues: unknown[] = [];
      const applied = await dispatch(cwd, 'apply-plan-revision-turn', { session: 'apply-me', taskId: turn.taskId }, tasks, [], buildEnqueues);
      expect(applied).toMatchObject({ kind: 'applied', session: 'apply-me', taskId: turn.taskId, appliedSections: ['scope', 'acceptance-criteria'], plan: expect.any(Object), readiness: expect.any(Object), path: expect.stringContaining('apply-me.md') });
      expect(buildEnqueues).toEqual([]);
      const raw = await readFile(join(cwd, '.eforge', 'session-plans', 'apply-me.md'), 'utf-8');
      expect(raw).toContain('status: planning');
      expect(raw).toContain('Generated scope only.');
      expect(raw).toContain('- Generated AC.');

      // Re-applying the same completed turn is idempotent: it returns applied without rewriting the plan.
      const reapplied = await dispatch(cwd, 'apply-plan-revision-turn', { session: 'apply-me', taskId: turn.taskId }, tasks, [], buildEnqueues);
      expect(reapplied).toMatchObject({ kind: 'applied', session: 'apply-me', taskId: turn.taskId, appliedSections: expect.arrayContaining(['scope', 'acceptance-criteria']), message: expect.stringContaining('already applied') });

      const second = await dispatch(cwd, 'start-plan-revision-turn', { session: 'apply-me', message: 'Answer.' }, tasks, []);
      const secondTurn = second.turn as { taskId: string; basePlanFingerprint: string };
      tasks.set(secondTurn.taskId, completedRevisionTask(secondTurn.taskId, 'apply-me', secondTurn.basePlanFingerprint));
      const answerOnly = await dispatch(cwd, 'apply-plan-revision-turn', { session: 'apply-me', taskId: secondTurn.taskId }, tasks);
      expect(answerOnly).toMatchObject({ kind: 'not-applicable' });
    });
  });

  it('applies resolved open questions from patch metadata, clearing the stale frontmatter list', async () => {
    await withTempProject(async (cwd) => {
      await writeSessionPlanRaw(cwd, 'oq', 'Existing scope.', 'planning', ['Stale assumption about naming?']);
      const tasks = new Map<string, ExtensionAgentTaskRecord>();
      const start = await dispatch(cwd, 'start-plan-revision-turn', { session: 'oq', message: 'Resolve the open questions.' }, tasks, []);
      const turn = start.turn as { taskId: string; basePlanFingerprint: string };
      tasks.set(turn.taskId, completedRevisionTask(turn.taskId, 'oq', turn.basePlanFingerprint, [{ dimension: 'scope', content: 'Tightened scope.' }], []));
      const applied = await dispatch(cwd, 'apply-plan-revision-turn', { session: 'oq', taskId: turn.taskId }, tasks);
      expect(applied).toMatchObject({ kind: 'applied', appliedSections: ['scope'] });
      const raw = await readFile(join(cwd, '.eforge', 'session-plans', 'oq.md'), 'utf-8');
      expect(raw).toContain('Tightened scope.');
      expect(raw).not.toContain('Stale assumption about naming?');
      expect(raw).toContain('open_questions: []');
    });
  });

  it('returns not-applicable without writes for invalid linkage, mismatched results, and invalid patches', async () => {
    await withTempProject(async (cwd) => {
      await writeSessionPlanRaw(cwd, 'invalid-apply', 'Original scope.', 'planning');
      const planPath = join(cwd, '.eforge', 'session-plans', 'invalid-apply.md');
      const tasks = new Map<string, ExtensionAgentTaskRecord>();
      const starts: unknown[] = [];

      const unlinked = await dispatch(cwd, 'apply-plan-revision-turn', { session: 'invalid-apply', taskId: 'task-unlinked' }, tasks);
      expect(unlinked).toMatchObject({ kind: 'not-applicable', session: 'invalid-apply', taskId: 'task-unlinked' });
      expect(await readFile(planPath, 'utf-8')).toContain('status: planning');
      expect(await readFile(planPath, 'utf-8')).toContain('Original scope.');

      const unresolvedTurn = await dispatch(cwd, 'apply-plan-revision-turn', { session: 'invalid-apply', turnId: 'missing/turn' }, tasks);
      expect(unresolvedTurn).toMatchObject({ kind: 'not-applicable', session: 'invalid-apply', turnId: 'missing/turn' });
      expect(unresolvedTurn).not.toHaveProperty('taskId');

      const prunedTask = await dispatch(cwd, 'start-plan-revision-turn', { session: 'invalid-apply', message: 'Pruned task.' }, tasks, starts);
      const prunedTurn = prunedTask.turn as { taskId: string };
      tasks.delete(prunedTurn.taskId);
      const missingTask = await dispatch(cwd, 'apply-plan-revision-turn', { session: 'invalid-apply', taskId: prunedTurn.taskId }, tasks);
      expect(missingTask).toMatchObject({ kind: 'not-applicable', session: 'invalid-apply', taskId: prunedTurn.taskId, message: expect.stringContaining(`missing ${prunedTurn.taskId}`) });

      const targetMismatch = await dispatch(cwd, 'start-plan-revision-turn', { session: 'invalid-apply', message: 'Target mismatch.' }, tasks, starts);
      const targetTurn = targetMismatch.turn as { taskId: string; basePlanFingerprint: string };
      tasks.set(targetTurn.taskId, completedRevisionTask(targetTurn.taskId, 'other-session', targetTurn.basePlanFingerprint, [{ dimension: 'scope', content: 'Wrong target.' }]));
      await expectNotApplicableWithoutWrite(cwd, tasks, targetTurn.taskId, 'invalid-apply', 'Wrong target.');

      const fingerprintMismatch = await dispatch(cwd, 'start-plan-revision-turn', { session: 'invalid-apply', message: 'Fingerprint mismatch.' }, tasks, starts);
      const fingerprintTurn = fingerprintMismatch.turn as { taskId: string };
      tasks.set(fingerprintTurn.taskId, completedRevisionTask(fingerprintTurn.taskId, 'invalid-apply', 'f'.repeat(64), [{ dimension: 'scope', content: 'Wrong fingerprint.' }]));
      await expectNotApplicableWithoutWrite(cwd, tasks, fingerprintTurn.taskId, 'invalid-apply', 'Wrong fingerprint.');

      const duplicatePatch = await dispatch(cwd, 'start-plan-revision-turn', { session: 'invalid-apply', message: 'Duplicate patch.' }, tasks, starts);
      const duplicateTurn = duplicatePatch.turn as { taskId: string; basePlanFingerprint: string };
      tasks.set(duplicateTurn.taskId, completedRevisionTask(duplicateTurn.taskId, 'invalid-apply', duplicateTurn.basePlanFingerprint, [{ dimension: 'Scope', content: 'First duplicate.' }, { dimension: 'scope', content: 'Second duplicate.' }]));
      const duplicate = await dispatch(cwd, 'apply-plan-revision-turn', { session: 'invalid-apply', taskId: duplicateTurn.taskId }, tasks);
      expect(duplicate).toMatchObject({ kind: 'not-applicable', session: 'invalid-apply', taskId: duplicateTurn.taskId, message: expect.stringContaining('duplicate patches') });

      const emptyPatchDimension = await dispatch(cwd, 'start-plan-revision-turn', { session: 'invalid-apply', message: 'Empty normalized patch dimension.' }, tasks, starts);
      const emptyPatchTurn = emptyPatchDimension.turn as { taskId: string; basePlanFingerprint: string };
      tasks.set(emptyPatchTurn.taskId, completedRevisionTask(emptyPatchTurn.taskId, 'invalid-apply', emptyPatchTurn.basePlanFingerprint, [{ dimension: '!!!', content: 'Empty normalized dimension.' }]));
      const emptyDimension = await dispatch(cwd, 'apply-plan-revision-turn', { session: 'invalid-apply', taskId: emptyPatchTurn.taskId }, tasks);
      expect(emptyDimension).toMatchObject({ kind: 'not-applicable', session: 'invalid-apply', taskId: emptyPatchTurn.taskId, message: expect.stringContaining('empty section dimension') });

      // A patch proposing a dimension outside the plan's allowed dimensions is rejected without writes.
      const invalidDimension = await dispatch(cwd, 'start-plan-revision-turn', { session: 'invalid-apply', message: 'Invalid dimension.' }, tasks, starts);
      const invalidDimensionTurn = invalidDimension.turn as { taskId: string; basePlanFingerprint: string };
      tasks.set(invalidDimensionTurn.taskId, completedRevisionTask(invalidDimensionTurn.taskId, 'invalid-apply', invalidDimensionTurn.basePlanFingerprint, [{ dimension: 'not-a-flat-plan-section', content: 'Bad dimension.' }]));
      const invalid = await dispatch(cwd, 'apply-plan-revision-turn', { session: 'invalid-apply', taskId: invalidDimensionTurn.taskId }, tasks);
      expect(invalid).toMatchObject({ kind: 'not-applicable', session: 'invalid-apply', taskId: invalidDimensionTurn.taskId, message: expect.stringContaining('not an allowed flat session-plan dimension') });

      const raw = await readFile(planPath, 'utf-8');
      expect(raw).toContain('status: planning');
      expect(raw).toContain('Original scope.');
      expect(raw).not.toContain('Bad dimension.');
    });
  });
});

async function expectNotApplicableWithoutWrite(cwd: string, tasks: Map<string, ExtensionAgentTaskRecord>, taskId: string, session: string, absentContent: string): Promise<void> {
  const result = await dispatch(cwd, 'apply-plan-revision-turn', { session, taskId }, tasks);
  expect(result).toMatchObject({ kind: 'not-applicable', session, taskId });
  const raw = await readFile(join(cwd, '.eforge', 'session-plans', `${session}.md`), 'utf-8');
  expect(raw).toContain('status: planning');
  expect(raw).toContain('Original scope.');
  expect(raw).not.toContain(absentContent);
}
