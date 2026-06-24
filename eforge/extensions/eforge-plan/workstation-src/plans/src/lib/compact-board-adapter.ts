import type {
  Board,
  BoardItem,
  CompactBoardDetailResponse,
  CompactBoardItem,
  CompactBoardResponse,
  CompactItemDetail,
  DependencyRef,
  Epic,
  GetRecommendationsResponse,
  RecommendationModel,
} from '@/types';

export function boardFromCompact(response: CompactBoardResponse, recommendations?: RecommendationModel | null): Board {
  const epics = compactEpics(response);
  const epicRefs = new Map(epics.map((epic) => [epic.id, epic]));
  const rec = recommendationIndex(recommendations);
  const items = response.items.map((item) => boardItemFromCompact(item, epicRefs, rec));
  const itemsByLane = groupItemsByLane(items);
  const lanes: Array<{ lane: string; title: string; count: number; openCount: number; closedCount: number; pagination?: Board['pagination'] }> = response.lanes ?? laneSummariesFromItems(items);
  return {
    lanes: lanes.map((lane) => ({
      lane: lane.lane,
      title: lane.title,
      items: itemsByLane.get(lane.lane) ?? [],
      count: lane.count,
      openCount: lane.openCount,
      closedCount: lane.closedCount,
      pagination: lane.pagination,
    })),
    items,
    epics,
    counts: response.counts ?? countsFromItems(items),
    pagination: response.pagination ?? { limit: response.limit, offset: response.offset, returned: items.length, hasMore: response.offset + items.length < response.total },
  };
}

export type CompactPageMergeScope = { scope: 'board' } | { scope: 'lane'; lane: string };

export function mergeCompactLanePage(board: Board, response: CompactBoardResponse, recommendations?: RecommendationModel | null, mergeScope?: CompactPageMergeScope): Board {
  const page = boardFromCompact(response, recommendations);
  const selectedLane = mergeScope?.scope === 'lane' ? mergeScope.lane : undefined;
  const lanePage = selectedLane !== undefined || (mergeScope === undefined && page.lanes.some((lane) => lane.pagination !== undefined));
  const incomingIds = new Set(page.items.map((item) => item.id));
  const mergedItems = [...(board.items ?? []).filter((item) => !incomingIds.has(item.id)), ...page.items];
  const pageLanesById = new Map(page.lanes.map((lane) => [lane.lane, lane]));
  const lanesById = new Map((board.lanes ?? []).map((lane) => [lane.lane, { ...lane, items: mergedItems.filter((item) => item.lane === lane.lane) }]));
  for (const lane of page.lanes) {
    const existing = lanesById.get(lane.lane);
    const lanePagination = lane.pagination ?? (selectedLane === lane.lane ? response.pagination : undefined) ?? existing?.pagination;
    lanesById.set(lane.lane, { ...lane, pagination: lanePagination, items: mergedItems.filter((item) => item.lane === lane.lane) });
  }
  const lanes = [...lanesById.values()].map((lane) => {
    const fresh = pageLanesById.get(lane.lane);
    const freshPagination = fresh?.pagination ?? (selectedLane === lane.lane ? response.pagination : undefined) ?? lane.pagination;
    return fresh ? { ...lane, count: fresh.count, openCount: fresh.openCount, closedCount: fresh.closedCount, pagination: freshPagination } : lane;
  });
  return { ...board, items: mergedItems, lanes, counts: response.counts ?? board.counts, pagination: lanePage ? board.pagination : response.pagination ?? board.pagination };
}

export function mergeCompactItemDetail(summary: BoardItem, response: CompactBoardDetailResponse): BoardItem {
  return mergeDetailIntoItem(summary, response.item, response.dependencies ?? [], response.dependents ?? []);
}

export function mergeDetailIntoBoard(board: Board, response: CompactBoardDetailResponse): Board {
  const byId = new Map((board.items ?? []).map((item) => [item.id, item]));
  const existing = byId.get(response.item.id) ?? boardItemFromCompact(response.item, new Map(), recommendationIndex(null));
  byId.set(response.item.id, mergeCompactItemDetail(existing, response));
  const items = [...byId.values()];
  return { ...board, items, lanes: (board.lanes ?? []).map((lane) => ({ ...lane, items: items.filter((item) => item.lane === lane.lane) })) };
}

function boardItemFromCompact(item: CompactBoardItem, epics: Map<string, Epic>, rec: Map<string, { rank?: number; lanes: string[]; unblock?: string }>): BoardItem {
  const recEntry = rec.get(item.id);
  return {
    id: item.id,
    title: item.title,
    status: item.status,
    priority: item.priority,
    tags: item.tags,
    lane: item.lane,
    reasons: item.reasons,
    unresolvedDependsOn: item.unresolvedDependsOn ?? [],
    activeTraceReasons: item.activeTraceReasons ?? [],
    blocked: item.blocked,
    ready: item.ready,
    reviewDue: item.reviewDue,
    closed: item.closed,
    ...(item.epic ? { epic: item.epic, epicRef: epicRef(item.epic, epics) } : {}),
    dependencies: (item.dependsOn ?? []).map((id) => dependencyRef(id, (item.unresolvedDependsOn ?? []).includes(id))),
    dependents: [],
    notes: { claim: '', evidence: '', recheck: '', promotionPaths: '' },
    ...(recEntry?.rank !== undefined ? { recRank: recEntry.rank } : {}),
    recLanes: recEntry?.lanes ?? [],
    ...(recEntry?.unblock ? { recUnblock: recEntry.unblock } : {}),
    lifecycleState: item.lifecycleState,
    userStatus: item.userStatus,
    effectiveLifecycle: item.effectiveLifecycle,
    reasonCodes: item.reasonCodes ?? [],
    associatedLinks: item.associatedLinks ?? [],
    linkRows: item.linkRows ?? item.associatedLinks ?? [],
    lifecycleLinks: item.linkRows ?? item.associatedLinks ?? [],
    snippets: item.snippet?.text ? [item.snippet.text] : [],
  };
}

function mergeDetailIntoItem(summary: BoardItem, detail: CompactItemDetail, dependencies: CompactBoardItem[], dependents: CompactBoardItem[]): BoardItem {
  const sections = detail.sections ?? {};
  const unresolvedDependsOn = detail.unresolvedDependsOn ?? [];
  const section = (name: string) => sections[name] ?? sections[name.toLowerCase()] ?? '';
  return {
    ...summary,
    ...boardItemFromCompact(detail, new Map(), recommendationIndex(null)),
    epicRef: summary.epicRef,
    recRank: summary.recRank,
    recLanes: summary.recLanes,
    recUnblock: summary.recUnblock,
    dependencies: dependencies.map((item) => dependencyRef(item.id, unresolvedDependsOn.includes(item.id), item.title, item.status)),
    dependents: dependents.map((item) => dependencyRef(item.id, false, item.title, item.status)),
    notes: {
      claim: section('Claim'),
      evidence: section('Evidence'),
      recheck: section('Recheck'),
      promotionPaths: section('Promotion Paths'),
    },
    linkRows: detail.linkRows ?? detail.associatedLinks ?? [],
    lifecycleLinks: detail.linkRows ?? detail.associatedLinks ?? [],
    failureEvidence: detail.failureEvidence ?? [],
    lifecycleState: detail.lifecycleState,
    userStatus: detail.userStatus,
    effectiveLifecycle: detail.effectiveLifecycle,
    reasonCodes: detail.reasonCodes ?? [],
    associatedLinks: detail.associatedLinks ?? [],
    snippets: detail.snippet?.text ? [detail.snippet.text] : summary.snippets,
  };
}

function compactEpics(response: Pick<CompactBoardResponse, 'epics'>): Epic[] {
  return (response.epics ?? []).map((epic) => ({
    id: epic.id,
    title: epic.title,
    status: epic.status,
    priority: epic.priority,
    tags: epic.tags,
    itemCount: epic.itemCount,
    openItemCount: epic.openItemCount,
    hasBody: epic.hasBody,
  }));
}

function laneSummariesFromItems(items: BoardItem[]) {
  return [...groupItemsByLane(items).entries()].map(([lane, laneItems]) => ({
    lane,
    title: lane,
    count: laneItems.length,
    openCount: laneItems.filter((item) => !item.closed).length,
    closedCount: laneItems.filter((item) => item.closed).length,
  }));
}

function countsFromItems(items: BoardItem[]) {
  return { total: items.length, open: items.filter((item) => !item.closed).length, closed: items.filter((item) => item.closed).length };
}

function groupItemsByLane(items: BoardItem[]): Map<string, BoardItem[]> {
  const grouped = new Map<string, BoardItem[]>();
  for (const item of items) grouped.set(item.lane, [...(grouped.get(item.lane) ?? []), item]);
  return grouped;
}

function epicRef(id: string, epics: Map<string, Epic>) {
  const epic = epics.get(id);
  return { id, title: epic?.title ?? id, status: epic?.status, missing: !epic };
}

function dependencyRef(id: string, blocking: boolean, title = id, status?: string): DependencyRef {
  return { id, title, status, missing: false, blocking };
}

function recommendationIndex(model?: RecommendationModel | null): Map<string, { rank?: number; lanes: string[]; unblock?: string }> {
  const index = new Map<string, { rank?: number; lanes: string[]; unblock?: string }>();
  model?.recommendedNextSequence.forEach((entry, offset) => {
    const existing = index.get(entry.itemId) ?? { lanes: [] };
    index.set(entry.itemId, { ...existing, rank: offset + 1 });
  });
  for (const group of model?.safeParallelizableGroups ?? []) {
    for (const itemId of group.itemIds) {
      const existing = index.get(itemId) ?? { lanes: [] };
      index.set(itemId, { ...existing, lanes: [...existing.lanes, group.title ?? group.ref] });
    }
  }
  for (const chain of model?.blockedChains ?? []) {
    for (const itemId of chain.itemIds) {
      const existing = index.get(itemId) ?? { lanes: [] };
      index.set(itemId, { ...existing, unblock: chain.rationale });
    }
  }
  return index;
}

export function recommendationsFromResponse(response: GetRecommendationsResponse | null): RecommendationModel | null {
  return response?.recommendations ?? null;
}
