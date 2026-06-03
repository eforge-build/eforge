import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import * as React from 'react';
import { MiniPlanSwimlane } from '../mini-plan-swimlane';
import type { PlanLane, PlanningLane } from '@/lib/run-state';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const emptyPlanning: PlanningLane = { agents: [], running: false };

function makeLane(overrides: Partial<PlanLane> = {}): PlanLane {
  return {
    planId: 'plan-01',
    planName: 'Plan One',
    stage: 'implement',
    buildStages: ['implement', 'test-cycle', 'review-cycle'],
    isComplete: false,
    isFailed: false,
    agents: [{ agent: 'builder', tokens: 1_700_000, running: true }],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MiniPlanSwimlane', () => {
  it('renders nothing when there are no lanes and no planning row', () => {
    const { container } = render(
      <MiniPlanSwimlane lanes={[]} planning={emptyPlanning} hasPlanningRow={false} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders an active lane with its build-stage track and running agent + tokens', () => {
    const { container } = render(
      <MiniPlanSwimlane lanes={[makeLane()]} planning={emptyPlanning} hasPlanningRow={false} />,
    );
    expect(screen.getByTestId('mini-plan-swimlane')).toBeDefined();
    expect(screen.getByText('Plan 01 · Plan One')).toBeDefined();
    // build-stage chips
    expect(screen.getByText('implement')).toBeDefined();
    expect(screen.getByText('test-cycle')).toBeDefined();
    expect(screen.getByText('review-cycle')).toBeDefined();
    // running agent + compact token total
    expect(screen.getByText('builder')).toBeDefined();
    expect(container.textContent).toContain('1.7M');
  });

  it('shows a done marker for a completed lane and no running agents', () => {
    const lane = makeLane({ stage: 'complete', isComplete: true, agents: [] });
    render(<MiniPlanSwimlane lanes={[lane]} planning={emptyPlanning} hasPlanningRow={false} />);
    expect(screen.getByText('✓ done')).toBeDefined();
    expect(screen.queryByText('builder')).toBeNull();
  });

  it('shows a failed marker for a failed lane', () => {
    const lane = makeLane({ stage: 'failed', isFailed: true, agents: [] });
    const { container } = render(
      <MiniPlanSwimlane lanes={[lane]} planning={emptyPlanning} hasPlanningRow={false} />,
    );
    expect(container.textContent).toContain('failed');
  });

  it('collapses a finished PRD lane to a summary and reveals agents on expand', () => {
    const planning: PlanningLane = {
      running: false,
      agents: [
        { agent: 'planner', tokens: 4_900_000, running: false },
        { agent: 'plan-reviewer', tokens: 184_500, running: false },
      ],
    };
    render(<MiniPlanSwimlane lanes={[]} planning={planning} hasPlanningRow={true} />);
    // Collapsed by default: header + done marker, but individual agents hidden.
    expect(screen.getByText('PRD')).toBeDefined();
    expect(screen.getByText('✓ done')).toBeDefined();
    expect(screen.queryByText('planner')).toBeNull();

    // Expanding the lane reveals each planning agent and its token total.
    fireEvent.click(screen.getByText('planning'));
    expect(screen.getByText('planner')).toBeDefined();
    expect(screen.getByText('plan-reviewer')).toBeDefined();
  });

  it('shows the PRD lane expanded with agents while planning is active', () => {
    const planning: PlanningLane = {
      running: true,
      agents: [{ agent: 'planner', tokens: 1_200_000, running: true }],
    };
    render(<MiniPlanSwimlane lanes={[]} planning={planning} hasPlanningRow={true} />);
    expect(screen.getByText('PRD')).toBeDefined();
    expect(screen.queryByText('✓ done')).toBeNull(); // no done marker while running
    expect(screen.getByText('planner')).toBeDefined(); // active → expanded
  });

  it('expands active plan lanes by default and collapses completed ones', () => {
    const active = makeLane({ planId: 'plan-01', planName: 'Active' });
    const done = makeLane({
      planId: 'plan-02',
      planName: 'Done',
      stage: 'complete',
      isComplete: true,
      agents: [{ agent: 'reviewer', tokens: 2_000_000, running: false }],
    });
    render(<MiniPlanSwimlane lanes={[active, done]} planning={emptyPlanning} hasPlanningRow={false} />);
    // Active lane is expanded: its agent shows.
    expect(screen.getByText('builder')).toBeDefined();
    // Completed lane is collapsed: its agent is hidden until expanded.
    expect(screen.queryByText('reviewer')).toBeNull();

    fireEvent.click(screen.getByText('Plan 02 · Done'));
    expect(screen.getByText('reviewer')).toBeDefined();
  });
});
