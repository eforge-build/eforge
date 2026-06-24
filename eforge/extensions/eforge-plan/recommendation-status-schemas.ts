import { ExtensionAgentTaskRecordSchema } from '@eforge-build/client';
import { Type, type Static } from '@eforge-build/extension-sdk';
import {
  GetRecommendationsOutputSchema,
  // --- eforge:region plan-04-recommendation-actionability-server ---
  RecommendationActionabilityProjectionSchema,
  // --- eforge:endregion plan-04-recommendation-actionability-server ---
  RecommendationDerivedStatusSchema,
  RecommendationStaleReasonSchema,
  RecommendationStatusSidecarSchema,
} from './schema.js';
import { PlanningTaskWorkflowEntrySchema } from './planning-agent-task-schemas.js';
import { SourceFingerprintSchema } from './backlog-curation-schemas.js';

export {
  // --- eforge:region plan-04-recommendation-actionability-server ---
  RecommendationActionabilityProjectionSchema,
  // --- eforge:endregion plan-04-recommendation-actionability-server ---
  RecommendationDerivedStatusSchema,
  RecommendationStaleReasonSchema,
  RecommendationStatusSidecarSchema,
};

export const RecommendationFreshnessViewSchema = Type.Object({
  state: Type.Union([Type.Literal('missing'), Type.Literal('fresh'), Type.Literal('stale')]),
  reason: Type.String(),
  storedSourceFingerprint: Type.Optional(Type.String()),
  comparedSourceFingerprint: Type.String(),
  baselineTaskId: Type.Optional(Type.String()),
}, { additionalProperties: false });

export const GetRecommendationsWithStatusOutputSchema = Type.Object({
  ...GetRecommendationsOutputSchema.properties,
  recommendationFreshness: RecommendationFreshnessViewSchema,
}, { additionalProperties: false });

export const RefreshRecommendationsInputSchema = Type.Object({}, { additionalProperties: false });

export const RefreshRecommendationsOutputSchema = Type.Object({
  task: ExtensionAgentTaskRecordSchema,
  entry: PlanningTaskWorkflowEntrySchema,
  sourceFingerprint: SourceFingerprintSchema,
  reused: Type.Optional(Type.Boolean()),
}, { additionalProperties: false });

export type RecommendationStaleReason = Static<typeof RecommendationStaleReasonSchema>;
export type RecommendationStatusSidecar = Static<typeof RecommendationStatusSidecarSchema>;
// --- eforge:region plan-04-recommendation-actionability-server ---
export type RecommendationActionabilityProjection = Static<typeof RecommendationActionabilityProjectionSchema>;
// --- eforge:endregion plan-04-recommendation-actionability-server ---
export type RecommendationDerivedStatus = Static<typeof RecommendationDerivedStatusSchema>;
export type RecommendationFreshnessView = Static<typeof RecommendationFreshnessViewSchema>;
export type GetRecommendationsWithStatusOutput = Static<typeof GetRecommendationsWithStatusOutputSchema>;
export type RefreshRecommendationsInput = Static<typeof RefreshRecommendationsInputSchema>;
export type RefreshRecommendationsOutput = Static<typeof RefreshRecommendationsOutputSchema>;
