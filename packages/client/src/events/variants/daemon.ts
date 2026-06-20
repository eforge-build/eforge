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
  FailedEnqueueInfoSchema,
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

export const daemonEventVariants = [
  // Daemon run-state upsert
  Type.Object({
    type: Type.Literal('daemon:run:upsert'),
    run: Type.Object({
      id: Type.String(),
      sessionId: Type.Optional(Type.String()),
      planSet: Type.String(),
      command: Type.String(),
      status: Type.String(),
      startedAt: Type.String(),
      completedAt: Type.Optional(Type.String()),
      cwd: Type.String(),
      pid: Type.Optional(Type.Number()),
    }),
  }),

  // Daemon internal
  Type.Object({
    type: Type.Literal('daemon:auto-build:paused'),
    reason: Type.String(),
  }),

  // Daemon lifecycle
  Type.Object({
    type: Type.Literal('daemon:lifecycle:starting'),
    pid: Type.Number(),
    port: Type.Number(),
    version: Type.String(),
    mode: Type.String(),
  }),
  Type.Object({
    type: Type.Literal('daemon:lifecycle:ready'),
    pid: Type.Number(),
    port: Type.Number(),
    version: Type.String(),
    mode: Type.String(),
    recoveryDurationMs: Type.Number(),
  }),
  Type.Object({
    type: Type.Literal('daemon:lifecycle:shutdown:start'),
    signal: Type.String(),
    reason: Type.String(),
  }),
  Type.Object({
    type: Type.Literal('daemon:lifecycle:shutdown:complete'),
    durationMs: Type.Number(),
  }),
  Type.Object({
    type: Type.Literal('daemon:heartbeat'),
    uptime: Type.Number(),
    queueDepth: Type.Number(),
    runningBuilds: Type.Number(),
    autoBuild: Type.Object({
    enabled: Type.Boolean(),
    paused: Type.Boolean(),
    ...AutoBuildDetailFields,
  }),
    subscribers: Type.Number(),
  }),

  // Daemon scheduler
  Type.Object({
    type: Type.Literal('daemon:scheduler:dequeued'),
    prdId: Type.String(),
    queueDepth: Type.Number(),
    capacityRemaining: Type.Number(),
  }),
  Type.Object({
    type: Type.Literal('daemon:scheduler:capacity-blocked'),
    queueDepth: Type.Number(),
    runningCount: Type.Number(),
    limit: Type.Number(),
  }),
  Type.Object({
    type: Type.Literal('daemon:scheduler:dependency-blocked'),
    prdId: Type.String(),
    blockedBy: Type.Array(Type.String()),
  }),
  Type.Object({ type: Type.Literal('daemon:scheduler:paused') }),
  Type.Object({ type: Type.Literal('daemon:scheduler:resumed') }),

  // Daemon auto-build extensions
  Type.Object({ type: Type.Literal('daemon:auto-build:enabled') }),
  Type.Object({ type: Type.Literal('daemon:auto-build:disabled') }),
  Type.Object({ type: Type.Literal('daemon:auto-build:resumed') }),
  Type.Object({
    type: Type.Literal('daemon:auto-build:triggered'),
    trigger: Type.String(),
    prdsEnqueued: Type.Number(),
  }),
  Type.Object({
    type: Type.Literal('daemon:auto-build:transition'),
    previousMode: AutoBuildRuntimeModeSchema,
    nextMode: AutoBuildRuntimeModeSchema,
    desired: AutoBuildDesiredSchema,
    reason: Type.Optional(Type.String()),
    source: Type.String(),
  }),

  // Daemon recovery
  Type.Object({ type: Type.Literal('daemon:recovery:start') }),
  Type.Object({
    type: Type.Literal('daemon:recovery:run-marked-failed'),
    runId: Type.String(),
    planSet: Type.String(),
    reason: Type.String(),
  }),
  Type.Object({
    type: Type.Literal('daemon:recovery:lock-removed'),
    path: Type.String(),
    pid: Type.Number(),
  }),
  Type.Object({
    type: Type.Literal('daemon:recovery:complete'),
    runsFailed: Type.Number(),
    locksRemoved: Type.Number(),
    durationMs: Type.Number(),
  }),

  // Daemon orphan reaping
  Type.Object({
    type: Type.Literal('daemon:orphan:reaped'),
    runId: Type.String(),
    sessionId: Type.String(),
    planSet: Type.String(),
    pid: Type.Number(),
  }),

  Type.Object({
    type: Type.Literal('daemon:failed-enqueue:upsert'),
    failedEnqueue: FailedEnqueueInfoSchema,
  }),
  Type.Object({
    type: Type.Literal('daemon:failed-enqueue:resolved'),
    runId: Type.String(),
    resolvedAt: Type.String(),
    spawnedSessionId: Type.Optional(Type.String()),
  }),

  // Daemon errors and warnings
  Type.Object({
    type: Type.Literal('daemon:warning'),
    source: Type.String(),
    message: Type.String(),
    details: Type.Optional(Type.String()),
  }),
  Type.Object({
    type: Type.Literal('daemon:error'),
    source: Type.String(),
    message: Type.String(),
    stack: Type.Optional(Type.String()),
  }),
] as const;
