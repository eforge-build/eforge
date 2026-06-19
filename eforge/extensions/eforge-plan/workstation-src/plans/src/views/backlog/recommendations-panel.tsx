import * as React from 'react';
import { Lightbulb, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CollapsiblePanel } from '@/components/collapsible-panel';
import { formatRelativeTime, shortTaskId } from '@/lib/format-time';
import type { PlanningAgentTaskRecord, RecommendationFreshnessView, RecommendationModel, RecommendationStaleReason, RecommendationStatus, RecommendationStatusState } from '@/types';
import { RecommendationFreshnessBadge, RecommendationFreshnessLine, recommendationFreshnessState } from '@/components/recommendation-freshness';
import { shortId } from './board-model';

interface RecommendationsPanelProps {
  recommendations: RecommendationModel | null;
  status: RecommendationStatus | null;
  freshness?: RecommendationFreshnessView | null;
  activeRefreshTask?: PlanningAgentTaskRecord | null;
  titles: Map<string, string>;
  // Ids currently selected in the backlog; recommendation chips reflect this.
  selected: Set<string>;
  // Ids of backlog items that are ready to plan; lane planning is limited to these.
  readyIds: Set<string>;
  // Adds a single recommended item to the backlog selection and scrolls it into
  // view. Clicking does not start a plan - planning starts from the selection.
  onPickItem: (itemId: string) => void;
  // Toggles every item in a recommended group in the backlog selection.
  onPickItems: (itemIds: string[]) => void;
  // Starts a planning task directly from a lane's ready items (one-click path).
  onPlanItems: (itemIds: string[], recommendationRef?: string) => Promise<void>;
  // Active perspective lens: lanes touching it are flagged with their match count.
  lensTag?: string;
  lensItemIds?: Set<string>;
  busy?: boolean;
}

export function RecommendationsPanel({ recommendations, status, freshness, activeRefreshTask, titles, selected, readyIds, lensTag = '', lensItemIds, onPickItem, onPickItems, onPlanItems, busy }: RecommendationsPanelProps) {
  if (!recommendations && !status && !freshness) return null;
  const next = recommendations?.recommendedNextSequence ?? [];
  const groups = recommendations?.safeParallelizableGroups ?? [];
  const chains = recommendations?.blockedChains ?? [];
  const rationale = recommendations?.rationaleAndAssumptions ?? [];
  const hasGuidance = next.length > 0 || groups.length > 0 || chains.length > 0 || rationale.length > 0;
  const state = recommendationFreshnessState(freshness, status);
  const label = (id: string) => titles.get(id) ?? shortId(id);
  // The refresh task also appears in the Plan with AI task list; here we only
  // surface compact progress so the two panels never disagree.
  const refreshing = activeRefreshTask?.status === 'queued' || activeRefreshTask?.status === 'running';
  const staleReasons = status?.reasons?.length ? status.reasons : status?.staleReasons ?? [];

  const summary = (
    <>
      <RecommendationFreshnessBadge freshness={freshness} status={status} />
      {groups.length > 0 && <span className="rounded border border-[color:var(--lane-ready)]/40 bg-[color:var(--lane-ready)]/10 px-1.5 py-0.5 text-2xs text-[color:var(--lane-ready)]">{groups.length} lanes</span>}
      {next.length > 0 && <span className="rounded border border-[color:var(--lane-ready)]/40 bg-[color:var(--lane-ready)]/10 px-1.5 py-0.5 text-2xs text-[color:var(--lane-ready)]">{next.length} next</span>}
      {refreshing && (
        <span className="inline-flex items-center gap-1 rounded border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-2xs text-text-bright">
          <Loader2 className="h-3 w-3 animate-spin" /> refreshing
        </span>
      )}
    </>
  );

  return (
    <CollapsiblePanel
      storageKey="eforge-plan:panel:recommendations"
      className="border-[color:var(--lane-ready)]/30 bg-[color:var(--lane-ready)]/5"
      icon={<Lightbulb className="h-4 w-4 text-[color:var(--lane-ready)]" />}
      title="Recommendations"
      summary={summary}
    >
      <div className="mb-2">
        <p className="text-xs text-muted-foreground">{statusCopy(state, refreshing, Boolean(recommendations))}</p>
        <FreshnessLine status={status} />
        <RecommendationFreshnessLine freshness={freshness} status={status} />
      </div>

      {refreshing && activeRefreshTask && (
        <p className="mb-2 inline-flex items-center gap-2 text-xs text-muted-foreground" title={`Refresh task ${activeRefreshTask.taskId}`}>
          <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
          {activeRefreshTask.metadata?.progressMessage ?? 'Refreshing recommendations…'}
        </p>
      )}
      {activeRefreshTask?.status === 'failed' && (
        <p className="mb-2 text-xs text-destructive-foreground" title={`Refresh task ${activeRefreshTask.taskId}`}>
          The last refresh ({shortTaskId(activeRefreshTask.taskId)}) failed{activeRefreshTask.errorMessage ? `: ${activeRefreshTask.errorMessage}` : '.'} See Plan with AI to retry.
        </p>
      )}

      {state === 'stale' && !refreshing && staleReasons.length > 0 && (
        <div className="mb-2 rounded-md border border-[color:var(--prio-medium)]/30 bg-[color:var(--prio-medium)]/10 p-2">
          <span className="block text-2xs font-semibold uppercase tracking-wide text-muted-foreground">What changed</span>
          <ul className="mt-1 grid gap-1 text-xs text-muted-foreground">
            {staleReasons.map((reason, index) => (
              <li key={`${reason.code ?? reason.eventType ?? 'reason'}:${reason.timestamp ?? index}`}>
                <div>{reasonText(reason)}</div>
                <div className="mt-0.5 flex flex-wrap gap-1 text-2xs">
                  {(reason.code ?? reason.eventType) && <Chip>{reason.code ?? reason.eventType}</Chip>}
                  {reason.eventType && <Chip>event {reason.eventType}</Chip>}
                  {reason.correlationKind && <Chip>{reason.correlationKind}</Chip>}
                  {reason.timestamp && <span title={reason.timestamp}><Chip>{formatRelativeTime(reason.timestamp) ?? reason.timestamp}</Chip></span>}
                  {reason.itemIds?.map((id) => <Chip key={id}>{label(id)}</Chip>)}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!hasGuidance && (
        <p className="text-xs text-muted-foreground">
          {state === 'missing' ? 'No generated recommendation model is available yet.' : 'The current recommendation model does not include visible guidance.'}
        </p>
      )}

      {groups.length > 0 && (
        <div className="mb-3">
          <span className="mb-1 block text-2xs font-semibold uppercase tracking-wide text-muted-foreground">Planning lanes · safe to plan in parallel</span>
          <div className="grid gap-2 lg:grid-cols-2">
            {groups.map((group) => (
              <PlanningLaneCard key={group.ref} group={group} label={label} selected={selected} readyIds={readyIds} lensTag={lensTag} lensItemIds={lensItemIds} busy={busy} onPickItem={onPickItem} onPickItems={onPickItems} onPlanItems={onPlanItems} />
            ))}
          </div>
        </div>
      )}

      {next.length > 0 && (
        <div className="mb-2">
          <span className="mb-1 block text-2xs font-semibold uppercase tracking-wide text-muted-foreground">Recommended next sequence</span>
          <div className="flex flex-wrap gap-2">
            {next.map((entry, index) => (
              <button
                key={entry.ref ?? entry.itemId}
                type="button"
                title={entry.rationale ? `${entry.rationale}\n\nClick to select this item in the backlog.` : 'Click to select this item in the backlog.'}
                onClick={() => onPickItem(entry.itemId)}
                className={`inline-flex max-w-80 items-center gap-2 rounded-md border bg-card px-2 py-1 text-left transition-colors hover:border-primary ${selected.has(entry.itemId) ? 'border-primary ring-1 ring-primary' : 'border-border'}`}
              >
                <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[color:var(--lane-ready)]/20 text-xs font-bold text-[color:var(--lane-ready)]">{index + 1}</span>
                <span className="line-clamp-2 text-xs leading-snug text-foreground">{label(entry.itemId)}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {(chains.length > 0 || rationale.length > 0) && (
        <details className="mt-1 border-t border-border pt-2">
          <summary className="cursor-pointer text-xs text-muted-foreground">Blocked chains &amp; rationale</summary>

          {chains.length > 0 && (
            <div className="mt-2">
              <span className="block text-2xs font-semibold uppercase tracking-wide text-muted-foreground">Blocked chains</span>
              <ul className="mt-1 grid gap-2">
                {chains.map((chain, index) => (
                  <li key={chain.ref ?? index}>
                    <div className="flex flex-wrap items-center gap-1">
                      {chain.itemIds.map((id) => <Chip key={id} tone="bad">{label(id)}</Chip>)}
                      <span className="text-2xs text-muted-foreground">blocked by</span>
                      {chain.blockedBy.map((id) => <Chip key={id} tone="warn">{label(id)}</Chip>)}
                    </div>
                    {chain.rationale && <span className="mt-0.5 block text-xs text-muted-foreground">{chain.rationale}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {rationale.length > 0 && (
            <div className="mt-2">
              <span className="block text-2xs font-semibold uppercase tracking-wide text-muted-foreground">Rationale and assumptions</span>
              <ul className="mt-1 list-disc pl-4 text-xs text-muted-foreground">
                {rationale.map((entry) => <li key={entry}>{entry}</li>)}
              </ul>
            </div>
          )}
        </details>
      )}
    </CollapsiblePanel>
  );
}

interface PlanningLaneCardProps {
  group: RecommendationModel['safeParallelizableGroups'][number];
  label: (id: string) => string;
  selected: Set<string>;
  readyIds: Set<string>;
  lensTag?: string;
  lensItemIds?: Set<string>;
  busy?: boolean;
  onPickItem: (itemId: string) => void;
  onPickItems: (itemIds: string[]) => void;
  onPlanItems: (itemIds: string[], recommendationRef?: string) => Promise<void>;
}

/**
 * First-class card for a safe parallelizable group - the primary path into
 * planning. "Plan lane" starts a planning task from the lane's ready items in
 * one click; "Select group" toggles every item into the backlog selection for
 * manual curation via "Promote to a build plan". Individual chips toggle
 * single items.
 */
function PlanningLaneCard({ group, label, selected, readyIds, lensTag = '', lensItemIds, busy, onPickItem, onPickItems, onPlanItems }: PlanningLaneCardProps) {
  const title = group.title ?? group.ref;
  const allSelected = group.itemIds.length > 0 && group.itemIds.every((id) => selected.has(id));
  const readyCount = group.itemIds.filter((id) => readyIds.has(id)).length;
  const lensCount = lensItemIds ? group.itemIds.filter((id) => lensItemIds.has(id)).length : 0;
  return (
    <div className={`flex flex-col gap-1.5 rounded-md border bg-card p-2.5 ${allSelected ? 'border-primary ring-1 ring-primary' : lensTag && lensCount > 0 ? 'border-[color:var(--lane-ready)]/50' : 'border-border'}`}>
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold text-text-bright">{title}</span>
        {lensTag && lensCount > 0 && (
          <span className="rounded border border-[color:var(--lane-ready)]/40 bg-[color:var(--lane-ready)]/10 px-1.5 py-0.5 text-2xs text-[color:var(--lane-ready)]" title={`${lensCount} item${lensCount === 1 ? '' : 's'} in this lane are tagged “${lensTag}”`}>
            {lensCount} in {lensTag}
          </span>
        )}
      </div>
      <div className="flex flex-wrap gap-1">
        {group.itemIds.map((id) => (
          <button
            key={id}
            type="button"
            title="Click to toggle this item in the backlog selection"
            onClick={() => onPickItem(id)}
            className={`rounded border px-1.5 py-0.5 text-left text-2xs leading-snug transition-colors hover:border-primary ${selected.has(id) ? 'border-primary bg-primary/10 text-text-bright' : 'border-border bg-background/40 text-foreground'}`}
          >
            {label(id)}
          </button>
        ))}
      </div>
      {group.rationale && <p className="text-xs text-muted-foreground">{group.rationale}</p>}
      <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
        <Button
          size="sm"
          disabled={busy || readyCount === 0}
          aria-label={`Plan lane ${title}`}
          title={readyCount === 0 ? 'No items in this lane are ready to plan.' : 'Start an AI planning task for this lane’s ready items.'}
          onClick={() => void onPlanItems(group.itemIds, group.ref)}
        >
          Plan lane{readyCount < group.itemIds.length ? ` (${readyCount} ready)` : ''}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          aria-label={`${allSelected ? 'Clear' : 'Select'} group ${title}`}
          title={allSelected ? 'Remove every item in this lane from the selection' : 'Add every item in this lane to the selection, then use "Promote to a build plan"'}
          onClick={() => onPickItems(group.itemIds)}
        >
          {allSelected ? 'Clear group' : 'Select group'}
        </Button>
      </div>
    </div>
  );
}

function statusCopy(state: RecommendationStatusState | null, refreshing: boolean, hasRecommendations: boolean): string {
  if (refreshing) return 'A refresh is running now - recommendations will update when it finishes.';
  if (state === 'missing') return 'No current recommendations are stored; run Analyze all backlog from Plan with AI to curate records and generate recommendations.';
  if (state === 'stale') return 'The backlog has changed since these recommendations were generated; run Analyze all backlog before planning from them.';
  if (state === 'fresh') return 'Recommendations are up to date with the current backlog.';
  return hasRecommendations ? 'Recommendations are available; freshness status has not been provided by the server.' : 'No recommendation freshness status has been provided by the server.';
}

// Plain-language translations for machine reason codes. Unknown codes fall
// back to the daemon-provided summary/message.
const FRIENDLY_REASON: Record<string, string> = {
  'source-fingerprint-drift': 'The backlog changed since recommendations were last applied.',
};

function reasonText(reason: RecommendationStaleReason): string {
  return (reason.code && FRIENDLY_REASON[reason.code]) || reason.summary || reason.message || 'Recommendation freshness changed.';
}

function FreshnessLine({ status }: { status: RecommendationStatus | null }) {
  if (!status) return null;
  const fresh = formatRelativeTime(status.freshAt);
  const stale = formatRelativeTime(status.staleSince);
  if (!fresh && !stale) return null;
  return (
    <p className="mt-0.5 text-2xs text-muted-foreground">
      {fresh && <span title={`${status.freshAt}${status.lastRefreshedBy ? ` via ${status.lastRefreshedBy}` : ''}`}>Updated {fresh}</span>}
      {fresh && stale && ' · '}
      {stale && <span title={status.staleSince}>stale since {stale}</span>}
    </p>
  );
}

const CHIP_TONE: Record<string, string> = {
  default: 'border-border text-[color:var(--lane-ready)] bg-[color:var(--lane-ready)]/10',
  bad: 'border-[color:var(--lane-blocked)]/30 text-[color:var(--lane-blocked)] bg-[color:var(--lane-blocked)]/10',
  warn: 'border-[color:var(--prio-medium)]/30 text-[color:var(--prio-medium)] bg-[color:var(--prio-medium)]/10',
};

function Chip({ children, tone = 'default' }: { children: React.ReactNode; tone?: string }) {
  return <span className={`rounded border px-1.5 py-0.5 text-2xs ${CHIP_TONE[tone] ?? CHIP_TONE.default}`}>{children}</span>;
}
