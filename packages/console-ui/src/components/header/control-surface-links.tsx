import * as React from 'react';

interface ControlSurfaceLinksProps {
  /** Navigation handler — reserved for future control links. */
  onNavigate?: (href: string) => void;
}

/**
 * Slot for future control-surface navigation links in the header.
 * Currently renders a Monitor back-link only.
 */
export function ControlSurfaceLinks({ onNavigate: _ }: ControlSurfaceLinksProps) {
  return (
    <div className="flex items-center gap-2">
      <a
        href="/"
        className="text-xs text-muted-foreground hover:text-foreground transition-colors"
        aria-label="Go to Monitor"
      >
        ← Monitor
      </a>
    </div>
  );
}
