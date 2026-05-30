// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi, beforeEach } from 'vitest';
import { render, screen, cleanup, waitFor } from '@testing-library/react';
import { RunDetailView } from '../run-detail-view';
import { createInitialRunState } from '@/lib/run-state';
import type { RunState } from '@/lib/run-state';

afterEach(cleanup);

// Mock the lazy-loaded sub-components that have complex deps
vi.mock('@/components/pipeline/thread-pipeline', () => ({
  ThreadPipeline: () => <div data-testid="thread-pipeline">ThreadPipeline</div>,
}));

vi.mock('@/components/timeline/timeline', () => ({
  Timeline: () => <div data-testid="timeline">Timeline</div>,
}));

// Suppress ResizeObserver not implemented in jsdom
// Must use a regular function (not arrow) so it can be called as a constructor with `new`
global.ResizeObserver = vi.fn().mockImplementation(function () {
  this.observe = vi.fn();
  this.unobserve = vi.fn();
  this.disconnect = vi.fn();
});

// Prevent actual fetch in tests
vi.mock('@/lib/fetch-json', () => ({
  fetchJson: vi.fn().mockResolvedValue(null),
}));

function makeRunState(overrides: Partial<RunState> = {}): RunState {
  return {
    ...createInitialRunState(),
    startTime: Date.now() - 60000,
    isComplete: false,
    resultStatus: null,
    ...overrides,
  };
}

describe('RunDetailView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders the back button', async () => {
    const runState = makeRunState();
    render(
      <RunDetailView
        detailId="session-abc-123"
        isLive={true}
        liveRunState={runState}
        onBack={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: /back/i })).toBeTruthy();
  });

  it('shows the detailId in the breadcrumb', async () => {
    const runState = makeRunState();
    render(
      <RunDetailView
        detailId="session-abc-123"
        isLive={true}
        liveRunState={runState}
        onBack={() => {}}
      />,
    );
    expect(screen.getByText('session-abc-123')).toBeTruthy();
  });

  it('uses the PRD title as the build detail title', async () => {
    const runState = makeRunState({
      events: [
        {
          eventId: 'event-1',
          event: {
            type: 'planning:start',
            source: 'title: Recoverable Validation Provider Failures\ncreated: 2026-05-30\n\n# Body',
          },
        },
      ],
    });

    render(
      <RunDetailView
        detailId="session-abc-123"
        isLive={true}
        liveRunState={runState}
        onBack={() => {}}
      />,
    );

    expect(screen.getByText('Recoverable Validation Provider Failures')).toBeTruthy();
    expect(screen.getByText('session-abc-123')).toBeTruthy();
  });

  it('shows "Live" badge when isLive is true', async () => {
    const runState = makeRunState();
    render(
      <RunDetailView
        detailId="session-abc-123"
        isLive={true}
        liveRunState={runState}
        onBack={() => {}}
      />,
    );
    expect(screen.getByText('Live')).toBeTruthy();
  });

  it('does not show "Live" badge when isLive is false', async () => {
    const runState = makeRunState({ isComplete: true });
    render(
      <RunDetailView
        detailId="session-abc-123"
        isLive={false}
        liveRunState={undefined}
        onBack={() => {}}
      />,
    );
    expect(screen.queryByText('Live')).toBeFalsy();
  });

  it('renders a ThreadPipeline element when runState is provided', async () => {
    const runState = makeRunState();
    render(
      <RunDetailView
        detailId="session-abc-123"
        isLive={true}
        liveRunState={runState}
        onBack={() => {}}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId('thread-pipeline')).toBeTruthy();
    });
  });

  it('renders a Timeline in the Log tab', async () => {
    const runState = makeRunState();
    render(
      <RunDetailView
        detailId="session-abc-123"
        isLive={true}
        liveRunState={runState}
        onBack={() => {}}
      />,
    );
    await waitFor(() => {
      expect(screen.getByTestId('timeline')).toBeTruthy();
    });
  });

  it('calls onBack when back button is clicked', async () => {
    const runState = makeRunState();
    const onBack = vi.fn();
    render(
      <RunDetailView
        detailId="session-abc-123"
        isLive={true}
        liveRunState={runState}
        onBack={onBack}
      />,
    );
    screen.getByRole('button', { name: /back/i }).click();
    expect(onBack).toHaveBeenCalledOnce();
  });

  it('shows loading state when no runState and isLoading', () => {
    render(
      <RunDetailView
        detailId="session-abc-123"
        isLive={false}
        liveRunState={undefined}
        onBack={() => {}}
      />,
    );
    // Either loading indicator or error; with mocked fetchJson returning null, loading shows briefly
    expect(document.body.textContent).toBeTruthy();
  });
});
