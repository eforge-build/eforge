import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getMockArtifacts, getMockCompactBoard, mockGetRecommendationsStaleResponse } from '@/fixtures/mock-data';
import { getMockRoadmapState } from '@/fixtures/mock-roadmap';
import type { EforgeBridge } from '@/types';

function setBridge(bridge: EforgeBridge) {
  (window as Window & { eforge?: EforgeBridge }).eforge = bridge;
}

describe('App workstation surface', () => {
  beforeEach(() => { vi.resetModules(); });

  it('renders the focus switcher (Roadmap/Board/Plans/Plan with AI) and activity rail, loading startup data through the bridge', async () => {
    const calls: Array<{ actionId: string; input: unknown }> = [];
    setBridge({
      version: 9,
      async invokeAction<TOutput>(actionId: string, input?: unknown): Promise<TOutput> {
        calls.push({ actionId, input: input ?? {} });
        if (actionId === 'list-board-compact') return getMockCompactBoard({ limit: 50 }) as TOutput;
        if (actionId === 'list-planning-artifacts') return { artifacts: getMockArtifacts() } as TOutput;
        if (actionId === 'get-recommendations') return mockGetRecommendationsStaleResponse as TOutput;
        if (actionId === 'get-roadmap-state') return getMockRoadmapState() as TOutput;
        if (actionId === 'list-planning-agent-tasks') return { tasks: [] } as TOutput;
        throw new Error(`unexpected action ${actionId}`);
      },
    });
    const { App } = await import('./App');

    render(<App />);

    // Roadmap / Board / Plans / Plan with AI are focuses on one surface, switched
    // in the header. The board focus loads by default with its activity rail.
    await waitFor(() => expect(screen.getByText('Board')).toBeTruthy());
    expect(screen.getByText('Roadmap')).toBeTruthy();
    expect(screen.getByText('Plan with AI')).toBeTruthy();
    expect(screen.getByText('Planning activity')).toBeTruthy();
    expect(calls.map((call) => call.actionId)).toEqual(expect.arrayContaining(['get-roadmap-state', 'get-recommendations', 'list-board-compact', 'list-planning-artifacts', 'list-planning-agent-tasks']));
    expect(calls).toContainEqual({ actionId: 'list-planning-artifacts', input: { includeBoard: false } });
  });
});
