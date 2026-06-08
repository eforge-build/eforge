import { Type, type Static } from '../../../packages/extension-sdk/src/index.js';
import { ExtensionAgentTaskRecordSchema } from '../../../packages/client/src/extension-agent-tasks.js';
import {
  BacklogRecommendationModelSchema,
  RecommendationDerivedStatusSchema,
  RecommendationStaleReasonSchema,
  RecommendationStatusSidecarSchema,
  RecommendationSummarySchema,
} from './schema.js';
import { PlanningTaskWorkflowEntrySchema } from './planning-agent-task-schemas.js';

export {
  RecommendationDerivedStatusSchema,
  RecommendationStaleReasonSchema,
  RecommendationStatusSidecarSchema,
};

export const GetRecommendationsWithStatusOutputSchema = Type.Object({
  recommendations: Type.Union([BacklogRecommendationModelSchema, Type.Null()]),
  recommendationSummary: Type.Optional(RecommendationSummarySchema),
  path: Type.String(),
  status: RecommendationDerivedStatusSchema,
  // --- eforge:region plan-02-refresh-invalidation ---
  activeRefreshTask: Type.Optional(ExtensionAgentTaskRecordSchema),
  // --- eforge:endregion plan-02-refresh-invalidation ---
}, { additionalProperties: false });

// --- eforge:region plan-02-refresh-invalidation ---
export const RefreshRecommendationsInputSchema = Type.Object({}, { additionalProperties: false });

export const RefreshRecommendationsOutputSchema = Type.Object({
  task: ExtensionAgentTaskRecordSchema,
  entry: PlanningTaskWorkflowEntrySchema,
  sourceFingerprint: Type.String(),
  reused: Type.Optional(Type.Boolean()),
}, { additionalProperties: false });
// --- eforge:endregion plan-02-refresh-invalidation ---

export type RecommendationStaleReason = Static<typeof RecommendationStaleReasonSchema>;
export type RecommendationStatusSidecar = Static<typeof RecommendationStatusSidecarSchema>;
export type RecommendationDerivedStatus = Static<typeof RecommendationDerivedStatusSchema>;
export type GetRecommendationsWithStatusOutput = Static<typeof GetRecommendationsWithStatusOutputSchema>;
// --- eforge:region plan-02-refresh-invalidation ---
export type RefreshRecommendationsInput = Static<typeof RefreshRecommendationsInputSchema>;
export type RefreshRecommendationsOutput = Static<typeof RefreshRecommendationsOutputSchema>;
// --- eforge:endregion plan-02-refresh-invalidation ---
