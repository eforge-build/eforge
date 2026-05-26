import { describe, it, expect } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { ActivityAuditView } from '@/views/activity';
import type { ConsoleProjectState } from '@/lib/project-state';
import type { ConsoleActivityEntry } from '@/lib/types';
import type { EforgeEvent } from '@eforge-build/client/browser';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FIXED_NOW = 1_100_000;

function makeEntry(
  id: string,
  type: string,
  extra: Record<string, unknown> = {},
  receivedAt = 1_000_000,
): ConsoleActivityEntry {
  return {
    id,
    event: { type, ...extra } as unknown as EforgeEvent,
    receivedAt,
  };
}

type TestProjectState = Pick<
  ConsoleProjectState,
  'recentActivity' | 'connectionStatus' | 'error' | 'lastSnapshotAt' | 'lastEventAt'
>;

function makeState(overrides: Partial<TestProjectState> = {}): TestProjectState {
  return {
    recentActivity: [],
    connectionStatus: 'connected',
    error: null,
    lastSnapshotAt: FIXED_NOW - 5000,
    lastEventAt: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Populated state
// ---------------------------------------------------------------------------

describe('ActivityAuditView – populated state', () => {
  it('renders route heading "Activity"', () => {
    const { getByRole } = render(
      <ActivityAuditView
        projectState={makeState({ recentActivity: [makeEntry('e1', 'session:start')] })}
        now={FIXED_NOW}
      />,
    );
    expect(getByRole('heading', { name: /activity/i })).toBeDefined();
  });

  it('shows total count', () => {
    const { getByText } = render(
      <ActivityAuditView
        projectState={makeState({
          recentActivity: [
            makeEntry('e1', 'session:start', {}, 1001),
            makeEntry('e2', 'agent:start', {}, 1002),
          ],
        })}
        now={FIXED_NOW}
      />,
    );
    expect(getByText('2 total')).toBeDefined();
  });

  it('shows visible count', () => {
    const { getByText } = render(
      <ActivityAuditView
        projectState={makeState({
          recentActivity: [
            makeEntry('e1', 'session:start', {}, 1001),
            makeEntry('e2', 'agent:start', {}, 1002),
          ],
        })}
        now={FIXED_NOW}
      />,
    );
    expect(getByText('2 visible')).toBeDefined();
  });

  it('renders event type text in the list', () => {
    const { getByText } = render(
      <ActivityAuditView
        projectState={makeState({
          recentActivity: [makeEntry('e1', 'session:start', {}, 1001)],
        })}
        now={FIXED_NOW}
      />,
    );
    expect(getByText('session:start')).toBeDefined();
  });

  it('renders registry summary text', () => {
    // session:start has summary 'Session started'
    const { getByText } = render(
      <ActivityAuditView
        projectState={makeState({
          recentActivity: [makeEntry('e1', 'session:start', {}, 1001)],
        })}
        now={FIXED_NOW}
      />,
    );
    expect(getByText('Session started')).toBeDefined();
  });

  it('renders identifier chips when identifiers are present', () => {
    const { getByText } = render(
      <ActivityAuditView
        projectState={makeState({
          recentActivity: [makeEntry('e1', 'session:start', { sessionId: 'sess-xyz' }, 1001)],
        })}
        now={FIXED_NOW}
      />,
    );
    expect(getByText('sess-xyz')).toBeDefined();
  });

  it('renders a raw JSON panel with pre element', () => {
    const event = { type: 'session:start', sessionId: 's1' } as unknown as EforgeEvent;
    const { container } = render(
      <ActivityAuditView
        projectState={makeState({
          recentActivity: [{ id: 'e1', event, receivedAt: 1001 }],
        })}
        now={FIXED_NOW}
      />,
    );
    const pre = container.querySelector('pre');
    expect(pre).not.toBeNull();
    expect(pre!.textContent).toBe(JSON.stringify(event, null, 2));
  });
});

// ---------------------------------------------------------------------------
// Family chip filtering
// ---------------------------------------------------------------------------

describe('ActivityAuditView – family chip filtering', () => {
  it('clicking a family chip filters the list to that family', () => {
    const { getByText, getByRole } = render(
      <ActivityAuditView
        projectState={makeState({
          recentActivity: [
            makeEntry('e1', 'session:start', {}, 1001),
            makeEntry('e2', 'agent:start', { agent: 'impl' }, 1002),
            makeEntry('e3', 'daemon:lifecycle:ready', {}, 1003),
          ],
        })}
        now={FIXED_NOW}
      />,
    );

    // Click the "Agent" family chip button
    const agentChip = getByRole('button', { name: /^Agent/i });
    fireEvent.click(agentChip);

    // Only the agent:start event should remain visible
    expect(getByText('agent:start')).toBeDefined();
    expect(() => getByText('session:start')).toThrow();
    expect(() => getByText('daemon:lifecycle:ready')).toThrow();
  });

  it('updates visible count text after family chip click', () => {
    const { getByText, getByRole } = render(
      <ActivityAuditView
        projectState={makeState({
          recentActivity: [
            makeEntry('e1', 'session:start', {}, 1001),
            makeEntry('e2', 'agent:start', { agent: 'impl' }, 1002),
            makeEntry('e3', 'agent:stop', { agent: 'impl' }, 1003),
          ],
        })}
        now={FIXED_NOW}
      />,
    );

    // Initially 3 visible
    expect(getByText('3 visible')).toBeDefined();

    // Click Agent chip
    const agentChip = getByRole('button', { name: /^Agent/i });
    fireEvent.click(agentChip);

    // Now 2 visible (agent:start + agent:stop)
    expect(getByText('2 visible')).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Attention-only filter
// ---------------------------------------------------------------------------

describe('ActivityAuditView – attention-only filter', () => {
  it('hides non-attention events when attention-only is enabled', () => {
    const { container, getByText } = render(
      <ActivityAuditView
        projectState={makeState({
          recentActivity: [
            makeEntry('e1', 'session:start', {}, 1001),
            makeEntry('e2', 'daemon:error', { source: 'daemon' }, 1002),
            makeEntry('e3', 'plan:build:failed', {}, 1003),
          ],
        })}
        now={FIXED_NOW}
      />,
    );

    const checkbox = container.querySelector('input[type="checkbox"]') as HTMLInputElement;
    fireEvent.click(checkbox);

    // Attention events should remain
    expect(getByText('daemon:error')).toBeDefined();
    expect(getByText('plan:build:failed')).toBeDefined();
    // Non-attention event should be hidden
    expect(() => getByText('session:start')).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Event type filter
// ---------------------------------------------------------------------------

describe('ActivityAuditView – event type filter', () => {
  it('typing in the event type filter updates visible rows', () => {
    const { container, getByText } = render(
      <ActivityAuditView
        projectState={makeState({
          recentActivity: [
            makeEntry('e1', 'session:start', {}, 1001),
            makeEntry('e2', 'session:end', {}, 1002),
            makeEntry('e3', 'agent:start', {}, 1003),
          ],
        })}
        now={FIXED_NOW}
      />,
    );

    const typeInput = container.querySelector(
      'input[aria-label="Search event type"]',
    ) as HTMLInputElement;

    fireEvent.change(typeInput, { target: { value: 'session:' } });

    // session:start and session:end should remain; agent:start should be gone
    expect(getByText('session:start')).toBeDefined();
    expect(getByText('session:end')).toBeDefined();
    expect(() => getByText('agent:start')).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Identifier filter
// ---------------------------------------------------------------------------

describe('ActivityAuditView – identifier filter', () => {
  it('typing in the identifier filter matches rows by sessionId', () => {
    const { container, getByText } = render(
      <ActivityAuditView
        projectState={makeState({
          recentActivity: [
            makeEntry('e1', 'session:start', { sessionId: 'sess-abc' }, 1001),
            makeEntry('e2', 'session:end', { sessionId: 'sess-xyz' }, 1002),
          ],
        })}
        now={FIXED_NOW}
      />,
    );

    const idInput = container.querySelector(
      'input[aria-label="Search identifiers"]',
    ) as HTMLInputElement;

    fireEvent.change(idInput, { target: { value: 'sess-abc' } });

    expect(getByText('sess-abc')).toBeDefined();
    expect(() => getByText('sess-xyz')).toThrow();
  });

  it('typing in the identifier filter matches rows by planId', () => {
    const { container, getByText } = render(
      <ActivityAuditView
        projectState={makeState({
          recentActivity: [
            makeEntry('e1', 'agent:start', { agent: 'implementor', planId: 'plan-01' }, 1001),
            makeEntry('e2', 'agent:start', { agent: 'reviewer', planId: 'plan-02' }, 1002),
          ],
        })}
        now={FIXED_NOW}
      />,
    );

    const idInput = container.querySelector(
      'input[aria-label="Search identifiers"]',
    ) as HTMLInputElement;

    fireEvent.change(idInput, { target: { value: 'plan-01' } });

    expect(getByText('plan-01')).toBeDefined();
    expect(() => getByText('plan-02')).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Connecting state
// ---------------------------------------------------------------------------

describe('ActivityAuditView – connecting state', () => {
  it('renders connecting message when no snapshot has arrived', () => {
    const { getByText } = render(
      <ActivityAuditView
        projectState={makeState({
          connectionStatus: 'connecting',
          lastSnapshotAt: null,
          recentActivity: [],
        })}
        now={FIXED_NOW}
      />,
    );
    expect(getByText('Connecting to daemon activity stream…')).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Disconnected state
// ---------------------------------------------------------------------------

describe('ActivityAuditView – disconnected state', () => {
  it('renders "Daemon activity unavailable" and error text when no rows', () => {
    const { getByText } = render(
      <ActivityAuditView
        projectState={makeState({
          connectionStatus: 'disconnected',
          error: 'Connection refused',
          recentActivity: [],
          lastSnapshotAt: null,
        })}
        now={FIXED_NOW}
      />,
    );
    expect(getByText('Daemon activity unavailable')).toBeDefined();
    expect(getByText('Connection refused')).toBeDefined();
  });

  it('renders stream-disconnected banner and keeps existing rows when disconnected with data', () => {
    const { getByText } = render(
      <ActivityAuditView
        projectState={makeState({
          connectionStatus: 'disconnected',
          error: 'Connection lost',
          recentActivity: [makeEntry('e1', 'session:start', {}, 1001)],
          lastSnapshotAt: FIXED_NOW - 10000,
        })}
        now={FIXED_NOW}
      />,
    );
    expect(getByText(/Stream disconnected; showing last received activity\./)).toBeDefined();
    // Existing rows should still be visible
    expect(getByText('session:start')).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Connected empty state
// ---------------------------------------------------------------------------

describe('ActivityAuditView – connected empty state', () => {
  it('renders empty message when connected with no activity', () => {
    const { getByText } = render(
      <ActivityAuditView
        projectState={makeState({
          connectionStatus: 'connected',
          recentActivity: [],
        })}
        now={FIXED_NOW}
      />,
    );
    expect(getByText('No daemon activity has been received yet.')).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Filtered-empty state
// ---------------------------------------------------------------------------

describe('ActivityAuditView – filtered-empty state', () => {
  it('renders no-match message when filters hide all rows', () => {
    const { container, getByText } = render(
      <ActivityAuditView
        projectState={makeState({
          recentActivity: [makeEntry('e1', 'session:start', {}, 1001)],
        })}
        now={FIXED_NOW}
      />,
    );

    const typeInput = container.querySelector(
      'input[aria-label="Search event type"]',
    ) as HTMLInputElement;

    fireEvent.change(typeInput, { target: { value: 'nonexistent:event:xyz' } });

    expect(getByText('No activity matches the current filters.')).toBeDefined();
  });

  it('reset button restores all rows', () => {
    const { container, getByText, getByRole } = render(
      <ActivityAuditView
        projectState={makeState({
          recentActivity: [makeEntry('e1', 'session:start', {}, 1001)],
        })}
        now={FIXED_NOW}
      />,
    );

    // Apply a filter that hides everything
    const typeInput = container.querySelector(
      'input[aria-label="Search event type"]',
    ) as HTMLInputElement;
    fireEvent.change(typeInput, { target: { value: 'nonexistent:event:xyz' } });
    expect(getByText('No activity matches the current filters.')).toBeDefined();

    // Click reset
    const resetButton = getByRole('button', { name: /reset filters/i });
    fireEvent.click(resetButton);

    // Event should be back
    expect(getByText('session:start')).toBeDefined();
  });
});
