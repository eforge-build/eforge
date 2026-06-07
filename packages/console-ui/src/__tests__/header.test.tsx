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
  autoBuild: {
    enabled: true,
    watcher: { running: true, pid: 1234, sessionId: 'watcher-session-1' },
    desired: 'enabled' as const,
    mode: 'running' as const,
  },
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

function renderShell(
  onNavigate = vi.fn(),
  onSetAutoBuildEnabled = vi.fn(),
  projectState = stubState,
) {
  render(
    <ConsoleShell
      projectState={projectState}
      autoBuildToggling={false}
      onSetAutoBuildEnabled={onSetAutoBuildEnabled}
      onNavigate={onNavigate}
    >
      <div>content</div>
    </ConsoleShell>,
  );
  return { onNavigate, onSetAutoBuildEnabled };
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

  it('renders Console navigation without an external back link', () => {
    renderShell();

    expect(screen.getByRole('button', { name: /^now$/i })).toBeDefined();
    expect(screen.queryByRole('button', { name: /^plans$/i })).toBeNull();
    expect(screen.getByRole('button', { name: /^workstations$/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /^system$/i })).toBeDefined();
    expect(screen.queryByRole('link', { name: /monitor/i })).toBeNull();
  });

  it('does not render navigation to the removed plans path', () => {
    const { onNavigate } = renderShell();
    const removedPath = '/console/' + 'plans';

    for (const button of screen.getAllByRole('button')) {
      fireEvent.click(button);
    }

    expect(screen.queryByRole('button', { name: /^plans$/i })).toBeNull();
    expect(onNavigate).not.toHaveBeenCalledWith(removedPath);
  });

  it('routes Workstations header navigation through onNavigate', () => {
    const { onNavigate } = renderShell();

    fireEvent.click(screen.getByRole('button', { name: /^workstations$/i }));

    expect(onNavigate).toHaveBeenCalledWith('/console/workstations');
  });

  it('disables auto-build immediately without confirmation', () => {
    const onSetAutoBuildEnabled = vi.fn();
    renderShell(vi.fn(), onSetAutoBuildEnabled);

    fireEvent.click(screen.getByRole('switch', { name: /auto-build toggle/i }));

    expect(onSetAutoBuildEnabled).toHaveBeenCalledTimes(1);
    expect(onSetAutoBuildEnabled).toHaveBeenCalledWith(false);
    expect(screen.queryByText(/queued builds may start immediately/i)).toBeNull();
  });

  it('asks for confirmation before enabling auto-build', () => {
    const onSetAutoBuildEnabled = vi.fn();
    renderShell(vi.fn(), onSetAutoBuildEnabled, {
      ...stubState,
      autoBuild: {
        ...stubState.autoBuild,
        enabled: false,
        desired: 'disabled' as const,
        mode: 'disabled' as const,
      },
    });

    fireEvent.click(screen.getByRole('switch', { name: /auto-build toggle/i }));

    expect(screen.getByText(/queued builds may start immediately/i)).toBeDefined();
    expect(onSetAutoBuildEnabled).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /^enable$/i }));

    expect(onSetAutoBuildEnabled).toHaveBeenCalledTimes(1);
    expect(onSetAutoBuildEnabled).toHaveBeenCalledWith(true);
  });
});
