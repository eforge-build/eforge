import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import * as React from 'react';
import { QueuePriorityDialog, type PrioritySibling } from '../queue-priority-dialog';

const SIBLINGS: PrioritySibling[] = [
  { id: 'self', title: 'Self Task', priority: undefined, created: '2026-07-01T10:00:00.000Z' },
  { id: 'a', title: 'Task A', priority: 2, created: '2026-07-01T09:00:00.000Z' },
  { id: 'b', title: 'Task B', priority: 5, created: '2026-07-01T09:30:00.000Z' },
  { id: 'c', title: 'Task C', priority: undefined, created: '2026-07-01T08:00:00.000Z' },
];

function renderDialog(overrides: Partial<React.ComponentProps<typeof QueuePriorityDialog>> = {}) {
  const onSetPriority = vi.fn().mockResolvedValue(undefined);
  const onOpenChange = vi.fn();
  render(
    <QueuePriorityDialog
      open
      onOpenChange={onOpenChange}
      itemId="self"
      itemTitle="Self Task"
      siblings={SIBLINGS}
      onSetPriority={onSetPriority}
      {...overrides}
    />,
  );
  return { onSetPriority, onOpenChange };
}

describe('QueuePriorityDialog', () => {
  it('explains priority semantics and shows the no-priority state', () => {
    renderDialog();
    const dialog = screen.getByRole('dialog');
    expect(dialog.textContent).toContain('Lower numbers run first');
    expect(dialog.textContent).toContain('cannot jump an item ahead of its unmet dependencies');
    expect(dialog.textContent).toContain('no priority — runs after prioritized items');
  });

  it('shows the current priority when set', () => {
    renderDialog({ currentPriority: 5 });
    expect(screen.getByRole('dialog').textContent).toContain('current priority 5');
    expect((screen.getByLabelText('Priority for Self Task') as HTMLInputElement).value).toBe('5');
  });

  it('Front computes min sibling priority - 1 and Back computes max + 1', () => {
    renderDialog();
    const input = screen.getByLabelText('Priority for Self Task') as HTMLInputElement;
    fireEvent.click(screen.getByRole('button', { name: 'Front' }));
    expect(input.value).toBe('1'); // min(2, 5) - 1
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(input.value).toBe('6'); // max(2, 5) + 1
  });

  it('falls back to Front=0 and hides Back when no sibling has a priority', () => {
    renderDialog({
      siblings: [
        { id: 'self', title: 'Self Task', priority: undefined, created: undefined },
        { id: 'x', title: 'Task X', priority: undefined, created: undefined },
      ],
    });
    const input = screen.getByLabelText('Priority for Self Task') as HTMLInputElement;
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Front' }));
    expect(input.value).toBe('0');
  });

  it('previews the landing position among siblings', () => {
    renderDialog();
    fireEvent.change(screen.getByLabelText('Priority for Self Task'), { target: { value: '3' } });
    // Order: Task A (2), self (3), Task B (5), Task C (no priority).
    expect(screen.getByRole('dialog').textContent).toContain('Will run #2 of 4 queued items');
  });

  it('disables confirm for non-integer input', () => {
    renderDialog();
    const confirm = screen.getByRole('button', { name: 'Set priority' }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true); // empty input
    fireEvent.change(screen.getByLabelText('Priority for Self Task'), { target: { value: '2.5' } });
    expect(confirm.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText('Priority for Self Task'), { target: { value: '-3' } });
    expect(confirm.disabled).toBe(false); // negatives are valid
  });

  it('submits the parsed integer and closes on success', async () => {
    const { onSetPriority, onOpenChange } = renderDialog();
    fireEvent.change(screen.getByLabelText('Priority for Self Task'), { target: { value: '7' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set priority' }));
    await waitFor(() => expect(onSetPriority).toHaveBeenCalledWith('self', 7));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it('keeps the dialog open and shows the error when the callback rejects', async () => {
    const onSetPriority = vi.fn().mockRejectedValue(new Error('daemon offline'));
    const { onOpenChange } = renderDialog({ onSetPriority });
    fireEvent.change(screen.getByLabelText('Priority for Self Task'), { target: { value: '7' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set priority' }));
    await waitFor(() => expect(within(screen.getByRole('dialog')).getByRole('alert').textContent).toContain('daemon offline'));
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
