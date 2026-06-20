import * as React from 'react';
import { ArrowDown, ArrowUp, ClipboardList, Loader2, Rocket, Trash2, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/toast';
import { planKey } from '@/lib/plan-links';
import type { DraftPlanUnit, PromoteDraftUnitResponse, UpdateDraftUnitInput } from '@/types';

const PROFILES = ['errand', 'excursion', 'expedition'] as const;

interface DraftUnitDetailCardProps {
  unit: DraftPlanUnit;
  titles: Map<string, string>;
  onUpdate: (input: UpdateDraftUnitInput) => Promise<DraftPlanUnit>;
  onDelete: (unitId: string) => Promise<void>;
  onPromote: (unitId: string) => Promise<PromoteDraftUnitResponse>;
  onOpenItem?: (itemId: string) => void;
  onOpenPlan?: (key: string) => void;
}

/**
 * Editable convergence surface for one draft plan unit: rename, set intent and
 * profile, curate the item set (remove, reorder), then promote plan-first into a
 * session plan. The unit carries grouping + intent only; scope and acceptance
 * criteria are authored in the session plan it promotes into.
 */
export function DraftUnitDetailCard({ unit, titles, onUpdate, onDelete, onPromote, onOpenItem, onOpenPlan }: DraftUnitDetailCardProps) {
  const toast = useToast();
  const [busy, setBusy] = React.useState(false);
  const promoted = unit.status === 'promoted';
  const promotedSession = unit.promotedSession;
  const label = (id: string) => titles.get(id) ?? id;

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
            onChange={(event) => void run(() => onUpdate({ unitId: unit.unitId, profile: event.target.value }))}
          >
            <option value="">none</option>
            {PROFILES.map((value) => <option key={value} value={value}>{value}</option>)}
          </Select>
        </FieldRow>

        <section className="grid gap-2">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Items ({unit.items.length})</h4>
            {unit.sourceRecommendationRef && <span className="text-2xs text-muted-foreground">lane: {unit.sourceRecommendationRef}</span>}
          </div>
          {unit.items.length === 0
            ? <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">No items. Remove leaves nothing to promote.</p>
            : <ul className="grid gap-1">
                {unit.items.map((item, index) => (
                  <li key={item.itemId} className="flex items-center gap-2 rounded-md border border-border p-2">
                    <button type="button" className="min-w-0 flex-1 truncate text-left text-xs text-text-bright hover:underline" title={item.itemId} onClick={() => onOpenItem?.(item.itemId)}>
                      {label(item.itemId)}
                    </button>
                    <Badge variant={item.origin === 'recommendation' ? 'secondary' : 'outline'} className="shrink-0 text-2xs">{item.origin === 'recommendation' ? 'AI' : 'you'}</Badge>
                    {!promoted && (
                      <div className="flex shrink-0 items-center gap-0.5">
                        <Button size="icon" variant="ghost" className="h-6 w-6" disabled={busy || index === 0} title="Move up" onClick={() => reorder(index, -1)}><ArrowUp className="h-3 w-3" /></Button>
                        <Button size="icon" variant="ghost" className="h-6 w-6" disabled={busy || index === unit.items.length - 1} title="Move down" onClick={() => reorder(index, 1)}><ArrowDown className="h-3 w-3" /></Button>
                        <Button size="icon" variant="ghost" className="h-6 w-6 text-[color:var(--lane-blocked)]" disabled={busy} title="Remove from unit" onClick={() => void run(() => onUpdate({ unitId: unit.unitId, removeItemIds: [item.itemId] }))}><X className="h-3 w-3" /></Button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>}
        </section>

        <div className="flex flex-wrap items-center gap-2 border-t pt-3">
          <Button disabled={busy || promoted || unit.items.length === 0} onClick={promote} title={unit.items.length === 0 ? 'Add at least one item before promoting.' : 'Promote plan-first into a session plan.'}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Rocket className="h-4 w-4" />} Promote to a build plan
          </Button>
          <Button variant="ghost" className="text-[color:var(--lane-blocked)]" disabled={busy} onClick={() => void run(() => onDelete(unit.unitId))}>
            <Trash2 className="h-4 w-4" /> Delete
          </Button>
        </div>
      </CardContent>
    </Card>
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
