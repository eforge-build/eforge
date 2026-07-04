/**
 * Shared Radix interaction helpers for Vitest tests.
 *
 * Not part of the app bundle — nothing under src reachable from main.tsx
 * imports this module, so Vite tree-shakes it out of production builds.
 */
import { fireEvent, screen } from '@testing-library/react';

/** Opens a per-row ⋯ queue-actions menu (Radix opens on pointerdown, so fire both). */
export function openQueueRowMenu(title: string): HTMLElement {
  const trigger = screen.getByRole('button', { name: `Queue actions for ${title}` });
  fireEvent.pointerDown(trigger, { pointerType: 'mouse' });
  fireEvent.click(trigger);
  return trigger;
}
