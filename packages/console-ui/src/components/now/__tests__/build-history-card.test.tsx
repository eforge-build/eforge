import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import * as React from 'react';
import { BuildHistoryCard } from '../build-history-card';
import type { NowBuildItem } from '@/lib/selectors/now';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeBuild(id: string, overrides: Partial<NowBuildItem> = {}): NowBuildItem {
  return {
    id,
    sessionId: `sess-${id}`,
    planSet: `Plan ${id}`,
    status: 'completed',
    phase: null,
    startedAt: new Date(Date.now() - 10_000).toISOString(),
    durationMs: 5_000,
    ...overrides,
  };
}

function makeBuilds(count: number): NowBuildItem[] {
  return Array.from({ length: count }, (_, i) => makeBuild(`build-${i}`));
}

/** The full build-history drawer is a Sheet (role="dialog"). */
function openDrawer(): HTMLElement {
  fireEvent.click(screen.getByText('Open full build history →'));
  return screen.getByRole('dialog');
}

// ---------------------------------------------------------------------------
// Preview card
// ---------------------------------------------------------------------------

describe('BuildHistoryCard - preview', () => {
  it('renders "Build history" heading', () => {
    render(<BuildHistoryCard builds={makeBuilds(2)} />);
    expect(screen.getByText('Build history')).toBeDefined();
  });

  it('renders "No recent builds" when builds is empty', () => {
    render(<BuildHistoryCard builds={[]} />);
    expect(screen.getByText('No recent builds')).toBeDefined();
  });

  it('renders at most 4 preview rows when there are more than 4 builds', () => {
    render(<BuildHistoryCard builds={makeBuilds(8)} />);
    expect(screen.getAllByText(/Plan build-\d/).length).toBe(4);
  });

  it('renders all rows when there are 4 or fewer', () => {
    render(<BuildHistoryCard builds={makeBuilds(3)} />);
    expect(screen.getAllByText(/Plan build-\d/).length).toBe(3);
  });

  it('renders an "Open full build history →" button when there are builds', () => {
    render(<BuildHistoryCard builds={makeBuilds(2)} />);
    expect(screen.getByText('Open full build history →')).toBeDefined();
  });

  it('does not render the open button when there are no builds', () => {
    render(<BuildHistoryCard builds={[]} />);
    expect(screen.queryByText('Open full build history →')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Status + phase line
// ---------------------------------------------------------------------------

describe('BuildHistoryCard - status line', () => {
  it('shows the current phase as a gerund for a running build', () => {
    render(<BuildHistoryCard builds={[makeBuild('b', { status: 'running', phase: 'build' })]} />);
    expect(screen.getByText('running')).toBeDefined();
    expect(screen.getByText('building')).toBeDefined();
  });

  it('shows the failed phase for a failed build', () => {
    render(<BuildHistoryCard builds={[makeBuild('b', { status: 'failed', phase: 'compile' })]} />);
    expect(screen.getByText('failed')).toBeDefined();
    expect(screen.getByText('compile')).toBeDefined();
  });

  it('shows no phase qualifier for a completed build', () => {
    render(<BuildHistoryCard builds={[makeBuild('b', { status: 'completed', phase: null })]} />);
    expect(screen.getByText('completed')).toBeDefined();
    // No phase gerund/noun should appear on a settled build.
    expect(screen.queryByText('building')).toBeNull();
    expect(screen.queryByText('compiling')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Full drawer
// ---------------------------------------------------------------------------

describe('BuildHistoryCard - full drawer', () => {
  it('shows all builds and a filter bar after opening the drawer', () => {
    render(<BuildHistoryCard builds={makeBuilds(6)} />);

    const dialog = openDrawer();

    expect(within(dialog).getAllByText(/Plan build-\d/).length).toBe(6);
    expect(within(dialog).getByText('all')).toBeDefined();
    expect(within(dialog).getByText('running')).toBeDefined();
    expect(within(dialog).getByText('failed')).toBeDefined();
    expect(within(dialog).getByRole('textbox', { name: /search/i })).toBeDefined();
  });

  it('filters builds by search text', () => {
    const builds = [
      makeBuild('alpha', { planSet: 'Alpha Feature', sessionId: 'sess-alpha' }),
      makeBuild('beta', { planSet: 'Beta Feature', sessionId: 'sess-beta' }),
      makeBuild('gamma', { planSet: 'Gamma Feature', sessionId: 'sess-gamma' }),
    ];
    render(<BuildHistoryCard builds={builds} />);

    const dialog = openDrawer();
    const searchInput = within(dialog).getByRole('textbox', { name: /search/i });
    fireEvent.change(searchInput, { target: { value: 'alpha' } });

    expect(within(dialog).getByText('Alpha Feature')).toBeDefined();
    expect(within(dialog).queryByText('Beta Feature')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Row click navigation
// ---------------------------------------------------------------------------

describe('BuildHistoryCard - row click navigation', () => {
  it('calls onNavigate with the build detail path when a preview row is clicked', () => {
    const handleNavigate = vi.fn();
    const build = makeBuild('nav-test', { sessionId: 'sess-nav' });
    render(<BuildHistoryCard builds={[build]} onNavigate={handleNavigate} />);

    const row = screen.getByText('Plan nav-test').closest('[role="button"]');
    expect(row).toBeDefined();
    fireEvent.click(row!);

    expect(handleNavigate).toHaveBeenCalledWith('/console/builds/sess-nav');
  });

  it('falls back to build id when sessionId is undefined', () => {
    const handleNavigate = vi.fn();
    const build = makeBuild('no-sess', { sessionId: undefined });
    render(<BuildHistoryCard builds={[build]} onNavigate={handleNavigate} />);

    const row = screen.getByText('Plan no-sess').closest('[role="button"]');
    fireEvent.click(row!);

    expect(handleNavigate).toHaveBeenCalledWith('/console/builds/no-sess');
  });
});
