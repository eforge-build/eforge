import { Type, type Static } from '@eforge-build/extension-sdk';
import {
  EforgePlanPlanningRequestedOutputSectionSchema,
  ExtensionAgentTaskCancelResponseSchema,
  ExtensionAgentTaskGetResponseSchema,
  ExtensionAgentTaskIdSchema,
  ExtensionAgentTaskRecordSchema,
  ExtensionAgentTaskStartResponseSchema,
  ExtensionAgentTaskStatusSchema,
} from '@eforge-build/client';
import {
  JsonValueSchema,
  PlanningProfileSchema,
  PromotionSelectionInputSchema,
  PromotionSelectionOutputSchema,
  PutRecommendationsOutputSchema,
  PlanSourceRefsSchema,
  PLANNING_DEPTHS,
  PLANNING_TYPES,
} from './schema.js';
import { SessionPlanReadinessDetailSchema } from './session-plan-schemas.js';
import { BacklogCurationApplyDetailsSchema, BacklogCurationPreviewDetailsSchema, BacklogCurationScanModeSchema } from './backlog-curation-schemas.js';

const JsonObjectAdditionalProperties = { additionalProperties: JsonValueSchema } as const;

const PlanningTypeLiteralSchemas = PLANNING_TYPES.map((value) => Type.Literal(value)) as [ReturnType<typeof Type.Literal>, ...Array<ReturnType<typeof Type.Literal>>];
const PlanningDepthLiteralSchemas = PLANNING_DEPTHS.map((value) => Type.Literal(value)) as [ReturnType<typeof Type.Literal>, ...Array<ReturnType<typeof Type.Literal>>];

// Requested output sections now allow the session-plan creation draft variant so
// AI promotion of selected backlog work can default to a full plan draft.
export const PlanningAgentRequestedOutputSectionSchema = EforgePlanPlanningRequestedOutputSectionSchema;
export const StartPlanningAgentRequestedOutputSectionSchema = Type.Union([
  Type.Literal('recommendations'),
  Type.Literal('handoffDrafts'),
  Type.Literal('planDrafts'),
  Type.Literal('playbookDraft'),
  Type.Literal('sessionPlanPatch'),
  Type.Literal('sessionPlanCreationDraft'),
]);
export const MAX_PLANNING_AGENT_USER_GOAL_LENGTH = 4000;
const MAX_PLAN_REVISION_LIST_LIMIT = 100;
const DEFAULT_PLAN_REVISION_LIST_LIMIT = 50;
const MAX_PLAN_REVISION_ANSWER_COUNT = 20;
const MAX_PLAN_REVISION_ANSWER_LENGTH = 4000;
const MAX_PLAN_REVISION_PROMPT_LENGTH = 2000;
const MAX_PLAN_REVISION_REASON_LENGTH = 1000;
export const MAX_PLAN_REVISION_ANNOTATIONS_PER_SESSION = 100;
export const MAX_PLAN_REVISION_ANNOTATION_BODY_LENGTH = 4000;
export const MAX_PLAN_REVISION_ANNOTATION_TEXT_LENGTH = 6000;
export const MAX_PLAN_REVISION_ANNOTATION_CONTEXT_LENGTH = 1000;
export const MAX_PLAN_REVISION_ANNOTATION_LABEL_LENGTH = 200;
export const MAX_PLAN_REVISION_STEERING_LENGTH = 4000;

export const StartPlanningAgentTaskInputSchema = Type.Object({
  userGoal: Type.Optional(Type.String({ minLength: 1, maxLength: MAX_PLANNING_AGENT_USER_GOAL_LENGTH, pattern: '\\S' })),
  itemIds: Type.Optional(Type.Array(Type.String(), { minItems: 1, uniqueItems: true })),
  epicId: Type.Optional(Type.String()),
  recommendationRef: Type.Optional(Type.String()),
  sourceRecommendationRef: Type.Optional(Type.String()),
  includeRoadmap: Type.Optional(Type.Boolean()),
  session: Type.Optional(Type.String()),
  planningType: Type.Optional(Type.Union(PlanningTypeLiteralSchemas)),
  planningDepth: Type.Optional(Type.Union(PlanningDepthLiteralSchemas)),
  requestedOutputSections: Type.Optional(Type.Array(StartPlanningAgentRequestedOutputSectionSchema, { minItems: 1 })),
}, { additionalProperties: false, not: { anyOf: [{ required: ['itemIds', 'epicId'] }, { required: ['itemIds', 'recommendationRef'] }, { required: ['epicId', 'recommendationRef'] }] } });

export const GetPlanningAgentTaskInputSchema = Type.Object({ taskId: ExtensionAgentTaskIdSchema }, { additionalProperties: false });
export const PreviewBacklogCurationTaskInputSchema = Type.Object({ taskId: ExtensionAgentTaskIdSchema }, { additionalProperties: false });
export const PreviewBacklogCurationTaskOutputSchema = BacklogCurationPreviewDetailsSchema;
export const CancelPlanningAgentTaskInputSchema = Type.Object({ taskId: ExtensionAgentTaskIdSchema, reason: Type.Optional(Type.String()) }, { additionalProperties: false });

export const ApplyPlanningAgentTaskHandoffSelectionSchema = Type.Object({ index: Type.Optional(Type.Integer({ minimum: 0 })), selection: Type.Optional(PromotionSelectionInputSchema), session: Type.Optional(Type.String()), title: Type.Optional(Type.String()), profile: Type.Optional(PlanningProfileSchema) }, { additionalProperties: false });
export const ApplyPlanningAgentTaskSessionPlanDraftSchema = Type.Object({ session: Type.String(), sections: Type.Array(Type.String(), { minItems: 1, uniqueItems: true }) }, { additionalProperties: false });

// Explicit creation-draft apply selection. The generated draft carries the
// session, topic, planning type/depth, and sections; these optional fields let
// the caller retarget the session and supply profile/agentProfile/openQuestions
// metadata that the draft does not include.
export const ApplyPlanningAgentTaskCreationDraftSelectionSchema = Type.Object({
  session: Type.Optional(Type.String()),
  profile: Type.Optional(Type.Union([PlanningProfileSchema, Type.Null()])),
  agentProfile: Type.Optional(Type.Union([Type.String(), Type.Null()])),
  openQuestions: Type.Optional(Type.Array(Type.String())),
}, { additionalProperties: false });

export const ApplyPlanningAgentTaskBacklogCurationSelectionSchema = Type.Object({
  previewAcknowledged: Type.Literal(true),
  confirmApply: Type.Literal(true),
  // --- eforge:region recommendation-validation ---
  applyCurationOnly: Type.Optional(Type.Literal(true)),
  // --- eforge:endregion recommendation-validation ---
}, { additionalProperties: false });

export const ApplyPlanningAgentTaskResultInputSchema = Type.Object({
  taskId: ExtensionAgentTaskIdSchema,
  applyRecommendations: Type.Optional(Type.Boolean()),
  applyHandoffDrafts: Type.Optional(Type.Array(ApplyPlanningAgentTaskHandoffSelectionSchema, { minItems: 1 })),
  applySessionPlanDrafts: Type.Optional(Type.Array(ApplyPlanningAgentTaskSessionPlanDraftSchema, { minItems: 1 })),
  applySessionPlanCreationDraft: Type.Optional(ApplyPlanningAgentTaskCreationDraftSelectionSchema),
  applyBacklogCurationDraft: Type.Optional(ApplyPlanningAgentTaskBacklogCurationSelectionSchema),
}, { additionalProperties: false });

Object.assign(ApplyPlanningAgentTaskResultInputSchema, {
  anyOf: [
    { properties: { applyRecommendations: { const: true } }, required: ['applyRecommendations'] },
    { required: ['applyHandoffDrafts'] },
    { required: ['applySessionPlanDrafts'] },
    { required: ['applySessionPlanCreationDraft'] },
    { required: ['applyBacklogCurationDraft'] },
  ],
  not: {
    anyOf: [
      { properties: { applyRecommendations: { const: true } }, required: ['applyBacklogCurationDraft', 'applyRecommendations'] },
      { required: ['applyBacklogCurationDraft', 'applyHandoffDrafts'] },
      { required: ['applyBacklogCurationDraft', 'applySessionPlanDrafts'] },
      { required: ['applyBacklogCurationDraft', 'applySessionPlanCreationDraft'] },
    ],
  },
});

export const AppliedSessionPlanCreationDraftSourceRefsSchema = PlanSourceRefsSchema;

export const AppliedSessionPlanCreationDraftSchema = Type.Object({
  session: Type.String(),
  relativePath: Type.String(),
  readiness: SessionPlanReadinessDetailSchema,
  sourceRefs: Type.Optional(AppliedSessionPlanCreationDraftSourceRefsSchema),
  traceItemIds: Type.Optional(Type.Array(Type.String())),
}, JsonObjectAdditionalProperties);

export const PlanningAgentTaskStartOutputSchema = ExtensionAgentTaskStartResponseSchema;
export const PlanningAgentTaskGetOutputSchema = ExtensionAgentTaskGetResponseSchema;
export const PlanningAgentTaskCancelOutputSchema = ExtensionAgentTaskCancelResponseSchema;

export const ApplyPlanningAgentTaskResultOutputSchema = Type.Object({
  schemaVersion: Type.Literal(1),
  taskId: ExtensionAgentTaskIdSchema,
  applied: Type.Object({ recommendations: Type.Boolean(), handoffDrafts: Type.Number(), sessionPlanSections: Type.Number(), backlogCuration: Type.Optional(Type.Number()) }, { additionalProperties: false }),
  recommendations: Type.Optional(PutRecommendationsOutputSchema),
  handoffs: Type.Optional(Type.Array(PromotionSelectionOutputSchema)),
  sessionPlanDrafts: Type.Optional(Type.Array(Type.Object({ session: Type.String(), sections: Type.Array(Type.String()) }, JsonObjectAdditionalProperties))),
  sessionPlanCreationDraft: Type.Optional(AppliedSessionPlanCreationDraftSchema),
  backlogCuration: Type.Optional(BacklogCurationApplyDetailsSchema),
}, JsonObjectAdditionalProperties);

// --- Durable planning task workflow index projections ---

export const PlanningTaskWorkflowSelectionSchema = Type.Object({
  itemIds: Type.Optional(Type.Array(Type.String())),
  epicId: Type.Optional(Type.String()),
  recommendationRef: Type.Optional(Type.String()),
  sourceRecommendationRef: Type.Optional(Type.String()),
}, { additionalProperties: false });

export const PlanningTaskWorkflowEntrySchema = Type.Object({
  taskId: ExtensionAgentTaskIdSchema,
  parentTaskId: Type.Optional(ExtensionAgentTaskIdSchema),
  originalRequest: Type.String(),
  derivedRequest: Type.String(),
  selection: PlanningTaskWorkflowSelectionSchema,
  requestedOutputSections: Type.Array(PlanningAgentRequestedOutputSectionSchema),
  session: Type.Optional(Type.String()),
  planningType: Type.Optional(Type.String()),
  planningDepth: Type.Optional(Type.String()),
  includeRoadmap: Type.Optional(Type.Boolean()),
  purpose: Type.Optional(Type.Union([Type.Literal('recommendation-refresh'), Type.Literal('backlog-curation')])),
  scanMode: Type.Optional(BacklogCurationScanModeSchema),
  sourceFingerprint: Type.Optional(Type.String()),
  appliedAt: Type.Optional(Type.String()),
  createdAt: Type.String(),
}, { additionalProperties: false });

export const PlanningTaskWorkflowIndexSchema = Type.Object({
  schemaVersion: Type.Literal(1),
  entries: Type.Array(PlanningTaskWorkflowEntrySchema),
}, { additionalProperties: false });

export const ListPlanningAgentTasksInputSchema = Type.Object({}, { additionalProperties: false });

export const PlanningAgentTaskListItemSchema = Type.Object({
  entry: PlanningTaskWorkflowEntrySchema,
  available: Type.Boolean(),
  status: Type.Optional(ExtensionAgentTaskStatusSchema),
  task: Type.Optional(ExtensionAgentTaskRecordSchema),
  staleReason: Type.Optional(Type.String()),
}, JsonObjectAdditionalProperties);

export const ListPlanningAgentTasksOutputSchema = Type.Object({
  tasks: Type.Array(PlanningAgentTaskListItemSchema),
}, JsonObjectAdditionalProperties);

export const RetryPlanningAgentTaskInputSchema = Type.Object({
  taskId: ExtensionAgentTaskIdSchema,
  userGoal: Type.Optional(Type.String({ minLength: 1, maxLength: MAX_PLANNING_AGENT_USER_GOAL_LENGTH, pattern: '\\S' })),
}, { additionalProperties: false });

export const RemovePlanningAgentTaskInputSchema = Type.Object({
  taskId: ExtensionAgentTaskIdSchema,
}, { additionalProperties: false });

export const RemovePlanningAgentTaskOutputSchema = Type.Object({
  taskId: ExtensionAgentTaskIdSchema,
  removed: Type.Boolean(),
}, { additionalProperties: false });

export const RedraftPlanningAgentTaskInputSchema = Type.Object({
  taskId: ExtensionAgentTaskIdSchema,
  answers: Type.Optional(Type.Array(Type.String(), { minItems: 1 })),
  steering: Type.Optional(Type.String({ minLength: 1, pattern: '\\S' })),
}, { additionalProperties: false, anyOf: [{ required: ['answers'] }, { required: ['steering'] }] });

export const PlanningAgentTaskWorkflowStartOutputSchema = Type.Object({
  task: ExtensionAgentTaskRecordSchema,
  entry: PlanningTaskWorkflowEntrySchema,
}, JsonObjectAdditionalProperties);

const NonEmptyStringSchema = Type.String({ minLength: 1, pattern: '\\S' });
const Sha256HexSchema = Type.String({ pattern: '^[a-f0-9]{64}$' });

export const PlanRevisionBaseSectionHashSchema = Type.Object({ dimension: NonEmptyStringSchema, sha256: Sha256HexSchema }, { additionalProperties: false });
export const PlanRevisionAnnotationTargetKindSchema = Type.Union([Type.Literal('selection'), Type.Literal('block'), Type.Literal('section'), Type.Literal('whole-plan')]);
export const PlanRevisionAnnotationQuoteContextSchema = Type.Object({ exact: Type.String({ minLength: 1, maxLength: MAX_PLAN_REVISION_ANNOTATION_TEXT_LENGTH, pattern: '\\S' }), prefix: Type.Optional(Type.String({ maxLength: MAX_PLAN_REVISION_ANNOTATION_CONTEXT_LENGTH })), suffix: Type.Optional(Type.String({ maxLength: MAX_PLAN_REVISION_ANNOTATION_CONTEXT_LENGTH })) }, { additionalProperties: false });
export const PlanRevisionAnnotationTargetSchema = Type.Object({ kind: PlanRevisionAnnotationTargetKindSchema, dimension: Type.Optional(Type.String({ minLength: 1, maxLength: MAX_PLAN_REVISION_ANNOTATION_LABEL_LENGTH, pattern: '\\S' })), label: Type.Optional(Type.String({ minLength: 1, maxLength: MAX_PLAN_REVISION_ANNOTATION_LABEL_LENGTH, pattern: '\\S' })), capturedText: Type.String({ minLength: 1, maxLength: MAX_PLAN_REVISION_ANNOTATION_TEXT_LENGTH, pattern: '\\S' }), quoteContext: PlanRevisionAnnotationQuoteContextSchema }, { additionalProperties: false });
export const PlanRevisionAnnotationSchema = Type.Object({ annotationId: NonEmptyStringSchema, targetSession: NonEmptyStringSchema, body: Type.Optional(Type.String({ maxLength: MAX_PLAN_REVISION_ANNOTATION_BODY_LENGTH })), target: PlanRevisionAnnotationTargetSchema, createdAt: Type.String(), updatedAt: Type.String(), resolvedAt: Type.Optional(Type.String()), resolvedByTurnId: Type.Optional(NonEmptyStringSchema), dismissedAt: Type.Optional(Type.String()) }, { additionalProperties: false });
export const PlanRevisionTurnSnapshotAnnotationSchema = Type.Object({ annotationId: NonEmptyStringSchema, targetSession: NonEmptyStringSchema, body: Type.Optional(Type.String({ maxLength: MAX_PLAN_REVISION_ANNOTATION_BODY_LENGTH })), target: PlanRevisionAnnotationTargetSchema, createdAt: Type.String(), updatedAt: Type.String(), resolvedAt: Type.Optional(Type.String()), resolvedByTurnId: Type.Optional(NonEmptyStringSchema), dismissedAt: Type.Optional(Type.String()), snapshotAt: Type.String(), snapshotReason: Type.Union([Type.Literal('selected'), Type.Literal('open'), Type.Literal('selected-and-open')]) }, { additionalProperties: false });
export const PlanRevisionTurnAnnotationSnapshotSchema = Type.Object({ steering: Type.Optional(Type.String({ minLength: 1, maxLength: MAX_PLAN_REVISION_STEERING_LENGTH, pattern: '\\S' })), selectedAnnotationIds: Type.Array(NonEmptyStringSchema, { uniqueItems: true }), openAnnotationIds: Type.Array(NonEmptyStringSchema, { uniqueItems: true }), includeOpenAnnotations: Type.Boolean(), annotations: Type.Array(PlanRevisionTurnSnapshotAnnotationSchema) }, { additionalProperties: false });
export const PlanRevisionTurnEntrySchema = Type.Object({
  turnId: NonEmptyStringSchema,
  taskId: ExtensionAgentTaskIdSchema,
  userMessage: NonEmptyStringSchema,
  basePlanFingerprint: Sha256HexSchema,
  baseSectionHashes: Type.Array(PlanRevisionBaseSectionHashSchema),
  retryOfTaskId: Type.Optional(ExtensionAgentTaskIdSchema),
  redraftOfTaskId: Type.Optional(ExtensionAgentTaskIdSchema),
  parentTaskId: Type.Optional(ExtensionAgentTaskIdSchema),
  appliedAt: Type.Optional(Type.String()),
  appliedSections: Type.Optional(Type.Array(Type.String(), { uniqueItems: true })),
  createdAt: Type.String(),
  annotationSnapshot: Type.Optional(PlanRevisionTurnAnnotationSnapshotSchema),
}, { additionalProperties: false });
export const PlanRevisionSessionEntrySchema = Type.Object({ threadId: NonEmptyStringSchema, targetSession: NonEmptyStringSchema, turns: Type.Array(PlanRevisionTurnEntrySchema), annotations: Type.Array(PlanRevisionAnnotationSchema), dismissedAt: Type.Optional(Type.String()), createdAt: Type.String(), updatedAt: Type.String() }, { additionalProperties: false });
export const PlanRevisionIndexSchema = Type.Object({ schemaVersion: Type.Literal(1), sessions: Type.Array(PlanRevisionSessionEntrySchema) }, { additionalProperties: false });
export const PlanRevisionTurnProjectionSchema = Type.Object({
  turnId: NonEmptyStringSchema,
  taskId: ExtensionAgentTaskIdSchema,
  userMessage: NonEmptyStringSchema,
  basePlanFingerprint: Sha256HexSchema,
  baseSectionHashes: Type.Array(PlanRevisionBaseSectionHashSchema),
  retryOfTaskId: Type.Optional(ExtensionAgentTaskIdSchema),
  redraftOfTaskId: Type.Optional(ExtensionAgentTaskIdSchema),
  parentTaskId: Type.Optional(ExtensionAgentTaskIdSchema),
  appliedAt: Type.Optional(Type.String()),
  appliedSections: Type.Optional(Type.Array(Type.String(), { uniqueItems: true })),
  createdAt: Type.String(),
  annotationSnapshot: Type.Optional(PlanRevisionTurnAnnotationSnapshotSchema),
  turn: PlanRevisionTurnEntrySchema,
  available: Type.Boolean(),
  status: Type.Optional(ExtensionAgentTaskStatusSchema),
  task: Type.Optional(ExtensionAgentTaskRecordSchema),
  staleReason: Type.Optional(Type.String()),
}, JsonObjectAdditionalProperties);
export const PlanRevisionSessionProjectionSchema = Type.Object({ threadId: Type.String(), targetSession: Type.String(), turns: Type.Array(PlanRevisionTurnProjectionSchema), annotations: Type.Optional(Type.Array(PlanRevisionAnnotationSchema)), createdAt: Type.String(), updatedAt: Type.String(), plan: Type.Optional(Type.Object({}, JsonObjectAdditionalProperties)), readiness: Type.Optional(SessionPlanReadinessDetailSchema), path: Type.Optional(Type.String()), sourceRefs: Type.Optional(Type.Object({}, JsonObjectAdditionalProperties)), lifecycle: Type.Optional(Type.Object({}, JsonObjectAdditionalProperties)) }, JsonObjectAdditionalProperties);
export const StartPlanRevisionSessionInputSchema = Type.Object({ session: NonEmptyStringSchema }, { additionalProperties: false });
export const ListPlanRevisionSessionsInputSchema = Type.Object({ includePlan: Type.Optional(Type.Boolean()), includeDismissed: Type.Optional(Type.Boolean()), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: MAX_PLAN_REVISION_LIST_LIMIT, default: DEFAULT_PLAN_REVISION_LIST_LIMIT })), offset: Type.Optional(Type.Integer({ minimum: 0, default: 0 })) }, { additionalProperties: false });
export const GetPlanRevisionSessionInputSchema = Type.Object({ session: Type.Optional(NonEmptyStringSchema), threadId: Type.Optional(NonEmptyStringSchema), includePlan: Type.Optional(Type.Boolean()) }, { additionalProperties: false, oneOf: [{ required: ['session'] }, { required: ['threadId'] }] });
export const StartPlanRevisionTurnInputSchema = Type.Object({ session: NonEmptyStringSchema, message: Type.Optional(Type.String({ minLength: 1, maxLength: MAX_PLANNING_AGENT_USER_GOAL_LENGTH, pattern: '\\S' })), annotationIds: Type.Optional(Type.Array(NonEmptyStringSchema, { minItems: 1, uniqueItems: true, maxItems: MAX_PLAN_REVISION_ANNOTATIONS_PER_SESSION })), includeOpenAnnotations: Type.Optional(Type.Boolean()), steering: Type.Optional(Type.String({ minLength: 1, maxLength: MAX_PLAN_REVISION_STEERING_LENGTH, pattern: '\\S' })) }, { additionalProperties: false, anyOf: [{ required: ['message'] }, { required: ['annotationIds'] }, { required: ['steering'] }, { properties: { includeOpenAnnotations: { const: true } }, required: ['includeOpenAnnotations'] }] });
export const RetryPlanRevisionTurnAnswerSchema = Type.Object({ questionId: Type.Optional(Type.String({ maxLength: MAX_PLAN_REVISION_PROMPT_LENGTH })), prompt: Type.Optional(Type.String({ maxLength: MAX_PLAN_REVISION_PROMPT_LENGTH })), answer: Type.String({ minLength: 1, maxLength: MAX_PLAN_REVISION_ANSWER_LENGTH, pattern: '\\S' }) }, { additionalProperties: false });
export const RetryPlanRevisionTurnInputSchema = Type.Object({ session: NonEmptyStringSchema, taskId: Type.Optional(ExtensionAgentTaskIdSchema), turnId: Type.Optional(NonEmptyStringSchema), answers: Type.Optional(Type.Array(RetryPlanRevisionTurnAnswerSchema, { minItems: 1, maxItems: MAX_PLAN_REVISION_ANSWER_COUNT })), steering: Type.Optional(Type.String({ minLength: 1, maxLength: MAX_PLAN_REVISION_ANSWER_LENGTH, pattern: '\\S' })) }, { additionalProperties: false, oneOf: [{ required: ['taskId'] }, { required: ['turnId'] }] });
export const CancelPlanRevisionTurnInputSchema = Type.Object({ session: NonEmptyStringSchema, taskId: Type.Optional(ExtensionAgentTaskIdSchema), turnId: Type.Optional(NonEmptyStringSchema), reason: Type.Optional(Type.String({ maxLength: MAX_PLAN_REVISION_REASON_LENGTH })) }, { additionalProperties: false, oneOf: [{ required: ['taskId'] }, { required: ['turnId'] }] });
export const ApplyPlanRevisionTurnInputSchema = Type.Object({ session: NonEmptyStringSchema, taskId: Type.Optional(ExtensionAgentTaskIdSchema), turnId: Type.Optional(NonEmptyStringSchema) }, { additionalProperties: false, oneOf: [{ required: ['taskId'] }, { required: ['turnId'] }] });
export const CreatePlanRevisionAnnotationInputSchema = Type.Object({ session: NonEmptyStringSchema, body: Type.Optional(Type.String({ maxLength: MAX_PLAN_REVISION_ANNOTATION_BODY_LENGTH })), target: PlanRevisionAnnotationTargetSchema }, { additionalProperties: false });
export const UpdatePlanRevisionAnnotationInputSchema = Type.Object({ session: NonEmptyStringSchema, annotationId: NonEmptyStringSchema, body: Type.Optional(Type.String({ maxLength: MAX_PLAN_REVISION_ANNOTATION_BODY_LENGTH })), target: Type.Optional(PlanRevisionAnnotationTargetSchema) }, { additionalProperties: false, anyOf: [{ required: ['body'] }, { required: ['target'] }] });
export const DeletePlanRevisionAnnotationInputSchema = Type.Object({ session: NonEmptyStringSchema, annotationId: NonEmptyStringSchema }, { additionalProperties: false });
export const ResolvePlanRevisionAnnotationInputSchema = DeletePlanRevisionAnnotationInputSchema;
export const DismissPlanRevisionAnnotationInputSchema = DeletePlanRevisionAnnotationInputSchema;
export const PlanRevisionSessionOutputSchema = PlanRevisionSessionProjectionSchema;
export const PlanRevisionSessionsListOutputSchema = Type.Object({ sessions: Type.Array(PlanRevisionSessionProjectionSchema), total: Type.Integer({ minimum: 0 }), limit: Type.Integer({ minimum: 1, maximum: MAX_PLAN_REVISION_LIST_LIMIT }), offset: Type.Integer({ minimum: 0 }) }, JsonObjectAdditionalProperties);
export const PlanRevisionTurnStartOutputSchema = Type.Object({ session: PlanRevisionSessionProjectionSchema, task: ExtensionAgentTaskRecordSchema, turn: PlanRevisionTurnEntrySchema }, JsonObjectAdditionalProperties);
export const ApplyPlanRevisionTurnOutputSchema = Type.Union([
  Type.Object({ kind: Type.Literal('applied'), session: Type.String(), turnId: NonEmptyStringSchema, taskId: ExtensionAgentTaskIdSchema, appliedSections: Type.Array(Type.String()), readiness: SessionPlanReadinessDetailSchema, plan: Type.Object({}, JsonObjectAdditionalProperties), path: Type.String(), message: Type.String() }, JsonObjectAdditionalProperties),
  Type.Object({ kind: Type.Literal('not-applicable'), session: Type.String(), taskId: Type.Optional(ExtensionAgentTaskIdSchema), turnId: Type.Optional(NonEmptyStringSchema), message: Type.String() }, { additionalProperties: false, anyOf: [{ required: ['taskId'] }, { required: ['turnId'] }] }),
]);

export type StartPlanningAgentTaskInput = Static<typeof StartPlanningAgentTaskInputSchema>;
export type GetPlanningAgentTaskInput = Static<typeof GetPlanningAgentTaskInputSchema>;
export type CancelPlanningAgentTaskInput = Static<typeof CancelPlanningAgentTaskInputSchema>;
export type ApplyPlanningAgentTaskHandoffSelection = Static<typeof ApplyPlanningAgentTaskHandoffSelectionSchema>;
export type ApplyPlanningAgentTaskSessionPlanDraft = Static<typeof ApplyPlanningAgentTaskSessionPlanDraftSchema>;
export type ApplyPlanningAgentTaskCreationDraftSelection = Static<typeof ApplyPlanningAgentTaskCreationDraftSelectionSchema>;
export type ApplyPlanningAgentTaskBacklogCurationSelection = Static<typeof ApplyPlanningAgentTaskBacklogCurationSelectionSchema>;
export type ApplyPlanningAgentTaskResultInput = Static<typeof ApplyPlanningAgentTaskResultInputSchema>;
export type ApplyPlanningAgentTaskResultOutput = Static<typeof ApplyPlanningAgentTaskResultOutputSchema>;
export type AppliedSessionPlanCreationDraftSourceRefs = Static<typeof AppliedSessionPlanCreationDraftSourceRefsSchema>;
export type AppliedSessionPlanCreationDraft = Static<typeof AppliedSessionPlanCreationDraftSchema>;
export type PlanningTaskWorkflowSelection = Static<typeof PlanningTaskWorkflowSelectionSchema>;
export type PlanningTaskWorkflowEntry = Static<typeof PlanningTaskWorkflowEntrySchema>;
export type PlanningTaskWorkflowIndex = Static<typeof PlanningTaskWorkflowIndexSchema>;
export type ListPlanningAgentTasksInput = Static<typeof ListPlanningAgentTasksInputSchema>;
export type PlanningAgentTaskListItem = Static<typeof PlanningAgentTaskListItemSchema>;
export type ListPlanningAgentTasksOutput = Static<typeof ListPlanningAgentTasksOutputSchema>;
export type RetryPlanningAgentTaskInput = Static<typeof RetryPlanningAgentTaskInputSchema>;
export type RemovePlanningAgentTaskInput = Static<typeof RemovePlanningAgentTaskInputSchema>;
export type RedraftPlanningAgentTaskInput = Static<typeof RedraftPlanningAgentTaskInputSchema>;
export type PlanningAgentTaskWorkflowStartOutput = Static<typeof PlanningAgentTaskWorkflowStartOutputSchema>;
export type PlanRevisionAnnotationTargetKind = Static<typeof PlanRevisionAnnotationTargetKindSchema>;
export type PlanRevisionAnnotationQuoteContext = Static<typeof PlanRevisionAnnotationQuoteContextSchema>;
export type PlanRevisionAnnotationTarget = Static<typeof PlanRevisionAnnotationTargetSchema>;
export type PlanRevisionAnnotation = Static<typeof PlanRevisionAnnotationSchema>;
export type PlanRevisionTurnAnnotationSnapshot = Static<typeof PlanRevisionTurnAnnotationSnapshotSchema>;
export type PlanRevisionBaseSectionHash = Static<typeof PlanRevisionBaseSectionHashSchema>;
export type PlanRevisionTurnEntry = Static<typeof PlanRevisionTurnEntrySchema>;
export type PlanRevisionSessionEntry = Static<typeof PlanRevisionSessionEntrySchema>;
export type PlanRevisionIndex = Static<typeof PlanRevisionIndexSchema>;
export type PlanRevisionTurnProjection = Static<typeof PlanRevisionTurnProjectionSchema>;
export type PlanRevisionSessionProjection = Static<typeof PlanRevisionSessionProjectionSchema>;
export type StartPlanRevisionSessionInput = Static<typeof StartPlanRevisionSessionInputSchema>;
export type ListPlanRevisionSessionsInput = Static<typeof ListPlanRevisionSessionsInputSchema>;
export type GetPlanRevisionSessionInput = Static<typeof GetPlanRevisionSessionInputSchema>;
export type StartPlanRevisionTurnInput = Static<typeof StartPlanRevisionTurnInputSchema>;
export type CreatePlanRevisionAnnotationInput = Static<typeof CreatePlanRevisionAnnotationInputSchema>;
export type UpdatePlanRevisionAnnotationInput = Static<typeof UpdatePlanRevisionAnnotationInputSchema>;
export type DeletePlanRevisionAnnotationInput = Static<typeof DeletePlanRevisionAnnotationInputSchema>;
export type ResolvePlanRevisionAnnotationInput = Static<typeof ResolvePlanRevisionAnnotationInputSchema>;
export type DismissPlanRevisionAnnotationInput = Static<typeof DismissPlanRevisionAnnotationInputSchema>;
export type RetryPlanRevisionTurnInput = Static<typeof RetryPlanRevisionTurnInputSchema>;
export type CancelPlanRevisionTurnInput = Static<typeof CancelPlanRevisionTurnInputSchema>;
export type ApplyPlanRevisionTurnInput = Static<typeof ApplyPlanRevisionTurnInputSchema>;
export type ApplyPlanRevisionTurnOutput = Static<typeof ApplyPlanRevisionTurnOutputSchema>;
