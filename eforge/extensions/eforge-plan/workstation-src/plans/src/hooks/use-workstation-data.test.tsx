import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getMockArtifacts, getMockCompactBoard, mockGetRecommendationsStaleResponse } from '@/fixtures/mock-data';
import type { CompactBoardResponse, EforgeBridge } from '@/types';

function setBridge(bridge: EforgeBridge) {
  (window as Window & { eforge?: EforgeBridge }).eforge = bridge;
}

describe('useWorkstationData recommendations mapping', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('loads compact board data and maps live get-recommendations status and active refresh task data', async () => {
    const invokeActionSpy = vi.fn();
    const bridge: EforgeBridge = {
      version: 7,
      async invokeAction<TOutput>(actionId: string, input?: unknown): Promise<TOutput> {
        invokeActionSpy(actionId, input ?? {});
        if (actionId === 'list-board') throw new Error('list-board must not be used');
        if (actionId === 'list-board-compact') return getMockCompactBoard({ limit: 50 }) as TOutput;
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
    const compactBoardCalls = invokeActionSpy.mock.calls.filter(([actionId]) => actionId === 'list-board-compact');
    const fullBoardCalls = invokeActionSpy.mock.calls.filter(([actionId]) => actionId === 'list-board');
    expect(compactBoardCalls).toEqual([['list-board-compact', { limit: 50, includeArchive: true }]]);
    expect(fullBoardCalls).toEqual([]);

    expect(result.current.recommendations?.recommendedNextSequence[0]?.itemId).toBe('recommend-next-work');
    expect(result.current.recommendationStatus?.staleReasons.map((reason) => reason.code)).toContain('source-fingerprint-drift');
    expect(result.current.activeRecommendationRefreshTask?.taskId).toBe('task-refresh-recommendations');
    expect(result.current.board.items.length).toBeGreaterThan(0);
    expect(result.current.board.counts?.closed).toBeGreaterThan(0);
    expect(result.current.artifacts.length).toBeGreaterThan(0);
    expect(result.current.bridgeVersion).toBe(7);
  });

  it('loads additional open board pages through compact pagination', async () => {
    const calls: Array<{ actionId: string; input: unknown }> = [];
    const firstPage = getMockCompactBoard({ limit: 50 });
    const bridge: EforgeBridge = {
      async invokeAction<TOutput>(actionId: string, input?: unknown): Promise<TOutput> {
        calls.push({ actionId, input: input ?? {} });
        if (actionId === 'list-board') throw new Error('list-board must not be used');
        if (actionId === 'list-board-compact') {
          const request = (input ?? {}) as Record<string, unknown>;
          if (request.offset === undefined) return { ...firstPage, pagination: { limit: 50, offset: 0, returned: firstPage.items.length, hasMore: true, nextOffset: 1 } } as TOutput;
          return getMockCompactBoard(request as Parameters<typeof getMockCompactBoard>[0]) as TOutput;
        }
        if (actionId === 'list-planning-artifacts') return { artifacts: getMockArtifacts() } as TOutput;
        if (actionId === 'get-recommendations') return mockGetRecommendationsStaleResponse as TOutput;
        throw new Error(`unexpected action ${actionId}`);
      },
    };
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
    const bridge: EforgeBridge = {
      async invokeAction<TOutput>(actionId: string, input?: unknown): Promise<TOutput> {
        calls.push({ actionId, input: input ?? {} });
        if (actionId === 'list-board') throw new Error('list-board must not be used');
        if (actionId === 'list-board-compact') {
          const request = (input ?? {}) as Record<string, unknown>;
          if (request.lane === 'done') return donePages.shift() as TOutput;
          return getMockCompactBoard(request as Parameters<typeof getMockCompactBoard>[0]) as TOutput;
        }
        if (actionId === 'list-planning-artifacts') return { artifacts: getMockArtifacts() } as TOutput;
        if (actionId === 'get-recommendations') return mockGetRecommendationsStaleResponse as TOutput;
        throw new Error(`unexpected action ${actionId}`);
      },
    };
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
    expect(calls).not.toContainEqual({ actionId: 'list-board', input: expect.anything() });
  });

});

function withDonePagination(response: CompactBoardResponse, hasMore: boolean): CompactBoardResponse {
  const nextOffset = response.offset + response.items.length;
  const pagination = { limit: response.limit, offset: response.offset, returned: response.items.length, hasMore, ...(hasMore ? { nextOffset } : {}) };
  return {
    ...response,
    total: 2,
    pagination,
    lanes: response.lanes.map((lane) => lane.lane === 'done' ? { ...lane, count: 2, closedCount: 2, pagination } : lane),
  };
}
