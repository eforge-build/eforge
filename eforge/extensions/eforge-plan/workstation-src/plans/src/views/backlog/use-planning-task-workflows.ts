import * as React from 'react';
import { getBridge } from '@/bridge';
import { useToast } from '@/components/toast';
import type {
  AnalyzeAllBacklogResponse,
  AppliedSessionPlanCreationDraft,
  ApplyPlanningTaskResponse,
  JsonObject,
  ListPlanningAgentTasksResponse,
  PlanningAgentTaskListItem,
  PlanningAgentTaskRecord,
  PlanningAgentTaskResponse,
  PlanningAgentTaskWorkflowStartResponse,
  PlanningTaskApplyError,
  PlanningTaskResult,
  RemovePlanningTaskResponse,
} from '@/types';

const bridge = getBridge();
const POLL_MS = 1600;
const AUTO_APPLY_ATTEMPT_STORAGE_PREFIX = 'eforge-plan:auto-apply-attempted:';

function autoApplyAttemptKey(taskId: string): string {
  return `${AUTO_APPLY_ATTEMPT_STORAGE_PREFIX}${taskId}`;
}

function hasPersistedAutoApplyAttempt(taskId: string): boolean {
  try {
    return window.localStorage.getItem(autoApplyAttemptKey(taskId)) !== null;
  } catch {
    return false;
  }
}

function persistAutoApplyAttempt(taskId: string): void {
  try {
    window.localStorage.setItem(autoApplyAttemptKey(taskId), new Date().toISOString());
  } catch {
    // Best-effort only: in-memory guards still prevent retry loops during this mount.
  }
}

function clearPersistedAutoApplyAttempt(taskId: string): void {
  try {
    window.localStorage.removeItem(autoApplyAttemptKey(taskId));
  } catch {
    // Best-effort only.
  }
}

export interface RedraftInput { answers?: string[]; steering?: string; }
export interface AnalyzeBacklogInput { itemAuditConcurrency?: number; }

export interface PlanningTaskWorkflowsApi {
  items: PlanningAgentTaskListItem[];
  loading: boolean;
  busy: boolean;
  applyErrors: Record<string, PlanningTaskApplyError>;
  reload: () => Promise<void>;
  start: (input: JsonObject) => Promise<PlanningAgentTaskRecord | null>;
  analyzeAllBacklog: (input?: AnalyzeBacklogInput) => Promise<PlanningAgentTaskRecord | null>;
  retry: (taskId: string) => Promise<void>;
  redraft: (taskId: string, input: RedraftInput) => Promise<void>;
  cancel: (taskId: string) => Promise<void>;
  remove: (taskId: string) => Promise<void>;
  apply: (taskId: string, input: JsonObject) => Promise<ApplyPlanningTaskResponse | null>;
}

type CreatedSessionPlanCallback = (draft: AppliedSessionPlanCreationDraft) => void;

interface ApplyPlanningTaskOptions {
  automatic?: boolean;
  suppressSuccessToast?: boolean;
}

function errorMessage(caught: unknown): string {
  return caught instanceof Error ? caught.message : String(caught);
}

function hasText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasSingleCreationRequestedOutput(item: PlanningAgentTaskListItem): boolean {
  const sections = item.entry.requestedOutputSections;
  return sections.length === 0 || (sections.length === 1 && sections[0] === 'sessionPlanCreationDraft');
}

function hasOtherApplyableResultOutputs(result: PlanningTaskResult): boolean {
  return Boolean(
    result.backlogCurationDraft ||
    result.recommendations ||
    result.handoffDraft ||
    (result.handoffDrafts && result.handoffDrafts.length > 0) ||
    result.sessionPlanPatch ||
    result.planRevisionTurn ||
    result.planDrafts ||
    result.playbookDraft,
  );
}

function isReadyCreationDraftResult(result: PlanningTaskResult): boolean {
  const draft = result.sessionPlanCreationDraft;
  return result.decision === 'ready' &&
    Boolean(draft) &&
    hasText(draft?.session) &&
    hasText(draft?.topic) &&
    hasText(draft?.planningType) &&
    hasText(draft?.planningDepth) &&
    Boolean(draft?.sections.length);
}

function isAutoApplyCreationTask(item: PlanningAgentTaskListItem): boolean {
  const status = item.task?.status ?? item.status;
  const result = item.task?.result;
  if (!item.available || status !== 'completed' || item.entry.appliedAt || item.entry.purpose || !result) return false;
  if (!hasSingleCreationRequestedOutput(item) || hasOtherApplyableResultOutputs(result)) return false;
  return isReadyCreationDraftResult(result);
}

function isSessionPlanCreationApplyInput(input: JsonObject): boolean {
  return Object.prototype.hasOwnProperty.call(input, 'applySessionPlanCreationDraft');
}

function withoutApplyError(errors: Record<string, PlanningTaskApplyError>, taskId: string): Record<string, PlanningTaskApplyError> {
  if (!errors[taskId]) return errors;
  const next = { ...errors };
  delete next[taskId];
  return next;
}

function isRunning(item: PlanningAgentTaskListItem): boolean {
  const status = item.task?.status ?? item.status;
  return status === 'queued' || status === 'running';
}

function isTerminalStatus(status: PlanningAgentTaskRecord['status']): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}

/**
 * Shared workflow hook for the durable planning task monitor. Task discovery is
 * extension-owned: the hook always lists tasks through `list-planning-agent-tasks`
 * on mount, after every mutation, and after polling observes a terminal task
 * status, caches the current render in React state, polls running tasks through
 * `get-planning-agent-task`, and auto-applies eligible ready session-plan
 * creation drafts exactly once while preserving apply errors for review.
 */
export function usePlanningTaskWorkflows(onRefresh: () => Promise<void>, onCreatedSessionPlan?: CreatedSessionPlanCallback): PlanningTaskWorkflowsApi {
  const toast = useToast();
  const [items, setItems] = React.useState<PlanningAgentTaskListItem[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState(false);
  const [applyErrors, setApplyErrors] = React.useState<Record<string, PlanningTaskApplyError>>({});
  const autoApplyInFlightRef = React.useRef<Set<string>>(new Set());
  const autoApplyAttemptedRef = React.useRef<Set<string>>(new Set());
  // --- eforge:region plan-04-workstation-session-plan-auto-apply ---
  const autoApplyFailedRef = React.useRef<Set<string>>(new Set());
  // --- eforge:endregion plan-04-workstation-session-plan-auto-apply ---
  const autoAppliedRef = React.useRef<Set<string>>(new Set());

  const reportError = React.useCallback((caught: unknown) => {
    toast.push(errorMessage(caught), 'error');
  }, [toast]);

  const reload = React.useCallback(async () => {
    setLoading(true);
    try {
      const response = await bridge.invokeAction<ListPlanningAgentTasksResponse>('list-planning-agent-tasks', {});
      setItems((response.tasks ?? []).filter((item) => !autoAppliedRef.current.has(item.entry.taskId)));
    } catch (caught) {
      reportError(caught);
    } finally {
      setLoading(false);
    }
  }, [reportError]);

  React.useEffect(() => { void reload(); }, [reload]);

  const itemsRef = React.useRef(items);
  itemsRef.current = items;
  const hasRunning = items.some(isRunning);

  // Tracks the last poll error message reported per task so a persistently
  // failing/stale task does not re-toast the same error every poll interval.
  // A successful poll clears the entry so a later error notifies once again.
  const pollErrorRef = React.useRef<Map<string, string>>(new Map());

  React.useEffect(() => {
    if (!hasRunning) return undefined;
    let cancelled = false;
    const poll = () => {
      for (const item of itemsRef.current.filter(isRunning)) {
        void bridge.invokeAction<PlanningAgentTaskResponse>('get-planning-agent-task', { taskId: item.entry.taskId }).then((response) => {
          if (cancelled) return;
          pollErrorRef.current.delete(item.entry.taskId);
          setItems((prev) => prev.map((existing) => existing.entry.taskId === item.entry.taskId
            ? { ...existing, task: response.task, status: response.task.status, available: true }
            : existing));
          if (isTerminalStatus(response.task.status)) void reload();
        }).catch((caught) => {
          if (cancelled) return;
          const message = errorMessage(caught);
          if (pollErrorRef.current.get(item.entry.taskId) === message) return;
          pollErrorRef.current.set(item.entry.taskId, message);
          reportError(caught);
        });
      }
    };
    const timer = window.setInterval(poll, POLL_MS);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [hasRunning, reload, reportError]);

  const start = React.useCallback(async (input: JsonObject): Promise<PlanningAgentTaskRecord | null> => {
    setBusy(true);
    try {
      const response = await bridge.invokeAction<PlanningAgentTaskResponse>('start-planning-agent-task', input);
      toast.push(`Started planning task ${response.task.taskId}.`, 'success');
      await reload();
      return response.task;
    } catch (caught) {
      reportError(caught);
      return null;
    } finally {
      setBusy(false);
    }
  }, [reload, reportError, toast]);

  const analyzeAllBacklog = React.useCallback(async (input: AnalyzeBacklogInput = {}): Promise<PlanningAgentTaskRecord | null> => {
    setBusy(true);
    try {
      const payload: JsonObject = input.itemAuditConcurrency !== undefined ? { itemAuditConcurrency: input.itemAuditConcurrency } : {};
      const response = await bridge.invokeAction<AnalyzeAllBacklogResponse>('analyze-all-backlog', payload);
      toast.push(`${response.reused ? 'Reusing' : 'Started'} backlog analysis task ${response.task.taskId}.`, 'success');
      await reload();
      return response.task;
    } catch (caught) {
      reportError(caught);
      return null;
    } finally {
      setBusy(false);
    }
  }, [reload, reportError, toast]);

  const retry = React.useCallback(async (taskId: string) => {
    setBusy(true);
    try {
      const response = await bridge.invokeAction<PlanningAgentTaskWorkflowStartResponse>('retry-planning-agent-task', { taskId });
      toast.push(`Retrying as ${response.task.taskId}.`, 'success');
      clearPersistedAutoApplyAttempt(taskId);
      setApplyErrors((prev) => withoutApplyError(prev, taskId));
      await reload();
    } catch (caught) {
      reportError(caught);
    } finally {
      setBusy(false);
    }
  }, [reload, reportError, toast]);

  const redraft = React.useCallback(async (taskId: string, input: RedraftInput) => {
    setBusy(true);
    try {
      const payload: JsonObject = { taskId };
      if (input.answers && input.answers.length > 0) payload.answers = input.answers;
      if (input.steering && input.steering.trim().length > 0) payload.steering = input.steering.trim();
      const response = await bridge.invokeAction<PlanningAgentTaskWorkflowStartResponse>('redraft-planning-agent-task', payload);
      toast.push(`Redrafting as ${response.task.taskId}.`, 'success');
      clearPersistedAutoApplyAttempt(taskId);
      setApplyErrors((prev) => withoutApplyError(prev, taskId));
      await reload();
    } catch (caught) {
      reportError(caught);
    } finally {
      setBusy(false);
    }
  }, [reload, reportError, toast]);

  const cancel = React.useCallback(async (taskId: string) => {
    setBusy(true);
    try {
      const response = await bridge.invokeAction<PlanningAgentTaskResponse>('cancel-planning-agent-task', { taskId, reason: 'user requested cancellation' });
      toast.push(`Cancelled ${response.task.taskId}.`, 'success');
      setItems((prev) => prev.map((existing) => existing.entry.taskId === taskId
        ? { ...existing, task: response.task, status: response.task.status }
        : existing));
    } catch (caught) {
      reportError(caught);
    } finally {
      setBusy(false);
    }
  }, [reportError, toast]);

  const remove = React.useCallback(async (taskId: string) => {
    setBusy(true);
    try {
      const response = await bridge.invokeAction<RemovePlanningTaskResponse>('remove-planning-agent-task', { taskId });
      toast.push(response.removed ? `Removed ${response.taskId} from the planning task list.` : `${response.taskId} was not in the planning task list.`, 'success');
      setItems((prev) => prev.filter((existing) => existing.entry.taskId !== taskId));
      setApplyErrors((prev) => withoutApplyError(prev, taskId));
      await reload();
    } catch (caught) {
      reportError(caught);
    } finally {
      setBusy(false);
    }
  }, [reload, reportError, toast]);

  const applyPlanningTaskResult = React.useCallback(async (taskId: string, input: JsonObject, options: ApplyPlanningTaskOptions = {}): Promise<ApplyPlanningTaskResponse | null> => {
    if (!options.automatic) setBusy(true);
    try {
      let response: ApplyPlanningTaskResponse;
      try {
        response = await bridge.invokeAction<ApplyPlanningTaskResponse>('apply-planning-agent-task-result', { taskId, ...input });
      } catch (caught) {
        const message = errorMessage(caught);
        if (options.automatic || isSessionPlanCreationApplyInput(input)) {
          // --- eforge:region plan-04-workstation-session-plan-auto-apply ---
          if (options.automatic) autoApplyFailedRef.current.add(taskId);
          // --- eforge:endregion plan-04-workstation-session-plan-auto-apply ---
          setApplyErrors((prev) => ({
            ...prev,
            [taskId]: { taskId, message, automatic: Boolean(options.automatic), occurredAt: new Date().toISOString() },
          }));
        }
        if (!options.automatic) reportError(caught);
        return null;
      }

      if (!options.suppressSuccessToast) toast.push(`Applied generated output from ${response.taskId}.`, 'success');
      if (!options.automatic) clearPersistedAutoApplyAttempt(taskId);
      setApplyErrors((prev) => withoutApplyError(prev, taskId));
      // --- eforge:region plan-04-workstation-session-plan-auto-apply ---
      autoApplyFailedRef.current.delete(taskId);
      // --- eforge:endregion plan-04-workstation-session-plan-auto-apply ---
      const createdDraft = response.sessionPlanCreationDraft;
      if (createdDraft !== undefined) {
        autoAppliedRef.current.add(taskId);
        setItems((prev) => prev.filter((existing) => existing.entry.taskId !== taskId));
      }
      try {
        await onRefresh();
      } catch (caught) {
        reportError(caught);
      }
      try {
        await reload();
      } catch (caught) {
        reportError(caught);
      }
      if (createdDraft !== undefined && options.automatic) {
        try {
          onCreatedSessionPlan?.(createdDraft);
        } catch (caught) {
          reportError(caught);
        }
      }
      return response;
    } finally {
      if (!options.automatic) setBusy(false);
    }
  }, [onCreatedSessionPlan, onRefresh, reload, reportError, toast]);

  React.useEffect(() => {
    for (const item of items) {
      const taskId = item.entry.taskId;
      if (!isAutoApplyCreationTask(item)) continue;
      if (autoAppliedRef.current.has(taskId) || autoApplyAttemptedRef.current.has(taskId) || autoApplyInFlightRef.current.has(taskId) || autoApplyFailedRef.current.has(taskId) || hasPersistedAutoApplyAttempt(taskId)) continue;
      autoApplyAttemptedRef.current.add(taskId);
      persistAutoApplyAttempt(taskId);
      autoApplyInFlightRef.current.add(taskId);
      void applyPlanningTaskResult(taskId, { applySessionPlanCreationDraft: {} }, { automatic: true, suppressSuccessToast: true })
        .finally(() => { autoApplyInFlightRef.current.delete(taskId); });
    }
  }, [applyPlanningTaskResult, items]);

  const apply = React.useCallback(async (taskId: string, input: JsonObject): Promise<ApplyPlanningTaskResponse | null> => {
    if (isSessionPlanCreationApplyInput(input) && autoApplyInFlightRef.current.has(taskId)) return null;
    return applyPlanningTaskResult(taskId, input);
  }, [applyPlanningTaskResult]);

  return { items, loading, busy, applyErrors, reload, start, analyzeAllBacklog, retry, redraft, cancel, remove, apply };
}
