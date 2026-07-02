import { Type, type Static } from '@sinclair/typebox';
import { EvaluationIssueOutcomeSchema, ReviewIssueIdSchema, getSchemaYaml } from '@eforge-build/client';

// ---------------------------------------------------------------------------
// Evaluation schemas
// ---------------------------------------------------------------------------

export const evaluationEvidenceSchema = Type.Object({
  staged: Type.String({ description: 'What the staged/original code does' }),
  fix: Type.String({ description: "What the reviewer's fix does" }),
  rationale: Type.String({ description: 'Why the verdict was chosen' }),
  ifAccepted: Type.String({ description: 'Consequence if the fix is accepted' }),
  ifRejected: Type.String({ description: 'Consequence if the fix is rejected' }),
}, { description: 'Structured evidence when the evaluator uses child elements' });

export const evaluationVerdictSchema = Type.Object({
  file: Type.String({ description: 'File path being evaluated' }),
  action: Type.Union([
    Type.Literal('accept'),
    Type.Literal('reject'),
    Type.Literal('review'),
  ], { description: 'Patch disposition: whether the candidate diff should be applied' }),
  reason: Type.String({ description: 'Reason for the verdict' }),
  evidence: Type.Optional(evaluationEvidenceSchema),
  hunk: Type.Optional(Type.Integer({
    minimum: 1,
    description: 'Hunk number for per-hunk evaluation (1-indexed)',
  })),
  issueOutcome: Type.Optional(EvaluationIssueOutcomeSchema),
  issueIds: Type.Optional(Type.Array(ReviewIssueIdSchema, {
    description: 'Optional reviewer issue IDs this evaluator verdict addresses. Unknown IDs are accepted as observability metadata.',
  })),
  retryGuidance: Type.Optional(Type.String({
    minLength: 1,
    description: 'Actionable guidance for a narrower safe retry when this verdict rejects or flags an attempted fix as too broad, unsafe, or incomplete',
  })),
});

export type EvaluationEvidence = Static<typeof evaluationEvidenceSchema>;
export type EvaluationVerdict = Static<typeof evaluationVerdictSchema>;

export const evaluationSubmissionSchema = Type.Object({
  verdicts: Type.Array(evaluationVerdictSchema, {
    description: 'Evaluation verdicts covering every captured file or every captured hunk in the immutable evaluation snapshot',
  }),
});

export type EvaluationSubmission = Static<typeof evaluationSubmissionSchema>;

/** Schema YAML for evaluation verdicts (used by evaluator and plan-evaluator). */
export function getEvaluationSchemaYaml(): string {
  return getSchemaYaml('evaluation-verdict', evaluationVerdictSchema);
}

/** Schema YAML for evaluation verdict submissions (used by evaluator tools). */
export function getEvaluationSubmissionSchemaYaml(): string {
  return getSchemaYaml('evaluation-submission', evaluationSubmissionSchema);
}
