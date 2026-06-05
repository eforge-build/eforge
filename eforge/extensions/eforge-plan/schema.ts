import { Type, type Static } from '../../../packages/extension-sdk/src/index.js';

export const BACKLOG_STATUSES = ['candidate', 'planned', 'active', 'shipped', 'stale', 'superseded'] as const;
export const KANBAN_LANES = ['inbox', 'ready', 'blocked', 'in-progress', 'done', 'archive'] as const;

export type BacklogStatus = (typeof BACKLOG_STATUSES)[number];
export type KanbanLane = (typeof KANBAN_LANES)[number];

export const BacklogStatusSchema = Type.Union([
  Type.Literal('candidate'),
  Type.Literal('planned'),
  Type.Literal('active'),
  Type.Literal('shipped'),
  Type.Literal('stale'),
  Type.Literal('superseded'),
]);

export const KanbanLaneSchema = Type.Union([
  Type.Literal('inbox'),
  Type.Literal('ready'),
  Type.Literal('blocked'),
  Type.Literal('in-progress'),
  Type.Literal('done'),
  Type.Literal('archive'),
]);

export const BacklogItemFrontmatterSchema = Type.Object({
  id: Type.String(),
  status: BacklogStatusSchema,
  priority: Type.Optional(Type.String()),
  source: Type.Optional(Type.String()),
  created: Type.Optional(Type.String()),
  updated: Type.Optional(Type.String()),
  last_checked: Type.Optional(Type.String()),
  stale_after: Type.Optional(Type.String()),
  tags: Type.Optional(Type.Array(Type.String())),
  depends_on: Type.Optional(Type.Array(Type.String())),
  epic: Type.Optional(Type.String()),
  eforge_plan: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
});

export const BacklogEpicFrontmatterSchema = Type.Object({
  id: Type.String(),
  status: BacklogStatusSchema,
  priority: Type.Optional(Type.String()),
  source: Type.Optional(Type.String()),
  created: Type.Optional(Type.String()),
  updated: Type.Optional(Type.String()),
  last_checked: Type.Optional(Type.String()),
  stale_after: Type.Optional(Type.String()),
  tags: Type.Optional(Type.Array(Type.String())),
  eforge_plan: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
});

export const BoardActionInputSchema = Type.Object({
  epic: Type.Optional(Type.String()),
  includeArchive: Type.Optional(Type.Boolean()),
});

export const ItemActionInputSchema = Type.Object({
  id: Type.String(),
});

export const TraceActionInputSchema = Type.Object({
  itemId: Type.String(),
});

export const TracePromotedSessionPlanSchema = Type.Object({
  session: Type.String(),
  path: Type.Optional(Type.String()),
  status: Type.Optional(Type.String()),
  promotedAt: Type.Optional(Type.String()),
});

export const TraceQueuePrdSchema = Type.Object({
  prdId: Type.String(),
  path: Type.Optional(Type.String()),
  status: Type.Optional(Type.String()),
  queuedAt: Type.Optional(Type.String()),
});

export const TraceBuildRunSchema = Type.Object({
  runId: Type.String(),
  sessionId: Type.String(),
  status: Type.Optional(Type.String()),
  startedAt: Type.Optional(Type.String()),
  completedAt: Type.Optional(Type.String()),
});

export const TraceBuildSessionSchema = Type.Object({
  sessionId: Type.String(),
  runId: Type.Optional(Type.String()),
  status: Type.Optional(Type.String()),
  startedAt: Type.Optional(Type.String()),
  completedAt: Type.Optional(Type.String()),
});

export const TraceLandingResultSchema = Type.Union([
  Type.Object({
    featureBranch: Type.String(),
    commitSha: Type.Optional(Type.String()),
    status: Type.String(),
    landedAt: Type.Optional(Type.String()),
  }),
  Type.Object({
    featureBranch: Type.Optional(Type.String()),
    commitSha: Type.String(),
    status: Type.String(),
    landedAt: Type.Optional(Type.String()),
  }),
]);

export const TraceLastEventMetadataSchema = Type.Object({
  type: Type.Optional(Type.String()),
  timestamp: Type.Optional(Type.String()),
  sessionId: Type.Optional(Type.String()),
  runId: Type.Optional(Type.String()),
  cursor: Type.Optional(Type.Number()),
});

export const TraceSidecarSchema = Type.Object({
  schemaVersion: Type.Literal(1),
  itemId: Type.String(),
  epicId: Type.Optional(Type.String()),
  promotedSessionPlans: Type.Array(TracePromotedSessionPlanSchema),
  queuePrds: Type.Array(TraceQueuePrdSchema),
  buildRuns: Type.Array(TraceBuildRunSchema),
  buildRunIds: Type.Array(Type.String()),
  buildSessions: Type.Array(TraceBuildSessionSchema),
  buildSessionIds: Type.Array(Type.String()),
  landingResults: Type.Array(TraceLandingResultSchema),
  lastEvent: Type.Optional(TraceLastEventMetadataSchema),
});

export const KanbanCardSchema = Type.Object({
  id: Type.String(),
  title: Type.String(),
  status: BacklogStatusSchema,
  lane: KanbanLaneSchema,
  reasons: Type.Array(Type.String()),
  unresolvedDependsOn: Type.Array(Type.String()),
  activeTraceReasons: Type.Array(Type.String()),
  epic: Type.Optional(Type.String()),
});

export const KanbanLaneOutputSchema = Type.Object({
  lane: KanbanLaneSchema,
  title: Type.String(),
  items: Type.Array(KanbanCardSchema),
});

export const KanbanBoardOutputSchema = Type.Object({
  lanes: Type.Array(KanbanLaneOutputSchema),
  items: Type.Array(KanbanCardSchema),
});

export type BoardActionInput = Static<typeof BoardActionInputSchema>;
export type ItemActionInput = Static<typeof ItemActionInputSchema>;
export type TraceActionInput = Static<typeof TraceActionInputSchema>;
export type TracePromotedSessionPlan = Static<typeof TracePromotedSessionPlanSchema>;
export type TraceQueuePrd = Static<typeof TraceQueuePrdSchema>;
export type TraceBuildRun = Static<typeof TraceBuildRunSchema>;
export type TraceBuildSession = Static<typeof TraceBuildSessionSchema>;
export type TraceLandingResult = Static<typeof TraceLandingResultSchema>;
export type TraceLastEventMetadata = Static<typeof TraceLastEventMetadataSchema>;
export type TraceSidecar = Static<typeof TraceSidecarSchema>;
export type KanbanBoardOutput = Static<typeof KanbanBoardOutputSchema>;
