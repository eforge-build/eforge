import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ActiveEfficiencySummary } from '../active-efficiency-summary';
import type { NowActiveBuildCard } from '@/lib/selectors/now';

function card(overrides: Partial<NowActiveBuildCard> = {}): NowActiveBuildCard {
  return {
    sessionId: 's1', runId: 'r1', planSet: 'Plan', command: 'build', status: 'running', startedAt: '2024-01-01T00:00:00.000Z', durationMs: 60_000, cwd: '/x', profile: null, planCount: null, streamStatus: 'connected', currentPhase: null, latestAgent: null, latestProgress: null, latestError: null, transientNotice: null,
    lifecycle: { phase: 'plans', prdValidationComplete: false, gapCloseComplete: false, finalValidationComplete: false, gapCloseObserved: false },
    planProgress: { pending: 0, running: 1, complete: 0, failed: 0, total: 1 }, tokens: 0, cost: 0, cachePercent: 0, efficiency: null, href: '#', miniGanttRows: [], planLanes: [], planning: { agents: [], running: false }, hasPlanningRow: false,
    ...overrides,
  };
}

describe('ActiveEfficiencySummary', () => {
  it('renders active summary labels and partial unavailable states', () => {
    render(<ActiveEfficiencySummary cards={[card()]} />);
    expect(screen.getByText('Active now efficiency')).toBeTruthy();
    expect(screen.getByText('output generation rate')).toBeTruthy();
    expect(screen.getByText('token traffic')).toBeTruthy();
    expect(screen.getByText('cost burn')).toBeTruthy();
    expect(screen.getByText('output tokens / $')).toBeTruthy();
    expect(screen.getByText('cache context')).toBeTruthy();
    expect(screen.getAllByText('partial').length).toBeGreaterThan(0);
  });
});
