import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
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
  skippedCount: 0,
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
  it('renders the empty forward-queue message when total is 0', () => {
    render(<QueueCard summary={emptySummary} />);
    expect(screen.getByText('Nothing waiting to build')).toBeDefined();
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

  it('omits failed and skipped items — the queue is forward-only', () => {
    const summary = makeSummary({
      total: 3,
      pendingCount: 1,
      failedCount: 1,
      skippedCount: 1,
      topItems: [
        { id: 'q-ok', title: 'Pending Task', status: 'pending', priority: undefined, created: undefined, dependsOn: undefined, recoveryVerdict: undefined },
        { id: 'q-f', title: 'Failed Task', status: 'failed', priority: undefined, created: undefined, dependsOn: undefined, recoveryVerdict: undefined },
        { id: 'q-s', title: 'Skipped Task', status: 'skipped', priority: undefined, created: undefined, dependsOn: undefined, recoveryVerdict: undefined },
      ],
    });
    render(<QueueCard summary={summary} />);
    expect(screen.getByText('Pending Task')).toBeDefined();
    // Failed/skipped PRDs already ran; they live in the Needs attention strip.
    expect(screen.queryByText('Failed Task')).toBeNull();
    expect(screen.queryByText('Skipped Task')).toBeNull();
    expect(screen.queryByText('Recover…')).toBeNull();
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
// Row actions — set priority and confirmed remove on forward queue rows
// ---------------------------------------------------------------------------

describe('QueueCard - loose row actions', () => {
  function pendingSummary(status: 'pending' | 'waiting', title = 'Forward Task'): NowQueueSummary {
    return makeSummary({
      total: 1,
      pendingCount: status === 'pending' ? 1 : 0,
      waitingCount: status === 'waiting' ? 1 : 0,
      topItems: [
        { id: 'q-1', title, status, priority: undefined, created: undefined, dependsOn: undefined, recoveryVerdict: undefined },
      ],
    });
  }

  it('renders Set priority and Remove controls for pending loose rows', () => {
    render(<QueueCard summary={pendingSummary('pending', 'Pending Task')} onSetPriority={vi.fn()} onRemove={vi.fn()} />);
    expect(screen.getByLabelText('Priority for Pending Task')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Set priority' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Remove' })).toBeDefined();
  });

  it('renders Set priority and Remove controls for waiting loose rows', () => {
    render(<QueueCard summary={pendingSummary('waiting', 'Waiting Task')} onSetPriority={vi.fn()} onRemove={vi.fn()} />);
    expect(screen.getByLabelText('Priority for Waiting Task')).toBeDefined();
    expect(screen.getByRole('button', { name: 'Set priority' })).toBeDefined();
    expect(screen.getByRole('button', { name: 'Remove' })).toBeDefined();
  });

  it('renders no queue-control buttons for running loose rows', () => {
    const summary = makeSummary({
      total: 1,
      runningCount: 1,
      topItems: [
        { id: 'q-r', title: 'Running Task', status: 'running', priority: undefined, created: undefined, dependsOn: undefined, recoveryVerdict: undefined },
      ],
    });
    render(<QueueCard summary={summary} onSetPriority={vi.fn()} onRemove={vi.fn()} />);
    expect(screen.getByText('Running Task')).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Set priority' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull();
  });

  it('calls onSetPriority with the row id and the numeric input value', () => {
    const onSetPriority = vi.fn();
    render(<QueueCard summary={pendingSummary('pending', 'Pending Task')} onSetPriority={onSetPriority} />);
    fireEvent.change(screen.getByLabelText('Priority for Pending Task'), { target: { value: '5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set priority' }));
    expect(onSetPriority).toHaveBeenCalledWith('q-1', 5);
  });

  it('calls onRemove only after the AlertDialog confirm action', () => {
    const onRemove = vi.fn();
    render(<QueueCard summary={pendingSummary('pending', 'Pending Task')} onRemove={onRemove} />);
    // Opening the confirmation dialog must not mutate.
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(onRemove).not.toHaveBeenCalled();
    // Confirming inside the dialog runs the removal.
    const dialog = screen.getByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' }));
    expect(onRemove).toHaveBeenCalledWith('q-1');
  });

  it('hides actions entirely when no callbacks are provided', () => {
    render(<QueueCard summary={pendingSummary('pending', 'Pending Task')} />);
    expect(screen.queryByRole('button', { name: 'Set priority' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull();
  });

  it('disables the priority controls while the set-priority promise is pending, then re-enables', async () => {
    // Deferred callback so we can observe the pending window deterministically.
    let resolveSet!: () => void;
    const onSetPriority = vi.fn().mockReturnValue(
      new Promise<void>((resolve) => {
        resolveSet = resolve;
      }),
    );
    render(
      <QueueCard
        summary={pendingSummary('pending', 'Pending Task')}
        onSetPriority={onSetPriority}
        onRemove={vi.fn()}
      />,
    );
    const input = screen.getByLabelText('Priority for Pending Task') as HTMLInputElement;
    const setButton = screen.getByRole('button', { name: 'Set priority' }) as HTMLButtonElement;
    fireEvent.change(input, { target: { value: '4' } });
    fireEvent.click(setButton);

    // While the mutation is in flight every control is disabled.
    await waitFor(() => expect(setButton.disabled).toBe(true));
    expect(input.disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Remove' }) as HTMLButtonElement).disabled).toBe(true);

    // Resolving the mutation re-enables the controls.
    resolveSet();
    await waitFor(() => expect(setButton.disabled).toBe(false));
    expect(input.disabled).toBe(false);
  });

  it('disables the dialog confirm/cancel while the remove promise is pending, then closes on resolve', async () => {
    let resolveRemove!: () => void;
    const onRemove = vi.fn().mockReturnValue(
      new Promise<void>((resolve) => {
        resolveRemove = resolve;
      }),
    );
    render(<QueueCard summary={pendingSummary('pending', 'Pending Task')} onRemove={onRemove} />);

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    const dialog = screen.getByRole('alertdialog');
    const confirm = within(dialog).getByRole('button', { name: 'Remove' }) as HTMLButtonElement;
    fireEvent.click(confirm);

    // The dialog stays mounted and both actions are disabled during the mutation.
    await waitFor(() => expect(confirm.disabled).toBe(true));
    expect((within(dialog).getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled).toBe(true);

    // On success the component closes the dialog itself.
    resolveRemove();
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(onRemove).toHaveBeenCalledWith('q-1');
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

  it('expanding the loose list issues zero fetch calls', () => {
    const summary = makeSummary({
      total: 2,
      pendingCount: 2,
      topItems: [
        { id: 'q-1', title: 'Task A', status: 'pending', priority: undefined, created: undefined, dependsOn: undefined, recoveryVerdict: undefined },
      ],
      allItems: [
        { id: 'q-1', title: 'Task A', status: 'pending', priority: undefined, created: undefined, dependsOn: undefined, recoveryVerdict: undefined },
        { id: 'q-2', title: 'Task B', status: 'waiting', priority: undefined, created: undefined, dependsOn: undefined, recoveryVerdict: undefined },
      ],
      hiddenCount: 1,
    });
    render(<QueueCard summary={summary} />);
    fireEvent.click(screen.getByText('+ 1 more — show all'));
    expect(screen.getByText('Task B')).toBeDefined();
    expect(vi.mocked(globalThis.fetch)).not.toHaveBeenCalled();
  });
});
