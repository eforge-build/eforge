import { randomUUID } from 'node:crypto';
import { defineExtensionAction, type ExtensionAction, type ExtensionActionContext } from '@eforge-build/extension-sdk';
import { EXTENSION_AGENT_TASK_KIND_EFORGE_PLAN_PLANNING_DRAFT, type ExtensionAgentTaskRecord } from '@eforge-build/client';
import { toJsonSafeObject } from './json-safe.js';
import {
  ApplyPlanRevisionTurnInputSchema,
  MAX_PLAN_REVISION_ANNOTATIONS_PER_SESSION,
  CreatePlanRevisionAnnotationInputSchema,
  DeletePlanRevisionAnnotationInputSchema,
  DismissPlanRevisionAnnotationInputSchema,
  ApplyPlanRevisionTurnOutputSchema,
  CancelPlanRevisionTurnInputSchema,
  GetPlanRevisionSessionInputSchema,
  ListPlanRevisionSessionsInputSchema,
  PlanRevisionSessionOutputSchema,
  ResolvePlanRevisionAnnotationInputSchema,
  PlanRevisionSessionsListOutputSchema,
  PlanRevisionTurnStartOutputSchema,
  RetryPlanRevisionTurnInputSchema,
  StartPlanRevisionSessionInputSchema,
  StartPlanRevisionTurnInputSchema,
  UpdatePlanRevisionAnnotationInputSchema,
  type PlanRevisionIndex,
  type PlanRevisionSessionEntry,
  type PlanRevisionTurnEntry,
} from './planning-agent-task-schemas.js';
import { userActionError } from './action-errors.js';
import {
  createPlanRevisionAnnotation,
  deletePlanRevisionAnnotation,
  dismissPlanRevisionAnnotation,
  ensurePlanRevisionSession,
  findPlanRevisionSession,
  findPlanRevisionTurn,
  listPlanRevisionSessions,
  markPlanRevisionTurnApplied,
  readPlanRevisionIndex,
  resolvePlanRevisionAnnotation,
  recordPlanRevisionTurn,
  updatePlanRevisionAnnotation,
} from './plan-revision-store.js';
import { buildPlanRevisionAnnotationSnapshot, derivePlanRevisionUserMessage, isOpenPlanRevisionAnnotation } from './plan-revision-annotations.js';
import {
  applyRevisionPatchSections,
  buildPlanRevisionSourceText,
  buildRecentRevisionTurnContext,
  computeFlatPlanFingerprint,
  computeFlatSectionHashes,
  loadFlatPlanRevisionTarget,
  projectRevisionPlanResult,
  resolveCompletedRevisionTurnResult,
  validateRevisionPatchSections,
} from './plan-revision-orchestration.js';

export const PLAN_REVISION_REQUESTED_OUTPUT_SECTIONS = ['planRevisionTurn'] as const;
const startChains = new Map<string, Promise<unknown>>();

export const startPlanRevisionSessionAction = defineExtensionAction({
  id: 'start-plan-revision-session',
  title: 'Start plan revision session',
  description: 'Create or resume an eforge-plan-owned revision session for a flat session plan.',
  inputSchema: StartPlanRevisionSessionInputSchema,
  outputSchema: PlanRevisionSessionOutputSchema,
  sideEffects: ['local-read', 'local-write'],
  async handler(input, ctx) {
    await loadFlatPlanRevisionTarget(ctx.cwd, input.session);
    await ensurePlanRevisionSession(ctx.cwd, input.session);
    return toJsonSafeObject(await projectSession(ctx, input.session, { includePlan: true }));
  },
});

export const listPlanRevisionSessionsAction = defineExtensionAction({
  id: 'list-plan-revision-sessions',
  title: 'List plan revision sessions',
  description: 'List eforge-plan-owned revision sessions joined to daemon task records.',
  inputSchema: ListPlanRevisionSessionsInputSchema,
  outputSchema: PlanRevisionSessionsListOutputSchema,
  sideEffects: ['local-read'],
  async handler(input, ctx) {
    const index = await readPlanRevisionIndex(ctx.cwd);
    const allSessions = listPlanRevisionSessions(index, { includeDismissed: input.includeDismissed });
    const offset = input.offset ?? 0;
    const limit = input.limit ?? 50;
    const sessions = await Promise.all(allSessions.slice(offset, offset + limit).map((session) => projectSessionEntry(ctx, session, { includePlan: input.includePlan === true, includeAnnotations: input.includePlan === true })));
    return toJsonSafeObject({ sessions, total: allSessions.length, limit, offset });
  },
});

export const getPlanRevisionSessionAction = defineExtensionAction({
  id: 'get-plan-revision-session',
  title: 'Get plan revision session',
  description: 'Read one eforge-plan-owned revision session joined to daemon task records.',
  inputSchema: GetPlanRevisionSessionInputSchema,
  outputSchema: PlanRevisionSessionOutputSchema,
  sideEffects: ['local-read'],
  async handler(input, ctx) {
    const session = requireSession(await readPlanRevisionIndex(ctx.cwd), input);
    return toJsonSafeObject(await projectSessionEntry(ctx, session, { includePlan: input.includePlan !== false, includeAnnotations: true }));
  },
});

export const createPlanRevisionAnnotationAction = defineExtensionAction({
  id: 'create-plan-revision-annotation',
  title: 'Create plan revision annotation',
  description: 'Persist an annotation for a flat session-plan revision session.',
  inputSchema: CreatePlanRevisionAnnotationInputSchema,
  outputSchema: PlanRevisionSessionOutputSchema,
  sideEffects: ['local-read', 'local-write'],
  async handler(input, ctx) {
    await loadFlatPlanRevisionTarget(ctx.cwd, input.session);
    const session = await ensurePlanRevisionSession(ctx.cwd, input.session);
    if (session.annotations.length >= MAX_PLAN_REVISION_ANNOTATIONS_PER_SESSION) throw userActionError(`Plan revision session ${input.session} already has the maximum ${MAX_PLAN_REVISION_ANNOTATIONS_PER_SESSION} annotations.`, { path: 'session', details: { session: input.session, max: MAX_PLAN_REVISION_ANNOTATIONS_PER_SESSION } });
    await createPlanRevisionAnnotation(ctx.cwd, input.session, { body: input.body, target: input.target });
    return toJsonSafeObject(await projectSession(ctx, input.session, { includePlan: false, includeAnnotations: true }));
  },
});

export const updatePlanRevisionAnnotationAction = defineExtensionAction({
  id: 'update-plan-revision-annotation',
  title: 'Update plan revision annotation',
  description: 'Update a persisted plan revision annotation.',
  inputSchema: UpdatePlanRevisionAnnotationInputSchema,
  outputSchema: PlanRevisionSessionOutputSchema,
  sideEffects: ['local-read', 'local-write'],
  async handler(input, ctx) {
    await loadFlatPlanRevisionTarget(ctx.cwd, input.session);
    await requireAnnotation(ctx.cwd, input.session, input.annotationId);
    await updatePlanRevisionAnnotation(ctx.cwd, input.session, input.annotationId, { body: input.body, target: input.target });
    return toJsonSafeObject(await projectSession(ctx, input.session, { includePlan: false, includeAnnotations: true }));
  },
});

export const deletePlanRevisionAnnotationAction = defineExtensionAction({
  id: 'delete-plan-revision-annotation',
  title: 'Delete plan revision annotation',
  description: 'Delete a persisted plan revision annotation.',
  inputSchema: DeletePlanRevisionAnnotationInputSchema,
  outputSchema: PlanRevisionSessionOutputSchema,
  sideEffects: ['local-read', 'local-write'],
  async handler(input, ctx) {
    await loadFlatPlanRevisionTarget(ctx.cwd, input.session);
    await requireAnnotation(ctx.cwd, input.session, input.annotationId);
    await deletePlanRevisionAnnotation(ctx.cwd, input.session, input.annotationId);
    return toJsonSafeObject(await projectSession(ctx, input.session, { includePlan: false, includeAnnotations: true }));
  },
});

export const resolvePlanRevisionAnnotationAction = defineExtensionAction({
  id: 'resolve-plan-revision-annotation',
  title: 'Resolve plan revision annotation',
  description: 'Mark a plan revision annotation resolved.',
  inputSchema: ResolvePlanRevisionAnnotationInputSchema,
  outputSchema: PlanRevisionSessionOutputSchema,
  sideEffects: ['local-read', 'local-write'],
  async handler(input, ctx) {
    await loadFlatPlanRevisionTarget(ctx.cwd, input.session);
    await requireAnnotation(ctx.cwd, input.session, input.annotationId);
    await resolvePlanRevisionAnnotation(ctx.cwd, input.session, input.annotationId);
    return toJsonSafeObject(await projectSession(ctx, input.session, { includePlan: false, includeAnnotations: true }));
  },
});

export const dismissPlanRevisionAnnotationAction = defineExtensionAction({
  id: 'dismiss-plan-revision-annotation',
  title: 'Dismiss plan revision annotation',
  description: 'Mark a plan revision annotation dismissed.',
  inputSchema: DismissPlanRevisionAnnotationInputSchema,
  outputSchema: PlanRevisionSessionOutputSchema,
  sideEffects: ['local-read', 'local-write'],
  async handler(input, ctx) {
    await loadFlatPlanRevisionTarget(ctx.cwd, input.session);
    await requireAnnotation(ctx.cwd, input.session, input.annotationId);
    await dismissPlanRevisionAnnotation(ctx.cwd, input.session, input.annotationId);
    return toJsonSafeObject(await projectSession(ctx, input.session, { includePlan: false, includeAnnotations: true }));
  },
});

export const startPlanRevisionTurnAction = defineExtensionAction({
  id: 'start-plan-revision-turn',
  title: 'Start plan revision turn',
  description: 'Start one read-only daemon planning task for a user revision message.',
  inputSchema: StartPlanRevisionTurnInputSchema,
  outputSchema: PlanRevisionTurnStartOutputSchema,
  sideEffects: ['local-read', 'local-write', 'daemon-state'],
  async handler(input, ctx) {
    return toJsonSafeObject(await enqueueTurnExclusive(ctx, input.session, () => startTurn(ctx, { session: input.session, message: input.message, annotationIds: input.annotationIds, includeOpenAnnotations: input.includeOpenAnnotations, steering: input.steering })));
  },
});

export const retryPlanRevisionTurnAction = defineExtensionAction({
  id: 'retry-plan-revision-turn',
  title: 'Retry plan revision turn',
  description: 'Retry a revision turn or redraft it from clarification answers.',
  inputSchema: RetryPlanRevisionTurnInputSchema,
  outputSchema: PlanRevisionTurnStartOutputSchema,
  sideEffects: ['local-read', 'local-write', 'daemon-state'],
  async handler(input, ctx) {
    return toJsonSafeObject(await enqueueTurnExclusive(ctx, input.session, async () => {
      const session = findPlanRevisionSession(await readPlanRevisionIndex(ctx.cwd), { session: input.session });
      if (session === undefined) throw new Error(`No plan revision session found for ${input.session}.`);
      const parent = findPlanRevisionTurn(session, input);
      if (parent === undefined) throw new Error('No linked plan revision turn found.');
      const redraft = input.answers !== undefined || input.steering !== undefined;
      const priorQuestions = redraft ? await assertNeedsInputParent(ctx, parent.taskId) : undefined;
      if (!redraft) await assertRetriableParent(ctx, parent.taskId);
      return startTurn(ctx, {
        session: input.session,
        message: parent.userMessage,
        parentAnnotationSnapshot: parent.annotationSnapshot,
        parentTaskId: parent.taskId,
        retryOfTaskId: redraft ? undefined : parent.taskId,
        redraftOfTaskId: redraft ? parent.taskId : undefined,
        redraft: redraft ? { parentTaskId: parent.taskId, previousQuestions: priorQuestions, userAnswers: input.answers, steering: input.steering } : undefined,
      });
    }));
  },
});

export const cancelPlanRevisionTurnAction = defineExtensionAction({
  id: 'cancel-plan-revision-turn',
  title: 'Cancel plan revision turn',
  description: 'Cancel the daemon task linked to a stored revision turn.',
  inputSchema: CancelPlanRevisionTurnInputSchema,
  outputSchema: PlanRevisionSessionOutputSchema,
  sideEffects: ['local-write', 'daemon-state'],
  async handler(input, ctx) {
    const turn = await requireTurn(ctx.cwd, input.session, input);
    await ctx.agentTasks.cancel(turn.taskId, input.reason);
    return toJsonSafeObject(await projectSession(ctx, input.session, { includePlan: true }));
  },
});

export const applyPlanRevisionTurnAction = defineExtensionAction({
  id: 'apply-plan-revision-turn',
  title: 'Apply plan revision turn',
  description: 'Apply the structured section edits from a completed revision turn to the flat session plan.',
  inputSchema: ApplyPlanRevisionTurnInputSchema,
  outputSchema: ApplyPlanRevisionTurnOutputSchema,
  sideEffects: ['local-read', 'local-write'],
  async handler(input, ctx) {
    let storedTurn: PlanRevisionTurnEntry;
    try {
      storedTurn = await requireTurn(ctx.cwd, input.session, input);
    } catch (err) {
      return toJsonSafeObject(notApplicable(input.session, input, errorMessage(err)));
    }
    let task: ExtensionAgentTaskRecord;
    try {
      task = (await ctx.agentTasks.get(storedTurn.taskId)).task;
    } catch (err) {
      return toJsonSafeObject(notApplicable(input.session, { taskId: storedTurn.taskId }, errorMessage(err)));
    }
    const loaded = await loadFlatPlanRevisionTarget(ctx.cwd, input.session);
    let turnResult;
    try {
      turnResult = resolveCompletedRevisionTurnResult(task, storedTurn, input.session);
    } catch (err) {
      return toJsonSafeObject(notApplicable(input.session, { taskId: storedTurn.taskId }, errorMessage(err)));
    }
    const validated = validateRevisionPatchSections(loaded.plan, turnResult);
    if (!validated.ok) return toJsonSafeObject(notApplicable(input.session, { taskId: storedTurn.taskId }, validated.message));
    const sections = validated.sections.map((section) => section.dimension);
    // A revision turn applies all of its proposed sections exactly once. Re-apply
    // requests (e.g. a duplicate auto-apply) return the already-applied result
    // without rewriting the plan.
    if (storedTurn.appliedAt !== undefined) {
      return toJsonSafeObject({ kind: 'applied', turnId: storedTurn.turnId, taskId: storedTurn.taskId, appliedSections: storedTurn.appliedSections ?? sections, message: 'Plan revision sections were already applied.', ...projectRevisionPlanResult(ctx.cwd, input.session, loaded.plan) });
    }
    const applied = await applyRevisionPatchSections(ctx.cwd, input.session, turnResult, sections);
    const appliedAt = new Date().toISOString();
    await markPlanRevisionTurnApplied(ctx.cwd, input.session, { taskId: storedTurn.taskId }, appliedAt, sections, { resolveReferencedAnnotations: true });
    return toJsonSafeObject({ kind: 'applied', turnId: storedTurn.turnId, taskId: storedTurn.taskId, appliedSections: sections, message: 'Applied plan revision sections.', ...applied });
  },
});

export const planRevisionActions: readonly ExtensionAction<any, any>[] = [startPlanRevisionSessionAction, listPlanRevisionSessionsAction, getPlanRevisionSessionAction, createPlanRevisionAnnotationAction, updatePlanRevisionAnnotationAction, deletePlanRevisionAnnotationAction, resolvePlanRevisionAnnotationAction, dismissPlanRevisionAnnotationAction, startPlanRevisionTurnAction, retryPlanRevisionTurnAction, cancelPlanRevisionTurnAction, applyPlanRevisionTurnAction];

async function enqueueTurnExclusive<T>(ctx: ExtensionActionContext, session: string, task: () => Promise<T>): Promise<T> {
  const key = `${ctx.cwd}\0${session}`;
  const prior = startChains.get(key) ?? Promise.resolve();
  const result = prior.then(task, task);
  let chain: Promise<unknown>;
  chain = result.then(() => undefined, () => undefined).finally(() => {
    if (startChains.get(key) === chain) startChains.delete(key);
  });
  startChains.set(key, chain);
  return result;
}

async function startTurn(ctx: ExtensionActionContext, params: { session: string; message?: string; annotationIds?: string[]; includeOpenAnnotations?: boolean; steering?: string; parentAnnotationSnapshot?: PlanRevisionTurnEntry['annotationSnapshot']; parentTaskId?: string; retryOfTaskId?: string; redraftOfTaskId?: string; redraft?: Record<string, unknown> }) {
  const loaded = await loadFlatPlanRevisionTarget(ctx.cwd, params.session);
  const session = await ensurePlanRevisionSession(ctx.cwd, params.session);
  await assertNoActiveTurn(ctx, session);
  const annotationDriven = (params.annotationIds?.length ?? 0) > 0 || params.steering !== undefined;
  const includeOpenAnnotations = params.parentAnnotationSnapshot === undefined ? params.includeOpenAnnotations ?? annotationDriven : params.parentAnnotationSnapshot.includeOpenAnnotations;
  const openCount = session.annotations.filter(isOpenPlanRevisionAnnotation).length;
  if (params.message === undefined && params.steering === undefined && (params.annotationIds?.length ?? 0) === 0 && params.includeOpenAnnotations === true && openCount === 0) throw userActionError('includeOpenAnnotations requested but no unresolved annotations exist.', { path: 'includeOpenAnnotations' });
  if (params.parentAnnotationSnapshot === undefined) assertAnnotationIdsOpen(session, params.annotationIds);
  const snapshot = params.parentAnnotationSnapshot ?? buildPlanRevisionAnnotationSnapshot({ annotations: session.annotations, annotationIds: params.annotationIds, includeOpenAnnotations, steering: params.steering, now: new Date().toISOString() });
  const userMessage = derivePlanRevisionUserMessage({ message: params.message, annotationIds: params.annotationIds, includeOpenAnnotations, steering: params.steering, openCount, annotationCount: snapshot?.annotations.length });
  const basePlanFingerprint = computeFlatPlanFingerprint(loaded.plan);
  const baseSectionHashes = computeFlatSectionHashes(loaded.plan);
  const recentTurns = await buildRecentRevisionTurnContext(ctx, session);
  const sourceText = buildPlanRevisionSourceText({ targetSession: params.session, plan: loaded.plan, readiness: loaded.readiness, path: loaded.path, sourceRefs: loaded.sourceRefs, lifecycle: loaded.lifecycle, basePlanFingerprint, baseSectionHashes, recentTurns, userMessage, annotationSnapshot: snapshot, redraft: params.redraft });
  const topic = `Revise session plan ${params.session}: ${userMessage}`;
  const response = await ctx.agentTasks.start({ kind: EXTENSION_AGENT_TASK_KIND_EFORGE_PLAN_PLANNING_DRAFT, input: { topic, session: params.session, planningType: loaded.plan.planning_type, planningDepth: loaded.plan.planning_depth, existingSessionPlan: loaded.rawMarkdown, sourceText, requestedOutputSections: [...PLAN_REVISION_REQUESTED_OUTPUT_SECTIONS] } });
  const turn: PlanRevisionTurnEntry = { turnId: randomUUID(), taskId: response.task.taskId, userMessage, basePlanFingerprint, baseSectionHashes, ...(params.parentTaskId !== undefined && { parentTaskId: params.parentTaskId }), ...(params.retryOfTaskId !== undefined && { retryOfTaskId: params.retryOfTaskId }), ...(params.redraftOfTaskId !== undefined && { redraftOfTaskId: params.redraftOfTaskId }), createdAt: new Date().toISOString(), ...(snapshot !== undefined && { annotationSnapshot: snapshot }) };
  try {
    await recordPlanRevisionTurn(ctx.cwd, params.session, turn);
  } catch (err) {
    try { await ctx.agentTasks.cancel(response.task.taskId, 'eforge-plan failed to record the durable plan revision turn; cancelling to avoid an unindexed task.'); } catch {}
    throw err;
  }
  return { task: response.task, turn, session: await projectSession(ctx, params.session, { includePlan: true, includeAnnotations: true }) };
}

async function assertNoActiveTurn(ctx: ExtensionActionContext, session: PlanRevisionSessionEntry): Promise<void> {
  for (const turn of session.turns) {
    try {
      const status = (await ctx.agentTasks.get(turn.taskId)).task.status;
      if (status === 'queued' || status === 'running') throw new Error(`Revision task ${turn.taskId} is ${status}; wait for it to finish or cancel it before starting another turn.`);
    } catch (err) {
      if (err instanceof Error && err.message.includes('wait for it')) throw err;
      if (!isStaleTaskLookupError(err)) throw err;
    }
  }
}

async function assertNeedsInputParent(ctx: ExtensionActionContext, taskId: string): Promise<unknown[]> {
  const task = (await ctx.agentTasks.get(taskId)).task as ExtensionAgentTaskRecord;
  const questions = (task as { result?: { clarificationQuestions?: unknown[]; decision?: unknown } }).result?.clarificationQuestions;
  if (task.status !== 'completed' || (task.result as { decision?: unknown }).decision !== 'needs-input' || !Array.isArray(questions) || questions.length === 0) {
    throw new Error(`Revision task ${taskId} is not a completed needs-input clarification result.`);
  }
  return questions;
}

async function assertRetriableParent(ctx: ExtensionActionContext, taskId: string): Promise<void> {
  const task = (await ctx.agentTasks.get(taskId)).task as ExtensionAgentTaskRecord;
  if (task.status !== 'failed' && task.status !== 'cancelled') {
    throw new Error(`Revision task ${taskId} is ${task.status}; only failed or cancelled revision turns can be retried without redraft answers.`);
  }
}

async function projectSession(ctx: ExtensionActionContext, sessionId: string, options: { includePlan?: boolean; includeAnnotations?: boolean }) {
  const session = findPlanRevisionSession(await readPlanRevisionIndex(ctx.cwd), { session: sessionId });
  if (session === undefined) throw new Error(`No plan revision session found for ${sessionId}.`);
  return projectSessionEntry(ctx, session, options);
}

async function projectSessionEntry(ctx: ExtensionActionContext, session: PlanRevisionSessionEntry, options: { includePlan?: boolean; includeAnnotations?: boolean }) {
  const turns = await Promise.all(session.turns.map(async (turn) => {
    try {
      const response = await ctx.agentTasks.get(turn.taskId);
      return { ...turn, turn, available: true, status: response.task.status, task: response.task };
    } catch (err) {
      return { ...turn, turn, available: false, staleReason: errorMessage(err) };
    }
  }));
  const plan = options.includePlan === true ? (await loadFlatPlanRevisionTarget(ctx.cwd, session.targetSession)).detail : undefined;
  return { threadId: session.threadId, targetSession: session.targetSession, turns, ...(options.includeAnnotations === true && { annotations: session.annotations }), createdAt: session.createdAt, updatedAt: session.updatedAt, ...plan };
}

function requireSession(index: PlanRevisionIndex, ref: { session?: string; threadId?: string }): PlanRevisionSessionEntry {
  const session = findPlanRevisionSession(index, ref);
  if (session === undefined) throw userActionError('No matching plan revision session found.', { path: ref.session !== undefined ? 'session' : 'threadId', details: { ...(ref.session !== undefined && { session: ref.session }), ...(ref.threadId !== undefined && { threadId: ref.threadId }) } });
  return session;
}

async function requireAnnotation(cwd: string, sessionId: string, annotationId: string): Promise<void> {
  const session = findPlanRevisionSession(await readPlanRevisionIndex(cwd), { session: sessionId });
  if (session === undefined) throw userActionError(`No plan revision session found for ${sessionId}.`, { path: 'session', details: { session: sessionId } });
  if (!session.annotations.some((annotation) => annotation.annotationId === annotationId)) throw userActionError(`No plan revision annotation found for ${sessionId}.`, { path: 'annotationId', details: { session: sessionId, annotationId } });
}

function assertAnnotationIdsOpen(session: PlanRevisionSessionEntry, annotationIds: string[] = []): void {
  const annotationsById = new Map(session.annotations.map((annotation) => [annotation.annotationId, annotation]));
  const missing = annotationIds.filter((id) => !annotationsById.has(id));
  if (missing.length > 0) throw userActionError(`Unknown plan revision annotation ids: ${missing.join(', ')}.`, { path: 'annotationIds', details: { session: session.targetSession, annotationIds: missing } });
  const closed = annotationIds.filter((id) => {
    const annotation = annotationsById.get(id);
    return annotation !== undefined && !isOpenPlanRevisionAnnotation(annotation);
  });
  if (closed.length > 0) throw userActionError(`Plan revision annotation ids are no longer unresolved: ${closed.join(', ')}.`, { path: 'annotationIds', details: { session: session.targetSession, annotationIds: closed } });
}

async function requireTurn(cwd: string, sessionId: string, ref: { taskId?: string; turnId?: string }): Promise<PlanRevisionTurnEntry> {
  const session = findPlanRevisionSession(await readPlanRevisionIndex(cwd), { session: sessionId });
  if (session === undefined) throw userActionError(`No plan revision session found for ${sessionId}.`, { path: 'session', details: { session: sessionId } });
  const turn = findPlanRevisionTurn(session, ref);
  if (turn === undefined) throw new Error('No linked plan revision turn found.');
  return turn;
}

function notApplicable(session: string, ref: { taskId?: string; turnId?: string }, message: string) {
  return { kind: 'not-applicable' as const, session, ...(ref.taskId !== undefined ? { taskId: ref.taskId } : { turnId: ref.turnId }), message };
}

function isStaleTaskLookupError(err: unknown): boolean {
  const message = errorMessage(err).toLowerCase();
  const status = typeof err === 'object' && err !== null && 'status' in err ? (err as { status?: unknown }).status : undefined;
  const code = typeof err === 'object' && err !== null && 'code' in err ? (err as { code?: unknown }).code : undefined;
  return message.includes('missing') || message.includes('not found') || message.includes('unknown task id') || message.includes('404') || status === 404 || code === 404 || code === '404';
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
