import {
  CONTRIBUTION_OUTPUT_PROFILES,
  createContributionPaginationInputFields,
  defineExtensionAction,
  paginateContributionItems,
  Type,
  type Static,
} from '@eforge-build/extension-sdk';
import { extractMarkdownSections, isClosedStatus, type BacklogEpic, type BacklogItem, type KanbanLane } from './backlog-domain.js';
// --- eforge:region plan-04-projections-lifecycle ---
import { getEpicDetailProjection, getItemDetailProjection, listBoardCompactProjection } from './projections/index.js';
// --- eforge:endregion plan-04-projections-lifecycle ---
import { projectKanbanBoard, type KanbanCard } from './kanban.js';
import {
  listBacklogEpics,
  listBacklogItems,
  readBacklogEpic,
  resolveBacklogEpicRelativePath,
  resolveBacklogItemRelativePath,
} from './markdown-store.js';
import { toJsonSafeObject } from './json-safe.js';
import { listTraceSidecars } from './trace-store.js';
import { summarizeProjectTraces } from './trace-activity.js';
import { BacklogStatusSchema, KanbanLaneSchema, LifecycleStateSchema } from './schema.js';

// --- eforge:region compact-query-schemas ---
const CompactItemSchema = Type.Object({
  id: Type.String(),
  title: Type.String(),
  status: BacklogStatusSchema,
  priority: Type.String(),
  tags: Type.Array(Type.String()),
  lane: KanbanLaneSchema,
  reasons: Type.Array(Type.String()),
  dependsOn: Type.Optional(Type.Array(Type.String())),
  unresolvedDependsOn: Type.Optional(Type.Array(Type.String())),
  activeTraceReasons: Type.Array(Type.String()),
  blocked: Type.Boolean(),
  ready: Type.Boolean(),
  reviewDue: Type.Boolean(),
  closed: Type.Boolean(),
  hasBody: Type.Optional(Type.Boolean()),
  updatedAt: Type.Optional(Type.String()),
  epic: Type.Optional(Type.String()),
  lifecycleState: LifecycleStateSchema,
  // --- eforge:region plan-04-projections-lifecycle ---
  userStatus: Type.Optional(BacklogStatusSchema),
  effectiveLifecycle: Type.Optional(LifecycleStateSchema),
  reasonCodes: Type.Optional(Type.Array(Type.String())),
  associatedLinks: Type.Optional(Type.Array(Type.Object({}, { additionalProperties: Type.Unknown() }))),
  // --- eforge:endregion plan-04-projections-lifecycle ---
}, { additionalProperties: false });

const CompactLifecycleLinkRowSchema = Type.Object({}, { additionalProperties: Type.Unknown() });

const CompactEpicSchema = Type.Object({
  id: Type.String(),
  title: Type.String(),
  status: BacklogStatusSchema,
  userStatus: Type.Optional(BacklogStatusSchema),
  priority: Type.Optional(Type.String()),
  tags: Type.Array(Type.String()),
  itemCount: Type.Integer({ minimum: 0 }),
  totalItems: Type.Optional(Type.Integer({ minimum: 0 })),
  openItemCount: Type.Integer({ minimum: 0 }),
  hasBody: Type.Boolean(),
}, { additionalProperties: false });

const PageInputFields = createContributionPaginationInputFields({ maxLimit: 100 });

const GetItemInputSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  includeBody: Type.Optional(Type.Boolean()),
  includeEpic: Type.Optional(Type.Boolean()),
  includeSections: Type.Optional(Type.Boolean()),
  includeLifecycleRows: Type.Optional(Type.Boolean()),
  includeDependencies: Type.Optional(Type.Boolean()),
  includeDependents: Type.Optional(Type.Boolean()),
}, { additionalProperties: false });

const GetItemOutputSchema = Type.Object({
  schemaVersion: Type.Literal(1),
  item: Type.Object({
    ...CompactItemSchema.properties,
    path: Type.String(),
    sections: Type.Optional(Type.Record(Type.String(), Type.String())),
    linkRows: Type.Optional(Type.Array(CompactLifecycleLinkRowSchema)),
    failureEvidence: Type.Optional(Type.Array(CompactLifecycleLinkRowSchema)),
    body: Type.Optional(Type.String()),
  }, { additionalProperties: false }),
  epic: Type.Optional(CompactEpicSchema),
  dependencies: Type.Optional(Type.Array(CompactItemSchema)),
  dependents: Type.Optional(Type.Array(CompactItemSchema)),
}, { additionalProperties: false });

const GetEpicInputSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  includeBody: Type.Optional(Type.Boolean()),
  includeItems: Type.Optional(Type.Boolean()),
  includeSections: Type.Optional(Type.Boolean()),
  includeItemDependencies: Type.Optional(Type.Boolean()),
  ...PageInputFields,
}, { additionalProperties: false });

const GetEpicOutputSchema = Type.Object({
  schemaVersion: Type.Literal(1),
  epic: Type.Object({
    ...CompactEpicSchema.properties,
    path: Type.String(),
    sections: Type.Optional(Type.Record(Type.String(), Type.String())),
    body: Type.Optional(Type.String()),
  }, { additionalProperties: false }),
  items: Type.Array(CompactItemSchema),
  totalItems: Type.Integer({ minimum: 0 }),
  itemCount: Type.Optional(Type.Integer({ minimum: 0 })),
  openItemCount: Type.Optional(Type.Integer({ minimum: 0 })),
  limit: Type.Integer({ minimum: 1 }),
  offset: Type.Integer({ minimum: 0 }),
}, { additionalProperties: false });

const SearchItemsInputSchema = Type.Object({
  query: Type.Optional(Type.String()),
  epic: Type.Optional(Type.String()),
  status: Type.Optional(BacklogStatusSchema),
  lane: Type.Optional(KanbanLaneSchema),
  tags: Type.Optional(Type.Array(Type.String())),
  includeArchive: Type.Optional(Type.Boolean()),
  searchBody: Type.Optional(Type.Boolean()),
  includeEpics: Type.Optional(Type.Boolean()),
  includeDependencies: Type.Optional(Type.Boolean()),
  ...PageInputFields,
}, { additionalProperties: false });

const SearchItemsOutputSchema = Type.Object({
  schemaVersion: Type.Literal(1),
  items: Type.Array(CompactItemSchema),
  epics: Type.Optional(Type.Array(CompactEpicSchema)),
  total: Type.Integer({ minimum: 0 }),
  limit: Type.Integer({ minimum: 1 }),
  offset: Type.Integer({ minimum: 0 }),
}, { additionalProperties: false });

const ListBoardCompactInputSchema = Type.Object({
  epic: Type.Optional(Type.String()),
  lane: Type.Optional(KanbanLaneSchema),
  includeClosed: Type.Optional(Type.Boolean()),
  includeArchive: Type.Optional(Type.Boolean()),
  includeEpics: Type.Optional(Type.Boolean()),
  includeLaneCounts: Type.Optional(Type.Boolean()),
  includeDependencies: Type.Optional(Type.Boolean()),
  ...PageInputFields,
}, { additionalProperties: false });

const PageMetadataSchema = Type.Object({
  limit: Type.Integer({ minimum: 1 }),
  offset: Type.Integer({ minimum: 0 }),
  returned: Type.Integer({ minimum: 0 }),
  hasMore: Type.Boolean(),
  nextOffset: Type.Optional(Type.Integer({ minimum: 0 })),
}, { additionalProperties: false });

const ListBoardCompactOutputSchema = Type.Object({
  schemaVersion: Type.Literal(1),
  items: Type.Array(CompactItemSchema),
  total: Type.Integer({ minimum: 0 }),
  limit: Type.Integer({ minimum: 1 }),
  offset: Type.Integer({ minimum: 0 }),
  lanes: Type.Optional(Type.Array(Type.Object({
    lane: KanbanLaneSchema,
    title: Type.String(),
    count: Type.Integer({ minimum: 0 }),
    openCount: Type.Integer({ minimum: 0 }),
    closedCount: Type.Integer({ minimum: 0 }),
    pagination: Type.Optional(PageMetadataSchema),
  }, { additionalProperties: false }))),
  epics: Type.Optional(Type.Array(CompactEpicSchema)),
  counts: Type.Optional(Type.Object({ total: Type.Integer({ minimum: 0 }), open: Type.Integer({ minimum: 0 }), closed: Type.Integer({ minimum: 0 }) }, { additionalProperties: false })),
  pagination: PageMetadataSchema,
}, { additionalProperties: false });

// --- eforge:endregion compact-query-schemas ---

type GetItemInput = Static<typeof GetItemInputSchema>;
type GetEpicInput = Static<typeof GetEpicInputSchema>;
type SearchItemsInput = Static<typeof SearchItemsInputSchema>;
type ListBoardCompactInput = Static<typeof ListBoardCompactInputSchema>;

// --- eforge:region compact-query-actions ---
export const backlogQueryActions = [
  defineExtensionAction({
    id: 'get-item',
    title: 'Get compact backlog item detail',
    description: 'Read one backlog item without listing the whole board. Projection flags can omit or include the compact epic, Markdown sections, lifecycle rows, dependency/dependent summaries, and dependency id arrays on item summaries.',
    inputSchema: GetItemInputSchema,
    outputSchema: GetItemOutputSchema,
    outputProfile: CONTRIBUTION_OUTPUT_PROFILES.agentCompact,
    sideEffects: ['local-read'],
    async handler(input, ctx) {
      return toJsonSafeObject(await getItemDetail(ctx.cwd, input));
    },
  }),
  defineExtensionAction({
    id: 'get-epic',
    title: 'Get compact backlog epic detail',
    description: 'Read one backlog epic without returning board-wide payloads. Projection flags can omit or include Markdown sections, the paginated compact item list, and dependency id arrays on item summaries.',
    inputSchema: GetEpicInputSchema,
    outputSchema: GetEpicOutputSchema,
    outputProfile: CONTRIBUTION_OUTPUT_PROFILES.agentPaginated,
    sideEffects: ['local-read'],
    async handler(input, ctx) {
      return toJsonSafeObject(await getEpicDetail(ctx.cwd, input));
    },
  }),
  defineExtensionAction({
    id: 'search-items',
    title: 'Search compact backlog items',
    description: 'Search backlog items by text, epic, status, lane, or tags with bounded compact output. Projection flags can omit or include compact epic summaries and dependency id arrays on item summaries.',
    inputSchema: SearchItemsInputSchema,
    outputSchema: SearchItemsOutputSchema,
    outputProfile: CONTRIBUTION_OUTPUT_PROFILES.agentPaginated,
    sideEffects: ['local-read'],
    async handler(input, ctx) {
      return toJsonSafeObject(await searchItems(ctx.cwd, input));
    },
  }),
  defineExtensionAction({
    id: 'list-board-compact',
    title: 'List compact eforge-plan board',
    description: 'Return bounded open-first kanban item summaries without full item bodies or rich board payloads. Projection flags can omit or include compact epic summaries, lane/count aggregates, and dependency id arrays on item summaries.',
    inputSchema: ListBoardCompactInputSchema,
    outputSchema: ListBoardCompactOutputSchema,
    outputProfile: CONTRIBUTION_OUTPUT_PROFILES.agentPaginated,
    sideEffects: ['local-read'],
    async handler(input, ctx) {
      return toJsonSafeObject(await listBoardCompact(ctx.cwd, input));
    },
  }),
];
// --- eforge:endregion compact-query-actions ---

// --- eforge:region compact-query-projection ---
async function getItemDetail(cwd: string, input: GetItemInput): Promise<any> {
  // --- eforge:region plan-04-projections-lifecycle ---
  return getItemDetailProjection(cwd, input);
  // --- eforge:endregion plan-04-projections-lifecycle ---
}
async function getEpicDetail(cwd: string, input: GetEpicInput): Promise<any> {
  // --- eforge:region plan-04-projections-lifecycle ---
  return getEpicDetailProjection(cwd, input);
  // --- eforge:endregion plan-04-projections-lifecycle ---
}
async function searchItems(cwd: string, input: SearchItemsInput) {
  const [items, epics, cards] = await loadBoardCards(cwd, input.includeArchive);
  const query = input.query?.trim().toLowerCase();
  const bodyById = input.searchBody ? new Map(items.map((item) => [item.id, item.body.toLowerCase()])) : new Map<string, string>();
  const filtered = cards.all.filter((card) => {
    if (input.epic !== undefined && card.epic !== input.epic) return false;
    if (input.status !== undefined && card.status !== input.status) return false;
    if (input.lane !== undefined && card.lane !== input.lane) return false;
    if (input.tags !== undefined && !input.tags.every((tag) => card.tags.includes(tag))) return false;
    if (!query) return true;
    const haystack = [card.id, card.title, card.epic ?? '', ...card.tags, bodyById.get(card.id) ?? ''].join('\n').toLowerCase();
    return haystack.includes(query);
  });
  const page = paginate(filtered, input);
  return {
    schemaVersion: 1 as const,
    items: page.entries.map((card) => compactItem(card, { includeDependencies: input.includeDependencies !== false })),
    ...(input.includeEpics === true ? { epics: compactEpicsForCards(page.entries, epics, items) } : {}),
    total: filtered.length,
    limit: page.limit,
    offset: page.offset,
  };
}

async function listBoardCompact(cwd: string, input: ListBoardCompactInput): Promise<any> {
  // --- eforge:region plan-04-projections-lifecycle ---
  return listBoardCompactProjection(cwd, input);
  // --- eforge:endregion plan-04-projections-lifecycle ---
}
async function loadEpicProjection(cwd: string, epicId: string): Promise<[BacklogEpic | null, BacklogItem[], BacklogEpic[], { all: KanbanCard[]; byId: Map<string, KanbanCard> }]> {
  const [items, epics, cards] = await loadBoardCards(cwd, true, epicId);
  return [await readBacklogEpic(cwd, epicId), items, epics, cards];
}

async function loadBoardCards(cwd: string, includeArchive = false, epic?: string): Promise<[BacklogItem[], BacklogEpic[], { all: KanbanCard[]; byId: Map<string, KanbanCard>; lanes: Array<{ lane: KanbanLane; title: string; items: KanbanCard[] }> }]> {
  const [items, epics, traces] = await Promise.all([listBacklogItems(cwd), listBacklogEpics(cwd), listTraceSidecars(cwd)]);
  const traceSummaries = await summarizeProjectTraces(cwd, traces);
  const board = projectKanbanBoard(items, traceSummaries, { includeArchive, epic, epics });
  const visibleCards = includeArchive === false ? board.items.filter((card) => card.lane !== 'archive') : board.items;
  return [items, epics, { all: visibleCards, byId: new Map(board.items.map((card) => [card.id, card])), lanes: board.lanes }];
}

function compactItem(card: KanbanCard, options: { includeDependencies?: boolean } = {}) {
  return {
    id: card.id,
    title: card.title,
    status: card.status,
    priority: card.priority,
    tags: card.tags,
    lane: card.lane,
    reasons: card.reasons,
    ...(options.includeDependencies === false ? {} : {
      dependsOn: card.dependencies.map((dependency) => dependency.id),
      unresolvedDependsOn: card.unresolvedDependsOn,
    }),
    activeTraceReasons: card.activeTraceReasons,
    blocked: card.blocked,
    ready: card.ready,
    reviewDue: card.reviewDue,
    closed: card.closed,
    ...(card.epic ? { epic: card.epic } : {}),
    lifecycleState: card.lifecycleState,
  };
}

function compactEpicsForCards(cards: readonly KanbanCard[], epics: readonly BacklogEpic[], items: readonly BacklogItem[]) {
  const epicIds = new Set(cards.map((card) => card.epic).filter((epic): epic is string => epic !== undefined));
  return epics.filter((epic) => epicIds.has(epic.id)).map((epic) => compactEpic(epic, items));
}

function compactEpic(epic: BacklogEpic, items: readonly BacklogItem[]) {
  const epicItems = items.filter((item) => item.epic === epic.id);
  return {
    id: epic.id,
    title: epic.title,
    status: epic.status,
    ...(epic.priority ? { priority: epic.priority } : {}),
    tags: epic.tags,
    itemCount: epicItems.length,
    openItemCount: epicItems.filter((item) => !isClosedStatus(item.status)).length,
    hasBody: hasMeaningfulBody(epic.body),
  };
}

// An epic written purely as a heading (the `writeBacklogEpic` default) carries no
// authored content. Strip H1 title lines and report whether anything else remains,
// so standalone "horizon" epics with real notes can be told apart from empty shells.
function hasMeaningfulBody(body: string): boolean {
  return body
    .split(/\r?\n/)
    .filter((line) => !/^#\s+/.test(line))
    .join('\n')
    .trim().length > 0;
}

function cardForRequiredItem(id: string, items: readonly BacklogItem[], epics: readonly BacklogEpic[]): KanbanCard {
  const item = items.find((candidate) => candidate.id === id);
  if (!item) throw new Error(`Backlog item "${id}" was not found.`);
  return cardForItem(item, items, epics);
}

function cardForItem(item: BacklogItem, items: readonly BacklogItem[], epics: readonly BacklogEpic[]): KanbanCard {
  return projectKanbanBoard(items, [], { includeArchive: true, epics }).items.find((card) => card.id === item.id)!;
}

function paginate<T>(entries: readonly T[], input: { limit?: number; offset?: number }): { entries: T[]; limit: number; offset: number } {
  const page = paginateContributionItems(entries, input, { defaultLimit: 20, maxLimit: 100 });
  return { entries: page.items, limit: page.limit, offset: page.offset };
}

function pageMetadata(page: { entries: readonly unknown[]; limit: number; offset: number }, total: number) {
  const nextOffset = page.offset + page.entries.length;
  return {
    limit: page.limit,
    offset: page.offset,
    returned: page.entries.length,
    hasMore: nextOffset < total,
    ...(nextOffset < total ? { nextOffset } : {}),
  };
}

function laneSummary(lane: { lane: KanbanLane; title: string; items: KanbanCard[] }, page: { entries: KanbanCard[]; limit: number; offset: number }, selectedLane: KanbanLane | undefined, selectedLaneFilteredTotal: number | undefined) {
  const count = lane.items.length;
  return {
    lane: lane.lane,
    title: lane.title,
    count,
    openCount: lane.items.filter((item) => !item.closed).length,
    closedCount: lane.items.filter((item) => item.closed).length,
    ...(selectedLane === lane.lane ? { pagination: pageMetadata(page, selectedLaneFilteredTotal ?? count) } : {}),
  };
}
// --- eforge:endregion compact-query-projection ---
