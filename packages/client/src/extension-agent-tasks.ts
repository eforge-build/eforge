import { Type, type Static } from '@sinclair/typebox';
import { ExtensionJsonObjectSchema } from './extension-contributions.js';
import {
  EforgePlanPlanningBacklogCurationDraftSchema,
} from './extension-agent-tasks/backlog-curation.js';
import { EforgePlanPlanningPlanRevisionTurnSchema } from './extension-agent-tasks/plan-revision.js';
import {
  ExtensionAgentTaskActivityEntrySchema,
  ExtensionAgentTaskBacklogCurationProgressSchema,
  EXTENSION_AGENT_TASK_ACTIVITY_LOG_MAX_ENTRIES,
  extensionAgentTaskActivityTimestampError,
} from './extension-agent-tasks/task-metadata.js';
export * from './extension-agent-tasks/common.js';
export * from './extension-agent-tasks/backlog-curation.js';
export * from './extension-agent-tasks/backlog-curation-map-reduce.js';
export * from './extension-agent-tasks/plan-revision.js';
export * from './extension-agent-tasks/task-metadata.js';
import { formatSchemaError, parseWithSchema, safeParseWithSchema, type SafeParseResult } from './schema-utils.js';

export const EXTENSION_AGENT_TASK_KIND_EFORGE_PLAN_PLANNING_DRAFT = 'eforge-plan.planning-draft' as const;

export const ExtensionAgentTaskKindSchema = Type.Literal(EXTENSION_AGENT_TASK_KIND_EFORGE_PLAN_PLANNING_DRAFT);

export const ExtensionAgentTaskStatusSchema = Type.Union([Type.Literal('queued'), Type.Literal('running'), Type.Literal('completed'), Type.Literal('failed'), Type.Literal('cancelled')]);

export const ExtensionAgentTaskRequestedBySchema = Type.Object({
  host: Type.Union([Type.Literal('console'), Type.Literal('pi'), Type.Literal('claude'), Type.Literal('mcp'), Type.Literal('cli')]),
  surface: Type.Optional(Type.String()),
  sessionId: Type.Optional(Type.String()),
}, { additionalProperties: false });

export const EforgePlanPlanningRequestedOutputSectionSchema = Type.Union([
  Type.Literal('recommendations'),
  Type.Literal('handoffDrafts'),
  Type.Literal('planDrafts'),
  Type.Literal('sessionPlanPatch'),
  // --- eforge:region session-plan-creation-draft ---
  Type.Literal('sessionPlanCreationDraft'),
  // --- eforge:endregion session-plan-creation-draft ---
  // --- eforge:region backlog-curation-draft ---
  Type.Literal('backlogCurationDraft'),
  // --- eforge:endregion backlog-curation-draft ---
  // --- eforge:region client-engine-task-contract ---
  Type.Literal('planRevisionTurn'),
  // --- eforge:endregion client-engine-task-contract ---
]);

export const EXTENSION_AGENT_TASK_ID_PATTERN = '^[A-Za-z0-9._-]{1,128}$' as const;
export const EXTENSION_AGENT_TASK_CONTRIBUTION_REF_ID_PATTERN = '^(?:[A-Za-z0-9._:-]{1,128}|(?=.{1,256}$)(?!.*[/\\\\\\u0000-\\u001F\\u007F-\\u009F])(?!(?:\\.|\\.\\.):).+:[a-z][a-z0-9-]{0,63})$' as const;
export const SESSION_PLAN_ID_PATTERN = '^[a-z0-9]+(?:-[a-z0-9]+)*$' as const;
export const ExtensionAgentTaskIdSchema = Type.String({ minLength: 1, maxLength: 128, pattern: EXTENSION_AGENT_TASK_ID_PATTERN });
export const EforgeSessionPlanIdSchema = Type.String({ minLength: 1, pattern: SESSION_PLAN_ID_PATTERN });
export const ExtensionAgentTaskContributionRefSchema = Type.Object({
  id: Type.String({ minLength: 1, maxLength: 256, pattern: EXTENSION_AGENT_TASK_CONTRIBUTION_REF_ID_PATTERN }),
  extensionName: Type.Optional(Type.String({ minLength: 1, pattern: '\\S' })),
}, { additionalProperties: false });
export const EforgePlanPlanningTopicSchema = Type.String({ minLength: 1, pattern: '\\S' });

export const EforgePlanPlanningSourceProviderSchema = Type.Object({
  module: Type.String({ minLength: 1, pattern: '\\S' }),
  exportName: Type.Optional(Type.String({ minLength: 1, pattern: '\\S' })),
  input: Type.Optional(Type.Object({}, { additionalProperties: true })),
}, { additionalProperties: false });

// --- eforge:region session-plan-creation-readiness ---
export const EforgePlanPlanningTypeSchema = Type.Union([Type.Literal('bugfix'), Type.Literal('feature'), Type.Literal('refactor'), Type.Literal('architecture'), Type.Literal('docs'), Type.Literal('maintenance'), Type.Literal('unknown')]);

export const EforgePlanPlanningDepthSchema = Type.Union([Type.Literal('quick'), Type.Literal('focused'), Type.Literal('deep')]);

export const EforgePlanPlanningCreationDraftDimensionIdSchema = Type.String({
  minLength: 1,
  pattern: '^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$',
});

export const EforgePlanPlanningSessionPlanCreationReadinessEntrySchema = Type.Object({
  requiredDimensions: Type.Array(EforgePlanPlanningCreationDraftDimensionIdSchema),
  optionalDimensions: Type.Array(EforgePlanPlanningCreationDraftDimensionIdSchema),
}, { additionalProperties: false });

const EforgePlanPlanningSessionPlanCreationReadinessDepthsSchema = Type.Object({
  quick: EforgePlanPlanningSessionPlanCreationReadinessEntrySchema,
  focused: EforgePlanPlanningSessionPlanCreationReadinessEntrySchema,
  deep: EforgePlanPlanningSessionPlanCreationReadinessEntrySchema,
}, { additionalProperties: false });

export const EforgePlanPlanningSessionPlanCreationReadinessSchema = Type.Object({
  dimensionContract: Type.Object({
    bugfix: EforgePlanPlanningSessionPlanCreationReadinessDepthsSchema,
    feature: EforgePlanPlanningSessionPlanCreationReadinessDepthsSchema,
    refactor: EforgePlanPlanningSessionPlanCreationReadinessDepthsSchema,
    architecture: EforgePlanPlanningSessionPlanCreationReadinessDepthsSchema,
    docs: EforgePlanPlanningSessionPlanCreationReadinessDepthsSchema,
    maintenance: EforgePlanPlanningSessionPlanCreationReadinessDepthsSchema,
    unknown: EforgePlanPlanningSessionPlanCreationReadinessDepthsSchema,
  }, { additionalProperties: false }),
  resolved: Type.Optional(Type.Object({
    planningType: EforgePlanPlanningTypeSchema,
    planningDepth: EforgePlanPlanningDepthSchema,
    requiredDimensions: Type.Array(EforgePlanPlanningCreationDraftDimensionIdSchema),
    optionalDimensions: Type.Array(EforgePlanPlanningCreationDraftDimensionIdSchema),
  }, { additionalProperties: false })),
}, { additionalProperties: false });
// --- eforge:endregion session-plan-creation-readiness ---

export const EforgePlanPlanningDraftInputSchema = Type.Object({
  topic: EforgePlanPlanningTopicSchema,
  session: Type.Optional(Type.String()),
  planningType: Type.Optional(Type.String()),
  planningDepth: Type.Optional(Type.String()),
  sourceText: Type.Optional(Type.String()),
  sourceProvider: Type.Optional(EforgePlanPlanningSourceProviderSchema),
  existingSessionPlan: Type.Optional(Type.String()),
  requestedOutputSections: Type.Optional(Type.Array(EforgePlanPlanningRequestedOutputSectionSchema, { minItems: 1 })),
  // --- eforge:region session-plan-creation-readiness ---
  sessionPlanCreationReadiness: Type.Optional(EforgePlanPlanningSessionPlanCreationReadinessSchema),
  // --- eforge:endregion session-plan-creation-readiness ---
  includeRoadmap: Type.Optional(Type.Boolean()),
}, { additionalProperties: false });

export const EforgePlanPlanningPlanDraftSchema = Type.Object({
  title: Type.String(),
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
export const EforgePlanPlanningSessionPlanCreationDraftSchema = Type.Object({
  session: EforgeSessionPlanIdSchema,
  topic: Type.String({ minLength: 1, pattern: '\\S' }),
  planningType: EforgePlanPlanningTypeSchema,
  planningDepth: EforgePlanPlanningDepthSchema,
  profile: Type.Optional(Type.Union([Type.Literal('errand'), Type.Literal('excursion'), Type.Literal('expedition')])),
  agentProfile: Type.Optional(Type.String()),
  sections: Type.Array(Type.Object({
    dimension: EforgePlanPlanningCreationDraftDimensionIdSchema,
    content: Type.String(),
  }, { additionalProperties: false }), { minItems: 1 }),
  skippedDimensions: Type.Optional(Type.Array(Type.Object({
    dimension: EforgePlanPlanningCreationDraftDimensionIdSchema,
    reason: Type.String(),
  }, { additionalProperties: false }))),
}, { additionalProperties: false });

export const EforgePlanPlanningClarificationQuestionSchema = Type.Object({
  question: Type.String({ minLength: 1, pattern: '\\S' }),
  why: Type.Optional(Type.String()),
  options: Type.Optional(Type.Array(Type.String())),
}, { additionalProperties: false });

export const EforgePlanPlanningDecisionSchema = Type.Union([Type.Literal('ready'), Type.Literal('needs-input')]);

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


export const EforgePlanPlanningHandoffDraftSchema = Type.Object({
  selection: Type.Object({}, { additionalProperties: true }),
  session: Type.Optional(Type.String()),
  title: Type.Optional(Type.String()),
  profile: Type.Optional(Type.Union([Type.Literal('errand'), Type.Literal('excursion'), Type.Literal('expedition')])),
}, { additionalProperties: false });

const eforgePlanPlanningDraftResultCommonFields = {
  summary: Type.String(),
  assumptionsOpenQuestions: Type.Array(Type.String()),
  nextSteps: Type.Optional(Type.Array(Type.String())),
} as const;

const eforgePlanPlanningDraftResultOutputFields = {
  recommendations: Type.Optional(EforgePlanPlanningRecommendationsSchema),
  // --- eforge:region backlog-curation-draft ---
  backlogCurationDraft: Type.Optional(EforgePlanPlanningBacklogCurationDraftSchema),
  // --- eforge:endregion backlog-curation-draft ---
  handoffDraft: Type.Optional(EforgePlanPlanningHandoffDraftSchema),
  handoffDrafts: Type.Optional(Type.Array(EforgePlanPlanningHandoffDraftSchema, { minItems: 1 })),
  // --- eforge:region client-engine-task-contract ---
  planRevisionTurn: Type.Optional(EforgePlanPlanningPlanRevisionTurnSchema),
  // --- eforge:endregion client-engine-task-contract ---
} as const;

const eforgePlanPlanningDraftResultBaseFields = {
  ...eforgePlanPlanningDraftResultCommonFields,
  ...eforgePlanPlanningDraftResultOutputFields,
} as const;

export const EforgePlanPlanningDraftResultBaseSchema = Type.Object(eforgePlanPlanningDraftResultBaseFields, { additionalProperties: false });

const EforgePlanPlanningLegacySessionPlanCreationDraftSchema = Type.Object({
  session: Type.String({ minLength: 1, pattern: '\\S' }),
  topic: Type.String({ minLength: 1, pattern: '\\S' }),
  planningType: EforgePlanPlanningTypeSchema,
  planningDepth: EforgePlanPlanningDepthSchema,
  profile: Type.Optional(Type.Union([Type.Literal('errand'), Type.Literal('excursion'), Type.Literal('expedition')])),
  agentProfile: Type.Optional(Type.String()),
  sections: Type.Array(Type.Object({
    dimension: Type.String({ minLength: 1 }),
    content: Type.String(),
  }, { additionalProperties: false }), { minItems: 1 }),
  skippedDimensions: Type.Optional(Type.Array(Type.Object({
    dimension: Type.String({ minLength: 1 }),
    reason: Type.String(),
  }, { additionalProperties: false }))),
}, { additionalProperties: false });

const EforgePlanPlanningLegacyCreationDraftRecordResultSchema = Type.Object({
  ...eforgePlanPlanningDraftResultBaseFields,
  decision: Type.Literal('ready'),
  sessionPlanCreationDraft: EforgePlanPlanningLegacySessionPlanCreationDraftSchema,
  planDrafts: Type.Optional(Type.Array(EforgePlanPlanningPlanDraftSchema, { minItems: 1 })),
  sessionPlanPatch: Type.Optional(EforgePlanPlanningSessionPlanPatchSchema),
}, { additionalProperties: false });

export const EforgePlanPlanningDraftResultSchema = Type.Union([
  // --- eforge:region client-engine-task-contract ---
  Type.Object({
    ...eforgePlanPlanningDraftResultBaseFields,
    planRevisionTurn: EforgePlanPlanningPlanRevisionTurnSchema,
    planDrafts: Type.Optional(Type.Array(EforgePlanPlanningPlanDraftSchema, { minItems: 1 })),
    sessionPlanPatch: Type.Optional(EforgePlanPlanningSessionPlanPatchSchema),
  }, { additionalProperties: false }),
  // --- eforge:endregion client-engine-task-contract ---
  // --- eforge:region backlog-curation-draft ---
  Type.Object({
    ...eforgePlanPlanningDraftResultBaseFields,
    backlogCurationDraft: EforgePlanPlanningBacklogCurationDraftSchema,
    planDrafts: Type.Optional(Type.Array(EforgePlanPlanningPlanDraftSchema, { minItems: 1 })),
    sessionPlanPatch: Type.Optional(EforgePlanPlanningSessionPlanPatchSchema),
  }, { additionalProperties: false }),
  // --- eforge:endregion backlog-curation-draft ---
  Type.Object({
    ...eforgePlanPlanningDraftResultBaseFields,
    recommendations: EforgePlanPlanningRecommendationsSchema,
    planDrafts: Type.Optional(Type.Array(EforgePlanPlanningPlanDraftSchema, { minItems: 1 })),
    sessionPlanPatch: Type.Optional(EforgePlanPlanningSessionPlanPatchSchema),
  }, { additionalProperties: false }),
  Type.Object({
    ...eforgePlanPlanningDraftResultBaseFields,
    handoffDraft: EforgePlanPlanningHandoffDraftSchema,
    planDrafts: Type.Optional(Type.Array(EforgePlanPlanningPlanDraftSchema, { minItems: 1 })),
    sessionPlanPatch: Type.Optional(EforgePlanPlanningSessionPlanPatchSchema),
  }, { additionalProperties: false }),
  Type.Object({
    ...eforgePlanPlanningDraftResultBaseFields,
    handoffDrafts: Type.Array(EforgePlanPlanningHandoffDraftSchema, { minItems: 1 }),
    planDrafts: Type.Optional(Type.Array(EforgePlanPlanningPlanDraftSchema, { minItems: 1 })),
    sessionPlanPatch: Type.Optional(EforgePlanPlanningSessionPlanPatchSchema),
  }, { additionalProperties: false }),
  Type.Object({
    ...eforgePlanPlanningDraftResultBaseFields,
    planDrafts: Type.Array(EforgePlanPlanningPlanDraftSchema, { minItems: 1 }),
    sessionPlanPatch: Type.Optional(EforgePlanPlanningSessionPlanPatchSchema),
  }, { additionalProperties: false }),
  Type.Object({
    ...eforgePlanPlanningDraftResultBaseFields,
    planDrafts: Type.Optional(Type.Array(EforgePlanPlanningPlanDraftSchema, { minItems: 1 })),
    sessionPlanPatch: EforgePlanPlanningSessionPlanPatchSchema,
  }, { additionalProperties: false }),
  // --- eforge:region session-plan-creation-draft ---
  Type.Object({
    ...eforgePlanPlanningDraftResultBaseFields,
    decision: Type.Literal('ready'),
    sessionPlanCreationDraft: EforgePlanPlanningSessionPlanCreationDraftSchema,
    planDrafts: Type.Optional(Type.Array(EforgePlanPlanningPlanDraftSchema, { minItems: 1 })),
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

const EforgePlanPlanningStoredDraftResultSchema = Type.Union([
  EforgePlanPlanningDraftResultSchema,
  EforgePlanPlanningLegacyCreationDraftRecordResultSchema,
]);

export const ExtensionAgentTaskLegacyStartRequestSchema = Type.Object({
  kind: ExtensionAgentTaskKindSchema,
  input: EforgePlanPlanningDraftInputSchema,
  requestedBy: Type.Optional(ExtensionAgentTaskRequestedBySchema),
}, { additionalProperties: false });

export const ExtensionAgentTaskContributionStartRequestSchema = Type.Object({
  task: ExtensionAgentTaskContributionRefSchema,
  input: ExtensionJsonObjectSchema,
  requestedBy: Type.Optional(ExtensionAgentTaskRequestedBySchema),
}, { additionalProperties: false });

export const ExtensionAgentTaskStartRequestSchema = Type.Union([
  ExtensionAgentTaskContributionStartRequestSchema,
  ExtensionAgentTaskLegacyStartRequestSchema,
]);

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
  backlogCurationProgress: Type.Optional(ExtensionAgentTaskBacklogCurationProgressSchema),
  activityLog: Type.Optional(Type.Array(ExtensionAgentTaskActivityEntrySchema, { maxItems: EXTENSION_AGENT_TASK_ACTIVITY_LOG_MAX_ENTRIES })),
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
    result: EforgePlanPlanningStoredDraftResultSchema,
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
export type ExtensionAgentTaskContributionRef = Static<typeof ExtensionAgentTaskContributionRefSchema>;
export type EforgePlanPlanningRequestedOutputSection = Static<typeof EforgePlanPlanningRequestedOutputSectionSchema>;
export type EforgePlanPlanningDraftInput = Static<typeof EforgePlanPlanningDraftInputSchema>;
export type EforgePlanPlanningPlanDraft = Static<typeof EforgePlanPlanningPlanDraftSchema>;
export type EforgePlanPlanningSessionPlanPatch = Static<typeof EforgePlanPlanningSessionPlanPatchSchema>;
export type EforgePlanPlanningSessionPlanCreationDraft = Static<typeof EforgePlanPlanningSessionPlanCreationDraftSchema>;
// --- eforge:region session-plan-creation-readiness ---
export type EforgePlanPlanningSessionPlanCreationReadiness = Static<typeof EforgePlanPlanningSessionPlanCreationReadinessSchema>;
// --- eforge:endregion session-plan-creation-readiness ---
export type EforgePlanPlanningClarificationQuestion = Static<typeof EforgePlanPlanningClarificationQuestionSchema>;
export type EforgePlanPlanningDecision = Static<typeof EforgePlanPlanningDecisionSchema>;
export type EforgePlanPlanningSectionProgress = Static<typeof EforgePlanPlanningSectionProgressSchema>;
export type EforgePlanPlanningRecommendations = Static<typeof EforgePlanPlanningRecommendationsSchema>;
export type EforgePlanPlanningHandoffDraft = Static<typeof EforgePlanPlanningHandoffDraftSchema>;
export type EforgePlanPlanningDraftResult = Static<typeof EforgePlanPlanningDraftResultSchema>;
export type ExtensionAgentTaskLegacyStartRequest = Static<typeof ExtensionAgentTaskLegacyStartRequestSchema>;
export type ExtensionAgentTaskContributionStartRequest = Static<typeof ExtensionAgentTaskContributionStartRequestSchema>;
export type ExtensionAgentTaskStartRequest = Static<typeof ExtensionAgentTaskStartRequestSchema>;
export type ExtensionAgentTaskGetRequest = Static<typeof ExtensionAgentTaskGetRequestSchema>;
export type ExtensionAgentTaskCancelRequest = Static<typeof ExtensionAgentTaskCancelRequestSchema>;
export type ExtensionAgentTaskSanitizedMetadata = Static<typeof ExtensionAgentTaskSanitizedMetadataSchema>;
export type ExtensionAgentTaskRecord = Static<typeof ExtensionAgentTaskRecordSchema>;
export type ExtensionAgentTaskStartResponse = Static<typeof ExtensionAgentTaskStartResponseSchema>;
export type ExtensionAgentTaskGetResponse = Static<typeof ExtensionAgentTaskGetResponseSchema>;
export type ExtensionAgentTaskCancelResponse = Static<typeof ExtensionAgentTaskCancelResponseSchema>;

export function legacyExtensionAgentTaskStartToContributionRef(request: ExtensionAgentTaskLegacyStartRequest): ExtensionAgentTaskContributionStartRequest {
  const separator = request.kind.indexOf('.');
  const extensionName = separator > 0 ? request.kind.slice(0, separator) : request.kind;
  const id = separator > 0 ? request.kind.slice(separator + 1) : request.kind;
  return { task: { extensionName, id }, input: request.input, ...(request.requestedBy !== undefined && { requestedBy: request.requestedBy }) };
}

export function normalizeExtensionAgentTaskStartRequest(request: ExtensionAgentTaskStartRequest): ExtensionAgentTaskContributionStartRequest { return 'task' in request ? request : legacyExtensionAgentTaskStartToContributionRef(request); }

export function hasEforgePlanPlanningDraftOutputSection(value: EforgePlanPlanningDraftResult): boolean {
  const candidate = value as Record<string, unknown>;
  if (candidate.decision === 'ready' && candidate.sessionPlanCreationDraft !== undefined) return true;
  if (candidate.backlogCurationDraft !== undefined) return true;
  // --- eforge:region client-engine-task-contract ---
  if (candidate.planRevisionTurn !== undefined) return true;
  // --- eforge:endregion client-engine-task-contract ---
  return candidate.recommendations !== undefined
    || candidate.handoffDraft !== undefined
    || (Array.isArray(candidate.handoffDrafts) && candidate.handoffDrafts.length > 0)
    || (Array.isArray(candidate.planDrafts) && candidate.planDrafts.length > 0)
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
  const result = safeParseWithSchema(ExtensionAgentTaskRecordSchema, value);
  if (!result.success) return result;
  const timestampError = extensionAgentTaskActivityTimestampError(result.data);
  return timestampError === undefined ? result : { success: false, error: timestampError };
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
  const result = safeParseWithSchema(ExtensionAgentTaskGetResponseSchema, value);
  if (!result.success) return result;
  const timestampError = extensionAgentTaskActivityTimestampError(result.data.task, '/task');
  return timestampError === undefined ? result : { success: false, error: timestampError };
}

export function parseExtensionAgentTaskGetResponse(value: unknown): ExtensionAgentTaskGetResponse {
  const result = safeParseExtensionAgentTaskGetResponse(value);
  if (result.success) return result.data;
  throw new Error(formatSchemaError(result.error));
}

export function safeParseExtensionAgentTaskStartResponse(value: unknown): SafeParseResult<ExtensionAgentTaskStartResponse> {
  const result = safeParseWithSchema(ExtensionAgentTaskStartResponseSchema, value);
  if (!result.success) return result;
  const timestampError = extensionAgentTaskActivityTimestampError(result.data.task, '/task');
  return timestampError === undefined ? result : { success: false, error: timestampError };
}

export function parseExtensionAgentTaskStartResponse(value: unknown): ExtensionAgentTaskStartResponse {
  const result = safeParseExtensionAgentTaskStartResponse(value);
  if (result.success) return result.data;
  throw new Error(formatSchemaError(result.error));
}

export function safeParseExtensionAgentTaskCancelResponse(value: unknown): SafeParseResult<ExtensionAgentTaskCancelResponse> {
  const result = safeParseWithSchema(ExtensionAgentTaskCancelResponseSchema, value);
  if (!result.success) return result;
  const timestampError = extensionAgentTaskActivityTimestampError(result.data.task, '/task');
  return timestampError === undefined ? result : { success: false, error: timestampError };
}

export function parseExtensionAgentTaskCancelResponse(value: unknown): ExtensionAgentTaskCancelResponse {
  const result = safeParseExtensionAgentTaskCancelResponse(value);
  if (result.success) return result.data;
  throw new Error(formatSchemaError(result.error));
}

export function formatExtensionAgentTaskSchemaError(result: SafeParseResult<unknown>): string | undefined {
  return result.success ? undefined : formatSchemaError(result.error);
}
