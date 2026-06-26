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
  onSave: (body: string) => Promise<{ ok: boolean; error?: string }>;
  onCancel: () => void;
}

const WIDTH = 320;
// Mirrors backend MAX_PLAN_REVISION_ANNOTATION_BODY_LENGTH.
const MAX_ANNOTATION_BODY_LENGTH = 4000;

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
  const [saveError, setSaveError] = React.useState<string | null>(null);
  const quote = target.quoteContext;
  const bodyLength = draft.length;
  const overLimit = bodyLength > MAX_ANNOTATION_BODY_LENGTH;

  // Reset the note when the composer is re-pointed at a different target without
  // unmounting (e.g. clicking another affordance while it is open).
  React.useEffect(() => { setDraft(''); setSaveError(null); }, [target]);

  const save = async () => {
    if (overLimit) return;
    setSaveError(null);
    const result = await onSave(draft.trim());
    if (result.ok) setDraft('');
    else setSaveError(result.error ?? 'Annotation could not be saved. Keep the draft open and retry.');
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
      <Textarea autoFocus aria-label="Annotation note" value={draft} disabled={busy} onChange={(event) => { setDraft(event.target.value); setSaveError(null); }} placeholder="Describe what should change or what needs review…" />
      <div className="flex items-center justify-between gap-2 text-2xs">
        <span className={overLimit ? 'text-destructive-foreground' : 'text-muted-foreground'}>{bodyLength} / {MAX_ANNOTATION_BODY_LENGTH} characters</span>
        {overLimit && <span className="text-destructive-foreground">Shorten before saving.</span>}
      </div>
      {saveError && <p role="alert" className="rounded border border-destructive/40 bg-destructive/10 px-2 py-1 text-xs text-destructive-foreground">{saveError}</p>}
      <div className="flex items-center gap-2">
        <Button size="sm" disabled={busy || overLimit} title={overLimit ? 'Annotation exceeds the backend body limit.' : undefined} onClick={() => void save()}>Save annotation</Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>Cancel annotation</Button>
      </div>
    </div>,
    document.body,
  );
}
