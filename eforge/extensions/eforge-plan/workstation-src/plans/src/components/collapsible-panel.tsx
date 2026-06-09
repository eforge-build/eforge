import * as React from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

interface CollapsiblePanelProps {
  /** localStorage key persisting the expanded state across reloads. */
  storageKey: string;
  defaultOpen?: boolean;
  className?: string;
  icon?: React.ReactNode;
  title: string;
  /** Always-visible status chips rendered next to the title. */
  summary?: React.ReactNode;
  /** Right-aligned controls; clicks here do not toggle the panel. */
  actions?: React.ReactNode;
  children: React.ReactNode;
}

function readStoredOpen(key: string, fallback: boolean): boolean {
  try {
    const raw = window.localStorage.getItem(key);
    return raw === null ? fallback : raw === 'true';
  } catch {
    return fallback;
  }
}

/**
 * Collapsible section with a one-line summary header. Built on details/summary
 * so collapsed content stays in the DOM. Meta panels default to collapsed -
 * the kanban board is the primary work surface - and the user's choice is
 * remembered per panel.
 */
export function CollapsiblePanel({ storageKey, defaultOpen = false, className, icon, title, summary, actions, children }: CollapsiblePanelProps) {
  const [open, setOpen] = React.useState(() => readStoredOpen(storageKey, defaultOpen));

  const toggle = (event: React.MouseEvent) => {
    event.preventDefault();
    setOpen((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(storageKey, String(next));
      } catch {
        // Persistence is best-effort; embedded webviews may deny storage.
      }
      return next;
    });
  };

  return (
    <details open={open} className={cn('rounded-lg border p-3', className)}>
      <summary onClick={toggle} className="flex cursor-pointer flex-wrap items-center gap-2 [&::-webkit-details-marker]:hidden" style={{ listStyle: 'none' }}>
        <ChevronRight className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${open ? 'rotate-90' : ''}`} />
        {icon}
        <h3 className="text-sm font-semibold text-text-bright">{title}</h3>
        {summary}
        {actions && (
          <span
            className="ml-auto flex items-center gap-2"
            onClick={(event) => {
              // preventDefault stops the browser's native details toggle (for
              // clicks on non-interactive children the summary is still the
              // activation target); stopPropagation keeps the React toggle
              // handler from firing. Both are needed to keep the DOM open
              // attribute in sync with React state.
              event.preventDefault();
              event.stopPropagation();
            }}
          >
            {actions}
          </span>
        )}
      </summary>
      <div className="mt-2">{children}</div>
    </details>
  );
}
