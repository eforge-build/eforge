import * as React from 'react';
import { Check, Edit3, Send, Trash2, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { formatRelativeTime } from '@/lib/format-time';
import type { PlanData } from '@/types';
import type { PlanRevisionSessionApi } from './use-plan-revision-session';
import { annotationSubmitDisabledReason, contextExcerpt, openAnnotations, shortAnnotationId, syncSelectedAnnotationIds, targetLabel, timestampLabelData } from './plan-revision-annotation-view-model';
import { MAX_STEERING_TEXT } from './plan-revision-annotation-targets';

interface Props { plan: PlanData; api: PlanRevisionSessionApi; disabled: boolean }

export function PlanRevisionAnnotationsPanel({ plan, api, disabled }: Props) {
  const annotations = openAnnotations(api.revisionSession?.annotations);
  const [selectedIds, setSelectedIds] = React.useState<string[]>([]);
  const [includeOpenAnnotations, setIncludeOpenAnnotations] = React.useState(true);
  const [steering, setSteering] = React.useState('');
  const [editingId, setEditingId] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState('');

  React.useEffect(() => {
    setSelectedIds((current) => syncSelectedAnnotationIds(current, annotations));
  }, [annotations.map((annotation) => annotation.annotationId).join('\n')]);

  if (annotations.length === 0) return null;

  const disabledReason = annotationSubmitDisabledReason({ loading: api.loading, busy: api.busy, hasRunningTurn: api.hasRunningTurn, disabled, selectedCount: selectedIds.length, includeOpenAnnotations, steering });
  const submit = async () => {
    const result = await api.submitAnnotationRevision({ annotationIds: selectedIds, includeOpenAnnotations, steering });
    if (result) setSteering('');
  };
  const toggle = (id: string, checked: boolean) => setSelectedIds((current) => checked ? Array.from(new Set([...current, id])) : current.filter((entry) => entry !== id));

  return (
    <div className="grid gap-3 rounded-md border border-primary/30 bg-primary/5 p-3" aria-label={`Revision annotations for ${plan.session}`}>
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Open annotations</h4>
        <Badge>{annotations.length} open annotations</Badge>
      </div>
      <div className="grid gap-2">
        {annotations.map((annotation) => {
          const editing = editingId === annotation.annotationId;
          return (
            <article key={annotation.annotationId} className="grid gap-2 rounded-md border bg-background/80 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Checkbox id={`select-${annotation.annotationId}`} aria-label={`Select annotation ${shortAnnotationId(annotation.annotationId)} for revision`} checked={selectedIds.includes(annotation.annotationId)} onChange={(event) => toggle(annotation.annotationId, event.target.checked)} />
                <label htmlFor={`select-${annotation.annotationId}`} className="text-xs font-medium">Include annotation {shortAnnotationId(annotation.annotationId)} in selected revision set</label>
                <Badge variant="outline">{annotation.target.kind}</Badge>
                <span className="text-xs text-muted-foreground">{targetLabel(annotation)}</span>
              </div>
              <blockquote className="rounded border-l-2 border-primary/40 bg-muted/30 px-2 py-1 text-xs">{contextExcerpt(annotation)}</blockquote>
              <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                {timestampLabelData(annotation).map((entry) => <span key={entry.label}>{entry.label} <time dateTime={entry.value}>{formatRelativeTime(entry.value) ?? entry.value}</time></span>)}
              </div>
              {editing ? (
                <div className="grid gap-2">
                  <Textarea aria-label={`Note for annotation ${shortAnnotationId(annotation.annotationId)}`} value={draft} disabled={api.busy} onChange={(event) => setDraft(event.target.value)} />
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" aria-label={`Save note for annotation ${shortAnnotationId(annotation.annotationId)}`} disabled={api.busy} onClick={() => void api.updateAnnotation({ annotationId: annotation.annotationId, body: draft.trim() }).then((result) => { if (result) setEditingId(null); })}><Check className="h-4 w-4" /> Save note</Button>
                    <Button size="sm" variant="outline" aria-label={`Cancel editing annotation ${shortAnnotationId(annotation.annotationId)}`} onClick={() => setEditingId(null)}>Cancel</Button>
                  </div>
                </div>
              ) : (
                <p className="text-sm">{annotation.body?.trim() || <span className="text-muted-foreground">No note</span>}</p>
              )}
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" aria-label={`Edit note for annotation ${shortAnnotationId(annotation.annotationId)}`} disabled={api.busy || disabled} onClick={() => { setEditingId(annotation.annotationId); setDraft(annotation.body ?? ''); }}><Edit3 className="h-4 w-4" /> Edit note</Button>
                <Button size="sm" variant="outline" aria-label={`Resolve annotation ${shortAnnotationId(annotation.annotationId)}`} disabled={api.busy || disabled} onClick={() => void api.resolveAnnotation(annotation.annotationId)}>Resolve</Button>
                <Button size="sm" variant="outline" aria-label={`Dismiss annotation ${shortAnnotationId(annotation.annotationId)}`} disabled={api.busy || disabled} onClick={() => void api.dismissAnnotation(annotation.annotationId)}><X className="h-4 w-4" /> Dismiss</Button>
                <Button size="sm" variant="destructive" aria-label={`Delete annotation ${shortAnnotationId(annotation.annotationId)}`} disabled={api.busy || disabled} onClick={() => void api.deleteAnnotation(annotation.annotationId)}><Trash2 className="h-4 w-4" /> Delete</Button>
              </div>
            </article>
          );
        })}
      </div>
      <div className="sticky bottom-2 z-10 grid gap-2 rounded-md border bg-background p-3 shadow">
        <div className="flex flex-wrap items-center gap-2 text-xs"><Badge>{annotations.length} open annotations</Badge><span className="text-muted-foreground">Revise with selected annotation context.</span></div>
        <label className="flex items-center gap-2 text-xs"><Checkbox aria-label="Include all open annotations" checked={includeOpenAnnotations} onChange={(event) => setIncludeOpenAnnotations(event.target.checked)} /> Include all open annotations</label>
        <label className="grid gap-1 text-xs"><span className="font-medium">Optional steering</span><Textarea value={steering} maxLength={MAX_STEERING_TEXT + 1} disabled={api.busy || api.loading || disabled} onChange={(event) => setSteering(event.target.value)} placeholder="Tell the AI how to use these annotations…" /></label>
        {disabledReason && <p className="text-xs text-muted-foreground">{disabledReason}</p>}
        <div><Button size="sm" disabled={Boolean(disabledReason)} onClick={() => void submit()}><Send className="h-4 w-4" /> Revise with AI from annotations</Button></div>
      </div>
    </div>
  );
}
