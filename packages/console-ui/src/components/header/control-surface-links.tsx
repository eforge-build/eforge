import * as React from 'react';
import { buildNavItems } from '@/lib/navigation';

interface ControlSurfaceLinksProps {
  /** In-app navigation handler for Console route links. */
  onNavigate?: (href: string) => void;
}

/**
 * Top-level Console navigation links rendered in the header control surface.
 * Renders Now, Plans, and System nav buttons.
 */
export function ControlSurfaceLinks({ onNavigate }: ControlSurfaceLinksProps) {
  const navItems = buildNavItems();
  return (
    <div className="flex items-center gap-2">
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
