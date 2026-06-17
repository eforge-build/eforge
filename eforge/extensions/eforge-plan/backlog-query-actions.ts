import {
  CONTRIBUTION_OUTPUT_PROFILES,
  createContributionPaginationInputFields,
  defineExtensionAction,
  paginateContributionItems,
  Type,
  type Static,
} from '@eforge-build/extension-sdk';
import { extractMarkdownSections, isClosedStatus, type BacklogEpic, type BacklogItem, type KanbanLane } from './backlog-domain.js';
import { projectKanbanBoard, type KanbanCard } from './kanban.js';
import {
  listBacklogEpics,
  listBacklogItems,
  readBacklogEpic,
  resolveBacklogEpicRelativePath,
  resolveBacklogItemRelativePath,
} from './markdown-store.js';
import { toJsonSafeObject } from './json-safe.js';
import { listTraceSidecars, summarizeTrace } from './trace-store.js';
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
  dependsOn: Type.Array(Type.String()),
  unresolvedDependsOn: Type.Array(Type.String()),
  activeTraceReasons: Type.Array(Type.String()),
  blocked: Type.Boolean(),
  ready: Type.Boolean(),
  reviewDue: Type.Boolean(),
  closed: Type.Boolean(),
  epic: Type.Optional(Type.String()),
  lifecycleState: LifecycleStateSchema,
}, { additionalProperties: false });

const CompactLifecycleLinkRowSchema = Type.Object({}, { additionalProperties: Type.Unknown() });

const CompactEpicSchema = Type.Object({
  id: Type.String(),
  title: Type.String(),
  status: BacklogStatusSchema,
  priority: Type.Optional(Type.String()),
  tags: Type.Array(Type.String()),
  itemCount: Type.Integer({ minimum: 0 }),
  openItemCount: Type.Integer({ minimum: 0 }),
  hasBody: Type.Boolean(),
}, { additionalProperties: false });

const PageInputFields = createContributionPaginationInputFields({ maxLimit: 100 });

const GetItemInputSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  includeBody: Type.Optional(Type.Boolean()),
}, { additionalProperties: false });

const GetItemOutputSchema = Type.Object({
  schemaVersion: Type.Literal(1),
  item: Type.Object({
    ...CompactItemSchema.properties,
    path: Type.String(),
    sections: Type.Record(Type.String(), Type.String()),
    linkRows: Type.Array(CompactLifecycleLinkRowSchema),
    failureEvidence: Type.Array(CompactLifecycleLinkRowSchema),
    body: Type.Optional(Type.String()),
  }, { additionalProperties: false }),
  epic: Type.Optional(CompactEpicSchema),
  dependencies: Type.Array(CompactItemSchema),
  dependents: Type.Array(CompactItemSchema),
}, { additionalProperties: false });

const GetEpicInputSchema = Type.Object({
  id: Type.String({ minLength: 1 }),
  includeBody: Type.Optional(Type.Boolean()),
  includeItems: Type.Optional(Type.Boolean()),
  ...PageInputFields,
}, { additionalProperties: false });

const GetEpicOutputSchema = Type.Object({
  schemaVersion: Type.Literal(1),
  epic: Type.Object({
    ...CompactEpicSchema.properties,
    path: Type.String(),
    sections: Type.Record(Type.String(), Type.String()),
    body: Type.Optional(Type.String()),
  }, { additionalProperties: false }),
  items: Type.Array(CompactItemSchema),
  totalItems: Type.Integer({ minimum: 0 }),
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
  ...PageInputFields,
}, { additionalProperties: false });

const SearchItemsOutputSchema = Type.Object({
  schemaVersion: Type.Literal(1),
  items: Type.Array(CompactItemSchema),
  total: Type.Integer({ minimum: 0 }),
  limit: Type.Integer({ minimum: 1 }),
  offset: Type.Integer({ minimum: 0 }),
}, { additionalProperties: false });

const ListBoardCompactInputSchema = Type.Object({
  epic: Type.Optional(Type.String()),
  lane: Type.Optional(KanbanLaneSchema),
  includeClosed: Type.Optional(Type.Boolean()),
  includeArchive: Type.Optional(Type.Boolean()),
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
  lanes: Type.Array(Type.Object({
    lane: KanbanLaneSchema,
    title: Type.String(),
    count: Type.Integer({ minimum: 0 }),
    openCount: Type.Integer({ minimum: 0 }),
    closedCount: Type.Integer({ minimum: 0 }),
    pagination: Type.Optional(PageMetadataSchema),
  }, { additionalProperties: false })),
  epics: Type.Array(CompactEpicSchema),
  counts: Type.Object({ total: Type.Integer({ minimum: 0 }), open: Type.Integer({ minimum: 0 }), closed: Type.Integer({ minimum: 0 }) }, { additionalProperties: false }),
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
    description: 'Read one backlog item with compact dependency/dependent summaries, lifecycle rows, and Markdown sections without listing the whole board.',
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
    description: 'Read one backlog epic and a paginated compact item list without returning board-wide payloads.',
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
    description: 'Search backlog items by text, epic, status, lane, or tags with bounded compact output for agent contexts.',
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
    description: 'Return bounded open-first kanban item summaries with lane counts, total/open/closed counts, pagination metadata, and epic counts without full item bodies or rich board payloads.',
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
async function getItemDetail(cwd: string, input: GetItemInput) {
  const [items, epics, cards] = await loadBoardCards(cwd, true);
  const selected = items.find((candidate) => candidate.id === input.id);
  if (!selected) throw new Error(`Backlog item "${input.id}" was not found.`);
  const card = cards.byId.get(selected.id) ?? cardForItem(selected, items, epics);
  const epic = selected.epic ? epics.find((candidate) => candidate.id === selected.epic) : undefined;
  return {
    schemaVersion: 1 as const,
    item: {
      ...compactItem(card),
      path: resolveBacklogItemRelativePath(cwd, selected.id),
      sections: Object.fromEntries(extractMarkdownSections(selected.body)),
      linkRows: card.linkRows,
      failureEvidence: card.failureEvidence,
      ...(input.includeBody ? { body: selected.body } : {}),
    },
    ...(epic ? { epic: compactEpic(epic, items) } : {}),
    dependencies: card.dependencies.filter((dependency) => !dependency.missing).map((dependency) => compactItem(cards.byId.get(dependency.id) ?? cardForRequiredItem(dependency.id, items, epics))),
    dependents: card.dependents.filter((dependent) => !dependent.missing).map((dependent) => compactItem(cards.byId.get(dependent.id) ?? cardForRequiredItem(dependent.id, items, epics))),
  };
}

async function getEpicDetail(cwd: string, input: GetEpicInput) {
  const [epic, items, epics, cards] = await loadEpicProjection(cwd, input.id);
  if (!epic) throw new Error(`Backlog epic "${input.id}" was not found.`);
  const allEpicItems = input.includeItems === false ? [] : cards.all.filter((card) => card.epic === epic.id);
  const page = paginate(allEpicItems, input);
  return {
    schemaVersion: 1 as const,
    epic: {
      ...compactEpic(epic, items),
      path: resolveBacklogEpicRelativePath(cwd, epic.id),
      sections: Object.fromEntries(extractMarkdownSections(epic.body)),
      ...(input.includeBody ? { body: epic.body } : {}),
    },
    items: page.entries.map(compactItem),
    totalItems: allEpicItems.length,
    limit: page.limit,
    offset: page.offset,
  };
}

async function searchItems(cwd: string, input: SearchItemsInput) {
  const [items, , cards] = await loadBoardCards(cwd, input.includeArchive);
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
  return { schemaVersion: 1 as const, items: page.entries.map(compactItem), total: filtered.length, limit: page.limit, offset: page.offset };
}

async function listBoardCompact(cwd: string, input: ListBoardCompactInput) {
  const [items, epics, cards] = await loadBoardCards(cwd, input.includeArchive === true, input.epic);
  const scopedCards = cards.all;
  const scopedIds = new Set(scopedCards.map((card) => card.id));
  const scopedLanes = cards.lanes.map((lane) => ({ ...lane, items: lane.items.filter((card) => scopedIds.has(card.id)) }));
  const filtered = scopedCards.filter((card) => {
    if (input.lane !== undefined && card.lane !== input.lane) return false;
    if (!input.includeClosed && card.closed) return false;
    return true;
  });
  const selectedLaneFilteredTotal = input.lane === undefined ? undefined : filtered.length;
  const page = paginate(filtered, input);
  const pagination = pageMetadata(page, filtered.length);
  return {
    schemaVersion: 1 as const,
    items: page.entries.map(compactItem),
    total: filtered.length,
    limit: page.limit,
    offset: page.offset,
    lanes: scopedLanes.map((lane) => laneSummary(lane, page, input.lane, selectedLaneFilteredTotal)),
    epics: epics.filter((epic) => input.epic === undefined || epic.id === input.epic).map((epic) => compactEpic(epic, items)),
    counts: {
      total: scopedCards.length,
      open: scopedCards.filter((card) => !card.closed).length,
      closed: scopedCards.filter((card) => card.closed).length,
    },
    pagination,
  };
}

async function loadEpicProjection(cwd: string, epicId: string): Promise<[BacklogEpic | null, BacklogItem[], BacklogEpic[], { all: KanbanCard[]; byId: Map<string, KanbanCard> }]> {
  const [items, epics, cards] = await loadBoardCards(cwd, true, epicId);
  return [await readBacklogEpic(cwd, epicId), items, epics, cards];
}

async function loadBoardCards(cwd: string, includeArchive = false, epic?: string): Promise<[BacklogItem[], BacklogEpic[], { all: KanbanCard[]; byId: Map<string, KanbanCard>; lanes: Array<{ lane: KanbanLane; title: string; items: KanbanCard[] }> }]> {
  const [items, epics, traces] = await Promise.all([listBacklogItems(cwd), listBacklogEpics(cwd), listTraceSidecars(cwd)]);
  const traceSummaries = traces.flatMap((trace) => summarizeTrace(trace) ?? []);
  const board = projectKanbanBoard(items, traceSummaries, { includeArchive, epic, epics });
  const visibleCards = includeArchive === false ? board.items.filter((card) => card.lane !== 'archive') : board.items;
  return [items, epics, { all: visibleCards, byId: new Map(board.items.map((card) => [card.id, card])), lanes: board.lanes }];
}

function compactItem(card: KanbanCard) {
  return {
    id: card.id,
    title: card.title,
    status: card.status,
    priority: card.priority,
    tags: card.tags,
    lane: card.lane,
    reasons: card.reasons,
    dependsOn: card.dependencies.map((dependency) => dependency.id),
    unresolvedDependsOn: card.unresolvedDependsOn,
    activeTraceReasons: card.activeTraceReasons,
    blocked: card.blocked,
    ready: card.ready,
    reviewDue: card.reviewDue,
    closed: card.closed,
    ...(card.epic ? { epic: card.epic } : {}),
    lifecycleState: card.lifecycleState,
  };
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
