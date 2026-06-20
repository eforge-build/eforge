import * as React from 'react';
import { Loader2, Scissors } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/toast';
import { draftKey } from '@/lib/plan-links';
import type { DraftPlanUnit, DraftUnitAdvisory, SplitDraftUnitInput, SplitDraftUnitResponse } from '@/types';
import { DraftUnitAdvisoryNotice } from './draft-unit-advisory';

interface DraftUnitSplitPanelProps {
  unit: DraftPlanUnit;
  titles: Map<string, string>;
  onAdvise: (unitId: string, itemIds: string[]) => Promise<DraftUnitAdvisory>;
  onSplit: (input: SplitDraftUnitInput) => Promise<SplitDraftUnitResponse>;
  onClose: () => void;
  onOpenUnit?: (key: string) => void;
}

/**
 * Inline panel to peel a subset of a draft unit's items into a new unit. The
 * dependency advisory previews live as the selection changes (read-only), so the
 * user sees whether the split separates a dependency before committing. A valid
 * split keeps at least one item on each side.
 */
export function DraftUnitSplitPanel({ unit, titles, onAdvise, onSplit, onClose, onOpenUnit }: DraftUnitSplitPanelProps) {
  const toast = useToast();
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [title, setTitle] = React.useState('');
  const [advisory, setAdvisory] = React.useState<DraftUnitAdvisory | null>(null);
  const [busy, setBusy] = React.useState(false);
  const label = (id: string) => titles.get(id) ?? id;

  const peelIds = React.useMemo(() => unit.items.filter((item) => selected.has(item.itemId)).map((item) => item.itemId), [unit.items, selected]);
  const validSubset = peelIds.length > 0 && peelIds.length < unit.items.length;

  // Preview the advisory whenever the peel set is a valid strict subset; clear it
  // otherwise so a stale advisory never lingers under an invalid selection.
  React.useEffect(() => {
    if (!validSubset) { setAdvisory(null); return; }
    let active = true;
    void onAdvise(unit.unitId, peelIds).then((result) => { if (active) setAdvisory(result); }).catch(() => { if (active) setAdvisory(null); });
    return () => { active = false; };
  }, [validSubset, peelIds, unit.unitId, onAdvise]);

  const toggle = (itemId: string) => setSelected((prev) => { const next = new Set(prev); if (next.has(itemId)) next.delete(itemId); else next.add(itemId); return next; });

  const split = () => {
    if (!validSubset || !title.trim()) return;
    setBusy(true);
    void onSplit({ unitId: unit.unitId, itemIds: peelIds, title: title.trim() })
      .then((response) => { toast.push(`Split ${peelIds.length} item${peelIds.length === 1 ? '' : 's'} into “${response.created.title}”.`, 'success'); onClose(); onOpenUnit?.(draftKey(response.created.unitId)); })
      .catch((caught) => toast.push(caught instanceof Error ? caught.message : String(caught), 'error'))
      .finally(() => setBusy(false));
  };

  return (
    <div className="grid gap-2 rounded-md border border-dashed border-border p-3">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <Scissors className="h-3.5 w-3.5" /> Split into a new unit
      </div>
      <p className="text-2xs text-muted-foreground">Pick the items to peel off. The original keeps the rest; both sides must keep at least one item.</p>
      <ul className="grid gap-1">
        {unit.items.map((item) => (
          <li key={item.itemId}>
            <label className="flex items-center gap-2 rounded border border-border p-1.5 text-xs">
              <input type="checkbox" disabled={busy} checked={selected.has(item.itemId)} onChange={() => toggle(item.itemId)} />
              <span className="min-w-0 flex-1 truncate text-text-bright">{label(item.itemId)}</span>
            </label>
          </li>
        ))}
      </ul>
      <Input value={title} disabled={busy} className="h-8 text-xs" placeholder="Title for the new unit" onChange={(event) => setTitle(event.target.value)} />
      {advisory && <DraftUnitAdvisoryNotice advisory={advisory} />}
      <div className="flex items-center gap-2">
        <Button size="sm" disabled={busy || !validSubset || !title.trim()} onClick={split} title={!validSubset ? 'Keep at least one item on each side.' : 'Split off the selected items.'}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Scissors className="h-4 w-4" />} Split off {peelIds.length || ''} {peelIds.length === 1 ? 'item' : 'items'}
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={onClose}>Cancel</Button>
      </div>
    </div>
  );
}
