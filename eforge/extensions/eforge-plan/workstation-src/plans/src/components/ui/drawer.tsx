import * as React from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useEscapeToClose } from '@/hooks/use-escape-to-close';

const WIDTH_CLASS = {
  sm: 'w-[26rem]',
  md: 'w-[34rem]',
} as const;

const FOCUSABLE = 'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface DrawerProps {
  /** Required landmark label for the dialog. */
  ariaLabel: string;
  title: React.ReactNode;
  /** Small uppercase line above the title (e.g. a kind/eyebrow). */
  eyebrow?: React.ReactNode;
  /** Secondary line below the title (e.g. an id rendered as <code>). */
  subtitle?: React.ReactNode;
  width?: keyof typeof WIDTH_CLASS;
  /** 'start' for multi-line headers, 'center' for a single title line. */
  headerAlign?: 'start' | 'center';
  closeLabel?: string;
  onClose: () => void;
  children: React.ReactNode;
}

/**
 * The workstation's single right-edge detail drawer. Replaces the hand-rolled
 * `fixed inset-y-0 right-0 ... shadow-2xl` aside that was copy-pasted across the
 * backlog drawers, and adds what those lacked: a dismissing backdrop scrim, a
 * `role="dialog"` + `aria-modal` contract, focus capture/restore with a Tab
 * trap, Escape-to-close, and a slide-in animation. Portaled to <body> so it is
 * never clipped by an ancestor's overflow or grid.
 */
export function Drawer({ ariaLabel, title, eyebrow, subtitle, width = 'md', headerAlign = 'start', closeLabel = 'Close', onClose, children }: DrawerProps) {
  const panelRef = React.useRef<HTMLElement>(null);

  useEscapeToClose(onClose);

  // Capture focus into the panel on open and restore it to the trigger on close.
  React.useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    panelRef.current?.focus();
    return () => previouslyFocused?.focus?.();
  }, []);

  // Lock background scroll while the drawer is open. Saving/restoring the prior
  // value (rather than forcing '') keeps nested drawers correct: each restores
  // to whatever the layer beneath it had set.
  React.useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previousOverflow; };
  }, []);

  const trapTab = (event: React.KeyboardEvent) => {
    if (event.key !== 'Tab') return;
    const focusables = panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
    if (!focusables || focusables.length === 0) {
      event.preventDefault();
      panelRef.current?.focus();
      return;
    }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return createPortal(
    <>
      <div className="fixed inset-0 z-30 bg-background/70 backdrop-blur-sm animate-scrim-in" aria-hidden="true" onClick={onClose} />
      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel}
        tabIndex={-1}
        onKeyDown={trapTab}
        className={cn('fixed inset-y-0 right-0 z-40 flex max-w-full flex-col border-l border-border bg-card shadow-2xl outline-none animate-drawer-in', WIDTH_CLASS[width])}
      >
        <header className={cn('flex gap-2 border-b border-border p-4', headerAlign === 'center' ? 'items-center' : 'items-start')}>
          <div className="min-w-0 flex-1">
            {eyebrow && <p className="text-2xs font-semibold uppercase tracking-wide text-[color:var(--lane-archive)]">{eyebrow}</p>}
            <h3 className={cn('text-sm font-semibold leading-snug text-text-bright', eyebrow && 'mt-0.5')}>{title}</h3>
            {subtitle}
          </div>
          <button
            type="button"
            aria-label={closeLabel}
            className="rounded p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto p-4">{children}</div>
      </aside>
    </>,
    document.body,
  );
}
