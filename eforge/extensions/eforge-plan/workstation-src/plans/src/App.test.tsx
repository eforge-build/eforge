import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getMockArtifacts, getMockCompactBoard, mockDetail, mockGetRecommendationsStaleResponse } from '@/fixtures/mock-data';
import { getMockRoadmapState } from '@/fixtures/mock-roadmap';
import { mockStoreStatus } from '@/fixtures/mock-storage';
import { getMockPlanRevisionSession } from '@/fixtures/mock-plan-revisions';
import type { EforgeBridge, JsonObject, PlanningAgentTaskListItem, PlanningAgentTaskRecord } from '@/types';

function setBridge(bridge: EforgeBridge) {
  (window as Window & { eforge?: EforgeBridge }).eforge = bridge;
}

const creationTask: PlanningAgentTaskRecord = {
  taskId: 'task-creation',
  kind: 'eforge-plan.planning-draft',
  status: 'completed',
  createdAt: 'now',
  updatedAt: 'later',
  completedAt: 'later',
  result: {
    decision: 'ready',
    summary: 'Ready.',
    assumptionsOpenQuestions: [],
    sessionPlanCreationDraft: {
      session: 'created-session',
      topic: 'Topic',
      planningType: 'feature',
      planningDepth: 'focused',
      sections: [{ dimension: 'scope', content: 'Scope.' }],
    },
  },
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

describe('App workstation surface', () => {
  beforeEach(() => {
    vi.resetModules();
    window.history.pushState(null, '', '/');
  });

  it('renders the focus switcher (Roadmap/Backlog/Plans) and activity rail, loading startup data through the bridge', async () => {
    const calls: Array<{ actionId: string; input: unknown }> = [];
    setBridge({
      version: 9,
      async invokeAction<TOutput>(actionId: string, input?: unknown): Promise<TOutput> {
        calls.push({ actionId, input: input ?? {} });
        if (actionId === 'list-board-compact') return getMockCompactBoard({ limit: 50 }) as TOutput;
        if (actionId === 'list-planning-artifacts') return { artifacts: getMockArtifacts() } as TOutput;
        if (actionId === 'get-recommendations') return mockGetRecommendationsStaleResponse as TOutput;
        if (actionId === 'get-roadmap-state') return getMockRoadmapState() as TOutput;
        if (actionId === 'list-draft-units') return { units: [] } as TOutput;
        if (actionId === 'get-store-status') return mockStoreStatus as TOutput;
        if (actionId === 'list-planning-agent-tasks') return { tasks: [] } as TOutput;
        throw new Error(`unexpected action ${actionId}`);
      },
    });
    const { App } = await import('./App');

    render(<App />);

    // Roadmap / Backlog / Plans are focuses on one surface, switched in the
    // header. The backlog focus loads by default with its activity rail; AI
    // planning lives in that rail rather than a separate tab.
    await waitFor(() => expect(screen.getByText('Backlog')).toBeTruthy());
    expect(screen.getByText('Roadmap')).toBeTruthy();
    expect(screen.getByText('Planning activity')).toBeTruthy();
    expect(calls.map((call) => call.actionId)).toEqual(expect.arrayContaining(['get-roadmap-state', 'get-recommendations', 'list-board-compact', 'list-planning-artifacts', 'list-draft-units', 'get-store-status', 'list-planning-agent-tasks']));
    expect(calls).toContainEqual({ actionId: 'list-planning-artifacts', input: { includeBoard: false } });
    expect(screen.queryByText(/unexpected action/)).toBeNull();
  });

  it('opens Plans focus with the created session selected after automatic session-plan creation', async () => {
    const calls: Array<{ actionId: string; input: unknown }> = [];
    let taskListCalls = 0;
    setBridge({
      version: 9,
      async invokeAction<TOutput>(actionId: string, input?: unknown): Promise<TOutput> {
        calls.push({ actionId, input: input ?? {} });
        if (actionId === 'list-board-compact') return getMockCompactBoard({ limit: 50 }) as TOutput;
        if (actionId === 'list-planning-artifacts') return { artifacts: getMockArtifacts() } as TOutput;
        if (actionId === 'get-recommendations') return mockGetRecommendationsStaleResponse as TOutput;
        if (actionId === 'get-roadmap-state') return getMockRoadmapState() as TOutput;
        if (actionId === 'list-draft-units') return { units: [] } as TOutput;
        if (actionId === 'get-store-status') return mockStoreStatus as TOutput;
        if (actionId === 'list-planning-agent-tasks') {
          taskListCalls += 1;
          return { tasks: taskListCalls === 1 ? [creationItem] : [] } as TOutput;
        }
        if (actionId === 'show-session-plan') return mockDetail(`plan:${String((input as { session?: string }).session ?? '')}`) as TOutput;
        if (actionId === 'get-plan-revision-session') return getMockPlanRevisionSession(input as JsonObject) as TOutput;
        if (actionId === 'apply-planning-agent-task-result') {
          return {
            schemaVersion: 1,
            taskId: creationTask.taskId,
            applied: { recommendations: false, handoffDrafts: 0, sessionPlanSections: 0 },
            sessionPlanCreationDraft: {
              session: 'created-session',
              relativePath: '.eforge/session-plans/created-session.md',
              readiness: { ready: true, missingDimensions: [] },
            },
          } as TOutput;
        }
        throw new Error(`unexpected action ${actionId}`);
      },
    });
    const { App } = await import('./App');

    render(<App />);

    await waitFor(() => expect(calls).toContainEqual({
      actionId: 'apply-planning-agent-task-result',
      input: { taskId: creationTask.taskId, applySessionPlanCreationDraft: {} },
    }));
    await waitFor(() => expect(window.location.search).toContain('focus=plans'));
    expect(screen.queryByText(/unexpected action/)).toBeNull();
    expect(new URLSearchParams(window.location.search).get('plan')).toBe('plan:created-session');
  });

  it('opens Plans focus with the created session selected after manually creating a session plan', async () => {
    const calls: Array<{ actionId: string; input: unknown }> = [];
    let applied = false;
    const manualCreationItem: PlanningAgentTaskListItem = {
      ...creationItem,
      entry: { ...creationItem.entry, requestedOutputSections: ['sessionPlanCreationDraft', 'recommendations'] },
    };
    setBridge({
      version: 9,
      async invokeAction<TOutput>(actionId: string, input?: unknown): Promise<TOutput> {
        calls.push({ actionId, input: input ?? {} });
        if (actionId === 'list-board-compact') return getMockCompactBoard({ limit: 50 }) as TOutput;
        if (actionId === 'list-planning-artifacts') return { artifacts: getMockArtifacts() } as TOutput;
        if (actionId === 'get-recommendations') return mockGetRecommendationsStaleResponse as TOutput;
        if (actionId === 'get-roadmap-state') return getMockRoadmapState() as TOutput;
        if (actionId === 'list-draft-units') return { units: [] } as TOutput;
        if (actionId === 'get-store-status') return mockStoreStatus as TOutput;
        if (actionId === 'list-planning-agent-tasks') return { tasks: applied ? [] : [manualCreationItem] } as TOutput;
        if (actionId === 'show-session-plan') return mockDetail(`plan:${String((input as { session?: string }).session ?? '')}`) as TOutput;
        if (actionId === 'get-plan-revision-session') return getMockPlanRevisionSession(input as JsonObject) as TOutput;
        if (actionId === 'apply-planning-agent-task-result') {
          applied = true;
          return {
            schemaVersion: 1,
            taskId: creationTask.taskId,
            applied: { recommendations: false, handoffDrafts: 0, sessionPlanSections: 0 },
            sessionPlanCreationDraft: {
              session: 'created-session',
              relativePath: '.eforge/session-plans/created-session.md',
              readiness: { ready: true, missingDimensions: [] },
            },
          } as TOutput;
        }
        throw new Error(`unexpected action ${actionId}`);
      },
    });
    const { App } = await import('./App');

    render(<App />);

    await waitFor(() => expect(screen.getByText('Planning activity')).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: /Planning task/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Create session plan' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm create session plan' }));

    await waitFor(() => expect(calls).toContainEqual({
      actionId: 'apply-planning-agent-task-result',
      input: { taskId: creationTask.taskId, applySessionPlanCreationDraft: {} },
    }));
    await waitFor(() => expect(window.location.search).toContain('focus=plans'));
    expect(screen.queryByText(/unexpected action/)).toBeNull();
    expect(new URLSearchParams(window.location.search).get('plan')).toBe('plan:created-session');
  });
});
