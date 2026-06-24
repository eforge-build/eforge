import * as React from 'react';
import { createPortal } from 'react-dom';
import { MessageSquarePlus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import type { PlanRevisionAnnotationTarget } from '@/types';
import { titleCase } from './dimensions';

interface Props {
  target: PlanRevisionAnnotationTarget;
  /** Viewport rect of the affordance that opened the composer, for anchoring. */
  anchor: DOMRect | null;
  busy: boolean;
  onSave: (body: string) => Promise<boolean>;
  onCancel: () => void;
}

const WIDTH = 320;

function targetTitle(target: PlanRevisionAnnotationTarget): string {
  return target.label?.trim() || (target.dimension ? titleCase(target.dimension) : titleCase(target.kind));
}

/**
 * Fixed-position style anchored beside the affordance that opened the composer,
 * clamped to the viewport and flipped above the anchor when it sits low.
 */
function anchoredStyle(anchor: DOMRect | null): React.CSSProperties {
  if (!anchor) return { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' };
  const left = Math.max(8, Math.min(anchor.left, window.innerWidth - WIDTH - 8));
  return anchor.bottom > window.innerHeight * 0.6
    ? { left, bottom: Math.max(8, window.innerHeight - anchor.top + 6) }
    : { left, top: Math.min(anchor.bottom + 6, window.innerHeight - 8) };
}

/**
 * Inline annotation composer anchored next to the text (or button) that opened
 * it - a Docs-style margin popover rather than a far-rail panel. Shows the
 * captured quote in context once, then the note input.
 */
export function PendingAnnotationComposer({ target, anchor, busy, onSave, onCancel }: Props) {
  const [draft, setDraft] = React.useState('');
  const quote = target.quoteContext;

  // Reset the note when the composer is re-pointed at a different target without
  // unmounting (e.g. clicking another affordance while it is open).
  React.useEffect(() => { setDraft(''); }, [target]);

  // The popover is position:fixed against an anchor rect captured at open time.
  // Scrolling or resizing the page would strand it from its source text, so
  // dismiss the composer instead of letting it drift.
  React.useEffect(() => {
    if (!anchor) return;
    window.addEventListener('scroll', onCancel, true);
    window.addEventListener('resize', onCancel);
    return () => {
      window.removeEventListener('scroll', onCancel, true);
      window.removeEventListener('resize', onCancel);
    };
  }, [anchor, onCancel]);

  const save = async () => {
    const persisted = await onSave(draft.trim());
    if (persisted) setDraft('');
  };

  return createPortal(
    <div
      role="dialog"
      aria-label="Pending annotation composer"
      className="fixed z-50 grid gap-2 rounded-md border border-primary/40 bg-card p-3 shadow-lg shadow-black/40"
      style={{ width: WIDTH, ...anchoredStyle(anchor) }}
      onKeyDown={(event) => { if (event.key === 'Escape') onCancel(); }}
    >
      <div className="flex items-center gap-2">
        <MessageSquarePlus className="h-4 w-4 text-primary" />
        <span className="min-w-0 flex-1 truncate text-xs font-semibold text-text-bright" title={targetTitle(target)}>{targetTitle(target)}</span>
        <Badge variant="outline">{target.kind}</Badge>
      </div>
      <blockquote className="max-h-20 overflow-auto rounded border-l-2 border-primary/40 bg-background/80 px-2 py-1 text-2xs leading-snug text-muted-foreground">
        {quote.prefix && <span>{quote.prefix}</span>}
        <span className="text-text-bright">{quote.exact}</span>
        {quote.suffix && <span>{quote.suffix}</span>}
      </blockquote>
      <Textarea autoFocus aria-label="Annotation note" value={draft} disabled={busy} onChange={(event) => setDraft(event.target.value)} placeholder="Describe what should change or what needs review…" />
      <div className="flex items-center gap-2">
        <Button size="sm" disabled={busy} onClick={() => void save()}>Save annotation</Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>Cancel annotation</Button>
      </div>
    </div>,
    document.body,
  );
}
