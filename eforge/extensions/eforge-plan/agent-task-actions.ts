import { defineExtensionAction, type ExtensionActionContext } from '../../../packages/extension-sdk/src/index.js';
import { EXTENSION_AGENT_TASK_KIND_EFORGE_PLAN_PLANNING_DRAFT } from '../../../packages/client/src/extension-agent-tasks.js';
import {
  applyCompletedPlanningAgentTaskResult,
  preparePlannerContext,
} from './planner-orchestration.js';
import { toJsonSafeObject } from './json-safe.js';
import {
  findPlanningTaskWorkflowEntry,
  listPlanningTaskWorkflowEntries,
  readPlanningTaskWorkflowIndex,
  recordPlanningTaskWorkflowEntry,
  removePlanningTaskWorkflowEntry,
} from './planning-task-workflow-store.js';
import {
  ApplyPlanningAgentTaskResultInputSchema,
  ApplyPlanningAgentTaskResultOutputSchema,
  CancelPlanningAgentTaskInputSchema,
  ListPlanningAgentTasksInputSchema,
  ListPlanningAgentTasksOutputSchema,
  MAX_PLANNING_AGENT_USER_GOAL_LENGTH,
  GetPlanningAgentTaskInputSchema,
  PlanningAgentTaskCancelOutputSchema,
  PlanningAgentTaskGetOutputSchema,
  PlanningAgentTaskStartOutputSchema,
  PlanningAgentTaskWorkflowStartOutputSchema,
  RedraftPlanningAgentTaskInputSchema,
  RemovePlanningAgentTaskInputSchema,
  RemovePlanningAgentTaskOutputSchema,
  RetryPlanningAgentTaskInputSchema,
  StartPlanningAgentTaskInputSchema,
  type PlanningTaskWorkflowEntry,
  type PlanningTaskWorkflowSelection,
  type StartPlanningAgentTaskInput,
} from './planning-agent-task-schemas.js';

const MAX_CONTEXT_ITEMS = 25;
const MAX_CONTEXT_EPICS = 10;
const MAX_CONTEXT_STRING = 4000;
const MAX_SOURCE_TEXT = 60000;
const MAX_REDRAFT_SUMMARY_ITEMS = 10;
const MAX_REDRAFT_SUMMARY_STRING = 1000;
const MAX_SELECTION_IDS = 50;
const MAX_SELECTION_ID_LENGTH = 200;
const SOURCE_TEXT_HARD_CAP_SUFFIX = '…[truncated]';

type RequestedOutputSections = NonNullable<StartPlanningAgentTaskInput['requestedOutputSections']>;

export const startPlanningAgentTaskAction = defineExtensionAction({
  id: 'start-planning-agent-task',
  title: 'Start eforge-plan planning agent task',
  description: 'Prepare bounded planner context, then start one daemon-owned eforge-plan planning draft task.',
  inputSchema: StartPlanningAgentTaskInputSchema,
  outputSchema: PlanningAgentTaskStartOutputSchema,
  sideEffects: ['local-read', 'local-write', 'daemon-state'],
  async handler(input, ctx) {
    throwIfAborted(ctx.signal);
    const selection = selectionFromInput(input);
    const context = await preparePlannerContext(ctx.cwd, {
      itemIds: input.itemIds,
      epicId: input.epicId,
      recommendationRef: input.recommendationRef,
      includeRoadmap: input.includeRoadmap,
    });
    throwIfAborted(ctx.signal);
    const derivedGoal = deriveUserGoal(input.userGoal, selection, context);
    const requestedOutputSections = resolveRequestedOutputSections(input, selection);
    const planningType = typeof input.planningType === 'string' ? input.planningType : undefined;
    const planningDepth = typeof input.planningDepth === 'string' ? input.planningDepth : undefined;
    const sourceText = boundedSourceText(derivedGoal, context);
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
  description: 'Project the durable planning task workflow index and join owner-scoped daemon task records.',
  inputSchema: ListPlanningAgentTasksInputSchema,
  outputSchema: ListPlanningAgentTasksOutputSchema,
  sideEffects: ['local-read'],
  async handler(_input, ctx) {
    const entries = listPlanningTaskWorkflowEntries(await readPlanningTaskWorkflowIndex(ctx.cwd));
    const tasks = await Promise.all(entries.map(async (entry) => {
      try {
        const response = await ctx.agentTasks.get(entry.taskId);
        return { entry, available: true, status: response.task.status, task: response.task };
      } catch (err) {
        return { entry, available: false, staleReason: errorMessage(err) };
      }
    }));
    return toJsonSafeObject({ tasks });
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
        throw new Error(`Task ${input.taskId} is ${status}; cancel it before removing it from the workflow list.`);
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
    const context = await preparePlannerContext(ctx.cwd, plannerSelection(parent));
    throwIfAborted(ctx.signal);
    const derivedGoal = explicitOrPreservedGoal(input.userGoal, parent, context);
    const sourceText = boundedSourceText(derivedGoal, context);
    throwIfAborted(ctx.signal);
    return await startLinkedTask(ctx, {
      parent,
      derivedGoal,
      sourceText,
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
    assertRedraftableParent(previous.task, input.taskId);
    const context = await preparePlannerContext(ctx.cwd, plannerSelection(parent));
    throwIfAborted(ctx.signal);
    const derivedGoal = explicitOrPreservedGoal(undefined, parent, context);
    const redraft = buildRedraftContext(parent, previous.task, input);
    const sourceText = boundedSourceText(derivedGoal, context, redraft);
    throwIfAborted(ctx.signal);
    return await startLinkedTask(ctx, {
      parent,
      derivedGoal,
      sourceText,
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
  sourceText: string;
  requestedOutputSections: RequestedOutputSections;
}

async function startLinkedTask(ctx: ExtensionActionContext, params: StartLinkedTaskParams): Promise<Record<string, unknown>> {
  const { parent } = params;
  const requested = params.requestedOutputSections.length > 0 ? params.requestedOutputSections : undefined;
  const response = await ctx.agentTasks.start({
    kind: EXTENSION_AGENT_TASK_KIND_EFORGE_PLAN_PLANNING_DRAFT,
    input: {
      topic: params.derivedGoal,
      sourceText: params.sourceText,
      ...(parent.session !== undefined && { session: parent.session }),
      ...(parent.planningType !== undefined && { planningType: parent.planningType }),
      ...(parent.planningDepth !== undefined && { planningDepth: parent.planningDepth }),
      ...(requested !== undefined && { requestedOutputSections: requested }),
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
    createdAt: new Date().toISOString(),
  };
}

function selectionFromInput(input: StartPlanningAgentTaskInput): PlanningTaskWorkflowSelection {
  return {
    ...(input.itemIds !== undefined && { itemIds: input.itemIds }),
    ...(input.epicId !== undefined && { epicId: input.epicId }),
    ...(input.recommendationRef !== undefined && { recommendationRef: input.recommendationRef }),
  };
}

function plannerSelection(entry: PlanningTaskWorkflowEntry) {
  return {
    itemIds: entry.selection.itemIds,
    epicId: entry.selection.epicId,
    recommendationRef: entry.selection.recommendationRef,
    includeRoadmap: entry.includeRoadmap,
  };
}

function hasBacklogSelection(selection: PlanningTaskWorkflowSelection): boolean {
  return selection.itemIds !== undefined || selection.epicId !== undefined || selection.recommendationRef !== undefined;
}

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
  if (selection.recommendationRef !== undefined) return boundedUserGoal(`Draft a session plan for recommendation ${selection.recommendationRef}${coverage}.`);
  if (selection.epicId !== undefined) return boundedUserGoal(`Draft a session plan for epic ${selection.epicId}${coverage}.`);
  if (hasBacklogSelection(selection) && titles.length > 0) return boundedUserGoal(`Draft a session plan for ${titles.join(', ')}.`);
  throw new Error('start-planning-agent-task requires a userGoal or a backlog selection to derive a planning goal.');
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

// Redraft is the clarification-answer flow: it only makes sense when the parent
// task completed by requesting clarification (decision: needs-input with at least
// one question). Running/failed/missing records and completed-ready results are
// rejected so a redraft never fabricates a clarification round that never happened.
function assertRedraftableParent(task: unknown, taskId: string): void {
  const result = completedTaskResult(task);
  const hasQuestions = Array.isArray(result?.clarificationQuestions) && result.clarificationQuestions.length > 0;
  if (result?.decision !== 'needs-input' || !hasQuestions) {
    throw new Error(`Planning task ${taskId} is not a completed needs-input clarification result; only tasks that requested clarification can be redrafted.`);
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
  if (entry === undefined) throw new Error(`No preserved workflow context found for planning task ${taskId}; cannot ${operation}.`);
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

function boundedSourceText(userGoal: string, context: Record<string, unknown>, redraft?: Record<string, unknown>): string {
  const metadata: Record<string, unknown> = {};
  const bounded = truncateValue({ ...context }, metadata) as Record<string, unknown>;
  if (Array.isArray(bounded.items) && bounded.items.length > MAX_CONTEXT_ITEMS) {
    metadata.omittedItems = bounded.items.length - MAX_CONTEXT_ITEMS;
    bounded.items = bounded.items.slice(0, MAX_CONTEXT_ITEMS);
  }
  if (Array.isArray(bounded.epics) && bounded.epics.length > MAX_CONTEXT_EPICS) {
    metadata.omittedEpics = bounded.epics.length - MAX_CONTEXT_EPICS;
    bounded.epics = bounded.epics.slice(0, MAX_CONTEXT_EPICS);
  }
  const boundedRedraft = redraft !== undefined ? (truncateValue({ ...redraft }, metadata) as Record<string, unknown>) : undefined;
  let sourceText = JSON.stringify({ userGoal, context: bounded, ...(boundedRedraft !== undefined && { redraft: boundedRedraft }), truncation: metadata }, null, 2);
  if (sourceText.length > MAX_SOURCE_TEXT) {
    metadata.sourceTextTruncated = true;
    const summarizedRedraft = summarizeRedraft(boundedRedraft, metadata);
    const boundedSelection = boundSelection(bounded.selection, metadata);
    sourceText = JSON.stringify({ userGoal, context: { schemaVersion: bounded.schemaVersion, selection: boundedSelection }, ...(summarizedRedraft !== undefined && { redraft: summarizedRedraft }), truncation: metadata }, null, 2);
    if (sourceText.length > MAX_SOURCE_TEXT) {
      sourceText = `${sourceText.slice(0, MAX_SOURCE_TEXT - SOURCE_TEXT_HARD_CAP_SUFFIX.length)}${SOURCE_TEXT_HARD_CAP_SUFFIX}`;
    }
  }
  return sourceText;
}

// Final-pass redraft bound: when the full source text still exceeds the cap, keep
// only the original request, a bounded questions summary, and a bounded subset of
// answers or steering so unbounded redraft answer arrays cannot blow the budget.
function summarizeRedraft(redraft: Record<string, unknown> | undefined, metadata: Record<string, unknown>): Record<string, unknown> | undefined {
  if (redraft === undefined) return undefined;
  metadata.redraftSummarized = true;
  const summary: Record<string, unknown> = {};
  if (typeof redraft.parentTaskId === 'string') summary.parentTaskId = redraft.parentTaskId;
  if (typeof redraft.originalRequest === 'string') summary.originalRequest = boundRedraftString(redraft.originalRequest);
  if (typeof redraft.steering === 'string') summary.steering = boundRedraftString(redraft.steering);
  if (Array.isArray(redraft.previousQuestions)) summary.previousQuestions = boundRedraftArray(redraft.previousQuestions, metadata, 'omittedRedraftQuestions');
  if (Array.isArray(redraft.userAnswers)) summary.userAnswers = boundRedraftArray(redraft.userAnswers, metadata, 'omittedRedraftAnswers');
  return summary;
}

function boundRedraftArray(values: unknown[], metadata: Record<string, unknown>, omittedKey: string): unknown[] {
  if (values.length > MAX_REDRAFT_SUMMARY_ITEMS) metadata[omittedKey] = values.length - MAX_REDRAFT_SUMMARY_ITEMS;
  return values.slice(0, MAX_REDRAFT_SUMMARY_ITEMS).map((value) => (typeof value === 'string' ? boundRedraftString(value) : value));
}

function boundRedraftString(value: string): string {
  return value.length > MAX_REDRAFT_SUMMARY_STRING ? `${value.slice(0, MAX_REDRAFT_SUMMARY_STRING)}…[truncated]` : value;
}

// Final-pass selection bound: the fallback context keeps only schemaVersion and
// selection, but selection itself can carry a large itemIds array or long IDs.
// Cap the number of IDs and truncate each so a wide backlog selection cannot
// produce an oversized prompt.
function boundSelection(selection: unknown, metadata: Record<string, unknown>): unknown {
  if (selection === null || typeof selection !== 'object') return selection;
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(selection as Record<string, unknown>)) {
    if (Array.isArray(value)) {
      if (value.length > MAX_SELECTION_IDS) metadata[`omittedSelection_${key}`] = value.length - MAX_SELECTION_IDS;
      result[key] = value.slice(0, MAX_SELECTION_IDS).map((entry) => (typeof entry === 'string' ? boundSelectionId(entry) : entry));
    } else {
      result[key] = typeof value === 'string' ? boundSelectionId(value) : value;
    }
  }
  return result;
}

function boundSelectionId(value: string): string {
  return value.length > MAX_SELECTION_ID_LENGTH ? `${value.slice(0, MAX_SELECTION_ID_LENGTH)}…[truncated]` : value;
}

function truncateValue(value: unknown, metadata: Record<string, unknown>): unknown {
  if (typeof value === 'string' && value.length > MAX_CONTEXT_STRING) {
    metadata.truncatedStrings = Number(metadata.truncatedStrings ?? 0) + 1;
    return `${value.slice(0, MAX_CONTEXT_STRING)}…[truncated]`;
  }
  if (Array.isArray(value)) return value.map((entry) => truncateValue(entry, metadata));
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, truncateValue(entry, metadata)]));
  return value;
}

function assertApplySelection(input: { applyRecommendations?: boolean; applyHandoffDrafts?: unknown[]; applySessionPlanDrafts?: unknown[]; applySessionPlanCreationDraft?: unknown }): void {
  if (
    input.applyRecommendations === true
    || (input.applyHandoffDrafts?.length ?? 0) > 0
    || (input.applySessionPlanDrafts?.length ?? 0) > 0
    || input.applySessionPlanCreationDraft !== undefined
  ) return;
  throw new Error('Applying a planning agent task result requires selecting recommendations, handoff drafts, session-plan sections, or a session-plan creation draft.');
}

export const planningAgentTaskActions = [
  startPlanningAgentTaskAction,
  getPlanningAgentTaskAction,
  cancelPlanningAgentTaskAction,
  listPlanningAgentTasksAction,
  removePlanningAgentTaskAction,
  retryPlanningAgentTaskAction,
  redraftPlanningAgentTaskAction,
  applyPlanningAgentTaskResultAction,
] as const;
