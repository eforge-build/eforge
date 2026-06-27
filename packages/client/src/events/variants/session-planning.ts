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
  ExpeditionModuleSchema,
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
import {
  CompilePreflightRiskSchema,
  CompileScopeContextFailureSchema,
} from '../shared/compile-resilience.js';
import { agentStartFields } from '../shared/agent-fields.js';
import {
  ExtensionActionEventBaseFields,
  ExtensionActionFailedErrorCodeSchema,
  ExtensionActionValidationErrorSchema,
  StackSyncTriggerSchema,
} from '../shared/extension-actions.js';
import { BuildDecisionSchema, PlanningDecisionEventSchema } from '../decisions.js';
import { queueEventVariants } from '../queue-events.js';

export const sessionLifecycleEventVariants = [
  // Session lifecycle
  Type.Object({ type: Type.Literal('session:start'), sessionId: Type.String() }),
  Type.Object({
    type: Type.Literal('session:end'),
    sessionId: Type.String(),
    result: EforgeResultSchema,
  }),
  Type.Object({
    type: Type.Literal('session:profile'),
    profileName: Type.Union([Type.String(), Type.Null()]),
    source: Type.Union([
      Type.Literal('local'),
      Type.Literal('project'),
      Type.Literal('user-local'),
      Type.Literal('missing'),
      Type.Literal('none'),
      Type.Literal('override'),
    ]),
    scope: Type.Union([
      Type.Literal('local'),
      Type.Literal('project'),
      Type.Literal('user'),
      Type.Null(),
    ]),
    config: Type.Union([Type.Unknown(), Type.Null()]),
  }),

  // Phase lifecycle
  Type.Object({
    type: Type.Literal('phase:start'),
    runId: Type.String(),
    planSet: Type.String(),
    command: Type.Union([Type.Literal('compile'), Type.Literal('build'), Type.Literal('continue-repair')]),
  }),
  Type.Object({
    type: Type.Literal('phase:end'),
    runId: Type.String(),
    result: EforgeResultSchema,
  }),

  // Config and plan warnings
  Type.Object({
    type: Type.Literal('config:warning'),
    message: Type.String(),
    source: Type.String(),
    details: Type.Optional(Type.String()),
  }),
  Type.Object({
    type: Type.Literal('planning:warning'),
    planId: Type.Optional(Type.String()),
    message: Type.String(),
    source: Type.String(),
    details: Type.Optional(Type.String()),
  }),
  Type.Object({
    type: Type.Literal('planning:module:build-config:invalid'),
    moduleId: Type.String(),
    reason: Type.Union([Type.Literal('invalid-json'), Type.Literal('invalid-schema')]),
    errors: Type.Array(Type.String()),
  }),
] as const;

export const planningEventVariants = [
  // Planning
  Type.Object({
    type: Type.Literal('planning:start'),
    source: Type.String(),
    label: Type.Optional(Type.String()),
  }),
  Type.Object({
    type: Type.Literal('planning:preflight'),
    risk: CompilePreflightRiskSchema,
  }),
  Type.Object({ type: Type.Literal('planning:skip'), reason: Type.String() }),
  Type.Object({
    type: Type.Literal('planning:submission'),
    planCount: Type.Number(),
    totalBodySize: Type.Number(),
    hasMigrations: Type.Boolean(),
  }),
  Type.Object({ type: Type.Literal('planning:error'), reason: Type.String() }),
  Type.Object({
    type: Type.Literal('planning:scope-context:failure'),
    runId: Type.Optional(Type.String()),
    failure: CompileScopeContextFailureSchema,
  }),
  Type.Object({
    type: Type.Literal('planning:clarification'),
    questions: Type.Array(ClarificationQuestionSchema),
  }),
  Type.Object({
    type: Type.Literal('planning:clarification:answer'),
    answers: Type.Record(Type.String(), Type.String()),
  }),
  Type.Object({
    type: Type.Literal('planning:progress'),
    message: Type.String(),
  }),
  Type.Object({
    type: Type.Literal('planning:continuation'),
    attempt: Type.Number(),
    maxContinuations: Type.Number(),
    reason: Type.Optional(
      Type.Union([Type.Literal('max_turns'), Type.Literal('dropped_submission')]),
    ),
  }),
  Type.Object({
    type: Type.Literal('planning:pipeline'),
    scope: Type.String(),
    compile: Type.Array(Type.String()),
    defaultBuild: Type.Array(BuildStageSpecSchema),
    defaultReview: ReviewProfileConfigSchema,
    rationale: Type.String(),
  }),
  Type.Object({
    type: Type.Literal('planning:complete'),
    plans: Type.Array(PlanFileSchema),
    planConfigs: Type.Optional(
      Type.Array(
        Type.Object({
          id: Type.String(),
          build: Type.Optional(Type.Array(BuildStageSpecSchema)),
          review: Type.Optional(ReviewProfileConfigSchema),
        }),
      ),
    ),
  }),

  // Planning review
  Type.Object({ type: Type.Literal('planning:review:start') }),
  Type.Object({
    type: Type.Literal('planning:review:complete'),
    issues: Type.Array(ReviewIssueSchema),
  }),
  Type.Object({ type: Type.Literal('planning:evaluate:start') }),
  Type.Object({
    type: Type.Literal('planning:evaluate:continuation'),
    attempt: Type.Number(),
    maxContinuations: Type.Number(),
  }),
  Type.Object({
    type: Type.Literal('planning:evaluate:complete'),
    accepted: Type.Number(),
    rejected: Type.Number(),
    verdicts: Type.Optional(
      Type.Array(
        Type.Object({
          file: Type.String(),
          action: Type.Union([
            Type.Literal('accept'),
            Type.Literal('reject'),
            Type.Literal('review'),
          ]),
          reason: Type.String(),
          hunk: Type.Optional(Type.Integer({ minimum: 1 })),
        }),
      ),
    ),
  }),

  // Architecture review
  Type.Object({ type: Type.Literal('planning:architecture:review:start') }),
  Type.Object({
    type: Type.Literal('planning:architecture:review:complete'),
    issues: Type.Array(ReviewIssueSchema),
  }),
  Type.Object({ type: Type.Literal('planning:architecture:evaluate:start') }),
  Type.Object({
    type: Type.Literal('planning:architecture:evaluate:continuation'),
    attempt: Type.Number(),
    maxContinuations: Type.Number(),
  }),
  Type.Object({
    type: Type.Literal('planning:architecture:evaluate:complete'),
    accepted: Type.Number(),
    rejected: Type.Number(),
    verdicts: Type.Optional(
      Type.Array(
        Type.Object({
          file: Type.String(),
          action: Type.Union([
            Type.Literal('accept'),
            Type.Literal('reject'),
            Type.Literal('review'),
          ]),
          reason: Type.String(),
          hunk: Type.Optional(Type.Integer({ minimum: 1 })),
        }),
      ),
    ),
  }),

  // Cohesion review
  Type.Object({ type: Type.Literal('planning:cohesion:start') }),
  Type.Object({
    type: Type.Literal('planning:cohesion:complete'),
    issues: Type.Array(ReviewIssueSchema),
  }),
  Type.Object({ type: Type.Literal('planning:cohesion:evaluate:start') }),
  Type.Object({
    type: Type.Literal('planning:cohesion:evaluate:continuation'),
    attempt: Type.Number(),
    maxContinuations: Type.Number(),
  }),
  Type.Object({
    type: Type.Literal('planning:cohesion:evaluate:complete'),
    accepted: Type.Number(),
    rejected: Type.Number(),
    verdicts: Type.Optional(
      Type.Array(
        Type.Object({
          file: Type.String(),
          action: Type.Union([
            Type.Literal('accept'),
            Type.Literal('reject'),
            Type.Literal('review'),
          ]),
          reason: Type.String(),
          hunk: Type.Optional(Type.Integer({ minimum: 1 })),
        }),
      ),
    ),
  }),
] as const;

export const expeditionEventVariants = [
  // Expedition planning phases
  Type.Object({
    type: Type.Literal('expedition:architecture:complete'),
    modules: Type.Array(ExpeditionModuleSchema),
  }),
  Type.Object({
    type: Type.Literal('expedition:wave:start'),
    wave: Type.Number(),
    moduleIds: Type.Array(Type.String()),
  }),
  Type.Object({ type: Type.Literal('expedition:wave:complete'), wave: Type.Number() }),
  Type.Object({ type: Type.Literal('expedition:module:start'), moduleId: Type.String() }),
  Type.Object({ type: Type.Literal('expedition:module:complete'), moduleId: Type.String() }),
  Type.Object({ type: Type.Literal('expedition:compile:start') }),
  Type.Object({
    type: Type.Literal('expedition:compile:complete'),
    plans: Type.Array(PlanFileSchema),
  }),
] as const;

