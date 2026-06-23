import * as React from 'react';

// Shared registration stack so that when several Escape-closable surfaces are
// open at once (e.g. a board ItemDrawer and the activity-rail PlanningTaskDrawer),
// a single Escape press dismisses only the topmost (last-mounted) surface rather
// than collapsing the whole stack at once.
const escapeStack: Array<() => void> = [];

/**
 * Close a transient surface (drawer, panel, popover) when Escape is pressed.
 * Listens on `window` so it fires regardless of where focus currently sits.
 * Only the topmost registered surface responds to a given Escape press, so
 * stacked drawers/panels close one layer at a time.
 * `enabled` lets a caller arm/disarm the listener without changing hook order.
 */
export function useEscapeToClose(onClose: () => void, enabled = true): void {
  React.useEffect(() => {
    if (!enabled) return;
    const entry = () => onClose();
    escapeStack.push(entry);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      // Only the topmost surface reacts; ignore the keypress for the rest.
      if (escapeStack[escapeStack.length - 1] !== entry) return;
      event.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      const index = escapeStack.indexOf(entry);
      if (index !== -1) escapeStack.splice(index, 1);
    };
  }, [onClose, enabled]);
}
