import { Type, type Static } from '@sinclair/typebox';
import { formatSchemaError, parseWithSchema, safeParseWithSchema, type SafeParseResult } from './schema-utils.js';

export const EXTENSION_AGENT_TASK_KIND_EFORGE_PLAN_PLANNING_DRAFT = 'eforge-plan.planning-draft' as const;

export const ExtensionAgentTaskKindSchema = Type.Literal(EXTENSION_AGENT_TASK_KIND_EFORGE_PLAN_PLANNING_DRAFT);

export const ExtensionAgentTaskStatusSchema = Type.Union([
  Type.Literal('queued'),
  Type.Literal('running'),
  Type.Literal('completed'),
  Type.Literal('failed'),
  Type.Literal('cancelled'),
]);

export const ExtensionAgentTaskRequestedBySchema = Type.Object({
  host: Type.Union([
    Type.Literal('console'),
    Type.Literal('pi'),
    Type.Literal('claude'),
    Type.Literal('mcp'),
    Type.Literal('cli'),
  ]),
  surface: Type.Optional(Type.String()),
  sessionId: Type.Optional(Type.String()),
}, { additionalProperties: false });

export const EforgePlanPlanningRequestedOutputSectionSchema = Type.Union([
  Type.Literal('recommendations'),
  Type.Literal('handoffDrafts'),
  Type.Literal('planDrafts'),
  Type.Literal('playbookDraft'),
  Type.Literal('sessionPlanPatch'),
  // --- eforge:region session-plan-creation-draft ---
  Type.Literal('sessionPlanCreationDraft'),
  // --- eforge:endregion session-plan-creation-draft ---
  // --- eforge:region backlog-curation-draft ---
  Type.Literal('backlogCurationDraft'),
  // --- eforge:endregion backlog-curation-draft ---
]);

export const EXTENSION_AGENT_TASK_ID_PATTERN = '^[A-Za-z0-9._-]{1,128}$' as const;
export const ExtensionAgentTaskIdSchema = Type.String({ minLength: 1, maxLength: 128, pattern: EXTENSION_AGENT_TASK_ID_PATTERN });
export const EforgePlanPlanningTopicSchema = Type.String({ minLength: 1, pattern: '\\S' });

export const EforgePlanPlanningDraftInputSchema = Type.Object({
  topic: EforgePlanPlanningTopicSchema,
  session: Type.Optional(Type.String()),
  planningType: Type.Optional(Type.String()),
  planningDepth: Type.Optional(Type.String()),
  sourceText: Type.Optional(Type.String()),
  existingSessionPlan: Type.Optional(Type.String()),
  requestedOutputSections: Type.Optional(Type.Array(EforgePlanPlanningRequestedOutputSectionSchema, { minItems: 1 })),
  includeRoadmap: Type.Optional(Type.Boolean()),
}, { additionalProperties: false });

export const EforgePlanPlanningPlanDraftSchema = Type.Object({
  title: Type.String(),
  body: Type.String(),
}, { additionalProperties: false });

export const EforgePlanPlanningPlaybookDraftSchema = Type.Object({
  name: Type.String(),
  body: Type.String(),
}, { additionalProperties: false });

export const EforgePlanPlanningSessionPlanPatchSchema = Type.Object({
  sections: Type.Array(Type.Object({
    dimension: Type.String(),
    content: Type.String(),
  }, { additionalProperties: false }), { minItems: 1 }),
  skippedDimensions: Type.Optional(Type.Array(Type.Object({
    dimension: Type.String(),
    reason: Type.String(),
  }, { additionalProperties: false }))),
}, { additionalProperties: false });

// --- eforge:region session-plan-creation-draft ---
// Constrain to the same literals the eforge-plan apply path accepts
// (`PLANNING_TYPES`/`PLANNING_DEPTHS`) so the daemon never persists a "ready" task
// whose planningType/planningDepth the workstation previews but cannot apply.
export const EforgePlanPlanningTypeSchema = Type.Union([
  Type.Literal('bugfix'),
  Type.Literal('feature'),
  Type.Literal('refactor'),
  Type.Literal('architecture'),
  Type.Literal('docs'),
  Type.Literal('maintenance'),
  Type.Literal('unknown'),
]);

export const EforgePlanPlanningDepthSchema = Type.Union([
  Type.Literal('quick'),
  Type.Literal('focused'),
  Type.Literal('deep'),
]);

export const EforgePlanPlanningSessionPlanCreationDraftSchema = Type.Object({
  session: Type.String({ minLength: 1, pattern: '\\S' }),
  topic: Type.String({ minLength: 1, pattern: '\\S' }),
  planningType: EforgePlanPlanningTypeSchema,
  planningDepth: EforgePlanPlanningDepthSchema,
  profile: Type.Optional(Type.Union([Type.Literal('errand'), Type.Literal('excursion'), Type.Literal('expedition')])),
  agentProfile: Type.Optional(Type.String()),
  sections: Type.Array(Type.Object({
    dimension: Type.String(),
    content: Type.String(),
  }, { additionalProperties: false }), { minItems: 1 }),
  skippedDimensions: Type.Optional(Type.Array(Type.Object({
    dimension: Type.String(),
    reason: Type.String(),
  }, { additionalProperties: false }))),
}, { additionalProperties: false });

export const EforgePlanPlanningClarificationQuestionSchema = Type.Object({
  question: Type.String({ minLength: 1, pattern: '\\S' }),
  why: Type.Optional(Type.String()),
  options: Type.Optional(Type.Array(Type.String())),
}, { additionalProperties: false });

export const EforgePlanPlanningDecisionSchema = Type.Union([
  Type.Literal('ready'),
  Type.Literal('needs-input'),
]);

// Bounds mirror the daemon section-progress sanitizer
// (`sanitizeEventMessage` caps strings at 500 chars; `MAX_SECTION_PROGRESS_ITEMS`
// caps lists at 50 entries) so client/event validation rejects oversized payloads.
export const SECTION_PROGRESS_MAX_STRING_LENGTH = 500 as const;
export const SECTION_PROGRESS_MAX_ITEMS = 50 as const;
const EforgePlanPlanningSectionNameSchema = Type.String({ maxLength: SECTION_PROGRESS_MAX_STRING_LENGTH });

export const EforgePlanPlanningSectionProgressSchema = Type.Object({
  currentSection: Type.Optional(EforgePlanPlanningSectionNameSchema),
  coveredSections: Type.Optional(Type.Array(EforgePlanPlanningSectionNameSchema, { maxItems: SECTION_PROGRESS_MAX_ITEMS })),
  remainingSections: Type.Optional(Type.Array(EforgePlanPlanningSectionNameSchema, { maxItems: SECTION_PROGRESS_MAX_ITEMS })),
}, { additionalProperties: false });
// --- eforge:endregion session-plan-creation-draft ---

export const EforgePlanPlanningRecommendationItemRefSchema = Type.Object({
  ref: Type.Optional(Type.String()),
  itemId: Type.String(),
  rationale: Type.Optional(Type.String()),
  confidence: Type.Optional(Type.String()),
}, { additionalProperties: false });

export const EforgePlanPlanningRecommendationGroupSchema = Type.Object({
  ref: Type.String(),
  title: Type.Optional(Type.String()),
  itemIds: Type.Array(Type.String(), { minItems: 1 }),
  epicIds: Type.Optional(Type.Array(Type.String())),
  safeToPlanTogether: Type.Optional(Type.Boolean()),
  rationale: Type.Optional(Type.String()),
  recommendedProfile: Type.Optional(Type.Union([Type.Literal('errand'), Type.Literal('excursion'), Type.Literal('expedition')])),
}, { additionalProperties: false });

export const EforgePlanPlanningRecommendationBlockedChainSchema = Type.Object({
  ref: Type.Optional(Type.String()),
  itemIds: Type.Array(Type.String()),
  blockedBy: Type.Array(Type.String()),
  rationale: Type.Optional(Type.String()),
}, { additionalProperties: false });

export const EforgePlanPlanningRecommendationsSchema = Type.Object({
  schemaVersion: Type.Literal(1),
  updatedAt: Type.Optional(Type.String()),
  activeWork: Type.Array(EforgePlanPlanningRecommendationItemRefSchema),
  readyCandidates: Type.Array(EforgePlanPlanningRecommendationItemRefSchema),
  recommendedNextSequence: Type.Array(EforgePlanPlanningRecommendationItemRefSchema),
  safeParallelizableGroups: Type.Array(EforgePlanPlanningRecommendationGroupSchema),
  blockedChains: Type.Array(EforgePlanPlanningRecommendationBlockedChainSchema),
  rationaleAndAssumptions: Type.Array(Type.String()),
}, { additionalProperties: false });


// --- eforge:region backlog-curation-draft ---
const EforgePlanPlanningNonEmptyStringSchema = Type.String({ minLength: 1, pattern: '\\S' });

export const EforgePlanPlanningBacklogCurationRecordKindSchema = Type.Union([Type.Literal('item'), Type.Literal('epic')]);

const eforgePlanPlanningBacklogCurationPreconditionFields = {
  id: EforgePlanPlanningNonEmptyStringSchema,
  bodySha256: EforgePlanPlanningNonEmptyStringSchema,
  sourceFingerprint: Type.Optional(EforgePlanPlanningNonEmptyStringSchema),
  updated: Type.Optional(Type.String()),
  recordSha256: Type.Optional(EforgePlanPlanningNonEmptyStringSchema),
} as const;

export const EforgePlanPlanningBacklogCurationPreconditionSchema = Type.Object({
  ...eforgePlanPlanningBacklogCurationPreconditionFields,
  kind: EforgePlanPlanningBacklogCurationRecordKindSchema,
}, { additionalProperties: false });

export const EforgePlanPlanningBacklogCurationItemPreconditionSchema = Type.Object({
  ...eforgePlanPlanningBacklogCurationPreconditionFields,
  kind: Type.Literal('item'),
}, { additionalProperties: false });

export const EforgePlanPlanningBacklogCurationEpicPreconditionSchema = Type.Object({
  ...eforgePlanPlanningBacklogCurationPreconditionFields,
  kind: Type.Literal('epic'),
}, { additionalProperties: false });

export const EforgePlanPlanningBacklogCurationMetadataPatchSchema = Type.Object({
  status: Type.Optional(Type.String()),
  priority: Type.Optional(Type.String()),
  tags: Type.Optional(Type.Array(Type.String())),
  depends_on: Type.Optional(Type.Array(EforgePlanPlanningNonEmptyStringSchema)),
  epic: Type.Optional(Type.Union([EforgePlanPlanningNonEmptyStringSchema, Type.Null()])),
  last_checked: Type.Optional(Type.String()),
  stale_after: Type.Optional(Type.String()),
}, { additionalProperties: false });

export const EforgePlanPlanningBacklogCurationSectionOperationSchema = Type.Object({
  heading: EforgePlanPlanningNonEmptyStringSchema,
  action: Type.Union([Type.Literal('replace'), Type.Literal('append')]),
  content: Type.String(),
}, { additionalProperties: false });

const eforgePlanPlanningBacklogCurationRecordPatchFields = {
  id: EforgePlanPlanningNonEmptyStringSchema,
  metadata: Type.Optional(EforgePlanPlanningBacklogCurationMetadataPatchSchema),
  sectionOperations: Type.Optional(Type.Array(EforgePlanPlanningBacklogCurationSectionOperationSchema)),
  rationale: Type.Optional(Type.String()),
  evidence: Type.Optional(Type.Array(Type.String())),
} as const;

export const EforgePlanPlanningBacklogCurationItemRecordPatchSchema = Type.Object({
  ...eforgePlanPlanningBacklogCurationRecordPatchFields,
  kind: Type.Literal('item'),
  precondition: EforgePlanPlanningBacklogCurationItemPreconditionSchema,
}, { additionalProperties: false });

export const EforgePlanPlanningBacklogCurationEpicRecordPatchSchema = Type.Object({
  ...eforgePlanPlanningBacklogCurationRecordPatchFields,
  kind: Type.Literal('epic'),
  precondition: EforgePlanPlanningBacklogCurationEpicPreconditionSchema,
}, { additionalProperties: false });

export const EforgePlanPlanningBacklogCurationRecordPatchSchema = Type.Union([
  EforgePlanPlanningBacklogCurationItemRecordPatchSchema,
  EforgePlanPlanningBacklogCurationEpicRecordPatchSchema,
]);

const eforgePlanPlanningBacklogCurationRecheckFields = {
  id: EforgePlanPlanningNonEmptyStringSchema,
  last_checked: Type.String(),
  stale_after: Type.String(),
  rationale: Type.Optional(Type.String()),
} as const;

export const EforgePlanPlanningBacklogCurationItemRecheckSchema = Type.Object({
  ...eforgePlanPlanningBacklogCurationRecheckFields,
  kind: Type.Literal('item'),
  precondition: EforgePlanPlanningBacklogCurationItemPreconditionSchema,
}, { additionalProperties: false });

export const EforgePlanPlanningBacklogCurationEpicRecheckSchema = Type.Object({
  ...eforgePlanPlanningBacklogCurationRecheckFields,
  kind: Type.Literal('epic'),
  precondition: EforgePlanPlanningBacklogCurationEpicPreconditionSchema,
}, { additionalProperties: false });

export const EforgePlanPlanningBacklogCurationRecheckSchema = Type.Union([
  EforgePlanPlanningBacklogCurationItemRecheckSchema,
  EforgePlanPlanningBacklogCurationEpicRecheckSchema,
]);

export const EforgePlanPlanningBacklogCurationSkippedSchema = Type.Object({
  id: Type.Optional(EforgePlanPlanningNonEmptyStringSchema),
  kind: Type.Optional(EforgePlanPlanningBacklogCurationRecordKindSchema),
  reason: EforgePlanPlanningNonEmptyStringSchema,
}, { additionalProperties: false });

export const EforgePlanPlanningBacklogCurationNeedsInputSchema = Type.Object({
  id: Type.Optional(EforgePlanPlanningNonEmptyStringSchema),
  kind: Type.Optional(EforgePlanPlanningBacklogCurationRecordKindSchema),
  question: EforgePlanPlanningNonEmptyStringSchema,
  reason: Type.Optional(EforgePlanPlanningNonEmptyStringSchema),
}, { additionalProperties: false });

export const EforgePlanPlanningBacklogCurationDraftSchema = Type.Object({
  schemaVersion: Type.Literal(1),
  sourceFingerprint: EforgePlanPlanningNonEmptyStringSchema,
  generatedAt: Type.Optional(Type.String()),
  summary: Type.Array(Type.String()),
  itemChanges: Type.Array(EforgePlanPlanningBacklogCurationItemRecordPatchSchema),
  epicChanges: Type.Array(EforgePlanPlanningBacklogCurationEpicRecordPatchSchema),
  noOpRechecks: Type.Array(EforgePlanPlanningBacklogCurationRecheckSchema),
  skipped: Type.Array(EforgePlanPlanningBacklogCurationSkippedSchema),
  needsInput: Type.Array(EforgePlanPlanningBacklogCurationNeedsInputSchema),
}, { additionalProperties: false });
// --- eforge:endregion backlog-curation-draft ---

export const EforgePlanPlanningHandoffDraftSchema = Type.Object({
  selection: Type.Object({}, { additionalProperties: true }),
  session: Type.Optional(Type.String()),
  title: Type.Optional(Type.String()),
  profile: Type.Optional(Type.Union([Type.Literal('errand'), Type.Literal('excursion'), Type.Literal('expedition')])),
}, { additionalProperties: false });

// Common, non-output-bearing fields shared by every result variant, including
// needs-input. These never count as output sections.
const eforgePlanPlanningDraftResultCommonFields = {
  summary: Type.String(),
  assumptionsOpenQuestions: Type.Array(Type.String()),
  nextSteps: Type.Optional(Type.Array(Type.String())),
} as const;

// Optional output-bearing fields. These must NOT appear on the needs-input
// variant so the ready-vs-needs-input split stays clean and output counting
// cannot double-count a needs-input decision plus stray output sections.
const eforgePlanPlanningDraftResultOutputFields = {
  recommendations: Type.Optional(EforgePlanPlanningRecommendationsSchema),
  // --- eforge:region backlog-curation-draft ---
  backlogCurationDraft: Type.Optional(EforgePlanPlanningBacklogCurationDraftSchema),
  // --- eforge:endregion backlog-curation-draft ---
  handoffDraft: Type.Optional(EforgePlanPlanningHandoffDraftSchema),
  handoffDrafts: Type.Optional(Type.Array(EforgePlanPlanningHandoffDraftSchema, { minItems: 1 })),
} as const;

const eforgePlanPlanningDraftResultBaseFields = {
  ...eforgePlanPlanningDraftResultCommonFields,
  ...eforgePlanPlanningDraftResultOutputFields,
} as const;

export const EforgePlanPlanningDraftResultBaseSchema = Type.Object(eforgePlanPlanningDraftResultBaseFields, { additionalProperties: false });

export const EforgePlanPlanningDraftResultSchema = Type.Union([
  // --- eforge:region backlog-curation-draft ---
  Type.Object({
    ...eforgePlanPlanningDraftResultBaseFields,
    backlogCurationDraft: EforgePlanPlanningBacklogCurationDraftSchema,
    planDrafts: Type.Optional(Type.Array(EforgePlanPlanningPlanDraftSchema, { minItems: 1 })),
    playbookDraft: Type.Optional(EforgePlanPlanningPlaybookDraftSchema),
    sessionPlanPatch: Type.Optional(EforgePlanPlanningSessionPlanPatchSchema),
  }, { additionalProperties: false }),
  // --- eforge:endregion backlog-curation-draft ---
  Type.Object({
    ...eforgePlanPlanningDraftResultBaseFields,
    recommendations: EforgePlanPlanningRecommendationsSchema,
    planDrafts: Type.Optional(Type.Array(EforgePlanPlanningPlanDraftSchema, { minItems: 1 })),
    playbookDraft: Type.Optional(EforgePlanPlanningPlaybookDraftSchema),
    sessionPlanPatch: Type.Optional(EforgePlanPlanningSessionPlanPatchSchema),
  }, { additionalProperties: false }),
  Type.Object({
    ...eforgePlanPlanningDraftResultBaseFields,
    handoffDraft: EforgePlanPlanningHandoffDraftSchema,
    planDrafts: Type.Optional(Type.Array(EforgePlanPlanningPlanDraftSchema, { minItems: 1 })),
    playbookDraft: Type.Optional(EforgePlanPlanningPlaybookDraftSchema),
    sessionPlanPatch: Type.Optional(EforgePlanPlanningSessionPlanPatchSchema),
  }, { additionalProperties: false }),
  Type.Object({
    ...eforgePlanPlanningDraftResultBaseFields,
    handoffDrafts: Type.Array(EforgePlanPlanningHandoffDraftSchema, { minItems: 1 }),
    planDrafts: Type.Optional(Type.Array(EforgePlanPlanningPlanDraftSchema, { minItems: 1 })),
    playbookDraft: Type.Optional(EforgePlanPlanningPlaybookDraftSchema),
    sessionPlanPatch: Type.Optional(EforgePlanPlanningSessionPlanPatchSchema),
  }, { additionalProperties: false }),
  Type.Object({
    ...eforgePlanPlanningDraftResultBaseFields,
    planDrafts: Type.Array(EforgePlanPlanningPlanDraftSchema, { minItems: 1 }),
    playbookDraft: Type.Optional(EforgePlanPlanningPlaybookDraftSchema),
    sessionPlanPatch: Type.Optional(EforgePlanPlanningSessionPlanPatchSchema),
  }, { additionalProperties: false }),
  Type.Object({
    ...eforgePlanPlanningDraftResultBaseFields,
    planDrafts: Type.Optional(Type.Array(EforgePlanPlanningPlanDraftSchema, { minItems: 1 })),
    playbookDraft: EforgePlanPlanningPlaybookDraftSchema,
    sessionPlanPatch: Type.Optional(EforgePlanPlanningSessionPlanPatchSchema),
  }, { additionalProperties: false }),
  Type.Object({
    ...eforgePlanPlanningDraftResultBaseFields,
    planDrafts: Type.Optional(Type.Array(EforgePlanPlanningPlanDraftSchema, { minItems: 1 })),
    playbookDraft: Type.Optional(EforgePlanPlanningPlaybookDraftSchema),
    sessionPlanPatch: EforgePlanPlanningSessionPlanPatchSchema,
  }, { additionalProperties: false }),
  // --- eforge:region session-plan-creation-draft ---
  Type.Object({
    ...eforgePlanPlanningDraftResultBaseFields,
    decision: Type.Literal('ready'),
    sessionPlanCreationDraft: EforgePlanPlanningSessionPlanCreationDraftSchema,
    planDrafts: Type.Optional(Type.Array(EforgePlanPlanningPlanDraftSchema, { minItems: 1 })),
    playbookDraft: Type.Optional(EforgePlanPlanningPlaybookDraftSchema),
    sessionPlanPatch: Type.Optional(EforgePlanPlanningSessionPlanPatchSchema),
  }, { additionalProperties: false }),
  Type.Object({
    ...eforgePlanPlanningDraftResultCommonFields,
    decision: Type.Literal('needs-input'),
    clarificationQuestions: Type.Array(EforgePlanPlanningClarificationQuestionSchema, { minItems: 1 }),
    rationale: Type.String({ minLength: 1, pattern: '\\S' }),
  }, { additionalProperties: false }),
  // --- eforge:endregion session-plan-creation-draft ---
]);

export const ExtensionAgentTaskStartRequestSchema = Type.Object({
  kind: ExtensionAgentTaskKindSchema,
  input: EforgePlanPlanningDraftInputSchema,
  requestedBy: Type.Optional(ExtensionAgentTaskRequestedBySchema),
}, { additionalProperties: false });

export const ExtensionAgentTaskGetRequestSchema = Type.Object({
  taskId: ExtensionAgentTaskIdSchema,
}, { additionalProperties: false });

export const ExtensionAgentTaskCancelRequestSchema = Type.Object({
  reason: Type.Optional(Type.String()),
}, { additionalProperties: false });

export const ExtensionAgentTaskSanitizedMetadataSchema = Type.Object({
  label: Type.Optional(Type.String()),
  summary: Type.Optional(Type.String()),
  progressMessage: Type.Optional(Type.String()),
  outputSectionCount: Type.Optional(Type.Integer({ minimum: 0 })),
  warningCount: Type.Optional(Type.Integer({ minimum: 0 })),
  // --- eforge:region session-plan-creation-draft ---
  sectionProgress: Type.Optional(EforgePlanPlanningSectionProgressSchema),
  // --- eforge:endregion session-plan-creation-draft ---
}, { additionalProperties: false });

const extensionAgentTaskRecordBaseFields = {
  taskId: ExtensionAgentTaskIdSchema,
  kind: ExtensionAgentTaskKindSchema,
  createdAt: Type.String(),
  updatedAt: Type.String(),
  metadata: Type.Optional(ExtensionAgentTaskSanitizedMetadataSchema),
} as const;

export const ExtensionAgentTaskRecordSchema = Type.Union([
  Type.Object({
    ...extensionAgentTaskRecordBaseFields,
    status: Type.Literal('queued'),
  }, { additionalProperties: false }),
  Type.Object({
    ...extensionAgentTaskRecordBaseFields,
    status: Type.Literal('running'),
    startedAt: Type.String(),
  }, { additionalProperties: false }),
  Type.Object({
    ...extensionAgentTaskRecordBaseFields,
    status: Type.Literal('completed'),
    startedAt: Type.Optional(Type.String()),
    completedAt: Type.String(),
    result: EforgePlanPlanningDraftResultSchema,
  }, { additionalProperties: false }),
  Type.Object({
    ...extensionAgentTaskRecordBaseFields,
    status: Type.Literal('failed'),
    startedAt: Type.Optional(Type.String()),
    completedAt: Type.Optional(Type.String()),
    errorCode: Type.String(),
    errorMessage: Type.String(),
  }, { additionalProperties: false }),
  Type.Object({
    ...extensionAgentTaskRecordBaseFields,
    status: Type.Literal('cancelled'),
    startedAt: Type.Optional(Type.String()),
    cancelledAt: Type.String(),
    errorMessage: Type.Optional(Type.String()),
  }, { additionalProperties: false }),
]);

export const ExtensionAgentTaskStartResponseSchema = Type.Object({
  task: ExtensionAgentTaskRecordSchema,
}, { additionalProperties: false });

export const ExtensionAgentTaskGetResponseSchema = Type.Object({
  task: ExtensionAgentTaskRecordSchema,
}, { additionalProperties: false });

export const ExtensionAgentTaskCancelResponseSchema = Type.Object({
  task: ExtensionAgentTaskRecordSchema,
}, { additionalProperties: false });

export type ExtensionAgentTaskKind = Static<typeof ExtensionAgentTaskKindSchema>;
export type ExtensionAgentTaskId = Static<typeof ExtensionAgentTaskIdSchema>;
export type ExtensionAgentTaskStatus = Static<typeof ExtensionAgentTaskStatusSchema>;
export type ExtensionAgentTaskRequestedBy = Static<typeof ExtensionAgentTaskRequestedBySchema>;
export type EforgePlanPlanningRequestedOutputSection = Static<typeof EforgePlanPlanningRequestedOutputSectionSchema>;
export type EforgePlanPlanningDraftInput = Static<typeof EforgePlanPlanningDraftInputSchema>;
export type EforgePlanPlanningPlanDraft = Static<typeof EforgePlanPlanningPlanDraftSchema>;
export type EforgePlanPlanningPlaybookDraft = Static<typeof EforgePlanPlanningPlaybookDraftSchema>;
export type EforgePlanPlanningSessionPlanPatch = Static<typeof EforgePlanPlanningSessionPlanPatchSchema>;
export type EforgePlanPlanningSessionPlanCreationDraft = Static<typeof EforgePlanPlanningSessionPlanCreationDraftSchema>;
export type EforgePlanPlanningClarificationQuestion = Static<typeof EforgePlanPlanningClarificationQuestionSchema>;
export type EforgePlanPlanningDecision = Static<typeof EforgePlanPlanningDecisionSchema>;
export type EforgePlanPlanningSectionProgress = Static<typeof EforgePlanPlanningSectionProgressSchema>;
export type EforgePlanPlanningRecommendations = Static<typeof EforgePlanPlanningRecommendationsSchema>;
export type EforgePlanPlanningBacklogCurationRecordKind = Static<typeof EforgePlanPlanningBacklogCurationRecordKindSchema>;
export type EforgePlanPlanningBacklogCurationPrecondition = Static<typeof EforgePlanPlanningBacklogCurationPreconditionSchema>;
export type EforgePlanPlanningBacklogCurationMetadataPatch = Static<typeof EforgePlanPlanningBacklogCurationMetadataPatchSchema>;
export type EforgePlanPlanningBacklogCurationSectionOperation = Static<typeof EforgePlanPlanningBacklogCurationSectionOperationSchema>;
export type EforgePlanPlanningBacklogCurationRecordPatch = Static<typeof EforgePlanPlanningBacklogCurationRecordPatchSchema>;
export type EforgePlanPlanningBacklogCurationRecheck = Static<typeof EforgePlanPlanningBacklogCurationRecheckSchema>;
export type EforgePlanPlanningBacklogCurationSkipped = Static<typeof EforgePlanPlanningBacklogCurationSkippedSchema>;
export type EforgePlanPlanningBacklogCurationNeedsInput = Static<typeof EforgePlanPlanningBacklogCurationNeedsInputSchema>;
export type EforgePlanPlanningBacklogCurationDraft = Static<typeof EforgePlanPlanningBacklogCurationDraftSchema>;
export type EforgePlanPlanningHandoffDraft = Static<typeof EforgePlanPlanningHandoffDraftSchema>;
export type EforgePlanPlanningDraftResult = Static<typeof EforgePlanPlanningDraftResultSchema>;
export type ExtensionAgentTaskStartRequest = Static<typeof ExtensionAgentTaskStartRequestSchema>;
export type ExtensionAgentTaskGetRequest = Static<typeof ExtensionAgentTaskGetRequestSchema>;
export type ExtensionAgentTaskCancelRequest = Static<typeof ExtensionAgentTaskCancelRequestSchema>;
export type ExtensionAgentTaskSanitizedMetadata = Static<typeof ExtensionAgentTaskSanitizedMetadataSchema>;
export type ExtensionAgentTaskRecord = Static<typeof ExtensionAgentTaskRecordSchema>;
export type ExtensionAgentTaskStartResponse = Static<typeof ExtensionAgentTaskStartResponseSchema>;
export type ExtensionAgentTaskGetResponse = Static<typeof ExtensionAgentTaskGetResponseSchema>;
export type ExtensionAgentTaskCancelResponse = Static<typeof ExtensionAgentTaskCancelResponseSchema>;

export function hasEforgePlanPlanningDraftOutputSection(value: EforgePlanPlanningDraftResult): boolean {
  const candidate = value as Record<string, unknown>;
  if (candidate.decision === 'ready' && candidate.sessionPlanCreationDraft !== undefined) return true;
  if (candidate.backlogCurationDraft !== undefined) return true;
  return candidate.recommendations !== undefined
    || candidate.handoffDraft !== undefined
    || (Array.isArray(candidate.handoffDrafts) && candidate.handoffDrafts.length > 0)
    || (Array.isArray(candidate.planDrafts) && candidate.planDrafts.length > 0)
    || candidate.playbookDraft !== undefined
    || candidate.sessionPlanPatch !== undefined;
}

export function safeParseEforgePlanPlanningDraftResult(value: unknown): SafeParseResult<EforgePlanPlanningDraftResult> {
  return safeParseWithSchema(EforgePlanPlanningDraftResultSchema, value);
}

export function parseEforgePlanPlanningDraftResult(value: unknown): EforgePlanPlanningDraftResult {
  const result = safeParseEforgePlanPlanningDraftResult(value);
  if (result.success) return result.data;
  throw new Error(formatSchemaError(result.error));
}

export function assertExtensionAgentTaskId(taskId: string): void {
  const result = safeParseWithSchema(ExtensionAgentTaskIdSchema, taskId);
  if (!result.success) {
    throw new Error(formatSchemaError(result.error));
  }
}

export function safeParseExtensionAgentTaskRecord(value: unknown): SafeParseResult<ExtensionAgentTaskRecord> {
  return safeParseWithSchema(ExtensionAgentTaskRecordSchema, value);
}

export function parseExtensionAgentTaskRecord(value: unknown): ExtensionAgentTaskRecord {
  const result = safeParseExtensionAgentTaskRecord(value);
  if (result.success) return result.data;
  throw new Error(formatSchemaError(result.error));
}

export function safeParseExtensionAgentTaskStartRequest(value: unknown): SafeParseResult<ExtensionAgentTaskStartRequest> {
  return safeParseWithSchema(ExtensionAgentTaskStartRequestSchema, value);
}

export function parseExtensionAgentTaskStartRequest(value: unknown): ExtensionAgentTaskStartRequest {
  return parseWithSchema(ExtensionAgentTaskStartRequestSchema, value);
}

export function safeParseExtensionAgentTaskGetRequest(value: unknown): SafeParseResult<ExtensionAgentTaskGetRequest> {
  return safeParseWithSchema(ExtensionAgentTaskGetRequestSchema, value);
}

export function parseExtensionAgentTaskGetRequest(value: unknown): ExtensionAgentTaskGetRequest {
  return parseWithSchema(ExtensionAgentTaskGetRequestSchema, value);
}

export function safeParseExtensionAgentTaskCancelRequest(value: unknown): SafeParseResult<ExtensionAgentTaskCancelRequest> {
  return safeParseWithSchema(ExtensionAgentTaskCancelRequestSchema, value);
}

export function parseExtensionAgentTaskCancelRequest(value: unknown): ExtensionAgentTaskCancelRequest {
  return parseWithSchema(ExtensionAgentTaskCancelRequestSchema, value);
}

export function safeParseExtensionAgentTaskGetResponse(value: unknown): SafeParseResult<ExtensionAgentTaskGetResponse> {
  return safeParseWithSchema(ExtensionAgentTaskGetResponseSchema, value);
}

export function parseExtensionAgentTaskGetResponse(value: unknown): ExtensionAgentTaskGetResponse {
  return parseWithSchema(ExtensionAgentTaskGetResponseSchema, value);
}

export function safeParseExtensionAgentTaskStartResponse(value: unknown): SafeParseResult<ExtensionAgentTaskStartResponse> {
  return safeParseWithSchema(ExtensionAgentTaskStartResponseSchema, value);
}

export function parseExtensionAgentTaskStartResponse(value: unknown): ExtensionAgentTaskStartResponse {
  return parseWithSchema(ExtensionAgentTaskStartResponseSchema, value);
}

export function safeParseExtensionAgentTaskCancelResponse(value: unknown): SafeParseResult<ExtensionAgentTaskCancelResponse> {
  return safeParseWithSchema(ExtensionAgentTaskCancelResponseSchema, value);
}

export function parseExtensionAgentTaskCancelResponse(value: unknown): ExtensionAgentTaskCancelResponse {
  return parseWithSchema(ExtensionAgentTaskCancelResponseSchema, value);
}

export function formatExtensionAgentTaskSchemaError(result: SafeParseResult<unknown>): string | undefined {
  return result.success ? undefined : formatSchemaError(result.error);
}
