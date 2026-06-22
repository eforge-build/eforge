import * as React from 'react';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
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

// --- eforge:region plan-04-workstation-session-plan-auto-apply ---
function autoCreationItem(overrides: Partial<PlanningAgentTaskListItem> = {}): PlanningAgentTaskListItem {
  const taskRecord: PlanningAgentTaskRecord = {
    ...creationTask,
    result: { ...creationTask.result!, decision: 'ready' },
  };
  return {
    ...creationItem,
    task: taskRecord,
    ...overrides,
    entry: { ...creationItem.entry, ...(overrides.entry ?? {}) },
  };
}

function applyCreationResponse(taskId = creationTask.taskId) {
  return {
    schemaVersion: 1 as const,
    taskId,
    applied: { recommendations: false, handoffDrafts: 0, sessionPlanSections: 0 },
    sessionPlanCreationDraft: { session: 'created-session', relativePath: '.eforge/session-plans/created-session.md', readiness: { ready: true, missingDimensions: [] } },
  };
}
// --- eforge:endregion plan-04-workstation-session-plan-auto-apply ---

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
    await act(async () => { returnedTaskId = (await result.current.analyzeAllBacklog({ itemAuditConcurrency: 4 }))?.taskId; });

    expect(returnedTaskId).toBe('task-curation');
    expect(invokeAction).toHaveBeenCalledWith('analyze-all-backlog', { itemAuditConcurrency: 4 });
    expect(invokeAction.mock.calls.filter(([actionId]) => actionId === 'list-planning-agent-tasks')).toHaveLength(2);
    expect(onRefresh).not.toHaveBeenCalled();
  });

  it('can send advanced item audit concurrency without a scan mode', async () => {
    const onRefresh = vi.fn(async () => undefined);
    const fullEntry = { ...item.entry, taskId: 'task-curation-full' };
    const fullTask = { ...task, taskId: 'task-curation-full' };
    const invokeAction = vi.fn(async (actionId: string) => {
      if (actionId === 'list-planning-agent-tasks') return { tasks: [] };
      if (actionId === 'analyze-all-backlog') return { task: fullTask, entry: fullEntry, sourceFingerprint: 'fingerprint', reused: false };
      throw new Error(`unexpected ${actionId}`);
    });
    setBridge({ invokeAction: invokeAction as EforgeBridge['invokeAction'] });

    const { usePlanningTaskWorkflows, wrapper } = await loadHookWithWrapper();
    const { result } = renderHook(() => usePlanningTaskWorkflows(onRefresh), { wrapper });
    await waitFor(() => expect(invokeAction).toHaveBeenCalledWith('list-planning-agent-tasks', {}));

    await act(async () => { await result.current.analyzeAllBacklog({ itemAuditConcurrency: 6 }); });

    expect(invokeAction).toHaveBeenCalledWith('analyze-all-backlog', { itemAuditConcurrency: 6 });
  });

  it('reloads task list when polling observes terminal task status', async () => {
    vi.useFakeTimers();
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
    await act(async () => { await Promise.resolve(); });
    expect(invokeAction).toHaveBeenCalledWith('list-planning-agent-tasks', {});

    await act(async () => { vi.advanceTimersByTime(1600); await Promise.resolve(); await Promise.resolve(); });
    expect(invokeAction).toHaveBeenCalledWith('get-planning-agent-task', { taskId: task.taskId });
    expect(invokeAction.mock.calls.filter(([actionId]) => actionId === 'list-planning-agent-tasks')).toHaveLength(2);
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
    expect(screen.getByText('Applied generated output from task-curation.')).toBeTruthy();
    expect(onRefresh).toHaveBeenCalledOnce();
    expect(invokeAction.mock.calls.filter(([actionId]) => actionId === 'list-planning-agent-tasks')).toHaveLength(2);
  });

  it('removes a consumed creation task from local state after successful apply and reloads', async () => {
    const onRefresh = vi.fn(async () => undefined);
    let listCalls = 0;
    const invokeAction = vi.fn(async (actionId: string) => {
      if (actionId === 'list-planning-agent-tasks') {
        listCalls += 1;
        return { tasks: listCalls === 1 ? [creationItem] : [] };
      }
      if (actionId === 'apply-planning-agent-task-result') return applyCreationResponse();
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

  // --- eforge:region plan-04-workstation-session-plan-auto-apply ---
  it('auto-applies eligible ready session-plan creation tasks once and opens the created plan', async () => {
    const onRefresh = vi.fn(async () => undefined);
    const onCreated = vi.fn();
    let listCalls = 0;
    const invokeAction = vi.fn(async (actionId: string, input: unknown) => {
      if (actionId === 'list-planning-agent-tasks') {
        listCalls += 1;
        return { tasks: listCalls === 1 ? [autoCreationItem()] : [] };
      }
      if (actionId === 'apply-planning-agent-task-result') return applyCreationResponse((input as { taskId: string }).taskId);
      throw new Error(`unexpected ${actionId}`);
    });
    setBridge({ invokeAction: invokeAction as EforgeBridge['invokeAction'] });

    const { usePlanningTaskWorkflows, wrapper } = await loadHookWithWrapper();
    const { result } = renderHook(() => usePlanningTaskWorkflows(onRefresh, onCreated), { wrapper });

    await waitFor(() => expect(invokeAction).toHaveBeenCalledWith('apply-planning-agent-task-result', { taskId: creationTask.taskId, applySessionPlanCreationDraft: {} }));
    await waitFor(() => expect(result.current.items.map((entry) => entry.entry.taskId)).toEqual([]));

    expect(invokeAction.mock.calls.filter(([actionId]) => actionId === 'apply-planning-agent-task-result')).toHaveLength(1);
    expect(screen.queryByText('Applied generated output from task-creation.')).toBeNull();
    expect(onRefresh).toHaveBeenCalledOnce();
    expect(onCreated).toHaveBeenCalledWith(expect.objectContaining({ session: 'created-session' }));
  });

  it('does not duplicate auto-apply while an eligible task is already in flight', async () => {
    const onRefresh = vi.fn(async () => undefined);
    let resolveApply: (value: unknown) => void = () => undefined;
    const applyPromise = new Promise((resolve) => { resolveApply = resolve; });
    const invokeAction = vi.fn((actionId: string) => {
      if (actionId === 'list-planning-agent-tasks') return Promise.resolve({ tasks: [autoCreationItem()] });
      if (actionId === 'apply-planning-agent-task-result') return applyPromise;
      return Promise.reject(new Error(`unexpected ${actionId}`));
    });
    setBridge({ invokeAction: invokeAction as EforgeBridge['invokeAction'] });

    const { usePlanningTaskWorkflows, wrapper } = await loadHookWithWrapper();
    const { result } = renderHook(() => usePlanningTaskWorkflows(onRefresh), { wrapper });
    await waitFor(() => expect(invokeAction.mock.calls.filter(([actionId]) => actionId === 'apply-planning-agent-task-result')).toHaveLength(1));

    await act(async () => { await result.current.reload(); });
    await act(async () => { await result.current.apply(creationTask.taskId, { applySessionPlanCreationDraft: {} }); });
    expect(invokeAction.mock.calls.filter(([actionId]) => actionId === 'apply-planning-agent-task-result')).toHaveLength(1);

    await act(async () => { resolveApply(applyCreationResponse()); await applyPromise; });
    await waitFor(() => expect(result.current.items.map((entry) => entry.entry.taskId)).toEqual([]));
    expect(invokeAction.mock.calls.filter(([actionId]) => actionId === 'apply-planning-agent-task-result')).toHaveLength(1);
  });

  it('does not duplicate auto-apply when polling completion and terminal reload observe the same task', async () => {
    vi.useFakeTimers();
    const onRefresh = vi.fn(async () => undefined);
    const runningCreation = autoCreationItem({ status: 'running', task: { ...creationTask, status: 'running', result: undefined } });
    let resolveApply: (value: unknown) => void = () => undefined;
    const applyPromise = new Promise((resolve) => { resolveApply = resolve; });
    const invokeAction = vi.fn((actionId: string) => {
      if (actionId === 'list-planning-agent-tasks') return Promise.resolve({ tasks: [autoCreationItem()] });
      if (actionId === 'get-planning-agent-task') return Promise.resolve({ task: { ...creationTask, result: { ...creationTask.result!, decision: 'ready' } } });
      if (actionId === 'apply-planning-agent-task-result') return applyPromise;
      return Promise.reject(new Error(`unexpected ${actionId}`));
    });
    invokeAction.mockResolvedValueOnce({ tasks: [runningCreation] });
    setBridge({ invokeAction: invokeAction as EforgeBridge['invokeAction'] });

    const { usePlanningTaskWorkflows, wrapper } = await loadHookWithWrapper();
    renderHook(() => usePlanningTaskWorkflows(onRefresh), { wrapper });
    await act(async () => { await Promise.resolve(); });

    await act(async () => { vi.advanceTimersByTime(1600); await Promise.resolve(); await Promise.resolve(); });
    expect(invokeAction).toHaveBeenCalledWith('get-planning-agent-task', { taskId: creationTask.taskId });
    expect(invokeAction.mock.calls.filter(([actionId]) => actionId === 'list-planning-agent-tasks')).toHaveLength(2);
    expect(invokeAction.mock.calls.filter(([actionId]) => actionId === 'apply-planning-agent-task-result')).toHaveLength(1);

    await act(async () => { resolveApply(applyCreationResponse()); await applyPromise; });
  });

  it('leaves needs-input, applied, non-creation, malformed, and multi-output creation tasks for review', async () => {
    const onRefresh = vi.fn(async () => undefined);
    const blankDraft = { session: ' ', topic: 'Topic', planningType: 'feature', planningDepth: 'focused', sections: [{ dimension: 'scope', content: 'Scope.' }] };
    const blankTopicDraft = { session: 'created-session', topic: ' ', planningType: 'feature', planningDepth: 'focused', sections: [{ dimension: 'scope', content: 'Scope.' }] };
    const blankTypeDraft = { session: 'created-session', topic: 'Topic', planningType: ' ', planningDepth: 'focused', sections: [{ dimension: 'scope', content: 'Scope.' }] };
    const blankDepthDraft = { session: 'created-session', topic: 'Topic', planningType: 'feature', planningDepth: ' ', sections: [{ dimension: 'scope', content: 'Scope.' }] };
    const noSectionsDraft = { session: 'created-session', topic: 'Topic', planningType: 'feature', planningDepth: 'focused', sections: [] };
    const nonEligible = [
      autoCreationItem({ task: { ...creationTask, taskId: 'needs-input', result: { ...creationTask.result!, decision: 'needs-input' } }, entry: { ...creationItem.entry, taskId: 'needs-input' } }),
      autoCreationItem({ task: { ...creationTask, taskId: 'no-decision', result: { ...creationTask.result!, decision: undefined } }, entry: { ...creationItem.entry, taskId: 'no-decision' } }),
      autoCreationItem({ entry: { ...creationItem.entry, taskId: 'applied', appliedAt: 'later' }, task: { ...creationTask, taskId: 'applied', result: { ...creationTask.result!, decision: 'ready' } } }),
      autoCreationItem({ available: false, staleReason: 'missing', entry: { ...creationItem.entry, taskId: 'unavailable' }, task: { ...creationTask, taskId: 'unavailable', result: { ...creationTask.result!, decision: 'ready' } } }),
      autoCreationItem({ status: 'failed', entry: { ...creationItem.entry, taskId: 'failed' }, task: { ...creationTask, taskId: 'failed', status: 'failed', result: { ...creationTask.result!, decision: 'ready' } } }),
      autoCreationItem({ status: 'cancelled', entry: { ...creationItem.entry, taskId: 'cancelled' }, task: { ...creationTask, taskId: 'cancelled', status: 'cancelled', result: { ...creationTask.result!, decision: 'ready' } } }),
      autoCreationItem({ entry: { ...creationItem.entry, taskId: 'refresh', purpose: 'recommendation-refresh', requestedOutputSections: ['recommendations'] }, task: { ...creationTask, taskId: 'refresh', result: { ...creationTask.result!, decision: 'ready', recommendations: { recommendedNextSequence: [], safeParallelizableGroups: [] } } } }),
      autoCreationItem({ entry: { ...creationItem.entry, taskId: 'curation', purpose: 'backlog-curation', requestedOutputSections: ['backlogCurationDraft', 'recommendations'] }, task: { ...creationTask, taskId: 'curation', result: { ...creationTask.result!, decision: 'ready', recommendations: { recommendedNextSequence: [], safeParallelizableGroups: [] } } } }),
      autoCreationItem({ entry: { ...creationItem.entry, taskId: 'recommendation-only', requestedOutputSections: ['recommendations'] }, task: { ...creationTask, taskId: 'recommendation-only', result: { summary: 'Recommendations.', assumptionsOpenQuestions: [], decision: 'ready', recommendations: { recommendedNextSequence: [], safeParallelizableGroups: [] } } } }),
      autoCreationItem({ entry: { ...creationItem.entry, taskId: 'handoff-only', requestedOutputSections: ['handoffDrafts'] }, task: { ...creationTask, taskId: 'handoff-only', result: { summary: 'Handoff.', assumptionsOpenQuestions: [], decision: 'ready', handoffDrafts: [{ selection: {} }] } } }),
      autoCreationItem({ entry: { ...creationItem.entry, taskId: 'patch', requestedOutputSections: ['sessionPlanPatch'] }, task: { ...creationTask, taskId: 'patch', result: { summary: 'Patch.', assumptionsOpenQuestions: [], decision: 'ready', sessionPlanPatch: { sections: [{ dimension: 'scope', content: 'Scope.' }] } } } }),
      autoCreationItem({ entry: { ...creationItem.entry, taskId: 'plan-revision', requestedOutputSections: ['planRevisionTurn'] }, task: { ...creationTask, taskId: 'plan-revision', result: { summary: 'Revision.', assumptionsOpenQuestions: [], decision: 'ready', planRevisionTurn: {} as never } } }),
      autoCreationItem({ entry: { ...creationItem.entry, taskId: 'plan-drafts', requestedOutputSections: ['sessionPlanCreationDraft', 'planDrafts'] }, task: { ...creationTask, taskId: 'plan-drafts', result: { ...creationTask.result!, decision: 'ready', planDrafts: [{ title: 'Plan', body: 'Body.' }] } } }),
      autoCreationItem({ entry: { ...creationItem.entry, taskId: 'playbook-draft', requestedOutputSections: ['sessionPlanCreationDraft', 'playbookDraft'] }, task: { ...creationTask, taskId: 'playbook-draft', result: { ...creationTask.result!, decision: 'ready', playbookDraft: { name: 'Playbook', body: 'Body.' } } } }),
      autoCreationItem({ entry: { ...creationItem.entry, taskId: 'multi-output', requestedOutputSections: ['sessionPlanCreationDraft', 'handoffDrafts'] }, task: { ...creationTask, taskId: 'multi-output', result: { ...creationTask.result!, decision: 'ready', handoffDrafts: [{ selection: {} }] } } }),
      autoCreationItem({ entry: { ...creationItem.entry, taskId: 'single-request-recommendations' }, task: { ...creationTask, taskId: 'single-request-recommendations', result: { ...creationTask.result!, decision: 'ready', recommendations: { recommendedNextSequence: [], safeParallelizableGroups: [] } } } }),
      autoCreationItem({ entry: { ...creationItem.entry, taskId: 'single-request-curation' }, task: { ...creationTask, taskId: 'single-request-curation', result: { ...creationTask.result!, decision: 'ready', backlogCurationDraft: {} as never } } }),
      autoCreationItem({ entry: { ...creationItem.entry, taskId: 'single-request-handoff' }, task: { ...creationTask, taskId: 'single-request-handoff', result: { ...creationTask.result!, decision: 'ready', handoffDraft: { selection: {} } } } }),
      autoCreationItem({ entry: { ...creationItem.entry, taskId: 'blank-draft' }, task: { ...creationTask, taskId: 'blank-draft', result: { ...creationTask.result!, decision: 'ready', sessionPlanCreationDraft: blankDraft } } }),
      autoCreationItem({ entry: { ...creationItem.entry, taskId: 'blank-topic' }, task: { ...creationTask, taskId: 'blank-topic', result: { ...creationTask.result!, decision: 'ready', sessionPlanCreationDraft: blankTopicDraft } } }),
      autoCreationItem({ entry: { ...creationItem.entry, taskId: 'blank-type' }, task: { ...creationTask, taskId: 'blank-type', result: { ...creationTask.result!, decision: 'ready', sessionPlanCreationDraft: blankTypeDraft } } }),
      autoCreationItem({ entry: { ...creationItem.entry, taskId: 'blank-depth' }, task: { ...creationTask, taskId: 'blank-depth', result: { ...creationTask.result!, decision: 'ready', sessionPlanCreationDraft: blankDepthDraft } } }),
      autoCreationItem({ entry: { ...creationItem.entry, taskId: 'no-sections' }, task: { ...creationTask, taskId: 'no-sections', result: { ...creationTask.result!, decision: 'ready', sessionPlanCreationDraft: noSectionsDraft } } }),
    ];
    const invokeAction = vi.fn(async (actionId: string) => {
      if (actionId === 'list-planning-agent-tasks') return { tasks: nonEligible };
      throw new Error(`unexpected ${actionId}`);
    });
    setBridge({ invokeAction: invokeAction as EforgeBridge['invokeAction'] });

    const { usePlanningTaskWorkflows, wrapper } = await loadHookWithWrapper();
    const { result } = renderHook(() => usePlanningTaskWorkflows(onRefresh), { wrapper });

    await waitFor(() => expect(result.current.items).toHaveLength(nonEligible.length));
    expect(result.current.items.map((entry) => entry.entry.taskId)).toEqual(nonEligible.map((entry) => entry.entry.taskId));
    expect(invokeAction.mock.calls.filter(([actionId]) => actionId === 'apply-planning-agent-task-result')).toHaveLength(0);
  });

  it('keeps needs-input clarification controls usable for redraft', async () => {
    const onRedraft = vi.fn(async () => undefined);
    const needsInput = autoCreationItem({
      task: {
        ...creationTask,
        result: {
          summary: 'Need more detail.',
          assumptionsOpenQuestions: [],
          decision: 'needs-input',
          clarificationQuestions: [{ question: 'What outcome matters?', why: 'To scope the draft.', options: ['speed', 'quality'] }],
        },
      },
    });
    const { PlanningTaskResultPreview } = await import('./planning-task-result-preview');

    render(<PlanningTaskResultPreview item={needsInput} busy={false} onRedraft={onRedraft} onApply={vi.fn(async () => undefined)} />);

    expect(screen.getByText(/What outcome matters/)).toBeTruthy();
    expect(screen.getByText('To scope the draft.')).toBeTruthy();
    fireEvent.change(screen.getByPlaceholderText('Your answer'), { target: { value: 'Prioritize quality.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Answer and redraft' }));

    expect(onRedraft).toHaveBeenCalledWith('task-creation', { answers: ['Q: What outcome matters?\nA: Prioritize quality.'] });
  });

  it('stores automatic apply failures without retrying and clears the error after manual creation succeeds', async () => {
    const onRefresh = vi.fn(async () => undefined);
    let applyCalls = 0;
    const invokeAction = vi.fn(async (actionId: string) => {
      if (actionId === 'list-planning-agent-tasks') {
        return { tasks: [autoCreationItem()] };
      }
      if (actionId === 'apply-planning-agent-task-result') {
        applyCalls += 1;
        if (applyCalls === 1) throw new Error('Session plan already exists');
        return applyCreationResponse();
      }
      throw new Error(`unexpected ${actionId}`);
    });
    setBridge({ invokeAction: invokeAction as EforgeBridge['invokeAction'] });

    const { usePlanningTaskWorkflows, wrapper } = await loadHookWithWrapper();
    const { result } = renderHook(() => usePlanningTaskWorkflows(onRefresh), { wrapper });

    await waitFor(() => expect(result.current.applyErrors[creationTask.taskId]?.message).toBe('Session plan already exists'));
    expect(result.current.items.map((entry) => entry.entry.taskId)).toEqual([creationTask.taskId]);
    expect(result.current.applyErrors[creationTask.taskId]?.automatic).toBe(true);

    await act(async () => { await result.current.reload(); });
    expect(result.current.items.map((entry) => entry.entry.taskId)).toEqual([creationTask.taskId]);
    expect(invokeAction.mock.calls.filter(([actionId]) => actionId === 'apply-planning-agent-task-result')).toHaveLength(1);

    await act(async () => { await result.current.apply(creationTask.taskId, { applySessionPlanCreationDraft: {} }); });

    expect(result.current.applyErrors[creationTask.taskId]).toBeUndefined();
    expect(invokeAction.mock.calls.filter(([actionId]) => actionId === 'apply-planning-agent-task-result')).toHaveLength(2);
  });
  // --- eforge:endregion plan-04-workstation-session-plan-auto-apply ---
});
