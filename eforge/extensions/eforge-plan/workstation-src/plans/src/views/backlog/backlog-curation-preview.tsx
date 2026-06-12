import * as React from 'react';
import { Button } from '@/components/ui/button';
import { SafeMarkdown } from '@/components/safe-markdown';
import { Textarea } from '@/components/ui/textarea';
import { formatRelativeTime } from '@/lib/format-time';
import type { BacklogCurationDraft, JsonObject, PlanningTaskWorkflowEntry, RecommendationModel } from '@/types';
import type { RedraftInput } from './use-planning-task-workflows';
import { abbreviateFingerprint, curationCounts, idLabel, metadataRows, recommendationSummaryCounts, sectionOperationLabel } from './backlog-curation-view-model';

interface BacklogCurationPreviewProps {
  taskId: string;
  entry: PlanningTaskWorkflowEntry;
  draft: BacklogCurationDraft;
  recommendations?: RecommendationModel;
  busy: boolean;
  onApply: (taskId: string, input: JsonObject) => Promise<unknown>;
  onRedraft: (taskId: string, input: RedraftInput) => Promise<void>;
}

export function BacklogCurationPreview({ taskId, entry, draft, recommendations, busy, onApply, onRedraft }: BacklogCurationPreviewProps) {
  const [reviewed, setReviewed] = React.useState(false);
  const [steering, setSteering] = React.useState('');
  const counts = curationCounts(draft, recommendations);
  const applied = Boolean(entry.appliedAt);
  const canRedraft = steering.trim().length > 0;

  return (
    <div className="mt-3 grid gap-3 border-t border-border pt-3 text-sm">
      <div className="grid gap-2">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Backlog curation preview</h3>
          <p className="text-xs text-muted-foreground">Read-only draft from source {abbreviateFingerprint(draft.sourceFingerprint)}{draft.generatedAt ? ` · generated ${formatRelativeTime(draft.generatedAt)}` : ''}</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <CountChip label="item changes" value={counts.itemChanges} />
          <CountChip label="epic changes" value={counts.epicChanges} />
          <CountChip label="no-op rechecks" value={counts.noOpRechecks} />
          <CountChip label="skipped" value={counts.skipped} />
          <CountChip label="needs input" value={counts.needsInput} />
          <CountChip label="generated recommendations" value={counts.generatedRecommendations} />
        </div>
      </div>

      {draft.summary.length > 0 && <ListSection title="Summary" entries={draft.summary} />}
      <PatchSection title="Item changes" patches={draft.itemChanges} />
      <PatchSection title="Epic changes" patches={draft.epicChanges} />
      {draft.noOpRechecks.length > 0 && (
        <PreviewBlock title="No-op rechecks">
          <details className="rounded border border-border p-2">
            <summary className="cursor-pointer text-xs text-muted-foreground">{draft.noOpRechecks.length} freshness-only rechecks proposed; expand for details</summary>
            <div className="mt-2 grid gap-2">
              {draft.noOpRechecks.map((entry) => (
                <div key={`${entry.kind}:${entry.id}`} className="rounded border border-border p-2">
                  <p className="font-medium text-foreground">{idLabel(entry.kind, entry.id)}</p>
                  <p className="text-xs text-muted-foreground">last_checked {entry.last_checked} · stale_after {entry.stale_after}</p>
                  {entry.rationale && <p className="mt-1 text-xs text-muted-foreground">{entry.rationale}</p>}
                </div>
              ))}
            </div>
          </details>
        </PreviewBlock>
      )}
      {draft.skipped.length > 0 && (
        <PreviewBlock title="Skipped cases">
          <ul className="grid gap-1.5 text-xs text-muted-foreground">
            {draft.skipped.map((entry, index) => <li key={`${entry.kind ?? 'record'}:${entry.id ?? index}`}>{idLabel(entry.kind, entry.id)} — {entry.reason}</li>)}
          </ul>
        </PreviewBlock>
      )}
      {draft.needsInput.length > 0 && (
        <PreviewBlock title="Needs-input cases">
          <ul className="grid gap-1.5 text-xs text-muted-foreground">
            {draft.needsInput.map((entry, index) => <li key={`${entry.kind ?? 'record'}:${entry.id ?? index}`}><span className="text-foreground">{idLabel(entry.kind, entry.id)}:</span> {entry.question}{entry.reason ? ` — ${entry.reason}` : ''}</li>)}
          </ul>
        </PreviewBlock>
      )}
      {recommendations && <GeneratedRecommendations recommendations={recommendations} />}

      <div className="grid gap-2 border-t border-border pt-2">
        <span className="text-[0.65rem] font-semibold uppercase tracking-wide text-muted-foreground">Redraft curation</span>
        <Textarea className="min-h-16" value={steering} onChange={(event) => setSteering(event.target.value)} placeholder="Optional steering for a curation redraft" />
        <div><Button size="sm" variant="secondary" disabled={busy || !canRedraft} onClick={() => void onRedraft(taskId, { steering: steering.trim() })}>Redraft curation</Button></div>
      </div>

      {applied ? (
        <div className="rounded border border-primary/30 bg-primary/10 p-2 text-xs text-text-bright">Curation applied {entry.appliedAt ? formatRelativeTime(entry.appliedAt) : ''}.</div>
      ) : (
        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-2">
          {!reviewed ? (
            <Button size="sm" disabled={busy} onClick={() => setReviewed(true)}>I reviewed this curation preview</Button>
          ) : (
            <>
              <Button size="sm" variant="destructive" disabled={busy} onClick={() => void onApply(taskId, { applyBacklogCurationDraft: { previewAcknowledged: true, confirmApply: true } })}>Confirm apply curation</Button>
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => setReviewed(false)}>Cancel</Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function CountChip({ label, value }: { label: string; value: number }) {
  return <span className="rounded border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-[0.68rem] text-text-bright">{value} {label}</span>;
}

function PreviewBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="grid gap-1.5 border-t border-border pt-2"><h4 className="text-[0.65rem] font-semibold uppercase tracking-wide text-muted-foreground">{title}</h4>{children}</section>;
}

function ListSection({ title, entries }: { title: string; entries: string[] }) {
  return <PreviewBlock title={title}><ul className="list-disc pl-4 text-xs text-muted-foreground">{entries.map((entry) => <li key={entry}>{entry}</li>)}</ul></PreviewBlock>;
}

type Patch = BacklogCurationDraft['itemChanges'][number] | BacklogCurationDraft['epicChanges'][number];

function PatchSection({ title, patches }: { title: string; patches: Patch[] }) {
  if (patches.length === 0) return null;
  return (
    <PreviewBlock title={title}>
      <div className="grid gap-2">
        {patches.map((patch) => <PatchCard key={`${patch.kind}:${patch.id}`} patch={patch} />)}
      </div>
    </PreviewBlock>
  );
}

function PatchCard({ patch }: { patch: Patch }) {
  const rows = metadataRows(patch.metadata as Record<string, unknown> | undefined);
  return (
    <article className="grid gap-2 rounded border border-border p-2">
      <div>
        <p className="font-medium text-foreground">{idLabel(patch.kind, patch.id)}</p>
        {patch.rationale && <p className="text-xs text-muted-foreground">{patch.rationale}</p>}
      </div>
      {rows.length > 0 && <dl className="grid gap-1 text-xs">{rows.map((row) => <div key={row.label} className="grid grid-cols-[8rem_1fr] gap-2"><dt className="text-muted-foreground">{row.label}</dt><dd className="text-foreground">{row.value}</dd></div>)}</dl>}
      {patch.sectionOperations && patch.sectionOperations.length > 0 && <div className="grid gap-1">{patch.sectionOperations.map((operation) => <details key={`${operation.heading}:${operation.action}`} className="border-l-2 border-border pl-2"><summary className="cursor-pointer text-xs text-muted-foreground">{sectionOperationLabel(operation.action)} · {operation.heading}</summary><SafeMarkdown markdown={operation.content} /></details>)}</div>}
      {patch.evidence && patch.evidence.length > 0 && <ul className="list-disc pl-4 text-xs text-muted-foreground">{patch.evidence.map((entry) => <li key={entry}>{entry}</li>)}</ul>}
    </article>
  );
}

function GeneratedRecommendations({ recommendations }: { recommendations: RecommendationModel }) {
  const counts = recommendationSummaryCounts(recommendations);
  return (
    <PreviewBlock title="Generated recommendations (read-only)">
      <div className="grid gap-1.5 text-xs text-muted-foreground">
        <p>{counts.activeWork} active work items · {counts.readyCandidates} ready candidates · {counts.nextSequence} next-sequence items · {counts.safeParallelGroups} safe-parallel groups · {counts.blockedChains} blocked chains</p>
        {recommendations.rationaleAndAssumptions && recommendations.rationaleAndAssumptions.length > 0 && <ul className="list-disc pl-4">{recommendations.rationaleAndAssumptions.map((entry) => <li key={entry}>{entry}</li>)}</ul>}
      </div>
    </PreviewBlock>
  );
}
