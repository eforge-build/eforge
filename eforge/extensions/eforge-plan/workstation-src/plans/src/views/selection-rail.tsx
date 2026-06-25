import { ListChecks, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { RailCard } from '@/components/ui/rail-card';
import type { BacklogSelection } from '@/hooks/use-backlog-selection';

const MAX_CHIPS = 8;

/**
 * Selection staging card in the context rail - the visible home for "what I'm
 * about to plan." It replaces the easy-to-miss floating bar: because the rail is
 * sticky, the current selection (and the Promote action) stays in view while you
 * scroll the board or pick items from recommendations. This is also the seed of
 * the editable convergence work - a selection is a draft plan unit in waiting.
 */
export function SelectionRail({ selection, busy }: { selection: BacklogSelection; busy: boolean }) {
  const ids = selection.selectedIds;
  if (ids.length === 0) return null;
  const eligibleCount = selection.selectedPlanEligibleIds.length;
  const shown = ids.slice(0, MAX_CHIPS);
  const hidden = ids.length - shown.length;

  return (
    <RailCard
      className="border-primary/50"
      icon={ListChecks}
      iconClassName="text-primary"
      title="Build plan"
      action={
        <span className="ml-auto text-2xs font-normal text-muted-foreground">
          {ids.length} selected{eligibleCount !== ids.length ? ` · ${eligibleCount} eligible` : ''}
        </span>
      }
      contentClassName="grid gap-2"
    >
        <div className="flex flex-wrap gap-1">
          {shown.map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => selection.toggle(id)}
              title="Remove from selection"
              className="inline-flex items-center gap-1 rounded border border-border bg-background/40 px-1.5 py-0.5 text-2xs text-foreground transition-colors hover:border-primary"
            >
              <span className="max-w-40 truncate">{selection.titles.get(id) ?? id}</span>
              <X className="h-3 w-3 text-muted-foreground" />
            </button>
          ))}
          {hidden > 0 && <span className="px-1 text-2xs text-muted-foreground">+{hidden} more</span>}
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" className="flex-1" disabled={busy || eligibleCount === 0} onClick={() => void selection.promote()}>
            Promote to a build plan
          </Button>
          <Button size="sm" variant="ghost" onClick={selection.clear}>Clear</Button>
        </div>
        {eligibleCount === 0 && <p className="text-2xs text-muted-foreground">None of the selected items are eligible for a new plan.</p>}
    </RailCard>
  );
}
