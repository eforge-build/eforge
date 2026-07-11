/**
 * Fix-submission schema for the planning quality reviewer.
 *
 * Composes whole-artifact repair variants with narrow semantic operations for
 * plan merge, redundant-stage removal, and review-depth reduction. There is
 * deliberately no fix variant for compiler-diagnostics.json: the reviewer is
 * structurally unable to modify or delete compiler diagnostics.
 */
import { Type, type Static } from '@sinclair/typebox';
import { getSchemaYaml, planReviewFixSchema } from '../schemas.js';
import { PlanningModuleReviewDepthSchema } from '../planner-compiler/reduce-digest-contracts.js';

// Mirrors architectureReviewFixSchema's single variant. It is restated here
// because TypeBox collapses single-member unions, so the original schema
// exposes no `anyOf` to spread from.
const replaceArchitectureFixSchema = Type.Object({
  kind: Type.Literal('replace_architecture', { description: 'Replace the entire architecture.md content' }),
  content: Type.String({ minLength: 1, description: 'New architecture.md markdown content' }),
}, { description: 'Replace the entire architecture.md file' });

const replaceAcceptanceCoverageFixSchema = Type.Object({
  kind: Type.Literal('replace_acceptance_coverage', { description: 'Replace the entire acceptance-coverage.md content' }),
  content: Type.String({ minLength: 1, description: 'New acceptance-coverage.md markdown content' }),
}, { description: 'Replace the entire acceptance-coverage.md file' });

const mergePlansFixSchema = Type.Object({
  kind: Type.Literal('merge_plans', { description: 'Merge one or more absorbed plans into a retained target plan' }),
  targetPlanId: Type.String({ minLength: 1, maxLength: 160 }),
  absorbedPlanIds: Type.Array(Type.String({ minLength: 1, maxLength: 160 }), { minItems: 1, maxItems: 16 }),
  rationale: Type.String({ minLength: 1, maxLength: 1_000 }),
}, { additionalProperties: false, description: 'Merge cohesive plans while preserving the target plan id' });

const removeRedundantStageFixSchema = Type.Object({
  kind: Type.Literal('remove_redundant_stage', { description: 'Remove one non-core build stage when normalized work and safety intent do not require it' }),
  planId: Type.String({ minLength: 1, maxLength: 160 }),
  stage: Type.Union([Type.Literal('doc-author'), Type.Literal('doc-sync'), Type.Literal('test-write'), Type.Literal('test-cycle')]),
  rationale: Type.String({ minLength: 1, maxLength: 1_000 }),
}, { additionalProperties: false, description: 'Remove a redundant non-core stage from one plan' });

const reduceReviewDepthFixSchema = Type.Object({
  kind: Type.Literal('reduce_review_depth', { description: 'Reduce review depth without crossing the deterministic safety floor' }),
  planId: Type.String({ minLength: 1, maxLength: 160 }),
  reviewDepth: PlanningModuleReviewDepthSchema,
  rationale: Type.String({ minLength: 1, maxLength: 1_000 }),
}, { additionalProperties: false, description: 'Reduce unjustified review depth for one plan' });

export const planningQualityStructuralFixSchema = Type.Union([
  mergePlansFixSchema,
  removeRedundantStageFixSchema,
  reduceReviewDepthFixSchema,
]);

const planningQualityReviewFixSchema = Type.Union([
  ...planReviewFixSchema.anyOf,
  replaceArchitectureFixSchema,
  replaceAcceptanceCoverageFixSchema,
  ...planningQualityStructuralFixSchema.anyOf,
], { description: 'A single fix to apply to planning artifacts produced by the bounded planner compiler' });

export const planningQualityReviewSubmissionSchema = Type.Object({
  fixes: Type.Array(planningQualityReviewFixSchema, { maxItems: 64, description: 'Fixes to apply to planning artifacts; may be empty if no fixable issues were found' }),
});

export type PlanningQualityReviewSubmission = Static<typeof planningQualityReviewSubmissionSchema>;
export type PlanningQualityStructuralFix = Static<typeof planningQualityStructuralFixSchema>;

/** Schema YAML for planning-quality-reviewer fix submissions. */
export function getPlanningQualityReviewSubmissionSchemaYaml(): string {
  return getSchemaYaml('planning-quality-review-submission', planningQualityReviewSubmissionSchema);
}
