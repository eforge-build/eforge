import { Type, type Static } from '../../../packages/extension-sdk/src/index.js';

// --- eforge:region backlog-schemas ---
export const BACKLOG_STATUSES = ['candidate', 'planned', 'active', 'shipped', 'stale', 'superseded'] as const;
export const KANBAN_LANES = ['inbox', 'ready', 'blocked', 'in-progress', 'done', 'archive'] as const;
export const PLANNING_TYPES = ['bugfix', 'feature', 'refactor', 'architecture', 'docs', 'maintenance', 'unknown'] as const;
export const PLANNING_DEPTHS = ['quick', 'focused', 'deep'] as const;
export const PLANNING_PROFILES = ['errand', 'excursion', 'expedition'] as const;

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
// --- eforge:endregion backlog-schemas ---

// --- eforge:region json-schemas ---
export const JsonValueSchema = Type.Recursive((Self) => Type.Union([
  Type.Null(),
  Type.Boolean(),
  Type.Number(),
  Type.String(),
  Type.Array(Self),
  Type.Record(Type.String(), Self),
]));

export const ActionObjectOutputSchema = Type.Object({}, { additionalProperties: JsonValueSchema });

export const MarkdownOutputSchema = Type.Object({ markdown: Type.String() });

// --- eforge:endregion json-schemas ---

// --- eforge:region plan-01-recommendations ---
export const PlanningProfileSchema = Type.Union([
  Type.Literal('errand'),
  Type.Literal('excursion'),
  Type.Literal('expedition'),
]);

export const RecommendationItemRefSchema = Type.Object({
  ref: Type.Optional(Type.String()),
  itemId: Type.String(),
  rationale: Type.Optional(Type.String()),
  confidence: Type.Optional(Type.String()),
}, { additionalProperties: false });

export const RecommendationProfileSchema = PlanningProfileSchema;

export const RecommendationGroupSchema = Type.Object({
  ref: Type.String(),
  title: Type.Optional(Type.String()),
  itemIds: Type.Array(Type.String()),
  epicIds: Type.Optional(Type.Array(Type.String())),
  safeToPlanTogether: Type.Optional(Type.Boolean()),
  rationale: Type.Optional(Type.String()),
  recommendedProfile: Type.Optional(RecommendationProfileSchema),
}, { additionalProperties: false });

export const RecommendationBlockedChainSchema = Type.Object({
  ref: Type.Optional(Type.String()),
  itemIds: Type.Array(Type.String()),
  blockedBy: Type.Array(Type.String()),
  rationale: Type.Optional(Type.String()),
}, { additionalProperties: false });

export const BacklogRecommendationModelSchema = Type.Object({
  schemaVersion: Type.Literal(1),
  updatedAt: Type.Optional(Type.String()),
  activeWork: Type.Array(RecommendationItemRefSchema),
  readyCandidates: Type.Array(RecommendationItemRefSchema),
  recommendedNextSequence: Type.Array(RecommendationItemRefSchema),
  safeParallelizableGroups: Type.Array(RecommendationGroupSchema),
  blockedChains: Type.Array(RecommendationBlockedChainSchema),
  rationaleAndAssumptions: Type.Array(Type.String()),
}, { additionalProperties: false });

export const RecommendationSummarySchema = Type.Object({
  recommendedNextItemIds: Type.Array(Type.String()),
  safeParallelizableGroups: Type.Array(RecommendationGroupSchema),
  blockedChainCount: Type.Number(),
  rationaleAndAssumptions: Type.Array(Type.String()),
}, { additionalProperties: false });

export const GetRecommendationsInputSchema = Type.Object({});
export const GetRecommendationsOutputSchema = Type.Object({
  recommendations: Type.Union([BacklogRecommendationModelSchema, Type.Null()]),
  recommendationSummary: Type.Optional(RecommendationSummarySchema),
  path: Type.String(),
});
export const PutRecommendationsInputSchema = BacklogRecommendationModelSchema;
export const PutRecommendationsOutputSchema = Type.Object({
  recommendations: BacklogRecommendationModelSchema,
  recommendationSummary: RecommendationSummarySchema,
  path: Type.String(),
});
// --- eforge:endregion plan-01-recommendations ---

// --- eforge:region board-schemas ---
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
    prUrl: Type.Optional(Type.String()),
  }),
  Type.Object({
    featureBranch: Type.Optional(Type.String()),
    commitSha: Type.String(),
    status: Type.String(),
    landedAt: Type.Optional(Type.String()),
    prUrl: Type.Optional(Type.String()),
  }),
]);

export const TraceLastEventMetadataSchema = Type.Object({
  type: Type.Optional(Type.String()),
  timestamp: Type.Optional(Type.String()),
  sessionId: Type.Optional(Type.String()),
  runId: Type.Optional(Type.String()),
  source: Type.Optional(Type.String()),
  filePath: Type.Optional(Type.String()),
  path: Type.Optional(Type.String()),
  id: Type.Optional(Type.String()),
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

export const ListBoardOutputSchema = Type.Object({
  epics: Type.Array(Type.Unknown()),
  items: Type.Array(Type.Unknown()),
  lanes: Type.Array(Type.Unknown()),
  blockedReasons: Type.Array(Type.Object({ itemId: Type.String(), reasons: Type.Array(Type.String()) })),
  traceSummaries: Type.Array(Type.Unknown()),
  // --- eforge:region plan-01-recommendations ---
  recommendationSummary: Type.Optional(RecommendationSummarySchema),
  // --- eforge:endregion plan-01-recommendations ---
});
// --- eforge:endregion board-schemas ---

// --- eforge:region session-plan-schemas ---
export const PlanningTypeSchema = Type.Union([
  Type.Literal('bugfix'),
  Type.Literal('feature'),
  Type.Literal('refactor'),
  Type.Literal('architecture'),
  Type.Literal('docs'),
  Type.Literal('maintenance'),
  Type.Literal('unknown'),
]);

export const PlanningDepthSchema = Type.Union([
  Type.Literal('quick'),
  Type.Literal('focused'),
  Type.Literal('deep'),
]);

const JsonObjectAdditionalProperties = { additionalProperties: JsonValueSchema } as const;

export const SessionPlanReadinessDetailSchema = Type.Object({
  ready: Type.Boolean(),
  missingDimensions: Type.Array(Type.String()),
  coveredDimensions: Type.Array(Type.String()),
  skippedDimensions: Type.Array(Type.String()),
  acDiagnostics: Type.Optional(Type.Array(Type.Record(Type.String(), JsonValueSchema))),
}, JsonObjectAdditionalProperties);

export const SessionPlanProjectionSchema = Type.Object({
  session: Type.String(),
  topic: Type.String(),
  status: Type.String(),
  body: Type.String(),
}, JsonObjectAdditionalProperties);

export const SessionPlanDetailOutputSchema = Type.Object({
  plan: SessionPlanProjectionSchema,
  readiness: SessionPlanReadinessDetailSchema,
  path: Type.String(),
}, JsonObjectAdditionalProperties);

export const PlanningArtifactSchema = Type.Object({
  kind: Type.Union([Type.Literal('plan'), Type.Literal('plan-set')]),
  key: Type.String(),
}, JsonObjectAdditionalProperties);

export const ListPlanningArtifactsInputSchema = Type.Object({
  includeSubmitted: Type.Optional(Type.Boolean()),
  includeArchive: Type.Optional(Type.Boolean()),
  epic: Type.Optional(Type.String()),
});
export const ListPlanningArtifactsOutputSchema = Type.Object({
  artifacts: Type.Array(PlanningArtifactSchema),
  plans: Type.Array(PlanningArtifactSchema),
  planSets: Type.Array(PlanningArtifactSchema),
  board: Type.Optional(JsonValueSchema),
}, JsonObjectAdditionalProperties);

export const ShowSessionPlanInputSchema = Type.Object({ session: Type.String() });
export const ShowSessionPlanOutputSchema = SessionPlanDetailOutputSchema;

export const ShowSessionPlanSetInputSchema = Type.Object({ planSetId: Type.String() });
export const ShowSessionPlanSetOutputSchema = Type.Object({
  planSet: Type.Record(Type.String(), JsonValueSchema),
  validation: Type.Record(Type.String(), JsonValueSchema),
  dir: Type.String(),
  manifestPath: Type.String(),
  anchorContent: Type.Optional(Type.String()),
}, JsonObjectAdditionalProperties);

export const CreateSessionPlanInputSchema = Type.Object({
  session: Type.String(),
  topic: Type.String(),
  planningType: Type.Optional(PlanningTypeSchema),
  planningDepth: Type.Optional(PlanningDepthSchema),
  profile: Type.Optional(Type.Union([PlanningProfileSchema, Type.Null()])),
  agentProfile: Type.Optional(Type.String()),
});
export const CreateSessionPlanOutputSchema = Type.Object({
  session: Type.String(),
  path: Type.String(),
  plan: SessionPlanProjectionSchema,
  readiness: SessionPlanReadinessDetailSchema,
}, JsonObjectAdditionalProperties);

export const SetSessionPlanSectionInputSchema = Type.Object({
  session: Type.String(),
  dimension: Type.String(),
  content: Type.String(),
});
export const SetSessionPlanSectionOutputSchema = Type.Object({
  session: Type.String(),
  path: Type.String(),
  readiness: SessionPlanReadinessDetailSchema,
  plan: SessionPlanProjectionSchema,
}, JsonObjectAdditionalProperties);

export const SelectSessionPlanDimensionsInputSchema = Type.Object({
  session: Type.String(),
  planningType: Type.Optional(PlanningTypeSchema),
  planningDepth: Type.Optional(PlanningDepthSchema),
  overwrite: Type.Optional(Type.Boolean()),
});
export const SelectSessionPlanDimensionsOutputSchema = Type.Object({
  session: Type.String(),
  path: Type.String(),
  required_dimensions: Type.Array(Type.String()),
  optional_dimensions: Type.Array(Type.String()),
  readiness: SessionPlanReadinessDetailSchema,
  plan: SessionPlanProjectionSchema,
}, JsonObjectAdditionalProperties);

export const CheckSessionPlanReadinessInputSchema = Type.Object({ session: Type.String() });
export const CheckSessionPlanReadinessOutputSchema = Type.Object({
  session: Type.String(),
  readiness: SessionPlanReadinessDetailSchema,
}, JsonObjectAdditionalProperties);

export const SetSessionPlanReadyInputSchema = Type.Object({ session: Type.String() });
export const SetSessionPlanReadyOutputSchema = Type.Union([
  Type.Object({
    kind: Type.Literal('not-ready'),
    session: Type.String(),
    readiness: SessionPlanReadinessDetailSchema,
    message: Type.String(),
  }, JsonObjectAdditionalProperties),
  Type.Object({
    kind: Type.Literal('ready'),
    session: Type.String(),
    status: Type.String(),
    readiness: SessionPlanReadinessDetailSchema,
    plan: SessionPlanProjectionSchema,
  }, JsonObjectAdditionalProperties),
]);

export const UpdateSessionPlanMetadataInputSchema = Type.Object({
  session: Type.String(),
  profile: Type.Optional(Type.Union([PlanningProfileSchema, Type.Null()])),
  agentProfile: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  openQuestions: Type.Optional(Type.Array(Type.String())),
});
export const UpdateSessionPlanMetadataOutputSchema = SessionPlanDetailOutputSchema;

export const HandoffSessionPlanInputSchema = Type.Object({ session: Type.String() });
export const HandoffSessionPlanOutputSchema = Type.Union([
  Type.Object({
    kind: Type.Literal('not-ready'),
    session: Type.String(),
    readiness: SessionPlanReadinessDetailSchema,
    message: Type.String(),
  }, JsonObjectAdditionalProperties),
  Type.Object({
    kind: Type.Literal('source-path'),
    session: Type.String(),
    sourcePath: Type.String(),
    absolutePath: Type.String(),
    command: Type.String(),
    readiness: SessionPlanReadinessDetailSchema,
  }, JsonObjectAdditionalProperties),
]);
// --- eforge:endregion session-plan-schemas ---

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
export type ListBoardOutput = Static<typeof ListBoardOutputSchema>;
// --- eforge:region plan-01-recommendations ---
export type RecommendationItemRef = Static<typeof RecommendationItemRefSchema>;
export type RecommendationGroup = Static<typeof RecommendationGroupSchema>;
export type RecommendationBlockedChain = Static<typeof RecommendationBlockedChainSchema>;
export type BacklogRecommendationModel = Static<typeof BacklogRecommendationModelSchema>;
export type RecommendationSummary = Static<typeof RecommendationSummarySchema>;
export type GetRecommendationsInput = Static<typeof GetRecommendationsInputSchema>;
export type GetRecommendationsOutput = Static<typeof GetRecommendationsOutputSchema>;
export type PutRecommendationsInput = Static<typeof PutRecommendationsInputSchema>;
export type PutRecommendationsOutput = Static<typeof PutRecommendationsOutputSchema>;
// --- eforge:endregion plan-01-recommendations ---
export type PlanningTypeInput = Static<typeof PlanningTypeSchema>;
export type PlanningDepthInput = Static<typeof PlanningDepthSchema>;
export type PlanningProfileInput = Static<typeof PlanningProfileSchema>;
export type ListPlanningArtifactsInput = Static<typeof ListPlanningArtifactsInputSchema>;
export type ShowSessionPlanInput = Static<typeof ShowSessionPlanInputSchema>;
export type ShowSessionPlanSetInput = Static<typeof ShowSessionPlanSetInputSchema>;
export type CreateSessionPlanInput = Static<typeof CreateSessionPlanInputSchema>;
export type SetSessionPlanSectionInput = Static<typeof SetSessionPlanSectionInputSchema>;
export type SelectSessionPlanDimensionsInput = Static<typeof SelectSessionPlanDimensionsInputSchema>;
export type CheckSessionPlanReadinessInput = Static<typeof CheckSessionPlanReadinessInputSchema>;
export type SetSessionPlanReadyInput = Static<typeof SetSessionPlanReadyInputSchema>;
export type UpdateSessionPlanMetadataInput = Static<typeof UpdateSessionPlanMetadataInputSchema>;
export type HandoffSessionPlanInput = Static<typeof HandoffSessionPlanInputSchema>;
