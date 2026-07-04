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

  it('treats a phase lane with a running agent and no stage as active', () => {
    const lane = makeLane({
      planId: 'validation',
      planName: 'Validation',
      stage: undefined,
      buildStages: [],
      agents: [{ agent: 'prd-validator', tokens: 250_000, running: true }],
    });
    render(<MiniPlanSwimlane lanes={[lane]} planning={emptyPlanning} hasPlanningRow={false} />);
    expect(screen.getByText('Validation')).toBeDefined();
    expect(screen.queryByText('waiting')).toBeNull();
    expect(screen.getByText('prd-validator')).toBeDefined();
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

  it('shows a done marker for a phase lane with derived completion and no stage', () => {
    // Phase lanes (e.g. validation) never receive plan:status:change; the
    // selector derives isComplete once all their threads end. The lane must
    // render as done, not "waiting".
    const lane = makeLane({
      planId: 'validation',
      planName: 'Validation',
      stage: undefined,
      buildStages: [],
      isComplete: true,
      agents: [{ agent: 'validation-fixer', tokens: 250_000, running: false }],
    });
    render(<MiniPlanSwimlane lanes={[lane]} planning={emptyPlanning} hasPlanningRow={false} />);
    expect(screen.getByText('✓ done')).toBeDefined();
    expect(screen.queryByText('waiting')).toBeNull();
  });

  it('renders pre-planning phase agents inside the PRD planning row', () => {
    // Satisfaction gate and repo exploration fold into the planning lane; they
    // never appear as separate lanes.
    const planning: PlanningLane = {
      running: true,
      agents: [
        { agent: 'satisfaction-gate', tokens: 899_000, running: false },
        { agent: 'repo-exploration', tokens: 404_200, running: false },
        { agent: 'planner', tokens: 1_200_000, running: true },
      ],
    };
    render(<MiniPlanSwimlane lanes={[]} planning={planning} hasPlanningRow={true} />);
    expect(screen.getByText('satisfaction-gate')).toBeDefined();
    expect(screen.getByText('repo-exploration')).toBeDefined();
    expect(screen.getByText('planner')).toBeDefined();
    // The guarantee that pre-planning phases never render as separate lanes
    // lives in the selector test "never emits separate lanes for pre-planning
    // phases" (run-state/__tests__/selectors.test.ts).
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
