import {
  KANBAN_LANES,
  extractMarkdownSections,
  isClosedStatus,
  summarizeTraceActivity,
  unresolvedDependencies,
  type BacklogEpic,
  type BacklogItem,
  type BacklogStatus,
  type KanbanLane,
  type TraceSummary,
} from './backlog-domain.js';
import { projectItemLifecycle } from './lifecycle-projection.js';
import type { LifecycleLinkRow, LifecycleState } from './backlog-domain.js';
import { emptyRecommendationIndex, type RecommendationIndex } from './recommendation-index.js';

const LANE_TITLES: Record<KanbanLane, string> = {
  inbox: 'Inbox',
  ready: 'Ready',
  blocked: 'Blocked',
  'in-progress': 'In progress',
  done: 'Done',
  archive: 'Archive',
};

const SATISFIED_DEPENDENCY_STATUSES = new Set<BacklogStatus>(['shipped', 'superseded']);

export interface KanbanDependencyRef {
  id: string;
  title: string;
  status?: BacklogStatus;
  missing: boolean;
  blocking: boolean;
}

export interface KanbanEpicRef {
  id: string;
  title: string;
  status?: BacklogStatus;
  missing: boolean;
}

export interface KanbanCardNotes {
  claim: string;
  evidence: string;
  recheck: string;
  promotionPaths: string;
}

export interface KanbanCard {
  id: string;
  title: string;
  status: BacklogItem['status'];
  priority: string;
  tags: string[];
  lane: KanbanLane;
  reasons: string[];
  unresolvedDependsOn: string[];
  activeTraceReasons: string[];
  blocked: boolean;
  ready: boolean;
  reviewDue: boolean;
  closed: boolean;
  epic?: string;
  epicRef?: KanbanEpicRef;
  dependencies: KanbanDependencyRef[];
  dependents: KanbanDependencyRef[];
  notes: KanbanCardNotes;
  recRank?: number;
  recLanes: string[];
  recUnblock?: string;
  lifecycleState: LifecycleState;
  linkRows: LifecycleLinkRow[];
  failureEvidence: LifecycleLinkRow[];
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

export interface ProjectKanbanBoardOptions {
  includeArchive?: boolean;
  epic?: string;
  epics?: readonly BacklogEpic[];
  recommendationIndex?: RecommendationIndex;
  now?: string;
}

export function projectKanbanBoard(
  items: readonly BacklogItem[],
  traces: readonly TraceSummary[] = [],
  options: ProjectKanbanBoardOptions = {},
): KanbanBoardProjection {
  const traceByItemId = new Map(traces.map((trace) => [trace.itemId, trace]));
  const itemsById = new Map(items.map((item) => [item.id, item]));
  const epicsById = new Map((options.epics ?? []).map((epic) => [epic.id, epic]));
  const recommendationIndex = options.recommendationIndex ?? emptyRecommendationIndex();
  const now = options.now ?? new Date().toISOString().slice(0, 10);
  const cards = items
    .filter((item) => options.epic === undefined || item.epic === options.epic)
    .map((item) => projectCard(item, items, itemsById, epicsById, traceByItemId.get(item.id), recommendationIndex, now));
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

function projectCard(
  item: BacklogItem,
  items: readonly BacklogItem[],
  itemsById: Map<string, BacklogItem>,
  epicsById: Map<string, BacklogEpic>,
  trace: TraceSummary | undefined,
  recommendationIndex: RecommendationIndex,
  now: string,
): KanbanCard {
  const lane = laneForItem(item, items, trace);
  const sections = extractMarkdownSections(item.body);
  const closed = isClosedStatus(item.status);
  const blockingIds = new Set(item.depends_on.filter((id) => isBlockingDependency(id, itemsById)));
  const dependencies = item.depends_on.map((id) => dependencyRef(id, itemsById, blockingIds.has(id)));
  const recRank = recommendationIndex.rankById.get(item.id);
  const lifecycle = projectItemLifecycle(item, trace);
  return {
    id: item.id,
    title: item.title,
    status: item.status,
    priority: item.priority ?? 'medium',
    tags: item.tags,
    lane: lane.lane,
    reasons: lane.reasons,
    unresolvedDependsOn: lane.unresolvedDependsOn,
    activeTraceReasons: lane.activeTraceReasons,
    blocked: blockingIds.size > 0,
    ready: !closed && blockingIds.size === 0,
    reviewDue: isReviewDue(item, now),
    closed,
    epic: item.epic,
    ...(item.epic !== undefined ? { epicRef: epicRef(item.epic, epicsById) } : {}),
    dependencies,
    dependents: items
      .filter((candidate) => candidate.depends_on.includes(item.id))
      .map((candidate) => dependencyRef(candidate.id, itemsById, false)),
    notes: {
      claim: sections.get('Claim') ?? '',
      evidence: sections.get('Evidence') ?? '',
      recheck: sections.get('Recheck') ?? '',
      promotionPaths: sections.get('Promotion Paths') ?? '',
    },
    ...(recRank !== undefined ? { recRank } : {}),
    recLanes: recommendationIndex.lanesById.get(item.id) ?? [],
    ...(recommendationIndex.unblockById.has(item.id) ? { recUnblock: recommendationIndex.unblockById.get(item.id) } : {}),
    lifecycleState: lifecycle.lifecycleState,
    linkRows: lifecycle.linkRows,
    failureEvidence: lifecycle.failureEvidence,
  };
}

function isBlockingDependency(id: string, itemsById: Map<string, BacklogItem>): boolean {
  const dependency = itemsById.get(id);
  return !dependency || !SATISFIED_DEPENDENCY_STATUSES.has(dependency.status);
}

function dependencyRef(id: string, itemsById: Map<string, BacklogItem>, blocking: boolean): KanbanDependencyRef {
  const item = itemsById.get(id);
  return {
    id,
    title: item?.title ?? `Missing dependency: ${id}`,
    ...(item ? { status: item.status } : {}),
    missing: !item,
    blocking,
  };
}

function epicRef(id: string, epicsById: Map<string, BacklogEpic>): KanbanEpicRef {
  const epic = epicsById.get(id);
  return {
    id,
    title: epic?.title ?? `Missing epic: ${id}`,
    ...(epic ? { status: epic.status } : {}),
    missing: !epic,
  };
}

function isReviewDue(item: BacklogItem, now: string): boolean {
  if (isClosedStatus(item.status)) return false;
  return item.stale_after !== undefined && item.stale_after < now;
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
