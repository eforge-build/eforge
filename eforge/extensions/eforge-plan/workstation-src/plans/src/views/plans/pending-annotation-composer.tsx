import * as React from 'react';
import { MessageSquarePlus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import type { PlanRevisionAnnotationTarget } from '@/types';
import { titleCase } from './dimensions';

interface Props {
  target: PlanRevisionAnnotationTarget | null;
  busy: boolean;
  onSave: (body: string) => Promise<boolean>;
  onCancel: () => void;
}

function targetTitle(target: PlanRevisionAnnotationTarget): string {
  return target.label?.trim() || (target.dimension ? titleCase(target.dimension) : titleCase(target.kind));
}

export function PendingAnnotationComposer({ target, busy, onSave, onCancel }: Props) {
  const [draft, setDraft] = React.useState('');

  React.useEffect(() => {
    setDraft('');
  }, [target]);

  if (!target) {
    return (
      <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground" aria-label="Pending annotation composer empty">
        Select text, a focused block, a section, or the whole plan to draft an annotation here.
      </div>
    );
  }

  const quote = target.quoteContext;
  const save = async () => {
    const persisted = await onSave(draft.trim());
    if (persisted) setDraft('');
  };

  return (
    <div className="grid gap-3 rounded-md border border-primary/30 bg-primary/5 p-3" aria-label="Pending annotation composer">
      <div className="flex flex-wrap items-center gap-2">
        <MessageSquarePlus className="h-4 w-4 text-muted-foreground" />
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Draft annotation</h4>
        <Badge variant="outline">{target.kind}</Badge>
      </div>

      <dl className="grid gap-2 text-xs">
        <div>
          <dt className="font-semibold text-muted-foreground">Target</dt>
          <dd className="text-text-bright">{targetTitle(target)}</dd>
        </div>
        {target.dimension && (
          <div>
            <dt className="font-semibold text-muted-foreground">Dimension</dt>
            <dd>{titleCase(target.dimension)}</dd>
          </div>
        )}
        <div>
          <dt className="font-semibold text-muted-foreground">Captured excerpt</dt>
          <dd className="rounded border-l-2 border-primary/40 bg-background/80 px-2 py-1">{target.capturedText}</dd>
        </div>
        <div>
          <dt className="font-semibold text-muted-foreground">Quote context</dt>
          <dd className="grid gap-1 rounded-md bg-background/70 p-2">
            {quote.prefix && <span><span className="text-muted-foreground">Before:</span> {quote.prefix}</span>}
            <span><span className="text-muted-foreground">Exact:</span> {quote.exact}</span>
            {quote.suffix && <span><span className="text-muted-foreground">After:</span> {quote.suffix}</span>}
          </dd>
        </div>
      </dl>

      <label className="grid gap-1 text-xs">
        <span className="font-medium">Note</span>
        <Textarea aria-label="Annotation note" value={draft} disabled={busy} onChange={(event) => setDraft(event.target.value)} placeholder="Describe what should change or what needs review…" />
      </label>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={busy} onClick={() => void save()}>Save annotation</Button>
        <Button size="sm" variant="outline" onClick={onCancel}>Cancel annotation</Button>
      </div>
    </div>
  );
}
