import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import { ConsoleShell } from '@/components/shell/console-shell';
import { initialConsoleProjectState } from '@/lib/project-state';
import { EFORGE_LOGO_ALT, EFORGE_LOGO_URL } from '@/lib/brand';

const FIXED_NOW = new Date('2025-01-15T12:00:30.000Z').getTime();

const stubState = {
  ...initialConsoleProjectState,
  connectionStatus: 'connected' as const,
  runs: [
    {
      id: 'r1',
      command: 'build',
      status: 'completed',
      startedAt: '2025-01-15T10:00:00Z',
      completedAt: '2025-01-15T11:00:00Z',
      cwd: '/home/user/my-project',
      planSet: 'test-plan',
    },
  ],
  lastSnapshotAt: FIXED_NOW - 30_000,
  latestHeartbeat: {
    at: FIXED_NOW - 10_000,
    payload: {
      queueDepth: 3,
      runningBuilds: 2,
      uptime: 60_000,
      autoBuild: { enabled: true, paused: false },
      subscribers: 1,
    },
  },
};

function renderShell(onNavigate = vi.fn()) {
  render(
    <ConsoleShell projectState={stubState} onNavigate={onNavigate}>
      <div>content</div>
    </ConsoleShell>,
  );
  return { onNavigate };
}

describe('ConsoleShell header', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows brand, project, connection, and build status controls', () => {
    renderShell();

    const logo = screen.getByAltText(EFORGE_LOGO_ALT) as HTMLImageElement;
    expect(logo.src).toBe(EFORGE_LOGO_URL);
    expect(screen.getByText('my-project')).toBeDefined();
    expect(screen.getByLabelText(/connection status/i)).toBeDefined();
    expect(screen.getByRole('switch', { name: /auto-build toggle/i })).toBeDefined();
    expect(screen.getByLabelText(/queue count/i)).toBeDefined();
    expect(screen.getByLabelText(/active builds count/i)).toBeDefined();
  });

  it('routes header navigation through onNavigate', () => {
    const { onNavigate } = renderShell();

    fireEvent.click(screen.getByRole('button', { name: /^plans$/i }));

    expect(onNavigate).toHaveBeenCalledWith('/console/plans');
  });
});
