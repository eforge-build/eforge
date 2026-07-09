import * as React from 'react';
import { buildNavItems } from '@/lib/navigation';

interface ControlSurfaceLinksProps {
  /** In-app navigation handler for Console route links. */
  onNavigate?: (href: string) => void;
}

/**
 * Top-level Console navigation links rendered in the header control surface.
 * Renders nav buttons from buildNavItems().
 */
export function ControlSurfaceLinks({ onNavigate }: ControlSurfaceLinksProps) {
  const navItems = buildNavItems();
  return (
    <div className="flex items-center gap-2" title="Session-plan status source: canonical eforge-plan SQLite records; monitor events and event-tail output are derived diagnostics.">
      {navItems.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => onNavigate?.(item.href)}
          aria-label={item.label}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
