import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import * as React from 'react';
import { QueueRowActions } from '../queue-row-actions';
import { makeQueueCapabilities } from '@/test-support/factories';
import { openQueueRowMenu } from '@/test-support/radix';

function openMenu(title = 'PRD One'): HTMLElement {
  return openQueueRowMenu(title);
}

describe('QueueRowActions - menu composition', () => {
  it('renders nothing when no callbacks are provided', () => {
    const { container } = render(<QueueRowActions itemId="prd-1" itemTitle="PRD One" />);
    expect(container.firstChild).toBeNull();
  });

  it('shows Cancel PRD instead of Remove for running rows (showCancel)', async () => {
    render(
      <QueueRowActions
        itemId="prd-1"
        itemTitle="PRD One"
        showCancel
        capabilities={makeQueueCapabilities()}
        onPreviewCascade={vi.fn()}
        onApplyCascade={vi.fn()}
      />,
    );
    openMenu();
    expect(await screen.findByRole('menuitem', { name: 'Cancel PRD…' })).toBeDefined();
    expect(screen.queryByRole('menuitem', { name: 'Remove…' })).toBeNull();
  });

  it('labels the hold action Release hold… when the item is held', async () => {
    render(
      <QueueRowActions
        itemId="prd-1"
        itemTitle="PRD One"
        hold={{ held: true }}
        capabilities={makeQueueCapabilities()}
        onHold={vi.fn()}
        onUnhold={vi.fn()}
      />,
    );
    openMenu();
    expect(await screen.findByRole('menuitem', { name: /Release hold…/ })).toBeDefined();
  });

  it('disables denied actions and renders the capability reason inside the menu item', async () => {
    render(
      <QueueRowActions
        itemId="prd-1"
        itemTitle="PRD One"
        capabilities={makeQueueCapabilities({ priority: { allowed: false, reason: 'Already running' } })}
        onSetPriority={vi.fn()}
        onHold={vi.fn()}
      />,
    );
    openMenu();
    const priorityItem = await screen.findByRole('menuitem', { name: /Set priority…/ });
    expect(priorityItem.getAttribute('aria-disabled')).toBe('true');
    expect(within(priorityItem).getByText('Already running')).toBeDefined();
    // The allowed hold action stays enabled.
    expect(screen.getByRole('menuitem', { name: 'Hold…' }).getAttribute('aria-disabled')).toBeNull();
  });

  it('omits Override dependency when the row has no dependencies', async () => {
    render(
      <QueueRowActions
        itemId="prd-1"
        itemTitle="PRD One"
        dependencyIds={[]}
        capabilities={makeQueueCapabilities()}
        onSetPriority={vi.fn()}
        onOverrideDependency={vi.fn()}
      />,
    );
    openMenu();
    await screen.findByRole('menuitem', { name: 'Set priority…' });
    expect(screen.queryByRole('menuitem', { name: 'Override dependency…' })).toBeNull();
  });
});

describe('QueueRowActions - menu→dialog interplay', () => {
  it('keeps the dialog mounted after the menu closes and the page interactive (regression)', async () => {
    render(
      <QueueRowActions
        itemId="prd-1"
        itemTitle="PRD One"
        capabilities={makeQueueCapabilities()}
        onSetPriority={vi.fn()}
      />,
    );
    openMenu();
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Set priority…' }));

    // The menu is closed, the dialog is open and stays mounted.
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toBeDefined();

    // The dialog remains interactive: closing it via Cancel works.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    // Radix must not leave the body pointer-inert once everything has closed —
    // this is the stuck pointer-events:none regression the controlled
    // menu + preventDefault pattern guards against.
    await waitFor(() => expect(document.body.style.pointerEvents).not.toBe('none'));

    // And the trigger can immediately open the menu again.
    openMenu();
    expect(await screen.findByRole('menuitem', { name: 'Set priority…' })).toBeDefined();
  });

  it('confirms the legacy plain Remove path (no cascade callbacks) and surfaces errors', async () => {
    const onRemove = vi.fn().mockRejectedValueOnce(new Error('daemon offline')).mockResolvedValueOnce(undefined);
    render(
      <QueueRowActions
        itemId="prd-1"
        itemTitle="PRD One"
        capabilities={makeQueueCapabilities()}
        onRemove={onRemove}
      />,
    );
    openMenu();
    const removeItem = await screen.findByRole('menuitem', { name: 'Remove…' });
    // With no non-destructive items above it, the destructive section renders
    // without a leading separator.
    expect(within(screen.getByRole('menu')).queryByRole('separator')).toBeNull();
    fireEvent.click(removeItem);
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog.textContent).toContain('Remove PRD One (prd-1) from the queue?');

    // First confirm rejects: the dialog stays open and renders the error.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(within(dialog).getByRole('alert').textContent).toContain('daemon offline'));
    expect(screen.getByRole('alertdialog')).toBeDefined();

    // Second confirm resolves: the dialog closes.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(onRemove).toHaveBeenCalledTimes(2);
    expect(onRemove).toHaveBeenCalledWith('prd-1');
  });

  it('does not leak a failure message from one inline dialog into another (regression)', async () => {
    const onRemove = vi.fn().mockRejectedValue(new Error('remove failed'));
    render(
      <QueueRowActions
        itemId="prd-1"
        itemTitle="PRD One"
        dependencyIds={['dep-a']}
        capabilities={makeQueueCapabilities()}
        onRemove={onRemove}
        onOverrideDependency={vi.fn()}
      />,
    );

    // Fail the Remove confirm so the shared error state is populated.
    openMenu();
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Remove…' }));
    const removeDialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(removeDialog).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(within(removeDialog).getByRole('alert').textContent).toContain('remove failed'));
    fireEvent.click(within(removeDialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());

    // Opening the Override dependency dialog must start clean.
    openMenu();
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Override dependency…' }));
    const overrideDialog = await screen.findByRole('alertdialog');
    expect(overrideDialog.textContent).toContain('Override queue dependency?');
    expect(within(overrideDialog).queryByRole('alert')).toBeNull();
  });

  it('routes the hold menu item to the hold dialog and confirms', async () => {
    const onHold = vi.fn().mockResolvedValue(undefined);
    render(
      <QueueRowActions
        itemId="prd-1"
        itemTitle="PRD One"
        capabilities={makeQueueCapabilities()}
        onHold={onHold}
      />,
    );
    openMenu();
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Hold…' }));
    const dialog = await screen.findByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Hold' }));
    await waitFor(() => expect(onHold).toHaveBeenCalledWith('prd-1', undefined));
  });
});
