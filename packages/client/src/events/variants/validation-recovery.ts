import { Type } from '@sinclair/typebox';
import {
  AcceptanceCriteriaConflictSchema,
  AcceptanceCriterionVerdictSchema,
  AgentResultDataSchema,
  AgentRoleSchema,
  AgentTerminalSubtypeSchema,
  AutoBuildDesiredSchema,
  AutoBuildDetailFields,
  AutoBuildRuntimeModeSchema,
  BuildFailureSummarySchema,
  BuildResumeArtifactsEventSchema,
  BuildStageSpecSchema,
  ClarificationQuestionSchema,
  EforgeResultSchema,
  EvaluationIssueOutcomeSchema,
  FinalMergePolicyGateProvenanceFields,
  LandingActionSchema,
  LandingPublicationActionSchema,
  PlanFileSchema,
  PlanMergePolicyGateProvenanceFields,
  PlanStatusSchema,
  PolicyGateAllowDecisionFields,
  PolicyGateBlockDecisionFields,
  PolicyGateRequireApprovalDecisionFields,
  PrdValidationGapSchema,
  QueueDispatchPolicyGateProvenanceFields,
  ReconciliationReportSchema,
  RecoveryVerdictSchema,
  ReviewCycleRoundField,
  ReviewIssueSchema,
  ReviewPerspectiveKeySchema,
  ReviewProfileConfigSchema,
  StackArtifactRefSchema,
  StackLandingStatusSchema,
  StackProviderConflictKindSchema,
  StackProviderOperationKindSchema,
  StackProviderSchema,
  StackLayerStatusSchema,
  TerminalFailureEnvelopeSchema,
  TestIssueSchema,
} from '../shared/schemas.js';
import { agentStartFields } from '../shared/agent-fields.js';
import {
  ExtensionActionEventBaseFields,
  ExtensionActionFailedErrorCodeSchema,
  ExtensionActionValidationErrorSchema,
  StackSyncTriggerSchema,
} from '../shared/extension-actions.js';
import { BuildDecisionSchema, PlanningDecisionEventSchema } from '../decisions.js';
import { queueEventVariants } from '../queue-events.js';
import { RECOVERY_AUTO_RESUME_MAX_ATTEMPTS } from '../shared/recovery-auto-resume.js';

export const validationRecoveryEventVariants = [
  // Validation (post-merge)
  Type.Object({ type: Type.Literal('validation:start'), commands: Type.Array(Type.String()) }),
  Type.Object({ type: Type.Literal('validation:command:start'), command: Type.String() }),
  Type.Object({
    type: Type.Literal('validation:command:complete'),
    command: Type.String(),
    exitCode: Type.Number(),
    output: Type.String(),
  }),
  Type.Object({
    type: Type.Literal('validation:command:timeout'),
    command: Type.String(),
    timeoutMs: Type.Number(),
    pid: Type.Number(),
  }),
  Type.Object({ type: Type.Literal('validation:complete'), passed: Type.Boolean() }),
  Type.Object({
    type: Type.Literal('validation:fix:start'),
    attempt: Type.Number(),
    maxAttempts: Type.Number(),
  }),
  Type.Object({ type: Type.Literal('validation:fix:complete'), attempt: Type.Number() }),

  // PRD validation
  Type.Object({ type: Type.Literal('prd_validation:start') }),
  Type.Object({
    type: Type.Literal('prd_validation:complete'),
    passed: Type.Boolean(),
    gaps: Type.Array(PrdValidationGapSchema),
    completionPercent: Type.Optional(Type.Number()),
  }),

  // Gap closing
  Type.Object({
    type: Type.Literal('gap_close:start'),
    gapCount: Type.Optional(Type.Number()),
    completionPercent: Type.Optional(Type.Number()),
  }),
  Type.Object({
    type: Type.Literal('gap_close:plan_ready'),
    planBody: Type.String(),
    gaps: Type.Array(PrdValidationGapSchema),
  }),
  Type.Object({
    type: Type.Literal('gap_close:complete'),
    passed: Type.Boolean(),
  }),

  // Acceptance criteria validation verdict event — terminal evidence from the PRD validator.
  Type.Object({
    type: Type.Literal('acceptance_validation:complete'),
    passed: Type.Boolean(),
    verdicts: Type.Array(AcceptanceCriterionVerdictSchema, { minItems: 1 }),
    waivers: Type.Optional(Type.Array(Type.String())),
    acceptanceConflicts: Type.Optional(Type.Array(AcceptanceCriteriaConflictSchema)),
    source: Type.String({ minLength: 1 }),
  }),

  // Reconciliation
  Type.Object({ type: Type.Literal('reconciliation:start') }),
  Type.Object({
    type: Type.Literal('reconciliation:complete'),
    report: ReconciliationReportSchema,
  }),

  // Cleanup
  Type.Object({ type: Type.Literal('cleanup:start'), planSet: Type.String() }),
  Type.Object({ type: Type.Literal('cleanup:complete'), planSet: Type.String() }),

  // User interaction
  Type.Object({
    type: Type.Literal('approval:needed'),
    planId: Type.Optional(Type.String()),
    action: Type.String(),
    details: Type.String(),
  }),
  Type.Object({ type: Type.Literal('approval:response'), approved: Type.Boolean() }),

  // Enqueue
  Type.Object({ type: Type.Literal('enqueue:start'), source: Type.String() }),
  Type.Object({
    type: Type.Literal('enqueue:complete'),
    id: Type.String(),
    filePath: Type.String(),
    title: Type.String(),
    planSet: Type.String(),
  }),
  Type.Object({ type: Type.Literal('enqueue:failed'), error: Type.String() }),
  Type.Object({ type: Type.Literal('enqueue:commit-failed'), error: Type.String() }),

  // Recovery analysis
  Type.Object({
    type: Type.Literal('recovery:start'),
    prdId: Type.String(),
    setName: Type.String(),
  }),
  Type.Object({
    type: Type.Literal('recovery:summary'),
    prdId: Type.String(),
    summary: BuildFailureSummarySchema,
  }),
  Type.Object({
    type: Type.Literal('recovery:complete'),
    prdId: Type.String(),
    verdict: RecoveryVerdictSchema,
    sidecarMdPath: Type.Optional(Type.String()),
    sidecarJsonPath: Type.Optional(Type.String()),
  }),
  Type.Object({
    type: Type.Literal('recovery:error'),
    prdId: Type.String(),
    error: Type.String(),
    rawOutput: Type.Optional(Type.String()),
  }),

  // Recovery auto-resume policy audit
  Type.Object({
    type: Type.Literal('recovery:auto-resume:evaluate'),
    prdId: Type.String(),
    setName: Type.String(),
    enabled: Type.Boolean(),
    attempt: Type.Integer({ minimum: 0 }),
    maxAttempts: Type.Integer({ minimum: 0, maximum: RECOVERY_AUTO_RESUME_MAX_ATTEMPTS }),
  }),
  Type.Object({
    type: Type.Literal('recovery:auto-resume:queued'),
    prdId: Type.String(),
    setName: Type.String(),
    action: Type.Literal('continue-repair'),
    attempt: Type.Integer({ minimum: 1 }),
    maxAttempts: Type.Integer({ minimum: 1, maximum: RECOVERY_AUTO_RESUME_MAX_ATTEMPTS }),
  }),
  Type.Object({
    type: Type.Literal('recovery:auto-resume:stopped'),
    prdId: Type.String(),
    setName: Type.String(),
    reason: Type.Union([
      Type.Literal('disabled'),
      Type.Literal('attempt-budget-exhausted'),
      Type.Literal('not-continue-repair'),
      Type.Literal('not-high-confidence'),
      Type.Literal('not-eligible'),
      Type.Literal('manual-confirmation-required'),
      Type.Literal('partial-sidecar'),
      Type.Literal('malformed-sidecar'),
      Type.Literal('missing-sidecar'),
      Type.Literal('ineligible-artifacts'),
      Type.Literal('dirty-worktree'),
      Type.Literal('conflicting-worktree'),
      Type.Literal('queue-preflight-blocked'),
      Type.Literal('conflicting-applied-marker'),
      Type.Literal('active-gate-or-hold'),
      Type.Literal('repeated-failure-signature'),
      Type.Literal('error'),
    ]),
    attempt: Type.Integer({ minimum: 0 }),
    maxAttempts: Type.Integer({ minimum: 0, maximum: RECOVERY_AUTO_RESUME_MAX_ATTEMPTS }),
    message: Type.Optional(Type.String()),
  }),

  // Recovery apply
  Type.Object({ type: Type.Literal('recovery:apply:start'), prdId: Type.String() }),
  Type.Object({
    type: Type.Literal('recovery:apply:complete'),
    prdId: Type.String(),
    verdict: Type.Union([
      Type.Literal('retry'),
      Type.Literal('continue-repair'),
      Type.Literal('abandon'),
      Type.Literal('manual'),
    ]),
    noAction: Type.Boolean(),
  }),
  Type.Object({
    type: Type.Literal('recovery:apply:error'),
    prdId: Type.String(),
    message: Type.String(),
  }),
] as const;
