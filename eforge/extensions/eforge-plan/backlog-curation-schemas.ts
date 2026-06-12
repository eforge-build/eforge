import { Type, type Static } from '../../../packages/extension-sdk/src/index.js';
import {
  EforgePlanPlanningBacklogCurationNeedsInputSchema,
  EforgePlanPlanningBacklogCurationSkippedSchema,
  EforgePlanPlanningRequestedOutputSectionSchema,
  ExtensionAgentTaskIdSchema,
  ExtensionAgentTaskRecordSchema,
} from '../../../packages/client/src/extension-agent-tasks.js';
import { BacklogStatusSchema, RecommendationDerivedStatusSchema, RecommendationSummarySchema, BacklogRecommendationModelSchema } from './schema.js';

export const AnalyzeAllBacklogInputSchema = Type.Object({}, { additionalProperties: false });

const SourceFingerprintSchema = Type.String({ minLength: 64, maxLength: 64, pattern: '^[A-Fa-f0-9]{64}$' });

const AnalyzeAllBacklogWorkflowEntrySchema = Type.Object({
  taskId: ExtensionAgentTaskIdSchema,
  parentTaskId: Type.Optional(ExtensionAgentTaskIdSchema),
  originalRequest: Type.String(),
  derivedRequest: Type.String(),
  selection: Type.Object({
    itemIds: Type.Optional(Type.Array(Type.String())),
    epicId: Type.Optional(Type.String()),
    recommendationRef: Type.Optional(Type.String()),
  }, { additionalProperties: false }),
  requestedOutputSections: Type.Array(EforgePlanPlanningRequestedOutputSectionSchema),
  session: Type.Optional(Type.String()),
  planningType: Type.Optional(Type.String()),
  planningDepth: Type.Optional(Type.String()),
  includeRoadmap: Type.Optional(Type.Boolean()),
  purpose: Type.Literal('backlog-curation'),
  sourceFingerprint: SourceFingerprintSchema,
  appliedAt: Type.Optional(Type.String()),
  createdAt: Type.String(),
}, { additionalProperties: false });

export const AnalyzeAllBacklogOutputSchema = Type.Object({
  task: ExtensionAgentTaskRecordSchema,
  entry: AnalyzeAllBacklogWorkflowEntrySchema,
  sourceFingerprint: SourceFingerprintSchema,
  reused: Type.Optional(Type.Boolean()),
}, { additionalProperties: false });

// --- eforge:region recommendation-validation ---
export const RecommendationReferenceValidationIssueSchema = Type.Object({
  path: Type.String(),
  id: Type.String(),
  kind: Type.Union([Type.Literal('item'), Type.Literal('epic')]),
  reason: Type.Union([Type.Literal('unknown'), Type.Literal('closed'), Type.Literal('empty')]),
  status: Type.Optional(BacklogStatusSchema),
  title: Type.Optional(Type.String()),
  message: Type.String(),
}, { additionalProperties: false });

export const RecommendationReferenceValidationResultSchema = Type.Object({
  valid: Type.Boolean(),
  issues: Type.Array(RecommendationReferenceValidationIssueSchema),
}, { additionalProperties: false });

export const BacklogCurationPreviewValidationErrorSchema = Type.Object({
  path: Type.String(),
  message: Type.String(),
}, { additionalProperties: false });

export const BacklogCurationPreviewDetailsSchema = Type.Object({
  valid: Type.Boolean(),
  itemChanges: Type.Optional(Type.Integer({ minimum: 0 })),
  epicChanges: Type.Optional(Type.Integer({ minimum: 0 })),
  noOpRechecks: Type.Optional(Type.Integer({ minimum: 0 })),
  generatedRecommendationValidation: Type.Optional(RecommendationReferenceValidationResultSchema),
  errors: Type.Optional(Type.Array(BacklogCurationPreviewValidationErrorSchema)),
}, { additionalProperties: false });

export const BacklogCurationRecommendationsSkippedSchema = Type.Object({
  reason: Type.Union([Type.Literal('apply-curation-only'), Type.Literal('invalid-generated-recommendations')]),
  generatedRecommendationValidation: RecommendationReferenceValidationResultSchema,
}, { additionalProperties: false });
// --- eforge:endregion recommendation-validation ---

export const BacklogCurationApplyDetailsSchema = Type.Object({
  itemChanges: Type.Integer({ minimum: 0 }),
  epicChanges: Type.Integer({ minimum: 0 }),
  noOpRechecks: Type.Integer({ minimum: 0 }),
  skippedFreshRechecks: Type.Integer({ minimum: 0 }),
  changedItemIds: Type.Array(Type.String()),
  changedEpicIds: Type.Array(Type.String()),
  recheckedItemIds: Type.Array(Type.String()),
  recheckedEpicIds: Type.Array(Type.String()),
  skipped: Type.Array(EforgePlanPlanningBacklogCurationSkippedSchema),
  needsInput: Type.Array(EforgePlanPlanningBacklogCurationNeedsInputSchema),
  recommendations: Type.Optional(Type.Object({
    recommendations: BacklogRecommendationModelSchema,
    recommendationSummary: RecommendationSummarySchema,
    path: Type.String(),
    status: RecommendationDerivedStatusSchema,
  }, { additionalProperties: false })),
  recommendationStatus: Type.Optional(RecommendationDerivedStatusSchema),
  // --- eforge:region recommendation-validation ---
  generatedRecommendationValidation: Type.Optional(RecommendationReferenceValidationResultSchema),
  recommendationsSkipped: Type.Optional(BacklogCurationRecommendationsSkippedSchema),
  // --- eforge:endregion recommendation-validation ---
}, { additionalProperties: false });

export type AnalyzeAllBacklogInput = Static<typeof AnalyzeAllBacklogInputSchema>;
export type AnalyzeAllBacklogOutput = Static<typeof AnalyzeAllBacklogOutputSchema>;
export type RecommendationReferenceValidationIssue = Static<typeof RecommendationReferenceValidationIssueSchema>;
export type RecommendationReferenceValidationResult = Static<typeof RecommendationReferenceValidationResultSchema>;
export type BacklogCurationPreviewDetails = Static<typeof BacklogCurationPreviewDetailsSchema>;
export type BacklogCurationRecommendationsSkipped = Static<typeof BacklogCurationRecommendationsSkippedSchema>;
export type BacklogCurationApplyDetails = Static<typeof BacklogCurationApplyDetailsSchema>;
