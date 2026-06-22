import * as React from 'react';
import { Button } from '@/components/ui/button';
import { SafeMarkdown } from '@/components/safe-markdown';
import { Textarea } from '@/components/ui/textarea';
import { getBridge } from '@/bridge';
import { formatRelativeTime } from '@/lib/format-time';
import type { BacklogCurationDraft, BacklogCurationPreviewDetails, JsonObject, PlanningTaskWorkflowEntry, RecommendationModel, RecommendationReferenceValidationResult } from '@/types';
import type { RedraftInput } from './use-planning-task-workflows';
import { abbreviateFingerprint, curationCounts, curationEvidencePreview, effectiveRecommendationsFromProjection, idLabel, matchFullAuditEvidenceForPatch, metadataRows, projectionMetadataDisplay, recommendationSummaryCounts, sectionOperationLabel, validationIssueLabel } from './backlog-curation-view-model';
import { RecommendationFreshnessBadge, RecommendationFreshnessLine } from '@/components/recommendation-freshness';
import { BacklogCurationFullAuditPanel, FullAuditEvidenceChips } from './backlog-curation-full-audit-panel';
import { BacklogCurationGitDeltaPanel } from './backlog-curation-git-delta-panel';
import { SubBlock } from './sub-block';
import { focusBoardItem } from '@/lib/focus-board-item';

interface BacklogCurationPreviewProps {
  taskId: string;
  entry: PlanningTaskWorkflowEntry;
  draft: BacklogCurationDraft;
  recommendations?: RecommendationModel;
  curationPreview?: BacklogCurationPreviewDetails;
  busy: boolean;
  onApply: (taskId: string, input: JsonObject) => Promise<unknown>;
  onRedraft: (taskId: string, input: RedraftInput) => Promise<void>;
}

export function BacklogCurationPreview({ taskId, entry, draft, recommendations, curationPreview, busy, onApply, onRedraft }: BacklogCurationPreviewProps) {
  const [reviewed, setReviewed] = React.useState(false);
  const [steering, setSteering] = React.useState('');
  const [loadedPreview, setLoadedPreview] = React.useState<BacklogCurationPreviewDetails | null>(curationPreview ?? null);
  const [previewLoading, setPreviewLoading] = React.useState(curationPreview === undefined);
  const effectivePreview = curationPreview ?? loadedPreview ?? undefined;
  const projection = effectivePreview?.recommendationProjection;
  const displayRecommendations = effectiveRecommendationsFromProjection(projection);
  const projectionMetadata = projectionMetadataDisplay(projection);
  const counts = curationCounts(draft, projection);
  const applied = Boolean(entry.appliedAt);
  const hasReviewContent = draft.summary.length > 0 || draft.itemChanges.length > 0 || draft.epicChanges.length > 0 || draft.noOpRechecks.length > 0 || draft.skipped.length > 0 || draft.needsInput.length > 0 || Boolean(displayRecommendations) || previewLoading || effectivePreview !== undefined;
  const canRedraft = steering.trim().length > 0;
  const recommendationValidation = projection?.validation ?? effectivePreview?.generatedRecommendationValidation;
  const hasInvalidGeneratedRecommendations = recommendationValidation?.valid === false;
  const previewErrors = effectivePreview?.errors ?? [];
  const previewReady = effectivePreview !== undefined;
  const canApplyNormally = previewReady && effectivePreview.valid && previewErrors.length === 0 && !hasInvalidGeneratedRecommendations;
  const canApplyCurationOnly = previewReady && hasInvalidGeneratedRecommendations && previewErrors.length === 0;

  React.useEffect(() => {
    if (curationPreview !== undefined) {
      setLoadedPreview(curationPreview);
      setPreviewLoading(false);
      return undefined;
    }
    let active = true;
    setPreviewLoading(true);
    void getBridge().invokeAction<BacklogCurationPreviewDetails>('preview-backlog-curation-task', { taskId }).then((preview) => {
      if (!active) return;
      setLoadedPreview(preview);
    }).catch((caught) => {
      if (!active) return;
      setLoadedPreview({ valid: false, errors: [{ path: '', message: caught instanceof Error ? caught.message : String(caught) }] });
    }).finally(() => {
      if (active) setPreviewLoading(false);
    });
    return () => { active = false; };
  }, [curationPreview, taskId]);

  return (
    <SubBlock className="mt-3 gap-3 pt-3 text-sm">
      <div className="grid gap-2">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Backlog curation preview</h3>
          <p className="text-xs text-muted-foreground">Read-only draft from source {abbreviateFingerprint(draft.sourceFingerprint)}{draft.generatedAt ? ` · generated ${formatRelativeTime(draft.generatedAt)}` : ''}</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <CountChip label="item changes" value={counts.itemChanges} />
          <CountChip label="epic changes" value={counts.epicChanges} />
          <CountChip label="no-op rechecks" value={counts.noOpRechecks} />
          <CountChip label="unresolved exceptions" value={counts.skipped} />
          <CountChip label="needs input" value={counts.needsInput} />
          <CountChip label="recommendation entries" value={counts.generatedRecommendations} />
        </div>
      </div>

      {effectivePreview?.recommendationFreshness && (
        <div className="flex flex-wrap items-center gap-2 rounded border border-border bg-card p-2 text-xs">
          <RecommendationFreshnessBadge freshness={effectivePreview.recommendationFreshness} prefix="recommendations" />
          <RecommendationFreshnessLine freshness={effectivePreview.recommendationFreshness} />
        </div>
      )}
      <BacklogCurationGitDeltaPanel gitDelta={effectivePreview?.gitDelta} />
      <BacklogCurationFullAuditPanel audit={effectivePreview?.fullImplementationAudit} />
      {previewLoading && <div className="rounded border border-border bg-card p-2 text-xs text-muted-foreground">Validating curation apply preconditions and effective recommendation projection…</div>}
      {!previewLoading && effectivePreview && !projection && recommendations && <div className="rounded border border-border bg-card p-2 text-xs text-muted-foreground">Effective recommendation projection unavailable; raw generated recommendations are available as provenance only and normal apply remains disabled.</div>}
      {recommendationValidation && <RecommendationValidationWarning validation={recommendationValidation} />}
      {previewErrors.length > 0 && (
        <PreviewBlock title="Curation preview validation errors">
          <ul className="grid gap-1.5 text-xs text-destructive-foreground">
            {previewErrors.map((error) => <li key={`${error.path}:${error.message}`}><span className="font-mono">{error.path}</span> — {error.message}</li>)}
          </ul>
        </PreviewBlock>
      )}

      {hasReviewContent && (
        <details className="border-t border-border pt-2">
          <summary className="cursor-pointer list-none text-xs text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">Review curation details</summary>
          <div className="mt-2 grid gap-3">
            {draft.summary.length > 0 && <ListSection title="Summary" entries={draft.summary} />}
            <PatchSection title="Item changes" patches={draft.itemChanges} applied={applied} fullAudit={effectivePreview?.fullImplementationAudit} />
            <PatchSection title="Epic changes" patches={draft.epicChanges} applied={applied} fullAudit={effectivePreview?.fullImplementationAudit} />
            {draft.noOpRechecks.length > 0 && (
              <PreviewBlock title="No-op rechecks">
                <details className="rounded border border-border p-2">
                  <summary className="cursor-pointer text-xs text-muted-foreground">{draft.noOpRechecks.length} freshness-only rechecks proposed; expand for details</summary>
                  <div className="mt-2 grid gap-2">
                    {draft.noOpRechecks.map((entry) => (
                      <div key={`${entry.kind}:${entry.id}`} className="rounded border border-border p-2">
                        <p className="font-medium text-foreground"><RecordLabel kind={entry.kind} id={entry.id} /></p>
                        <p className="text-xs text-muted-foreground">last_checked {entry.last_checked} · stale_after {entry.stale_after}</p>
                        {entry.rationale && <p className="mt-1 text-xs text-muted-foreground">{entry.rationale}</p>}
                      </div>
                    ))}
                  </div>
                </details>
              </PreviewBlock>
            )}
            {draft.skipped.length > 0 && (
              <PreviewBlock title="Unresolved exceptions">
                <ul className="grid gap-1.5 text-xs text-muted-foreground">
                  {draft.skipped.map((entry, index) => <li key={`${entry.kind ?? 'record'}:${entry.id ?? index}`}><RecordLabel kind={entry.kind} id={entry.id} /> — {entry.reason}</li>)}
                </ul>
              </PreviewBlock>
            )}
            {draft.needsInput.length > 0 && (
              <PreviewBlock title="Needs-input cases">
                <ul className="grid gap-1.5 text-xs text-muted-foreground">
                  {draft.needsInput.map((entry, index) => {
                    const evidence = curationEvidencePreview([entry.reason, entry.question]);
                    return <li key={`${entry.kind ?? 'record'}:${entry.id ?? index}`}><span className="text-foreground"><RecordLabel kind={entry.kind} id={entry.id} />:</span> {evidence.labels.map((label) => <span key={label} className="mr-1 rounded border border-amber-400/40 bg-amber-400/10 px-1 text-amber-200">{label}</span>)}{entry.question}{entry.reason ? ` — ${entry.reason}` : ''}</li>;
                  })}
                </ul>
              </PreviewBlock>
            )}
            {displayRecommendations && <GeneratedRecommendations recommendations={displayRecommendations} metadata={projectionMetadata} />}
          </div>
        </details>
      )}

      <SubBlock title="Redraft curation">
        <Textarea className="min-h-16" value={steering} onChange={(event) => setSteering(event.target.value)} placeholder="Optional steering for a curation redraft" />
        <div><Button size="sm" variant="secondary" disabled={busy || !canRedraft} onClick={() => void onRedraft(taskId, { steering: steering.trim() })}>Redraft curation</Button></div>
      </SubBlock>

      {applied ? (
        <div className="rounded border border-primary/30 bg-primary/10 p-2 text-xs text-text-bright">Curation applied {entry.appliedAt ? formatRelativeTime(entry.appliedAt) : ''}.</div>
      ) : (
        <SubBlock className="flex flex-wrap items-center">
          {!reviewed ? (
            <Button size="sm" disabled={busy} onClick={() => setReviewed(true)}>I reviewed this curation preview</Button>
          ) : (
            <>
              <Button size="sm" variant="destructive" disabled={busy || previewLoading || !canApplyNormally} onClick={() => void onApply(taskId, { applyBacklogCurationDraft: { previewAcknowledged: true, confirmApply: true } })}>Confirm apply curation</Button>
              {hasInvalidGeneratedRecommendations && <Button size="sm" variant="secondary" disabled={busy || previewLoading || !canApplyCurationOnly} onClick={() => void onApply(taskId, { applyBacklogCurationDraft: { previewAcknowledged: true, confirmApply: true, applyCurationOnly: true } })}>Apply curation only / discard generated recommendations</Button>}
              <Button size="sm" variant="ghost" disabled={busy} onClick={() => setReviewed(false)}>Cancel</Button>
            </>
          )}
        </SubBlock>
      )}
    </SubBlock>
  );
}

function CountChip({ label, value }: { label: string; value: number }) {
  return <span className="rounded border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-2xs text-text-bright">{value} {label}</span>;
}

// Record label that links backlog items to their board card (same scroll-into-view
// behavior as the recommendations flow). Epics have no board card, so they stay
// as plain text.
function RecordLabel({ kind, id }: { kind?: string; id?: string }) {
  const label = idLabel(kind, id);
  if (kind !== 'item' || !id) return <>{label}</>;
  return (
    <button type="button" onClick={() => focusBoardItem(id)} title={`Show ${id} on the board`} className="rounded-sm text-[color:var(--lane-ready)] hover:underline focus-visible:underline focus-visible:outline focus-visible:outline-1 focus-visible:outline-[color:var(--color-ring)]">
      {label}
    </button>
  );
}

function PreviewBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return <SubBlock title={title} className="gap-1.5">{children}</SubBlock>;
}

function ListSection({ title, entries }: { title: string; entries: string[] }) {
  return <PreviewBlock title={title}><ul className="list-disc pl-4 text-xs text-muted-foreground">{entries.map((entry) => <li key={entry}>{entry}</li>)}</ul></PreviewBlock>;
}

type Patch = BacklogCurationDraft['itemChanges'][number] | BacklogCurationDraft['epicChanges'][number];

function PatchSection({ title, patches, applied, fullAudit }: { title: string; patches: Patch[]; applied: boolean; fullAudit?: BacklogCurationPreviewDetails['fullImplementationAudit'] }) {
  if (patches.length === 0) return null;
  return (
    <PreviewBlock title={title}>
      <div className="grid gap-2">
        {patches.map((patch) => <PatchCard key={`${patch.kind}:${patch.id}`} patch={patch} applied={applied} fullAudit={fullAudit} />)}
      </div>
    </PreviewBlock>
  );
}

function PatchCard({ patch, applied, fullAudit }: { patch: Patch; applied: boolean; fullAudit?: BacklogCurationPreviewDetails['fullImplementationAudit'] }) {
  const rows = metadataRows(patch.metadata as Record<string, unknown> | undefined);
  const evidence = curationEvidencePreview(patch.evidence ?? []);
  const fullAuditEvidence = matchFullAuditEvidenceForPatch(fullAudit, patch);
  return (
    <article className="grid gap-2 rounded border border-border p-2">
      <div>
        <p className="font-medium text-foreground"><RecordLabel kind={patch.kind} id={patch.id} /></p>
        {patch.rationale && <p className="text-xs text-muted-foreground">{patch.rationale}</p>}
      </div>
      {rows.length > 0 && <dl className="grid gap-1 text-xs">{rows.map((row) => <div key={row.label} className="grid grid-cols-[8rem_1fr] gap-2"><dt className="text-muted-foreground">{row.label}</dt><dd className="text-foreground">{row.value}</dd></div>)}</dl>}
      {patch.sectionOperations && patch.sectionOperations.length > 0 && <div className="grid gap-1">{patch.sectionOperations.map((operation) => <details key={`${operation.heading}:${operation.action}`} className="border-l-2 border-border pl-2"><summary className="cursor-pointer text-xs text-muted-foreground">{sectionOperationLabel(operation.action)} · {operation.heading}</summary><SafeMarkdown markdown={operation.content} /></details>)}</div>}
      {(evidence.labels.length > 0 || fullAuditEvidence.length > 0) && (
        <div className="grid gap-1 rounded border border-primary/20 bg-primary/5 p-2 text-xs text-muted-foreground">
          {evidence.labels.length > 0 && <p>{fullAudit ? 'Draft evidence labels (historical labels are navigation hints; current-source labels are closure evidence):' : applied ? 'Applied closure metadata evidence:' : 'Proposed closure metadata evidence in this draft:'}</p>}
          {evidence.labels.length > 0 && <div className="flex flex-wrap gap-1">{evidence.labels.map((label) => <span key={label} className="rounded border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-text-bright">{label}</span>)}</div>}
          {fullAuditEvidence.length > 0 && <FullAuditEvidenceChips evidence={fullAuditEvidence} />}
          {evidence.prIds.length > 0 && <p>PR identifiers: {evidence.prIds.join(', ')}</p>}
          {evidence.commitIds.length > 0 && <p>Commit identifiers: {evidence.commitIds.join(', ')}</p>}
        </div>
      )}
      {patch.evidence && patch.evidence.length > 0 && <ul className="list-disc pl-4 text-xs text-muted-foreground">{patch.evidence.map((entry) => <li key={entry}>{entry}</li>)}</ul>}
    </article>
  );
}

function RecommendationValidationWarning({ validation }: { validation: RecommendationReferenceValidationResult }) {
  if (validation.valid) return null;
  return (
    <PreviewBlock title="Invalid generated recommendation references">
      <div className="grid gap-2 rounded border border-destructive/40 bg-destructive/10 p-2 text-xs">
        <p className="text-destructive-foreground">Generated recommendations reference backlog records that are closed, missing, or otherwise invalid. Normal curation apply is disabled until you explicitly discard generated recommendations.</p>
        <ul className="grid gap-1 text-muted-foreground">
          {validation.issues.map((issue) => (
            <li key={`${issue.path}:${issue.kind}:${issue.id}:${issue.reason}`}>
              <span className="font-mono text-foreground">{validationIssueLabel(issue)}</span>{issue.title ? ` — ${issue.title}` : ''}<span className="block text-destructive-foreground">{issue.message}</span>
            </li>
          ))}
        </ul>
      </div>
    </PreviewBlock>
  );
}

// --- eforge:region recommendation-detail-preview ---
function GeneratedRecommendations({ recommendations, metadata }: { recommendations: RecommendationModel; metadata: ReturnType<typeof projectionMetadataDisplay> }) {
  const counts = recommendationSummaryCounts(recommendations);
  return (
    <PreviewBlock title="Effective generated recommendations (read-only)">
      <div className="grid gap-2 text-xs text-muted-foreground">
        <p>{counts.activeWork} active work items · {counts.readyCandidates} ready candidates · {counts.nextSequence} next-sequence items · {counts.safeParallelGroups} safe-parallel groups · {counts.blockedChains} blocked chains</p>
        {metadata.removedItemIds.length > 0 && <p>Removed item ids: {metadata.removedItemIds.join(', ')}</p>}
        {metadata.removedEpicIds.length > 0 && <p>Removed epic ids: {metadata.removedEpicIds.join(', ')}</p>}
        {metadata.repositioned.length > 0 && <p>Repositioned item ids: {metadata.repositioned.join(', ')}</p>}
        <RecommendationEntrySection title="Active work" entries={recommendations.activeWork ?? []} />
        <RecommendationEntrySection title="Ready candidates" entries={recommendations.readyCandidates ?? []} />
        <RecommendationEntrySection title="Recommended next sequence" entries={recommendations.recommendedNextSequence ?? []} />
        <RecommendationGroupSection title="Safe-parallel groups" groups={recommendations.safeParallelizableGroups ?? []} />
        <RecommendationBlockedChainSection chains={recommendations.blockedChains ?? []} />
        {recommendations.rationaleAndAssumptions && recommendations.rationaleAndAssumptions.length > 0 && <ul className="list-disc pl-4">{recommendations.rationaleAndAssumptions.map((entry) => <li key={entry}>{entry}</li>)}</ul>}
      </div>
    </PreviewBlock>
  );
}

function RecommendationEntrySection({ title, entries }: { title: string; entries: NonNullable<RecommendationModel['recommendedNextSequence']> }) {
  if (entries.length === 0) return null;
  return (
    <details className="rounded border border-border p-2" open>
      <summary className="cursor-pointer text-xs font-medium text-foreground">{title} ({entries.length})</summary>
      <ul className="mt-1 grid gap-1.5">
        {entries.map((entry, index) => (
          <li key={`${entry.ref ?? entry.itemId}:${index}`}>
            <span className="font-mono text-foreground">{entry.itemId}</span>{entry.title ? ` — ${entry.title}` : ''}{entry.rationale ? <span className="block">{entry.rationale}</span> : null}
          </li>
        ))}
      </ul>
    </details>
  );
}

function RecommendationGroupSection({ title, groups }: { title: string; groups: NonNullable<RecommendationModel['safeParallelizableGroups']> }) {
  if (groups.length === 0) return null;
  return (
    <details className="rounded border border-border p-2" open>
      <summary className="cursor-pointer text-xs font-medium text-foreground">{title} ({groups.length})</summary>
      <ul className="mt-1 grid gap-1.5">
        {groups.map((group) => (
          <li key={group.ref}>
            <span className="font-mono text-foreground">{group.ref}</span>{group.title ? ` — ${group.title}` : ''}
            <span className="block">Items: {group.itemIds.join(', ') || 'none'}{group.epicIds && group.epicIds.length > 0 ? ` · Epics: ${group.epicIds.join(', ')}` : ''}{group.recommendedProfile ? ` · Profile: ${group.recommendedProfile}` : ''}</span>
            {group.rationale ? <span className="block">{group.rationale}</span> : null}
          </li>
        ))}
      </ul>
    </details>
  );
}

function RecommendationBlockedChainSection({ chains }: { chains: NonNullable<RecommendationModel['blockedChains']> }) {
  if (chains.length === 0) return null;
  return (
    <details className="rounded border border-border p-2" open>
      <summary className="cursor-pointer text-xs font-medium text-foreground">Blocked chains ({chains.length})</summary>
      <ul className="mt-1 grid gap-1.5">
        {chains.map((chain, index) => (
          <li key={`${chain.ref ?? chain.itemIds.join(',')}:${index}`}>
            <span className="font-mono text-foreground">{chain.ref ?? `chain-${index + 1}`}</span>
            <span className="block">Items: {chain.itemIds.join(', ') || 'none'} · Blocked by: {chain.blockedBy.join(', ') || 'none'}</span>
            {chain.rationale ? <span className="block">{chain.rationale}</span> : null}
          </li>
        ))}
      </ul>
    </details>
  );
}
// --- eforge:endregion recommendation-detail-preview ---
