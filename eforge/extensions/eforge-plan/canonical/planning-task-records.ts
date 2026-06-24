import type { EforgePlanStore, JsonValue, PlanningTaskRefsInput, PlanningTaskRow, PlanningTaskUpsert } from '../sqlite/index.js';
import { markSearchIndexDirty, replacePlanningTaskRefs, rowToPlanningTask, upsertPlanningTask } from '../sqlite/index.js';
import { getDatabase } from '../sqlite/store-internal.js';
import { canonicalNowIso, withCanonicalTransaction } from './store.js';

export interface CanonicalPlanningTaskInput {
  taskId: string;
  purpose?: string;
  status?: string;
  sourceFingerprint?: string;
  requestedSections?: JsonValue;
  selectionSummary?: JsonValue;
  compactResultSummary?: JsonValue;
  rawRequest?: JsonValue;
  rawResult?: JsonValue;
  parentTaskId?: string;
  itemRefs?: string[];
  epicRefs?: string[];
  recommendationRefs?: string[];
}

export function recordPlanningTaskWorkflowEntry(cwd: string, input: CanonicalPlanningTaskInput): PlanningTaskRow {
  return withCanonicalTransaction(cwd, (store) => recordPlanningTaskWorkflowEntryRecord(store, input));
}

export function recordPlanningTaskWorkflowEntryRecord(store: EforgePlanStore, input: CanonicalPlanningTaskInput): PlanningTaskRow {
  const now = canonicalNowIso();
  const row = upsertPlanningTask(store, { taskId: input.taskId, purpose: input.purpose, statusSnapshot: input.status ?? 'active', sourceFingerprint: input.sourceFingerprint, requestedSections: input.requestedSections, selectionSummary: input.selectionSummary, compactResultSummary: input.compactResultSummary, rawRequest: input.rawRequest, rawResult: input.rawResult, rawPayloadPrunable: true, createdAt: now, updatedAt: now, parentTaskId: input.parentTaskId } satisfies PlanningTaskUpsert);
  replacePlanningTaskRefs(store, refsInput(input));
  for (const itemId of input.itemRefs ?? []) markSearchIndexDirty(store, { documentType: 'backlog_item', documentId: itemId, reason: 'planning-task-recorded' });
  return row;
}

export function markPlanningTaskWorkflowEntryApplied(cwd: string, taskId: string, appliedAt = canonicalNowIso()): PlanningTaskRow {
  return withCanonicalTransaction(cwd, (store) => markPlanningTaskAppliedRecord(store, taskId, appliedAt));
}

export function markPlanningTaskAppliedRecord(store: EforgePlanStore, taskId: string, appliedAt = canonicalNowIso()): PlanningTaskRow {
  const existing = getPlanningTask(store, taskId);
  return upsertPlanningTask(store, { ...existing, taskId, statusSnapshot: 'applied', appliedAt, updatedAt: appliedAt });
}

export function markPlanningTaskWorkflowEntryDismissed(cwd: string, taskId: string, dismissedAt = canonicalNowIso()): PlanningTaskRow {
  return withCanonicalTransaction(cwd, (store) => {
    const existing = getPlanningTask(store, taskId);
    return upsertPlanningTask(store, { ...existing, taskId, statusSnapshot: 'dismissed', updatedAt: dismissedAt });
  });
}

function getPlanningTask(store: EforgePlanStore, taskId: string): PlanningTaskRow | undefined {
  const row = getDatabase(store).prepare('SELECT * FROM planning_tasks WHERE task_id = ?').get(taskId) as Record<string, unknown> | undefined;
  return row ? rowToPlanningTask(row) : undefined;
}

function refsInput(input: CanonicalPlanningTaskInput): PlanningTaskRefsInput {
  return { taskId: input.taskId, items: (input.itemRefs ?? []).map((ref, sequence) => ({ ref, resolvedId: ref, role: 'source', sequence })), epics: (input.epicRefs ?? []).map((ref, sequence) => ({ ref, resolvedId: ref, role: 'source', sequence })), recommendationRefs: (input.recommendationRefs ?? []).map((ref, sequence) => ({ ref, role: 'source', sequence })) };
}
