import {
  CONTRIBUTION_OUTPUT_PROFILES,
  createContributionPaginationInputFields,
  defineExtensionAction,
  Type,
  type Static,
} from '@eforge-build/extension-sdk';
// --- eforge:region plan-04-projections-lifecycle ---
import { getEpicDetailProjection, getItemDetailProjection, listBoardCompactProjection } from './projections/index.js';
// --- eforge:endregion plan-04-projections-lifecycle ---
import { toJsonSafeObject } from './json-safe.js';
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
async function listBoardCompact(cwd: string, input: ListBoardCompactInput): Promise<any> {
  // --- eforge:region plan-04-projections-lifecycle ---
  return listBoardCompactProjection(cwd, input);
  // --- eforge:endregion plan-04-projections-lifecycle ---
}
// --- eforge:endregion compact-query-projection ---
