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

  it('renders dependency-linked queue stacks', () => {
    const state = connectedState({
      queue: [
        makeQueue({ id: 'base', title: 'Base Build', status: 'running' }),
        makeQueue({ id: 'api', title: 'API Build', status: 'waiting', dependsOn: ['base'] }),
        makeQueue({ id: 'handoff', title: 'Handoff Build', status: 'waiting', dependsOn: ['api'] }),
      ],
    });

    render(<NowDashboard projectState={state} activeSessions={emptyActiveSessions} />);

    expect(screen.getByText('Build stack')).toBeDefined();
    expect(screen.getAllByText('Base Build').length).toBeGreaterThan(0);
    expect(screen.getAllByText('API Build').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Handoff Build').length).toBeGreaterThan(0);
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

  it('does not render the stack sync card on Now for a normal (complete) outcome', () => {
    const state = connectedState({
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

    // Stack sync status + controls live on System now, not on the Now glance view.
    expect(screen.queryByText('Stack sync')).toBeNull();
    expect(screen.queryByRole('button', { name: /sync.*now/i })).toBeNull();
  });

  it('escalates a conflict stack sync into the Now alert strip with a retry control', () => {
    const state = connectedState({
      stackSync: {
        last: {
          id: 'sync-2',
          trigger: 'after-build',
          startedAt: new Date(Date.now() - 5000).toISOString(),
          completedAt: new Date(Date.now() - 4000).toISOString(),
          outcome: 'conflict',
          dryRun: false,
          reason: 'restack conflict on feat/x',
          restackCandidates: ['feat/x'],
        },
      } as never,
    });

    render(<NowDashboard projectState={state} activeSessions={emptyActiveSessions} />);

    expect(screen.getByText('Stack sync conflict')).toBeDefined();
    expect(screen.getByText('restack conflict on feat/x')).toBeDefined();
    expect(screen.getByRole('button', { name: /retry/i })).toBeDefined();
  });
});
