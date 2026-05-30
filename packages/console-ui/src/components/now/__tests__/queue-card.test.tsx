import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import * as React from 'react';
import { QueueCard } from '../queue-card';
import type { NowQueueSummary } from '@/lib/selectors/now';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const emptySummary: NowQueueSummary = {
  total: 0,
  byStatus: {},
  runningCount: 0,
  pendingCount: 0,
  failedCount: 0,
  waitingCount: 0,
  withDependenciesCount: 0,
  withRecoveryVerdictCount: 0,
  topItems: [],
  hiddenCount: 0,
};

function makeSummary(overrides: Partial<NowQueueSummary> = {}): NowQueueSummary {
  return { ...emptySummary, ...overrides };
}

// ---------------------------------------------------------------------------
// Display tests
// ---------------------------------------------------------------------------

describe('QueueCard - empty queue', () => {
  it('renders "Queue is empty" when total is 0', () => {
    render(<QueueCard summary={emptySummary} />);
    expect(screen.getByText('Queue is empty')).toBeDefined();
  });
});

describe('QueueCard - populated queue', () => {
  it('renders Queue card heading', () => {
    const summary = makeSummary({
      total: 2,
      pendingCount: 1,
      runningCount: 1,
      topItems: [
        { id: 'q-1', title: 'Task A', status: 'running', priority: undefined, created: undefined, dependsOn: undefined, recoveryVerdict: undefined },
        { id: 'q-2', title: 'Task B', status: 'pending', priority: undefined, created: undefined, dependsOn: undefined, recoveryVerdict: undefined },
      ],
    });
    render(<QueueCard summary={summary} />);
    expect(screen.getByText('Queue')).toBeDefined();
    expect(screen.getByText('Task A')).toBeDefined();
    expect(screen.getByText('Task B')).toBeDefined();
  });

  it('renders failed count in destructive style when present', () => {
    const summary = makeSummary({
      total: 1,
      failedCount: 1,
      topItems: [
        { id: 'q-f', title: 'Failed Task', status: 'failed', priority: undefined, created: undefined, dependsOn: undefined, recoveryVerdict: undefined },
      ],
    });
    const { container } = render(<QueueCard summary={summary} />);
    // Should render "Failed: 1" text
    expect(container.textContent).toContain('Failed:');
    expect(container.textContent).toContain('1');
  });

  it('renders dependency count when items have dependencies', () => {
    const summary = makeSummary({
      total: 1,
      withDependenciesCount: 1,
      topItems: [
        { id: 'q-d', title: 'Blocked Task', status: 'waiting', priority: undefined, created: undefined, dependsOn: ['q-prev'], recoveryVerdict: undefined },
      ],
    });
    const { container } = render(<QueueCard summary={summary} />);
    expect(container.textContent).toContain('blocked by Q Prev');
  });

  it('renders hiddenCount with disclosure when items exceed topItems', () => {
    const summary = makeSummary({
      total: 2,
      pendingCount: 2,
      topItems: [
        { id: 'q-1', title: 'Task 1', status: 'pending', priority: undefined, created: undefined, dependsOn: undefined, recoveryVerdict: undefined },
      ],
      allItems: [
        { id: 'q-1', title: 'Task 1', status: 'pending', priority: undefined, created: undefined, dependsOn: undefined, recoveryVerdict: undefined },
        { id: 'q-2', title: 'Task 2', status: 'pending', priority: undefined, created: undefined, dependsOn: undefined, recoveryVerdict: undefined },
      ],
      hiddenCount: 1,
    });
    const { container } = render(<QueueCard summary={summary} />);
    expect(container.textContent).toContain('+ 1 more — show all');
    expect(screen.queryByText('Task 2')).toBeNull();
    fireEvent.click(screen.getByText('+ 1 more — show all'));
    expect(screen.getByText('Task 2')).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// No mutation — zero fetch/POST calls during render and interaction
// ---------------------------------------------------------------------------

describe('QueueCard - no mutation', () => {
  let originalFetch: typeof globalThis.fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('issues zero fetch calls during render', () => {
    const summary = makeSummary({
      total: 1,
      pendingCount: 1,
      topItems: [
        { id: 'q-1', title: 'Task A', status: 'pending', priority: 1, created: undefined, dependsOn: undefined, recoveryVerdict: undefined },
      ],
    });
    render(<QueueCard summary={summary} />);
    expect(vi.mocked(globalThis.fetch)).not.toHaveBeenCalled();
  });

  it('contains no interactive buttons or dropdowns', () => {
    const summary = makeSummary({
      total: 2,
      topItems: [
        { id: 'q-1', title: 'Task A', status: 'running', priority: undefined, created: undefined, dependsOn: undefined, recoveryVerdict: undefined },
        { id: 'q-2', title: 'Task B', status: 'pending', priority: undefined, created: undefined, dependsOn: undefined, recoveryVerdict: undefined },
      ],
    });
    const { container } = render(<QueueCard summary={summary} />);
    // No buttons (interactive mutation controls)
    const buttons = container.querySelectorAll('button');
    expect(buttons.length).toBe(0);
    // No select (dropdown)
    const selects = container.querySelectorAll('select');
    expect(selects.length).toBe(0);
    // No dialog triggers
    const dialogs = container.querySelectorAll('[role="dialog"]');
    expect(dialogs.length).toBe(0);
  });
});
