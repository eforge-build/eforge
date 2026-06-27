import { Type } from '@sinclair/typebox';
import { MAX_REVIEW_ISSUE_METADATA_STRING_LENGTH } from '../../event-validation.js';

// --- eforge:region core-classification-schemas ---
export const AgentRoleSchema = Type.Union([
  Type.Literal('planner'),
  Type.Literal('builder'),
  Type.Literal('reviewer'),
  Type.Literal('review-fixer'),
  Type.Literal('evaluator'),
  Type.Literal('module-planner'),
  Type.Literal('plan-reviewer'),
  Type.Literal('plan-evaluator'),
  Type.Literal('architecture-reviewer'),
  Type.Literal('architecture-evaluator'),
  Type.Literal('cohesion-reviewer'),
  Type.Literal('cohesion-evaluator'),
  Type.Literal('validation-fixer'),
  Type.Literal('merge-conflict-resolver'),
  Type.Literal('staleness-assessor'),
  Type.Literal('formatter'),
  Type.Literal('doc-author'),
  Type.Literal('doc-syncer'),
  Type.Literal('test-writer'),
  Type.Literal('tester'),
  Type.Literal('prd-validator'),
  Type.Literal('dependency-detector'),
  Type.Literal('pipeline-composer'),
  Type.Literal('gap-closer'),
  Type.Literal('recovery-analyst'),
]);
export const AgentTerminalSubtypeSchema = Type.Union([
  Type.Literal('error_max_turns'),
  Type.Literal('error_max_budget_usd'),
  Type.Literal('error_max_structured_output_retries'),
  Type.Literal('error_during_execution'),
  Type.Literal('error_pi_tool_infrastructure'),
  Type.Literal('error_context_window'),
  Type.Literal('error_transient_transport'),
]);
export const ReviewPerspectiveSchema = Type.Union([
  Type.Literal('code'),
  Type.Literal('security'),
  Type.Literal('api'),
  Type.Literal('docs'),
  Type.Literal('test'),
  Type.Literal('verify'),
]);
export const ReviewPerspectiveKeySchema = Type.String({
  pattern: '^[a-z][a-z0-9-]{0,63}$',
  description: 'A review perspective key: lowercase slug starting with a letter, 1–64 chars (e.g. "code", "accessibility")',
});
export const LandingActionSchema = Type.Union([
  Type.Literal('pr'),
  Type.Literal('merge'),
  Type.Literal('leave'),
]);
export const EvaluationIssueOutcomeSchema = Type.Union(['resolved', 'false_positive', 'unresolved', 'unresolved_blocking', 'unresolved_nonblocking', 'needs_human_review', 'accepted_risk', 'split_to_followup'].map(v => Type.Literal(v)), { description: 'Evaluator issue disposition separate from patch action. Missing values are interpreted conservatively by the engine.' });
export const ReviewCycleRoundField = { round: Type.Optional(Type.Integer({ minimum: 0 })) } as const;
// --- eforge:region review-issue-traceability ---
export const ReviewIssueIdSchema = Type.String({ minLength: 1, maxLength: MAX_REVIEW_ISSUE_METADATA_STRING_LENGTH, pattern: '\\S' });
export const ReviewFixIssueStatusSchema = Type.Union([
  Type.Literal('addressed'),
  Type.Literal('deferred'),
  Type.Literal('obsolete'),
]);
export const ReviewFixIssueReferenceSchema = Type.Object({
  issueId: ReviewIssueIdSchema,
  status: ReviewFixIssueStatusSchema,
  note: Type.Optional(Type.String({ minLength: 1, maxLength: MAX_REVIEW_ISSUE_METADATA_STRING_LENGTH })),
});
// --- eforge:endregion review-issue-traceability ---
// --- eforge:endregion core-classification-schemas ---

// --- eforge:region stack-schemas ---
export const StackProviderSchema = Type.Literal('git-spice');
export const StackProviderOperationKindSchema = Type.Union([
  Type.Literal('branch-restack'),
  Type.Literal('stack-restack'),
  Type.Literal('repo-sync'),
  Type.Literal('unknown'),
]);
export const StackProviderConflictKindSchema = Type.Union([
  Type.Literal('git-rebase'),
  Type.Literal('git-merge'),
  Type.Literal('unknown'),
]);
export const LandingPublicationActionSchema = Type.Union([
  Type.Literal('pr'),
  Type.Literal('merge'),
  Type.Literal('leave'),
]);
export const StackLayerStatusSchema = Type.Union([
  Type.Literal('pending'),
  Type.Literal('building'),
  Type.Literal('built'),
  Type.Literal('merged'),
  Type.Literal('landed'),
  Type.Literal('failed'),
]);
export const StackArtifactRefSchema = Type.Object({
  branch: Type.String(),
  commitSha: Type.Optional(Type.String()),
  prUrl: Type.Optional(Type.String()),
});
export const StackLandingStatusSchema = Type.Union([
  Type.Literal('started'),
  Type.Literal('complete'),
  Type.Literal('skipped'),
  Type.Literal('failed'),
]);
export const StackLayerLandingWireSchema = Type.Object({
  action: LandingPublicationActionSchema,
  status: StackLandingStatusSchema,
  prUrl: Type.Optional(Type.String()),
  reason: Type.Optional(Type.String()),
  originalBaseBranch: Type.Optional(Type.String()),
  effectiveBaseBranch: Type.Optional(Type.String()),
  baseRepairReason: Type.Optional(Type.Literal('parent-artifact-already-integrated')),
  startedAt: Type.String(),
  completedAt: Type.Optional(Type.String()),
});
export const StackLayerWireSchema = Type.Object({
  prdId: Type.String(),
  stackId: Type.String(),
  parentPrdId: Type.Optional(Type.String()),
  provider: StackProviderSchema,
  branch: Type.String(),
  baseBranch: Type.Optional(Type.String()),
  artifact: Type.Optional(StackArtifactRefSchema),
  landingAction: Type.Optional(LandingPublicationActionSchema),
  landing: Type.Optional(StackLayerLandingWireSchema),
  status: StackLayerStatusSchema,
  recordedAt: Type.String(),
  updatedAt: Type.String(),
});
// --- eforge:endregion stack-schemas ---

// --- eforge:region planning-policy-schemas ---
export const StalenessVerdictSchema = Type.Union([
  Type.Literal('proceed'),
  Type.Literal('revise'),
  Type.Literal('obsolete'),
]);
export const RecoveryVerdictSchema = Type.Object({
  verdict: Type.Union([
    Type.Literal('retry'),
    Type.Literal('continue-repair'),
    Type.Literal('abandon'),
    Type.Literal('manual'),
  ]),
  confidence: Type.Union([Type.Literal('low'), Type.Literal('medium'), Type.Literal('high')]),
  rationale: Type.String(),
  completedWork: Type.Array(Type.String()),
  remainingWork: Type.Array(Type.String()),
  risks: Type.Array(Type.String()),
  partial: Type.Optional(Type.Boolean()),
  recoveryError: Type.Optional(Type.String()),
  recommendationSource: Type.Optional(Type.Union([
    Type.Literal('deterministic'),
    Type.Literal('analyst'),
    Type.Literal('manual-fallback'),
  ])),
  recommendationRationale: Type.Optional(Type.String()),
  verdictInvalidationReason: Type.Optional(Type.String()),
});
export const ShardScopeSchema = Type.Object({
  id: Type.String(),
  roots: Type.Optional(Type.Array(Type.String())),
  files: Type.Optional(Type.Array(Type.String())),
});
export const BuildStageSpecSchema = Type.Union([Type.String(), Type.Array(Type.String())]);
export const PolicyGateKindSchema = Type.Union([
  Type.Literal('queue-dispatch'),
  Type.Literal('plan-merge'),
  Type.Literal('final-merge'),
]);
export const PolicyGateMethodSchema = Type.Union([
  Type.Literal('beforeQueueDispatch'),
  Type.Literal('beforePlanMerge'),
  Type.Literal('beforeFinalMerge'),
]);
export const PolicyGateFailurePolicySchema = Type.Union([
  Type.Literal('fail-open'),
  Type.Literal('fail-closed'),
]);
export const PolicyGateAllowDecisionFields = {
  decision: Type.Literal('allow'),
  reason: Type.Optional(Type.String()),
};
export const PolicyGateBlockDecisionFields = {
  decision: Type.Literal('block'),
  reason: Type.String({ minLength: 1 }),
};
export const PolicyGateRequireApprovalDecisionFields = {
  decision: Type.Literal('require-approval'),
  reason: Type.String({ minLength: 1 }),
};
export const PolicyGateBaseProvenanceFields = {
  extensionName: Type.String(),
  extensionPath: Type.String(),
  registrationIndex: Type.Integer({ minimum: 0 }),
  failurePolicy: PolicyGateFailurePolicySchema,
};
export const QueueDispatchPolicyGateProvenanceFields = {
  gateKind: Type.Literal('queue-dispatch'),
  method: Type.Literal('beforeQueueDispatch'),
  ...PolicyGateBaseProvenanceFields,
  prdId: Type.String(),
  prdTitle: Type.Optional(Type.String()),
};
export const PlanMergePolicyGateProvenanceFields = {
  gateKind: Type.Literal('plan-merge'),
  method: Type.Literal('beforePlanMerge'),
  ...PolicyGateBaseProvenanceFields,
  planId: Type.String(),
};
export const FinalMergePolicyGateProvenanceFields = {
  gateKind: Type.Literal('final-merge'),
  method: Type.Literal('beforeFinalMerge'),
  ...PolicyGateBaseProvenanceFields,
  featureBranch: Type.String(),
  baseBranch: Type.String(),
  planIds: Type.Optional(Type.Array(Type.String())),
};
export const ReviewProfileConfigSchema = Type.Object({
  strategy: Type.Union([Type.Literal('auto'), Type.Literal('single'), Type.Literal('parallel')]),
  perspectives: Type.Array(ReviewPerspectiveKeySchema),
  maxRounds: Type.Number(),
  evaluatorStrictness: Type.Union([
    Type.Literal('strict'),
    Type.Literal('standard'),
    Type.Literal('lenient'),
  ]),
});
export const PipelineCompositionSchema = Type.Object({
  scope: Type.Union([
    Type.Literal('errand'),
    Type.Literal('excursion'),
    Type.Literal('expedition'),
  ]),
  compile: Type.Array(Type.String()),
  defaultBuild: Type.Array(BuildStageSpecSchema),
  defaultReview: ReviewProfileConfigSchema,
  rationale: Type.String(),
});
export const PrdValidationGapSchema = Type.Object({
  requirement: Type.String(),
  explanation: Type.String(),
  complexity: Type.Optional(
    Type.Union([
      Type.Literal('trivial'),
      Type.Literal('moderate'),
      Type.Literal('significant'),
    ]),
  ),
});
// --- eforge:endregion planning-policy-schemas ---

// --- eforge:region review-validation-schemas ---
export const AcceptanceCriterionVerdictSchema = Type.Object({
  criterion: Type.String({ minLength: 1 }),
  verdict: Type.Union([
    Type.Literal('pass'),
    Type.Literal('fail'),
    Type.Literal('unknown'),
  ]),
  evidence: Type.String({ minLength: 1 }),
});
export const AcceptanceCriteriaConflictSchema = Type.Object({
  criterion: Type.String({ minLength: 1 }),
  evidence: Type.String({ minLength: 1 }),
  conflictsWith: Type.String({ minLength: 1 }),
  scope: Type.Union([Type.Literal('narrow'), Type.Literal('broad'), Type.Literal('unknown')]),
  recommendedAction: Type.Union([Type.Literal('revise_acceptance_criteria'), Type.Literal('manual_review')]),
});
export const ExpeditionModuleSchema = Type.Object({
  id: Type.String(),
  description: Type.String(),
  dependsOn: Type.Array(Type.String()),
});
export const EforgeResultSchema = Type.Object({
  status: Type.Union([
    Type.Literal('completed'),
    Type.Literal('failed'),
    Type.Literal('skipped'),
  ]),
  summary: Type.String(),
});
export const ClarificationQuestionSchema = Type.Object({
  id: Type.String(),
  question: Type.String(),
  context: Type.Optional(Type.String()),
  options: Type.Optional(Type.Array(Type.String())),
  default: Type.Optional(Type.String()),
});
export const ValidationRepairClassSchema = Type.Union([
  Type.Literal('narrow'),
  Type.Literal('structural'),
  Type.Literal('manual'),
  Type.Literal('followup'),
]);
export const ValidationRuntimeFailureKindSchema = Type.Union([
  Type.Literal('result'),
  Type.Literal('command'),
  Type.Literal('timeout'),
  Type.Literal('exception'),
  Type.Literal('unexpected-return'),
]);
export const JsonSafeMetadataSchema = Type.Recursive((Self) => Type.Union([
  Type.Null(),
  Type.Boolean(),
  Type.Number(),
  Type.String({ maxLength: MAX_REVIEW_ISSUE_METADATA_STRING_LENGTH }),
  Type.Array(Self),
  Type.Record(Type.String(), Self),
]));
export const ReviewIssueSchema = Type.Object({
  // --- eforge:region review-issue-traceability ---
  issueId: Type.Optional(ReviewIssueIdSchema),
  // --- eforge:endregion review-issue-traceability ---
  severity: Type.Union([Type.Literal('critical'), Type.Literal('warning'), Type.Literal('suggestion')]),
  category: Type.String(),
  file: Type.String(),
  line: Type.Optional(Type.Number()),
  description: Type.String(),
  fix: Type.Optional(Type.String()), retryGuidance: Type.Optional(Type.String()),
  failureKind: Type.Optional(Type.String()), repairClass: Type.Optional(ValidationRepairClassSchema),
  metadata: Type.Optional(Type.Record(Type.String(), JsonSafeMetadataSchema)), validationProviderName: Type.Optional(Type.String()),
  runtimeFailureKind: Type.Optional(ValidationRuntimeFailureKindSchema),
});
export const TestIssueSchema = Type.Object({
  severity: Type.Union([Type.Literal('critical'), Type.Literal('warning')]),
  category: Type.Union([
    Type.Literal('production-bug'),
    Type.Literal('missing-behavior'),
    Type.Literal('regression'),
  ]),
  file: Type.String(),
  testFile: Type.String(),
  description: Type.String(),
  testOutput: Type.Optional(Type.String()),
  fix: Type.Optional(Type.String()),
});
// --- eforge:endregion review-validation-schemas ---

// --- eforge:region orchestration-state-schemas ---
export const PlanFileSchema = Type.Object({
  id: Type.String(),
  name: Type.String(),
  dependsOn: Type.Array(Type.String()),
  branch: Type.String(),
  migrations: Type.Optional(
    Type.Array(
      Type.Object({ timestamp: Type.String(), description: Type.String() }),
    ),
  ),
  agents: Type.Optional(
    Type.Record(
      Type.String(),
      Type.Object({
        effort: Type.Optional(Type.String()),
        thinking: Type.Optional(
          Type.Union([Type.Boolean(), Type.Record(Type.String(), Type.Unknown())]),
        ),
        rationale: Type.Optional(Type.String()),
        tier: Type.Optional(Type.String()),
        shards: Type.Optional(Type.Array(ShardScopeSchema)),
      }),
    ),
  ),
  body: Type.String(),
  filePath: Type.String(),
  warnings: Type.Optional(Type.Array(Type.String())),
});
export const OrchestrationPlanConfigSchema = Type.Object({ id: Type.String(), name: Type.String(), dependsOn: Type.Array(Type.String()), branch: Type.String(), build: Type.Array(BuildStageSpecSchema), review: ReviewProfileConfigSchema, maxContinuations: Type.Optional(Type.Number()), agents: Type.Optional(Type.Record(Type.String(), Type.Object({ effort: Type.Optional(Type.String()), thinking: Type.Optional(Type.Union([Type.Boolean(), Type.Record(Type.String(), Type.Unknown())])), rationale: Type.Optional(Type.String()), tier: Type.Optional(Type.String()) }))) });
export const OrchestrationConfigSchema = Type.Object({
  name: Type.String(),
  description: Type.String(),
  created: Type.String(),
  mode: Type.Union([
    Type.Literal('errand'),
    Type.Literal('excursion'),
    Type.Literal('expedition'),
  ]),
  baseBranch: Type.String(),
  diffBaseRef: Type.Optional(Type.String()),
  pipeline: PipelineCompositionSchema,
  plans: Type.Array(OrchestrationPlanConfigSchema),
  validate: Type.Optional(Type.Array(Type.String())),
  warnings: Type.Optional(Type.Array(Type.String())),
});
export const BuildResumeArtifactSourceSchema = Type.Object({ label: Type.String(), content: Type.Optional(Type.String()), path: Type.Optional(Type.String()) });
export const BuildResumeArtifactPlanSchema = Type.Object({ id: Type.String(), name: Type.String(), body: Type.String(), dependsOn: Type.Array(Type.String()), branch: Type.Optional(Type.String()), build: Type.Optional(Type.Array(BuildStageSpecSchema)), review: Type.Optional(ReviewProfileConfigSchema) });
export const BuildResumeArtifactsEventSchema = Type.Object({ type: Type.Literal('build:resume:artifacts'), prdId: Type.String(), setName: Type.String(), featureBranch: Type.String(), artifactSource: Type.Union([Type.Literal('merge-worktree'), Type.Literal('branch-history')]), artifactCommit: Type.Optional(Type.String()), source: BuildResumeArtifactSourceSchema, orchestration: OrchestrationConfigSchema, plans: Type.Array(BuildResumeArtifactPlanSchema) });
export const PlanStatusSchema = Type.Union([
  Type.Literal('pending'),
  Type.Literal('running'),
  Type.Literal('completed'),
  Type.Literal('failed'),
  Type.Literal('blocked'),
  Type.Literal('merged'),
]);
export const PlanStateSchema = Type.Object({
  status: PlanStatusSchema,
  worktreePath: Type.Optional(Type.String()),
  branch: Type.String(),
  dependsOn: Type.Array(Type.String()),
  merged: Type.Boolean(),
  error: Type.Optional(Type.String()),
});
export const EforgeStateSchema = Type.Object({
  setName: Type.String(),
  status: Type.Union([
    Type.Literal('running'),
    Type.Literal('completed'),
    Type.Literal('failed'),
  ]),
  startedAt: Type.String(),
  completedAt: Type.Optional(Type.String()),
  baseBranch: Type.String(),
  featureBranch: Type.Optional(Type.String()),
  worktreeBase: Type.String(),
  mergeWorktreePath: Type.Optional(Type.String()),
  plans: Type.Record(Type.String(), PlanStateSchema),
  completedPlans: Type.Array(Type.String()),
});
// --- eforge:endregion orchestration-state-schemas ---

// --- eforge:region agent-summary-schemas ---
export const AgentResultDataSchema = Type.Object({
  durationMs: Type.Number(),
  durationApiMs: Type.Number(),
  numTurns: Type.Number(),
  totalCostUsd: Type.Number(),
  usage: Type.Object({
    input: Type.Number(),
    output: Type.Number(),
    total: Type.Number(),
    cacheRead: Type.Number(),
    cacheCreation: Type.Number(),
  }),
  modelUsage: Type.Record(
    Type.String(),
    Type.Object({
      inputTokens: Type.Number(),
      outputTokens: Type.Number(),
      cacheReadInputTokens: Type.Number(),
      cacheCreationInputTokens: Type.Number(),
      costUSD: Type.Number(),
    }),
  ),
  harness: Type.Optional(Type.Union([Type.Literal('claude-sdk'), Type.Literal('pi')])),
  provider: Type.Optional(Type.String()),
  resultText: Type.Optional(Type.String()),
});
export const ReconciliationReportSchema = Type.Object({
  valid: Type.Array(Type.String()),
  missing: Type.Array(Type.String()),
  corrupt: Type.Array(Type.String()),
  cleared: Type.Array(Type.String()),
});
export const EforgeStatusSchema = Type.Object({
  running: Type.Boolean(),
  setName: Type.Optional(Type.String()),
  plans: Type.Record(Type.String(), PlanStatusSchema),
  completedPlans: Type.Array(Type.String()),
});
export const LandedCommitSchema = Type.Object({
  sha: Type.String(),
  subject: Type.String(),
  author: Type.String(),
  date: Type.String(),
});
export const PlanSummaryEntrySchema = Type.Object({
  planId: Type.String(),
  status: Type.String(),
  mergedAt: Type.Optional(Type.String()),
  error: Type.Optional(Type.String()),
  terminalSubtype: Type.Optional(Type.String()),
  commitSha: Type.Optional(Type.String()),
  testPassed: Type.Optional(Type.Integer({ minimum: 0 })),
  testFailed: Type.Optional(Type.Integer({ minimum: 0 })),
  completedAt: Type.Optional(Type.String()),
  toolUseCount: Type.Optional(Type.Integer({ minimum: 0 })),
});
export const FailingPlanEntrySchema = Type.Object({
  planId: Type.String(),
  agentId: Type.Optional(Type.String()),
  agentRole: Type.Optional(Type.String()),
  errorMessage: Type.Optional(Type.String()),
  terminalSubtype: Type.Optional(Type.String()),
  toolUseCount: Type.Optional(Type.Integer({ minimum: 0 })),
});
export const ReviewFailureActionSchema = Type.Union([Type.Literal('accept'), Type.Literal('reject'), Type.Literal('review')]);
export const ReviewFailureEvaluationVerdictSchema = Type.Object({ file: Type.String(), action: ReviewFailureActionSchema, reason: Type.String(), hunk: Type.Optional(Type.Integer({ minimum: 1 })), issueOutcome: Type.Optional(EvaluationIssueOutcomeSchema), retryGuidance: Type.Optional(Type.String()),
  // --- eforge:region review-issue-traceability ---
  issueIds: Type.Optional(Type.Array(ReviewIssueIdSchema)),
  // --- eforge:endregion review-issue-traceability ---
});
export const ReviewFailureDetailsSchema = Type.Object({ planId: Type.String(), issues: Type.Array(ReviewIssueSchema), evaluation: Type.Optional(Type.Object({ accepted: Type.Integer({ minimum: 0 }), rejected: Type.Integer({ minimum: 0 }), review: Type.Integer({ minimum: 0 }), verdicts: Type.Array(ReviewFailureEvaluationVerdictSchema) })) });
export const TerminalFailureScopeSchema = Type.Union([Type.Literal('plan'), Type.Literal('post-merge-validation'), Type.Literal('prd-validation'), Type.Literal('acceptance-validation'), Type.Literal('artifact-recording'), Type.Literal('landing'), Type.Literal('daemon'), Type.Literal('compile'), Type.Literal('unknown')]);
export const TFLandingSchema = Type.Object({ status: Type.String(), action: Type.Optional(Type.String()), reason: Type.Optional(Type.String()) });
export const TerminalFailureEnvelopeSchema = Type.Object({
  scope: TerminalFailureScopeSchema, message: Type.String(),
  authoritative: Type.Boolean(), planId: Type.Optional(Type.String()),
  terminalSubtype: Type.Optional(AgentTerminalSubtypeSchema),
  stage: Type.Optional(Type.String()), phaseSummary: Type.Optional(Type.String()),
  phaseStatus: Type.Optional(Type.String()), eventType: Type.Optional(Type.String()),
  sourceEventType: Type.Optional(Type.String()), sourceEventId: Type.Optional(Type.Integer()), sourceEventTimestamp: Type.Optional(Type.String()),
  landing: Type.Optional(TFLandingSchema), validationPassed: Type.Optional(Type.Boolean()), prdValidationPassed: Type.Optional(Type.Boolean()), acceptanceValidationPassed: Type.Optional(Type.Boolean()),
});
export const BuildFailureSummarySchema = Type.Object({
  prdId: Type.String(),
  setName: Type.String(),
  featureBranch: Type.String(),
  baseBranch: Type.String(),
  plans: Type.Array(PlanSummaryEntrySchema),
  failingPlan: FailingPlanEntrySchema,
  landedCommits: Type.Array(LandedCommitSchema),
  diffStat: Type.String(),
  modelsUsed: Type.Array(Type.String()),
  failedAt: Type.String(),
  partial: Type.Optional(Type.Boolean()),
  prdContent: Type.Optional(Type.String()),
  terminalFailure: Type.Optional(Type.Partial(TerminalFailureEnvelopeSchema)),
  acceptanceValidation: Type.Optional(Type.Object({
    passed: Type.Boolean(),
    total: Type.Number(),
    pass: Type.Number(),
    fail: Type.Number(),
    unknown: Type.Number(),
    verdicts: Type.Array(AcceptanceCriterionVerdictSchema),
    waivers: Type.Optional(Type.Array(Type.String())), conflicts: Type.Optional(Type.Array(AcceptanceCriteriaConflictSchema)),
  })),
  validationCommands: Type.Optional(Type.Array(Type.Object({
    command: Type.String(),
    exitCode: Type.Number(),
    output: Type.Optional(Type.String()),
  }))),
  landing: Type.Optional(TFLandingSchema),
  failingPlans: Type.Optional(Type.Array(FailingPlanEntrySchema)),
  reviewFailure: Type.Optional(ReviewFailureDetailsSchema),
});
// --- eforge:endregion agent-summary-schemas ---


export const QueueItemCapabilitySchema = Type.Object({ allowed: Type.Boolean(), reason: Type.Optional(Type.String()) });
export const QueueItemCapabilitiesSchema = Type.Object({ priority: QueueItemCapabilitySchema, remove: QueueItemCapabilitySchema, dependencyOverride: QueueItemCapabilitySchema, hold: QueueItemCapabilitySchema, unhold: QueueItemCapabilitySchema, cascadeRemove: QueueItemCapabilitySchema, cancel: QueueItemCapabilitySchema, cascadeCancel: QueueItemCapabilitySchema });
export const QueueItemHoldSchema = Type.Object({ held: Type.Boolean(), reason: Type.Optional(Type.String()), heldAt: Type.Optional(Type.String()) });
export const FailedEnqueueProvenanceSchema = Type.Object({ label: Type.String() }, { additionalProperties: false });
export const FailedEnqueueRecoveryCommandSchema = Type.Object({ executable: Type.String(), args: Type.Array(Type.String()) }, { additionalProperties: false });
export const FailedEnqueueInfoSchema = Type.Object({ runId: Type.String(), sessionId: Type.Optional(Type.String()), sourceLabel: Type.String(), provenance: Type.Optional(FailedEnqueueProvenanceSchema), failureReason: Type.String(), failedAt: Type.String(), canReenqueue: Type.Boolean(), disabledReason: Type.Optional(Type.String()), nextCommand: FailedEnqueueRecoveryCommandSchema, resolvedAt: Type.Optional(Type.String()) }, { additionalProperties: false });

// --- eforge:region auto-build-schemas ---
export const AutoBuildDesiredSchema = Type.Union([
  Type.Literal('enabled'),
  Type.Literal('disabled'),
]);
export const AutoBuildRuntimeModeSchema = Type.Union([
  Type.Literal('disabled'),
  Type.Literal('starting'),
  Type.Literal('running'),
  Type.Literal('paused'),
  Type.Literal('stopping'),
  Type.Literal('restarting'),
  Type.Literal('faulted'),
]);
export const AutoBuildSchedulerStateSchema = Type.Object({
  alive: Type.Boolean(),
  paused: Type.Boolean(),
  lastMutationReason: Type.Optional(Type.String()),
  runningCount: Type.Optional(Type.Number()),
  limit: Type.Optional(Type.Number()),
});
export const AutoBuildTransitionDetailSchema = Type.Object({
  at: Type.String(),
  previousMode: AutoBuildRuntimeModeSchema,
  nextMode: AutoBuildRuntimeModeSchema,
  desired: AutoBuildDesiredSchema,
  reason: Type.Optional(Type.String()),
  source: Type.String(),
});
export const AutoBuildDetailFields = {
  desired: Type.Optional(AutoBuildDesiredSchema),
  mode: Type.Optional(AutoBuildRuntimeModeSchema),
  scheduler: Type.Optional(AutoBuildSchedulerStateSchema),
  lastTransition: Type.Optional(AutoBuildTransitionDetailSchema),
  reason: Type.Optional(Type.String()),
};
// --- eforge:endregion auto-build-schemas ---
