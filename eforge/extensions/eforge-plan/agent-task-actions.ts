import { defineExtensionAction } from '../../../packages/extension-sdk/src/index.js';
import { EXTENSION_AGENT_TASK_KIND_EFORGE_PLAN_PLANNING_DRAFT } from '../../../packages/client/src/extension-agent-tasks.js';
import {
  applyCompletedPlanningAgentTaskResult,
  preparePlannerContext,
} from './planner-orchestration.js';
import {
  ApplyPlanningAgentTaskResultInputSchema,
  ApplyPlanningAgentTaskResultOutputSchema,
  CancelPlanningAgentTaskInputSchema,
  MAX_PLANNING_AGENT_USER_GOAL_LENGTH,
  GetPlanningAgentTaskInputSchema,
  PlanningAgentTaskCancelOutputSchema,
  PlanningAgentTaskGetOutputSchema,
  PlanningAgentTaskStartOutputSchema,
  StartPlanningAgentTaskInputSchema,
} from './schema.js';

const MAX_CONTEXT_ITEMS = 25;
const MAX_CONTEXT_EPICS = 10;
const MAX_CONTEXT_STRING = 4000;
const MAX_SOURCE_TEXT = 60000;

export const startPlanningAgentTaskAction = defineExtensionAction({
  id: 'start-planning-agent-task',
  title: 'Start eforge-plan planning agent task',
  description: 'Prepare bounded planner context, then start one daemon-owned eforge-plan planning draft task.',
  inputSchema: StartPlanningAgentTaskInputSchema,
  outputSchema: PlanningAgentTaskStartOutputSchema,
  sideEffects: ['local-read', 'local-write', 'daemon-state'],
  async handler(input, ctx) {
    throwIfAborted(ctx.signal);
    const context = await preparePlannerContext(ctx.cwd, {
      itemIds: input.itemIds,
      epicId: input.epicId,
      recommendationRef: input.recommendationRef,
      includeRoadmap: input.includeRoadmap,
    });
    throwIfAborted(ctx.signal);
    const userGoal = boundedUserGoal(input.userGoal);
    const sourceText = boundedSourceText(userGoal, context);
    throwIfAborted(ctx.signal);
    return await ctx.agentTasks.start({
      kind: EXTENSION_AGENT_TASK_KIND_EFORGE_PLAN_PLANNING_DRAFT,
      input: {
        topic: userGoal,
        sourceText,
        ...(input.session !== undefined && { session: input.session }),
        ...(typeof input.planningType === 'string' && { planningType: input.planningType }),
        ...(typeof input.planningDepth === 'string' && { planningDepth: input.planningDepth }),
        ...(input.requestedOutputSections !== undefined && { requestedOutputSections: input.requestedOutputSections }),
      },
    });
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

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new Error('Planning agent task start was aborted before enqueueing the daemon task.');
}

function boundedUserGoal(userGoal: string): string {
  const suffix = '…[truncated]';
  return userGoal.length > MAX_PLANNING_AGENT_USER_GOAL_LENGTH ? `${userGoal.slice(0, MAX_PLANNING_AGENT_USER_GOAL_LENGTH - suffix.length)}${suffix}` : userGoal;
}

function boundedSourceText(userGoal: string, context: Record<string, unknown>): string {
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
  let sourceText = JSON.stringify({ userGoal, context: bounded, truncation: metadata }, null, 2);
  if (sourceText.length > MAX_SOURCE_TEXT) {
    metadata.sourceTextTruncated = true;
    sourceText = JSON.stringify({ userGoal, context: { schemaVersion: bounded.schemaVersion, selection: bounded.selection }, truncation: metadata }, null, 2);
  }
  return sourceText;
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

function assertApplySelection(input: { applyRecommendations?: boolean; applyHandoffDrafts?: unknown[]; applySessionPlanDrafts?: unknown[] }): void {
  if (input.applyRecommendations === true || (input.applyHandoffDrafts?.length ?? 0) > 0 || (input.applySessionPlanDrafts?.length ?? 0) > 0) return;
  throw new Error('Applying a planning agent task result requires selecting recommendations, handoff drafts, or session-plan sections.');
}

export const planningAgentTaskActions = [
  startPlanningAgentTaskAction,
  getPlanningAgentTaskAction,
  cancelPlanningAgentTaskAction,
  applyPlanningAgentTaskResultAction,
] as const;
