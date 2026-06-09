import * as React from 'react';
import type { Board as BoardData, BoardItem } from '@/types';
import { ItemCard } from './item-card';
import {
  allEpicChips,
  buildColumns,
  filterItems,
  findDependencyCycles,
  shortId,
  stats,
  type GroupMode,
  type StatusFilter,
} from './board-model';

interface BoardProps {
  board: BoardData;
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
}

const GROUPS: { id: GroupMode; label: string }[] = [
  { id: 'lane', label: 'Lane' }, { id: 'epic', label: 'Epic' }, { id: 'recommended', label: 'Recommended' },
];

export function Board({ board, query, onQuery, filter, onFilter, group, onGroup, epicFilter, onEpicFilter, selected, onToggle }: BoardProps) {
  const allItems = board.items ?? [];
  const filtered = React.useMemo(() => {
    const base = filterItems(allItems, query, filter);
    return epicFilter ? base.filter((item) => (item.epic ?? '') === epicFilter) : base;
  }, [allItems, query, filter, epicFilter]);
  const columns = React.useMemo(() => buildColumns(board, filtered, group), [board, filtered, group]);
  const cycles = React.useMemo(() => findDependencyCycles(allItems), [allItems]);
  const chips = React.useMemo(() => allEpicChips(allItems, board.epics ?? []), [allItems, board.epics]);
  const counts = React.useMemo(() => stats(allItems), [allItems]);

  // Count pills double as the status filter - one control instead of a stats
  // row plus a separate filter row. Zero-count pills are hidden unless active.
  const filterPills: { id: StatusFilter; label: string; count: number }[] = [
    { id: 'all', label: 'All', count: allItems.length },
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
        <input
          type="search"
          value={query}
          onChange={(event) => onQuery(event.target.value)}
          placeholder="Search title, id, tag, dependency…"
          className="min-w-64 flex-1 rounded-md border border-border bg-card px-3 py-1.5 text-sm text-foreground focus:border-primary focus:outline-none"
        />
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap items-center gap-1">
            {visiblePills.map((pill) => (
              <button
                key={pill.id}
                type="button"
                onClick={() => onFilter(pill.id)}
                className={`inline-flex items-baseline gap-1 rounded-md border px-2 py-1 text-xs transition-colors ${filter === pill.id ? 'border-primary bg-primary/10 text-text-bright' : 'border-border bg-card text-muted-foreground hover:border-muted-foreground/50'}`}
              >
                <strong className={`text-sm ${filter === pill.id ? 'text-text-bright' : 'text-foreground'}`}>{pill.count}</strong>{pill.label}
              </button>
            ))}
          </div>
          <span className="text-[0.7rem] text-muted-foreground">Group</span>
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
              {chip.title}<span className="rounded-full border border-border px-1 text-[0.65rem]">{chip.count}</span>
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
        ? <p className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">No items match this view.</p>
        : (
          <div className="flex gap-3 overflow-x-auto pb-2">
            {columns.map((column) => (
              <div key={column.key} className="flex w-80 shrink-0 flex-col overflow-hidden rounded-lg border border-border bg-background/40" style={{ borderTop: `2px solid ${column.tone}` }}>
                <div className="flex items-center gap-2 border-b border-border px-3 py-2">
                  <span className="h-2 w-2 rounded-full" style={{ background: column.tone }} />
                  <span className="text-sm font-semibold text-text-bright">{column.title}</span>
                  <span className="ml-auto rounded-full border border-border px-2 text-xs text-muted-foreground">{column.items.length}</span>
                </div>
                <div className="flex flex-col gap-2 p-2">
                  {column.items.length === 0
                    ? <p className="py-4 text-center text-xs text-muted-foreground">Nothing here</p>
                    : column.items.map((item) => <ItemCard key={item.id} item={item} selected={selected.has(item.id)} onToggle={onToggle} />)}
                </div>
              </div>
            ))}
          </div>
        )}
    </div>
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
