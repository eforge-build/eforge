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

  it('renders a finished PRD lane covering the planning agents', () => {
    const planning: PlanningLane = {
      running: false,
      agents: [
        { agent: 'planner', tokens: 4_900_000, running: false },
        { agent: 'plan-reviewer', tokens: 184_500, running: false },
      ],
    };
    const { container } = render(
      <MiniPlanSwimlane lanes={[]} planning={planning} hasPlanningRow={true} />,
    );
    expect(screen.getByText('PRD')).toBeDefined();
    expect(screen.getByText('✓ done')).toBeDefined();
    // each planning agent gets its own line with a token total
    expect(screen.getByText('planner')).toBeDefined();
    expect(screen.getByText('plan-reviewer')).toBeDefined();
    expect(container.textContent).toContain('4.9M');
    expect(container.textContent).toContain('184.5K');
  });

  it('shows the PRD lane as running while planning agents are active', () => {
    const planning: PlanningLane = {
      running: true,
      agents: [{ agent: 'planner', tokens: 1_200_000, running: true }],
    };
    render(<MiniPlanSwimlane lanes={[]} planning={planning} hasPlanningRow={true} />);
    expect(screen.getByText('PRD')).toBeDefined();
    expect(screen.queryByText('✓ done')).toBeNull(); // no done marker while running
    expect(screen.getByText('planner')).toBeDefined();
  });

  it('limits lanes to maxRows and expands on disclosure click', () => {
    const lanes = [
      makeLane({ planId: 'plan-01', planName: 'One' }),
      makeLane({ planId: 'plan-02', planName: 'Two' }),
      makeLane({ planId: 'plan-03', planName: 'Three' }),
    ];
    render(<MiniPlanSwimlane lanes={lanes} planning={emptyPlanning} hasPlanningRow={false} maxRows={2} />);
    expect(screen.getByText('Plan 01 · One')).toBeDefined();
    expect(screen.getByText('Plan 02 · Two')).toBeDefined();
    expect(screen.queryByText('Plan 03 · Three')).toBeNull();

    fireEvent.click(screen.getByText('+ 1 more plan — show all'));
    expect(screen.getByText('Plan 03 · Three')).toBeDefined();
  });
});
