/**
 * Fix-submission schema for the planning quality reviewer.
 *
 * Composes the existing plan-review fix variants (replace_orchestration,
 * replace_plan_file, replace_plan_body) and the architecture-review fix
 * variant (replace_architecture) with one new variant for
 * acceptance-coverage.md. There is deliberately no fix variant for
 * compiler-diagnostics.json: the reviewer is structurally unable to modify
 * or delete compiler diagnostics.
 */
import { Type, type Static } from '@sinclair/typebox';
import { getSchemaYaml, planReviewFixSchema } from '../schemas.js';

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

const planningQualityReviewFixSchema = Type.Union([
  ...planReviewFixSchema.anyOf,
  replaceArchitectureFixSchema,
  replaceAcceptanceCoverageFixSchema,
], { description: 'A single fix to apply to planning artifacts produced by the bounded planner compiler' });

export const planningQualityReviewSubmissionSchema = Type.Object({
  fixes: Type.Array(planningQualityReviewFixSchema, { description: 'Fixes to apply to planning artifacts; may be empty if no fixable issues were found' }),
});

export type PlanningQualityReviewSubmission = Static<typeof planningQualityReviewSubmissionSchema>;

/** Schema YAML for planning-quality-reviewer fix submissions. */
export function getPlanningQualityReviewSubmissionSchemaYaml(): string {
  return getSchemaYaml('planning-quality-review-submission', planningQualityReviewSubmissionSchema);
}
