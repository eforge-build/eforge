import * as React from 'react';
import { GitFork, Lightbulb } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { RailCard } from '@/components/ui/rail-card';
import { RecommendationFreshnessBadge } from '@/components/recommendation-freshness';
import { formatRelativeTime } from '@/lib/format-time';
import type { RecommendationActionabilityLink, RecommendationActionabilityProjection, RecommendationGroupActionability, RecommendationItemActionability, RecommendationEntry, RecommendationFreshnessView, RecommendationModel, RecommendationStatus } from '@/types';
import type { BacklogSelection } from '@/hooks/use-backlog-selection';
import { AnalyzeBacklogControl } from './backlog/analyze-backlog-control';

const MAX_NEXT = 5;

// One-line freshness summary for the digest header area. The verbose reason and
// fingerprints stay out of the rail; here we keep it to a glance, with the full
// reason available on hover.
function freshnessSummary(status: RecommendationStatus | null): { text: string; detail?: string } | null {
  if (!status) return null;
  const reason = status.reasons?.[0] ?? status.staleReasons?.[0];
  if (status.state === 'stale') {
    const since = formatRelativeTime(status.staleSince);
    return { text: since ? `Stale since ${since}` : 'Stale - re-analyze before planning', detail: reason?.summary ?? reason?.message };
  }
  if (status.state === 'fresh') {
    const at = formatRelativeTime(status.freshAt);
    return { text: at ? `Fresh as of ${at}` : 'Fresh with the current backlog' };
  }
  return null;
}

interface RecommendationsRailProps {
  recommendations: RecommendationModel | null;
  actionability: RecommendationActionabilityProjection | null;
  status: RecommendationStatus | null;
  freshness: RecommendationFreshnessView | null;
  selection: BacklogSelection;
  busy: boolean;
  /** A backlog-curation task is queued/running - the analyze trigger reflects it rather than inviting a duplicate. */
  analyzing: boolean;
  /** Curate the backlog and regenerate recommendations. */
  onAnalyze: () => Promise<unknown>;
  /** Fork a recommendation lane into an editable draft plan unit. */
  onForkLane: (recommendationRef: string) => Promise<void>;
}

interface ActionabilityIndex {
  entriesByRef: Map<string, RecommendationItemActionability>;
  entriesByItemId: Map<string, RecommendationItemActionability>;
  groupsByRef: Map<string, RecommendationGroupActionability>;
}

/**
 * The AI planning co-pilot for the Backlog focus. It triggers backlog analysis
 * (which is what generates recommendations), then surfaces the next-up sequence
 * and planning lanes using the server-provided actionability projection, with
 * blocked chains and rationale a disclosure away. The board stays the focal pane;
 * this rides alongside it.
 */
export function RecommendationsRail({ recommendations, actionability, status, freshness, selection, busy, analyzing, onAnalyze, onForkLane }: RecommendationsRailProps) {
  const [forkingRef, setForkingRef] = React.useState<string | null>(null);
  const fork = (ref: string) => { setForkingRef(ref); void onForkLane(ref).finally(() => setForkingRef(null)); };
  const next = (recommendations?.recommendedNextSequence ?? []).slice(0, MAX_NEXT);
  const groups = recommendations?.safeParallelizableGroups ?? [];
  const chains = recommendations?.blockedChains ?? [];
  const rationale = recommendations?.rationaleAndAssumptions ?? [];
  const label = (id: string) => selection.titles.get(id) ?? id;
  const freshnessLine = freshnessSummary(status);
  const actionabilityIndex = React.useMemo(() => buildActionabilityIndex(actionability), [actionability]);

  return (
    <RailCard
      icon={Lightbulb}
      iconClassName="text-[color:var(--lane-ready)]"
      title="Recommendations"
      action={<RecommendationFreshnessBadge freshness={freshness} status={status} />}
      contentClassName="grid gap-3"
    >
        <AnalyzeBacklogControl busy={busy} analyzing={analyzing} onAnalyze={onAnalyze} />
        {freshnessLine && <p className="text-2xs text-muted-foreground" title={freshnessLine.detail}>{freshnessLine.text}</p>}
        {next.length === 0 && groups.length === 0 && (
          <p className="text-2xs text-muted-foreground">No planning guidance yet. Analyze the backlog to generate recommendations.</p>
        )}

        {next.length > 0 && (
          <div>
            <span className="mb-1 block text-2xs font-semibold uppercase tracking-wide text-muted-foreground">Next up</span>
            <ol className="grid gap-1">
              {next.map((entry, index) => {
                const itemActionability = actionabilityIndex ? actionabilityForEntry(actionabilityIndex, entry) : undefined;
                const suppressed = actionabilityIndex !== null && itemActionability?.state !== 'actionable';
                return (
                  <li key={entry.ref ?? `seq-${index}-${entry.itemId}`}>
                    {suppressed ? (
                      <SuppressedItemRow ordinal={index + 1} label={label(entry.itemId)} actionability={itemActionability ?? unavailableActionability(entry.itemId)} />
                    ) : (
                      <button
                        type="button"
                        onClick={() => selection.pickItem(entry.itemId)}
                        title="Toggle this item in the backlog selection"
                        className={`flex w-full items-center gap-2 rounded border px-1.5 py-1 text-left transition-colors hover:border-primary ${selection.selected.has(entry.itemId) ? 'border-primary bg-primary/10' : 'border-border'}`}
                      >
                        <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[color:var(--lane-ready)]/20 text-2xs font-bold text-[color:var(--lane-ready)]">{index + 1}</span>
                        <span className="line-clamp-2 min-w-0 break-words text-2xs leading-snug text-foreground">{label(entry.itemId)}</span>
                      </button>
                    )}
                  </li>
                );
              })}
            </ol>
          </div>
        )}

        {groups.length > 0 && (
          <div>
            <span className="mb-1 block text-2xs font-semibold uppercase tracking-wide text-muted-foreground">Lanes · safe in parallel</span>
            <div className="grid gap-1.5">
              {groups.map((group) => {
                const title = group.title ?? group.ref;
                const groupActionability = actionabilityIndex?.groupsByRef.get(group.ref);
                const actionableIds = groupActionability ? groupActionability.actionableItemIds : actionabilityIndex ? [] : group.itemIds.filter((id) => selection.planEligibleIds.has(id));
                const fullySuppressed = actionabilityIndex !== null && (groupActionability === undefined || groupActionability.state === 'non-actionable' || actionableIds.length === 0);
                const partiallySuppressed = groupActionability?.state === 'partially-actionable';
                return (
                  <div key={group.ref} className="rounded-md border border-border p-2">
                    <span className="block min-w-0 truncate text-2xs font-semibold text-text-bright" title={title}>{title}</span>
                    {groupActionability?.items.some((item) => item.state === 'non-actionable') && (
                      <SuppressedGroupItems group={groupActionability} label={label} />
                    )}
                    {fullySuppressed ? (
                      <p className="mt-1.5 rounded border border-border bg-muted/20 px-1.5 py-1 text-2xs text-muted-foreground">No actionable items remain in this lane.</p>
                    ) : (
                      <div className="mt-1.5 flex items-center gap-2">
                        <Button
                          size="xs"
                          disabled={busy || actionableIds.length === 0}
                          title={actionableIds.length === 0 ? 'No items in this lane are eligible for a new plan.' : 'Start an AI planning task for this lane’s actionable items.'}
                          onClick={() => void selection.planLane(actionableIds, group.ref)}
                        >
                          Plan{actionableIds.length < group.itemIds.length ? ` (${actionableIds.length})` : ''}
                        </Button>
                        <button
                          type="button"
                          onClick={() => selection.pickItems(actionableIds)}
                          className="text-2xs text-muted-foreground hover:text-foreground"
                          title={partiallySuppressed ? 'Toggle the actionable items in this lane in the backlog selection' : 'Toggle every item in this lane in the backlog selection'}
                        >
                          {partiallySuppressed ? 'Select actionable' : 'Select'}
                        </button>
                        {groupActionability?.state !== 'partially-actionable' && (
                          <button
                            type="button"
                            disabled={forkingRef !== null}
                            onClick={() => fork(group.ref)}
                            className="ml-auto inline-flex items-center gap-0.5 text-2xs text-muted-foreground hover:text-foreground disabled:opacity-50"
                            title="Fork this lane into an editable draft plan unit"
                          >
                            <GitFork className="h-3 w-3" /> {forkingRef === group.ref ? 'Forking…' : 'Fork to draft'}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {(chains.length > 0 || rationale.length > 0) && (
          <details className="border-t border-border pt-2">
            <summary className="cursor-pointer text-2xs text-muted-foreground">Blocked chains &amp; rationale</summary>
            {chains.length > 0 && (
              <ul className="mt-1.5 grid gap-1.5">
                {chains.map((chain, index) => (
                  <li key={chain.ref ?? index} className="text-2xs">
                    <div className="flex flex-wrap items-center gap-1">
                      {chain.itemIds.map((id) => <span key={id} className="rounded border border-[color:var(--lane-blocked)]/30 bg-[color:var(--lane-blocked)]/10 px-1 text-[color:var(--lane-blocked)]">{label(id)}</span>)}
                      <span className="text-muted-foreground">blocked by</span>
                      {chain.blockedBy.map((id) => <span key={id} className="rounded border border-[color:var(--prio-medium)]/30 bg-[color:var(--prio-medium)]/10 px-1 text-[color:var(--prio-medium)]">{label(id)}</span>)}
                    </div>
                    {chain.rationale && <p className="mt-0.5 text-muted-foreground">{chain.rationale}</p>}
                  </li>
                ))}
              </ul>
            )}
            {rationale.length > 0 && (
              <ul className="mt-1.5 list-disc pl-4 text-2xs text-muted-foreground">
                {rationale.map((entry) => <li key={entry}>{entry}</li>)}
              </ul>
            )}
          </details>
        )}
    </RailCard>
  );
}

function buildActionabilityIndex(actionability: RecommendationActionabilityProjection | null): ActionabilityIndex | null {
  if (actionability === null) return null;
  const entries = [...actionability.activeWork, ...actionability.readyCandidates, ...actionability.recommendedNextSequence];
  return {
    entriesByRef: new Map(entries.flatMap((entry) => entry.ref ? [[entry.ref, entry.actionability] as const] : [])),
    entriesByItemId: new Map(entries.map((entry) => [entry.itemId, entry.actionability])),
    groupsByRef: new Map(actionability.safeParallelizableGroups.map((group) => [group.ref, group])),
  };
}

function actionabilityForEntry(index: ActionabilityIndex, entry: RecommendationEntry): RecommendationItemActionability | undefined {
  return (entry.ref ? index.entriesByRef.get(entry.ref) : undefined) ?? index.entriesByItemId.get(entry.itemId);
}

function unavailableActionability(itemId: string): RecommendationItemActionability {
  return {
    itemId,
    state: 'non-actionable',
    lifecycleState: 'none',
    reasonMessage: 'This recommendation is not currently available for planning.',
    associatedLinks: [],
  };
}

function SuppressedGroupItems({ group, label }: { group: RecommendationGroupActionability; label: (itemId: string) => string }) {
  const suppressedItems = group.items.filter((item) => item.state === 'non-actionable');
  if (suppressedItems.length === 0) return null;
  return (
    <div className="mt-1.5 grid gap-1">
      {suppressedItems.map((item) => (
        <SuppressedItemRow key={item.itemId} label={label(item.itemId)} actionability={item} />
      ))}
    </div>
  );
}

function SuppressedItemRow({ ordinal, label, actionability }: { ordinal?: number; label: string; actionability: RecommendationItemActionability }) {
  return (
    <div className="rounded border border-border bg-muted/20 px-1.5 py-1 text-left">
      <div className="flex items-start gap-2">
        {ordinal !== undefined && <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-muted text-2xs font-bold text-muted-foreground">{ordinal}</span>}
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 break-words text-2xs leading-snug text-foreground">{label}</p>
          <p className="mt-0.5 text-2xs text-muted-foreground">{actionability.reasonMessage ?? 'This recommendation is not currently actionable.'}</p>
          <ActionabilityLinks links={actionability.associatedLinks} />
        </div>
      </div>
    </div>
  );
}

function ActionabilityLinks({ links }: { links: RecommendationActionabilityLink[] }) {
  if (links.length === 0) return null;
  return (
    <ul className="mt-1 flex flex-wrap gap-1" aria-label="Suppression evidence links">
      {links.map((link, index) => (
        <li key={`${link.kind}-${link.label}-${index}`}>
          {link.prUrl ? (
            <a className="rounded border border-border px-1 text-2xs text-[color:var(--lane-ready)] underline" href={link.prUrl} target="_blank" rel="noreferrer" title={linkTitle(link)}>{linkLabel(link)}</a>
          ) : (
            <span className="rounded border border-border px-1 text-2xs text-muted-foreground" title={linkTitle(link)}>{linkLabel(link)}</span>
          )}
        </li>
      ))}
    </ul>
  );
}

function linkLabel(link: RecommendationActionabilityLink): string {
  return link.label || link.session || link.taskId || link.prdId || link.runId || link.sessionId || link.prUrl || link.kind;
}

function linkTitle(link: RecommendationActionabilityLink): string {
  return [
    link.label || link.kind,
    link.status ? `status: ${link.status}` : undefined,
    link.session ? `session: ${link.session}` : undefined,
    link.taskId ? `task: ${link.taskId}` : undefined,
    link.prdId ? `prd: ${link.prdId}` : undefined,
    link.runId ? `run: ${link.runId}` : undefined,
    link.sessionId ? `build session: ${link.sessionId}` : undefined,
    link.featureBranch ? `branch: ${link.featureBranch}` : undefined,
    link.commitSha ? `commit: ${link.commitSha}` : undefined,
    link.path ? `path: ${link.path}` : undefined,
  ].filter((entry): entry is string => Boolean(entry)).join('\n');
}
