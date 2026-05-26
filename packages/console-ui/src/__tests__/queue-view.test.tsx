import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { QueueView } from '@/views/queue';
import { App } from '@/app';
import type { ConsoleProjectState } from '@/lib/project-state';
import type { QueueItem } from '@eforge-build/client/browser';

// ---------------------------------------------------------------------------
// App-level hook stubs (used only by App tests; do not affect QueueView tests)
// ---------------------------------------------------------------------------

vi.mock('@/hooks/use-daemon-events', () => ({
  useDaemonEvents: vi.fn(() => ({
    projectState: {
      runs: [],
      queue: [],
      sessionMetadata: {},
      autoBuild: null,
      liveness: null,
      latestHeartbeat: null,
      recentActivity: [],
      stackLayers: [],
      connectionStatus: 'connected',
      lastSnapshotAt: 1000,
      lastEventAt: null,
      error: null,
    },
    connectionStatus: 'connected',
  })),
}));

vi.mock('@/hooks/use-active-session-streams', () => ({
  useActiveSessionStreams: vi.fn(() => ({
    sessions: {},
    activeSessionIds: [],
    subscriptionCount: 0,
  })),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeItem(overrides: Partial<QueueItem> = {}): QueueItem {
  return {
    id: 'q-1',
    title: 'Test build',
    status: 'pending',
    ...overrides,
  };
}

type TestProjectState = Pick<
  ConsoleProjectState,
  'queue' | 'connectionStatus' | 'lastSnapshotAt' | 'lastEventAt' | 'error'
>;

function makeState(overrides: Partial<TestProjectState> = {}): TestProjectState {
  return {
    queue: [],
    connectionStatus: 'connected',
    lastSnapshotAt: Date.now(),
    lastEventAt: null,
    error: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Partial-data state (connected but no snapshot yet)
// ---------------------------------------------------------------------------

describe('QueueView – partial-data state', () => {
  it('renders partial-data banner when connected with items but no snapshot', () => {
    const { getByText } = render(
      <QueueView
        projectState={makeState({
          connectionStatus: 'connected',
          lastSnapshotAt: null,
          queue: [makeItem({ id: 'q-1', title: 'Pre-snapshot build' })],
        })}
      />,
    );
    expect(getByText('Queue data is loading; some items may be missing.')).toBeDefined();
    // Queue item content is still rendered alongside the banner
    expect(getByText('Pre-snapshot build')).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Unknown status
// ---------------------------------------------------------------------------

describe('QueueView – unknown status', () => {
  it('renders original unknown mixed-case status text and unknown-status badge', () => {
    const { getAllByText, getByText } = render(
      <QueueView
        projectState={makeState({
          queue: [makeItem({ id: 'q-1', title: 'Custom build', status: 'Paused' })],
        })}
      />,
    );
    // The original status string must appear (in group heading and/or item row badge)
    const statusNodes = getAllByText('Paused');
    expect(statusNodes.length).toBeGreaterThan(0);
    // The unknown-status badge must be rendered to indicate this is an unrecognised status
    expect(getByText('unknown status')).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Connecting state
// ---------------------------------------------------------------------------

describe('QueueView – connecting state', () => {
  it('renders connecting message when no snapshot has arrived', () => {
    const { getByText } = render(
      <QueueView
        projectState={makeState({
          connectionStatus: 'connecting',
          lastSnapshotAt: null,
          queue: [],
        })}
      />,
    );
    expect(getByText('Connecting to daemon queue stream…')).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

describe('QueueView – empty state', () => {
  it('renders empty message when connected with no queue items', () => {
    const { getByText } = render(
      <QueueView
        projectState={makeState({
          connectionStatus: 'connected',
          queue: [],
          lastSnapshotAt: Date.now(),
        })}
      />,
    );
    expect(getByText('No items in the queue')).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Disconnected unavailable state
// ---------------------------------------------------------------------------

describe('QueueView – disconnected unavailable state', () => {
  it('renders unavailable message when disconnected with no snapshot', () => {
    const { getByText } = render(
      <QueueView
        projectState={makeState({
          connectionStatus: 'disconnected',
          lastSnapshotAt: null,
          error: 'Connection refused',
          queue: [],
        })}
      />,
    );
    expect(getByText('Queue data unavailable')).toBeDefined();
    expect(getByText('Connection refused')).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Disconnected stale snapshot state
// ---------------------------------------------------------------------------

describe('QueueView – disconnected stale snapshot state', () => {
  it('renders stale snapshot banner when disconnected with prior data', () => {
    const { getByText } = render(
      <QueueView
        projectState={makeState({
          connectionStatus: 'disconnected',
          lastSnapshotAt: Date.now() - 60_000,
          queue: [makeItem()],
          error: 'Stream lost',
        })}
      />,
    );
    expect(getByText(/Stream disconnected; showing snapshot from/)).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Populated rows
// ---------------------------------------------------------------------------

describe('QueueView – populated rows', () => {
  it('renders item title in queue rows', () => {
    const { getByText } = render(
      <QueueView
        projectState={makeState({
          queue: [makeItem({ id: 'q-1', title: 'My feature build' })],
        })}
      />,
    );
    expect(getByText('My feature build')).toBeDefined();
  });

  it('renders item id in queue rows', () => {
    const { getByText } = render(
      <QueueView
        projectState={makeState({
          queue: [makeItem({ id: 'q-special', title: 'Test' })],
        })}
      />,
    );
    expect(getByText('q-special')).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Priority text
// ---------------------------------------------------------------------------

describe('QueueView – priority text', () => {
  it('renders priority as text not input/select', () => {
    const { getByText, container } = render(
      <QueueView
        projectState={makeState({
          queue: [makeItem({ id: 'q-1', priority: 2 })],
        })}
      />,
    );
    expect(getByText('Priority 2')).toBeDefined();
    expect(container.querySelector('input')).toBeNull();
    expect(container.querySelector('select')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Dependency chips
// ---------------------------------------------------------------------------

describe('QueueView – dependency chips', () => {
  it('renders dependency chip with dependency id', () => {
    const { getByText } = render(
      <QueueView
        projectState={makeState({
          queue: [makeItem({ id: 'q-2', dependsOn: ['q-1'] })],
        })}
      />,
    );
    expect(getByText('q-1')).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Summary cards
// ---------------------------------------------------------------------------

describe('QueueView – summary cards', () => {
  it('renders summary cards with correct derived counts', () => {
    const { getByText } = render(
      <QueueView
        projectState={makeState({
          queue: [
            makeItem({ id: 'q-1', status: 'running' }),
            makeItem({ id: 'q-2', status: 'pending' }),
            makeItem({ id: 'q-3', status: 'failed', recoveryVerdict: { verdict: 'retry', confidence: 'high' } }),
            makeItem({ id: 'q-4', status: 'failed' }),
            makeItem({ id: 'q-5', status: 'waiting' }),
            makeItem({ id: 'q-6', status: 'pending', dependsOn: ['q-1'] }),
          ],
        })}
      />,
    );

    // Labels unique to QueueSummaryCards must be present
    const withDepsLabel = getByText('With deps');
    expect(withDepsLabel).toBeDefined();

    const recoveryVerdictLabel = getByText('Recovery verdict');
    expect(recoveryVerdictLabel).toBeDefined();

    const recoveryPendingLabel = getByText('Recovery pending');
    expect(recoveryPendingLabel).toBeDefined();

    // Count for "With deps" should be 1
    const withDepsCount = withDepsLabel.previousElementSibling;
    expect(withDepsCount?.textContent).toBe('1');

    // Count for "Recovery verdict" should be 1
    const recoveryVerdictCount = recoveryVerdictLabel.previousElementSibling;
    expect(recoveryVerdictCount?.textContent).toBe('1');

    // Count for "Recovery pending" should be 1
    const recoveryPendingCount = recoveryPendingLabel.previousElementSibling;
    expect(recoveryPendingCount?.textContent).toBe('1');
  });
});

// ---------------------------------------------------------------------------
// Recovery verdict chip
// ---------------------------------------------------------------------------

describe('QueueView – recovery verdict chip', () => {
  it('renders recovery verdict for failed item with verdict', () => {
    const { getAllByText } = render(
      <QueueView
        projectState={makeState({
          queue: [
            makeItem({
              id: 'q-1',
              status: 'failed',
              recoveryVerdict: { verdict: 'retry', confidence: 'high' },
            }),
          ],
        })}
      />,
    );
    // Failed item appears in attention section + status group – may match multiple times
    const verdictNodes = getAllByText('retry');
    expect(verdictNodes.length).toBeGreaterThan(0);
    // Confidence must also be rendered alongside the verdict
    const confidenceNodes = getAllByText('high');
    expect(confidenceNodes.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Recovery-pending text
// ---------------------------------------------------------------------------

describe('QueueView – recovery-pending text', () => {
  it('renders "recovery pending" for failed item without verdict', () => {
    const { getAllByText } = render(
      <QueueView
        projectState={makeState({
          queue: [makeItem({ id: 'q-1', status: 'failed' })],
        })}
      />,
    );
    // May appear multiple times (attention section + status group)
    const nodes = getAllByText('recovery pending');
    expect(nodes.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Local status filter behavior
// ---------------------------------------------------------------------------

describe('QueueView – local status filter', () => {
  it('filters items to only running when Running filter is clicked', () => {
    const { getByRole, queryByText, getByText } = render(
      <QueueView
        projectState={makeState({
          queue: [
            makeItem({ id: 'q-1', title: 'Running build', status: 'running' }),
            makeItem({ id: 'q-2', title: 'Pending build', status: 'pending' }),
          ],
        })}
      />,
    );

    const runningButton = getByRole('button', { name: /^Running$/i });
    fireEvent.click(runningButton);

    // Running item should be visible
    expect(getByText('Running build')).toBeDefined();
    // Pending item should be in a different group and hidden
    expect(queryByText('Pending build')).toBeNull();
  });

  it('shows all items when All filter is selected', () => {
    const { getByRole, getByText } = render(
      <QueueView
        projectState={makeState({
          queue: [
            makeItem({ id: 'q-1', title: 'Running build', status: 'running' }),
            makeItem({ id: 'q-2', title: 'Pending build', status: 'pending' }),
          ],
        })}
      />,
    );

    // Click Running first
    fireEvent.click(getByRole('button', { name: /^Running$/i }));
    // Then click All to restore
    fireEvent.click(getByRole('button', { name: /^All$/i }));

    expect(getByText('Running build')).toBeDefined();
    expect(getByText('Pending build')).toBeDefined();
  });

  it('sets aria-pressed=true on the active filter button', () => {
    const { getByRole } = render(
      <QueueView
        projectState={makeState({
          queue: [makeItem({ id: 'q-1', status: 'pending' })],
        })}
      />,
    );

    const pendingButton = getByRole('button', { name: /^Pending$/i });
    fireEvent.click(pendingButton);

    expect(pendingButton.getAttribute('aria-pressed')).toBe('true');
  });
});

// ---------------------------------------------------------------------------
// Absence of mutation controls
// ---------------------------------------------------------------------------

describe('QueueView – no mutation controls', () => {
  it('does not render reorder controls, dependency edit controls, or forbidden links', () => {
    const { queryByRole } = render(
      <QueueView
        projectState={makeState({
          queue: [makeItem({ id: 'q-1', status: 'pending', dependsOn: ['q-0'] })],
        })}
      />,
    );
    const forbiddenPattern =
      /reorder|move up|move down|edit priority|change priority|stack sync|overseer|add dependency|remove dependency|edit dependency/i;
    const forbiddenButton = queryByRole('button', { name: forbiddenPattern });
    expect(forbiddenButton).toBeNull();
    const forbiddenLink = queryByRole('link', { name: forbiddenPattern });
    expect(forbiddenLink).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// App-level route: /console/queue renders QueueView not RoutePlaceholder
// ---------------------------------------------------------------------------

describe('App – /console/queue route', () => {
  beforeEach(() => {
    window.history.pushState({}, '', '/console/queue');
  });

  afterEach(() => {
    window.history.pushState({}, '', '/');
  });

  it('renders QueueView content, not RoutePlaceholder, for /console/queue', () => {
    const { getByText, queryByText } = render(<App />);
    // QueueView always renders its read-only boundary note — unique to the view
    expect(
      getByText('This is a read-only view. Queue operations are not available in the Console.'),
    ).toBeDefined();
    // RoutePlaceholder fallback description for the queue route must be absent
    expect(queryByText(/Inspect and manage the build queue\./)).toBeNull();
  });
});
