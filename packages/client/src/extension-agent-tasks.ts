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

const eforgePlanPlanningDraftResultBaseFields = {
  summary: Type.String(),
  assumptionsOpenQuestions: Type.Array(Type.String()),
  nextSteps: Type.Optional(Type.Array(Type.String())),
  recommendations: Type.Optional(EforgePlanPlanningRecommendationsSchema),
  handoffDraft: Type.Optional(EforgePlanPlanningHandoffDraftSchema),
  handoffDrafts: Type.Optional(Type.Array(EforgePlanPlanningHandoffDraftSchema, { minItems: 1 })),
} as const;

export const EforgePlanPlanningDraftResultBaseSchema = Type.Object(eforgePlanPlanningDraftResultBaseFields, { additionalProperties: false });

export const EforgePlanPlanningDraftResultSchema = Type.Union([
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
export type EforgePlanPlanningRecommendations = Static<typeof EforgePlanPlanningRecommendationsSchema>;
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
  return value.recommendations !== undefined || value.handoffDraft !== undefined || (value.handoffDrafts?.length ?? 0) > 0 || (value.planDrafts?.length ?? 0) > 0 || value.playbookDraft !== undefined || value.sessionPlanPatch !== undefined;
}

export function safeParseEforgePlanPlanningDraftResult(value: unknown): SafeParseResult<EforgePlanPlanningDraftResult> {
  return safeParseWithSchema(EforgePlanPlanningDraftResultSchema, value);
}

export function parseEforgePlanPlanningDraftResult(value: unknown): EforgePlanPlanningDraftResult {
  return parseWithSchema(EforgePlanPlanningDraftResultSchema, value);
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
  return parseWithSchema(ExtensionAgentTaskRecordSchema, value);
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
