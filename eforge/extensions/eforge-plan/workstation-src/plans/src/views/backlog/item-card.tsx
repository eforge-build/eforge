import * as React from 'react';
import { PanelRightOpen } from 'lucide-react';
import type { BoardItem } from '@/types';
import { shortId } from './board-model';
import { summaryLifecycleChip } from './lifecycle-panel';

const PRIORITY_COLOR: Record<string, string> = { high: 'var(--prio-high)', medium: 'var(--prio-medium)', low: 'var(--prio-low)' };
const MAX_VISIBLE_TAGS = 3;

/** How this card relates to the card currently under the pointer. */
export type CardRelation = 'dependency' | 'dependent' | null;

// Amber = the hovered card waits on this one; blue = this one is unblocked by it.
const RELATION_RING: Record<Exclude<CardRelation, null>, string> = {
  dependency: 'ring-2 ring-[color:var(--prio-medium)]/70',
  dependent: 'ring-2 ring-[color:var(--lane-ready)]/70',
};

interface ItemCardProps {
  item: BoardItem;
  selected: boolean;
  relation?: CardRelation;
  onToggle: (item: BoardItem) => void;
  onOpenDetail: (item: BoardItem) => void;
  onHoverChange?: (id: string | null) => void;
}

/**
 * Compact kanban card: title plus a quiet meta row. Color is reserved for the
 * priority dot, the recommendation rank, and warning states; everything else
 * (deps, notes, lifecycle evidence, unblock hints) lives in the detail drawer
 * opened from the corner affordance. Clicking the card body still toggles
 * selection for "Promote to a build plan".
 */
export function ItemCard({ item, selected, relation = null, onToggle, onOpenDetail, onHoverChange }: ItemCardProps) {
  const accent = PRIORITY_COLOR[item.priority] ?? 'var(--prio-low)';
  const lifecycle = summaryLifecycleChip(item);
  // Selection ring wins over the hover-relation ring so promote flow state stays legible.
  const ring = selected ? 'ring-2 ring-primary' : relation ? RELATION_RING[relation] : '';
  return (
    <div
      id={`board-item-${item.id}`}
      role="button"
      tabIndex={0}
      onClick={() => onToggle(item)}
      onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onToggle(item); } }}
      onMouseEnter={() => onHoverChange?.(item.id)}
      onMouseLeave={() => onHoverChange?.(null)}
      className={`group cursor-pointer rounded-md border border-border/70 bg-card p-3 transition-colors hover:border-muted-foreground/40 ${ring} ${item.closed && !relation ? 'opacity-60' : ''}`}
    >
      <div className="flex items-start gap-2">
        <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full" style={{ background: accent }} title={`${item.priority} priority`} />
        <h4 className="min-w-0 flex-1 text-sm font-medium leading-snug text-text-bright">{item.title}</h4>
        <button
          type="button"
          aria-label={`Open details for ${item.title}`}
          title="Open details"
          className="-mr-1 -mt-1 shrink-0 rounded p-1 text-muted-foreground/50 transition-colors hover:bg-secondary hover:text-foreground group-hover:text-muted-foreground"
          onClick={(event) => { event.stopPropagation(); onOpenDetail(item); }}
        >
          <PanelRightOpen className="h-3.5 w-3.5" />
        </button>
      </div>
      <code className="mt-0.5 block truncate pl-4 text-2xs text-muted-foreground/70" title={item.id}>{shortId(item.id)}</code>

      <MetaRow item={item} lifecycle={lifecycle} />
      <ContextRow item={item} />
    </div>
  );
}

// Badge row: only states worth color. Rendered only when something is present.
function MetaRow({ item, lifecycle }: { item: BoardItem; lifecycle: { label: string; className: string } | null }) {
  const blockingCount = item.dependencies.filter((dep) => dep.blocking).length;
  const chips: React.ReactNode[] = [];
  if (item.recRank !== undefined) chips.push(<Badge key="rec" className="border-[color:var(--lane-ready)]/40 bg-[color:var(--lane-ready)]/10 text-[color:var(--lane-ready)]">Next {item.recRank}</Badge>);
  if (item.blocked) {
    chips.push(
      <Badge key="blocked" className="border-border text-muted-foreground">
        <span className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-[color:var(--lane-blocked)]" />
        {blockingCount > 0 ? `Blocked by ${blockingCount}` : 'Blocked'}
      </Badge>,
    );
  }
  if (item.reviewDue) chips.push(<Badge key="review" className="border-[color:var(--prio-medium)]/40 text-[color:var(--prio-medium)]">Review due</Badge>);
  if (lifecycle) chips.push(<Badge key="lifecycle" className={lifecycle.className}>{lifecycle.label}</Badge>);
  if (chips.length === 0) return null;
  return <div className="mt-1.5 flex flex-wrap gap-1 pl-4">{chips}</div>;
}

// Quiet single line for epic and tags - metadata, not state, so no color.
function ContextRow({ item }: { item: BoardItem }) {
  const visibleTags = item.tags.slice(0, MAX_VISIBLE_TAGS);
  const hiddenTagCount = item.tags.length - visibleTags.length;
  if (!item.epicRef && item.tags.length === 0) return null;
  return (
    <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-1 pl-4 text-2xs text-muted-foreground">
      {item.epicRef && (
        <span
          className={`truncate ${item.epicRef.missing ? 'text-[color:var(--lane-blocked)]' : ''}`}
          title={item.epicRef.missing ? `Missing epic: ${item.epicRef.id}` : `Epic: ${item.epicRef.title}`}
        >
          {item.epicRef.missing ? `Missing epic: ${item.epicRef.title}` : item.epicRef.title}
        </span>
      )}
      {item.epicRef && visibleTags.length > 0 && <span className="text-muted-foreground/50">·</span>}
      {visibleTags.map((tag) => <span key={tag} className="text-muted-foreground/80">{tag}</span>)}
      {hiddenTagCount > 0 && <span className="text-muted-foreground/60" title={item.tags.slice(MAX_VISIBLE_TAGS).join(', ')}>+{hiddenTagCount}</span>}
    </div>
  );
}

function Badge({ children, className }: { children: React.ReactNode; className: string }) {
  return <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-2xs font-medium ${className}`}>{children}</span>;
}
