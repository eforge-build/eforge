import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import * as React from 'react';
import { NowDashboard } from '@/views/now-dashboard';
import { initialConsoleProjectState } from '@/lib/project-state';
import type { ConsoleProjectState } from '@/lib/project-state';
import type { UseActiveSessionStreamsResult } from '@/hooks/use-active-session-streams';
import type { RunInfo, QueueItem } from '@eforge-build/client/browser';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Populated render
// ---------------------------------------------------------------------------

describe('NowDashboard - populated state', () => {
  it('renders Attention, Active builds, Queue, Recent runs, Stack layers, Recent activity sections when data exists', () => {
    const state = connectedState({
      runs: [makeRun()],
      queue: [makeQueue({ status: 'failed' })],
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
      recentActivity: [
        {
          id: '1',
          event: {
            type: 'session:start',
            sessionId: 'sess-1',
          } as unknown as import('@eforge-build/client/browser').EforgeEvent,
          receivedAt: Date.now(),
        },
      ],
    });

    render(<NowDashboard projectState={state} activeSessions={emptyActiveSessions} />);

    // Stack layers section should be present
    expect(screen.getByText('Stack layers')).toBeDefined();
    // Recent activity section
    expect(screen.getByText('Recent activity')).toBeDefined();
    // Active builds section heading (may appear multiple times due to metric card)
    expect(screen.getAllByText('Active builds').length).toBeGreaterThanOrEqual(1);
    // Queue card heading
    expect(screen.getByText('Queue')).toBeDefined();
    // Recent runs card heading
    expect(screen.getByText('Recent runs')).toBeDefined();
  });

  it('renders two active build cards for two active sessions', () => {
    const now = Date.now();
    const runA = makeRun({ id: 'rA', sessionId: 'sess-A', planSet: 'plans-alpha', startedAt: new Date(now - 5000).toISOString() });
    const runB = makeRun({ id: 'rB', sessionId: 'sess-B', planSet: 'plans-beta', startedAt: new Date(now - 3000).toISOString() });
    const state = connectedState({ runs: [runA, runB] });

    const activeSessions: UseActiveSessionStreamsResult = {
      sessions: {
        'sess-A': {
          sessionId: 'sess-A',
          connectionStatus: 'connected',
          status: 'running',
          snapshotEvents: [],
          liveEvents: [],
          lastEventAt: Date.now(),
          error: null,
        },
        'sess-B': {
          sessionId: 'sess-B',
          connectionStatus: 'connected',
          status: 'running',
          snapshotEvents: [],
          liveEvents: [],
          lastEventAt: Date.now(),
          error: null,
        },
      },
      activeSessionIds: ['sess-A', 'sess-B'],
      subscriptionCount: 2,
    };

    render(<NowDashboard projectState={state} activeSessions={activeSessions} />);

    // Both plan sets appear as card titles
    expect(screen.getAllByText(/plans-alpha|plans-beta/).length).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// Empty connected state
// ---------------------------------------------------------------------------

describe('NowDashboard - empty connected state', () => {
  it('shows Queue is empty, No active builds, and No recent activity in the daemon snapshot', () => {
    const state = connectedState({
      queue: [],
      runs: [],
      stackLayers: [],
      recentActivity: [],
    });

    render(<NowDashboard projectState={state} activeSessions={emptyActiveSessions} />);

    expect(screen.getByText('Queue is empty')).toBeDefined();
    expect(screen.getByText('No active builds')).toBeDefined();
    expect(screen.getByText('No recent activity in the daemon snapshot')).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Connecting state
// ---------------------------------------------------------------------------

describe('NowDashboard - connecting state', () => {
  it('displays "Connecting to daemon stream" before the first snapshot', () => {
    const state: ConsoleProjectState = {
      ...initialConsoleProjectState,
      connectionStatus: 'connecting',
      lastSnapshotAt: null,
    };

    render(<NowDashboard projectState={state} activeSessions={emptyActiveSessions} />);

    expect(screen.getByText('Connecting to daemon stream')).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Disconnected state
// ---------------------------------------------------------------------------

describe('NowDashboard - disconnected state', () => {
  it('displays "Daemon stream disconnected" and the stream error text', () => {
    const state: ConsoleProjectState = {
      ...initialConsoleProjectState,
      connectionStatus: 'disconnected',
      error: 'ECONNREFUSED',
      lastSnapshotAt: Date.now() - 5000,
    };

    render(<NowDashboard projectState={state} activeSessions={emptyActiveSessions} />);

    const banner = screen.getByRole('status');
    expect(banner.textContent).toContain('Daemon stream disconnected');
    expect(banner.textContent).toContain('ECONNREFUSED');
  });
});

// ---------------------------------------------------------------------------
// Stale state
// ---------------------------------------------------------------------------

describe('NowDashboard - stale state', () => {
  it('displays "Daemon heartbeat stale" when last heartbeat is too old', () => {
    const now = Date.now();
    const state: ConsoleProjectState = {
      ...initialConsoleProjectState,
      connectionStatus: 'connected',
      lastSnapshotAt: now - 60_000,
      lastEventAt: now - 60_000,
      latestHeartbeat: {
        at: now - 60_000,
        payload: {
          uptime: 100,
          queueDepth: 0,
          runningBuilds: 0,
          autoBuild: { enabled: false, paused: false },
          subscribers: 1,
        },
      },
    };

    render(<NowDashboard projectState={state} activeSessions={emptyActiveSessions} />);

    const banner = screen.getByRole('status');
    expect(banner.textContent).toContain('Daemon heartbeat stale');
  });
});

// ---------------------------------------------------------------------------
// Stack summary absence
// ---------------------------------------------------------------------------

describe('NowDashboard - stack summary', () => {
  it('is absent when stackLayers is an empty array', () => {
    const state = connectedState({ stackLayers: [] });

    render(<NowDashboard projectState={state} activeSessions={emptyActiveSessions} />);

    expect(screen.queryByText('Stack layers')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Deferred control absence
// ---------------------------------------------------------------------------

describe('NowDashboard - deferred controls', () => {
  it('contains no forbidden control text', () => {
    const state = connectedState({
      runs: [makeRun()],
      queue: [makeQueue()],
    });

    const { container } = render(
      <NowDashboard projectState={state} activeSessions={emptyActiveSessions} />,
    );

    const text = container.textContent?.toLowerCase() ?? '';
    const forbidden = ['reorder', 'edit priority', 'overseer', 'sync stack', 'rebase stack', 'land stack'];
    for (const term of forbidden) {
      expect(text).not.toContain(term);
    }
  });
});
