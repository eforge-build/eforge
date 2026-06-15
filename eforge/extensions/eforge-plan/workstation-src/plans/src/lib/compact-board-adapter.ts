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
  return {
    lanes: response.lanes.map((lane) => ({
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
    counts: response.counts,
    pagination: response.pagination,
  };
}

export function mergeCompactLanePage(board: Board, response: CompactBoardResponse, recommendations?: RecommendationModel | null): Board {
  const page = boardFromCompact(response, recommendations);
  const incomingIds = new Set(page.items.map((item) => item.id));
  const mergedItems = [...(board.items ?? []).filter((item) => !incomingIds.has(item.id)), ...page.items];
  const pageLanesById = new Map(page.lanes.map((lane) => [lane.lane, lane]));
  const lanesById = new Map((board.lanes ?? []).map((lane) => [lane.lane, { ...lane, items: mergedItems.filter((item) => item.lane === lane.lane) }]));
  for (const lane of page.lanes) {
    lanesById.set(lane.lane, { ...lane, items: mergedItems.filter((item) => item.lane === lane.lane) });
  }
  const lanes = [...lanesById.values()].map((lane) => {
    const fresh = pageLanesById.get(lane.lane);
    return fresh ? { ...lane, count: fresh.count, openCount: fresh.openCount, closedCount: fresh.closedCount, pagination: fresh.pagination } : lane;
  });
  return { ...board, items: mergedItems, lanes, counts: response.counts ?? board.counts, pagination: response.pagination ?? board.pagination };
}

export function mergeCompactItemDetail(summary: BoardItem, response: CompactBoardDetailResponse): BoardItem {
  return mergeDetailIntoItem(summary, response.item, response.dependencies, response.dependents);
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
    unresolvedDependsOn: item.unresolvedDependsOn,
    activeTraceReasons: item.activeTraceReasons ?? [],
    blocked: item.blocked,
    ready: item.ready,
    reviewDue: item.reviewDue,
    closed: item.closed,
    ...(item.epic ? { epic: item.epic, epicRef: epicRef(item.epic, epics) } : {}),
    dependencies: item.dependsOn.map((id) => dependencyRef(id, item.unresolvedDependsOn.includes(id))),
    dependents: [],
    notes: { claim: '', evidence: '', recheck: '', promotionPaths: '' },
    ...(recEntry?.rank !== undefined ? { recRank: recEntry.rank } : {}),
    recLanes: recEntry?.lanes ?? [],
    ...(recEntry?.unblock ? { recUnblock: recEntry.unblock } : {}),
    lifecycleState: item.lifecycleState,
  };
}

function mergeDetailIntoItem(summary: BoardItem, detail: CompactItemDetail, dependencies: CompactBoardItem[], dependents: CompactBoardItem[]): BoardItem {
  const section = (name: string) => detail.sections[name] ?? detail.sections[name.toLowerCase()] ?? '';
  return {
    ...summary,
    ...boardItemFromCompact(detail, new Map(), recommendationIndex(null)),
    epicRef: summary.epicRef,
    recRank: summary.recRank,
    recLanes: summary.recLanes,
    recUnblock: summary.recUnblock,
    dependencies: dependencies.map((item) => dependencyRef(item.id, detail.unresolvedDependsOn.includes(item.id), item.title, item.status)),
    dependents: dependents.map((item) => dependencyRef(item.id, false, item.title, item.status)),
    notes: {
      claim: section('Claim'),
      evidence: section('Evidence'),
      recheck: section('Recheck'),
      promotionPaths: section('Promotion Paths'),
    },
    linkRows: detail.linkRows,
    lifecycleLinks: detail.linkRows,
    failureEvidence: detail.failureEvidence,
    lifecycleState: detail.lifecycleState,
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
  }));
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
