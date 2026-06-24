import type { Board, BoardItem, Epic } from '@/types';

export type GroupMode = 'lane' | 'epic' | 'recommended';
export type StatusFilter = 'all' | 'open' | 'ready' | 'blocked' | 'review' | 'closed';
export type RecColumn = 'next' | 'blocked' | 'other' | 'closed';

export interface BoardColumn {
  key: string;
  title: string;
  tone: string;
  items: BoardItem[];
  count?: number;
  pagination?: { hasMore: boolean; nextOffset?: number };
}

export interface EpicGroup {
  id: string;
  title: string;
  count: number;
  missing: boolean;
}

const PRIORITY_RANK: Record<string, number> = { high: 3, medium: 2, low: 1 };

const LANE_ORDER = ['inbox', 'ready', 'blocked', 'in-progress', 'done', 'archive'] as const;
const LANE_TONE: Record<string, string> = {
  inbox: 'var(--lane-inbox)', ready: 'var(--lane-ready)', blocked: 'var(--lane-blocked)',
  'in-progress': 'var(--lane-progress)', done: 'var(--lane-done)', archive: 'var(--lane-archive)',
};

const REC_COLUMNS: { id: RecColumn; title: string; tone: string }[] = [
  { id: 'next', title: 'Next up', tone: 'var(--lane-ready)' },
  { id: 'blocked', title: 'Blocked', tone: 'var(--lane-blocked)' },
  { id: 'other', title: 'Other open', tone: 'var(--lane-archive)' },
  { id: 'closed', title: 'Closed', tone: 'var(--lane-done)' },
];

export function matchesFilter(item: BoardItem, filter: StatusFilter): boolean {
  if (filter === 'open') return !item.closed;
  if (filter === 'ready') return item.ready;
  // Closed items keep their blocked flag, but the filter (and its count pill,
  // which tallies open items only) means actionable blocked work.
  if (filter === 'blocked') return item.blocked && !item.closed;
  if (filter === 'review') return item.reviewDue;
  if (filter === 'closed') return item.closed;
  return true;
}

export function matchesQuery(item: BoardItem, query: string): boolean {
  if (!query) return true;
  const lifecycleSearchText = (item.lifecycleLinks ?? []).map((row) => [
    row.kind, row.stage, row.status, row.label, row.session, row.sessionId, row.prdId, row.runId,
    row.buildSessionId, row.prUrl, row.featureBranch, row.branch, row.commitSha,
    row.affectedItemIds?.join(' '), row.affectedEpicIds?.join(' '),
  ].filter(Boolean).join(' ')).join('\n');
  const haystack = [
    item.id, item.title, item.status, item.priority, item.tags.join(' '),
    item.dependencies.map((dep) => dep.id).join(' '), item.epic ?? '', item.epicRef?.title ?? '',
    item.notes?.claim ?? '', item.notes?.evidence ?? '', item.notes?.recheck ?? '',
    lifecycleSearchText,
    item.userStatus ?? '', item.effectiveLifecycle ?? '', (item.reasonCodes ?? []).join(' '),
    (item.associatedLinks ?? []).map((row) => [row.kind, row.label, row.session, row.runId, row.prUrl, row.commitSha].filter(Boolean).join(' ')).join(' '),
    (item.snippets ?? []).join(' '),
  ].join('\n').toLowerCase();
  return haystack.includes(query);
}

export function filterItems(items: BoardItem[], query: string, filter: StatusFilter): BoardItem[] {
  const normalizedQuery = query.trim().toLowerCase();
  return items.filter((item) => matchesFilter(item, filter) && matchesQuery(item, normalizedQuery));
}

export function recColumnFor(item: BoardItem): RecColumn {
  if (item.closed) return 'closed';
  if (item.recRank !== undefined) return 'next';
  if (item.blocked) return 'blocked';
  return 'other';
}

function sortItems(items: BoardItem[]): BoardItem[] {
  return [...items].sort((a, b) => {
    if (a.blocked !== b.blocked) return a.blocked ? 1 : -1;
    const priority = (PRIORITY_RANK[b.priority] ?? 0) - (PRIORITY_RANK[a.priority] ?? 0);
    if (priority !== 0) return priority;
    return a.title.localeCompare(b.title);
  });
}

export function epicGroups(items: BoardItem[], epics: Epic[] = []): EpicGroup[] {
  const groups = new Map<string, EpicGroup>();
  for (const epic of epics) {
    const count = epic.openItemCount ?? epic.itemCount ?? 0;
    if (count > 0) groups.set(epic.id, { id: epic.id, title: epic.title ?? epic.id, count, missing: false });
  }
  for (const item of items) {
    if (!item.epicRef) continue;
    const existing = groups.get(item.epicRef.id);
    if (existing) {
      if (!epics.some((epic) => epic.id === item.epicRef?.id)) existing.count += 1;
    } else groups.set(item.epicRef.id, { id: item.epicRef.id, title: item.epicRef.title, count: 1, missing: item.epicRef.missing });
  }
  return [...groups.values()].sort((a, b) => Number(a.missing) - Number(b.missing) || a.title.localeCompare(b.title));
}

export function buildColumns(board: Board, items: BoardItem[], group: GroupMode): BoardColumn[] {
  if (group === 'epic') return buildEpicColumns(board, items);
  if (group === 'recommended') return buildRecommendedColumns(items);
  return buildLaneColumns(board, items);
}

function buildLaneColumns(board: Board, items: BoardItem[]): BoardColumn[] {
  const visible = new Set(items.map((item) => item.id));
  const laneById = new Map(board.lanes.map((lane) => [lane.lane, lane]));
  const lanesPresent = LANE_ORDER.filter((lane) => laneById.has(lane));
  return lanesPresent.map((lane) => {
    const boardLane = laneById.get(lane);
    const laneItems = sortItems(items.filter((item) => item.lane === lane && visible.has(item.id)));
    return {
      key: lane,
      title: boardLane?.title ?? lane,
      tone: LANE_TONE[lane] ?? 'var(--lane-archive)',
      items: laneItems,
      count: boardLane?.count,
      pagination: boardLane?.pagination,
    };
  }).filter((column) => {
    if (column.items.length > 0) return true;
    const boardLane = laneById.get(column.key);
    return (column.key === 'done' || column.key === 'archive') && items.length === board.items.length && boardLane?.items.length === 0 && (column.count ?? 0) > 0;
  });
}

function buildEpicColumns(board: Board, items: BoardItem[]): BoardColumn[] {
  const groups = epicGroups(items, board.epics ?? []);
  const columns: BoardColumn[] = groups.map((group) => ({
    key: group.id,
    title: group.title,
    tone: group.missing ? 'var(--lane-blocked)' : 'var(--lane-ready)',
    items: sortItems(items.filter((item) => item.epicRef?.id === group.id)),
  }));
  const unassigned = items.filter((item) => !item.epicRef);
  if (unassigned.length > 0) columns.push({ key: '', title: 'No epic', tone: 'var(--lane-archive)', items: sortItems(unassigned) });
  return columns;
}

function buildRecommendedColumns(items: BoardItem[]): BoardColumn[] {
  return REC_COLUMNS
    .map((column) => ({
      key: column.id,
      title: column.title,
      tone: column.tone,
      items: column.id === 'next'
        ? [...items.filter((item) => recColumnFor(item) === 'next')].sort((a, b) => (a.recRank ?? Infinity) - (b.recRank ?? Infinity))
        : sortItems(items.filter((item) => recColumnFor(item) === column.id)),
    }))
    .filter((column) => column.key !== 'closed' || column.items.length > 0);
}

export function findDependencyCycles(items: BoardItem[]): string[][] {
  const byId = new Map(items.map((item) => [item.id, item]));
  const visited = new Set<string>();
  const cycles = new Map<string, string[]>();
  const visit = (id: string, stack: string[]): void => {
    const existingIndex = stack.indexOf(id);
    if (existingIndex >= 0) {
      const cycle = [...stack.slice(existingIndex), id];
      cycles.set(canonicalKey(cycle), cycle);
      return;
    }
    if (visited.has(id)) return;
    const item = byId.get(id);
    if (!item) return;
    visited.add(id);
    for (const dep of item.dependencies) visit(dep.id, [...stack, id]);
  };
  for (const item of items) visit(item.id, []);
  return [...cycles.values()];
}

function canonicalKey(cycle: string[]): string {
  const nodes = cycle.slice(0, -1);
  const rotations = nodes.map((_node, index) => [...nodes.slice(index), ...nodes.slice(0, index)].join('→'));
  return rotations.sort()[0] ?? cycle.join('→');
}

export function shortId(id: string): string {
  return id.replace(/^backlog-\d{4}-\d{2}-\d{2}-/, '');
}

export function stats(items: BoardItem[], board?: Board): { open: number; ready: number; blocked: number; review: number; closed: number } {
  const open = items.filter((item) => !item.closed);
  return {
    open: board?.counts?.open ?? open.length,
    ready: open.filter((item) => item.ready).length,
    blocked: open.filter((item) => item.blocked).length,
    review: items.filter((item) => item.reviewDue).length,
    closed: board?.counts?.closed ?? items.filter((item) => item.closed).length,
  };
}

export function allEpicChips(items: BoardItem[], epics: Epic[]): EpicGroup[] {
  return epicGroups(items, epics);
}

// Epics with no items but authored body content are used as standalone "horizon"
// containers - detailed future ideas parked outside the actionable backlog.
// `epicGroups` drops them (count === 0), so they get their own surface instead of
// vanishing. See backlog item add-horizon-items-to-eforge-plan.
export function standaloneEpics(epics: Epic[] = []): Epic[] {
  return epics
    .filter((epic) => (epic.openItemCount ?? epic.itemCount ?? 0) === 0 && epic.hasBody === true)
    .sort((a, b) => (a.title ?? a.id).localeCompare(b.title ?? b.id));
}
