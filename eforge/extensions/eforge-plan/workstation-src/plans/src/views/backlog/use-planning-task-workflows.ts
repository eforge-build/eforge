import * as React from 'react';
import { getBridge } from '@/bridge';
import { useToast } from '@/components/toast';
import type {
  AnalyzeAllBacklogResponse,
  ApplyPlanningTaskResponse,
  BacklogCurationScanMode,
  JsonObject,
  ListPlanningAgentTasksResponse,
  PlanningAgentTaskListItem,
  PlanningAgentTaskRecord,
  PlanningAgentTaskResponse,
  PlanningAgentTaskWorkflowStartResponse,
  RemovePlanningTaskResponse,
} from '@/types';

const bridge = getBridge();
const POLL_MS = 1600;

export interface RedraftInput { answers?: string[]; steering?: string; }
export interface AnalyzeBacklogInput { scanMode: BacklogCurationScanMode; itemAuditConcurrency?: number; }

export interface PlanningTaskWorkflowsApi {
  items: PlanningAgentTaskListItem[];
  loading: boolean;
  busy: boolean;
  reload: () => Promise<void>;
  start: (input: JsonObject) => Promise<PlanningAgentTaskRecord | null>;
  analyzeAllBacklog: (input: AnalyzeBacklogInput) => Promise<PlanningAgentTaskRecord | null>;
  retry: (taskId: string) => Promise<void>;
  redraft: (taskId: string, input: RedraftInput) => Promise<void>;
  cancel: (taskId: string) => Promise<void>;
  remove: (taskId: string) => Promise<void>;
  apply: (taskId: string, input: JsonObject) => Promise<ApplyPlanningTaskResponse | null>;
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
 * status, caches the current render in React state, and polls running tasks
 * through `get-planning-agent-task`.
 */
export function usePlanningTaskWorkflows(onRefresh: () => Promise<void>): PlanningTaskWorkflowsApi {
  const toast = useToast();
  const [items, setItems] = React.useState<PlanningAgentTaskListItem[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [busy, setBusy] = React.useState(false);

  const reportError = React.useCallback((caught: unknown) => {
    toast.push(caught instanceof Error ? caught.message : String(caught), 'error');
  }, [toast]);

  const reload = React.useCallback(async () => {
    setLoading(true);
    try {
      const response = await bridge.invokeAction<ListPlanningAgentTasksResponse>('list-planning-agent-tasks', {});
      setItems(response.tasks ?? []);
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
          const message = caught instanceof Error ? caught.message : String(caught);
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

  const analyzeAllBacklog = React.useCallback(async (input: AnalyzeBacklogInput): Promise<PlanningAgentTaskRecord | null> => {
    const { scanMode } = input;
    setBusy(true);
    try {
      const payload: JsonObject = scanMode === 'full-implementation-audit' && input.itemAuditConcurrency !== undefined ? { scanMode, itemAuditConcurrency: input.itemAuditConcurrency } : { scanMode };
      const response = await bridge.invokeAction<AnalyzeAllBacklogResponse>('analyze-all-backlog', payload);
      const modeLabel = scanMode === 'full-implementation-audit' ? 'source-first implementation audit' : 'delta curation';
      const concurrencyText = scanMode === 'full-implementation-audit' && input.itemAuditConcurrency !== undefined ? ` with concurrency ${input.itemAuditConcurrency}` : '';
      toast.push(`${response.reused ? 'Reusing' : 'Started'} ${modeLabel}${concurrencyText} backlog curation task ${response.task.taskId}.`, 'success');
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
      await reload();
    } catch (caught) {
      reportError(caught);
    } finally {
      setBusy(false);
    }
  }, [reload, reportError, toast]);

  const apply = React.useCallback(async (taskId: string, input: JsonObject): Promise<ApplyPlanningTaskResponse | null> => {
    setBusy(true);
    try {
      const response = await bridge.invokeAction<ApplyPlanningTaskResponse>('apply-planning-agent-task-result', { taskId, ...input });
      toast.push(`Applied generated output from ${response.taskId}.`, 'success');
      if (response.sessionPlanCreationDraft !== undefined) {
        setItems((prev) => prev.filter((existing) => existing.entry.taskId !== taskId));
      }
      await onRefresh();
      await reload();
      return response;
    } catch (caught) {
      reportError(caught);
      return null;
    } finally {
      setBusy(false);
    }
  }, [onRefresh, reload, reportError, toast]);

  return { items, loading, busy, reload, start, analyzeAllBacklog, retry, redraft, cancel, remove, apply };
}
