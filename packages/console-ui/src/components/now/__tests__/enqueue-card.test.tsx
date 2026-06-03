import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import * as React from 'react';
import { EnqueueCard } from '../enqueue-card';
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

describe('EnqueueCard', () => {
  it('renders the preparing header, PRD title, current step, and a cancel control', () => {
    render(<EnqueueCard card={makeCard()} />);
    expect(screen.getByText('Preparing PRD for queue')).toBeDefined();
    expect(screen.getByText('Complete Acceptance Criteria Lifecycle Hardening')).toBeDefined();
    expect(screen.getByText('Formatting PRD')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDefined();
  });

  it('shows the spend line with elapsed time, tokens, and cost', () => {
    const { container } = render(<EnqueueCard card={makeCard()} />);
    expect(container.textContent).toContain('59s');
    expect(container.textContent).toContain('1.2M tok');
    expect(container.textContent).toContain('$0.84');
  });

  it('renders an enqueue error instead of the step', () => {
    render(<EnqueueCard card={makeCard({ latestError: 'Formatter produced no output', step: 'Formatting PRD' })} />);
    expect(screen.getByText('Formatter produced no output')).toBeDefined();
    expect(screen.queryByText('Formatting PRD')).toBeNull();
  });

  it('falls back to a Preparing… label when no step is known yet', () => {
    render(<EnqueueCard card={makeCard({ step: null })} />);
    expect(screen.getByText('Preparing…')).toBeDefined();
  });
});
