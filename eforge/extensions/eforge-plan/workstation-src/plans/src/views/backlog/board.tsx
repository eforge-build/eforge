import * as React from 'react';
import { ChevronsLeft, ChevronsRight, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Input } from '@/components/ui/input';
import type { Board as BoardData, BoardItem } from '@/types';
import type { PlanLink } from '@/lib/plan-links';
import { ItemCard, type CardRelation } from './item-card';
import {
  allEpicChips,
  buildColumns,
  filterItems,
  findDependencyCycles,
  shortId,
  standaloneEpics,
  stats,
  type BoardColumn,
  type GroupMode,
  type StatusFilter,
} from './board-model';

interface BoardProps {
  board: BoardData;
  itemPlanIndex?: Map<string, PlanLink[]>;
  onOpenPlan?: (key: string) => void;
  query: string;
  onQuery: (value: string) => void;
  filter: StatusFilter;
  onFilter: (value: StatusFilter) => void;
  group: GroupMode;
  onGroup: (value: GroupMode) => void;
  epicFilter: string;
  onEpicFilter: (value: string) => void;
  selected: Set<string>;
  onToggle: (item: BoardItem) => void;
  onOpenDetail: (item: BoardItem) => void;
  onOpenEpic: (epicId: string) => void;
  onLoadMoreBoard?: () => Promise<void>;
  onLoadClosedLane?: (lane: string) => Promise<void>;
}

const GROUPS: { id: GroupMode; label: string }[] = [
  { id: 'lane', label: 'Lane' }, { id: 'epic', label: 'Epic' }, { id: 'recommended', label: 'Recommended' },
];

// Closed-work columns start out as narrow rails so open work owns the canvas.
const COLLAPSED_BY_DEFAULT = new Set(['done', 'archive', 'closed']);
const EXPANDED_STORAGE_KEY = 'eforge-plan:board:expanded-closed';

function readExpandedColumns(): Set<string> {
  try {
    const raw = window.localStorage.getItem(EXPANDED_STORAGE_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

export function Board({ board, itemPlanIndex, onOpenPlan, query, onQuery, filter, onFilter, group, onGroup, epicFilter, onEpicFilter, selected, onToggle, onOpenDetail, onOpenEpic, onLoadMoreBoard, onLoadClosedLane }: BoardProps) {
  const allItems = board.items ?? [];
  const [hoverId, setHoverId] = React.useState<string | null>(null);
  const [expandedClosed, setExpandedClosed] = React.useState<Set<string>>(() => readExpandedColumns());
  const initialExpandedLoads = React.useRef<Set<string>>(new Set());
  const closedFilterLoadRequested = React.useRef(false);
  const filtered = React.useMemo(() => {
    const base = filterItems(allItems, query, filter);
    return epicFilter ? base.filter((item) => (item.epic ?? '') === epicFilter) : base;
  }, [allItems, query, filter, epicFilter]);
  const columns = React.useMemo(() => {
    const built = buildColumns(board, filtered, group);
    if (filter !== 'closed' || group !== 'lane') return built;
    const present = new Set(built.map((column) => column.key));
    const closedRails = (board.lanes ?? [])
      .filter((lane) => (lane.lane === 'done' || lane.lane === 'archive') && !present.has(lane.lane) && (lane.count ?? lane.closedCount ?? 0) > 0)
      .map((lane): BoardColumn => ({ key: lane.lane, title: lane.title, tone: lane.lane === 'done' ? 'var(--lane-done)' : 'var(--lane-archive)', items: [], count: lane.count, pagination: lane.pagination }));
    return [...built, ...closedRails];
  }, [board, filtered, group, filter]);
  const cycles = React.useMemo(() => findDependencyCycles(allItems), [allItems]);
  const chips = React.useMemo(() => allEpicChips(allItems, board.epics ?? []), [allItems, board.epics]);
  const horizonEpics = React.useMemo(() => standaloneEpics(board.epics ?? []), [board.epics]);
  const counts = React.useMemo(() => stats(allItems, board), [allItems, board]);

  // Hovering a card outlines its dependency neighborhood across all columns:
  // amber for what it waits on, blue for what it unblocks.
  const hovered = React.useMemo(() => (hoverId ? allItems.find((item) => item.id === hoverId) : undefined), [allItems, hoverId]);
  const dependencyIds = React.useMemo(() => new Set((hovered?.dependencies ?? []).map((ref) => ref.id)), [hovered]);
  const dependentIds = React.useMemo(() => new Set((hovered?.dependents ?? []).map((ref) => ref.id)), [hovered]);
  const relationFor = (item: BoardItem): CardRelation => {
    if (dependencyIds.has(item.id)) return 'dependency';
    if (dependentIds.has(item.id)) return 'dependent';
    return null;
  };

  const loadClosedLane = React.useCallback((lane: string) => {
    if ((lane === 'done' || lane === 'archive') && onLoadClosedLane) void onLoadClosedLane(lane);
  }, [onLoadClosedLane]);

  React.useEffect(() => {
    for (const lane of board.lanes ?? []) {
      if ((lane.lane !== 'done' && lane.lane !== 'archive') || !expandedClosed.has(lane.lane) || initialExpandedLoads.current.has(lane.lane)) continue;
      if ((lane.count ?? 0) <= lane.items.length || lane.pagination?.hasMore === false) continue;
      initialExpandedLoads.current.add(lane.lane);
      loadClosedLane(lane.lane);
    }
  }, [board.lanes, expandedClosed, loadClosedLane]);

  React.useEffect(() => {
    if (filter !== 'closed') {
      closedFilterLoadRequested.current = false;
      return;
    }
    if (closedFilterLoadRequested.current) return;
    closedFilterLoadRequested.current = true;
    loadClosedLane('done');
    loadClosedLane('archive');
  }, [filter, loadClosedLane]);

  const selectFilter = (value: StatusFilter) => {
    if (value === 'closed') {
      closedFilterLoadRequested.current = true;
      loadClosedLane('done');
      loadClosedLane('archive');
    }
    onFilter(value);
  };

  const toggleClosedColumn = (key: string) => {
    if (!expandedClosed.has(key)) {
      initialExpandedLoads.current.add(key);
      loadClosedLane(key);
    }
    setExpandedClosed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      try {
        window.localStorage.setItem(EXPANDED_STORAGE_KEY, JSON.stringify([...next]));
      } catch {
        // Persistence is best-effort; embedded webviews may deny storage.
      }
      return next;
    });
  };

  // Count pills double as the status filter - one control instead of a stats
  // row plus a separate filter row. Zero-count pills are hidden unless active.
  const filterPills: { id: StatusFilter; label: string; count: number }[] = [
    { id: 'all', label: 'All', count: board.counts?.total ?? allItems.length },
    { id: 'open', label: 'Open', count: counts.open },
    { id: 'ready', label: 'Ready', count: counts.ready },
    { id: 'blocked', label: 'Blocked', count: counts.blocked },
    { id: 'review', label: 'Review due', count: counts.review },
    { id: 'closed', label: 'Closed', count: counts.closed },
  ];
  const visiblePills = filterPills.filter((pill) => pill.count > 0 || pill.id === filter || pill.id === 'all');

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Input
          type="search"
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          placeholder="Search title, id, tag, dependency…"
          className="h-8 min-w-64 flex-1"
        />
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap items-center gap-1">
            {visiblePills.map((pill) => (
              <button
                key={pill.id}
                type="button"
                onClick={() => selectFilter(pill.id)}
                className={`inline-flex items-baseline gap-1 rounded-md border px-2 py-1 text-xs transition-colors ${filter === pill.id ? 'border-primary bg-primary/10 text-text-bright' : 'border-border bg-card text-muted-foreground hover:border-muted-foreground/50'}`}
              >
                <strong className={`text-sm ${filter === pill.id ? 'text-text-bright' : 'text-foreground'}`}>{pill.count}</strong>{pill.label}
              </button>
            ))}
          </div>
          <span className="text-2xs text-muted-foreground">Group</span>
          <ButtonGroup options={GROUPS} active={group} onSelect={(value) => onGroup(value)} />
        </div>
      </div>

      {chips.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {chips.map((chip) => (
            <button
              key={chip.id}
              onClick={() => onEpicFilter(epicFilter === chip.id ? '' : chip.id)}
              className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs transition-colors ${epicFilter === chip.id ? 'border-primary text-text-bright' : 'border-border text-muted-foreground hover:border-muted-foreground/50'} ${chip.missing ? 'border-dashed text-[color:var(--lane-blocked)]' : ''}`}
            >
              {chip.title}<span className="rounded-full border border-border px-1 text-2xs">{chip.count}</span>
            </button>
          ))}
        </div>
      )}

      {horizonEpics.length > 0 && (
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-2xs uppercase tracking-wide text-muted-foreground">Horizon</span>
          {horizonEpics.map((epic) => (
            <button
              key={epic.id}
              type="button"
              title={`Open horizon epic ${epic.title ?? epic.id}`}
              onClick={() => onOpenEpic(epic.id)}
              className="inline-flex items-center gap-1 rounded-md border border-dashed border-border px-2 py-0.5 text-xs text-muted-foreground transition-colors hover:border-muted-foreground/50 hover:text-foreground"
            >
              <FileText className="h-3 w-3" />{epic.title ?? epic.id}
            </button>
          ))}
        </div>
      )}

      {cycles.length > 0 && (
        <div className="rounded-md border border-[color:var(--lane-blocked)]/40 bg-[color:var(--lane-blocked)]/10 p-2 text-xs text-[color:var(--lane-blocked)]">
          <strong className="mr-2 uppercase tracking-wide">Dependency cycles</strong>
          {cycles.map((cycle) => <span key={cycle.join('-')} className="mr-3 font-mono">{cycle.map(shortId).join(' → ')}</span>)}
        </div>
      )}

      {columns.length === 0
        ? <EmptyState className="p-6 text-center">No items match this view.</EmptyState>
        : (
          <div className="flex max-h-[78vh] items-start gap-3 overflow-auto pb-2">
            {columns.map((column) => {
              const collapsible = group !== 'epic' && COLLAPSED_BY_DEFAULT.has(column.key);
              if (collapsible && !expandedClosed.has(column.key)) {
                return <CollapsedColumn key={column.key} column={column} onExpand={() => toggleClosedColumn(column.key)} />;
              }
              return (
                <div key={column.key} className="flex w-80 shrink-0 flex-col overflow-hidden rounded-lg border border-border/60 bg-background/40">
                  <div className="flex items-center gap-2 border-b border-border/60 px-3 py-2">
                    <span className="h-2 w-2 rounded-full" style={{ background: column.tone }} />
                    <span className="text-sm font-semibold text-text-bright">{column.title}</span>
                    <span className="ml-auto rounded-full border border-border px-2 text-xs text-muted-foreground">{column.count ?? column.items.length}</span>
                    {collapsible && (
                      <button
                        type="button"
                        aria-label={`Collapse ${column.title}`}
                        title={`Collapse ${column.title}`}
                        className="rounded p-0.5 text-muted-foreground/60 transition-colors hover:bg-secondary hover:text-foreground"
                        onClick={() => toggleClosedColumn(column.key)}
                      >
                        <ChevronsRight className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                  <div className="flex flex-col gap-2 p-2">
                    {column.pagination?.hasMore && <p className="rounded border border-dashed border-border px-2 py-1 text-center text-2xs text-muted-foreground">More items available. Expand again or refresh to load the next page.</p>}
                    {column.items.length === 0
                      ? <p className="py-4 text-center text-xs text-muted-foreground">{(column.count ?? 0) > 0 ? 'Cards not loaded yet' : 'Nothing here'}</p>
                      : column.items.map((item) => (
                          <ItemCard
                            key={item.id}
                            item={item}
                            selected={selected.has(item.id)}
                            relation={relationFor(item)}
                            plannedIn={itemPlanIndex?.get(item.id)}
                            onOpenPlan={onOpenPlan}
                            onToggle={onToggle}
                            onOpenDetail={onOpenDetail}
                            onHoverChange={setHoverId}
                          />
                        ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}

      {onLoadMoreBoard && board.pagination?.hasMore && filter !== 'closed' && (
        <Button variant="outline" size="sm" className="mx-auto" onClick={() => { if (onLoadMoreBoard) void onLoadMoreBoard(); }}>
          Load more board items
        </Button>
      )}

      {hovered && (dependencyIds.size > 0 || dependentIds.size > 0) && (
        <div className="pointer-events-none fixed bottom-4 left-4 z-20 flex items-center gap-3 rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground shadow-lg">
          <span className="max-w-56 truncate font-medium text-foreground">{shortId(hovered.id)}</span>
          {dependencyIds.size > 0 && (
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-[color:var(--prio-medium)]" /> waits on {dependencyIds.size}
            </span>
          )}
          {dependentIds.size > 0 && (
            <span className="inline-flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-[color:var(--lane-ready)]" /> unblocks {dependentIds.size}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

// Narrow rail standing in for a closed-work column. Keeps the count visible
// without spending canvas on finished cards.
function CollapsedColumn({ column, onExpand }: { column: BoardColumn; onExpand: () => void }) {
  return (
    <button
      type="button"
      onClick={onExpand}
      title={`Expand ${column.title} (${column.count ?? column.items.length})`}
      className="flex min-h-48 w-10 shrink-0 flex-col items-center gap-2 rounded-lg border border-border/60 bg-background/40 py-2 text-muted-foreground transition-colors hover:border-muted-foreground/50 hover:text-foreground"
    >
      <ChevronsLeft className="h-3.5 w-3.5" />
      <span className="h-2 w-2 rounded-full" style={{ background: column.tone }} />
      <span className="text-xs font-semibold [text-orientation:mixed] [writing-mode:vertical-rl]">{column.title}</span>
      <span className="rounded-full border border-border px-1.5 text-2xs">{column.count ?? column.items.length}</span>
    </button>
  );
}

function ButtonGroup<T extends string>({ options, active, onSelect }: { options: { id: T; label: string }[]; active: T; onSelect: (value: T) => void }) {
  return (
    <div className="flex flex-wrap gap-1">
      {options.map((option) => (
        <button
          key={option.id}
          onClick={() => onSelect(option.id)}
          className={`rounded-md border px-2.5 py-1 text-xs transition-colors ${active === option.id ? 'border-primary bg-primary/10 text-text-bright' : 'border-border text-muted-foreground hover:border-muted-foreground/50'}`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
