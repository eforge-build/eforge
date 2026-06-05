import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import * as React from 'react';
import { PipelineChips } from '../pipeline-chips';

describe('PipelineChips', () => {
  it('renders the Intake, Queued, and Active stages with their counts', () => {
    render(<PipelineChips intake={1} queued={2} active={3} />);
    const intake = screen.getByLabelText('intake count');
    const queued = screen.getByLabelText('queue count');
    const active = screen.getByLabelText('active builds count');
    expect(intake.textContent).toBe('Intake 1');
    expect(queued.textContent).toBe('Queued 2');
    expect(active.textContent).toBe('Active 3');
  });

  it('dims a stage whose count is zero', () => {
    render(<PipelineChips intake={0} queued={5} active={0} />);
    expect(screen.getByLabelText('intake count').className).toContain('text-muted-foreground/50');
    expect(screen.getByLabelText('active builds count').className).toContain('text-muted-foreground/50');
    // A non-zero stage is not dimmed.
    expect(screen.getByLabelText('queue count').className).not.toContain('text-muted-foreground/50');
  });
});
