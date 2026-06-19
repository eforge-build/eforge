import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { dispatchExtensionAction } from '@eforge-build/engine/extensions/action-runtime.js';
import { createExtensionRecorder } from '@eforge-build/engine/extensions/recorder.js';
import { parseExtensionAgentTaskRecord, type ExtensionAgentTaskRecord } from '@eforge-build/client';
import type { NativeExtensionRecorderState, NativeExtensionRegistry } from '@eforge-build/engine/extensions/types.js';
import eforgePlanExtension from '../index.js';
import { buildPlanRevisionAnnotationSnapshot, derivePlanRevisionUserMessage } from '../plan-revision-annotations.js';
import { buildPlanRevisionSourceText } from '../plan-revision-orchestration.js';
import { readPlanRevisionIndex, resolvePlanRevisionIndexPath } from '../plan-revision-store.js';
import { MAX_PLAN_REVISION_ANNOTATIONS_PER_SESSION } from '../planning-agent-task-schemas.js';

async function withTempProject<T>(fn: (cwd: string) => Promise<T>): Promise<T> {
  const cwd = await mkdtemp(join(tmpdir(), 'eforge-plan-annotations-'));
  try { return await fn(cwd); } finally { await rm(cwd, { recursive: true, force: true }); }
}

function registry(): NativeExtensionRegistry {
  const { api, state } = createExtensionRecorder('eforge-plan', '/project/eforge/extensions/eforge-plan/index.ts');
  eforgePlanExtension(api as never);
  expect(state.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')).toEqual([]);
  return { ...(state as NativeExtensionRecorderState), extensions: [], candidates: [] };
}

async function writeSessionPlan(cwd: string, session: string, scope = 'Existing scope.') {
  await mkdir(join(cwd, '.eforge', 'session-plans'), { recursive: true });
  await writeFile(join(cwd, '.eforge', 'session-plans', `${session}.md`), `---
session: ${session}
topic: ${session}
status: planning
planning_type: feature
planning_depth: quick
required_dimensions: [problem-statement, scope, acceptance-criteria, assumptions-and-validation]
optional_dimensions: []
skipped_dimensions: []
open_questions: []
profile: null
---
# ${session}

## Problem Statement

Problem evidence.

## Scope

${scope}

## Acceptance Criteria

- Verify.

## Assumptions And Validation

Validation.
`, 'utf-8');
}

const target = { kind: 'selection', dimension: 'scope', label: 'Scope', capturedText: 'Existing scope.', quoteContext: { exact: 'Existing scope.', prefix: 'Scope', suffix: 'Acceptance' } } as const;

function queuedTask(taskId: string): ExtensionAgentTaskRecord {
  return { taskId, kind: 'eforge-plan.planning-draft', status: 'queued', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' };
}

function completedRevisionTask(taskId: string, targetSession: string, basePlanFingerprint: string, sections?: Array<{ dimension: string; content: string }>): ExtensionAgentTaskRecord {
  return parseExtensionAgentTaskRecord({ taskId, kind: 'eforge-plan.planning-draft', status: 'completed', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:01.000Z', startedAt: '2026-01-01T00:00:00.000Z', completedAt: '2026-01-01T00:00:01.000Z', result: { summary: 'Revision.', assumptionsOpenQuestions: [], planRevisionTurn: { schemaVersion: 1, targetSession, assistantMessage: 'Patch.', basePlanFingerprint, ...(sections === undefined ? { noPatchReason: 'Answer only.' } : { proposedPatch: { sections } }) } } });
}

function completedNeedsInputTask(taskId: string): ExtensionAgentTaskRecord {
  return parseExtensionAgentTaskRecord({ taskId, kind: 'eforge-plan.planning-draft', status: 'completed', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:01.000Z', startedAt: '2026-01-01T00:00:00.000Z', completedAt: '2026-01-01T00:00:01.000Z', result: { summary: 'Need clarification.', assumptionsOpenQuestions: [], decision: 'needs-input', clarificationQuestions: [{ question: 'Which section should change?' }], rationale: 'Ambiguous.' } });
}

function failedTask(taskId: string): ExtensionAgentTaskRecord {
  return { ...queuedTask(taskId), status: 'failed', startedAt: '2026-01-01T00:00:00.000Z', completedAt: '2026-01-01T00:00:01.000Z', errorCode: 'failed', errorMessage: 'failed' } as ExtensionAgentTaskRecord;
}

function cancelledTask(taskId: string): ExtensionAgentTaskRecord {
  return { ...queuedTask(taskId), status: 'cancelled', startedAt: '2026-01-01T00:00:00.000Z', cancelledAt: '2026-01-01T00:00:01.000Z', errorMessage: 'cancelled' } as ExtensionAgentTaskRecord;
}

function actionRuntime(cwd: string, tasks: Map<string, ExtensionAgentTaskRecord>, starts: unknown[] = []) {
  return { actionId: '', input: {}, requestedBy: { host: 'console' as const }, cwd, timeoutMs: 1000, agentTasks: () => ({ async start(request) { starts.push(request); const task = queuedTask(`task-${starts.length}`); tasks.set(task.taskId, task); return { task }; }, async get(taskId) { const task = tasks.get(taskId); if (!task) throw new Error(`missing ${taskId}`); return { task }; }, async cancel(taskId) { const task = cancelledTask(taskId); tasks.set(taskId, task); return { task }; } }) };
}

async function dispatchRaw(cwd: string, actionId: string, input: Record<string, unknown>, tasks: Map<string, ExtensionAgentTaskRecord>, starts: unknown[] = []) {
  return dispatchExtensionAction(registry(), { ...actionRuntime(cwd, tasks, starts), actionId: `eforge-plan:${actionId}`, input });
}

async function dispatch(cwd: string, actionId: string, input: Record<string, unknown>, tasks: Map<string, ExtensionAgentTaskRecord>, starts: unknown[] = []) {
  const result = await dispatchRaw(cwd, actionId, input, tasks, starts);
  expect(result).toMatchObject({ kind: 'success' });
  if (result.kind !== 'success') throw new Error(result.message);
  return result.output as Record<string, unknown>;
}

describe('plan revision annotations', () => {
  it('normalizes legacy revision sessions with annotations arrays', async () => {
    await withTempProject(async (cwd) => {
      const path = resolvePlanRevisionIndexPath(cwd);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, JSON.stringify({ schemaVersion: 1, sessions: [{ threadId: 'thread', targetSession: 's', turns: [], createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }] }), 'utf-8');
      expect(await readPlanRevisionIndex(cwd)).toMatchObject({ sessions: [{ targetSession: 's', annotations: [], turns: [] }] });
    });
  });

  it('builds selected/open snapshots without mutating historical copies', () => {
    const annotations = [{ annotationId: 'a1', targetSession: 's', body: 'Original', target, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }, { annotationId: 'a2', targetSession: 's', body: 'Resolved', target, resolvedAt: '2026-01-01T00:00:00.000Z', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }, { annotationId: 'a3', targetSession: 's', body: 'Dismissed', target, dismissedAt: '2026-01-01T00:00:00.000Z', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }];
    const snapshot = buildPlanRevisionAnnotationSnapshot({ annotations, annotationIds: ['a1'], includeOpenAnnotations: true, steering: 'Use these.', now: '2026-01-02T00:00:00.000Z' });
    expect(snapshot).toMatchObject({ steering: 'Use these.', selectedAnnotationIds: ['a1'], openAnnotationIds: ['a1'], annotations: [{ annotationId: 'a1', body: 'Original', snapshotReason: 'selected-and-open' }] });
    expect(snapshot?.openAnnotationIds).not.toEqual(expect.arrayContaining(['a2', 'a3']));
    const openOnly = buildPlanRevisionAnnotationSnapshot({ annotations, includeOpenAnnotations: true, now: '2026-01-02T00:00:00.000Z' });
    expect(openOnly).toMatchObject({ selectedAnnotationIds: [], openAnnotationIds: ['a1'], annotations: [{ annotationId: 'a1', snapshotReason: 'open' }] });
    const selectedOnly = buildPlanRevisionAnnotationSnapshot({ annotations, annotationIds: ['a1'], includeOpenAnnotations: false, now: '2026-01-02T00:00:00.000Z' });
    expect(selectedOnly).toMatchObject({ selectedAnnotationIds: ['a1'], openAnnotationIds: [], annotations: [{ annotationId: 'a1', snapshotReason: 'selected' }] });
    annotations[0].body = 'Edited later';
    expect(snapshot?.annotations[0].body).toBe('Original');
    expect(() => buildPlanRevisionAnnotationSnapshot({ annotations, annotationIds: ['missing'], now: '2026-01-02T00:00:00.000Z' })).toThrow(/Unknown/);
    expect(derivePlanRevisionUserMessage({ annotationIds: ['a1'] })).toBe('Revise from 1 plan annotation.');
  });

  it('rejects DOM-offset-only targets and closed selected annotations through action dispatch', async () => {
    await withTempProject(async (cwd) => {
      await writeSessionPlan(cwd, 'validate-targets');
      const tasks = new Map<string, ExtensionAgentTaskRecord>();
      const offsetOnly = await dispatchRaw(cwd, 'create-plan-revision-annotation', { session: 'validate-targets', target: { kind: 'selection', startOffset: 10, endOffset: 20 } }, tasks);
      expect(offsetOnly).toMatchObject({ kind: 'invalid-input' });
      expect(JSON.stringify(offsetOnly)).toMatch(/capturedText|quoteContext/);

      const created = await dispatch(cwd, 'create-plan-revision-annotation', { session: 'validate-targets', body: 'Already handled.', target }, tasks);
      const annotationId = (created.annotations as Array<{ annotationId: string }>)[0].annotationId;
      await dispatch(cwd, 'resolve-plan-revision-annotation', { session: 'validate-targets', annotationId }, tasks);
      const closedStart = await dispatchRaw(cwd, 'start-plan-revision-turn', { session: 'validate-targets', annotationIds: [annotationId] }, tasks);
      expect(closedStart).toMatchObject({ kind: 'invalid-input', message: expect.stringContaining('no longer unresolved') });
    });
  });

  it('starts open-annotation-only turns with derived messages and rejects empty open-only requests', async () => {
    await withTempProject(async (cwd) => {
      await writeSessionPlan(cwd, 'open-only');
      const tasks = new Map<string, ExtensionAgentTaskRecord>();
      const starts: unknown[] = [];
      const noOpen = await dispatchRaw(cwd, 'start-plan-revision-turn', { session: 'open-only', includeOpenAnnotations: true }, tasks, starts);
      expect(noOpen).toMatchObject({ kind: 'invalid-input', message: expect.stringContaining('no unresolved annotations') });
      expect(starts).toHaveLength(0);

      const created = await dispatch(cwd, 'create-plan-revision-annotation', { session: 'open-only', body: 'Use open annotation context.', target }, tasks);
      const annotationId = (created.annotations as Array<{ annotationId: string }>)[0].annotationId;
      const output = await dispatch(cwd, 'start-plan-revision-turn', { session: 'open-only', includeOpenAnnotations: true }, tasks, starts);
      expect(output.turn).toMatchObject({ userMessage: 'Revise from 1 plan annotation.', annotationSnapshot: { selectedAnnotationIds: [], openAnnotationIds: [annotationId], annotations: [{ annotationId, snapshotReason: 'open' }] } });
      const source = JSON.parse(String((starts[0] as { input: { sourceText: string } }).input.sourceText));
      expect(source.context).toMatchObject({ userMessage: 'Revise from 1 plan annotation.', annotationSnapshot: { includeOpenAnnotations: true, openAnnotationIds: [annotationId] } });
    });
  });

  it('dispatches annotation actions, snapshots source context, and resolves on successful apply', async () => {
    await withTempProject(async (cwd) => {
      await writeSessionPlan(cwd, 'annotated');
      const tasks = new Map<string, ExtensionAgentTaskRecord>();
      const starts: unknown[] = [];
      const created = await dispatch(cwd, 'create-plan-revision-annotation', { session: 'annotated', body: 'Fix this scope.', target }, tasks);
      const annotation = (created.annotations as Array<{ annotationId: string }>)[0];
      const secondCreated = await dispatch(cwd, 'create-plan-revision-annotation', { session: 'annotated', body: 'Keep this separate.', target: { ...target, label: 'Other scope' } }, tasks);
      const otherAnnotation = (secondCreated.annotations as Array<{ annotationId: string }>).find((entry) => entry.annotationId !== annotation.annotationId)!;
      await dispatch(cwd, 'update-plan-revision-annotation', { session: 'annotated', annotationId: annotation.annotationId, body: 'Fix this scope now.' }, tasks);
      const start = await dispatch(cwd, 'start-plan-revision-turn', { session: 'annotated', annotationIds: [annotation.annotationId], includeOpenAnnotations: false, steering: 'Prefer minimal edits.' }, tasks, starts);
      const turn = start.turn as { taskId: string; turnId: string; basePlanFingerprint: string; annotationSnapshot: { annotations: Array<{ annotationId: string; body?: string }> } };
      expect(turn.annotationSnapshot.annotations).toMatchObject([{ annotationId: annotation.annotationId, body: 'Fix this scope now.' }]);
      const source = JSON.parse(String((starts[0] as { input: { sourceText: string } }).input.sourceText));
      expect(source.context.annotationSnapshot).toMatchObject({ steering: 'Prefer minimal edits.', annotations: [expect.objectContaining({ target: expect.objectContaining({ kind: 'selection', dimension: 'scope', quoteContext: expect.objectContaining({ exact: 'Existing scope.' }) }) })] });
      await dispatch(cwd, 'update-plan-revision-annotation', { session: 'annotated', annotationId: annotation.annotationId, body: 'Edited after start.' }, tasks);
      expect((await readPlanRevisionIndex(cwd)).sessions[0].turns[0].annotationSnapshot?.annotations[0].body).toBe('Fix this scope now.');
      tasks.set(turn.taskId, completedRevisionTask(turn.taskId, 'annotated', turn.basePlanFingerprint, [{ dimension: 'scope', content: 'Revised scope.' }]));
      await dispatch(cwd, 'apply-plan-revision-turn', { session: 'annotated', turnId: turn.turnId }, tasks);
      const annotations = (await readPlanRevisionIndex(cwd)).sessions[0].annotations;
      const live = annotations.find((entry) => entry.annotationId === annotation.annotationId)!;
      const untouched = annotations.find((entry) => entry.annotationId === otherAnnotation.annotationId)!;
      expect(live).toMatchObject({ resolvedByTurnId: turn.turnId });
      expect(live.resolvedAt).toBeDefined();
      expect(untouched).not.toHaveProperty('resolvedAt');
      expect(untouched).not.toHaveProperty('resolvedByTurnId');
      const firstResolvedAt = live.resolvedAt;
      await dispatch(cwd, 'apply-plan-revision-turn', { session: 'annotated', turnId: turn.turnId }, tasks);
      expect((await readPlanRevisionIndex(cwd)).sessions[0].annotations.find((entry) => entry.annotationId === annotation.annotationId)?.resolvedAt).toBe(firstResolvedAt);
    });
  });

  it('supports update, manual resolve, dismiss, delete, and annotation cap enforcement through actions', async () => {
    await withTempProject(async (cwd) => {
      await writeSessionPlan(cwd, 'mutate');
      const tasks = new Map<string, ExtensionAgentTaskRecord>();
      const first = await dispatch(cwd, 'create-plan-revision-annotation', { session: 'mutate', body: 'First note.', target }, tasks);
      const firstId = (first.annotations as Array<{ annotationId: string }>)[0].annotationId;
      const blockTarget = { ...target, kind: 'block', label: 'Rendered block', capturedText: 'Block text.', quoteContext: { exact: 'Block text.', prefix: 'Before', suffix: 'After' } };
      const updated = await dispatch(cwd, 'update-plan-revision-annotation', { session: 'mutate', annotationId: firstId, body: 'Updated note.', target: blockTarget }, tasks);
      expect((updated.annotations as Array<Record<string, unknown>>).find((annotation) => annotation.annotationId === firstId)).toMatchObject({ body: 'Updated note.', target: { kind: 'block', dimension: 'scope', capturedText: 'Block text.', quoteContext: { exact: 'Block text.' } } });

      const second = await dispatch(cwd, 'create-plan-revision-annotation', { session: 'mutate', body: 'Resolve me.', target }, tasks);
      const secondId = (second.annotations as Array<{ annotationId: string }>)[0].annotationId;
      const resolved = await dispatch(cwd, 'resolve-plan-revision-annotation', { session: 'mutate', annotationId: secondId }, tasks);
      expect((resolved.annotations as Array<Record<string, unknown>>).find((annotation) => annotation.annotationId === secondId)).toMatchObject({ resolvedAt: expect.any(String) });
      expect((resolved.annotations as Array<Record<string, unknown>>).find((annotation) => annotation.annotationId === secondId)).not.toHaveProperty('resolvedByTurnId');

      const third = await dispatch(cwd, 'create-plan-revision-annotation', { session: 'mutate', body: 'Dismiss me.', target }, tasks);
      const thirdId = (third.annotations as Array<{ annotationId: string }>)[0].annotationId;
      const dismissed = await dispatch(cwd, 'dismiss-plan-revision-annotation', { session: 'mutate', annotationId: thirdId }, tasks);
      expect((dismissed.annotations as Array<Record<string, unknown>>).find((annotation) => annotation.annotationId === thirdId)).toMatchObject({ dismissedAt: expect.any(String) });

      const deleted = await dispatch(cwd, 'delete-plan-revision-annotation', { session: 'mutate', annotationId: firstId }, tasks);
      expect((deleted.annotations as Array<Record<string, unknown>>).some((annotation) => annotation.annotationId === firstId)).toBe(false);

      await writeSessionPlan(cwd, 'cap');
      for (let index = 0; index < MAX_PLAN_REVISION_ANNOTATIONS_PER_SESSION; index += 1) {
        await dispatch(cwd, 'create-plan-revision-annotation', { session: 'cap', body: `Note ${index}`, target }, tasks);
      }
      const capped = await dispatchRaw(cwd, 'create-plan-revision-annotation', { session: 'cap', body: 'Too many.', target }, tasks);
      expect(capped).toMatchObject({ kind: 'invalid-input', message: expect.stringContaining('maximum') });
    });
  });

  it('lists annotations only on plan-including session list projections', async () => {
    await withTempProject(async (cwd) => {
      await writeSessionPlan(cwd, 'projection');
      const tasks = new Map<string, ExtensionAgentTaskRecord>();
      await dispatch(cwd, 'create-plan-revision-annotation', { session: 'projection', body: 'Projected when plan included.', target }, tasks);

      const withoutPlan = await dispatch(cwd, 'list-plan-revision-sessions', { includePlan: false }, tasks);
      expect((withoutPlan.sessions as Array<Record<string, unknown>>)[0]).not.toHaveProperty('annotations');
      expect((withoutPlan.sessions as Array<Record<string, unknown>>)[0]).not.toHaveProperty('plan');

      const withPlan = await dispatch(cwd, 'list-plan-revision-sessions', { includePlan: true }, tasks);
      expect((withPlan.sessions as Array<Record<string, unknown>>)[0]).toMatchObject({ annotations: [expect.objectContaining({ body: 'Projected when plan included.' })], plan: expect.any(Object) });
    });
  });

  it('summarizes oversized annotation fallback source context with bounded semantic targets', () => {
    const snapshot = buildPlanRevisionAnnotationSnapshot({
      annotations: [{ annotationId: 'a1', targetSession: 'fallback', body: 'body '.repeat(200), target: { kind: 'selection', dimension: 'scope', label: 'Scope'.repeat(80), capturedText: 'captured '.repeat(900), quoteContext: { exact: 'captured '.repeat(900), prefix: 'prefix '.repeat(300), suffix: 'suffix '.repeat(300) } }, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }],
      annotationIds: ['a1'],
      includeOpenAnnotations: true,
      steering: 'steer',
      now: '2026-01-02T00:00:00.000Z',
    })!;
    const sourceText = buildPlanRevisionSourceText({
      targetSession: 'fallback',
      plan: { session: 'fallback', topic: 'Fallback', status: 'planning', planning_type: 'feature', planning_depth: 'quick', required_dimensions: ['scope'], optional_dimensions: [], skipped_dimensions: [], open_questions: [], sections: new Map([['scope', 'huge '.repeat(20000)]]) } as never,
      readiness: { ready: false },
      path: '.eforge/session-plans/fallback.md',
      basePlanFingerprint: 'a'.repeat(64),
      baseSectionHashes: [],
      recentTurns: Array.from({ length: 20 }, (_, index) => ({ turnId: `turn-${index}`, assistantMessage: 'previous '.repeat(700) })),
      userMessage: 'Revise from 1 plan annotation.',
      annotationSnapshot: snapshot,
    });
    const source = JSON.parse(sourceText);
    expect(source.truncation).toMatchObject({ revisionContextSummarized: true, sourceTextTruncated: true });
    expect(source.context.annotationSnapshot).toMatchObject({ includeOpenAnnotations: true, selectedCount: 1, openCount: 1, annotationCount: 1, annotations: [{ annotationId: 'a1', bodyPreview: expect.any(String), target: { kind: 'selection', dimension: 'scope', capturedTextPreview: expect.any(String), quoteContext: { exactPreview: expect.any(String), prefixPreview: expect.any(String), suffixPreview: expect.any(String) } } }] });
    const summarized = source.context.annotationSnapshot.annotations[0];
    expect(summarized.bodyPreview.length).toBeLessThanOrEqual(160);
    expect(summarized.target.capturedTextPreview.length).toBeLessThanOrEqual(160);
    expect(summarized.target.quoteContext.exactPreview.length).toBeLessThanOrEqual(160);
    expect(summarized.target.quoteContext.prefixPreview.length).toBeLessThanOrEqual(120);
    expect(summarized.target.quoteContext.suffixPreview.length).toBeLessThanOrEqual(120);
    expect(summarized.target).not.toHaveProperty('capturedText');
    expect(summarized.target.quoteContext).not.toHaveProperty('exact');
    expect(summarized.target.quoteContext).not.toHaveProperty('prefix');
    expect(summarized.target.quoteContext).not.toHaveProperty('suffix');
  });

  it('keeps manual message-only turns compatible without annotation snapshots', async () => {
    await withTempProject(async (cwd) => {
      await writeSessionPlan(cwd, 'manual');
      const tasks = new Map<string, ExtensionAgentTaskRecord>();
      const starts: unknown[] = [];
      await dispatch(cwd, 'create-plan-revision-annotation', { session: 'manual', body: 'Open annotation.', target }, tasks);
      const output = await dispatch(cwd, 'start-plan-revision-turn', { session: 'manual', message: 'Manual edit request.' }, tasks, starts);
      expect(output.turn).not.toHaveProperty('annotationSnapshot');
      const stored = await readPlanRevisionIndex(cwd);
      expect(stored.sessions[0].turns[0]).not.toHaveProperty('annotationSnapshot');
      const source = JSON.parse(String((starts[0] as { input: { sourceText: string } }).input.sourceText));
      expect(source.context).not.toHaveProperty('annotationSnapshot');
      expect(source.context).toMatchObject({ userMessage: 'Manual edit request.' });
    });
  });

  it('preserves parent annotation snapshots across retry and redraft turns', async () => {
    await withTempProject(async (cwd) => {
      await writeSessionPlan(cwd, 'retry-snapshot');
      await writeSessionPlan(cwd, 'redraft-snapshot');
      const tasks = new Map<string, ExtensionAgentTaskRecord>();
      const starts: unknown[] = [];

      const retryCreated = await dispatch(cwd, 'create-plan-revision-annotation', { session: 'retry-snapshot', body: 'Original retry body.', target }, tasks);
      const retryAnnotationId = (retryCreated.annotations as Array<{ annotationId: string }>)[0].annotationId;
      const retryParent = await dispatch(cwd, 'start-plan-revision-turn', { session: 'retry-snapshot', annotationIds: [retryAnnotationId], includeOpenAnnotations: true }, tasks, starts);
      const retryParentTurn = retryParent.turn as { taskId: string; turnId: string };
      tasks.set(retryParentTurn.taskId, failedTask(retryParentTurn.taskId));
      await dispatch(cwd, 'update-plan-revision-annotation', { session: 'retry-snapshot', annotationId: retryAnnotationId, body: 'Edited before retry.' }, tasks);
      const retryChild = await dispatch(cwd, 'retry-plan-revision-turn', { session: 'retry-snapshot', turnId: retryParentTurn.turnId }, tasks, starts);
      expect(retryChild.turn).toMatchObject({ retryOfTaskId: retryParentTurn.taskId, annotationSnapshot: { annotations: [expect.objectContaining({ annotationId: retryAnnotationId, body: 'Original retry body.' })] } });

      const redraftCreated = await dispatch(cwd, 'create-plan-revision-annotation', { session: 'redraft-snapshot', body: 'Original redraft body.', target }, tasks);
      const redraftAnnotationId = (redraftCreated.annotations as Array<{ annotationId: string }>)[0].annotationId;
      const redraftParent = await dispatch(cwd, 'start-plan-revision-turn', { session: 'redraft-snapshot', annotationIds: [redraftAnnotationId], includeOpenAnnotations: true }, tasks, starts);
      const redraftParentTurn = redraftParent.turn as { taskId: string; turnId: string };
      tasks.set(redraftParentTurn.taskId, completedNeedsInputTask(redraftParentTurn.taskId));
      await dispatch(cwd, 'update-plan-revision-annotation', { session: 'redraft-snapshot', annotationId: redraftAnnotationId, body: 'Edited before redraft.' }, tasks);
      const redraftChild = await dispatch(cwd, 'retry-plan-revision-turn', { session: 'redraft-snapshot', turnId: redraftParentTurn.turnId, answers: [{ answer: 'Revise the scope section.' }], steering: 'Keep the same annotation context.' }, tasks, starts);
      expect(redraftChild.turn).toMatchObject({ redraftOfTaskId: redraftParentTurn.taskId, annotationSnapshot: { annotations: [expect.objectContaining({ annotationId: redraftAnnotationId, body: 'Original redraft body.' })] } });
    });
  });

  it('leaves referenced annotations unresolved for non patch-bearing and rejected apply paths', async () => {
    await withTempProject(async (cwd) => {
      await writeSessionPlan(cwd, 'nonresolve');
      const tasks = new Map<string, ExtensionAgentTaskRecord>();
      const starts: unknown[] = [];
      const created = await dispatch(cwd, 'create-plan-revision-annotation', { session: 'nonresolve', body: 'Keep open until a real patch applies.', target }, tasks);
      const annotationId = (created.annotations as Array<{ annotationId: string }>)[0].annotationId;

      const cases: Array<{ label: string; taskForTurn: (turn: { taskId: string; basePlanFingerprint: string }) => ExtensionAgentTaskRecord }> = [
        { label: 'answer-only', taskForTurn: (turn) => completedRevisionTask(turn.taskId, 'nonresolve', turn.basePlanFingerprint) },
        { label: 'needs-input', taskForTurn: (turn) => completedNeedsInputTask(turn.taskId) },
        { label: 'failed', taskForTurn: (turn) => failedTask(turn.taskId) },
        { label: 'cancelled', taskForTurn: (turn) => cancelledTask(turn.taskId) },
        { label: 'mismatched-target', taskForTurn: (turn) => completedRevisionTask(turn.taskId, 'other-session', turn.basePlanFingerprint, [{ dimension: 'scope', content: 'Wrong target.' }]) },
        { label: 'mismatched-fingerprint', taskForTurn: (turn) => completedRevisionTask(turn.taskId, 'nonresolve', 'f'.repeat(64), [{ dimension: 'scope', content: 'Wrong fingerprint.' }]) },
        { label: 'duplicate-patch', taskForTurn: (turn) => completedRevisionTask(turn.taskId, 'nonresolve', turn.basePlanFingerprint, [{ dimension: 'Scope', content: 'First.' }, { dimension: 'scope', content: 'Second.' }]) },
        { label: 'invalid-dimension', taskForTurn: (turn) => completedRevisionTask(turn.taskId, 'nonresolve', turn.basePlanFingerprint, [{ dimension: 'not-a-section', content: 'Bad dimension.' }]) },
      ];

      for (const entry of cases) {
        const started = await dispatch(cwd, 'start-plan-revision-turn', { session: 'nonresolve', annotationIds: [annotationId], includeOpenAnnotations: true, steering: `Try ${entry.label}.` }, tasks, starts);
        const turn = started.turn as { taskId: string; basePlanFingerprint: string };
        tasks.set(turn.taskId, entry.taskForTurn(turn));
        const applied = await dispatch(cwd, 'apply-plan-revision-turn', { session: 'nonresolve', taskId: turn.taskId }, tasks);
        expect(applied, entry.label).toMatchObject({ kind: 'not-applicable' });
        const live = (await readPlanRevisionIndex(cwd)).sessions[0].annotations.find((annotation) => annotation.annotationId === annotationId);
        expect(live, entry.label).not.toHaveProperty('resolvedAt');
        expect(live, entry.label).not.toHaveProperty('resolvedByTurnId');
      }
    });
  });
});
