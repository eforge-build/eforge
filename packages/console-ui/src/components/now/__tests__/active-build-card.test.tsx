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
    phaseProgress: {
      prd: 'passed',
      plans: 'running',
      prdValidation: 'pending',
      gapClose: 'pending',
      finalValidation: 'pending',
      landing: 'pending',
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
  it('renders shared phase-progress status in the rail', () => {
    const { container } = render(<ActiveBuildCard card={card({
      phaseProgress: {
        prd: 'running',
        plans: 'pending',
        prdValidation: 'pending',
        gapClose: 'pending',
        finalValidation: 'pending',
        landing: 'pending',
      },
      hasPlanningRow: true,
    })} />);

    expect(container.querySelector('[title="PRD: active"]')).toBeTruthy();
    expect(container.querySelector('[title="PRD: done"]')).toBeNull();
  });

  it('maps every phase-progress status onto the rail (skipped/passed → done, failed → failed, pending → pending)', () => {
    const { container } = render(<ActiveBuildCard card={card({
      phaseProgress: {
        prd: 'skipped',
        plans: 'failed',
        prdValidation: 'passed',
        gapClose: 'pending',
        finalValidation: 'pending',
        landing: 'pending',
      },
    })} />);

    // 'skipped' and 'passed' both collapse to the rail's 'done'.
    expect(container.querySelector('[title="PRD: done"]')).toBeTruthy();
    expect(container.querySelector('[title="PRD check: done"]')).toBeTruthy();
    expect(container.querySelector('[title="Plans: failed"]')).toBeTruthy();
    expect(container.querySelector('[title="Gap close: pending"]')).toBeTruthy();
    expect(container.querySelector('[title="Final check: pending"]')).toBeTruthy();
    expect(container.querySelector('[title="Land: pending"]')).toBeTruthy();
    // Nothing reads as active when no phase is running.
    expect(container.querySelector('[title$=": active"]')).toBeNull();
  });

  it('uses the blue live pulse when a lifecycle phase is running', () => {
    // Default fixture: plans is 'running', no active mini-gantt plan rows, no
    // error — the pulse must derive liveness from phaseProgress alone.
    const { container } = render(<ActiveBuildCard card={card({ miniGanttRows: [] })} />);

    const pulse = container.querySelector('.pointer-events-none.absolute.inset-0');
    expect(pulse).toBeTruthy();
    expect(pulse?.className).toContain('bg-blue/5');
    expect(pulse?.className).not.toContain('bg-muted/10');
  });

  it('uses the muted pulse when no lifecycle phase is running', () => {
    const { container } = render(<ActiveBuildCard card={card({
      phaseProgress: {
        prd: 'passed',
        plans: 'passed',
        prdValidation: 'passed',
        gapClose: 'pending',
        finalValidation: 'pending',
        landing: 'pending',
      },
      latestError: null,
      miniGanttRows: [],
    })} />);

    const pulse = container.querySelector('.pointer-events-none.absolute.inset-0');
    expect(pulse).toBeTruthy();
    expect(pulse?.className).toContain('bg-muted/10');
    expect(pulse?.className).not.toContain('bg-blue/5');
  });

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
