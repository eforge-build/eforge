import * as React from 'react';
import { Sparkles } from 'lucide-react';
import type { RecommendationModel } from '@/types';
import { shortId } from './board-model';

interface RecommendationsPanelProps {
  recommendations: RecommendationModel | null;
  titles: Map<string, string>;
  onPromote: (selection: Record<string, unknown>, label: string) => Promise<void>;
}

export function RecommendationsPanel({ recommendations, titles, onPromote }: RecommendationsPanelProps) {
  if (!recommendations) return null;
  const next = recommendations.recommendedNextSequence ?? [];
  const groups = recommendations.safeParallelizableGroups ?? [];
  const chains = recommendations.blockedChains ?? [];
  const rationale = recommendations.rationaleAndAssumptions ?? [];
  if (next.length === 0 && groups.length === 0 && chains.length === 0 && rationale.length === 0) return null;
  const label = (id: string) => titles.get(id) ?? shortId(id);

  return (
    <section className="rounded-lg border border-[color:var(--lane-ready)]/30 bg-[color:var(--lane-ready)]/5 p-3">
      <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-text-bright">
        <Sparkles className="h-4 w-4 text-primary" /> Recommendations
      </div>

      {next.length > 0 && (
        <div className="mb-2">
          <span className="mb-1 block text-[0.65rem] font-semibold uppercase tracking-wide text-muted-foreground">Recommended next sequence</span>
          <div className="flex flex-wrap gap-2">
            {next.map((entry, index) => (
              <button
                key={entry.ref ?? entry.itemId}
                title={entry.rationale}
                onClick={() => void onPromote(entry.ref ? { recommendationRef: entry.ref } : { itemIds: [entry.itemId] }, label(entry.itemId))}
                className="inline-flex max-w-80 items-center gap-2 rounded-md border border-border bg-card px-2 py-1 text-left transition-colors hover:border-primary"
              >
                <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[color:var(--lane-ready)]/20 text-xs font-bold text-[color:var(--lane-ready)]">{index + 1}</span>
                <span className="truncate text-xs text-foreground">{label(entry.itemId)}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {(groups.length > 0 || chains.length > 0 || rationale.length > 0) && (
        <details className="mt-1 border-t border-border pt-2">
          <summary className="cursor-pointer text-xs text-muted-foreground">Parallel lanes, blocked chains &amp; rationale</summary>

          {groups.length > 0 && (
            <div className="mt-2">
              <span className="block text-[0.65rem] font-semibold uppercase tracking-wide text-muted-foreground">Safe parallelizable groups</span>
              <ul className="mt-1 grid gap-2">
                {groups.map((group) => (
                  <li key={group.ref}>
                    <button onClick={() => void onPromote({ recommendationRef: group.ref }, group.title ?? group.ref)} className="text-left text-xs font-semibold text-text-bright hover:underline">{group.title ?? group.ref}</button>
                    <div className="mt-0.5 flex flex-wrap gap-1">
                      {group.itemIds.map((id) => <Chip key={id}>{label(id)}</Chip>)}
                    </div>
                    {group.rationale && <span className="mt-0.5 block text-xs text-muted-foreground">{group.rationale}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {chains.length > 0 && (
            <div className="mt-2">
              <span className="block text-[0.65rem] font-semibold uppercase tracking-wide text-muted-foreground">Blocked chains</span>
              <ul className="mt-1 grid gap-2">
                {chains.map((chain, index) => (
                  <li key={chain.ref ?? index}>
                    <div className="flex flex-wrap items-center gap-1">
                      {chain.itemIds.map((id) => <Chip key={id} tone="bad">{label(id)}</Chip>)}
                      <span className="text-[0.7rem] text-muted-foreground">blocked by</span>
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
              <span className="block text-[0.65rem] font-semibold uppercase tracking-wide text-muted-foreground">Rationale and assumptions</span>
              <ul className="mt-1 list-disc pl-4 text-xs text-muted-foreground">
                {rationale.map((entry) => <li key={entry}>{entry}</li>)}
              </ul>
            </div>
          )}
        </details>
      )}
    </section>
  );
}

const CHIP_TONE: Record<string, string> = {
  default: 'border-border text-[color:var(--lane-ready)] bg-[color:var(--lane-ready)]/10',
  bad: 'border-[color:var(--lane-blocked)]/30 text-[color:var(--lane-blocked)] bg-[color:var(--lane-blocked)]/10',
  warn: 'border-[color:var(--prio-medium)]/30 text-[color:var(--prio-medium)] bg-[color:var(--prio-medium)]/10',
};

function Chip({ children, tone = 'default' }: { children: React.ReactNode; tone?: string }) {
  return <span className={`rounded border px-1.5 py-0.5 text-[0.68rem] ${CHIP_TONE[tone] ?? CHIP_TONE.default}`}>{children}</span>;
}
