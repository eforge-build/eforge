import { CONTRIBUTION_OUTPUT_PROFILES, defineExtensionAction, ExtensionActionInputValidationError, type ExtensionAction, type ExtensionActionContext } from '@eforge-build/extension-sdk';
import { EXTENSION_AGENT_TASK_KIND_EFORGE_PLAN_PLANNING_DRAFT, type EforgePlanPlanningSessionPlanCreationReadiness } from '@eforge-build/client';
import { getSessionPlanDimensionSpec, type PlanningDepth, type PlanningType } from '@eforge-build/input';
import {
  applyCompletedPlanningAgentTaskResult,
  preparePlannerContext,
} from './planner-orchestration.js';
import { toJsonSafeObject } from './json-safe.js';
import {
  findPlanningTaskWorkflowEntry,
  isBacklogCurationWorkflowEntry,
  isRecommendationRefreshWorkflowEntry,
  listPlanningTaskWorkflowEntries,
  readPlanningTaskWorkflowIndex,
  recordPlanningTaskWorkflowEntry,
  removePlanningTaskWorkflowEntry,
} from './planning-task-workflow-store.js';
import { buildRecommendationRefreshSource } from './recommendation-refresh.js';
import { buildBacklogCurationRedraftContext } from './backlog-curation-source.js';
import { BACKLOG_CURATION_SOURCE_PROVIDER } from './backlog-curation-actions.js';
import { normalizeItemAuditConcurrency } from './backlog-curation-source-first-audit.js';
import { previewBacklogCurationDraftFromTask } from './backlog-curation-apply.js';
import { boundedSourceText } from './planner-source-bounds.js';
import { userActionError } from './action-errors.js';
import { normalizePlanningAgentTaskListProjection, projectMissingPlanningAgentTaskListItem, projectPlanningAgentTaskListItem } from './planning-agent-task-projection.js';
import {
  ApplyPlanningAgentTaskResultInputSchema,
  ApplyPlanningAgentTaskResultOutputSchema,
  CancelPlanningAgentTaskInputSchema,
  ListPlanningAgentTasksInputSchema,
  ListPlanningAgentTasksOutputSchema,
  MAX_PLANNING_AGENT_USER_GOAL_LENGTH,
  GetPlanningAgentTaskInputSchema,
  PreviewBacklogCurationTaskInputSchema,
  PreviewBacklogCurationTaskOutputSchema,
  PlanningAgentTaskCancelOutputSchema,
  PlanningAgentTaskGetOutputSchema,
  PlanningAgentTaskStartOutputSchema,
  PlanningAgentTaskWorkflowStartOutputSchema,
  RedraftPlanningAgentTaskInputSchema,
  RemovePlanningAgentTaskInputSchema,
  RemovePlanningAgentTaskOutputSchema,
  RetryPlanningAgentTaskInputSchema,
  StartPlanningAgentTaskInputSchema,
  type PlanningAgentTaskWorkflowStartOutput,
  type PlanningTaskWorkflowEntry,
  type PlanningTaskWorkflowSelection,
  type StartPlanningAgentTaskInput,
} from './planning-agent-task-schemas.js';
import { PLANNING_DEPTHS, PLANNING_TYPES } from './schema.js';


type RequestedOutputSections = PlanningTaskWorkflowEntry['requestedOutputSections'];

export const startPlanningAgentTaskAction = defineExtensionAction({
  id: 'start-planning-agent-task',
  title: 'Start eforge-plan planning agent task',
  description: 'Prepare bounded planner context, then start one daemon-owned eforge-plan planning draft task.',
  inputSchema: StartPlanningAgentTaskInputSchema,
  outputSchema: PlanningAgentTaskStartOutputSchema,
  sideEffects: ['local-read', 'local-write', 'daemon-state'],
  async handler(input, ctx) {
    throwIfAborted(ctx.signal);
    validateSourceRecommendationRef(input);
    const selection = selectionFromInput(input);
    const context = await preparePlannerContext(ctx.cwd, {
      itemIds: input.itemIds,
      epicId: input.epicId,
      recommendationRef: input.recommendationRef,
      sourceRecommendationRef: input.sourceRecommendationRef,
      includeRoadmap: input.includeRoadmap,
    });
    throwIfAborted(ctx.signal);
    const derivedGoal = deriveUserGoal(input.userGoal, selection, context);
    const requestedOutputSections = resolveRequestedOutputSections(input, selection);
    const planningType = typeof input.planningType === 'string' ? input.planningType : undefined;
    const planningDepth = typeof input.planningDepth === 'string' ? input.planningDepth : undefined;
    const sourceText = boundedSourceText(derivedGoal, context);
    const sessionPlanCreationReadiness = buildSessionPlanCreationReadiness(requestedOutputSections, planningType, planningDepth);
    throwIfAborted(ctx.signal);
    const response = await ctx.agentTasks.start({
      kind: EXTENSION_AGENT_TASK_KIND_EFORGE_PLAN_PLANNING_DRAFT,
      input: {
        topic: derivedGoal,
        sourceText,
        ...(input.session !== undefined && { session: input.session }),
        ...(planningType !== undefined && { planningType }),
        ...(planningDepth !== undefined && { planningDepth }),
        ...(requestedOutputSections !== undefined && { requestedOutputSections }),
        ...(sessionPlanCreationReadiness !== undefined && { sessionPlanCreationReadiness }),
      },
    });
    await recordEntryOrCancelTask(ctx, response.task.taskId, buildEntry({
      taskId: response.task.taskId,
      originalRequest: input.userGoal ?? '',
      derivedRequest: derivedGoal,
      selection,
      requestedOutputSections,
      session: input.session,
      planningType,
      planningDepth,
      includeRoadmap: input.includeRoadmap,
    }));
    return response;
  },
});

export const getPlanningAgentTaskAction = defineExtensionAction({
  id: 'get-planning-agent-task',
  title: 'Get eforge-plan planning agent task',
  description: 'Read a daemon-owned eforge-plan planning agent task record.',
  inputSchema: GetPlanningAgentTaskInputSchema,
  outputSchema: PlanningAgentTaskGetOutputSchema,
  sideEffects: ['local-read'],
  async handler(input, ctx) {
    return await ctx.agentTasks.get(input.taskId);
  },
});

export const previewBacklogCurationTaskAction = defineExtensionAction({
  id: 'preview-backlog-curation-task',
  title: 'Preview backlog curation task validation',
  description: 'Validate a completed backlog-curation planning task on demand before apply without slowing task list rendering.',
  inputSchema: PreviewBacklogCurationTaskInputSchema,
  outputSchema: PreviewBacklogCurationTaskOutputSchema,
  sideEffects: ['local-read'],
  async handler(input, ctx) {
    const entry = findPlanningTaskWorkflowEntry(await readPlanningTaskWorkflowIndex(ctx.cwd), input.taskId);
    if (entry === undefined) return { valid: false, errors: [{ path: 'workflowEntry', message: `No preserved workflow context found for planning task ${input.taskId}.` }] };
    const response = await ctx.agentTasks.get(input.taskId);
    return await previewBacklogCurationDraftFromTask(ctx.cwd, response.task, entry);
  },
});

export const cancelPlanningAgentTaskAction = defineExtensionAction({
  id: 'cancel-planning-agent-task',
  title: 'Cancel eforge-plan planning agent task',
  description: 'Cancel a running daemon-owned eforge-plan planning agent task.',
  inputSchema: CancelPlanningAgentTaskInputSchema,
  outputSchema: PlanningAgentTaskCancelOutputSchema,
  sideEffects: ['local-write'],
  async handler(input, ctx) {
    return await ctx.agentTasks.cancel(input.taskId, input.reason);
  },
});

export const listPlanningAgentTasksAction = defineExtensionAction({
  id: 'list-planning-agent-tasks',
  title: 'List eforge-plan planning agent tasks',
  description: 'Project the durable planning task workflow index with compact, paginated task summaries by default for agent callers.',
  inputSchema: ListPlanningAgentTasksInputSchema,
  outputSchema: ListPlanningAgentTasksOutputSchema,
  outputProfile: CONTRIBUTION_OUTPUT_PROFILES.agentPaginated,
  sideEffects: ['local-read'],
  async handler(input, ctx) {
    const entries = listPlanningTaskWorkflowEntries(await readPlanningTaskWorkflowIndex(ctx.cwd)).filter((entry) => !isConsumedSessionPlanCreationEntry(entry));
    const projection = normalizePlanningAgentTaskListProjection(input, ctx.requestedBy.host, entries.length);
    const pageEntries = entries.slice(projection.offset, projection.offset + projection.limit);
    const tasks = await Promise.all(pageEntries.map(async (entry) => {
      try {
        const response = await ctx.agentTasks.get(entry.taskId);
        return projectPlanningAgentTaskListItem({ entry, task: response.task, includeEntry: projection.includeEntry, includeTask: projection.includeTask });
      } catch (err) {
        return projectMissingPlanningAgentTaskListItem({ entry, includeEntry: projection.includeEntry, staleReason: errorMessage(err) });
      }
    }));
    const nextOffset = projection.offset + tasks.length;
    return toJsonSafeObject({
      tasks,
      total: entries.length,
      returned: tasks.length,
      limit: projection.limit,
      offset: projection.offset,
      hasMore: nextOffset < entries.length,
      ...(nextOffset < entries.length ? { nextOffset } : {}),
    });
  },
});

export const removePlanningAgentTaskAction = defineExtensionAction({
  id: 'remove-planning-agent-task',
  title: 'Remove eforge-plan planning task from workflow list',
  description: 'Remove a completed, failed, cancelled, or stale planning task from the eforge-plan workflow index. Running tasks must be cancelled first.',
  inputSchema: RemovePlanningAgentTaskInputSchema,
  outputSchema: RemovePlanningAgentTaskOutputSchema,
  sideEffects: ['local-write'],
  async handler(input, ctx) {
    try {
      const response = await ctx.agentTasks.get(input.taskId);
      const status = response.task.status;
      if (status === 'queued' || status === 'running') {
        throw userActionError(`Task ${input.taskId} is ${status}; cancel it before removing it from the workflow list.`, { path: 'taskId', details: { taskId: input.taskId, status } });
      }
    } catch (err) {
      if (!isMissingTaskError(err)) throw err;
      // Stale index entries whose daemon record has already disappeared are safe
      // to remove because there is no live task left to manage.
    }
    const removed = await removePlanningTaskWorkflowEntry(ctx.cwd, input.taskId);
    return toJsonSafeObject({ taskId: input.taskId, removed });
  },
});

export const retryPlanningAgentTaskAction = defineExtensionAction({
  id: 'retry-planning-agent-task',
  title: 'Retry eforge-plan planning agent task',
  description: 'Start a new planning task reusing the preserved request context of a prior task.',
  inputSchema: RetryPlanningAgentTaskInputSchema,
  outputSchema: PlanningAgentTaskWorkflowStartOutputSchema,
  sideEffects: ['local-read', 'local-write', 'daemon-state'],
  async handler(input, ctx) {
    throwIfAborted(ctx.signal);
    const parent = requireWorkflowEntry(await readPlanningTaskWorkflowIndex(ctx.cwd), input.taskId, 'retry');
    if (isBacklogCurationWorkflowEntry(parent)) {
      const itemAuditConcurrency = normalizeItemAuditConcurrency(parent.itemAuditConcurrency);
      return await startLinkedTask(ctx, {
        parent,
        derivedGoal: parent.derivedRequest,
        sourceProvider: backlogCurationSourceProviderInput(undefined, itemAuditConcurrency),
        requestedOutputSections: parent.requestedOutputSections,
      });
    }
    const workflowSource = isRecommendationRefreshWorkflowEntry(parent)
      ? await buildRecommendationRefreshSource(ctx.cwd)
      : undefined;
    throwIfAborted(ctx.signal);
    const context = workflowSource === undefined ? await preparePlannerContext(ctx.cwd, plannerSelection(parent)) : undefined;
    throwIfAborted(ctx.signal);
    const derivedGoal = workflowSource === undefined ? explicitOrPreservedGoal(input.userGoal, parent, context!) : parent.derivedRequest;
    const sourceText = workflowSource?.sourceText ?? boundedSourceText(derivedGoal, context!);
    throwIfAborted(ctx.signal);
    return await startLinkedTask(ctx, {
      parent,
      derivedGoal,
      sourceText,
      sourceFingerprint: workflowSource?.sourceFingerprint,
      requestedOutputSections: parent.requestedOutputSections,
    });
  },
});

export const redraftPlanningAgentTaskAction = defineExtensionAction({
  id: 'redraft-planning-agent-task',
  title: 'Redraft eforge-plan planning agent task',
  description: 'Start a new planning task that includes prior summary/questions and the user clarification answers or steering.',
  inputSchema: RedraftPlanningAgentTaskInputSchema,
  outputSchema: PlanningAgentTaskWorkflowStartOutputSchema,
  sideEffects: ['local-read', 'local-write', 'daemon-state'],
  async handler(input, ctx) {
    throwIfAborted(ctx.signal);
    const parent = requireWorkflowEntry(await readPlanningTaskWorkflowIndex(ctx.cwd), input.taskId, 'redraft');
    const previous = await ctx.agentTasks.get(input.taskId);
    assertRedraftableParent(previous.task, input.taskId, isBacklogCurationWorkflowEntry(parent));
    const redraft = isBacklogCurationWorkflowEntry(parent)
      ? buildBacklogCurationRedraftContext(parent.taskId, completedTaskResult(previous.task), input)
      : buildRedraftContext(parent, previous.task, input);
    if (isBacklogCurationWorkflowEntry(parent)) {
      const itemAuditConcurrency = normalizeItemAuditConcurrency(parent.itemAuditConcurrency);
      return await startLinkedTask(ctx, {
        parent,
        derivedGoal: parent.derivedRequest,
        sourceProvider: backlogCurationSourceProviderInput(redraft, itemAuditConcurrency),
        requestedOutputSections: parent.requestedOutputSections,
      });
    }
    const workflowSource = isRecommendationRefreshWorkflowEntry(parent)
      ? await buildRecommendationRefreshSource(ctx.cwd, redraft)
      : undefined;
    throwIfAborted(ctx.signal);
    const context = workflowSource === undefined ? await preparePlannerContext(ctx.cwd, plannerSelection(parent)) : undefined;
    throwIfAborted(ctx.signal);
    const derivedGoal = workflowSource === undefined ? explicitOrPreservedGoal(undefined, parent, context!) : parent.derivedRequest;
    const sourceText = workflowSource?.sourceText ?? boundedSourceText(derivedGoal, context!, redraft);
    throwIfAborted(ctx.signal);
    return await startLinkedTask(ctx, {
      parent,
      derivedGoal,
      sourceText,
      sourceFingerprint: workflowSource?.sourceFingerprint,
      requestedOutputSections: parent.requestedOutputSections,
    });
  },
});

export const applyPlanningAgentTaskResultAction = defineExtensionAction({
  id: 'apply-planning-agent-task-result',
  title: 'Apply eforge-plan planning agent task result',
  description: 'Apply selected output from a completed planning-draft task through safe eforge-plan mutation helpers.',
  inputSchema: ApplyPlanningAgentTaskResultInputSchema,
  outputSchema: ApplyPlanningAgentTaskResultOutputSchema,
  sideEffects: ['local-write'],
  async handler(input, ctx) {
    assertApplySelection(input);
    const response = await ctx.agentTasks.get(input.taskId);
    return await applyCompletedPlanningAgentTaskResult(ctx.cwd, response.task, input);
  },
});

interface StartLinkedTaskParams {
  parent: PlanningTaskWorkflowEntry;
  derivedGoal: string;
  sourceText?: string;
  sourceProvider?: typeof BACKLOG_CURATION_SOURCE_PROVIDER & { input: { itemAuditConcurrency?: number; redraft?: Record<string, unknown> } };
  sourceFingerprint?: string;
  requestedOutputSections: RequestedOutputSections;
}

async function startLinkedTask(ctx: ExtensionActionContext, params: StartLinkedTaskParams): Promise<PlanningAgentTaskWorkflowStartOutput> {
  const { parent } = params;
  const requested = params.requestedOutputSections.length > 0 ? params.requestedOutputSections : undefined;
  const sessionPlanCreationReadiness = buildSessionPlanCreationReadiness(requested, parent.planningType, parent.planningDepth);
  const response = await ctx.agentTasks.start({
    kind: EXTENSION_AGENT_TASK_KIND_EFORGE_PLAN_PLANNING_DRAFT,
    input: {
      topic: params.derivedGoal,
      ...(params.sourceText !== undefined && { sourceText: params.sourceText }),
      ...(params.sourceProvider !== undefined && { sourceProvider: params.sourceProvider }),
      ...(parent.session !== undefined && { session: parent.session }),
      ...(parent.planningType !== undefined && { planningType: parent.planningType }),
      ...(parent.planningDepth !== undefined && { planningDepth: parent.planningDepth }),
      ...(parent.includeRoadmap !== undefined && { includeRoadmap: parent.includeRoadmap }),
      ...(requested !== undefined && { requestedOutputSections: requested }),
      ...(sessionPlanCreationReadiness !== undefined && { sessionPlanCreationReadiness }),
    },
  });
  const entry = await recordEntryOrCancelTask(ctx, response.task.taskId, buildEntry({
    taskId: response.task.taskId,
    parentTaskId: parent.taskId,
    originalRequest: parent.originalRequest,
    derivedRequest: params.derivedGoal,
    selection: parent.selection,
    requestedOutputSections: params.requestedOutputSections,
    session: parent.session,
    planningType: parent.planningType,
    planningDepth: parent.planningDepth,
    includeRoadmap: parent.includeRoadmap,
    purpose: isRecommendationRefreshWorkflowEntry(parent) || isBacklogCurationWorkflowEntry(parent) ? parent.purpose : undefined,
    itemAuditConcurrency: isBacklogCurationWorkflowEntry(parent) ? normalizeItemAuditConcurrency(parent.itemAuditConcurrency) : undefined,
    sourceFingerprint: params.sourceFingerprint ?? (params.sourceProvider === undefined ? parent.sourceFingerprint : undefined),
  }));
  return toJsonSafeObject({ task: response.task, entry });
}

// Record the durable workflow index entry only after the daemon task has started.
// If recording fails, the task would otherwise keep running without an index
// entry, so reload/list/retry/redraft could never discover it. Cancel the
// just-started task before rethrowing so it cannot continue unindexed.
async function recordEntryOrCancelTask(
  ctx: ExtensionActionContext,
  taskId: string,
  entry: PlanningTaskWorkflowEntry,
): Promise<PlanningTaskWorkflowEntry> {
  try {
    return await recordPlanningTaskWorkflowEntry(ctx.cwd, entry);
  } catch (recordError) {
    try {
      await ctx.agentTasks.cancel(taskId, 'eforge-plan failed to record the durable workflow index entry; cancelling to avoid an unindexed task.');
    } catch {
      // Surface the original recording failure even if cancellation also fails.
    }
    throw recordError;
  }
}

interface BuildEntryParams {
  taskId: string;
  parentTaskId?: string;
  originalRequest: string;
  derivedRequest: string;
  selection: PlanningTaskWorkflowSelection;
  requestedOutputSections: RequestedOutputSections | undefined;
  session?: string;
  planningType?: string;
  planningDepth?: string;
  includeRoadmap?: boolean;
  purpose?: PlanningTaskWorkflowEntry['purpose'];
  itemAuditConcurrency?: number;
  sourceFingerprint?: string;
}

function backlogCurationSourceProviderInput(redraft?: Record<string, unknown>, itemAuditConcurrency?: number): typeof BACKLOG_CURATION_SOURCE_PROVIDER & { input: { itemAuditConcurrency?: number; redraft?: Record<string, unknown> } } {
  return { ...BACKLOG_CURATION_SOURCE_PROVIDER, input: { ...(itemAuditConcurrency !== undefined && { itemAuditConcurrency }), ...(redraft !== undefined && { redraft }) } };
}

function buildEntry(params: BuildEntryParams): PlanningTaskWorkflowEntry {
  return {
    taskId: params.taskId,
    ...(params.parentTaskId !== undefined && { parentTaskId: params.parentTaskId }),
    originalRequest: params.originalRequest,
    derivedRequest: params.derivedRequest,
    selection: params.selection,
    requestedOutputSections: params.requestedOutputSections ?? [],
    ...(params.session !== undefined && { session: params.session }),
    ...(params.planningType !== undefined && { planningType: params.planningType }),
    ...(params.planningDepth !== undefined && { planningDepth: params.planningDepth }),
    ...(params.includeRoadmap !== undefined && { includeRoadmap: params.includeRoadmap }),
    ...(params.purpose !== undefined && { purpose: params.purpose }),
    ...(params.itemAuditConcurrency !== undefined && { itemAuditConcurrency: params.itemAuditConcurrency }),
    ...(params.sourceFingerprint !== undefined && { sourceFingerprint: params.sourceFingerprint }),
    createdAt: new Date().toISOString(),
  };
}

function validateSourceRecommendationRef(input: StartPlanningAgentTaskInput): void {
  if (input.sourceRecommendationRef !== undefined && input.itemIds === undefined) {
    throw new ExtensionActionInputValidationError('sourceRecommendationRef requires itemIds.', [{ path: 'sourceRecommendationRef', message: 'sourceRecommendationRef records recommendation-lane provenance for an explicit itemIds selection; use recommendationRef when the recommendation itself is the selector.' }]);
  }
}

function selectionFromInput(input: StartPlanningAgentTaskInput): PlanningTaskWorkflowSelection {
  return {
    ...(input.itemIds !== undefined && { itemIds: input.itemIds }),
    ...(input.epicId !== undefined && { epicId: input.epicId }),
    ...(input.recommendationRef !== undefined && { recommendationRef: input.recommendationRef }),
    ...(input.sourceRecommendationRef !== undefined && { sourceRecommendationRef: input.sourceRecommendationRef }),
  };
}

function plannerSelection(entry: PlanningTaskWorkflowEntry) {
  return {
    itemIds: entry.selection.itemIds,
    epicId: entry.selection.epicId,
    recommendationRef: entry.selection.recommendationRef,
    sourceRecommendationRef: entry.selection.sourceRecommendationRef,
    includeRoadmap: entry.includeRoadmap,
  };
}

function hasBacklogSelection(selection: PlanningTaskWorkflowSelection): boolean {
  return selection.itemIds !== undefined || selection.epicId !== undefined || selection.recommendationRef !== undefined;
}

function isConsumedSessionPlanCreationEntry(entry: PlanningTaskWorkflowEntry): boolean {
  return entry.appliedAt !== undefined
    && !isBacklogCurationWorkflowEntry(entry)
    && entry.requestedOutputSections.includes('sessionPlanCreationDraft');
}

// --- eforge:region session-plan-creation-readiness ---
function buildSessionPlanCreationReadiness(
  requestedOutputSections: RequestedOutputSections | undefined,
  planningType: string | undefined,
  planningDepth: string | undefined,
): EforgePlanPlanningSessionPlanCreationReadiness | undefined {
  if (!requestedOutputSections?.includes('sessionPlanCreationDraft')) return undefined;
  const dimensionContract = Object.fromEntries(PLANNING_TYPES.map((type) => [
    type,
    Object.fromEntries(PLANNING_DEPTHS.map((depth) => [depth, dimensionEntry(type, depth)])),
  ])) as EforgePlanPlanningSessionPlanCreationReadiness['dimensionContract'];
  const resolved = isPlanningType(planningType) && isPlanningDepth(planningDepth)
    ? { planningType, planningDepth, ...dimensionEntry(planningType, planningDepth) }
    : undefined;
  return {
    dimensionContract,
    ...(resolved !== undefined && { resolved }),
  };
}

function dimensionEntry(planningType: PlanningType, planningDepth: PlanningDepth): { requiredDimensions: string[]; optionalDimensions: string[] } {
  const spec = getSessionPlanDimensionSpec(planningType, planningDepth);
  return { requiredDimensions: [...spec.required], optionalDimensions: [...spec.optional] };
}

function isPlanningType(value: string | undefined): value is PlanningType {
  return value !== undefined && (PLANNING_TYPES as readonly string[]).includes(value);
}

function isPlanningDepth(value: string | undefined): value is PlanningDepth {
  return value !== undefined && (PLANNING_DEPTHS as readonly string[]).includes(value);
}
// --- eforge:endregion session-plan-creation-readiness ---

function resolveRequestedOutputSections(input: StartPlanningAgentTaskInput, selection: PlanningTaskWorkflowSelection): RequestedOutputSections | undefined {
  if (input.requestedOutputSections !== undefined) return input.requestedOutputSections;
  if (hasBacklogSelection(selection)) return ['sessionPlanCreationDraft'];
  return undefined;
}

interface PlannerContextLike { items: Array<{ id: string; title?: string }> }

function deriveUserGoal(explicit: string | undefined, selection: PlanningTaskWorkflowSelection, context: PlannerContextLike): string {
  if (explicit !== undefined && explicit.trim().length > 0) return boundedUserGoal(explicit);
  const titles = context.items.map((item) => (item.title?.trim() ? item.title.trim() : item.id));
  const coverage = titles.length > 0 ? ` covering ${titles.join(', ')}` : '';
  const recommendationRef = selection.recommendationRef ?? (selection.itemIds !== undefined ? selection.sourceRecommendationRef : undefined);
  if (recommendationRef !== undefined) return boundedUserGoal(`Draft a session plan for recommendation ${recommendationRef}${coverage}.`);
  if (selection.epicId !== undefined) return boundedUserGoal(`Draft a session plan for epic ${selection.epicId}${coverage}.`);
  if (hasBacklogSelection(selection) && titles.length > 0) return boundedUserGoal(`Draft a session plan for ${titles.join(', ')}.`);
  throw userActionError('start-planning-agent-task requires a userGoal or a backlog selection to derive a planning goal.', { path: 'userGoal' });
}

function explicitOrPreservedGoal(explicit: string | undefined, parent: PlanningTaskWorkflowEntry, context: PlannerContextLike): string {
  if (explicit !== undefined && explicit.trim().length > 0) return boundedUserGoal(explicit);
  if (parent.derivedRequest.trim().length > 0) return boundedUserGoal(parent.derivedRequest);
  return deriveUserGoal(undefined, parent.selection, context);
}

function buildRedraftContext(parent: PlanningTaskWorkflowEntry, task: unknown, input: { answers?: string[]; steering?: string }): Record<string, unknown> {
  const result = completedTaskResult(task);
  return {
    parentTaskId: parent.taskId,
    originalRequest: parent.originalRequest.trim().length > 0 ? parent.originalRequest : parent.derivedRequest,
    ...(typeof result?.summary === 'string' && { previousSummary: result.summary }),
    ...(Array.isArray(result?.clarificationQuestions) && { previousQuestions: (result.clarificationQuestions as Array<{ question?: unknown }>).map((entry) => entry.question).filter((value): value is string => typeof value === 'string') }),
    ...(Array.isArray(result?.assumptionsOpenQuestions) && { previousAssumptionsOpenQuestions: result.assumptionsOpenQuestions }),
    ...(input.answers !== undefined && { userAnswers: input.answers }),
    ...(input.steering !== undefined && { steering: input.steering }),
  };
}

// Redraft is normally the clarification-answer flow: it only makes sense when
// the parent task completed by requesting clarification (decision: needs-input
// with at least one question). Backlog curation tasks also allow redrafting a
// completed draft so users can steer the next curation pass. Running, failed,
// and missing records are rejected so a redraft never fabricates unavailable
// prior context.
function assertRedraftableParent(task: unknown, taskId: string, allowCurationDraft = false): void {
  const result = completedTaskResult(task);
  const hasQuestions = Array.isArray(result?.clarificationQuestions) && result.clarificationQuestions.length > 0;
  if (allowCurationDraft && (result?.backlogCurationDraft !== undefined || (result?.decision === 'needs-input' && hasQuestions))) return;
  if (result?.decision !== 'needs-input' || !hasQuestions) {
    throw userActionError(`Planning task ${taskId} is not a completed needs-input clarification result; only tasks that requested clarification can be redrafted.`, { path: 'taskId', details: { taskId } });
  }
}

function completedTaskResult(task: unknown): Record<string, unknown> | undefined {
  if (task === null || typeof task !== 'object') return undefined;
  const record = task as Record<string, unknown>;
  if (record.status !== 'completed') return undefined;
  return record.result !== null && typeof record.result === 'object' ? record.result as Record<string, unknown> : undefined;
}

function requireWorkflowEntry(index: Awaited<ReturnType<typeof readPlanningTaskWorkflowIndex>>, taskId: string, operation: string): PlanningTaskWorkflowEntry {
  const entry = findPlanningTaskWorkflowEntry(index, taskId);
  if (entry === undefined) throw userActionError(`No preserved workflow context found for planning task ${taskId}; cannot ${operation}.`, { path: 'taskId', details: { taskId, operation } });
  return entry;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isMissingTaskError(err: unknown): boolean {
  return /unknown task id|no such task|not found/i.test(errorMessage(err));
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new Error('Planning agent task start was aborted before enqueueing the daemon task.');
}

function boundedUserGoal(userGoal: string): string {
  const suffix = '…[truncated]';
  return userGoal.length > MAX_PLANNING_AGENT_USER_GOAL_LENGTH ? `${userGoal.slice(0, MAX_PLANNING_AGENT_USER_GOAL_LENGTH - suffix.length)}${suffix}` : userGoal;
}

function assertApplySelection(input: { applyRecommendations?: boolean; applyHandoffDrafts?: unknown[]; applySessionPlanDrafts?: unknown[]; applySessionPlanCreationDraft?: unknown; applyBacklogCurationDraft?: unknown }): void {
  if (input.applyBacklogCurationDraft !== undefined) {
    if (input.applyRecommendations === true || (input.applyHandoffDrafts?.length ?? 0) > 0 || (input.applySessionPlanDrafts?.length ?? 0) > 0 || input.applySessionPlanCreationDraft !== undefined) {
      throw new ExtensionActionInputValidationError('applyBacklogCurationDraft cannot be combined with unrelated planning task apply selections.', [{ path: 'applyBacklogCurationDraft', message: 'Backlog curation draft applies must not include recommendations, handoff drafts, session-plan sections, or session-plan creation draft selections.' }]);
    }
    return;
  }
  if (
    input.applyRecommendations === true
    || (input.applyHandoffDrafts?.length ?? 0) > 0
    || (input.applySessionPlanDrafts?.length ?? 0) > 0
    || input.applySessionPlanCreationDraft !== undefined
  ) return;
  throw new ExtensionActionInputValidationError('Applying a planning agent task result requires an apply selection.', [{ path: '', message: 'Select recommendations, handoff drafts, session-plan sections, a session-plan creation draft, or a backlog curation draft.' }]);
}

export const planningAgentTaskActions: readonly ExtensionAction<any, any>[] = [
  startPlanningAgentTaskAction,
  getPlanningAgentTaskAction,
  previewBacklogCurationTaskAction,
  cancelPlanningAgentTaskAction,
  listPlanningAgentTasksAction,
  removePlanningAgentTaskAction,
  retryPlanningAgentTaskAction,
  redraftPlanningAgentTaskAction,
  applyPlanningAgentTaskResultAction,
];
