import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getMockArtifacts, getMockCompactBoard, mockGetRecommendationsStaleResponse } from '@/fixtures/mock-data';
import { getMockRoadmapState } from '@/fixtures/mock-roadmap';
import type { EforgeBridge } from '@/types';

function setBridge(bridge: EforgeBridge) {
  (window as Window & { eforge?: EforgeBridge }).eforge = bridge;
}

describe('App roadmap placement', () => {
  beforeEach(() => { vi.resetModules(); });

  it('renders the roadmap panel in the shell and loads startup data through the bridge', async () => {
    const calls: Array<{ actionId: string; input: unknown }> = [];
    setBridge({
      version: 9,
      async invokeAction<TOutput>(actionId: string, input?: unknown): Promise<TOutput> {
        calls.push({ actionId, input: input ?? {} });
        if (actionId === 'list-board-compact') return getMockCompactBoard({ limit: 50 }) as TOutput;
        if (actionId === 'list-planning-artifacts') return { artifacts: getMockArtifacts() } as TOutput;
        if (actionId === 'get-recommendations') return mockGetRecommendationsStaleResponse as TOutput;
        if (actionId === 'get-roadmap-state') return getMockRoadmapState() as TOutput;
        throw new Error(`unexpected action ${actionId}`);
      },
    });
    const { App } = await import('./App');

    render(<App />);

    await waitFor(() => expect(screen.getByText('Roadmap workstation')).toBeTruthy());
    await waitFor(() => expect(screen.getByText('Local focus roadmap')).toBeTruthy());
    expect(screen.getAllByText('Configured shared context').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Discovered context').length).toBeGreaterThan(0);
    expect(screen.getByText('Backlog')).toBeTruthy();
    expect(calls.map((call) => call.actionId)).toEqual(expect.arrayContaining(['get-roadmap-state', 'get-recommendations', 'list-board-compact', 'list-planning-artifacts']));
    expect(calls).toContainEqual({ actionId: 'list-planning-artifacts', input: { includeBoard: false } });
  });
});
