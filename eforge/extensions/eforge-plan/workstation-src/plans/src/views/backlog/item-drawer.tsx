import * as React from 'react';
import { ClipboardList, X } from 'lucide-react';
import { getBridge } from '@/bridge';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/toast';
import { mergeCompactItemDetail } from '@/lib/compact-board-adapter';
import type { PlanLink } from '@/lib/plan-links';
import type { BoardItem, CompactBoardDetailResponse, DependencyRef, Epic } from '@/types';
import { shortId } from './board-model';
import { LifecyclePanel } from './lifecycle-panel';

const BACKLOG_STATUSES = ['candidate', 'planned', 'active', 'shipped', 'stale', 'superseded'] as const;
const PRIORITIES = ['high', 'medium', 'low'] as const;
const NO_EPIC = '';

interface ItemDrawerProps {
  item: BoardItem;
  epics: Epic[];
  /** Plans whose source refs name this item, for the reverse linkage. */
  plans?: PlanLink[];
  onOpenPlan?: (key: string) => void;
  onClose: () => void;
  onRefresh: () => Promise<void>;
  selectedItemIds?: string[];
}

/**
 * Non-modal detail drawer for a backlog card. Hosts everything the compact
 * card dropped (dependencies, notes, lifecycle evidence, unblock hints) plus
 * direct edits of status, priority, and epic membership through the
 * `update-item` action. Lanes stay derived from status, dependencies, and
 * trace activity, so the drawer explains when an edit will not move the card.
 */
export function ItemDrawer({ item, epics, plans = [], onOpenPlan, onClose, onRefresh }: ItemDrawerProps) {
  const toast = useToast();
  const [status, setStatus] = React.useState(item.status);
  const [priority, setPriority] = React.useState(item.priority);
  const [epic, setEpic] = React.useState(item.epic ?? NO_EPIC);
  const [saving, setSaving] = React.useState(false);
  const [detail, setDetail] = React.useState<BoardItem | null>(null);
  const [detailLoading, setDetailLoading] = React.useState(false);
  const [detailError, setDetailError] = React.useState<string | null>(null);

  // Re-seed the form when the drawer is pointed at a different card or the
  // board refreshes underneath it.
  React.useEffect(() => {
    setStatus(item.status);
    setPriority(item.priority);
    setEpic(item.epic ?? NO_EPIC);
    setDetail(null);
  }, [item.id, item.status, item.priority, item.epic]);

  React.useEffect(() => {
    let cancelled = false;
    setDetailLoading(true);
    setDetailError(null);
    getBridge().invokeAction<CompactBoardDetailResponse>('get-item', { id: item.id })
      .then((response) => { if (!cancelled) setDetail(mergeCompactItemDetail(item, response)); })
      .catch((caught: unknown) => { if (!cancelled) setDetailError(caught instanceof Error ? caught.message : String(caught)); })
      .finally(() => { if (!cancelled) setDetailLoading(false); });
    return () => { cancelled = true; };
  }, [item]);

  React.useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const displayItem = detail ?? item;
  const dirty = status !== item.status || priority !== item.priority || epic !== (item.epic ?? NO_EPIC);
  const openStatusWithBlockers = displayItem.unresolvedDependsOn.length > 0 && ['candidate', 'planned', 'active'].includes(status);

  const save = async () => {
    setSaving(true);
    try {
      await getBridge().invokeAction('update-item', {
        id: item.id,
        ...(status !== item.status && { status }),
        ...(priority !== item.priority && { priority }),
        ...(epic !== (item.epic ?? NO_EPIC) && { epic }),
      });
      await onRefresh();
      toast.push(`Updated ${shortId(item.id)}.`, 'success');
    } catch (caught) {
      toast.push(caught instanceof Error ? caught.message : String(caught), 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <aside className="fixed inset-y-0 right-0 z-30 flex w-[26rem] max-w-full flex-col border-l border-border bg-card shadow-2xl" aria-label={`Details for ${item.title}`}>
      <header className="flex items-start gap-2 border-b border-border p-4">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold leading-snug text-text-bright">{item.title}</h3>
          <code className="mt-1 block break-all text-2xs text-muted-foreground">{item.id}</code>
        </div>
        <button type="button" aria-label="Close details" className="rounded p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground" onClick={onClose}>
          <X className="h-4 w-4" />
        </button>
      </header>

      <div className="flex-1 overflow-y-auto p-4">
        <section className="grid gap-2">
          <Field label="Status">
            <Select value={status} onChange={(event) => setStatus(event.target.value)} className="h-8 text-xs capitalize">
              {BACKLOG_STATUSES.map((value) => <option key={value} value={value}>{value}</option>)}
            </Select>
          </Field>
          <Field label="Priority">
            <Select value={priority} onChange={(event) => setPriority(event.target.value)} className="h-8 text-xs capitalize">
              {PRIORITIES.map((value) => <option key={value} value={value}>{value}</option>)}
            </Select>
          </Field>
          <Field label="Epic">
            <Select value={epic} onChange={(event) => setEpic(event.target.value)} className="h-8 text-xs">
              <option value={NO_EPIC}>No epic</option>
              {epics.map((entry) => <option key={entry.id} value={entry.id}>{entry.title ?? entry.id}</option>)}
              {epic !== NO_EPIC && !epics.some((entry) => entry.id === epic) && <option value={epic}>{epic} (missing)</option>}
            </Select>
          </Field>
          {openStatusWithBlockers && (
            <p className="text-2xs text-muted-foreground">
              Unresolved dependencies ({displayItem.unresolvedDependsOn.map(shortId).join(', ')}) keep this item in the Blocked lane regardless of status.
            </p>
          )}
          <div className="flex items-center gap-2">
            <Button size="sm" disabled={!dirty || saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Save'}</Button>
            {dirty && !saving && (
              <Button size="sm" variant="ghost" onClick={() => { setStatus(item.status); setPriority(item.priority); setEpic(item.epic ?? NO_EPIC); }}>Reset</Button>
            )}
          </div>
        </section>

        {plans.length > 0 && (
          <Section title={`Planned in ${plans.length === 1 ? 'plan' : `${plans.length} plans`}`}>
            <ul className="grid gap-1">
              {plans.map((plan) => (
                <li key={plan.key}>
                  <button
                    type="button"
                    onClick={() => onOpenPlan?.(plan.key)}
                    disabled={!onOpenPlan}
                    title={`Open plan ${plan.title}`}
                    className="flex w-full items-center gap-2 rounded border border-border bg-card p-2 text-left text-xs transition-colors hover:border-primary disabled:cursor-default disabled:hover:border-border"
                  >
                    <ClipboardList className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate text-text-bright">{plan.title}</span>
                    {plan.status && <Badge variant="outline" className="shrink-0">{plan.status}</Badge>}
                  </button>
                </li>
              ))}
            </ul>
          </Section>
        )}

        {detailLoading && <p className="mt-4 rounded border border-border bg-background p-2 text-xs text-muted-foreground">Loading item details…</p>}
        {detailError && <p className="mt-4 rounded border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive-foreground">{detailError}</p>}

        {displayItem.reasons.length > 0 && (
          <Section title="Lane">
            <p className="text-xs text-muted-foreground"><span className="capitalize text-foreground">{displayItem.lane}</span> · {displayItem.reasons.join('; ')}</p>
          </Section>
        )}

        {displayItem.tags.length > 0 && (
          <Section title="Tags">
            <div className="flex flex-wrap gap-1">
              {displayItem.tags.map((tag) => <span key={tag} className="rounded border border-border px-1.5 py-0.5 text-2xs text-muted-foreground">{tag}</span>)}
            </div>
          </Section>
        )}

        <DependencySection title="Depends on" refs={displayItem.dependencies} />
        <DependencySection title="Enables" refs={displayItem.dependents} />

        {(displayItem.recLanes.length > 0 || displayItem.recUnblock) && (
          <Section title="Recommendations">
            {displayItem.recLanes.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {displayItem.recLanes.map((lane) => <span key={lane} className="rounded border border-border px-1.5 py-0.5 text-2xs text-muted-foreground">{lane}</span>)}
              </div>
            )}
            {displayItem.recUnblock && <p className="mt-2 text-xs text-[color:var(--prio-medium)]">{displayItem.recUnblock}</p>}
          </Section>
        )}

        <NoteSection title="Claim" content={displayItem.notes.claim} />
        <NoteSection title="Evidence" content={displayItem.notes.evidence} />
        <NoteSection title="Recheck" content={displayItem.notes.recheck} />
        <NoteSection title="Promotion paths" content={displayItem.notes.promotionPaths} />

        <Section title="Lifecycle">
          <LifecyclePanel item={displayItem} />
        </Section>
      </div>
    </aside>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="grid grid-cols-[5rem_1fr] items-center gap-2 text-xs text-muted-foreground">
      <span>{label}</span>
      {children}
    </label>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-4 border-t border-border pt-3">
      <h4 className="mb-2 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h4>
      {children}
    </section>
  );
}

function DependencySection({ title, refs }: { title: string; refs: DependencyRef[] }) {
  if (refs.length === 0) return null;
  return (
    <Section title={title}>
      <ul className="grid gap-1">
        {refs.map((ref) => (
          <li key={ref.id} className="flex items-baseline gap-2 text-xs">
            <code className={`min-w-0 truncate rounded border px-1 text-2xs ${ref.blocking ? 'border-[color:var(--lane-blocked)]/40 text-[color:var(--lane-blocked)]' : ref.missing ? 'border-dashed border-[color:var(--lane-blocked)]/50 text-[color:var(--lane-blocked)]' : 'border-border text-muted-foreground'}`} title={ref.id}>
              {shortId(ref.id)}
            </code>
            <span className="min-w-0 truncate text-muted-foreground" title={ref.title}>{ref.missing ? `Missing: ${ref.id}` : ref.title}</span>
            {ref.status && <span className="ml-auto shrink-0 text-2xs capitalize text-muted-foreground/70">{ref.status}</span>}
          </li>
        ))}
      </ul>
    </Section>
  );
}

function NoteSection({ title, content }: { title: string; content: string }) {
  if (!content.trim()) return null;
  return (
    <Section title={title}>
      <pre className="whitespace-pre-wrap break-words rounded border border-border bg-background p-2 text-2xs text-foreground">{content.trim()}</pre>
    </Section>
  );
}
