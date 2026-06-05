import {
  KANBAN_LANES,
  isClosedStatus,
  summarizeTraceActivity,
  unresolvedDependencies,
  type BacklogItem,
  type KanbanLane,
  type TraceSummary,
} from './backlog-domain.js';

const LANE_TITLES: Record<KanbanLane, string> = {
  inbox: 'Inbox',
  ready: 'Ready',
  blocked: 'Blocked',
  'in-progress': 'In progress',
  done: 'Done',
  archive: 'Archive',
};

export interface KanbanCard {
  id: string;
  title: string;
  status: BacklogItem['status'];
  lane: KanbanLane;
  reasons: string[];
  unresolvedDependsOn: string[];
  activeTraceReasons: string[];
  epic?: string;
}

export interface KanbanLaneProjection {
  lane: KanbanLane;
  title: string;
  items: KanbanCard[];
}

export interface KanbanBoardProjection {
  lanes: KanbanLaneProjection[];
  items: KanbanCard[];
}

export function projectKanbanBoard(
  items: readonly BacklogItem[],
  traces: readonly TraceSummary[] = [],
  options: { includeArchive?: boolean; epic?: string } = {},
): KanbanBoardProjection {
  const traceByItemId = new Map(traces.map((trace) => [trace.itemId, trace]));
  const cards = items
    .filter((item) => options.epic === undefined || item.epic === options.epic)
    .map((item) => projectCard(item, items, traceByItemId.get(item.id)));
  const lanes = KANBAN_LANES
    .filter((lane) => options.includeArchive !== false || lane !== 'archive')
    .map((lane) => ({ lane, title: LANE_TITLES[lane], items: cards.filter((card) => card.lane === lane) }));
  return { lanes, items: cards };
}

export const deriveKanbanBoard = projectKanbanBoard;

export function laneForItem(
  item: BacklogItem,
  items: readonly BacklogItem[],
  trace: TraceSummary | undefined,
): { lane: KanbanLane; reasons: string[]; unresolvedDependsOn: string[]; activeTraceReasons: string[] } {
  const activeTraceReasons = summarizeTraceActivity(trace);
  if (item.status === 'shipped') {
    return explain('done', ['status shipped is complete'], [], activeTraceReasons);
  }
  if (item.status === 'stale' || item.status === 'superseded') {
    return explain('archive', [`status ${item.status} is archived`], [], activeTraceReasons);
  }
  const unresolved = unresolvedDependencies(item, items);
  if (unresolved.length > 0) {
    return explain('blocked', [`unresolved dependencies: ${unresolved.join(', ')}`], unresolved, activeTraceReasons);
  }
  if (activeTraceReasons.length > 0) {
    return explain('in-progress', activeTraceReasons, [], activeTraceReasons);
  }
  if (item.status === 'active') {
    return explain('in-progress', ['status active is in progress'], [], activeTraceReasons);
  }
  if (item.status === 'planned') {
    return explain('ready', ['status planned is ready'], [], activeTraceReasons);
  }
  return explain('inbox', ['status candidate starts in inbox'], [], activeTraceReasons);
}

export function isDerivedBlocked(card: KanbanCard): boolean {
  return card.lane === 'blocked' && String(card.status) !== 'blocked';
}

function projectCard(item: BacklogItem, items: readonly BacklogItem[], trace: TraceSummary | undefined): KanbanCard {
  const lane = laneForItem(item, items, trace);
  return {
    id: item.id,
    title: item.title,
    status: item.status,
    lane: lane.lane,
    reasons: lane.reasons,
    unresolvedDependsOn: lane.unresolvedDependsOn,
    activeTraceReasons: lane.activeTraceReasons,
    epic: item.epic,
  };
}

function explain(
  lane: KanbanLane,
  reasons: string[],
  unresolvedDependsOn: string[],
  activeTraceReasons: string[],
): { lane: KanbanLane; reasons: string[]; unresolvedDependsOn: string[]; activeTraceReasons: string[] } {
  return { lane, reasons, unresolvedDependsOn, activeTraceReasons };
}

export function isClosedDependency(item: BacklogItem | undefined): boolean {
  return item ? isClosedStatus(item.status) : false;
}
