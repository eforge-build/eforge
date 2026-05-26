import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { render, fireEvent, waitFor } from '@testing-library/react';
import { RunsView } from '@/views/runs/runs-view';
import type { ConsoleProjectState } from '@/lib/project-state';
import { initialConsoleProjectState } from '@/lib/project-state';
import type { UseActiveSessionStreamsResult } from '@/hooks/use-active-session-streams';
import type { RunInfo, RunSummary, RunState, PlansResponse } from '@eforge-build/client/browser';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRun(overrides: Partial<RunInfo> = {}): RunInfo {
  return {
    id: 'run-1',
    command: 'build',
    status: 'running',
    startedAt: '2024-01-01T10:00:00Z',
    cwd: '/project',
    planSet: 'my-plan-set',
    ...overrides,
  };
}

function makeState(overrides: Partial<ConsoleProjectState> = {}): ConsoleProjectState {
  return { ...initialConsoleProjectState, ...overrides };
}

function makeStreams(
  sessions: UseActiveSessionStreamsResult['sessions'] = {},
): UseActiveSessionStreamsResult {
  return {
    sessions,
    activeSessionIds: Object.keys(sessions),
    subscriptionCount: Object.keys(sessions).length,
  };
}

function makeActiveDetail(
  sessionId: string,
  overrides: Partial<UseActiveSessionStreamsResult['sessions'][string]> = {},
): UseActiveSessionStreamsResult['sessions'][string] {
  return {
    sessionId,
    connectionStatus: 'connected',
    status: 'running',
    snapshotEvents: [],
    liveEvents: [],
    liveEventCount: 0,
    lastEventAt: null,
    error: null,
    ...overrides,
  };
}

// Mock fetch to prevent real HTTP calls
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => null });
  vi.stubGlobal('fetch', fetchMock);
  // Reset URL state between tests to prevent contamination
  if (typeof window !== 'undefined') {
    window.history.replaceState(null, '', '/console/runs');
  }
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Connection states
// ---------------------------------------------------------------------------

describe('RunsView – connection states', () => {
  it('renders heading containing Runs', () => {
    const { getAllByText } = render(
      <RunsView
        projectState={makeState({ connectionStatus: 'connected', runs: [] })}
        activeSessionStreams={makeStreams()}
      />,
    );
    const headings = getAllByText('Runs');
    expect(headings.length).toBeGreaterThan(0);
  });

  it('renders route subtitle containing "build sessions"', () => {
    const { getByText } = render(
      <RunsView
        projectState={makeState({ connectionStatus: 'connected', runs: [] })}
        activeSessionStreams={makeStreams()}
      />,
    );
    expect(getByText(/build sessions/i)).toBeTruthy();
  });

  it('displays connecting state text when connectionStatus is connecting', () => {
    const { getByText } = render(
      <RunsView
        projectState={makeState({ connectionStatus: 'connecting' })}
        activeSessionStreams={makeStreams()}
      />,
    );
    expect(getByText(/Connecting to daemon stream/i)).toBeTruthy();
  });

  it('displays disconnected warning when connectionStatus is disconnected', () => {
    const { getByText } = render(
      <RunsView
        projectState={makeState({
          connectionStatus: 'disconnected',
          error: 'boom',
        })}
        activeSessionStreams={makeStreams()}
      />,
    );
    expect(getByText(/Disconnected from daemon stream/i)).toBeTruthy();
    expect(getByText('boom')).toBeTruthy();
  });

  it('displays empty state when connected and runs is empty', () => {
    const { getByText } = render(
      <RunsView
        projectState={makeState({ connectionStatus: 'connected', runs: [] })}
        activeSessionStreams={makeStreams()}
      />,
    );
    expect(
      getByText(/No runs recorded for this project daemon yet/i),
    ).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Active runs rendering
// ---------------------------------------------------------------------------

describe('RunsView – active runs', () => {
  it('renders two active cards for two running runs with distinct sessionIds', () => {
    const runs: RunInfo[] = [
      makeRun({ id: 'r1', sessionId: 'sess-a', status: 'running' }),
      makeRun({ id: 'r2', sessionId: 'sess-b', status: 'running' }),
    ];
    const sessions = {
      'sess-a': makeActiveDetail('sess-a'),
      'sess-b': makeActiveDetail('sess-b'),
    };
    const { container } = render(
      <RunsView
        projectState={makeState({ connectionStatus: 'connected', runs })}
        activeSessionStreams={makeStreams(sessions)}
      />,
    );
    // Both sessions have 'Inspect run' buttons
    const inspectButtons = container.querySelectorAll('button');
    const inspectRunButtons = Array.from(inspectButtons).filter(
      (b) => b.textContent === 'Inspect run',
    );
    expect(inspectRunButtons.length).toBeGreaterThanOrEqual(2);
  });

  it('displays active stream connection state for each session', () => {
    const runs: RunInfo[] = [
      makeRun({ id: 'r1', sessionId: 'sess-a', status: 'running' }),
    ];
    const sessions = {
      'sess-a': makeActiveDetail('sess-a', { connectionStatus: 'connected' }),
    };
    const { getByText } = render(
      <RunsView
        projectState={makeState({ connectionStatus: 'connected', runs })}
        activeSessionStreams={makeStreams(sessions)}
      />,
    );
    expect(getByText(/stream:connected/)).toBeTruthy();
  });

  it('displays sum of snapshotEvents and liveEvents counts', () => {
    const runs: RunInfo[] = [
      makeRun({ id: 'r1', sessionId: 'sess-a', status: 'running' }),
    ];
    const sessions = {
      'sess-a': makeActiveDetail('sess-a', {
        snapshotEvents: [{ id: 1, data: '{"type":"plan:queued"}' }, { id: 2, data: '{"type":"plan:status:change"}' }] as never,
        liveEvents: [{ type: 'daemon:heartbeat' }] as never,
        liveEventCount: 1,
      }),
    };
    const { getByText } = render(
      <RunsView
        projectState={makeState({ connectionStatus: 'connected', runs })}
        activeSessionStreams={makeStreams(sessions)}
      />,
    );
    // 2 snapshot + 1 live = 3 events
    expect(getByText(/3 events/)).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// History rendering
// ---------------------------------------------------------------------------

describe('RunsView – history section', () => {
  it('renders a completed run in the history section', () => {
    const runs: RunInfo[] = [
      makeRun({
        id: 'r1',
        sessionId: 'sess-done',
        status: 'completed',
        completedAt: '2024-01-01T11:00:00Z',
        command: 'build',
      }),
    ];
    const { getByText } = render(
      <RunsView
        projectState={makeState({ connectionStatus: 'connected', runs })}
        activeSessionStreams={makeStreams()}
      />,
    );
    expect(getByText(/Run history/i)).toBeTruthy();
    expect(getByText('Inspect run')).toBeTruthy();
  });

  it('shows the session id in the history row (not truncated when <= 12 chars)', () => {
    const runs: RunInfo[] = [
      makeRun({
        id: 'r1',
        sessionId: 'my-sess',
        status: 'completed',
        completedAt: '2024-01-01T11:00:00Z',
      }),
    ];
    const { getByText } = render(
      <RunsView
        projectState={makeState({ connectionStatus: 'connected', runs })}
        activeSessionStreams={makeStreams()}
      />,
    );
    expect(getByText(/session:my-sess/)).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Selection behaviour
// ---------------------------------------------------------------------------

describe('RunsView – selection', () => {
  it('updates window.location.search when Inspect run is clicked', async () => {
    const runs: RunInfo[] = [
      makeRun({
        id: 'r1',
        sessionId: 'sess-click',
        status: 'completed',
        completedAt: '2024-01-01T11:00:00Z',
      }),
    ];
    const pushStateSpy = vi.spyOn(window.history, 'pushState');

    const { getByText } = render(
      <RunsView
        projectState={makeState({ connectionStatus: 'connected', runs })}
        activeSessionStreams={makeStreams()}
      />,
    );

    fireEvent.click(getByText('Inspect run'));

    expect(pushStateSpy).toHaveBeenCalled();
    const url = pushStateSpy.mock.calls[0][2] as string;
    expect(url).toContain('session=sess-click');

    pushStateSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Detail panel
// ---------------------------------------------------------------------------

describe('RunsView – detail panel', () => {
  it('shows "Select a run" text when no selection exists', () => {
    const runs: RunInfo[] = [
      makeRun({
        id: 'r1',
        sessionId: 'sess-a',
        status: 'completed',
        completedAt: '2024-01-01T11:00:00Z',
      }),
    ];
    const { getAllByText } = render(
      <RunsView
        projectState={makeState({ connectionStatus: 'connected', runs })}
        activeSessionStreams={makeStreams()}
      />,
    );
    const matches = getAllByText(/Select a run to inspect details/i);
    expect(matches.length).toBeGreaterThan(0);
  });

  it('profile label appears in detail panel after selection, not in history row metadata', () => {
    const runs: RunInfo[] = [
      makeRun({
        id: 'r1',
        sessionId: 'sess-profile',
        status: 'completed',
        completedAt: '2024-01-01T11:00:00Z',
      }),
    ];
    const sessionMetadata = {
      'sess-profile': { planCount: 1, baseProfile: 'expedition' },
    };
    const { container, getByText } = render(
      <RunsView
        projectState={makeState({
          connectionStatus: 'connected',
          runs,
          sessionMetadata,
        })}
        activeSessionStreams={makeStreams()}
      />,
    );
    // Before selecting: 'profile:' must not appear in the row area (lowercase check)
    expect(container.textContent?.toLowerCase()).not.toContain('profile:');
    // Select the run to open the detail panel
    fireEvent.click(getByText('Inspect run'));
    // After selecting: the detail panel renders the profile label
    const panel = container.querySelector('[data-testid="run-detail-panel"]');
    expect(panel?.textContent).toContain('expedition');
  });

  it('renders summary data when the hook returns RunSummary success', async () => {
    const summary: RunSummary = {
      sessionId: 'sess-a',
      status: 'completed',
      runs: [],
      plans: [],
      currentPhase: 'review',
      currentAgent: null,
      eventCounts: { total: 10, errors: 0 },
      duration: { startedAt: '2024-01-01T10:00:00Z', completedAt: null, seconds: null },
    };
    const emptyState: RunState = { status: 'completed', events: [] };
    const emptyPlans: PlansResponse = [];

    fetchMock.mockImplementation((url: string) => {
      if ((url as string).includes('run-summary')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => summary,
        });
      }
      if ((url as string).includes('run-state')) {
        return Promise.resolve({ ok: true, status: 200, json: async () => emptyState });
      }
      if ((url as string).includes('/plans/')) {
        return Promise.resolve({ ok: true, status: 200, json: async () => emptyPlans });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => null,
      });
    });

    const runs: RunInfo[] = [
      makeRun({
        id: 'r1',
        sessionId: 'sess-a',
        status: 'completed',
        completedAt: '2024-01-01T11:00:00Z',
      }),
    ];

    const { getByText, getAllByText } = render(
      <RunsView
        projectState={makeState({ connectionStatus: 'connected', runs })}
        activeSessionStreams={makeStreams()}
      />,
    );

    fireEvent.click(getByText('Inspect run'));

    await waitFor(() => {
      const phases = getAllByText(/Phase:/i);
      expect(phases.length).toBeGreaterThan(0);
    });
  });

  it('renders section-level error when plans fails and summary succeeds', async () => {
    const summary: RunSummary = {
      sessionId: 'sess-a',
      status: 'completed',
      runs: [],
      plans: [],
      currentPhase: null,
      currentAgent: null,
      eventCounts: { total: 0, errors: 0 },
      duration: { startedAt: null, completedAt: null, seconds: null },
    };

    fetchMock.mockImplementation((url: string) => {
      if ((url as string).includes('run-summary')) {
        return Promise.resolve({ ok: true, status: 200, json: async () => summary });
      }
      if ((url as string).includes('run-state')) {
        const state: RunState = { status: 'completed', events: [] };
        return Promise.resolve({ ok: true, status: 200, json: async () => state });
      }
      if ((url as string).includes('/plans/')) {
        return Promise.resolve({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
          json: async () => null,
        });
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => null });
    });

    const runs: RunInfo[] = [
      makeRun({
        id: 'r1',
        sessionId: 'sess-a',
        status: 'completed',
        completedAt: '2024-01-01T11:00:00Z',
      }),
    ];

    const { getByText, getAllByText } = render(
      <RunsView
        projectState={makeState({ connectionStatus: 'connected', runs })}
        activeSessionStreams={makeStreams()}
      />,
    );

    fireEvent.click(getByText('Inspect run'));

    await waitFor(() => {
      const errors = getAllByText(/Failed to load plans/i);
      expect(errors.length).toBeGreaterThan(0);
    });

    const summaries = getAllByText(/^Summary$/i);
    expect(summaries.length).toBeGreaterThan(0);
  });

  it('shows "No persisted detail for this run id" for null-returning resources', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 404,
      statusText: 'Not Found',
      json: async () => null,
    });

    const runs: RunInfo[] = [
      makeRun({
        id: 'r1',
        sessionId: 'sess-404',
        status: 'completed',
        completedAt: '2024-01-01T11:00:00Z',
      }),
    ];

    const { getByText, getAllByText } = render(
      <RunsView
        projectState={makeState({ connectionStatus: 'connected', runs })}
        activeSessionStreams={makeStreams()}
      />,
    );

    fireEvent.click(getByText('Inspect run'));

    await waitFor(() => {
      const msgs = getAllByText(/No persisted detail for this run id/i);
      expect(msgs.length).toBeGreaterThan(0);
    });
  });
});

// ---------------------------------------------------------------------------
// Forbidden text guard
// ---------------------------------------------------------------------------

describe('RunsView – forbidden labels', () => {
  it('does not render Overseer, multi-project, stack sync, queue reorder, or priority edit', () => {
    const runs: RunInfo[] = [
      makeRun({ id: 'r1', sessionId: 'sess-a', status: 'running' }),
    ];
    const { container } = render(
      <RunsView
        projectState={makeState({ connectionStatus: 'connected', runs })}
        activeSessionStreams={makeStreams({ 'sess-a': makeActiveDetail('sess-a') })}
      />,
    );
    const text = container.textContent ?? '';
    expect(text).not.toMatch(/overseer/i);
    expect(text).not.toMatch(/multi-project/i);
    expect(text).not.toMatch(/stack sync/i);
    expect(text).not.toMatch(/queue reorder/i);
    expect(text).not.toMatch(/priority edit/i);
  });
});

// ---------------------------------------------------------------------------
// Filter bar
// ---------------------------------------------------------------------------

describe('RunsView – filter bar', () => {
  function renderWithRuns() {
    const runs: RunInfo[] = [
      makeRun({ id: 'r1', sessionId: 'sess-a', status: 'running' }),
    ];
    return render(
      <RunsView
        projectState={makeState({ connectionStatus: 'connected', runs })}
        activeSessionStreams={makeStreams({ 'sess-a': makeActiveDetail('sess-a') })}
      />,
    );
  }

  it('renders status chips labeled all, running, failed, and completed', () => {
    const { getAllByRole } = renderWithRuns();
    // Status and Command sections both have 'all', so use getAllByRole
    const buttonNames = getAllByRole('button').map((b) => b.textContent?.trim());
    // Status chips
    expect(buttonNames).toContain('running');
    expect(buttonNames).toContain('failed');
    expect(buttonNames).toContain('completed');
    // 'all' appears twice (status + command)
    expect(buttonNames.filter((n) => n === 'all').length).toBeGreaterThanOrEqual(2);
  });

  it('renders command chips labeled all, enqueue, compile, and build', () => {
    const { getAllByRole } = renderWithRuns();
    const buttons = getAllByRole('button').map((b) => b.textContent?.trim());
    expect(buttons).toContain('enqueue');
    expect(buttons).toContain('compile');
    expect(buttons).toContain('build');
  });

  it('renders one text input with an accessible name indicating run search', () => {
    const { getAllByRole } = renderWithRuns();
    const inputs = getAllByRole('textbox', { name: /search runs/i });
    expect(inputs).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// Filter bar interactions
// ---------------------------------------------------------------------------

describe('RunsView – filter bar interactions', () => {
  it('clicking the enqueue command chip filters history to only enqueue groups', () => {
    const runs: RunInfo[] = [
      makeRun({
        id: 'r1',
        sessionId: 'sess-enq',
        command: 'enqueue',
        planSet: undefined,
        status: 'completed',
        completedAt: '2024-01-01T11:00:00Z',
      }),
      makeRun({
        id: 'r2',
        sessionId: 'sess-bld',
        command: 'build',
        planSet: undefined,
        status: 'completed',
        completedAt: '2024-01-01T10:00:00Z',
      }),
    ];
    const { getByRole, getAllByText, queryByText } = render(
      <RunsView
        projectState={makeState({ connectionStatus: 'connected', runs })}
        activeSessionStreams={makeStreams()}
      />,
    );
    expect(getAllByText('Inspect run')).toHaveLength(2);
    fireEvent.click(getByRole('button', { name: 'enqueue' }));
    expect(getAllByText('Inspect run')).toHaveLength(1);
    // The build session row is no longer visible
    expect(queryByText(/session:sess-bld/)).toBeNull();
  });

  it('typing in the Search runs input filters history rows by label', () => {
    // Session IDs must NOT contain the search query so the test verifies label matching,
    // not session-id matching.
    const runs: RunInfo[] = [
      makeRun({
        id: 'r1',
        sessionId: 'sess-001',
        command: 'build',
        planSet: 'alpha-feature',
        status: 'completed',
        completedAt: '2024-01-01T11:00:00Z',
      }),
      makeRun({
        id: 'r2',
        sessionId: 'sess-002',
        command: 'build',
        planSet: 'beta-feature',
        status: 'completed',
        completedAt: '2024-01-01T10:00:00Z',
      }),
    ];
    const { getByRole, getAllByText, getByText, queryByText } = render(
      <RunsView
        projectState={makeState({ connectionStatus: 'connected', runs })}
        activeSessionStreams={makeStreams()}
      />,
    );
    expect(getAllByText('Inspect run')).toHaveLength(2);
    const searchInput = getByRole('textbox', { name: /search runs/i });
    fireEvent.change(searchInput, { target: { value: 'alpha' } });
    // Only the alpha-feature group remains — assert label visibility, not just count
    expect(getAllByText('Inspect run')).toHaveLength(1);
    expect(getByText('Alpha Feature')).toBeTruthy();
    expect(queryByText('Beta Feature')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Day grouping
// ---------------------------------------------------------------------------

describe('RunsView – day grouping', () => {
  it('groups two current-day completed runs under a Today header', () => {
    // Use local-time constructors so calendar-day comparisons in bucketRunGroupsByDay
    // (which uses getDate/getMonth/getFullYear) are stable in any test timezone.
    const now = new Date(2024, 5, 10, 12); // local Jun 10, noon
    const runs: RunInfo[] = [
      makeRun({
        id: 'r1',
        sessionId: 'sess-today-1',
        status: 'completed',
        completedAt: new Date(2024, 5, 10, 11).toISOString(),
        startedAt: new Date(2024, 5, 10, 10).toISOString(),
      }),
      makeRun({
        id: 'r2',
        sessionId: 'sess-today-2',
        status: 'completed',
        completedAt: new Date(2024, 5, 10, 9).toISOString(),
        startedAt: new Date(2024, 5, 10, 8).toISOString(),
      }),
    ];
    const { getByText } = render(
      <RunsView
        projectState={makeState({ connectionStatus: 'connected', runs })}
        activeSessionStreams={makeStreams()}
        now={now}
      />,
    );
    // The h3 renders with text 'Today' (CSS uppercase is visual, not DOM text)
    const todayHeader = getByText('Today');
    expect(todayHeader).toBeTruthy();
    // Both current-day runs must be rendered under the Today group container
    const todayContainer = todayHeader.closest('div');
    const inspectButtons = Array.from(todayContainer!.querySelectorAll('button')).filter(
      (b) => b.textContent === 'Inspect run',
    );
    expect(inspectButtons).toHaveLength(2);
  });

  it('renders Yesterday and Older headers when fixtures include those timestamps', () => {
    // Use local-time constructors so calendar-day comparisons are stable in any timezone.
    const now = new Date(2024, 5, 10, 12); // local Jun 10, noon
    const runs: RunInfo[] = [
      makeRun({
        id: 'r1',
        sessionId: 'sess-yesterday',
        status: 'completed',
        completedAt: new Date(2024, 5, 9, 11).toISOString(),
        startedAt: new Date(2024, 5, 9, 10).toISOString(),
      }),
      makeRun({
        id: 'r2',
        sessionId: 'sess-older',
        status: 'completed',
        completedAt: new Date(2024, 5, 1, 11).toISOString(),
        startedAt: new Date(2024, 5, 1, 10).toISOString(),
      }),
    ];
    const { getByText } = render(
      <RunsView
        projectState={makeState({ connectionStatus: 'connected', runs })}
        activeSessionStreams={makeStreams()}
        now={now}
      />,
    );
    // The h3 elements render 'Yesterday' and 'Older' (CSS uppercase is visual only)
    expect(getByText('Yesterday')).toBeTruthy();
    expect(getByText('Older')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Filtering behaviour
// ---------------------------------------------------------------------------

describe('RunsView – filtering', () => {
  it('selecting the failed chip filters history to only failed groups', () => {
    const runs: RunInfo[] = [
      makeRun({
        id: 'r1',
        sessionId: 'sess-done',
        planSet: undefined,
        status: 'completed',
        completedAt: '2024-01-01T11:00:00Z',
      }),
      makeRun({
        id: 'r2',
        sessionId: 'sess-fail',
        planSet: undefined,
        status: 'failed',
        completedAt: '2024-01-01T10:00:00Z',
      }),
    ];
    const { getByRole, getByText, getAllByText, container } = render(
      <RunsView
        projectState={makeState({ connectionStatus: 'connected', runs })}
        activeSessionStreams={makeStreams()}
      />,
    );

    // Both groups are in history; both 'Inspect run' buttons are visible
    expect(getByText(/Run history/i)).toBeTruthy();
    expect(getAllByText('Inspect run')).toHaveLength(2);

    // Click the 'failed' status chip
    fireEvent.click(getByRole('button', { name: 'failed' }));

    // After filtering, only the failed group remains — one 'Inspect run' button
    expect(getAllByText('Inspect run')).toHaveLength(1);
    // The failed session row is visible and the completed session row is absent
    expect(container.textContent).toContain('session:sess-fail');
    expect(container.textContent).not.toContain('session:sess-done');
  });
});

// ---------------------------------------------------------------------------
// Row content – cwd / project chip / session id truncation
// ---------------------------------------------------------------------------

describe('RunsView – row content', () => {
  it('runs history rows do not render the project cwd string on every row', () => {
    const runs: RunInfo[] = [
      makeRun({
        id: 'r1',
        sessionId: 'sess-a',
        status: 'completed',
        completedAt: '2024-01-01T11:00:00Z',
        cwd: '/home/user/my-project',
      }),
    ];
    const { container } = render(
      <RunsView
        projectState={makeState({ connectionStatus: 'connected', runs })}
        activeSessionStreams={makeStreams()}
      />,
    );
    // The full cwd path should not appear in the history row
    const rowArea = container.querySelector('section');
    expect(rowArea?.textContent).not.toContain('/home/user/my-project');
  });

  it('renders one project chip using basename(cwd) in the header', () => {
    const runs: RunInfo[] = [
      makeRun({
        id: 'r1',
        sessionId: 'sess-a',
        status: 'completed',
        completedAt: '2024-01-01T11:00:00Z',
        cwd: '/home/user/my-project',
      }),
    ];
    const { getAllByText } = render(
      <RunsView
        projectState={makeState({ connectionStatus: 'connected', runs })}
        activeSessionStreams={makeStreams()}
      />,
    );
    // basename is 'my-project'; should appear exactly once (in header chip)
    const chips = getAllByText('my-project');
    expect(chips.length).toBe(1);
  });

  it('active session rows do not render the full project cwd', () => {
    const runs: RunInfo[] = [
      makeRun({
        id: 'r1',
        sessionId: 'sess-active',
        status: 'running',
        cwd: '/home/user/distinct-project',
      }),
    ];
    const { container } = render(
      <RunsView
        projectState={makeState({ connectionStatus: 'connected', runs })}
        activeSessionStreams={makeStreams({ 'sess-active': makeActiveDetail('sess-active') })}
      />,
    );
    // The Active builds section must not contain the full cwd path
    const activeSection = container.querySelector('section');
    expect(activeSection?.textContent).not.toContain('/home/user/distinct-project');
    // The project chip in the header uses the basename
    expect(container.textContent).toContain('distinct-project');
    // But the full absolute path must not appear anywhere
    expect(container.textContent).not.toContain('/home/user/distinct-project');
  });

  it('session id in history row is truncated to at most 12 characters', () => {
    const longSessionId = 'session-id-that-is-longer-than-12-chars';
    const expectedToken = longSessionId.slice(0, 12); // 'session-id-t'
    const runs: RunInfo[] = [
      makeRun({
        id: 'r1',
        sessionId: longSessionId,
        planSet: undefined,
        status: 'completed',
        completedAt: '2024-01-01T11:00:00Z',
      }),
    ];
    const { container } = render(
      <RunsView
        projectState={makeState({ connectionStatus: 'connected', runs })}
        activeSessionStreams={makeStreams()}
      />,
    );
    // Extract the displayed session token from the rendered text.
    // Use [-a-z0-9_]+ to match only identifier chars (stops before uppercase "Inspect" button text).
    const match = (container.textContent ?? '').match(/session:([-a-z0-9_]+)/);
    expect(match).not.toBeNull();
    const displayedToken = match![1];
    // Displayed token must exactly equal the first 12 characters
    expect(displayedToken).toBe(expectedToken);
    // Displayed token length must not exceed 12
    expect(displayedToken.length).toBeLessThanOrEqual(12);
    // The untruncated full id must not appear
    expect(container.textContent).not.toContain(`session:${longSessionId}`);
  });
});

// ---------------------------------------------------------------------------
// Layout – no p-4, one detail panel, h1 not in Card
// ---------------------------------------------------------------------------

describe('RunsView – layout', () => {
  function renderConnectedWithRun() {
    const runs: RunInfo[] = [
      makeRun({
        id: 'r1',
        sessionId: 'sess-a',
        status: 'completed',
        completedAt: '2024-01-01T11:00:00Z',
      }),
    ];
    return render(
      <RunsView
        projectState={makeState({ connectionStatus: 'connected', runs })}
        activeSessionStreams={makeStreams()}
      />,
    );
  }

  it('top-level container className does not include p-4', () => {
    const { container } = renderConnectedWithRun();
    const topLevel = container.firstElementChild as HTMLElement | null;
    // Split by spaces to get individual class names, avoiding substring matches
    // (e.g. 'gap-4' would falsely match '.includes("p-4")')
    const classes = (topLevel?.className ?? '').split(' ');
    expect(classes).not.toContain('p-4');
  });

  it('rendered DOM contains exactly one RunDetailPanel instance', () => {
    const { container } = renderConnectedWithRun();
    const panels = container.querySelectorAll('[data-testid="run-detail-panel"]');
    expect(panels).toHaveLength(1);
  });

  it('Runs h1 is not wrapped in a shadcn Card element', () => {
    const { getByRole } = renderConnectedWithRun();
    const h1 = getByRole('heading', { level: 1, name: /runs/i });
    // shadcn Card elements always include the bg-card utility class;
    // the h1 must not be a descendant of any such element.
    expect(h1.closest('.bg-card')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Source guards
// ---------------------------------------------------------------------------

describe('RunsView – source guards', () => {
  it('active-runs-panel.tsx contains no legacy tailwind status palette classes', () => {
    const source = readFileSync(
      resolve(__dirname, '../views/runs/active-runs-panel.tsx'),
      'utf-8',
    );
    expect(source).not.toContain('bg-green-100');
    expect(source).not.toContain('bg-red-100');
    expect(source).not.toContain('bg-yellow-100');
  });
});
