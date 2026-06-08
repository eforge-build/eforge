import { Type, type Static } from '../../../packages/extension-sdk/src/index.js';
import {
  BacklogRecommendationModelSchema,
  RecommendationDerivedStatusSchema,
  RecommendationStaleReasonSchema,
  RecommendationStatusSidecarSchema,
  RecommendationSummarySchema,
} from './schema.js';

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
}, { additionalProperties: false });

export type RecommendationStaleReason = Static<typeof RecommendationStaleReasonSchema>;
export type RecommendationStatusSidecar = Static<typeof RecommendationStatusSidecarSchema>;
export type RecommendationDerivedStatus = Static<typeof RecommendationDerivedStatusSchema>;
export type GetRecommendationsWithStatusOutput = Static<typeof GetRecommendationsWithStatusOutputSchema>;
