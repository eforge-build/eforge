import * as React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getMockArtifacts, mockBoard, mockGetRecommendationsStaleResponse, refreshMockRecommendations } from '@/fixtures/mock-data';
import type { EforgeBridge } from '@/types';

function setBridge(bridge: EforgeBridge) {
  (window as Window & { eforge?: EforgeBridge }).eforge = bridge;
}

describe('useWorkstationData recommendations mapping', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('maps live get-recommendations status and active refresh task data', async () => {
    const invokeActionSpy = vi.fn();
    const bridge: EforgeBridge = {
      version: 7,
      async invokeAction<TOutput>(actionId: string): Promise<TOutput> {
        invokeActionSpy(actionId, {});
        if (actionId === 'list-board') return mockBoard as TOutput;
        if (actionId === 'list-planning-artifacts') return { artifacts: getMockArtifacts() } as TOutput;
        if (actionId === 'get-recommendations') return mockGetRecommendationsStaleResponse as TOutput;
        throw new Error(`unexpected action ${actionId}`);
      },
    };
    setBridge(bridge);

    const { useWorkstationData } = await import('./use-workstation-data');
    const { result } = renderHook(() => useWorkstationData());

    await waitFor(() => expect(invokeActionSpy).toHaveBeenCalledWith('get-recommendations', {}));
    await waitFor(() => expect(result.current.recommendationStatus?.state).toBe('stale'));

    expect(result.current.recommendations?.recommendedNextSequence[0]?.itemId).toBe('recommend-next-work');
    expect(result.current.recommendationStatus?.staleReasons.map((reason: { code: string }) => reason.code)).toContain('source-fingerprint-drift');
    expect(result.current.activeRecommendationRefreshTask?.taskId).toBe('task-refresh-recommendations');
    expect(result.current.board.items.length).toBeGreaterThan(0);
    expect(result.current.artifacts.length).toBeGreaterThan(0);
    expect(result.current.bridgeVersion).toBe(7);
  });

  it('refreshes recommendations through the bridge and reloads planning tasks', async () => {
    const actionCalls: string[] = [];
    const onRefresh = vi.fn(async () => undefined);
    const bridge: EforgeBridge = {
      version: 7,
      async invokeAction<TOutput>(actionId: string): Promise<TOutput> {
        actionCalls.push(actionId);
        if (actionId === 'list-planning-agent-tasks') return { tasks: [] } as TOutput;
        if (actionId === 'refresh-recommendations') return refreshMockRecommendations() as TOutput;
        throw new Error(`unexpected action ${actionId}`);
      },
    };
    setBridge(bridge);

    const [{ usePlanningTaskWorkflows }, { ToastProvider }] = await Promise.all([
      import('@/views/backlog/use-planning-task-workflows'),
      import('@/components/toast'),
    ]);
    const wrapper = ({ children }: { children: React.ReactNode }) => <ToastProvider>{children}</ToastProvider>;
    const { result } = renderHook(() => usePlanningTaskWorkflows(onRefresh), { wrapper });

    await waitFor(() => expect(actionCalls.filter((entry) => entry === 'list-planning-agent-tasks')).toHaveLength(1));
    await act(async () => { await result.current.refreshRecommendations(); });

    expect(actionCalls.filter((entry) => entry === 'refresh-recommendations')).toHaveLength(1);
    expect(actionCalls.filter((entry) => entry === 'list-planning-agent-tasks')).toHaveLength(2);
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });
});
