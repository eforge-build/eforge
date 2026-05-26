import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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

  it('shows the session id in the history row', () => {
    const runs: RunInfo[] = [
      makeRun({
        id: 'r1',
        sessionId: 'my-session-id',
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
    expect(getByText(/session:my-session-id/)).toBeTruthy();
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
    // Panel is rendered for both desktop and mobile, so at least one match is expected
    const matches = getAllByText(/Select a run to inspect details/i);
    expect(matches.length).toBeGreaterThan(0);
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
      // Panel is rendered twice (desktop + mobile), so use getAllByText
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
      // Panel renders twice, so check for at least one match
      const errors = getAllByText(/Failed to load plans/i);
      expect(errors.length).toBeGreaterThan(0);
    });

    // Summary section should still be visible (also appears twice)
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
