import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { AutoBuildState } from '@eforge-build/client/browser';
import { SchedulerPauseControl } from '../scheduler-pause-control';

function autoBuild(overrides: Partial<AutoBuildState> = {}): AutoBuildState {
  return {
    enabled: true,
    desired: 'enabled',
    mode: 'running',
    watcher: { running: false, pid: null, sessionId: null },
    scheduler: { alive: true, paused: false },
    ...overrides,
  } as AutoBuildState;
}

describe('SchedulerPauseControl', () => {
  it('renders nothing while auto-build state is unknown', () => {
    const { container } = render(<SchedulerPauseControl autoBuild={null} pending={false} error={null} onPause={vi.fn()} onResume={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders Pause scheduler and invokes onPause while desired auto-build is enabled', () => {
    const onPause = vi.fn();
    render(<SchedulerPauseControl autoBuild={autoBuild()} pending={false} error={null} onPause={onPause} onResume={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Pause scheduler' }));

    expect(onPause).toHaveBeenCalledTimes(1);
    expect(screen.queryByText('Scheduler paused')).toBeNull();
  });

  it('renders Resume scheduler and paused status when scheduler is paused', () => {
    const onResume = vi.fn();
    render(<SchedulerPauseControl autoBuild={autoBuild({ mode: 'paused', scheduler: { alive: true, paused: true } })} pending={false} error={null} onPause={vi.fn()} onResume={onResume} />);

    expect(screen.getByText('Scheduler paused')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: 'Resume scheduler' }));
    expect(onResume).toHaveBeenCalledTimes(1);
  });

  it('disables the control with a visible desired-state reason when auto-build is disabled', () => {
    render(<SchedulerPauseControl autoBuild={autoBuild({ enabled: false, desired: 'disabled', mode: 'disabled', scheduler: { alive: false, paused: false } })} pending={false} error={null} onPause={vi.fn()} onResume={vi.fn()} />);

    expect((screen.getByRole('button', { name: 'Pause scheduler' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Enable auto-build before pausing the scheduler.')).toBeDefined();
  });

  it('renders pending and route error text', () => {
    render(<SchedulerPauseControl autoBuild={autoBuild()} pending error="Scheduler route failed" onPause={vi.fn()} onResume={vi.fn()} />);

    expect((screen.getByRole('button', { name: 'Updating scheduler…' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole('alert').textContent).toContain('Scheduler route failed');
  });
});
