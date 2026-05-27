import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import * as React from 'react';
import { BuildPipelineStrip } from '../build-pipeline-strip';
import type { MiniGanttRow } from '@/lib/run-state';

function makeRow(planId: string, overrides: Partial<MiniGanttRow> = {}): MiniGanttRow {
  return {
    planId,
    planName: `Plan ${planId}`,
    stage: undefined,
    dependsOn: [],
    isComplete: false,
    isFailed: false,
    activeWorkerCount: 0,
    activeAgents: [],
    ...overrides,
  };
}

describe('BuildPipelineStrip', () => {
  it('renders nothing when rows is empty and hasPlanningRow is false', () => {
    const { container } = render(
      <BuildPipelineStrip rows={[]} hasPlanningRow={false} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders the strip container when rows are provided', () => {
    const rows = [makeRow('plan-a'), makeRow('plan-b')];
    render(<BuildPipelineStrip rows={rows} hasPlanningRow={false} />);
    const strip = screen.getByTestId('build-pipeline-strip');
    expect(strip).toBeDefined();
  });

  it('renders one row element per plan', () => {
    const rows = [makeRow('plan-a'), makeRow('plan-b'), makeRow('plan-c')];
    render(<BuildPipelineStrip rows={rows} hasPlanningRow={false} />);
    // Each plan's name should appear in the strip
    expect(screen.getByText('Plan plan-a')).toBeDefined();
    expect(screen.getByText('Plan plan-b')).toBeDefined();
    expect(screen.getByText('Plan plan-c')).toBeDefined();
  });

  it('renders the PRD planning row when hasPlanningRow is true', () => {
    render(<BuildPipelineStrip rows={[]} hasPlanningRow={true} />);
    expect(screen.getByText('PRD planning')).toBeDefined();
  });

  it('renders PRD row plus plan rows when both present', () => {
    const rows = [makeRow('plan-x')];
    render(<BuildPipelineStrip rows={rows} hasPlanningRow={true} />);
    expect(screen.getByText('PRD planning')).toBeDefined();
    expect(screen.getByText('Plan plan-x')).toBeDefined();
  });

  it('renders strip when rows is empty but hasPlanningRow is true', () => {
    render(<BuildPipelineStrip rows={[]} hasPlanningRow={true} />);
    const strip = screen.getByTestId('build-pipeline-strip');
    expect(strip).toBeDefined();
  });

  it('renders "done" label for completed plans', () => {
    const rows = [makeRow('plan-done', { isComplete: true, stage: 'complete' })];
    render(<BuildPipelineStrip rows={rows} hasPlanningRow={false} />);
    expect(screen.getByText('done')).toBeDefined();
  });

  it('renders "failed" label for failed plans', () => {
    const rows = [makeRow('plan-failed', { isFailed: true, stage: 'failed' })];
    render(<BuildPipelineStrip rows={rows} hasPlanningRow={false} />);
    expect(screen.getByText('failed')).toBeDefined();
  });

  it('renders data-plan-id attribute for each plan row', () => {
    const rows = [makeRow('plan-alpha'), makeRow('plan-beta')];
    const { container } = render(<BuildPipelineStrip rows={rows} hasPlanningRow={false} />);
    const planAlpha = container.querySelector('[data-plan-id="plan-alpha"]');
    const planBeta = container.querySelector('[data-plan-id="plan-beta"]');
    expect(planAlpha).toBeDefined();
    expect(planBeta).toBeDefined();
  });
});
