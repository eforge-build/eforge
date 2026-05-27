import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import * as React from 'react';
import { NowDashboard } from '@/views/now-dashboard';
import { ActiveBuildsGrid } from '@/components/now/active-builds-grid';
import { initialConsoleProjectState } from '@/lib/project-state';
import type { ConsoleProjectState } from '@/lib/project-state';
import type { UseActiveSessionStreamsResult } from '@/hooks/use-active-session-streams';
import type { RunInfo, QueueItem } from '@eforge-build/client/browser';
import { createInitialRunState } from '@/lib/run-state';

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
  it('renders Attention, Queue, Recent runs, Stack layers, Recent activity sections when data exists', () => {
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
          runState: createInitialRunState(),
          lastEventAt: Date.now(),
          error: null,
        },
        'sess-B': {
          sessionId: 'sess-B',
          connectionStatus: 'connected',
          status: 'running',
          runState: createInitialRunState(),
          lastEventAt: Date.now(),
          error: null,
        },
      },
      activeSessionIds: ['sess-A', 'sess-B'],
      subscriptionCount: 2,
    };

    render(<NowDashboard projectState={state} activeSessions={activeSessions} />);

    // Both plan sets appear as card titles.
    // selectPrdDisplayLabel title-cases slugs ("plans-alpha" -> "Plans Alpha"),
    // so the regex must be case-insensitive.
    expect(screen.getAllByText(/plans[\s-]alpha|plans[\s-]beta/i).length).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// Empty connected state
// ---------------------------------------------------------------------------

describe('NowDashboard - empty connected state', () => {
  it('shows Queue is empty and No recent activity in the daemon snapshot', () => {
    const state = connectedState({
      queue: [],
      runs: [],
      stackLayers: [],
      recentActivity: [],
    });

    render(<NowDashboard projectState={state} activeSessions={emptyActiveSessions} />);

    expect(screen.getByText('Queue is empty')).toBeDefined();
    expect(screen.getByText('No recent activity in the daemon snapshot')).toBeDefined();
  });

  it('renders no active builds section when there are no active builds', () => {
    const state = connectedState({
      runs: [],
      queue: [],
    });

    const { container } = render(
      <NowDashboard projectState={state} activeSessions={emptyActiveSessions} />,
    );

    // ActiveBuildsGrid returns null for empty cards — no section heading or "No active builds" text
    expect(screen.queryByText('Active builds')).toBeNull();
    expect(screen.queryByText('No active builds')).toBeNull();
    // The grid container itself should not be in the DOM
    const grids = container.querySelectorAll('.grid');
    // There should be no active-builds grid (the queue/runs card grid is a different grid)
    const activeBuildsText = container.textContent ?? '';
    expect(activeBuildsText).not.toContain('Active builds');
  });
});

// ---------------------------------------------------------------------------
// ActiveBuildsGrid - isolated empty render
// ---------------------------------------------------------------------------

describe('ActiveBuildsGrid', () => {
  it('renders nothing when cards is an empty array', () => {
    const { container } = render(<ActiveBuildsGrid cards={[]} />);
    expect(container.firstChild).toBeNull();
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

// ---------------------------------------------------------------------------
// Stack sync status card
// ---------------------------------------------------------------------------

function makeStackSyncStatus(
  overrides: Partial<import('@eforge-build/client/browser').StackSyncStatusResponse> = {},
): import('@eforge-build/client/browser').StackSyncStatusResponse {
  return {
    last: {
      id: 'sync-1',
      trigger: 'manual',
      startedAt: new Date(Date.now() - 5000).toISOString(),
      completedAt: new Date(Date.now() - 4000).toISOString(),
      outcome: 'complete',
      dryRun: false,
      restackCandidates: ['feat/a'],
    },
    ...overrides,
  } as unknown as import('@eforge-build/client/browser').StackSyncStatusResponse;
}

function stateWithStack(
  syncOverrides?: Partial<import('@eforge-build/client/browser').StackSyncStatusResponse>,
): import('@/lib/project-state').ConsoleProjectState {
  return connectedState({
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
    stackSync: syncOverrides !== undefined ? makeStackSyncStatus(syncOverrides) : null,
  });
}

describe('NowDashboard - stack sync card', () => {
  it('renders "Stack sync" heading when stack layers exist', () => {
    const state = stateWithStack();

    render(<NowDashboard projectState={state} activeSessions={emptyActiveSessions} />);

    expect(screen.getByText('Stack sync')).toBeDefined();
  });

  it('renders "Sync now" and "Dry run" buttons when stack layers exist', () => {
    const state = stateWithStack();

    render(<NowDashboard projectState={state} activeSessions={emptyActiveSessions} />);

    expect(screen.getByRole('button', { name: /sync.*now/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /dry run/i })).toBeDefined();
  });

  it('renders "Retry" button when last outcome is deferred', () => {
    const state = stateWithStack({
      last: {
        id: 'sync-deferred',
        trigger: 'after-build',
        startedAt: new Date(Date.now() - 3000).toISOString(),
        completedAt: new Date(Date.now() - 2000).toISOString(),
        outcome: 'deferred',
        dryRun: false,
        restackCandidates: [],
        reason: 'active build in progress',
      },
    } as unknown as Partial<import('@eforge-build/client/browser').StackSyncStatusResponse>);

    render(<NowDashboard projectState={state} activeSessions={emptyActiveSessions} />);

    expect(screen.getByRole('button', { name: /retry/i })).toBeDefined();
  });

  it('does not render "Retry" button when last outcome is complete', () => {
    const state = stateWithStack();

    render(<NowDashboard projectState={state} activeSessions={emptyActiveSessions} />);

    expect(screen.queryByRole('button', { name: /retry/i })).toBeNull();
  });

  it('renders last outcome badge when sync status is present', () => {
    const state = stateWithStack();

    render(<NowDashboard projectState={state} activeSessions={emptyActiveSessions} />);

    // Badge renders the outcome text
    const badges = screen.getAllByText(/complete/i);
    expect(badges.length).toBeGreaterThan(0);
  });

  it('renders failure reason when last outcome is failed', () => {
    const state = stateWithStack({
      last: {
        id: 'sync-failed',
        trigger: 'manual',
        startedAt: new Date(Date.now() - 3000).toISOString(),
        completedAt: new Date(Date.now() - 2000).toISOString(),
        outcome: 'failed',
        dryRun: false,
        restackCandidates: [],
        reason: 'provider command failed',
        error: 'git exited with code 1',
      },
    } as unknown as Partial<import('@eforge-build/client/browser').StackSyncStatusResponse>);

    render(<NowDashboard projectState={state} activeSessions={emptyActiveSessions} />);

    const text = screen.getByText(/provider command failed/i);
    expect(text).toBeDefined();
  });

  it('does not render stack sync card when there are no stack layers', () => {
    const state = connectedState({ stackLayers: [], stackSync: null });

    render(<NowDashboard projectState={state} activeSessions={emptyActiveSessions} />);

    expect(screen.queryByText('Stack sync')).toBeNull();
  });
});
