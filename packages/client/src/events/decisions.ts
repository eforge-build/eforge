import { Type, type Static } from '@sinclair/typebox';
import { BuildStageSpecSchema, ReviewPerspectiveKeySchema } from './shared/schemas.js';

export const PlanningDecisionSchema = Type.Union([
  // Default build pipeline chosen for the plan set
  Type.Object({
    kind: Type.Literal('build-pipeline-chosen'),
    rationale: Type.String(),
    defaultBuild: Type.Array(BuildStageSpecSchema, { minItems: 1 }),
  }),
  // Default review profile chosen for the plan set
  Type.Object({
    kind: Type.Literal('review-profile-chosen'),
    rationale: Type.String(),
    strategy: Type.Union([
      Type.Literal('auto'),
      Type.Literal('single'),
      Type.Literal('parallel'),
    ]),
    perspectives: Type.Array(ReviewPerspectiveKeySchema, { minItems: 1 }),
    maxRounds: Type.Integer({ minimum: 1 }),
    evaluatorStrictness: Type.Union([
      Type.Literal('strict'),
      Type.Literal('standard'),
      Type.Literal('lenient'),
    ]),
  }),
  // Plan set shape: how many plans and why they are split that way
  Type.Object({
    kind: Type.Literal('plan-set-shape'),
    rationale: Type.String(),
    planCount: Type.Integer({ minimum: 1 }),
    planIds: Type.Array(Type.String(), { minItems: 1 }),
  }),
]);

export type PlanningDecision = Static<typeof PlanningDecisionSchema>;

export const PlanningDecisionEventSchema = Type.Object({
  type: Type.Literal('planning:decision'),
  planId: Type.Optional(Type.String()),
  decision: PlanningDecisionSchema,
});

export const BuildDecisionSchema = Type.Union([
  // Review strategy selection
  Type.Object({
    kind: Type.Literal('review-strategy'),
    rationale: Type.String(),
    strategy: Type.Union([Type.Literal('single'), Type.Literal('parallel')]),
    source: Type.Union([Type.Literal('config'), Type.Literal('auto-threshold')]),
    auto: Type.Optional(
      Type.Object({
        files: Type.Integer({ minimum: 0 }),
        lines: Type.Integer({ minimum: 0 }),
        threshold: Type.Object({
          files: Type.Integer({ minimum: 0 }),
          lines: Type.Integer({ minimum: 0 }),
        }),
      }),
    ),
  }),
  // Perspectives inferred for parallel review
  Type.Object({
    kind: Type.Literal('perspectives-inferred'),
    rationale: Type.String(),
    perspectives: Type.Array(ReviewPerspectiveKeySchema),
    categories: Type.Array(Type.String()),
    rules: Type.Array(Type.String()),
  }),
  // Review cycle terminated
  Type.Object({
    kind: Type.Literal('cycle-terminated'),
    rationale: Type.String(),
    round: Type.Integer({ minimum: 0 }),
    reason: Type.Union([Type.Literal('no-issues'), Type.Literal('max-rounds')]),
    issuesRemaining: Type.Integer({ minimum: 0 }),
    lastReviewIssueCount: Type.Optional(Type.Integer({ minimum: 0 })), finalEvaluationAccepted: Type.Optional(Type.Integer({ minimum: 0 })), finalEvaluationRejected: Type.Optional(Type.Integer({ minimum: 0 })), finalEvaluationRan: Type.Optional(Type.Boolean()),
    finalEvaluationResolved: Type.Optional(Type.Integer({ minimum: 0 })), finalEvaluationFalsePositive: Type.Optional(Type.Integer({ minimum: 0 })), finalEvaluationUnresolved: Type.Optional(Type.Integer({ minimum: 0 })), finalEvaluationNeedsHumanReview: Type.Optional(Type.Integer({ minimum: 0 })), finalEvaluationBlocking: Type.Optional(Type.Integer({ minimum: 0 })),
  }),
  // Perspectives respawned for next review round
  Type.Object({
    kind: Type.Literal('perspectives-respawned'),
    rationale: Type.String(),
    round: Type.Integer({ minimum: 0 }),
    perspectives: Type.Array(ReviewPerspectiveKeySchema),
    dropped: Type.Array(ReviewPerspectiveKeySchema),
  }),
  // Evaluator strictness selection
  Type.Object({
    kind: Type.Literal('evaluator-strictness'),
    rationale: Type.String(),
    strictness: Type.Union([
      Type.Literal('strict'),
      Type.Literal('standard'),
      Type.Literal('lenient'),
    ]),
    source: Type.Union([Type.Literal('config'), Type.Literal('default')]),
  }),
  // Same-plan recovery budget extended after review-round convergence
  Type.Object({
    kind: Type.Literal('recovery-budget-extended'),
    rationale: Type.String(),
    previousBlockingIssueOutcomes: Type.Integer({ minimum: 1 }),
    lastBlockingIssueOutcomes: Type.Integer({ minimum: 1 }),
    maxAttempts: Type.Integer({ minimum: 2 }),
  }),
  // Recovery verdict applied
  Type.Object({
    kind: Type.Literal('recovery-verdict'),
    rationale: Type.String(),
    verdict: Type.Union([
      Type.Literal('retry'),
      Type.Literal('continue-repair'),
      Type.Literal('abandon'),
      Type.Literal('manual'),
    ]),
  }),
  // Merge conflict resolution strategy
  Type.Object({
    kind: Type.Literal('merge-conflict-resolution'),
    rationale: Type.String(),
    strategy: Type.String(),
    files: Type.Array(Type.String()),
  }),
]);

export type BuildDecision = Static<typeof BuildDecisionSchema>;

export type PlanningDecisionEvent = Static<typeof PlanningDecisionEventSchema>;
