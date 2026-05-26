import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, within } from '@testing-library/react';
import { ConsoleShell } from '@/components/shell/console-shell';
import { StatusStrip } from '@/components/shell/status-strip';
import { initialConsoleProjectState } from '@/lib/project-state';
import type { ConsoleProjectState } from '@/lib/project-state';
import { formatAbsoluteTimestamp } from '@/lib/format';

const stubState = {
  ...initialConsoleProjectState,
  connectionStatus: 'connected' as const,
};

const disconnectedState = {
  ...initialConsoleProjectState,
  connectionStatus: 'disconnected' as const,
};

describe('ConsoleShell', () => {
  it('renders Eforge Console branding text', () => {
    const { getByText } = render(
      <ConsoleShell currentRoute="now" projectState={stubState}>
        <div>content</div>
      </ConsoleShell>,
    );
    expect(getByText('Eforge Console')).toBeDefined();
  });

  it('renders the eforge logo image with non-empty src and alt', () => {
    const { container } = render(
      <ConsoleShell currentRoute="now" projectState={stubState}>
        <div>content</div>
      </ConsoleShell>,
    );
    const img = container.querySelector('img');
    expect(img).not.toBeNull();
    expect(img!.src).toBeTruthy();
    expect(img!.alt).toBeTruthy();
  });

  it('renders a link with accessible name containing Monitor and href="/"', () => {
    const { getByRole } = render(
      <ConsoleShell currentRoute="now" projectState={stubState}>
        <div>content</div>
      </ConsoleShell>,
    );
    // Look for a link whose accessible name contains "Monitor"
    const monitorLink = getByRole('link', { name: /monitor/i });
    expect(monitorLink).toBeDefined();
    expect(monitorLink.getAttribute('href')).toBe('/');
  });

  it('does not render visible "Connected" text when connection status is connected', () => {
    const { getByRole } = render(
      <ConsoleShell currentRoute="now" projectState={stubState}>
        <div>content</div>
      </ConsoleShell>,
    );
    // The sidebar hides the "Connected" label when connected — only the dot is shown.
    // Scope to the sidebar (<aside role="complementary">) so the StatusStrip footer
    // (which always shows the connection label) does not interfere.
    const sidebar = getByRole('complementary', { name: /console navigation/i });
    expect(within(sidebar).queryByText('Connected')).toBeNull();
  });

  it('renders visible "Disconnected" text when connection status is disconnected', () => {
    const { getByRole } = render(
      <ConsoleShell currentRoute="now" projectState={disconnectedState}>
        <div>content</div>
      </ConsoleShell>,
    );
    // Both the sidebar and StatusStrip show "Disconnected" when disconnected.
    // Scope the assertion to the sidebar.
    const sidebar = getByRole('complementary', { name: /console navigation/i });
    expect(within(sidebar).getByText('Disconnected')).toBeDefined();
  });

  it('renders visible "Connecting..." text when connection status is connecting', () => {
    const connectingState = {
      ...initialConsoleProjectState,
      connectionStatus: 'connecting' as const,
    };
    const { getByRole } = render(
      <ConsoleShell currentRoute="now" projectState={connectingState}>
        <div>content</div>
      </ConsoleShell>,
    );
    // The sidebar shows "Connecting..." when connecting; scope to sidebar to avoid StatusStrip.
    const sidebar = getByRole('complementary', { name: /console navigation/i });
    expect(within(sidebar).getByText('Connecting...')).toBeDefined();
    // The "Connected" label is hidden when not connected.
    expect(within(sidebar).queryByText('Connected')).toBeNull();
  });

  it('renders nav links for all five routes with /console/ scoped hrefs', () => {
    const { getByRole } = render(
      <ConsoleShell currentRoute="now" projectState={stubState}>
        <div>content</div>
      </ConsoleShell>,
    );

    const nowLink = getByRole('link', { name: 'Now' });
    expect(nowLink.getAttribute('href')).toMatch(/^\/console/);

    const queueLink = getByRole('link', { name: 'Queue' });
    expect(queueLink.getAttribute('href')).toBe('/console/queue');

    const runsLink = getByRole('link', { name: 'Runs' });
    expect(runsLink.getAttribute('href')).toBe('/console/runs');

    const systemLink = getByRole('link', { name: 'System' });
    expect(systemLink.getAttribute('href')).toBe('/console/system');

    const activityLink = getByRole('link', { name: 'Activity' });
    expect(activityLink.getAttribute('href')).toBe('/console/activity');
  });
});

// ---------------------------------------------------------------------------
// StatusStrip
// ---------------------------------------------------------------------------

describe('StatusStrip', () => {
  const FIXED_NOW = new Date('2025-01-15T12:00:30.000Z').getTime();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FIXED_NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('shows relative update label, absolute timestamp, and heartbeat-derived queue depth', () => {
    const SNAPSHOT_AT = FIXED_NOW - 30_000; // 30 seconds before fixed now

    const state: ConsoleProjectState = {
      ...initialConsoleProjectState,
      connectionStatus: 'connected',
      lastSnapshotAt: SNAPSHOT_AT,
      lastEventAt: null,
      queue: [{ id: 'q-1', title: 'item', status: 'pending' }],
      latestHeartbeat: {
        at: SNAPSHOT_AT,
        payload: {
          queueDepth: 7,
          runningBuilds: 0,
          uptime: 1000,
          autoBuild: { enabled: false, paused: false },
          subscribers: 1,
        },
      },
    };

    const { getByLabelText } = render(<StatusStrip projectState={state} />);
    const footer = getByLabelText('connection and daemon status');

    // Relative label: 30 seconds ago
    expect(within(footer).getByText('30s ago')).toBeDefined();

    // Absolute timestamp is rendered alongside the relative label.
    // Compute the expected value using the same helper the component uses.
    const expectedAbsoluteTs = formatAbsoluteTimestamp(SNAPSHOT_AT);
    expect(footer.textContent).toContain(`(${expectedAbsoluteTs})`);

    // Queue depth from heartbeat (7), not queue.length (1)
    expect(within(footer).getByText('7')).toBeDefined();
  });

  it('shows the newer of lastSnapshotAt and lastEventAt for last update', () => {
    const SNAPSHOT_AT = FIXED_NOW - 60_000; // 1 minute ago
    const EVENT_AT = FIXED_NOW - 10_000;    // 10 seconds ago (newer)

    const state: ConsoleProjectState = {
      ...initialConsoleProjectState,
      connectionStatus: 'connected',
      lastSnapshotAt: SNAPSHOT_AT,
      lastEventAt: EVENT_AT,
    };

    const { getByLabelText } = render(<StatusStrip projectState={state} />);
    const footer = getByLabelText('connection and daemon status');

    // Should show 10s ago (from lastEventAt), not 1m ago (from lastSnapshotAt)
    expect(within(footer).getByText('10s ago')).toBeDefined();
  });
});
