import type { ExtensionActionRequestedByHost, ExtensionAgentTaskRecord } from '@eforge-build/client';
import type { ListPlanningAgentTasksInput, PlanningAgentTaskListItem, PlanningTaskWorkflowEntry } from './planning-agent-task-schemas.js';

const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 100;
const MAX_SUMMARY_ITEM_IDS = 10;
const SUMMARY_TEXT_LIMIT = 500;

export interface PlanningAgentTaskListProjectionOptions {
  includeEntry: boolean;
  includeTask: boolean;
  limit: number;
  offset: number;
}

export function normalizePlanningAgentTaskListProjection(
  input: ListPlanningAgentTasksInput,
  host: ExtensionActionRequestedByHost,
): PlanningAgentTaskListProjectionOptions {
  const includeEntry = input.includeEntry ?? host === 'console';
  const includeTask = input.includeTask ?? host === 'console';
  const offset = normalizeNonNegativeInteger(input.offset, 0);
  const limit = Math.min(normalizePositiveInteger(input.limit, DEFAULT_LIST_LIMIT), MAX_LIST_LIMIT);
  return { includeEntry, includeTask, limit, offset };
}

export function projectPlanningAgentTaskListItem(params: {
  entry: PlanningTaskWorkflowEntry;
  task: ExtensionAgentTaskRecord;
  includeEntry: boolean;
  includeTask: boolean;
}): PlanningAgentTaskListItem {
  return {
    entrySummary: summarizePlanningTaskWorkflowEntry(params.entry),
    available: true,
    status: params.task.status,
    taskSummary: summarizePlanningAgentTask(params.task),
    ...(params.includeEntry ? { entry: params.entry } : {}),
    ...(params.includeTask ? { task: params.task } : {}),
  };
}

export function projectMissingPlanningAgentTaskListItem(params: {
  entry: PlanningTaskWorkflowEntry;
  includeEntry: boolean;
  staleReason: string;
}): PlanningAgentTaskListItem {
  return {
    entrySummary: summarizePlanningTaskWorkflowEntry(params.entry),
    available: false,
    staleReason: params.staleReason,
    ...(params.includeEntry ? { entry: params.entry } : {}),
  };
}

export function summarizePlanningTaskWorkflowEntry(entry: PlanningTaskWorkflowEntry): PlanningAgentTaskListItem['entrySummary'] {
  return {
    taskId: entry.taskId,
    ...(entry.parentTaskId !== undefined ? { parentTaskId: entry.parentTaskId } : {}),
    ...(entry.purpose !== undefined ? { purpose: entry.purpose } : {}),
    requestedOutputSections: entry.requestedOutputSections,
    ...(entry.session !== undefined ? { session: entry.session } : {}),
    ...(entry.planningType !== undefined ? { planningType: entry.planningType } : {}),
    ...(entry.planningDepth !== undefined ? { planningDepth: entry.planningDepth } : {}),
    ...(entry.itemAuditConcurrency !== undefined ? { itemAuditConcurrency: entry.itemAuditConcurrency } : {}),
    ...(entry.sourceFingerprint !== undefined ? { sourceFingerprint: entry.sourceFingerprint } : {}),
    ...(entry.appliedAt !== undefined ? { appliedAt: entry.appliedAt } : {}),
    createdAt: entry.createdAt,
    ...(entry.derivedRequest.length > 0 ? { derivedRequestSummary: capText(entry.derivedRequest) } : {}),
    selection: summarizeSelection(entry.selection),
  };
}

function summarizeSelection(selection: PlanningTaskWorkflowEntry['selection']): NonNullable<PlanningAgentTaskListItem['entrySummary']>['selection'] {
  return {
    ...(selection.itemIds !== undefined ? { itemCount: selection.itemIds.length, itemIds: selection.itemIds.slice(0, MAX_SUMMARY_ITEM_IDS) } : {}),
    ...(selection.epicId !== undefined ? { epicId: selection.epicId } : {}),
    ...(selection.recommendationRef !== undefined ? { recommendationRef: selection.recommendationRef } : {}),
    ...(selection.sourceRecommendationRef !== undefined ? { sourceRecommendationRef: selection.sourceRecommendationRef } : {}),
  };
}

export function summarizePlanningAgentTask(task: ExtensionAgentTaskRecord): PlanningAgentTaskListItem['taskSummary'] {
  const base: NonNullable<PlanningAgentTaskListItem['taskSummary']> = {
    taskId: task.taskId,
    kind: task.kind,
    status: task.status,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    ...(task.metadata !== undefined ? { metadata: task.metadata } : {}),
  };
  if ('startedAt' in task && task.startedAt !== undefined) base.startedAt = task.startedAt;
  if ('completedAt' in task && task.completedAt !== undefined) base.completedAt = task.completedAt;
  if ('cancelledAt' in task && task.cancelledAt !== undefined) base.cancelledAt = task.cancelledAt;
  if ('errorCode' in task && task.errorCode !== undefined) base.errorCode = task.errorCode;
  if ('errorMessage' in task && task.errorMessage !== undefined) base.errorMessage = capText(task.errorMessage);
  if ('result' in task && task.result !== undefined) base.resultSummary = summarizeResult(task.result);
  return base;
}

function summarizeResult(result: Record<string, unknown>): NonNullable<PlanningAgentTaskListItem['taskSummary']>['resultSummary'] {
  return {
    outputKeys: Object.keys(result).sort(),
    ...(typeof result.decision === 'string' ? { decision: result.decision } : {}),
    ...(typeof result.summary === 'string' ? { summary: capText(result.summary) } : {}),
  };
}

function capText(value: string): string {
  return value.length <= SUMMARY_TEXT_LIMIT ? value : `${value.slice(0, SUMMARY_TEXT_LIMIT - 1)}…`;
}

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : fallback;
}

function normalizeNonNegativeInteger(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : fallback;
}
