import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import * as React from 'react';
import { RunHistoryCard } from '../run-history-card';
import type { NowRecentRunItem } from '@/lib/selectors/now';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeRun(id: string, overrides: Partial<NowRecentRunItem> = {}): NowRecentRunItem {
  return {
    id,
    sessionId: `sess-${id}`,
    planSet: `Plan ${id}`,
    command: 'build',
    status: 'completed',
    startedAt: new Date(Date.now() - 10_000).toISOString(),
    durationMs: 5_000,
    ...overrides,
  };
}

function makeRuns(count: number): NowRecentRunItem[] {
  return Array.from({ length: count }, (_, i) => makeRun(`run-${i}`));
}

// ---------------------------------------------------------------------------
// Default view — at most 4 rows
// ---------------------------------------------------------------------------

describe('RunHistoryCard - default view', () => {
  it('renders "Run history" heading', () => {
    render(<RunHistoryCard runs={makeRuns(2)} />);
    expect(screen.getByText('Run history')).toBeDefined();
  });

  it('renders "No recent runs" when runs is empty', () => {
    render(<RunHistoryCard runs={[]} />);
    expect(screen.getByText('No recent runs')).toBeDefined();
  });

  it('renders at most 4 rows by default when there are more than 4 runs', () => {
    const runs = makeRuns(8);
    render(<RunHistoryCard runs={runs} />);
    // 4 plan labels should be visible
    const planLabels = screen.getAllByText(/Plan run-\d/);
    expect(planLabels.length).toBe(4);
  });

  it('renders all rows when there are 4 or fewer', () => {
    const runs = makeRuns(3);
    render(<RunHistoryCard runs={runs} />);
    const planLabels = screen.getAllByText(/Plan run-\d/);
    expect(planLabels.length).toBe(3);
  });

  it('renders "Show all ▼" button when more than 4 runs', () => {
    render(<RunHistoryCard runs={makeRuns(5)} />);
    expect(screen.getByText('Show all ▼')).toBeDefined();
  });

  it('does not render "Show all ▼" button when 4 or fewer runs', () => {
    render(<RunHistoryCard runs={makeRuns(4)} />);
    expect(screen.queryByText('Show all ▼')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Expanded view
// ---------------------------------------------------------------------------

describe('RunHistoryCard - expanded view', () => {
  it('shows all runs and filter bar after clicking "Show all ▼"', () => {
    const runs = makeRuns(6);
    render(<RunHistoryCard runs={runs} />);

    const showAllBtn = screen.getByText('Show all ▼');
    fireEvent.click(showAllBtn);

    // All 6 plan labels should be visible
    const planLabels = screen.getAllByText(/Plan run-\d/);
    expect(planLabels.length).toBe(6);

    // Filter bar should be present with status, command, and search
    // Status chips (use getAllByText for 'completed' since run rows also show status badges)
    expect(screen.getByText('all')).toBeDefined();
    expect(screen.getByText('running')).toBeDefined();
    expect(screen.getByText('failed')).toBeDefined();
    expect(screen.getAllByText('completed').length).toBeGreaterThanOrEqual(1);

    // Search input
    expect(screen.getByRole('textbox', { name: /search/i })).toBeDefined();
  });

  it('collapses back to 4 rows after clicking "Hide ▲"', () => {
    const runs = makeRuns(6);
    render(<RunHistoryCard runs={runs} />);

    // Expand
    fireEvent.click(screen.getByText('Show all ▼'));
    // All 6 visible
    expect(screen.getAllByText(/Plan run-\d/).length).toBe(6);

    // Collapse
    fireEvent.click(screen.getByText('Hide ▲'));
    expect(screen.getAllByText(/Plan run-\d/).length).toBe(4);
  });

  it('filters runs by search text', () => {
    const runs = [
      makeRun('alpha', { planSet: 'Alpha Feature', sessionId: 'sess-alpha' }),
      makeRun('beta', { planSet: 'Beta Feature', sessionId: 'sess-beta' }),
      makeRun('gamma', { planSet: 'Gamma Feature', sessionId: 'sess-gamma' }),
      makeRun('delta', { planSet: 'Delta Feature', sessionId: 'sess-delta' }),
      makeRun('epsilon', { planSet: 'Epsilon Feature', sessionId: 'sess-epsilon' }),
    ];
    render(<RunHistoryCard runs={runs} />);

    // Expand
    fireEvent.click(screen.getByText('Show all ▼'));

    // Search for 'alpha'
    const searchInput = screen.getByRole('textbox', { name: /search/i });
    fireEvent.change(searchInput, { target: { value: 'alpha' } });

    expect(screen.getByText('Alpha Feature')).toBeDefined();
    expect(screen.queryByText('Beta Feature')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Row click navigation
// ---------------------------------------------------------------------------

describe('RunHistoryCard - row click navigation', () => {
  it('calls onNavigate with the correct path when a run row is clicked', () => {
    const handleNavigate = vi.fn();
    const run = makeRun('nav-test', { sessionId: 'sess-nav' });
    render(<RunHistoryCard runs={[run]} onNavigate={handleNavigate} />);

    const row = screen.getByText('Plan nav-test').closest('[role="button"]');
    expect(row).toBeDefined();
    fireEvent.click(row!);

    expect(handleNavigate).toHaveBeenCalledWith('/console/runs/sess-nav');
  });

  it('falls back to run id when sessionId is undefined', () => {
    const handleNavigate = vi.fn();
    const run = makeRun('no-sess', { sessionId: undefined });
    render(<RunHistoryCard runs={[run]} onNavigate={handleNavigate} />);

    const row = screen.getByText('Plan no-sess').closest('[role="button"]');
    fireEvent.click(row!);

    expect(handleNavigate).toHaveBeenCalledWith('/console/runs/no-sess');
  });
});
