import {
  MOCK_CREATION_DRAFT_SESSION,
  analyzeMockBacklog,
  applyMockBacklogCurationDraft,
  applyMockCreationDraft,
  cancelMockPlanningTask,
  getMockArtifacts,
  getMockRecommendationsResponse,
  listMockPlanningTasks,
  mockBoard,
  mockDetail,
  mockMutationResult,
  mockPlanningTask,
  mockRecommendations,
  refreshMockRecommendations,
  relinkMockPlanningTask,
  startMockPlanningTaskFromInput,
} from '@/fixtures/mock-data';
import type { EforgeBridge, JsonObject, PlanData } from '@/types';

declare global { interface Window { eforge?: EforgeBridge; } }

const liveDaemonUrl = import.meta.env.VITE_EFORGE_DAEMON_URL as string | undefined;

export function getBridge(): EforgeBridge {
  if (window.eforge?.invokeAction) return window.eforge;
  if (import.meta.env.DEV && liveDaemonUrl) return createLiveBridge();
  return createMockBridge();
}

function createLiveBridge(): EforgeBridge {
  return {
    version: 1,
    async invokeAction<TOutput>(actionId: string, input: JsonObject = {}): Promise<TOutput> {
      const effectiveId = actionId.includes(':') ? actionId : `eforge-plan:${actionId}`;
      const { invokeExtensionAction } = await import('@eforge-build/client/browser');
      const payload = await invokeExtensionAction({
        actionId: effectiveId,
        input,
        requestedBy: { host: 'console', surface: 'workstation-dev:eforge-plan' },
      });
      if (!payload.ok) throw new Error(payload.error.message ?? `Action ${effectiveId} failed`);
      return payload.output as TOutput;
    },
  };
}

function createMockBridge(): EforgeBridge {
  return {
    version: 1,
    async invokeAction<TOutput>(actionId: string, input: JsonObject = {}): Promise<TOutput> {
      await new Promise((resolve) => setTimeout(resolve, 120));
      switch (actionId) {
        case 'list-planning-artifacts': return { artifacts: getMockArtifacts(), board: mockBoard } as TOutput;
        case 'list-board': return mockBoard as TOutput;
        case 'get-recommendations': return getMockRecommendationsResponse() as TOutput;
        case 'refresh-recommendations': return refreshMockRecommendations() as TOutput;
        case 'analyze-all-backlog': return analyzeMockBacklog() as TOutput;
        case 'show-session-plan': return mockDetail(`plan:${String(input.session ?? '')}`) as TOutput;
        case 'show-session-plan-set': return mockDetail(`plan-set:${String(input.planSetId ?? '')}`) as TOutput;
        case 'promote-selection': return { session: '2026-06-07-promoted-selection', sessionPlanPath: '.eforge/session-plans/2026-06-07-promoted-selection.md' } as TOutput;
        case 'prepare-planner-context': return { items: mockBoard.items, epics: mockBoard.epics, recommendations: { model: mockRecommendations } } as TOutput;
        case 'start-planning-agent-task': return { task: startMockPlanningTaskFromInput(input).task } as TOutput;
        case 'get-planning-agent-task': return { task: { ...mockPlanningTask, taskId: String(input.taskId ?? mockPlanningTask.taskId) } } as TOutput;
        case 'list-planning-agent-tasks': return { tasks: listMockPlanningTasks() } as TOutput;
        case 'retry-planning-agent-task': return relinkMockPlanningTask(String(input.taskId ?? ''), 'retry') as TOutput;
        case 'redraft-planning-agent-task': return relinkMockPlanningTask(String(input.taskId ?? ''), 'redraft') as TOutput;
        case 'cancel-planning-agent-task': return { task: cancelMockPlanningTask(String(input.taskId ?? mockPlanningTask.taskId), typeof input.reason === 'string' ? input.reason : undefined) } as TOutput;
        case 'apply-planning-agent-task-result': {
          if (input.applyBacklogCurationDraft !== undefined) return applyMockBacklogCurationDraft(String(input.taskId ?? mockPlanningTask.taskId)) as TOutput;
          const creationDraftInput = input.applySessionPlanCreationDraft as JsonObject | undefined;
          const applied = {
            recommendations: Boolean(input.applyRecommendations),
            handoffDrafts: Array.isArray(input.applyHandoffDrafts) ? input.applyHandoffDrafts.length : 0,
            sessionPlanSections: Array.isArray(input.applySessionPlanDrafts) ? input.applySessionPlanDrafts.length : 0,
          };
          const session = typeof creationDraftInput?.session === 'string' && creationDraftInput.session.trim().length > 0 ? creationDraftInput.session.trim() : MOCK_CREATION_DRAFT_SESSION;
          const sessionPlanCreationDraft = creationDraftInput !== undefined ? applyMockCreationDraft(session) : undefined;
          return { schemaVersion: 1, taskId: String(input.taskId ?? mockPlanningTask.taskId), applied, recommendations: { recommendations: mockRecommendations, path: 'mock://recommendations/current.json' }, ...(sessionPlanCreationDraft && { sessionPlanCreationDraft }) } as TOutput;
        }
        case 'check-session-plan-readiness': return { session: String(input.session ?? ''), readiness: { ready: true, missingDimensions: [], coveredDimensions: [], skippedDimensions: [] } } as TOutput;
        case 'set-session-plan-ready': return { kind: 'ready', ...mockMutationResult(String(input.session ?? '')), status: 'ready' } as TOutput;
        case 'set-session-plan-section': return mockMutationResult(String(input.session ?? '')) as TOutput;
        case 'select-session-plan-dimensions': return { ...mockMutationResult(String(input.session ?? '')), required_dimensions: ['scope', 'acceptance-criteria'], optional_dimensions: [] } as TOutput;
        case 'update-session-plan-metadata': return mockMutationResult(String(input.session ?? ''), { profile: (input.profile as PlanData['profile']) ?? null, agent_profile: (input.agentProfile as string) ?? null, open_questions: (input.openQuestions as string[]) ?? [] }) as TOutput;
        case 'handoff-session-plan': return { kind: 'enqueued', message: `Enqueued .eforge/session-plans/${String(input.session ?? 'mock')}.md for build.`, queueSessionId: 'mock-build-session', pid: 1234, autoBuild: true } as TOutput;
        default: return { message: `${actionId} accepted by mock bridge.` } as TOutput;
      }
    },
  };
}
