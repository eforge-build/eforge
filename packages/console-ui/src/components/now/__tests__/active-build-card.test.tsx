import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ActiveBuildCard } from '../active-build-card';
import { ActiveBuildsGrid } from '../active-builds-grid';
import type { NowActiveBuildCard } from '@/lib/selectors/now';

function card(overrides: Partial<NowActiveBuildCard> = {}): NowActiveBuildCard {
  return {
    sessionId: 'session-1234567890',
    runId: 'run-1',
    planSet: 'Live Build',
    command: 'eforge build',
    status: 'running',
    startedAt: '2024-01-01T00:00:00.000Z',
    durationMs: 125_000,
    cwd: '/repo',
    profile: 'default',
    planCount: 1,
    streamStatus: 'connected',
    currentPhase: 'build',
    latestAgent: 'builder',
    latestProgress: null,
    latestError: null,
    transientNotice: null,
    lifecycle: {
      phase: 'build',
      prdValidationComplete: false,
      gapCloseComplete: false,
      finalValidationComplete: false,
      gapCloseObserved: false,
    },
    planProgress: { total: 1, complete: 0, running: 1, pending: 0, failed: 0 },
    tokens: 12_500,
    cost: 1.25,
    cachePercent: 33,
    efficiency: null,
    href: '/runs/session-1234567890',
    miniGanttRows: [],
    planLanes: [],
    planning: { agents: [], running: false },
    hasPlanningRow: false,
    ...overrides,
  };
}

describe('ActiveBuildCard', () => {
  it('renders explicit live labels and navigates from the title', () => {
    const onNavigate = vi.fn();
    render(<ActiveBuildCard card={card()} onNavigate={onNavigate} />);

    expect(screen.getByText('2m 5s')).toBeTruthy();
    expect(screen.getByText('12.5K input tok')).toBeTruthy();
    expect(screen.getByText('$1.25')).toBeTruthy();
    expect(screen.getByText('33% cache')).toBeTruthy();
    expect(screen.getByText('builder')).toBeTruthy();
    expect(screen.queryByText(/tok\/min/)).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Live Build' }));
    expect(onNavigate).toHaveBeenCalledWith('/runs/session-1234567890');
  });
});

describe('ActiveBuildsGrid', () => {
  it('renders active efficiency summary above active build cards', () => {
    const { container } = render(<ActiveBuildsGrid cards={[card({ planSet: 'Grid Build' })]} />);

    expect(screen.getByText('Active now efficiency')).toBeTruthy();
    expect(screen.getByText('Grid Build')).toBeTruthy();
    const summary = container.textContent?.indexOf('Active now efficiency') ?? -1;
    const build = container.textContent?.indexOf('Grid Build') ?? -1;
    expect(summary).toBeGreaterThanOrEqual(0);
    expect(build).toBeGreaterThanOrEqual(0);
    expect(summary).toBeLessThan(build);
  });
});
