import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import * as React from 'react';
import { QueueIntakeLane } from '../queue-intake-lane';
import type { NowEnqueueCard } from '@/lib/selectors/now';

function makeCard(overrides: Partial<NowEnqueueCard> = {}): NowEnqueueCard {
  return {
    sessionId: 'sess-1234abcd',
    runId: 'run-1',
    title: 'Complete Acceptance Criteria Lifecycle Hardening',
    durationMs: 59_000,
    streamStatus: 'connected',
    step: 'Formatting PRD',
    latestError: null,
    tokens: 1_200_000,
    cost: 0.84,
    ...overrides,
  };
}

describe('QueueIntakeLane', () => {
  it('renders nothing when there are no intake runs', () => {
    const { container } = render(<QueueIntakeLane cards={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the Intake heading, preparing label, PRD title, current step, and a cancel control', () => {
    render(<QueueIntakeLane cards={[makeCard()]} />);
    expect(screen.getByText('Intake')).toBeDefined();
    expect(screen.getByText('Preparing PRD')).toBeDefined();
    expect(screen.getByText('Complete Acceptance Criteria Lifecycle Hardening')).toBeDefined();
    expect(screen.getByText('Formatting PRD')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDefined();
  });

  it('shows the spend line with elapsed time, tokens, and cost', () => {
    const { container } = render(<QueueIntakeLane cards={[makeCard()]} />);
    expect(container.textContent).toContain('59s');
    expect(container.textContent).toContain('1.2M tok');
    expect(container.textContent).toContain('$0.84');
  });

  it('renders an enqueue error instead of the step', () => {
    render(
      <QueueIntakeLane
        cards={[makeCard({ latestError: 'Formatter produced no output', step: 'Formatting PRD' })]}
      />,
    );
    expect(screen.getByText('Formatter produced no output')).toBeDefined();
    expect(screen.queryByText('Formatting PRD')).toBeNull();
  });

  it('falls back to a Preparing… label when no step is known yet', () => {
    render(<QueueIntakeLane cards={[makeCard({ step: null })]} />);
    expect(screen.getByText('Preparing…')).toBeDefined();
  });

  it('renders one row per intake run', () => {
    render(
      <QueueIntakeLane
        cards={[
          makeCard({ sessionId: 'sess-a', title: 'First PRD' }),
          makeCard({ sessionId: 'sess-b', title: 'Second PRD' }),
        ]}
      />,
    );
    expect(screen.getByText('First PRD')).toBeDefined();
    expect(screen.getByText('Second PRD')).toBeDefined();
    expect(screen.getAllByText('Preparing PRD')).toHaveLength(2);
  });
});
