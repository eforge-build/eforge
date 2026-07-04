import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import * as React from 'react';
import { QueueCard } from '../queue-card';
import type { QueueCascadeApplyResponse, QueueCascadePreviewResponse } from '@eforge-build/client/browser';
import type { NowEnqueueCard, NowQueueSummary } from '@/lib/selectors/now';
import { makeQueueCapabilities } from '@/test-support/factories';
import { openQueueRowMenu as openRowMenu } from '@/test-support/radix';

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

function makeEnqueueCard(overrides: Partial<NowEnqueueCard> = {}): NowEnqueueCard {
  return {
    sessionId: 'sess-intake',
    runId: 'run-intake',
    title: 'Preparing Build PRD',
    durationMs: 12_000,
    streamStatus: 'connected',
    step: 'Formatting PRD & extracting acceptance criteria',
    latestError: null,
    tokens: 8_900,
    cost: 0.17,
    ...overrides,
  };
}

describe('QueueCard - intake lane', () => {
  it('renders the Intake lane with no queued work and still shows the card', () => {
    render(<QueueCard summary={emptySummary} enqueueCards={[makeEnqueueCard()]} />);
    expect(screen.getByText('Queue')).toBeDefined();
    expect(screen.getByText('Intake')).toBeDefined();
    expect(screen.getByText('Preparing Build PRD')).toBeDefined();
    expect(screen.getByText('Formatting PRD & extracting acceptance criteria')).toBeDefined();
  });
});

describe('QueueCard - empty queue', () => {
  it('renders nothing when there is no intake, stack, or queued work', () => {
    const { container } = render(<QueueCard summary={emptySummary} />);
    // The PipelineChips carries the zero-state counts; an empty card is noise.
    expect(container.firstChild).toBeNull();
    expect(screen.queryByText('Queue')).toBeNull();
  });
});

describe('QueueCard - populated queue', () => {
  it('renders Queue card heading with pending and waiting forward rows', () => {
    const summary = makeSummary({
      total: 2,
      pendingCount: 1,
      waitingCount: 1,
      topItems: [
        { id: 'q-1', title: 'Task A', status: 'waiting', priority: undefined, created: undefined, dependsOn: undefined, recoveryVerdict: undefined },
        { id: 'q-2', title: 'Task B', status: 'pending', priority: undefined, created: undefined, dependsOn: undefined, recoveryVerdict: undefined },
      ],
    });
    render(<QueueCard summary={summary} />);
    expect(screen.getByText('Queue')).toBeDefined();
    expect(screen.getByText('Task A')).toBeDefined();
    expect(screen.getByText('Task B')).toBeDefined();
  });

  it('omits running rows — running appears as active build cards, not queue preview', () => {
    // Even if a running row leaks into topItems, the forward-only component
    // contract filters it out so the queue preview shows pending/waiting only.
    const summary = makeSummary({
      total: 1,
      pendingCount: 1,
      runningCount: 1,
      topItems: [
        { id: 'q-r', title: 'Running Task', status: 'running', priority: undefined, created: undefined, dependsOn: undefined, recoveryVerdict: undefined },
        { id: 'q-p', title: 'Pending Task', status: 'pending', priority: undefined, created: undefined, dependsOn: undefined, recoveryVerdict: undefined },
      ],
    });
    render(<QueueCard summary={summary} />);
    expect(screen.getByText('Pending Task')).toBeDefined();
    expect(screen.queryByText('Running Task')).toBeNull();
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
// Row actions — overflow menu on forward queue rows
// ---------------------------------------------------------------------------

describe('QueueCard - loose row actions', () => {
  function pendingSummary(status: 'pending' | 'waiting', title = 'Forward Task'): NowQueueSummary {
    return makeSummary({
      total: 1,
      pendingCount: status === 'pending' ? 1 : 0,
      waitingCount: status === 'waiting' ? 1 : 0,
      topItems: [
        { id: 'q-1', title, status, priority: undefined, created: undefined, dependsOn: undefined, recoveryVerdict: undefined, capabilities: makeQueueCapabilities() },
      ],
    });
  }

  function cascadePreview(): QueueCascadePreviewResponse {
    return {
      operation: 'remove',
      target: { prdId: 'q-1', title: 'Pending Task', status: 'pending', effect: 'remove', depth: 0, blockers: [] },
      dependents: [],
      expectedAffected: { prdIds: ['q-1'] },
      warnings: [],
      blockers: [],
    };
  }

  function cascadeApplied(): QueueCascadeApplyResponse {
    return { applied: true, operation: 'remove', strategy: 'target-only', affected: { prdIds: ['q-1'] }, warnings: [], blockers: [] };
  }

  it.each(['pending', 'waiting'] as const)('offers Set priority and Remove in the row menu for %s loose rows', async (status) => {
    const title = status === 'pending' ? 'Pending Task' : 'Waiting Task';
    render(<QueueCard summary={pendingSummary(status, title)} onSetPriority={vi.fn()} onPreviewCascade={vi.fn()} onApplyCascade={vi.fn()} />);
    openRowMenu(title);
    expect(await screen.findByRole('menuitem', { name: 'Set priority…' })).toBeDefined();
    expect(screen.getByRole('menuitem', { name: 'Remove…' })).toBeDefined();
  });

  it('excludes running rows from the loose list entirely (no row, no menu)', () => {
    const summary = makeSummary({
      total: 0,
      runningCount: 1,
      topItems: [
        { id: 'q-r', title: 'Running Task', status: 'running', priority: undefined, created: undefined, dependsOn: undefined, recoveryVerdict: undefined },
      ],
    });
    const { container } = render(
      <QueueCard summary={summary} onSetPriority={vi.fn()} onPreviewCascade={vi.fn()} onApplyCascade={vi.fn()} />,
    );
    // Running rows are not forward work; with no other work the card omits them
    // by rendering nothing at all.
    expect(screen.queryByText('Running Task')).toBeNull();
    expect(container.firstChild).toBeNull();
    expect(screen.queryByRole('button', { name: 'Queue actions for Running Task' })).toBeNull();
  });

  it('calls onSetPriority with the row id and the priority dialog value', async () => {
    const onSetPriority = vi.fn();
    render(<QueueCard summary={pendingSummary('pending', 'Pending Task')} onSetPriority={onSetPriority} />);
    openRowMenu('Pending Task');
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Set priority…' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Priority for Pending Task'), { target: { value: '5' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Set priority' }));
    await waitFor(() => expect(onSetPriority).toHaveBeenCalledWith('q-1', 5));
    // The dialog closes on success and the page stays interactive.
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('threads prioritySiblings from summary.allItems into the priority dialog landing preview', async () => {
    const items = [
      { id: 'q-a', title: 'Task A', status: 'pending', priority: 2, created: '2026-07-01T09:00:00.000Z', dependsOn: undefined, recoveryVerdict: undefined, capabilities: makeQueueCapabilities() },
      { id: 'q-b', title: 'Task B', status: 'pending', priority: 5, created: '2026-07-01T09:30:00.000Z', dependsOn: undefined, recoveryVerdict: undefined, capabilities: makeQueueCapabilities() },
      { id: 'q-c', title: 'Task C', status: 'pending', priority: undefined, created: '2026-07-01T10:00:00.000Z', dependsOn: undefined, recoveryVerdict: undefined, capabilities: makeQueueCapabilities() },
    ];
    const summary = makeSummary({ total: 3, pendingCount: 3, topItems: items, allItems: items });
    render(<QueueCard summary={summary} onSetPriority={vi.fn()} />);

    openRowMenu('Task C');
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Set priority…' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Priority for Task C'), { target: { value: '3' } });

    // Siblings came through the QueueCard → LooseQueueRow → QueueRowActions
    // chain: Task A (2), Task C (3), Task B (5) → #2 of 3.
    await waitFor(() => expect(dialog.textContent).toContain('Will run #2 of 3 queued items'));
  });

  it('previews and applies remove only after the cascade dialog confirm action', async () => {
    const onPreviewCascade = vi.fn().mockResolvedValue(cascadePreview());
    const onApplyCascade = vi.fn().mockResolvedValue(cascadeApplied());
    render(<QueueCard summary={pendingSummary('pending', 'Pending Task')} onPreviewCascade={onPreviewCascade} onApplyCascade={onApplyCascade} />);
    // Opening the confirmation dialog previews but does not mutate.
    openRowMenu('Pending Task');
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Remove…' }));
    expect(onApplyCascade).not.toHaveBeenCalled();
    await waitFor(() => expect(onPreviewCascade).toHaveBeenCalledWith('q-1', 'remove'));
    // Confirming inside the dialog runs the apply mutation.
    const dialog = screen.getByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(onApplyCascade).toHaveBeenCalledWith('q-1', expect.objectContaining({ operation: 'remove', strategy: 'target-only' })));
  });

  it('hides the row menu entirely when no callbacks are provided', () => {
    render(<QueueCard summary={pendingSummary('pending', 'Pending Task')} />);
    expect(screen.queryByRole('button', { name: 'Queue actions for Pending Task' })).toBeNull();
  });

  it('offers Override dependency in the menu for blocked rows when callback is supplied', async () => {
    const summary = makeSummary({
      total: 1,
      pendingCount: 1,
      withDependenciesCount: 1,
      topItems: [
        { id: 'q-1', title: 'Blocked Task', status: 'pending', priority: undefined, created: undefined, dependsOn: ['q-prev'], recoveryVerdict: undefined, capabilities: makeQueueCapabilities() },
      ],
    });
    const { container } = render(<QueueCard summary={summary} onOverrideDependency={vi.fn()} />);

    expect(container.textContent).toContain('blocked by Q Prev');
    openRowMenu('Blocked Task');
    expect(await screen.findByRole('menuitem', { name: 'Override dependency…' })).toBeDefined();
  });

  it.each(['pending', 'waiting'] as const)('does not render a menu for dependency-free %s rows with only the override callback', (status) => {
    render(<QueueCard summary={pendingSummary(status, 'Forward Task')} onOverrideDependency={vi.fn()} />);
    // Override is the only callback and there are no dependencies, so there is
    // no action to offer and the kebab itself is omitted.
    expect(screen.queryByRole('button', { name: 'Queue actions for Forward Task' })).toBeNull();
  });

  it('confirms Override dependency with the selected dependency id and optional reason', async () => {
    const onOverrideDependency = vi.fn();
    const summary = makeSummary({
      total: 1,
      waitingCount: 1,
      withDependenciesCount: 1,
      topItems: [
        { id: 'q-1', title: 'Blocked Task', status: 'waiting', priority: undefined, created: undefined, dependsOn: ['dep-a', 'dep-b'], recoveryVerdict: undefined, capabilities: makeQueueCapabilities() },
      ],
    });
    render(<QueueCard summary={summary} onOverrideDependency={onOverrideDependency} />);

    openRowMenu('Blocked Task');
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Override dependency…' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog.textContent).toContain('bypasses queue dependency ordering');
    expect(dialog.textContent).toContain('pre-PR merge/reconciliation must handle overlap');
    expect(onOverrideDependency).not.toHaveBeenCalled();
    const dependencySelect = within(dialog).getByLabelText('Dependency to override for Blocked Task') as HTMLSelectElement;
    const confirmButton = within(dialog).getByRole('button', { name: 'Override dependency' }) as HTMLButtonElement;
    expect(dependencySelect.value).toBe('');
    expect(confirmButton.disabled).toBe(true);
    fireEvent.change(dependencySelect, {
      target: { value: 'dep-b' },
    });
    fireEvent.change(within(dialog).getByLabelText('Reason for overriding Blocked Task'), {
      target: { value: 'manual overlap review complete' },
    });
    fireEvent.click(confirmButton);

    await waitFor(() => expect(onOverrideDependency).toHaveBeenCalledTimes(1));
    expect(onOverrideDependency).toHaveBeenCalledWith('q-1', 'dep-b', 'manual overlap review complete');
  });

  it('disables the priority dialog while the set-priority promise is pending, then closes on resolve', async () => {
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
        onPreviewCascade={vi.fn()}
        onApplyCascade={vi.fn()}
      />,
    );
    openRowMenu('Pending Task');
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Set priority…' }));
    const dialog = await screen.findByRole('dialog');
    const input = within(dialog).getByLabelText('Priority for Pending Task') as HTMLInputElement;
    fireEvent.change(input, { target: { value: '4' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Set priority' }));

    // While the mutation is in flight the dialog controls are disabled.
    await waitFor(() => expect((within(dialog).getByRole('button', { name: 'Saving…' }) as HTMLButtonElement).disabled).toBe(true));
    expect(input.disabled).toBe(true);

    // Resolving the mutation closes the dialog.
    resolveSet();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(onSetPriority).toHaveBeenCalledWith('q-1', 4);
  });

  it('disables the dialog confirm/cancel while the cascade apply promise is pending, then closes on resolve', async () => {
    let resolveApply!: (value: QueueCascadeApplyResponse) => void;
    const onPreviewCascade = vi.fn().mockResolvedValue(cascadePreview());
    const onApplyCascade = vi.fn().mockReturnValue(
      new Promise<QueueCascadeApplyResponse>((resolve) => {
        resolveApply = resolve;
      }),
    );
    render(<QueueCard summary={pendingSummary('pending', 'Pending Task')} onPreviewCascade={onPreviewCascade} onApplyCascade={onApplyCascade} />);

    openRowMenu('Pending Task');
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Remove…' }));
    const dialog = await screen.findByRole('alertdialog');
    await waitFor(() => expect(onPreviewCascade).toHaveBeenCalled());
    const confirm = within(dialog).getByRole('button', { name: 'Remove' }) as HTMLButtonElement;
    fireEvent.click(confirm);

    // The dialog stays mounted and both actions are disabled during the mutation.
    await waitFor(() => expect(confirm.disabled).toBe(true));
    expect((within(dialog).getByRole('button', { name: 'Cancel' }) as HTMLButtonElement).disabled).toBe(true);

    // On success the component closes the dialog itself.
    resolveApply(cascadeApplied());
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(onApplyCascade).toHaveBeenCalledWith('q-1', expect.objectContaining({ operation: 'remove' }));
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
