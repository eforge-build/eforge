import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getMockArtifacts, getMockCompactBoard, mockGetRecommendationsFreshResponse, mockGetRecommendationsStaleResponse } from '@/fixtures/mock-data';
import { getMockRoadmapState } from '@/fixtures/mock-roadmap';
import type { CompactBoardResponse, EforgeBridge, GetRecommendationsResponse, RefreshRecommendationsResponse, RoadmapStateResponse } from '@/types';

function setBridge(bridge: EforgeBridge) {
  (window as Window & { eforge?: EforgeBridge }).eforge = bridge;
}

describe('useWorkstationData recommendations mapping', () => {
  beforeEach(() => { vi.resetModules(); });

  it('loads compact board, recommendations, artifacts, and roadmap state', async () => {
    const invokeActionSpy = vi.fn();
    const bridge: EforgeBridge = {
      version: 7,
      async invokeAction<TOutput>(actionId: string, input?: unknown): Promise<TOutput> {
        invokeActionSpy(actionId, input ?? {});
        if (actionId === 'list-board') throw new Error('list-board must not be used');
        if (actionId === 'list-board-compact') return getMockCompactBoard({ limit: 50 }) as TOutput;
        if (actionId === 'list-planning-artifacts') return { artifacts: getMockArtifacts() } as TOutput;
        if (actionId === 'get-recommendations') return mockGetRecommendationsStaleResponse as TOutput;
        if (actionId === 'get-roadmap-state') return getMockRoadmapState() as TOutput;
        throw new Error(`unexpected action ${actionId}`);
      },
    };
    setBridge(bridge);

    const { useWorkstationData } = await import('./use-workstation-data');
    const { result } = renderHook(() => useWorkstationData());

    await waitFor(() => expect(invokeActionSpy).toHaveBeenCalledWith('get-recommendations', {}));
    await waitFor(() => expect(invokeActionSpy).toHaveBeenCalledWith('get-roadmap-state', { includeLocalFocusContent: true }));
    await waitFor(() => expect(result.current.recommendationStatus?.state).toBe('stale'));
    await waitFor(() => expect(result.current.recommendationFreshness?.state).toBe('stale'));
    const compactBoardCalls = invokeActionSpy.mock.calls.filter(([actionId]) => actionId === 'list-board-compact');
    const artifactsCalls = invokeActionSpy.mock.calls.filter(([actionId]) => actionId === 'list-planning-artifacts');
    const fullBoardCalls = invokeActionSpy.mock.calls.filter(([actionId]) => actionId === 'list-board');
    expect(compactBoardCalls).toEqual([['list-board-compact', { limit: 50, includeArchive: true }]]);
    expect(artifactsCalls).toEqual([['list-planning-artifacts', { includeBoard: false }]]);
    expect(fullBoardCalls).toEqual([]);

    expect(result.current.recommendations?.recommendedNextSequence[0]?.itemId).toBe('recommend-next-work');
    expect(result.current.recommendationActionability?.safeParallelizableGroups[0]?.actionableItemIds).toEqual(['recommend-next-work']);
    expect(result.current.recommendationActionability?.safeParallelizableGroups[0]?.suppressedItemIds).toEqual(['add-import-preview']);
    expect(result.current.recommendationStatus?.staleReasons.map((reason) => reason.code)).toContain('source-fingerprint-drift');
    expect(result.current.recommendationFreshness?.storedSourceFingerprint).toBe('old-source-fingerprint');
    expect(result.current.recommendationFreshness?.comparedSourceFingerprint).toBe('current-source-fingerprint');
    expect(result.current.activeRecommendationRefreshTask?.taskId).toBe('task-refresh-recommendations');
    expect(result.current.board.items.length).toBeGreaterThan(0);
    expect(result.current.board.counts?.closed).toBeGreaterThan(0);
    expect(result.current.artifacts.length).toBeGreaterThan(0);
    expect(result.current.roadmapState?.context.localSteering.content).toContain('Prioritize workstation');
    expect(result.current.bridgeVersion).toBe(7);
  });

  it('loads additional open board pages through compact pagination', async () => {
    const calls: Array<{ actionId: string; input: unknown }> = [];
    const firstPage = getMockCompactBoard({ limit: 50 });
    const bridge = bridgeWithDefaults(async (actionId, input) => {
      calls.push({ actionId, input: input ?? {} });
      if (actionId === 'list-board') throw new Error('list-board must not be used');
      if (actionId === 'list-board-compact') {
        const request = (input ?? {}) as Record<string, unknown>;
        if (request.offset === undefined) return { ...firstPage, pagination: { limit: 50, offset: 0, returned: firstPage.items.length, hasMore: true, nextOffset: 1 } };
        return getMockCompactBoard(request as Parameters<typeof getMockCompactBoard>[0]);
      }
      return undefined;
    });
    setBridge(bridge);

    const { useWorkstationData } = await import('./use-workstation-data');
    const { result } = renderHook(() => useWorkstationData());

    await waitFor(() => expect(result.current.board.items.length).toBeGreaterThan(0));
    await act(async () => { await result.current.loadMoreBoard(); });

    expect(calls).not.toContainEqual({ actionId: 'list-board', input: expect.anything() });
    expect(calls).toContainEqual({ actionId: 'list-board-compact', input: { limit: 50, includeArchive: true } });
    expect(calls).toContainEqual({ actionId: 'list-board-compact', input: { limit: 50, includeArchive: true, offset: 1 } });
  });

  it('loads closed lanes through explicit compact lane pages and merges them once', async () => {
    const calls: Array<{ actionId: string; input: unknown }> = [];
    const doneFirst = withDonePagination(getMockCompactBoard({ lane: 'done', includeClosed: true, limit: 50, offset: 0 }), true);
    const doneSecondItem = { ...doneFirst.items[0]!, id: 'legacy-cleanup-two', title: 'Remove second legacy renderer' };
    const doneSecond = withDonePagination({ ...doneFirst, items: [doneSecondItem], offset: 1, total: 2 }, false);
    const donePages = [doneFirst, doneSecond];
    const bridge = bridgeWithDefaults(async (actionId, input) => {
      calls.push({ actionId, input: input ?? {} });
      if (actionId === 'list-board') throw new Error('list-board must not be used');
      if (actionId === 'list-board-compact') {
        const request = (input ?? {}) as Record<string, unknown>;
        if (request.lane === 'done') return donePages.shift();
        return getMockCompactBoard(request as Parameters<typeof getMockCompactBoard>[0]);
      }
      return undefined;
    });
    setBridge(bridge);

    const { useWorkstationData } = await import('./use-workstation-data');
    const { result } = renderHook(() => useWorkstationData());

    await waitFor(() => expect(result.current.board.items.length).toBeGreaterThan(0));
    expect(result.current.board.items.some((item) => item.id === 'legacy-cleanup')).toBe(false);
    await act(async () => { await result.current.loadClosedLane('done'); });
    await act(async () => { await result.current.loadClosedLane('done'); });

    expect(calls).toContainEqual({ actionId: 'list-board-compact', input: { lane: 'done', includeClosed: true, includeArchive: true, limit: 50, offset: 0 } });
    expect(calls).toContainEqual({ actionId: 'list-board-compact', input: { lane: 'done', includeClosed: true, includeArchive: true, limit: 50, offset: 1 } });
    expect(result.current.board.items.filter((item) => item.id === 'legacy-cleanup')).toHaveLength(1);
    expect(result.current.board.items.filter((item) => item.id === 'legacy-cleanup-two')).toHaveLength(1);
  });

  it('keeps the open-board load-more cursor after loading a closed lane page', async () => {
    const calls: Array<{ actionId: string; input: unknown }> = [];
    const initialPage = getMockCompactBoard({ limit: 50 });
    const donePage = withDonePagination(getMockCompactBoard({ lane: 'done', includeClosed: true, limit: 50, offset: 0 }), true);
    const bridge = bridgeWithDefaults(async (actionId, input) => {
      calls.push({ actionId, input: input ?? {} });
      if (actionId === 'list-board') throw new Error('list-board must not be used');
      if (actionId === 'list-board-compact') {
        const request = (input ?? {}) as Record<string, unknown>;
        if (request.lane === 'done') return donePage;
        if (request.offset === undefined) return {
          ...initialPage,
          pagination: { limit: 50, offset: 0, returned: initialPage.items.length, hasMore: true, nextOffset: 37 },
        };
        return getMockCompactBoard(request as Parameters<typeof getMockCompactBoard>[0]);
      }
      return undefined;
    });
    setBridge(bridge);

    const { useWorkstationData } = await import('./use-workstation-data');
    const { result } = renderHook(() => useWorkstationData());

    await waitFor(() => expect(result.current.board.pagination?.nextOffset).toBe(37));
    await act(async () => { await result.current.loadClosedLane('done'); });
    await act(async () => { await result.current.loadMoreBoard(); });

    expect(calls.filter((call) => call.actionId === 'list-board')).toEqual([]);
    expect(calls).toContainEqual({ actionId: 'list-board-compact', input: { lane: 'done', includeClosed: true, includeArchive: true, limit: 50, offset: 0 } });
    expect(calls).toContainEqual({ actionId: 'list-board-compact', input: { limit: 50, includeArchive: true, offset: 37 } });
    expect(calls).not.toContainEqual({ actionId: 'list-board-compact', input: expect.objectContaining({ lane: 'done', offset: 37 }) });
  });

  it('clears stale recommendation state when get-recommendations fails after a successful load', async () => {
    let getRecommendationsCalls = 0;
    const bridge = bridgeWithDefaults(async (actionId) => {
      if (actionId === 'get-recommendations') {
        getRecommendationsCalls += 1;
        if (getRecommendationsCalls === 1) return mockGetRecommendationsStaleResponse;
        throw new Error('recommendations unavailable');
      }
      if (actionId === 'list-draft-units') return { units: [] };
      return undefined;
    });
    setBridge(bridge);

    const { useWorkstationData } = await import('./use-workstation-data');
    const { result } = renderHook(() => useWorkstationData());

    await waitFor(() => expect(result.current.recommendations?.recommendedNextSequence[0]?.itemId).toBe('recommend-next-work'));
    expect(result.current.recommendationActionability).not.toBeNull();
    expect(result.current.recommendationStatus?.state).toBe('stale');
    expect(result.current.activeRecommendationRefreshTask?.taskId).toBe('task-refresh-recommendations');

    await act(async () => { await result.current.refresh(); });

    await waitFor(() => expect(result.current.error).toContain('recommendations: recommendations unavailable'));
    expect(result.current.recommendations).toBeNull();
    expect(result.current.recommendationActionability).toBeNull();
    expect(result.current.recommendationStatus).toBeNull();
    expect(result.current.recommendationFreshness).toBeNull();
    expect(result.current.activeRecommendationRefreshTask).toBeNull();
    expect(result.current.board.items.length).toBeGreaterThan(0);
    expect(result.current.artifacts.length).toBeGreaterThan(0);
  });

  it('keeps legacy recommendations when a fulfilled response omits actionability', async () => {
    const withoutActionability: GetRecommendationsResponse = { ...mockGetRecommendationsFreshResponse };
    delete withoutActionability.recommendationActionability;
    setBridge(bridgeWithDefaults(async (actionId) => {
      if (actionId === 'get-recommendations') return withoutActionability;
      if (actionId === 'list-draft-units') return { units: [] };
      return undefined;
    }));

    const { useWorkstationData } = await import('./use-workstation-data');
    const { result } = renderHook(() => useWorkstationData());

    await waitFor(() => expect(result.current.recommendationStatus?.state).toBe('fresh'));
    expect(result.current.recommendations?.recommendedNextSequence.length).toBeGreaterThan(0);
    expect(result.current.recommendationActionability).toBeNull();
    expect(result.current.recommendationFreshness?.state).toBe('fresh');
  });

  it('keeps board and artifacts populated when roadmap loading fails', async () => {
    setBridge(bridgeWithDefaults(async (actionId) => actionId === 'get-roadmap-state' ? Promise.reject(new Error('roadmap unavailable')) : undefined));

    const { useWorkstationData } = await import('./use-workstation-data');
    const { result } = renderHook(() => useWorkstationData());

    await waitFor(() => expect(result.current.error).toContain('roadmap: roadmap unavailable'));
    expect(result.current.board.items.length).toBeGreaterThan(0);
    expect(result.current.artifacts.length).toBeGreaterThan(0);
  });

  it('saves roadmap state and reloads recommendation status', async () => {
    const calls: Array<{ actionId: string; input: unknown }> = [];
    const state = getMockRoadmapState();
    const updated: RoadmapStateResponse = { ...state, context: { ...state.context, localSteering: { ...state.context.localSteering, content: 'updated' } } };
    const bridge = bridgeWithDefaults(async (actionId, input) => {
      calls.push({ actionId, input: input ?? {} });
      if (actionId === 'get-roadmap-state') return state;
      if (actionId === 'update-roadmap-state') return updated;
      return undefined;
    });
    setBridge(bridge);

    const { useWorkstationData } = await import('./use-workstation-data');
    const { result } = renderHook(() => useWorkstationData());
    await waitFor(() => expect(result.current.roadmapState).not.toBeNull());

    await act(async () => { await result.current.saveRoadmapState({ localFocusContent: 'updated', expectedLocalFocusSha256: state.context.localSteering.sha256 }); });

    expect(calls).toContainEqual({ actionId: 'update-roadmap-state', input: { localFocusContent: 'updated', expectedLocalFocusSha256: state.context.localSteering.sha256 } });
    expect(calls.filter((call) => call.actionId === 'get-recommendations').length).toBeGreaterThanOrEqual(2);
    expect(result.current.roadmapState?.context.localSteering.content).toContain('Prioritize workstation');
  });

  it('starts recommendation refresh, seeds the active task, and reloads recommendation freshness', async () => {
    const calls: Array<{ actionId: string; input: unknown }> = [];
    const response: RefreshRecommendationsResponse = { task: { taskId: 'task-refresh-from-test', kind: 'eforge-plan.planning-draft', status: 'running', createdAt: '', updatedAt: '' }, entry: { taskId: 'task-refresh-from-test', originalRequest: '', derivedRequest: '', selection: {}, requestedOutputSections: ['recommendations'], createdAt: '' }, sourceFingerprint: 'fingerprint' };
    let getRecommendationsCalls = 0;
    const bridge = bridgeWithDefaults(async (actionId, input) => {
      calls.push({ actionId, input: input ?? {} });
      if (actionId === 'get-recommendations') {
        getRecommendationsCalls += 1;
        return getRecommendationsCalls === 1 ? mockGetRecommendationsStaleResponse : { ...mockGetRecommendationsFreshResponse, activeRefreshTask: response.task };
      }
      if (actionId === 'refresh-recommendations') return response;
      return undefined;
    });
    setBridge(bridge);

    const { useWorkstationData } = await import('./use-workstation-data');
    const { result } = renderHook(() => useWorkstationData());
    await waitFor(() => expect(result.current.roadmapState).not.toBeNull());

    await act(async () => { await result.current.refreshRecommendations(); });

    expect(calls).toContainEqual({ actionId: 'refresh-recommendations', input: {} });
    expect(calls.filter((call) => call.actionId === 'get-recommendations').length).toBeGreaterThanOrEqual(2);
    expect(result.current.activeRecommendationRefreshTask?.taskId).toBe('task-refresh-from-test');
    expect(result.current.recommendationFreshness?.state).toBe('fresh');
    expect(result.current.recommendationActionability?.recommendedNextSequence[1]?.actionability.state).toBe('non-actionable');
  });
});

function bridgeWithDefaults(custom: (actionId: string, input?: unknown) => unknown | Promise<unknown>): EforgeBridge {
  return {
    async invokeAction<TOutput>(actionId: string, input?: unknown): Promise<TOutput> {
      const customResult = await custom(actionId, input);
      if (customResult !== undefined) return customResult as TOutput;
      if (actionId === 'list-board-compact') return getMockCompactBoard({ limit: 50 }) as TOutput;
      if (actionId === 'list-planning-artifacts') return { artifacts: getMockArtifacts() } as TOutput;
      if (actionId === 'get-recommendations') return mockGetRecommendationsStaleResponse as TOutput;
      if (actionId === 'get-roadmap-state') return getMockRoadmapState() as TOutput;
      throw new Error(`unexpected action ${actionId}`);
    },
  };
}

function withDonePagination(response: CompactBoardResponse, hasMore: boolean): CompactBoardResponse {
  const nextOffset = response.offset + response.items.length;
  const pagination = { limit: response.limit, offset: response.offset, returned: response.items.length, hasMore, ...(hasMore ? { nextOffset } : {}) };
  return { ...response, total: 2, pagination, lanes: (response.lanes ?? []).map((lane) => lane.lane === 'done' ? { ...lane, count: 2, closedCount: 2, pagination } : lane) };
}
