import * as React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EforgeBridge, PlanningAgentTaskListItem, PlanningAgentTaskRecord } from '@/types';

function setBridge(bridge: EforgeBridge) {
  (window as Window & { eforge?: EforgeBridge }).eforge = bridge;
}

const task: PlanningAgentTaskRecord = {
  taskId: 'task-curation',
  kind: 'eforge-plan.planning-draft',
  status: 'running',
  createdAt: 'now',
  updatedAt: 'now',
};

const item: PlanningAgentTaskListItem = {
  entry: {
    taskId: task.taskId,
    originalRequest: '',
    derivedRequest: 'Analyze all backlog records for curation.',
    selection: {},
    requestedOutputSections: ['backlogCurationDraft', 'recommendations'],
    purpose: 'backlog-curation',
    sourceFingerprint: 'fingerprint',
    createdAt: 'now',
  },
  available: true,
  status: 'running',
  task,
};

// --- eforge:region plan-01-workstation-session-plan-consumption ---
const creationTask: PlanningAgentTaskRecord = {
  taskId: 'task-creation',
  kind: 'eforge-plan.planning-draft',
  status: 'completed',
  createdAt: 'now',
  updatedAt: 'later',
  completedAt: 'later',
  result: { summary: 'Ready.', assumptionsOpenQuestions: [], sessionPlanCreationDraft: { session: 'created-session', topic: 'Topic', planningType: 'feature', planningDepth: 'focused', sections: [{ dimension: 'scope', content: 'Scope.' }] } },
};

const creationItem: PlanningAgentTaskListItem = {
  entry: {
    taskId: creationTask.taskId,
    originalRequest: '',
    derivedRequest: 'Draft a session plan.',
    selection: {},
    requestedOutputSections: ['sessionPlanCreationDraft'],
    createdAt: 'now',
  },
  available: true,
  status: 'completed',
  task: creationTask,
};
// --- eforge:endregion plan-01-workstation-session-plan-consumption ---

async function loadHookWithWrapper() {
  const [{ usePlanningTaskWorkflows }, { ToastProvider }] = await Promise.all([
    import('./use-planning-task-workflows'),
    import('@/components/toast'),
  ]);
  const wrapper = ({ children }: { children: React.ReactNode }) => <ToastProvider>{children}</ToastProvider>;
  return { usePlanningTaskWorkflows, wrapper };
}

describe('usePlanningTaskWorkflows curation actions', () => {
  beforeEach(() => {
    vi.resetModules();
    delete (window as Window & { eforge?: EforgeBridge }).eforge;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('starts or reuses analyze-all through the bridge and reloads without refreshing board data', async () => {
    const onRefresh = vi.fn(async () => undefined);
    const invokeAction = vi.fn(async (actionId: string) => {
      if (actionId === 'list-planning-agent-tasks') return { tasks: [item] };
      if (actionId === 'analyze-all-backlog') return { task, entry: item.entry, sourceFingerprint: 'fingerprint', reused: true };
      throw new Error(`unexpected ${actionId}`);
    });
    setBridge({ invokeAction: invokeAction as EforgeBridge['invokeAction'] });

    const { usePlanningTaskWorkflows, wrapper } = await loadHookWithWrapper();
    const { result } = renderHook(() => usePlanningTaskWorkflows(onRefresh), { wrapper });
    await waitFor(() => expect(invokeAction).toHaveBeenCalledWith('list-planning-agent-tasks', {}));

    let returnedTaskId: string | undefined;
    await act(async () => { returnedTaskId = (await result.current.analyzeAllBacklog())?.taskId; });

    expect(returnedTaskId).toBe('task-curation');
    expect(invokeAction).toHaveBeenCalledWith('analyze-all-backlog', {});
    expect(invokeAction.mock.calls.filter(([actionId]) => actionId === 'list-planning-agent-tasks')).toHaveLength(2);
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('reloads task list when polling observes terminal task status', async () => {
    const onRefresh = vi.fn(async () => undefined);
    const completedTask: PlanningAgentTaskRecord = { ...task, status: 'completed', completedAt: 'later', result: { summary: 'Done.', assumptionsOpenQuestions: [] } };
    const invokeAction = vi.fn(async (actionId: string) => {
      if (actionId === 'list-planning-agent-tasks') return { tasks: [item] };
      if (actionId === 'get-planning-agent-task') return { task: completedTask };
      throw new Error(`unexpected ${actionId}`);
    });
    setBridge({ invokeAction: invokeAction as EforgeBridge['invokeAction'] });
    const { usePlanningTaskWorkflows, wrapper } = await loadHookWithWrapper();

    renderHook(() => usePlanningTaskWorkflows(onRefresh), { wrapper });
    await waitFor(() => expect(invokeAction).toHaveBeenCalledWith('list-planning-agent-tasks', {}));

    await waitFor(() => expect(invokeAction).toHaveBeenCalledWith('get-planning-agent-task', { taskId: task.taskId }), { timeout: 2500 });
    await waitFor(() => expect(invokeAction.mock.calls.filter(([actionId]) => actionId === 'list-planning-agent-tasks')).toHaveLength(2));
  });

  it('refreshes board data after curation apply and reloads tasks', async () => {
    const onRefresh = vi.fn(async () => undefined);
    const invokeAction = vi.fn(async (actionId: string) => {
      if (actionId === 'list-planning-agent-tasks') return { tasks: [item] };
      if (actionId === 'apply-planning-agent-task-result') return { schemaVersion: 1, taskId: task.taskId, applied: { recommendations: false, handoffDrafts: 0, sessionPlanSections: 0, backlogCuration: 1 }, backlogCuration: { changedItemIds: ['auto-mode'] } };
      throw new Error(`unexpected ${actionId}`);
    });
    setBridge({ invokeAction: invokeAction as EforgeBridge['invokeAction'] });

    const { usePlanningTaskWorkflows, wrapper } = await loadHookWithWrapper();
    const { result } = renderHook(() => usePlanningTaskWorkflows(onRefresh), { wrapper });
    await waitFor(() => expect(invokeAction).toHaveBeenCalledWith('list-planning-agent-tasks', {}));

    await act(async () => { await result.current.apply(task.taskId, { applyBacklogCurationDraft: { previewAcknowledged: true, confirmApply: true } }); });

    expect(invokeAction).toHaveBeenCalledWith('apply-planning-agent-task-result', { taskId: task.taskId, applyBacklogCurationDraft: { previewAcknowledged: true, confirmApply: true } });
    expect(onRefresh).toHaveBeenCalledOnce();
    expect(invokeAction.mock.calls.filter(([actionId]) => actionId === 'list-planning-agent-tasks')).toHaveLength(2);
  });

  // --- eforge:region plan-01-workstation-session-plan-consumption ---
  it('removes a consumed creation task from local state after successful apply and reloads', async () => {
    const onRefresh = vi.fn(async () => undefined);
    let listCalls = 0;
    const invokeAction = vi.fn(async (actionId: string) => {
      if (actionId === 'list-planning-agent-tasks') {
        listCalls += 1;
        return { tasks: listCalls === 1 ? [creationItem] : [] };
      }
      if (actionId === 'apply-planning-agent-task-result') return { schemaVersion: 1, taskId: creationTask.taskId, applied: { recommendations: false, handoffDrafts: 0, sessionPlanSections: 0 }, sessionPlanCreationDraft: { session: 'created-session', relativePath: '.eforge/session-plans/created-session.md', readiness: { ready: true, missingDimensions: [] } } };
      throw new Error(`unexpected ${actionId}`);
    });
    setBridge({ invokeAction: invokeAction as EforgeBridge['invokeAction'] });

    const { usePlanningTaskWorkflows, wrapper } = await loadHookWithWrapper();
    const { result } = renderHook(() => usePlanningTaskWorkflows(onRefresh), { wrapper });
    await waitFor(() => expect(result.current.items.map((entry) => entry.entry.taskId)).toEqual(['task-creation']));

    await act(async () => { await result.current.apply(creationTask.taskId, { applySessionPlanCreationDraft: {} }); });

    expect(result.current.items.map((entry) => entry.entry.taskId)).toEqual([]);
    expect(onRefresh).toHaveBeenCalledOnce();
    expect(invokeAction.mock.calls.filter(([actionId]) => actionId === 'list-planning-agent-tasks')).toHaveLength(2);
  });
  // --- eforge:endregion plan-01-workstation-session-plan-consumption ---
});
