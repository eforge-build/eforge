import { ArrowUpRight, Lightbulb } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { RecommendationFreshnessBadge } from '@/components/recommendation-freshness';
import { formatRelativeTime } from '@/lib/format-time';
import type { RecommendationFreshnessView, RecommendationModel, RecommendationStatus } from '@/types';
import type { BacklogSelection } from '@/hooks/use-backlog-selection';

const MAX_NEXT = 5;

// One-line freshness summary for the digest header area. The verbose reason and
// fingerprints stay in the Plan with AI focus; here we keep it to a glance, with
// the full reason available on hover.
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
  lensTag: string;
  lensItemIds: Set<string>;
  busy: boolean;
  /** Open the full planning workspace (Plan with AI focus). */
  onOpenPlanning: () => void;
}

/**
 * Condensed recommendation digest for the context rail: just the next-up
 * sequence and the planning lanes, each actionable. The full model (rationale,
 * blocked chains, what-changed, per-item chips) lives in the Plan with AI focus,
 * one click away via the header link.
 */
export function RecommendationsRail({ recommendations, status, freshness, selection, lensTag, lensItemIds, busy, onOpenPlanning }: RecommendationsRailProps) {
  if (!recommendations && !status && !freshness) return null;
  const next = (recommendations?.recommendedNextSequence ?? []).slice(0, MAX_NEXT);
  const groups = recommendations?.safeParallelizableGroups ?? [];
  const label = (id: string) => selection.titles.get(id) ?? id;
  const freshnessLine = freshnessSummary(status);

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Lightbulb className="h-4 w-4 text-[color:var(--lane-ready)]" /> Recommendations
          <RecommendationFreshnessBadge freshness={freshness} status={status} />
          <button type="button" onClick={onOpenPlanning} className="ml-auto inline-flex items-center gap-0.5 text-2xs text-muted-foreground hover:text-foreground" title="Open the full planning workspace">
            Open <ArrowUpRight className="h-3 w-3" />
          </button>
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        {freshnessLine && <p className="text-2xs text-muted-foreground" title={freshnessLine.detail}>{freshnessLine.text}</p>}
        {next.length === 0 && groups.length === 0 && (
          <p className="text-2xs text-muted-foreground">No planning guidance yet. Open planning to analyze the backlog.</p>
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
                    <span className="line-clamp-2 text-2xs leading-snug text-foreground">{label(entry.itemId)}</span>
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
                const lensCount = lensTag ? group.itemIds.filter((id) => lensItemIds.has(id)).length : 0;
                return (
                  <div key={group.ref} className={`rounded-md border p-2 ${lensTag && lensCount > 0 ? 'border-[color:var(--lane-ready)]/50' : 'border-border'}`}>
                    <div className="flex items-center gap-1.5">
                      <span className="min-w-0 flex-1 truncate text-2xs font-semibold text-text-bright" title={title}>{title}</span>
                      {lensTag && lensCount > 0 && (
                        <span className="shrink-0 rounded border border-[color:var(--lane-ready)]/40 bg-[color:var(--lane-ready)]/10 px-1 text-2xs text-[color:var(--lane-ready)]" title={`${lensCount} tagged “${lensTag}”`}>{lensCount} in {lensTag}</span>
                      )}
                    </div>
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
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
