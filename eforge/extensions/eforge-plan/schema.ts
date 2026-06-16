import { ExtensionAgentTaskRecordSchema } from '@eforge-build/client';
import { Type, type Static } from '@eforge-build/extension-sdk';

// --- eforge:region backlog-schemas ---
export const BACKLOG_STATUSES = ['candidate', 'planned', 'active', 'shipped', 'stale', 'superseded'] as const;
export const KANBAN_LANES = ['inbox', 'ready', 'blocked', 'in-progress', 'done', 'archive'] as const;
export const PLANNING_TYPES = ['bugfix', 'feature', 'refactor', 'architecture', 'docs', 'maintenance', 'unknown'] as const;
export const PLANNING_DEPTHS = ['quick', 'focused', 'deep'] as const;
export const PLANNING_PROFILES = ['errand', 'excursion', 'expedition'] as const;
export type BacklogStatus = (typeof BACKLOG_STATUSES)[number];
export type KanbanLane = (typeof KANBAN_LANES)[number];
export const BacklogIdInputSchema = Type.String({ minLength: 1, pattern: '^(?!\\.\\.?$)(?!.*[\\\\/\\u0000]).+$' });
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
// --- eforge:region recommendations ---
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
  itemIds: Type.Array(Type.String(), { minItems: 1 }),
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
export const RecommendationStaleReasonSchema = Type.Object({
  eventType: Type.Optional(Type.String()),
  itemIds: Type.Optional(Type.Array(Type.String())),
  correlationKind: Type.Optional(Type.Union([Type.Literal('single'), Type.Literal('multi'), Type.Literal('bootstrapped')])),
  timestamp: Type.Optional(Type.String()),
  summary: Type.Optional(Type.String()),
  code: Type.Optional(Type.String()),
  message: Type.Optional(Type.String()),
  refs: Type.Optional(Type.Array(Type.String())),
  sourceFingerprint: Type.Optional(Type.String()),
  lastAppliedSourceFingerprint: Type.Optional(Type.String()),
}, { additionalProperties: false });
export const RecommendationStatusSidecarSchema = Type.Object({
  schemaVersion: Type.Literal(1),
  lastAppliedAt: Type.Optional(Type.String()),
  freshAt: Type.Optional(Type.String()),
  staleSince: Type.Optional(Type.String()),
  lastRefreshedBy: Type.Optional(Type.String()),
  lastAppliedSourceFingerprint: Type.Optional(Type.String()),
  sourceFingerprint: Type.Optional(Type.String()),
  reasons: Type.Optional(Type.Array(RecommendationStaleReasonSchema)),
  staleReasons: Type.Optional(Type.Array(RecommendationStaleReasonSchema)),
}, { additionalProperties: false });
export const RecommendationDerivedStatusSchema = Type.Object({
  state: Type.Union([Type.Literal('missing'), Type.Literal('fresh'), Type.Literal('stale')]),
  currentPath: Type.String(),
  statusPath: Type.String(),
  freshAt: Type.Optional(Type.String()),
  staleSince: Type.Optional(Type.String()),
  lastRefreshedBy: Type.Optional(Type.String()),
  sourceFingerprint: Type.Optional(Type.String()),
  lastAppliedSourceFingerprint: Type.Optional(Type.String()),
  reasons: Type.Array(RecommendationStaleReasonSchema),
  staleReasons: Type.Array(RecommendationStaleReasonSchema),
}, { additionalProperties: false });
export const GetRecommendationsInputSchema = Type.Object({});
export const GetRecommendationsOutputSchema = Type.Object({
  recommendations: Type.Union([BacklogRecommendationModelSchema, Type.Null()]),
  recommendationSummary: Type.Optional(RecommendationSummarySchema),
  path: Type.String(),
  status: RecommendationDerivedStatusSchema,
  activeRefreshTask: Type.Optional(ExtensionAgentTaskRecordSchema),
}, { additionalProperties: false });
export const PutRecommendationsInputSchema = BacklogRecommendationModelSchema;
export const PutRecommendationsOutputSchema = Type.Object({
  recommendations: BacklogRecommendationModelSchema, recommendationSummary: RecommendationSummarySchema,
  path: Type.String(), status: RecommendationDerivedStatusSchema,
});
// --- eforge:endregion recommendations ---
// --- eforge:region promotion-selection ---
export const PromotionSelectionSourceItemSchema = Type.Object({
  id: Type.String(),
  title: Type.String(),
  status: BacklogStatusSchema,
  epic: Type.Optional(Type.String()),
  dependsOn: Type.Array(Type.String()),
}, { additionalProperties: false });
export const PromotionSelectionSourceEpicSchema = Type.Object({
  id: Type.String(),
  title: Type.String(),
  status: BacklogStatusSchema,
}, { additionalProperties: false });
export const PromotionSelectionInputSchema = Type.Object({
  itemIds: Type.Optional(Type.Array(Type.String(), { minItems: 1, uniqueItems: true })),
  epicId: Type.Optional(Type.String()),
  recommendationRef: Type.Optional(Type.String()),
  session: Type.Optional(Type.String()),
  status: Type.Optional(Type.Union([Type.Literal('active'), Type.Literal('planned')])),
  profile: Type.Optional(PlanningProfileSchema),
  title: Type.Optional(Type.String()),
}, {
  additionalProperties: false,
  oneOf: [
    { required: ['itemIds'] },
    { required: ['epicId'] },
    { required: ['recommendationRef'] },
  ],
});
export const PromotionSelectionOutputSchema = Type.Object({
  itemIds: Type.Array(Type.String()),
  epicIds: Type.Array(Type.String()),
  session: Type.String(),
  sessionPlanPath: Type.String(),
  buildSource: Type.String(),
  status: BacklogStatusSchema,
  profile: Type.Union([PlanningProfileSchema, Type.Null()]),
  recommendationRef: Type.Optional(Type.String()),
  sources: Type.Array(PromotionSelectionSourceItemSchema),
  epics: Type.Array(PromotionSelectionSourceEpicSchema),
}, { additionalProperties: false });
// --- eforge:endregion promotion-selection ---

export const PlannerRoadmapEvidenceSchema = Type.Object({
  path: Type.Literal('docs/roadmap.md'),
  exists: Type.Boolean(),
  headings: Type.Array(Type.String()),
  excerpts: Type.Array(Type.String()),
}, { additionalProperties: false });
export const PlannerDependencyContextSchema = Type.Object({
  itemId: Type.String(),
  dependsOn: Type.Array(Type.String()),
  internalDependsOn: Type.Array(Type.String()),
  externalDependsOn: Type.Array(Type.String()),
  blockers: Type.Array(Type.String()),
  risks: Type.Array(Type.String()),
}, { additionalProperties: false });
export const PlannerContextSelectionSchema = Type.Object({
  kind: Type.String(),
  itemIds: Type.Array(Type.String()),
  epicIds: Type.Array(Type.String()),
  recommendationRef: Type.Optional(Type.String()),
  sourceRecommendationRef: Type.Optional(Type.String()),
}, { additionalProperties: false });
export const PlannerItemProjectionSchema = Type.Object({
  id: Type.String(),
  title: Type.String(),
  status: BacklogStatusSchema,
  epic: Type.Optional(Type.String()),
  tags: Type.Array(Type.String()),
  dependencies: Type.Array(Type.String()),
  sections: Type.Record(Type.String(), Type.String()),
  sourceReferences: Type.Array(Type.String()),
}, { additionalProperties: false });
export const PlannerEpicProjectionSchema = Type.Object({
  id: Type.String(),
  title: Type.String(),
  status: BacklogStatusSchema,
  tags: Type.Array(Type.String()),
  sections: Type.Record(Type.String(), Type.String()),
}, { additionalProperties: false });
export const PlannerRecommendationsPacketSchema = Type.Object({
  exists: Type.Boolean(),
  model: BacklogRecommendationModelSchema,
  summary: Type.Optional(RecommendationSummarySchema),
}, { additionalProperties: false });
export const PreparePlannerContextInputSchema = Type.Object({
  itemIds: Type.Optional(Type.Array(Type.String(), { minItems: 1, uniqueItems: true })),
  epicId: Type.Optional(Type.String()),
  recommendationRef: Type.Optional(Type.String()),
  sourceRecommendationRef: Type.Optional(Type.String()),
  includeRoadmap: Type.Optional(Type.Boolean()),
}, {
  additionalProperties: false,
  not: {
    anyOf: [
      { required: ['itemIds', 'epicId'] },
      { required: ['itemIds', 'recommendationRef'] },
      { required: ['epicId', 'recommendationRef'] },
    ],
  },
});
export const PreparePlannerContextOutputSchema = Type.Object({
  schemaVersion: Type.Literal(1),
  selection: PlannerContextSelectionSchema,
  items: Type.Array(PlannerItemProjectionSchema),
  epics: Type.Array(PlannerEpicProjectionSchema),
  recommendations: PlannerRecommendationsPacketSchema,
  recommendationRationale: Type.Array(Type.String()),
  dependencies: Type.Array(PlannerDependencyContextSchema),
  roadmapEvidence: PlannerRoadmapEvidenceSchema,
  traceSummaries: Type.Array(Type.Unknown()),
}, { additionalProperties: false });
export const PlannerHandoffDraftSchema = Type.Object({
  selection: PromotionSelectionInputSchema,
  session: Type.Optional(Type.String()),
  title: Type.Optional(Type.String()),
  profile: Type.Optional(PlanningProfileSchema),
}, { additionalProperties: false });
export const ApplyPlannerResultInputSchema = Type.Object({
  recommendations: Type.Optional(BacklogRecommendationModelSchema),
  handoffDraft: Type.Optional(PlannerHandoffDraftSchema),
}, { additionalProperties: false, minProperties: 1 });
export const ApplyPlannerResultOutputSchema = Type.Object({
  schemaVersion: Type.Literal(1),
  recommendations: Type.Optional(PutRecommendationsOutputSchema),
  handoff: Type.Optional(PromotionSelectionOutputSchema),
}, { additionalProperties: false });
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
export const LifecycleStateSchema = Type.Union([
  Type.Literal('none'),
  Type.Literal('planned'),
  Type.Literal('active'),
  Type.Literal('queue'),
  Type.Literal('build'),
  Type.Literal('pr-open'),
  Type.Literal('merged'),
  Type.Literal('shipped'),
  Type.Literal('failed'),
  Type.Literal('partial'),
]);
export const LifecycleLinkRowSchema = Type.Object({
  kind: Type.String(),
  stage: Type.String(),
  status: Type.String(),
  label: Type.String(),
  session: Type.Optional(Type.String()),
  prdId: Type.Optional(Type.String()),
  runId: Type.Optional(Type.String()),
  sessionId: Type.Optional(Type.String()),
  featureBranch: Type.Optional(Type.String()),
  commitSha: Type.Optional(Type.String()),
  prUrl: Type.Optional(Type.String()),
  path: Type.Optional(Type.String()),
  timestamp: Type.Optional(Type.String()),
  affectedItemIds: Type.Array(Type.String()),
}, { additionalProperties: false });
export const PlanSourceRefsSchema = Type.Object({
  sourceItemIds: Type.Array(Type.String()),
  sourceEpicIds: Type.Array(Type.String()),
  recommendationRef: Type.Optional(Type.String()),
  promotedAt: Type.Optional(Type.String()),
}, { additionalProperties: false });
export const ItemLifecycleProjectionSchema = Type.Object({
  itemId: Type.String(),
  title: Type.String(),
  status: BacklogStatusSchema,
  epic: Type.Optional(Type.String()),
  lifecycleState: LifecycleStateSchema,
  linkRows: Type.Array(LifecycleLinkRowSchema),
  failureEvidence: Type.Array(LifecycleLinkRowSchema),
}, { additionalProperties: false });
export const SessionPlanLifecycleProjectionSchema = Type.Object({
  sourceRefs: PlanSourceRefsSchema,
  lifecycleState: LifecycleStateSchema,
  itemRows: Type.Array(ItemLifecycleProjectionSchema),
  linkRows: Type.Array(LifecycleLinkRowSchema),
  failureEvidence: Type.Array(LifecycleLinkRowSchema),
}, { additionalProperties: false });
export const EpicProgressProjectionSchema = Type.Object({
  epicId: Type.String(),
  title: Type.String(),
  status: BacklogStatusSchema,
  lifecycleState: LifecycleStateSchema,
  countsByBacklogStatus: Type.Record(Type.String(), Type.Number()),
  countsByLifecycleState: Type.Record(Type.String(), Type.Number()),
  itemRows: Type.Array(ItemLifecycleProjectionSchema),
}, { additionalProperties: false });
export const TraceSummarySchema = Type.Object({
  itemId: Type.String(),
  epicId: Type.Optional(Type.String()),
  hasActiveSessionPlan: Type.Boolean(),
  hasActiveQueuePrd: Type.Boolean(),
  hasActiveBuildRun: Type.Boolean(),
  hasActiveBuildSession: Type.Boolean(),
  hasActiveTrace: Type.Boolean(),
  activeReasons: Type.Array(Type.String()),
  lastEvent: Type.Optional(TraceLastEventMetadataSchema),
  lifecycleState: LifecycleStateSchema,
  linkRows: Type.Array(LifecycleLinkRowSchema),
  prRefs: Type.Array(LifecycleLinkRowSchema),
  landingRefs: Type.Array(LifecycleLinkRowSchema),
  failureEvidence: Type.Array(LifecycleLinkRowSchema),
}, { additionalProperties: false });
export const KanbanDependencyRefSchema = Type.Object({
  id: Type.String(),
  title: Type.String(),
  status: Type.Optional(BacklogStatusSchema),
  missing: Type.Boolean(),
  blocking: Type.Boolean(),
});
export const KanbanEpicRefSchema = Type.Object({
  id: Type.String(),
  title: Type.String(),
  status: Type.Optional(BacklogStatusSchema),
  missing: Type.Boolean(),
});
export const KanbanCardNotesSchema = Type.Object({
  claim: Type.String(),
  evidence: Type.String(),
  recheck: Type.String(),
  promotionPaths: Type.String(),
});
export const KanbanCardSchema = Type.Object({
  id: Type.String(),
  title: Type.String(),
  status: BacklogStatusSchema,
  priority: Type.String(),
  tags: Type.Array(Type.String()),
  lane: KanbanLaneSchema,
  reasons: Type.Array(Type.String()),
  unresolvedDependsOn: Type.Array(Type.String()),
  activeTraceReasons: Type.Array(Type.String()),
  blocked: Type.Boolean(),
  ready: Type.Boolean(),
  reviewDue: Type.Boolean(),
  closed: Type.Boolean(),
  epic: Type.Optional(Type.String()),
  epicRef: Type.Optional(KanbanEpicRefSchema),
  dependencies: Type.Array(KanbanDependencyRefSchema),
  dependents: Type.Array(KanbanDependencyRefSchema),
  notes: KanbanCardNotesSchema,
  recRank: Type.Optional(Type.Number()),
  recLanes: Type.Array(Type.String()),
  recUnblock: Type.Optional(Type.String()),
  lifecycleState: LifecycleStateSchema,
  linkRows: Type.Array(LifecycleLinkRowSchema),
  failureEvidence: Type.Array(LifecycleLinkRowSchema),
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
  lanes: Type.Array(KanbanLaneOutputSchema),
  blockedReasons: Type.Array(Type.Object({ itemId: Type.String(), reasons: Type.Array(Type.String()) })),
  traceSummaries: Type.Array(TraceSummarySchema),
  lifecycleLinks: Type.Array(LifecycleLinkRowSchema),
  epicProgress: Type.Array(EpicProgressProjectionSchema),
  // --- eforge:region recommendations ---
  recommendationSummary: Type.Optional(RecommendationSummarySchema),
  recommendationStatus: RecommendationDerivedStatusSchema,
  // --- eforge:endregion recommendations ---
});
// --- eforge:endregion board-schemas ---

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
export type LifecycleState = Static<typeof LifecycleStateSchema>;
export type LifecycleLinkRow = Static<typeof LifecycleLinkRowSchema>;
export type PlanSourceRefs = Static<typeof PlanSourceRefsSchema>;
export type ItemLifecycleProjection = Static<typeof ItemLifecycleProjectionSchema>;
export type SessionPlanLifecycleProjection = Static<typeof SessionPlanLifecycleProjectionSchema>;
export type EpicProgressProjection = Static<typeof EpicProgressProjectionSchema>;
export type TraceSummaryProjection = Static<typeof TraceSummarySchema>;
export type KanbanBoardOutput = Static<typeof KanbanBoardOutputSchema>;
export type ListBoardOutput = Static<typeof ListBoardOutputSchema>;
// --- eforge:region recommendations ---
export type RecommendationItemRef = Static<typeof RecommendationItemRefSchema>;
export type RecommendationGroup = Static<typeof RecommendationGroupSchema>;
export type RecommendationBlockedChain = Static<typeof RecommendationBlockedChainSchema>;
export type BacklogRecommendationModel = Static<typeof BacklogRecommendationModelSchema>;
export type RecommendationSummary = Static<typeof RecommendationSummarySchema>;
export type RecommendationStaleReason = Static<typeof RecommendationStaleReasonSchema>; export type RecommendationStatusSidecar = Static<typeof RecommendationStatusSidecarSchema>;
export type RecommendationDerivedStatus = Static<typeof RecommendationDerivedStatusSchema>; export type GetRecommendationsInput = Static<typeof GetRecommendationsInputSchema>;
export type GetRecommendationsOutput = Static<typeof GetRecommendationsOutputSchema>;
export type PutRecommendationsInput = Static<typeof PutRecommendationsInputSchema>;
export type PutRecommendationsOutput = Static<typeof PutRecommendationsOutputSchema>;
// --- eforge:endregion recommendations ---
// --- eforge:region promotion-selection ---
export type PromotionSelectionSourceItem = Static<typeof PromotionSelectionSourceItemSchema>;
export type PromotionSelectionSourceEpic = Static<typeof PromotionSelectionSourceEpicSchema>;
export type PromotionSelectionInput = Static<typeof PromotionSelectionInputSchema>;
export type PromotionSelectionOutput = Static<typeof PromotionSelectionOutputSchema>;
// --- eforge:endregion promotion-selection ---
export type PlannerRoadmapEvidence = Static<typeof PlannerRoadmapEvidenceSchema>;
export type PlannerDependencyContext = Static<typeof PlannerDependencyContextSchema>;
export type PlannerContextInput = Static<typeof PreparePlannerContextInputSchema>;
export type PlannerContextOutput = Static<typeof PreparePlannerContextOutputSchema>;
export type ApplyPlannerResultInput = Static<typeof ApplyPlannerResultInputSchema>;
export type ApplyPlannerResultOutput = Static<typeof ApplyPlannerResultOutputSchema>;
export type PlannerHandoffDraft = Static<typeof PlannerHandoffDraftSchema>;
export type PlanningProfileInput = Static<typeof PlanningProfileSchema>;

// Planning agent task workflow schemas/types live in a focused module to keep
// this file under the maintainability cap. They are imported directly from
// './planning-agent-task-schemas.js' by consumers rather than re-exported here:
// the focused module imports primitive schemas/constants from this file, and a
// re-export would create a circular module-evaluation cycle (the re-exported
// dependency evaluates before this file's `const` definitions run, leaving them
// undefined).
