import * as React from 'react';
import { Check, Edit3, MessageSquareText, Send, Trash2, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { formatRelativeTime } from '@/lib/format-time';
import type { PlanData, PlanRevisionAnnotation } from '@/types';
import { PlanRevisionPanel } from './plan-revision-panel';
import type { PlanRevisionSessionApi } from './use-plan-revision-session';
import { contextExcerpt, openAnnotations, revisionComposerDisabledReason, shortAnnotationId, syncSelectedAnnotationIds, targetLabel } from './plan-revision-annotation-view-model';
import { MAX_STEERING_TEXT } from './plan-revision-annotation-targets';

interface Props { plan: PlanData; api: PlanRevisionSessionApi; disabled: boolean }

/**
 * The Review workspace: "Open annotations" lists the marks you have made (each
 * with an Include toggle), and the single composer + the turn history live
 * together inside one "Revise with AI" panel. The composer's message doubles as
 * steering for the included annotations, a free-form question, or a global
 * change - and can be sent with nothing selected (a plain message turn).
 */
export function PlanRevisionAnnotationsPanel({ plan, api, disabled }: Props) {
  const annotations = openAnnotations(api.revisionSession?.annotations);
  const [selectedIds, setSelectedIds] = React.useState<string[]>([]);
  const [message, setMessage] = React.useState('');

  React.useLayoutEffect(() => {
    setSelectedIds((current) => syncSelectedAnnotationIds(current, annotations));
  }, [annotations.map((annotation) => annotation.annotationId).join('\n')]);

  const hasAnnotations = annotations.length > 0;
  const running = api.hasRunningTurn;
  const grounded = selectedIds.length > 0;
  const disabledReason = revisionComposerDisabledReason({ loading: api.loading, busy: api.busy, hasRunningTurn: running, disabled, grounded, message });
  const countLabel = `${annotations.length} open annotation${annotations.length === 1 ? '' : 's'}`;

  const toggle = (id: string, checked: boolean) => setSelectedIds((current) => checked ? Array.from(new Set([...current, id])) : current.filter((entry) => entry !== id));
  const submit = async () => {
    const trimmed = message.trim();
    const result = grounded
      ? await api.submitAnnotationRevision({ annotationIds: selectedIds, includeOpenAnnotations: false, steering: trimmed })
      : await api.submit(trimmed);
    if (result) setMessage('');
  };

  const composer = (
    <div className="grid gap-2">
      {running && <p className="flex items-center gap-2 text-xs text-muted-foreground"><Spinner /> The AI is revising this plan. Its changes apply automatically when it finishes; plan edits and new requests are paused until then.</p>}
      <label className="grid gap-1 text-xs">
        <span className="font-medium">Message to AI</span>
        <Textarea aria-label="Message to AI" value={message} maxLength={MAX_STEERING_TEXT + 1} disabled={api.busy || api.loading || running} onChange={(event) => setMessage(event.target.value)} placeholder={hasAnnotations ? 'Steer how the AI uses the included annotations, ask a question, or request a global change…' : 'Ask a question or request a plan change…'} />
      </label>
      {hasAnnotations && (
        <p className="text-2xs text-muted-foreground">{grounded ? `Including ${selectedIds.length} of ${annotations.length} annotation${annotations.length === 1 ? '' : 's'}.` : 'No annotations included - sends a plain message.'}</p>
      )}
      {disabledReason && <p className="text-xs text-muted-foreground">{disabledReason}</p>}
      <div><Button size="sm" disabled={Boolean(disabledReason)} onClick={() => void submit()}><Send className="h-4 w-4" /> Send to AI</Button></div>
    </div>
  );

  return (
    <div className="grid gap-3">
      {hasAnnotations && (
        <div className="grid gap-2" aria-label={`Revision annotations for ${plan.session}`}>
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Open annotations</h4>
            <Badge variant="outline">{countLabel}</Badge>
          </div>
          <div className="grid gap-2">
            {annotations.map((annotation) => (
              <AnnotationCard key={annotation.annotationId} annotation={annotation} api={api} disabled={disabled} selected={selectedIds.includes(annotation.annotationId)} onToggle={toggle} />
            ))}
          </div>
        </div>
      )}

      <PlanRevisionPanel plan={plan} api={api} rail hasAnnotations={hasAnnotations} composer={composer} />
    </div>
  );
}

function AnnotationCard({ annotation, api, disabled, selected, onToggle }: { annotation: PlanRevisionAnnotation; api: PlanRevisionSessionApi; disabled: boolean; selected: boolean; onToggle: (id: string, checked: boolean) => void }) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState('');
  const id = annotation.annotationId;
  const short = shortAnnotationId(id);
  const busyOrLocked = api.busy || disabled;
  const note = annotation.body?.trim();
  const updated = annotation.updatedAt || annotation.createdAt;

  // Reads like a review comment: where it's attached + whether it'll be sent to
  // the AI (top), the text you marked (quoted), your note (comment icon), then a
  // compact action row with the last-updated time.
  return (
    <article className="grid gap-2 rounded-md border bg-background/80 p-3">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Badge variant="secondary" className="shrink-0">{annotation.target.kind}</Badge>
        <span className="min-w-0 flex-1 truncate text-text-bright" title={targetLabel(annotation)}>{targetLabel(annotation)}</span>
        <label className="flex shrink-0 items-center gap-1 text-2xs" title="Include this annotation when you send the plan to the AI">
          <Checkbox aria-label={`Select annotation ${short} for revision`} checked={selected} onChange={(event) => onToggle(id, event.target.checked)} /> Include
        </label>
      </div>

      <blockquote className="line-clamp-2 border-l-2 border-border pl-2 text-xs italic text-muted-foreground" title={contextExcerpt(annotation)}>{contextExcerpt(annotation)}</blockquote>

      {editing ? (
        <div className="grid gap-2">
          <Textarea aria-label={`Note for annotation ${short}`} value={draft} disabled={api.busy} onChange={(event) => setDraft(event.target.value)} />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" aria-label={`Save note for annotation ${short}`} disabled={api.busy} onClick={() => void api.updateAnnotation({ annotationId: id, body: draft.trim() }).then((result) => { if (result) setEditing(false); })}><Check className="h-4 w-4" /> Save note</Button>
            <Button size="sm" variant="outline" aria-label={`Cancel editing annotation ${short}`} onClick={() => setEditing(false)}>Cancel</Button>
          </div>
        </div>
      ) : (
        <p className="flex items-start gap-1.5 text-sm leading-snug text-text-bright">
          <MessageSquareText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <span>{note || <span className="italic text-muted-foreground">No note yet - add one to tell the AI what to change.</span>}</span>
        </p>
      )}

      <div className="flex items-center justify-between gap-2 text-muted-foreground">
        <div className="flex items-center gap-0.5">
          <Button size="icon-xs" variant="ghost" title="Edit note" aria-label={`Edit note for annotation ${short}`} disabled={busyOrLocked} onClick={() => { setEditing(true); setDraft(annotation.body ?? ''); }}><Edit3 className="h-3.5 w-3.5" /></Button>
          <Button size="icon-xs" variant="ghost" title="Resolve (mark addressed)" aria-label={`Resolve annotation ${short}`} disabled={busyOrLocked} onClick={() => void api.resolveAnnotation(id)}><Check className="h-3.5 w-3.5" /></Button>
          <Button size="icon-xs" variant="ghost" title="Dismiss (won't change)" aria-label={`Dismiss annotation ${short}`} disabled={busyOrLocked} onClick={() => void api.dismissAnnotation(id)}><X className="h-3.5 w-3.5" /></Button>
          <Button size="icon-xs" variant="ghost" title="Delete annotation" aria-label={`Delete annotation ${short}`} disabled={busyOrLocked} onClick={() => void api.deleteAnnotation(id)}><Trash2 className="h-3.5 w-3.5" /></Button>
        </div>
        <time className="shrink-0 text-2xs" dateTime={updated} title={`Created ${annotation.createdAt}`}>Updated {formatRelativeTime(updated) ?? updated}</time>
      </div>
    </article>
  );
}
