import * as React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Drawer } from './drawer';

function renderDrawer(onClose = vi.fn()) {
  render(
    <Drawer ariaLabel="Details for thing" title="Thing" closeLabel="Close details" onClose={onClose}>
      <button type="button">Inside action</button>
    </Drawer>,
  );
  return onClose;
}

describe('Drawer', () => {
  it('renders a labelled modal dialog with its content', () => {
    renderDrawer();
    const dialog = screen.getByRole('dialog', { name: 'Details for thing' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(screen.getByText('Inside action')).toBeTruthy();
  });

  it('closes on the close button, Escape, and a backdrop click', () => {
    const onClose = renderDrawer();

    fireEvent.click(screen.getByLabelText('Close details'));
    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);

    // The scrim is the aria-hidden sibling of the dialog panel.
    const scrim = document.querySelector('[aria-hidden="true"]');
    expect(scrim).toBeTruthy();
    fireEvent.click(scrim!);
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it('moves focus into the panel on open and restores it to the trigger on close', () => {
    const trigger = document.createElement('button');
    document.body.append(trigger);
    trigger.focus();
    expect(document.activeElement).toBe(trigger);

    const { unmount } = render(
      <Drawer ariaLabel="Details" title="Thing" onClose={vi.fn()}>
        <button type="button">Inside</button>
      </Drawer>,
    );
    expect(document.activeElement).toBe(screen.getByRole('dialog'));

    unmount();
    expect(document.activeElement).toBe(trigger);
    trigger.remove();
  });

  it('keeps Tab focus within the panel (wraps last → first)', () => {
    render(
      <Drawer ariaLabel="Details" title="Thing" closeLabel="Close" onClose={vi.fn()}>
        <button type="button">Inside action</button>
      </Drawer>,
    );
    const dialog = screen.getByRole('dialog');
    const focusables = dialog.querySelectorAll<HTMLElement>('button');
    const first = focusables[0];
    const last = focusables[focusables.length - 1];

    last.focus();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(document.activeElement).toBe(first);

    first.focus();
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it('locks and restores background scroll', () => {
    expect(document.body.style.overflow).toBe('');
    const { unmount } = render(<Drawer ariaLabel="Details" title="Thing" onClose={vi.fn()}><span>body</span></Drawer>);
    expect(document.body.style.overflow).toBe('hidden');
    unmount();
    expect(document.body.style.overflow).toBe('');
  });
});
