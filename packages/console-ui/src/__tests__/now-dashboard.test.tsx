import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { NowDashboard } from '@/views/now-dashboard';
import { initialConsoleProjectState } from '@/lib/project-state';
import type { ConsoleProjectState } from '@/lib/project-state';
import type { UseActiveSessionStreamsResult } from '@/hooks/use-active-session-streams';
import type { QueueItem, RunInfo } from '@eforge-build/client/browser';
import { createInitialRunState } from '@/lib/run-state';

function makeRun(overrides: Partial<RunInfo> = {}): RunInfo {
  return {
    id: 'run-1',
    sessionId: 'sess-1',
    planSet: 'plans-set',
    command: 'build',
    status: 'running',
    startedAt: new Date(Date.now() - 10_000).toISOString(),
    cwd: '/project',
    ...overrides,
  };
}

function makeQueue(overrides: Partial<QueueItem> = {}): QueueItem {
  return {
    id: 'q-1',
    title: 'My task',
    status: 'pending',
    ...overrides,
  };
}

const emptyActiveSessions: UseActiveSessionStreamsResult = {
  sessions: {},
  activeSessionIds: [],
  subscriptionCount: 0,
};

function connectedState(overrides: Partial<ConsoleProjectState> = {}): ConsoleProjectState {
  return {
    ...initialConsoleProjectState,
    connectionStatus: 'connected',
    lastSnapshotAt: Date.now(),
    ...overrides,
  };
}

let replaceStateSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  replaceStateSpy = vi.spyOn(window.history, 'replaceState').mockImplementation(() => {});
});

afterEach(() => {
  replaceStateSpy.mockRestore();
});

describe('NowDashboard', () => {
  it('renders the core dashboard surfaces for connected project state', () => {
    const state = connectedState({
      queue: [makeQueue()],
      runs: [makeRun({ status: 'completed', completedAt: new Date().toISOString() })],
      recentActivity: [
        {
          id: 'activity-1',
          event: { type: 'session:start', sessionId: 'sess-1' } as never,
          receivedAt: Date.now(),
        },
      ],
    });

    render(<NowDashboard projectState={state} activeSessions={emptyActiveSessions} />);

    expect(screen.getByText('Queue')).toBeDefined();
    expect(screen.getByText('Activity')).toBeDefined();
    expect(screen.getByText('Run history')).toBeDefined();
  });

  it('renders active build navigation for active session streams', () => {
    const onNavigate = vi.fn();
    const state = connectedState({ runs: [makeRun({ sessionId: 'sess-active' })] });
    const activeSessions: UseActiveSessionStreamsResult = {
      sessions: {
        'sess-active': {
          sessionId: 'sess-active',
          connectionStatus: 'connected',
          status: 'running',
          runState: createInitialRunState(),
          lastEventAt: Date.now(),
          error: null,
        },
      },
      activeSessionIds: ['sess-active'],
      subscriptionCount: 1,
    };

    render(
      <NowDashboard
        projectState={state}
        activeSessions={activeSessions}
        onNavigate={onNavigate}
      />,
    );

    fireEvent.click(screen.getByText('Inspect →'));

    expect(onNavigate).toHaveBeenCalledWith('/console/runs/sess-active');
  });

  it('shows a connection banner when the daemon stream is disconnected', () => {
    const state = connectedState({
      connectionStatus: 'disconnected',
      error: 'ECONNREFUSED',
      lastSnapshotAt: Date.now() - 5_000,
    });

    render(<NowDashboard projectState={state} activeSessions={emptyActiveSessions} />);

    const banner = screen.getByRole('status');
    expect(banner.textContent).toContain('Daemon stream disconnected');
    expect(banner.textContent).toContain('ECONNREFUSED');
  });

  it('surfaces stack sync controls when stacking data exists', () => {
    const state = connectedState({
      stackLayers: [
        {
          prdId: 'prd-1',
          stackId: 'stack-a',
          provider: 'git-spice',
          branch: 'feat/x',
          baseBranch: 'main',
          status: 'building',
          recordedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
      stackSync: {
        last: {
          id: 'sync-1',
          trigger: 'manual',
          startedAt: new Date(Date.now() - 5000).toISOString(),
          completedAt: new Date(Date.now() - 4000).toISOString(),
          outcome: 'complete',
          dryRun: false,
          restackCandidates: ['feat/x'],
        },
      } as never,
    });

    render(<NowDashboard projectState={state} activeSessions={emptyActiveSessions} />);

    expect(screen.getByText('Stack sync')).toBeDefined();
    expect(screen.getByRole('button', { name: /sync.*now/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /dry run/i })).toBeDefined();
  });
});
