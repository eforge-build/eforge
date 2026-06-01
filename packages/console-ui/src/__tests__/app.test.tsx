/**
 * app.test.tsx — Routing behavior of the App component.
 *
 * Verifies that the App responds to native `popstate` events by updating the
 * rendered route, and that in-app navigation followed by a back navigation
 * returns to the Now dashboard.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as React from 'react';
import { render, screen, act } from '@testing-library/react';
import { App } from '@/app';

// ---------------------------------------------------------------------------
// Module mocks — must appear before any imports that transitively load them
// ---------------------------------------------------------------------------

// Prevent SSE/network calls from useDaemonEvents
vi.mock('@/hooks/use-daemon-events', async () => {
  const { initialConsoleProjectState } = await import('@/lib/project-state');
  return {
    useDaemonEvents: () => ({
      projectState: {
        ...initialConsoleProjectState,
        connectionStatus: 'connected' as const,
        lastSnapshotAt: Date.now(),
      },
      connectionStatus: 'connected' as const,
      refreshQueue: vi.fn(),
      setDaemonAutoBuild: vi.fn(),
    }),
  };
});

// Prevent session SSE subscriptions
vi.mock('@/hooks/use-active-session-streams', () => ({
  useActiveSessionStreams: () => ({
    sessions: {},
    activeSessionIds: [],
    subscriptionCount: 0,
  }),
}));

// Prevent HTTP calls from useHybridRunDetail inside RunDetailView
vi.mock('@/lib/fetch-json', () => ({
  fetchJson: vi.fn().mockResolvedValue(null),
}));

// Stub complex pipeline sub-components that have deep deps not needed here
vi.mock('@/components/pipeline/thread-pipeline', () => ({
  ThreadPipeline: () => <div data-testid="thread-pipeline" />,
}));
vi.mock('@/components/timeline/timeline', () => ({
  Timeline: () => <div data-testid="timeline" />,
}));

// Mock the Plans route so it resolves synchronously without network calls
vi.mock('@/views/plans', () => ({
  PlansView: () => <div data-testid="plans-view">Planning Workspace</div>,
}));

// ---------------------------------------------------------------------------
// jsdom compatibility
// ---------------------------------------------------------------------------

// ResizeObserver is not implemented in jsdom
global.ResizeObserver = vi.fn().mockImplementation(function (this: {
  observe: () => void;
  unobserve: () => void;
  disconnect: () => void;
}) {
  this.observe = vi.fn();
  this.unobserve = vi.fn();
  this.disconnect = vi.fn();
});

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

// Suppress replaceState calls from ActivityDrawer URL sync
let replaceStateSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  replaceStateSpy = vi.spyOn(window.history, 'replaceState').mockImplementation(() => {});
});
afterEach(() => {
  replaceStateSpy.mockRestore();
});

// ---------------------------------------------------------------------------
// Stable route markers
// ---------------------------------------------------------------------------

/**
 * Text that is always present when NowDashboard is mounted.
 * QueueCard renders "Queue is empty" when queue is empty (our mock state).
 */
const NOW_MARKER = 'Queue is empty';

/**
 * Text present while RunDetailView's lazy module is still resolving
 * (the Suspense fallback in App).
 */
const RUN_DETAIL_SUSPENSE_MARKER = 'Loading...';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('App — popstate routing', () => {
  it('initial render at /console/runs/:id shows run-detail fallback, not NowDashboard', () => {
    window.history.pushState(null, '', '/console/runs/abc123');
    render(<App />);

    // Suspense fallback should be visible before the lazy component resolves
    expect(screen.getByText(RUN_DETAIL_SUSPENSE_MARKER)).toBeDefined();
    // NowDashboard must not be present on this route
    expect(screen.queryByText(NOW_MARKER)).toBeNull();
  });

  it('initial render at /console/plans mounts the Plans route, not NowDashboard', async () => {
    window.history.pushState(null, '', '/console/plans');
    render(<App />);

    // NowDashboard must not be present on the plans route
    expect(screen.queryByText(NOW_MARKER)).toBeNull();
    // Allow the lazy mock to resolve
    await act(async () => {});
    expect(screen.getByTestId('plans-view')).toBeDefined();
  });

  it('unknown routes render the Now dashboard', () => {
    window.history.pushState(null, '', '/console/not-a-route');
    render(<App />);
    expect(screen.getByText(NOW_MARKER)).toBeDefined();
  });

  it('switches from run-detail to now-dashboard when popstate fires with /console/ pathname', async () => {
    window.history.pushState(null, '', '/console/runs/abc123');
    render(<App />);

    // Confirm we are not on Now before the navigation
    expect(screen.queryByText(NOW_MARKER)).toBeNull();

    // Simulate browser back: update the URL then fire popstate
    await act(async () => {
      window.history.pushState(null, '', '/console/');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });

    // NowDashboard should now be rendered
    expect(screen.getByText(NOW_MARKER)).toBeDefined();
  });

  it('returns to now-dashboard after forward navigation + popstate back', async () => {
    window.history.pushState(null, '', '/console/');
    render(<App />);

    // Starting at /console/ — NowDashboard should be visible
    expect(screen.getByText(NOW_MARKER)).toBeDefined();

    // Simulate in-app forward navigation (pushState + popstate mimics the
    // handleNavigate path as far as the popstate listener is concerned)
    await act(async () => {
      window.history.pushState(null, '', '/console/runs/abc123');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });

    // NowDashboard should no longer be visible
    expect(screen.queryByText(NOW_MARKER)).toBeNull();

    // Simulate browser back
    await act(async () => {
      window.history.pushState(null, '', '/console/');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });

    // NowDashboard should be restored
    expect(screen.getByText(NOW_MARKER)).toBeDefined();
  });
});
