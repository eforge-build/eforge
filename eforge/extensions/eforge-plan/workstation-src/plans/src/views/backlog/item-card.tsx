import * as React from 'react';
import type { BoardItem, DependencyRef } from '@/types';
import { shortId } from './board-model';
import { LifecyclePanel } from './lifecycle-panel';

const PRIORITY_COLOR: Record<string, string> = { high: 'var(--prio-high)', medium: 'var(--prio-medium)', low: 'var(--prio-low)' };

interface ItemCardProps {
  item: BoardItem;
  selected: boolean;
  onToggle: (item: BoardItem) => void;
}

export function ItemCard({ item, selected, onToggle }: ItemCardProps) {
  const accent = PRIORITY_COLOR[item.priority] ?? 'var(--prio-low)';
  const hasNotes = Boolean(item.notes.claim || item.notes.evidence || item.notes.recheck || item.notes.promotionPaths);
  return (
    <div
      id={`board-item-${item.id}`}
      role="button"
      tabIndex={0}
      onClick={() => onToggle(item)}
      onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onToggle(item); } }}
      className={`cursor-pointer rounded-md border bg-card p-3 transition-colors hover:border-muted-foreground/40 ${selected ? 'ring-2 ring-primary' : ''} ${item.closed ? 'opacity-60' : ''}`}
      style={{ borderLeft: `3px solid ${item.blocked ? 'var(--lane-blocked)' : accent}` }}
    >
      <div className="mb-1 flex items-center gap-2">
        <span className="inline-flex items-center gap-1 text-[0.7rem] capitalize text-muted-foreground">
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: accent }} /> {item.priority}
        </span>
        <span className="ml-auto flex flex-wrap gap-1">
          {item.recRank !== undefined && <Badge tone="rec">Next {item.recRank}</Badge>}
          {item.blocked && <Badge tone="bad">Blocked</Badge>}
          {item.reviewDue && <Badge tone="warn">Review due</Badge>}
        </span>
      </div>
      <h4 className="text-sm font-semibold leading-snug text-text-bright">{item.title}</h4>
      <code className="mt-0.5 block truncate text-[0.7rem] text-muted-foreground" title={item.id}>{shortId(item.id)}</code>

      {item.epicRef && <Tags><Tag tone={item.epicRef.missing ? 'bad' : 'epic'}>Epic: {item.epicRef.title}</Tag></Tags>}
      {item.recLanes.length > 0 && <Tags>{item.recLanes.map((lane) => <Tag key={lane} tone="lane">{lane}</Tag>)}</Tags>}
      {item.tags.length > 0 && <Tags>{item.tags.map((tag) => <Tag key={tag}>{tag}</Tag>)}</Tags>}

      <DependencyRows dependencies={item.dependencies} dependents={item.dependents} />
      <LifecyclePanel item={item} />
      {item.recUnblock && (
        <p className="mt-2 flex items-baseline gap-2 text-xs text-[color:var(--prio-medium)]">
          <span className="rounded border border-[color:var(--prio-medium)]/40 px-1 text-[0.6rem] uppercase tracking-wide text-muted-foreground">Unblock</span>
          {item.recUnblock}
        </p>
      )}

      {hasNotes && (
        <details className="mt-2" onClick={(event) => event.stopPropagation()}>
          <summary className="cursor-pointer text-xs text-muted-foreground">Notes</summary>
          <NoteSection title="Claim" content={item.notes.claim} />
          <NoteSection title="Evidence" content={item.notes.evidence} />
          <NoteSection title="Recheck" content={item.notes.recheck} />
          <NoteSection title="Promotion paths" content={item.notes.promotionPaths} />
        </details>
      )}
    </div>
  );
}

function DependencyRows({ dependencies, dependents }: { dependencies: DependencyRef[]; dependents: DependencyRef[] }) {
  if (dependencies.length === 0 && dependents.length === 0) return null;
  return (
    <div className="mt-2 grid gap-1">
      {dependencies.length > 0 && <DependencyRow label="Depends on" refs={dependencies} />}
      {dependents.length > 0 && <DependencyRow label="Enables" refs={dependents} />}
    </div>
  );
}

function DependencyRow({ label, refs }: { label: string; refs: DependencyRef[] }) {
  return (
    <div className="flex flex-wrap items-baseline gap-1">
      <span className="text-[0.6rem] uppercase tracking-wide text-muted-foreground">{label}</span>
      {refs.map((ref) => (
        <span
          key={ref.id}
          title={ref.missing ? `Missing: ${ref.id}` : `${ref.title}${ref.status ? ` (${ref.status})` : ''}`}
          className={`rounded border px-1 font-mono text-[0.68rem] ${ref.blocking ? 'border-[color:var(--lane-blocked)]/40 text-[color:var(--lane-blocked)]' : ref.missing ? 'border-dashed border-[color:var(--lane-blocked)]/50 text-[color:var(--lane-blocked)]' : 'border-border text-[color:var(--lane-ready)]'}`}
        >
          {shortId(ref.id)}
        </span>
      ))}
    </div>
  );
}

function NoteSection({ title, content }: { title: string; content: string }) {
  if (!content.trim()) return null;
  return (
    <section className="mt-2">
      <h5 className="text-[0.6rem] font-semibold uppercase tracking-wide text-muted-foreground">{title}</h5>
      <pre className="mt-0.5 whitespace-pre-wrap break-words rounded border border-border bg-background p-2 text-[0.7rem] text-foreground">{content.trim()}</pre>
    </section>
  );
}

function Tags({ children }: { children: React.ReactNode }) {
  return <div className="mt-2 flex flex-wrap gap-1">{children}</div>;
}

const TAG_TONE: Record<string, string> = {
  default: 'border-border text-muted-foreground',
  epic: 'border-border text-[color:var(--lane-ready)] bg-[color:var(--lane-ready)]/10',
  lane: 'border-[color:var(--lane-done)]/30 text-[color:var(--lane-done)] bg-[color:var(--lane-done)]/10',
  bad: 'border-[color:var(--lane-blocked)]/50 text-[color:var(--lane-blocked)] border-dashed',
};

function Tag({ children, tone = 'default' }: { children: React.ReactNode; tone?: string }) {
  return <span className={`rounded border px-1.5 py-0.5 text-[0.68rem] ${TAG_TONE[tone] ?? TAG_TONE.default}`}>{children}</span>;
}

const BADGE_TONE: Record<string, string> = {
  rec: 'border-[color:var(--lane-ready)]/40 text-[color:var(--lane-ready)] bg-[color:var(--lane-ready)]/10',
  bad: 'border-[color:var(--lane-blocked)]/40 text-[color:var(--lane-blocked)] bg-[color:var(--lane-blocked)]/10',
  warn: 'border-[color:var(--prio-medium)]/40 text-[color:var(--prio-medium)] bg-[color:var(--prio-medium)]/10',
};

function Badge({ children, tone }: { children: React.ReactNode; tone: string }) {
  return <span className={`rounded border px-1.5 py-0.5 text-[0.62rem] font-semibold ${BADGE_TONE[tone]}`}>{children}</span>;
}
