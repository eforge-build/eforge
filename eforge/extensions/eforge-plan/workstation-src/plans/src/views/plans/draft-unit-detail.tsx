import * as React from 'react';
import { ArrowDown, ArrowUp, ClipboardList, Plus, Rocket, Scissors, Trash2, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/toast';
import { planKey } from '@/lib/plan-links';
import type { DraftPlanUnit, DraftUnitAdvisory, PlanningProfile, PromoteDraftUnitResponse, SplitDraftUnitInput, SplitDraftUnitResponse, UpdateDraftUnitInput } from '@/types';
import { PLANNING_PROFILES } from '@/types';
import { DraftUnitSplitPanel } from './draft-unit-split-panel';

interface DraftUnitDetailCardProps {
  unit: DraftPlanUnit;
  titles: Map<string, string>;
  onUpdate: (input: UpdateDraftUnitInput) => Promise<DraftPlanUnit>;
  onDelete: (unitId: string) => Promise<void>;
  onPromote: (unitId: string) => Promise<PromoteDraftUnitResponse>;
  onSplit?: (input: SplitDraftUnitInput) => Promise<SplitDraftUnitResponse>;
  onAdviseSplit?: (unitId: string, itemIds: string[]) => Promise<DraftUnitAdvisory>;
  onOpenItem?: (itemId: string) => void;
  onOpenPlan?: (key: string) => void;
}

/**
 * Editable convergence surface for one draft plan unit: rename, set intent and
 * profile, curate the item set (remove, reorder), then promote plan-first into a
 * session plan. The unit carries grouping + intent only; scope and acceptance
 * criteria are authored in the session plan it promotes into.
 */
export function DraftUnitDetailCard({ unit, titles, onUpdate, onDelete, onPromote, onSplit, onAdviseSplit, onOpenItem, onOpenPlan }: DraftUnitDetailCardProps) {
  const toast = useToast();
  const [busy, setBusy] = React.useState(false);
  const [picking, setPicking] = React.useState(false);
  const [splitting, setSplitting] = React.useState(false);
  const promoted = unit.status === 'promoted';
  // Splitting needs at least two items (one to peel, one to keep) and the wiring.
  const canSplit = Boolean(onSplit && onAdviseSplit) && !promoted && unit.items.length >= 2;
  const promotedSession = unit.promotedSession;
  const label = (id: string) => titles.get(id) ?? id;

  // Board items not already in the unit are the candidates the user can add.
  // `titles` carries every board item (id -> title), so we derive the picker
  // list from it rather than threading a second board prop through.
  const candidates = React.useMemo(() => {
    const present = new Set(unit.items.map((item) => item.itemId));
    return Array.from(titles.entries())
      .filter(([id]) => !present.has(id))
      .map(([id, title]) => ({ id, title }));
  }, [titles, unit.items]);

  const run = React.useCallback(async (work: () => Promise<unknown>) => {
    setBusy(true);
    try { await work(); } catch (caught) { toast.push(caught instanceof Error ? caught.message : String(caught), 'error'); } finally { setBusy(false); }
  }, [toast]);

  const reorder = (index: number, delta: number) => {
    if (busy || promoted) return;
    const next = [...unit.items];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    void run(() => onUpdate({ unitId: unit.unitId, itemOrder: next.map((item) => item.itemId) }));
  };

  const promote = () => run(async () => {
    const response = await onPromote(unit.unitId);
    toast.push(`Promoted to ${response.promotion.session}.`, 'success');
    onOpenPlan?.(planKey(response.promotion.session));
  });

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <ClipboardList className="h-4 w-4 text-[color:var(--lane-progress)]" />
          <CardTitle className="text-base">Draft plan unit</CardTitle>
          <Badge variant={unit.provenance === 'recommendation' ? 'secondary' : 'outline'}>
            {unit.provenance === 'recommendation' ? 'from a lane' : 'user-authored'}
          </Badge>
          <Badge variant={promoted ? 'default' : 'outline'} className="capitalize">{unit.status}</Badge>
        </div>
        <CardDescription>
          {promoted
            ? promotedSession
              ? <>Promoted to <button type="button" className="underline" onClick={() => onOpenPlan?.(planKey(promotedSession))}>{promotedSession}</button>. This draft is now read-only.</>
              : <>Promoted to a session plan. This draft is now read-only.</>
            : 'Curate the grouping and intent, then promote into a session plan.'}
        </CardDescription>
      </CardHeader>

      <CardContent className="grid gap-4">
        <FieldRow label="Title">
          <Input
            defaultValue={unit.title}
            disabled={busy || promoted}
            onBlur={(event) => { const value = event.target.value.trim(); if (value && value !== unit.title) void run(() => onUpdate({ unitId: unit.unitId, title: value })); }}
          />
        </FieldRow>

        <FieldRow label="Intent">
          <Textarea
            defaultValue={unit.intent ?? ''}
            disabled={busy || promoted}
            className="min-h-20 text-xs"
            placeholder="Why these items belong together (grouping rationale, not scope)."
            onBlur={(event) => { const value = event.target.value; if (value !== (unit.intent ?? '')) void run(() => onUpdate({ unitId: unit.unitId, intent: value })); }}
          />
        </FieldRow>

        <FieldRow label="Profile">
          <Select
            value={unit.profile ?? ''}
            disabled={busy || promoted}
            onChange={(event) => void run(() => onUpdate({ unitId: unit.unitId, profile: event.target.value as PlanningProfile | '' }))}
          >
            <option value="">none</option>
            {PLANNING_PROFILES.map((value) => <option key={value} value={value}>{value}</option>)}
          </Select>
        </FieldRow>

        <section className="grid gap-2">
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Items ({unit.items.length})</h4>
            <div className="flex items-center gap-2">
              {unit.sourceRecommendationRef && <span className="text-2xs text-muted-foreground">lane: {unit.sourceRecommendationRef}</span>}
              {!promoted && (
                <Button size="xs" variant="ghost" disabled={busy} aria-expanded={picking} onClick={() => setPicking((value) => !value)}>
                  <Plus className="h-3 w-3" /> Add items
                </Button>
              )}
            </div>
          </div>
          {picking && !promoted && (
            <AddItemPicker candidates={candidates} disabled={busy} onAdd={(id) => void run(() => onUpdate({ unitId: unit.unitId, addItemIds: [id] }))} />
          )}
          {unit.items.length === 0
            ? <EmptyState className="p-3 text-xs">No items. Remove leaves nothing to promote.</EmptyState>
            : <ul className="grid gap-1">
                {unit.items.map((item, index) => (
                  <li key={item.itemId} className="flex items-center gap-2 rounded-md border border-border p-2">
                    <button type="button" className="min-w-0 flex-1 truncate text-left text-xs text-text-bright hover:underline" title={item.itemId} onClick={() => onOpenItem?.(item.itemId)}>
                      {label(item.itemId)}
                    </button>
                    <Badge variant={item.origin === 'recommendation' ? 'secondary' : 'outline'} className="shrink-0 text-2xs">{item.origin === 'recommendation' ? 'AI' : 'you'}</Badge>
                    {!promoted && (
                      <div className="flex shrink-0 items-center gap-0.5">
                        <Button size="icon-xs" variant="ghost" disabled={busy || index === 0} title="Move up" onClick={() => reorder(index, -1)}><ArrowUp className="h-3 w-3" /></Button>
                        <Button size="icon-xs" variant="ghost" disabled={busy || index === unit.items.length - 1} title="Move down" onClick={() => reorder(index, 1)}><ArrowDown className="h-3 w-3" /></Button>
                        <Button size="icon-xs" variant="ghost" className="text-[color:var(--lane-blocked)]" disabled={busy} title="Remove from unit" onClick={() => void run(() => onUpdate({ unitId: unit.unitId, removeItemIds: [item.itemId] }))}><X className="h-3 w-3" /></Button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>}
        </section>

        {splitting && canSplit && onSplit && onAdviseSplit && (
          <DraftUnitSplitPanel unit={unit} titles={titles} onAdvise={onAdviseSplit} onSplit={onSplit} onClose={() => setSplitting(false)} onOpenUnit={onOpenPlan} />
        )}

        <div className="flex flex-wrap items-center gap-2 border-t pt-3">
          <Button disabled={busy || promoted || unit.items.length === 0} onClick={promote} title={unit.items.length === 0 ? 'Add at least one item before promoting.' : 'Promote plan-first into a session plan.'}>
            {busy ? <Spinner /> : <Rocket className="h-4 w-4" />} Promote to a build plan
          </Button>
          {canSplit && (
            <Button variant="outline" disabled={busy} aria-expanded={splitting} onClick={() => setSplitting((value) => !value)} title="Split this unit's items into two units.">
              <Scissors className="h-4 w-4" /> Split
            </Button>
          )}
          <Button variant="ghost" className="text-[color:var(--lane-blocked)]" disabled={busy} onClick={() => void run(() => onDelete(unit.unitId))}>
            <Trash2 className="h-4 w-4" /> Delete
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

interface AddItemPickerProps {
  candidates: { id: string; title: string }[];
  disabled: boolean;
  onAdd: (itemId: string) => void;
}

/**
 * Searchable list of board items not yet in the unit. Adds carry origin 'user'
 * (the backend stamps it), so a manually added item reads "you" in the row
 * badge. The picker stays open after an add so several can be pulled in at once.
 */
function AddItemPicker({ candidates, disabled, onAdd }: AddItemPickerProps) {
  const [query, setQuery] = React.useState('');
  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = q ? candidates.filter((entry) => entry.title.toLowerCase().includes(q) || entry.id.toLowerCase().includes(q)) : candidates;
    return matches.slice(0, 50);
  }, [candidates, query]);

  return (
    <div className="grid gap-2 rounded-md border border-dashed border-border p-2">
      {candidates.length === 0 ? (
        <p className="text-2xs text-muted-foreground">Every board item is already in this unit.</p>
      ) : (
        <>
          <Input value={query} disabled={disabled} className="h-8 text-xs" placeholder="Search board items to add…" onChange={(event) => setQuery(event.target.value)} />
          {filtered.length === 0 ? (
            <p className="text-2xs text-muted-foreground">No board items match “{query}”.</p>
          ) : (
            <ul className="grid max-h-48 gap-1 overflow-auto">
              {filtered.map((entry) => (
                <li key={entry.id}>
                  <button
                    type="button"
                    disabled={disabled}
                    title={entry.id}
                    onClick={() => onAdd(entry.id)}
                    className="flex w-full items-center gap-2 rounded border border-border p-1.5 text-left text-xs hover:border-primary disabled:opacity-50"
                  >
                    <Plus className="h-3 w-3 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate text-text-bright">{entry.title}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid gap-1">
      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
