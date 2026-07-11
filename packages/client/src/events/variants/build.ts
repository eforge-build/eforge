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
  ReviewFixIssueReferenceSchema,
  ReviewIssueIdSchema,
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
  TestOwnershipSchema,
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

export const buildEventVariants = [
  // --- eforge:region per-plan-build-events ---
  // Building (per-plan)
  Type.Object({ type: Type.Literal('plan:build:start'), planId: Type.String() }),
  Type.Object({ type: Type.Literal('plan:build:implement:start'), planId: Type.String() }),
  Type.Object({
    type: Type.Literal('plan:build:implement:progress'),
    planId: Type.String(),
    message: Type.String(),
  }),
  Type.Object({
    type: Type.Literal('plan:build:implement:continuation'),
    planId: Type.String(),
    attempt: Type.Number(),
    maxContinuations: Type.Number(),
    shardId: Type.Optional(Type.String()),
  }),
  Type.Object({ type: Type.Literal('plan:build:implement:complete'), planId: Type.String() }),
  Type.Object({
    type: Type.Literal('plan:build:files_changed'),
    planId: Type.String(),
    files: Type.Array(Type.String()),
    diffs: Type.Optional(
      Type.Array(Type.Object({ path: Type.String(), diff: Type.String() })),
    ),
    baseBranch: Type.Optional(Type.String()),
  }),
  Type.Object({ type: Type.Literal('plan:build:review:start'), planId: Type.String(), ...ReviewCycleRoundField }),
  Type.Object({
    type: Type.Literal('plan:build:review:complete'), planId: Type.String(), issues: Type.Array(ReviewIssueSchema), ...ReviewCycleRoundField,
  }),
  Type.Object({
    type: Type.Literal('plan:build:review:parallel:start'), planId: Type.String(), perspectives: Type.Array(ReviewPerspectiveKeySchema), ...ReviewCycleRoundField,
  }),
  Type.Object({
    type: Type.Literal('plan:build:review:parallel:perspective:start'), planId: Type.String(), perspective: ReviewPerspectiveKeySchema, ...ReviewCycleRoundField,
  }),
  Type.Object({
    type: Type.Literal('plan:build:review:parallel:perspective:complete'),
    planId: Type.String(),
    perspective: ReviewPerspectiveKeySchema,
    issues: Type.Array(ReviewIssueSchema),
    ...ReviewCycleRoundField,
  }),
  Type.Object({
    type: Type.Literal('plan:build:review:parallel:perspective:error'),
    planId: Type.String(),
    perspective: ReviewPerspectiveKeySchema,
    error: Type.String(),
    ...ReviewCycleRoundField,
  }),
  Type.Object({
    type: Type.Literal('plan:build:review:fix:start'),
    planId: Type.String(),
    issueCount: Type.Number(),
    ...ReviewCycleRoundField,
  }),
  Type.Object({
    type: Type.Literal('plan:build:review:fix:complete'),
    planId: Type.String(),
    ...ReviewCycleRoundField,
    // --- eforge:region review-issue-traceability ---
    issueReferences: Type.Optional(Type.Array(ReviewFixIssueReferenceSchema)),
    // --- eforge:endregion review-issue-traceability ---
  }),
  Type.Object({
    type: Type.Literal('plan:build:review:fix:continuation'),
    planId: Type.String(),
    attempt: Type.Number(),
    maxContinuations: Type.Number(),
    ...ReviewCycleRoundField,
  }),
  Type.Object({ type: Type.Literal('plan:build:evaluate:start'), planId: Type.String(), ...ReviewCycleRoundField }),
  Type.Object({
    type: Type.Literal('plan:build:evaluate:continuation'),
    planId: Type.String(),
    attempt: Type.Number(),
    maxContinuations: Type.Number(),
    ...ReviewCycleRoundField,
  }),
  Type.Object({
    type: Type.Literal('plan:build:evaluate:complete'),
    planId: Type.String(),
    accepted: Type.Number(),
    rejected: Type.Number(),
    ...ReviewCycleRoundField,
    resolvedIssueOutcomes: Type.Optional(Type.Number()), falsePositiveIssueOutcomes: Type.Optional(Type.Number()), unresolvedIssueOutcomes: Type.Optional(Type.Number()), unresolvedNonBlockingIssueOutcomes: Type.Optional(Type.Number()), needsHumanReviewIssueOutcomes: Type.Optional(Type.Number()), acceptedRiskIssueOutcomes: Type.Optional(Type.Number()), splitToFollowupIssueOutcomes: Type.Optional(Type.Number()), blockingIssueOutcomes: Type.Optional(Type.Number()),
    verdicts: Type.Optional(
      Type.Array(
        Type.Object({
          file: Type.String(), action: Type.Union([Type.Literal('accept'), Type.Literal('reject'), Type.Literal('review')]), reason: Type.String(),
          hunk: Type.Optional(Type.Integer({ minimum: 1 })), issueOutcome: Type.Optional(EvaluationIssueOutcomeSchema), retryGuidance: Type.Optional(Type.String()),
          // --- eforge:region review-issue-traceability ---
          issueIds: Type.Optional(Type.Array(ReviewIssueIdSchema)),
          // --- eforge:endregion review-issue-traceability ---
        }),
      ),
    ),
  }),
  Type.Object({ type: Type.Literal('plan:build:doc-author:start'), planId: Type.String() }),
  Type.Object({
    type: Type.Literal('plan:build:doc-author:complete'),
    planId: Type.String(),
    docsAuthored: Type.Number(),
  }),
  Type.Object({ type: Type.Literal('plan:build:doc-sync:start'), planId: Type.String() }),
  Type.Object({
    type: Type.Literal('plan:build:doc-sync:complete'),
    planId: Type.String(),
    docsSynced: Type.Number(),
  }),
  Type.Object({
    type: Type.Literal('plan:build:test:ownership:violation'),
    planId: Type.String(),
    stage: Type.Union([Type.Literal('implement'), Type.Literal('test-write'), Type.Literal('test')]),
    declaredOwner: Type.Union([TestOwnershipSchema, Type.Literal('unspecified')]),
    changedPaths: Type.Array(Type.String()),
    reason: Type.String(),
  }),
  Type.Object({ type: Type.Literal('plan:build:test:write:start'), planId: Type.String() }),
  Type.Object({
    type: Type.Literal('plan:build:test:write:complete'),
    planId: Type.String(),
    testsWritten: Type.Number(),
  }),
  Type.Object({ type: Type.Literal('plan:build:test:start'), planId: Type.String() }),
  Type.Object({
    type: Type.Literal('plan:build:test:complete'),
    planId: Type.String(),
    passed: Type.Number(),
    failed: Type.Number(),
    testBugsFixed: Type.Number(),
    productionIssues: Type.Array(TestIssueSchema),
  }),
  Type.Object({ type: Type.Literal('plan:build:complete'), planId: Type.String() }),
  Type.Object({
    type: Type.Literal('plan:build:recovery:start'),
    planId: Type.String(),
    blockerKind: Type.Union([Type.Literal('review'), Type.Literal('test')]),
    issueCount: Type.Number(),
    maxAttempts: Type.Number(),
    attemptsRemaining: Type.Number(),
  }),
  Type.Object({
    type: Type.Literal('plan:build:recovery:attempt:start'),
    planId: Type.String(),
    blockerKind: Type.Union([Type.Literal('review'), Type.Literal('test')]),
    attempt: Type.Number(),
    maxAttempts: Type.Number(),
    attemptsRemaining: Type.Number(),
  }),
  Type.Object({
    type: Type.Literal('plan:build:recovery:attempt:result'),
    planId: Type.String(),
    blockerKind: Type.Union([Type.Literal('review'), Type.Literal('test')]),
    attempt: Type.Number(),
    maxAttempts: Type.Number(),
    blockersCleared: Type.Boolean(),
    attemptsRemaining: Type.Number(),
  }),
  Type.Object({
    type: Type.Literal('plan:build:recovery:skip'),
    planId: Type.String(),
    blockerKind: Type.Union([Type.Literal('review'), Type.Literal('test')]),
    reason: Type.Union([
      Type.Literal('not-active-plan'),
      Type.Literal('manual-gate'),
      Type.Literal('human-review-gate'),
      Type.Literal('cross-plan-blocker'),
      Type.Literal('upstream-or-base-owned'),
      Type.Literal('low-confidence'),
      Type.Literal('incomplete-classification'),
      Type.Literal('unsupported-blocker'),
      Type.Literal('unsafe-worktree'),
      Type.Literal('budget-exhausted'),
      Type.Literal('stale-pass-data'),
    ]),
    details: Type.String(),
    attemptsRemaining: Type.Number(),
  }),
  Type.Object({
    type: Type.Literal('plan:build:recovery:exhausted'),
    planId: Type.String(),
    blockerKind: Type.Union([Type.Literal('review'), Type.Literal('test')]),
    attemptsUsed: Type.Number(),
    maxAttempts: Type.Number(),
    details: Type.String(),
  }),
  Type.Object({
    type: Type.Literal('plan:build:failed'),
    planId: Type.String(),
    error: Type.String(),
    terminalSubtype: Type.Optional(AgentTerminalSubtypeSchema),
  }),
  Type.Object({
    type: Type.Literal('plan:build:progress'),
    planId: Type.String(),
    message: Type.String(),
  }),
  // --- eforge:endregion per-plan-build-events ---

  // --- eforge:region plan-lifecycle-events ---
  // Plan lifecycle state events
  Type.Object({
    type: Type.Literal('plan:status:change'),
    planId: Type.String(),
    status: PlanStatusSchema,
  }),
  Type.Object({
    type: Type.Literal('plan:error:set'),
    planId: Type.String(),
    error: Type.String(),
  }),
  Type.Object({
    type: Type.Literal('plan:error:clear'),
    planId: Type.String(),
  }),
  // --- eforge:endregion plan-lifecycle-events ---

  // --- eforge:region orchestration-events ---
  // Orchestration
  Type.Object({ type: Type.Literal('schedule:start'), planIds: Type.Array(Type.String()) }),
  Type.Object({
    type: Type.Literal('plan:schedule:ready'),
    planId: Type.String(),
    reason: Type.String(),
  }),
  Type.Object({ type: Type.Literal('plan:merge:start'), planId: Type.String() }),
  Type.Object({
    type: Type.Literal('plan:merge:complete'),
    planId: Type.String(),
    commitSha: Type.Optional(Type.String()),
  }),
  Type.Object({ type: Type.Literal('plan:merge:resolve:start'), planId: Type.String() }),
  Type.Object({
    type: Type.Literal('plan:merge:resolve:complete'),
    planId: Type.String(),
    resolved: Type.Boolean(),
  }),
  Type.Object({
    type: Type.Literal('merge:finalize:start'),
    featureBranch: Type.String(),
    baseBranch: Type.String(),
  }),
  Type.Object({
    type: Type.Literal('merge:finalize:complete'),
    featureBranch: Type.String(),
    baseBranch: Type.String(),
    commitSha: Type.Optional(Type.String()),
  }),
  Type.Object({
    type: Type.Literal('merge:finalize:skipped'),
    featureBranch: Type.String(),
    baseBranch: Type.String(),
    reason: Type.String(),
  }),
  // --- eforge:endregion orchestration-events ---

  // --- eforge:region landing-events ---
  // Landing action lifecycle events — uniform family for all three landing actions.
  // merge:finalize:* is additionally emitted for the merge action (backward compat).
  Type.Object({
    type: Type.Literal('landing:start'),
    action: LandingActionSchema,
    featureBranch: Type.String(),
    baseBranch: Type.String(),
    trunkBranch: Type.Optional(Type.String()),
    workflow: Type.Optional(Type.Union([
      Type.Literal('trunk-pr'),
      Type.Literal('trunk-local-merge'),
      Type.Literal('feature-pr'),
      Type.Literal('feature-local-merge'),
      Type.Literal('leave-branch'),
    ])),
  }),
  Type.Object({
    type: Type.Literal('landing:complete'),
    action: LandingActionSchema,
    featureBranch: Type.String(),
    baseBranch: Type.String(),
    commitSha: Type.Optional(Type.String()),
    prUrl: Type.Optional(Type.String()),
  }),
  Type.Object({
    type: Type.Literal('landing:skipped'),
    action: LandingActionSchema,
    featureBranch: Type.String(),
    baseBranch: Type.String(),
    reason: Type.String(),
  }),

  // PR auto-merge lifecycle events — emitted after `landing:complete` (action=pr) when
  // auto-merge is attempted. Non-fatal: `landingSucceeded` remains true even on failure.
  Type.Object({
    type: Type.Literal('landing:auto-merge:start'),
    featureBranch: Type.String(),
    baseBranch: Type.Optional(Type.String()),
    prUrl: Type.String(),
  }),
  Type.Object({
    type: Type.Literal('landing:auto-merge:complete'),
    featureBranch: Type.String(),
    baseBranch: Type.Optional(Type.String()),
    prUrl: Type.String(),
  }),
  Type.Object({
    type: Type.Literal('landing:auto-merge:skipped'),
    featureBranch: Type.String(),
    baseBranch: Type.Optional(Type.String()),
    prUrl: Type.Optional(Type.String()),
    reason: Type.String(),
  }),
  // --- eforge:endregion landing-events ---

  // --- eforge:region merge-worktree-events ---
  // Merge worktree lifecycle events
  Type.Object({
    type: Type.Literal('merge:worktree:set'),
    path: Type.String(),
  }),
  Type.Object({
    type: Type.Literal('merge:worktree:clear'),
  }),
  // --- eforge:endregion merge-worktree-events ---
] as const;

// --- eforge:region build-resume-events ---
export const buildResumeEventVariants = [
  Type.Object({ type: Type.Literal('build:terminal-failure'), runId: Type.String(),
    failure: TerminalFailureEnvelopeSchema }),
  Type.Object({
    type: Type.Literal('build:resume:start'),
    prdId: Type.String(),
    setName: Type.String(),
    featureBranch: Type.String(),
  }),
  Type.Object({
    type: Type.Literal('build:resume:state'),
    seededMerged: Type.Array(Type.String()),
    seededPending: Type.Array(Type.String()),
    featureBranch: Type.String(),
    landedCommitCount: Type.Number(),
    diffStat: Type.String(),
  }),
  Type.Object({
    type: Type.Literal('build:resume:ineligible'),
    reason: Type.String(),
    checkedPath: Type.Optional(Type.String()),
  }),
  BuildResumeArtifactsEventSchema,
  Type.Object({
    type: Type.Literal('build:resume:complete'),
    prdId: Type.String(),
    setName: Type.String(),
  }),
] as const;
// --- eforge:endregion build-resume-events ---

