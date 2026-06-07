import { mockArtifacts, mockBoard, mockDetail, mockRecommendations } from '@/fixtures/mock-data';
import type { EforgeBridge, JsonObject } from '@/types';

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
        case 'list-planning-artifacts': return { artifacts: mockArtifacts, board: mockBoard } as TOutput;
        case 'list-board': return mockBoard as TOutput;
        case 'get-recommendations': return { recommendations: mockRecommendations, path: 'mock://recommendations/current.json' } as TOutput;
        case 'show-session-plan': return mockDetail(`plan:${String(input.session ?? '')}`) as TOutput;
        case 'show-session-plan-set': return mockDetail(`plan-set:${String(input.planSetId ?? '')}`) as TOutput;
        case 'promote-selection': return { session: '2026-06-07-promoted-selection', sessionPlanPath: '.eforge/session-plans/2026-06-07-promoted-selection.md' } as TOutput;
        case 'prepare-planner-context': return { items: mockBoard.items, epics: mockBoard.epics, recommendations: { model: mockRecommendations } } as TOutput;
        case 'check-session-plan-readiness': return { message: 'Readiness checked.', readiness: { ready: true, missingDimensions: [] } } as TOutput;
        case 'set-session-plan-ready': return { message: 'Plan marked ready.', readiness: { ready: true, missingDimensions: [] } } as TOutput;
        case 'handoff-session-plan': return { message: 'Ready for handoff.', command: `/eforge:build .eforge/session-plans/${String(input.session ?? 'mock')}.md` } as TOutput;
        default: return { message: `${actionId} accepted by mock bridge.` } as TOutput;
      }
    },
  };
}
