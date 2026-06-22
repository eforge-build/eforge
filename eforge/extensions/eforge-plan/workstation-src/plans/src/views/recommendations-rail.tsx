import * as React from 'react';
import { GitFork, Lightbulb } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { RecommendationFreshnessBadge } from '@/components/recommendation-freshness';
import { formatRelativeTime } from '@/lib/format-time';
import type { RecommendationFreshnessView, RecommendationModel, RecommendationStatus } from '@/types';
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

/**
 * The AI planning co-pilot for the Backlog focus. It triggers backlog analysis
 * (which is what generates recommendations), then surfaces the next-up sequence
 * and the planning lanes, each actionable, with blocked chains and rationale a
 * disclosure away. The board stays the focal pane; this rides alongside it.
 */
export function RecommendationsRail({ recommendations, status, freshness, selection, busy, analyzing, onAnalyze, onForkLane }: RecommendationsRailProps) {
  const [forkingRef, setForkingRef] = React.useState<string | null>(null);
  const fork = (ref: string) => { setForkingRef(ref); void onForkLane(ref).finally(() => setForkingRef(null)); };
  const next = (recommendations?.recommendedNextSequence ?? []).slice(0, MAX_NEXT);
  const groups = recommendations?.safeParallelizableGroups ?? [];
  const chains = recommendations?.blockedChains ?? [];
  const rationale = recommendations?.rationaleAndAssumptions ?? [];
  const label = (id: string) => selection.titles.get(id) ?? id;
  const freshnessLine = freshnessSummary(status);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Lightbulb className="h-4 w-4 text-[color:var(--lane-ready)]" /> Recommendations
          <RecommendationFreshnessBadge freshness={freshness} status={status} />
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        <AnalyzeBacklogControl busy={busy} analyzing={analyzing} onAnalyze={onAnalyze} />
        {freshnessLine && <p className="text-2xs text-muted-foreground" title={freshnessLine.detail}>{freshnessLine.text}</p>}
        {next.length === 0 && groups.length === 0 && (
          <p className="text-2xs text-muted-foreground">No planning guidance yet. Analyze the backlog to generate recommendations.</p>
        )}

        {next.length > 0 && (
          <div>
            <span className="mb-1 block text-2xs font-semibold uppercase tracking-wide text-muted-foreground">Next up</span>
            <ol className="grid gap-1">
              {next.map((entry, index) => (
                <li key={entry.ref ?? `seq-${index}-${entry.itemId}`}>
                  <button
                    type="button"
                    onClick={() => selection.pickItem(entry.itemId)}
                    title="Toggle this item in the backlog selection"
                    className={`flex w-full items-center gap-2 rounded border px-1.5 py-1 text-left transition-colors hover:border-primary ${selection.selected.has(entry.itemId) ? 'border-primary bg-primary/10' : 'border-border'}`}
                  >
                    <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-[color:var(--lane-ready)]/20 text-2xs font-bold text-[color:var(--lane-ready)]">{index + 1}</span>
                    <span className="line-clamp-2 min-w-0 break-words text-2xs leading-snug text-foreground">{label(entry.itemId)}</span>
                  </button>
                </li>
              ))}
            </ol>
          </div>
        )}

        {groups.length > 0 && (
          <div>
            <span className="mb-1 block text-2xs font-semibold uppercase tracking-wide text-muted-foreground">Lanes · safe in parallel</span>
            <div className="grid gap-1.5">
              {groups.map((group) => {
                const title = group.title ?? group.ref;
                const readyCount = group.itemIds.filter((id) => selection.readyIds.has(id)).length;
                return (
                  <div key={group.ref} className="rounded-md border border-border p-2">
                    <span className="block min-w-0 truncate text-2xs font-semibold text-text-bright" title={title}>{title}</span>
                    <div className="mt-1.5 flex items-center gap-2">
                      <Button
                        size="sm"
                        className="h-6 px-2 text-2xs"
                        disabled={busy || readyCount === 0}
                        title={readyCount === 0 ? 'No items in this lane are ready to plan.' : 'Start an AI planning task for this lane’s ready items.'}
                        onClick={() => void selection.planLane(group.itemIds, group.ref)}
                      >
                        Plan{readyCount < group.itemIds.length ? ` (${readyCount})` : ''}
                      </Button>
                      <button
                        type="button"
                        onClick={() => selection.pickItems(group.itemIds)}
                        className="text-2xs text-muted-foreground hover:text-foreground"
                        title="Toggle every item in this lane in the backlog selection"
                      >
                        Select
                      </button>
                      <button
                        type="button"
                        disabled={forkingRef !== null}
                        onClick={() => fork(group.ref)}
                        className="ml-auto inline-flex items-center gap-0.5 text-2xs text-muted-foreground hover:text-foreground disabled:opacity-50"
                        title="Fork this lane into an editable draft plan unit"
                      >
                        <GitFork className="h-3 w-3" /> {forkingRef === group.ref ? 'Forking…' : 'Fork to draft'}
                      </button>
                    </div>
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
      </CardContent>
    </Card>
  );
}
