/**
 * Wire event types and schemas for the eforge daemon SSE stream.
 *
 * Types are derived from TypeBox schemas exposed by `events.schemas.ts` (a
 * compatibility facade over `events/` implementation modules) and re-exported
 * here so engine and docs-generator code can import event and snapshot schemas
 * from './events.js' or the public `@eforge-build/client/events` subpath.
 *
 * The engine re-exports these types from `@eforge-build/client` so callers
 * that already depend on the client do not need to add the engine as a
 * dependency.
 */

export type {
  TerminalFailureScope,
  TerminalFailureEnvelope,
  EforgeEvent,
  DaemonRunUpsertEvent,
  AgentRole,
  AgentResultData,
  EforgeResult,
  ClarificationQuestion,
  ReviewIssue,
  ValidationRepairClass,
  PlanFile,
  OrchestrationConfig,
  PlanState,
  EforgeState,
  ExpeditionModule,
  PrdValidationGap,
  AcceptanceCriterionVerdict,
  AcceptanceCriteriaConflict,
  TestIssue,
  BuildFailureSummary,
  LandedCommit,
  PlanSummaryEntry,
  FailingPlanEntry,
  ReconciliationReport,
  EforgeStatus,
  QueueEvent,
  QueueDispatchFailureStage,
  StalenessVerdict,
  RecoveryVerdict,
  ReviewPerspective,
  // --- eforge:region build-completion-recovery ---
  EvaluationIssueOutcome,
  // --- eforge:endregion build-completion-recovery ---
  ReviewPerspectiveKey,
  AgentTerminalSubtype,
  ShardScope,
  PipelineComposition,
  BuildDecision,
  PlanningDecision,
  PlanningDecisionEvent,
  AutoBuildDesired,
  AutoBuildRuntimeMode,
  AutoBuildSchedulerState,
  AutoBuildTransitionDetail,
  StackProvider,
  StackProviderOperationKind,
  StackProviderConflictKind,
  LandingPublicationAction,
  StackLayerStatus,
  StackArtifactRef,
  StackLayerWire,
  BuildResumeStartEvent,
  BuildResumeStateEvent,
  BuildResumeIneligibleEvent,
  BuildResumeArtifactSource,
  BuildResumeArtifactPlan,
  BuildResumeArtifactsEvent,
  BuildResumeCompleteEvent,
} from './events.schemas.js';

export {
  ORCHESTRATION_MODES,
  SEVERITY_ORDER,
  isAlwaysYieldedAgentEvent,
  REVIEW_PERSPECTIVES,
  // --- eforge:region build-completion-recovery ---
  EvaluationIssueOutcomeSchema,
  // --- eforge:endregion build-completion-recovery ---
  AgentTerminalSubtypeSchema,
  BuildDecisionSchema,
  PlanningDecisionSchema,
  AcceptanceCriterionVerdictSchema,
  AcceptanceCriteriaConflictSchema,
  safeParseEforgeEvent,
  parseEforgeEvent,
  safeParseDaemonStreamSnapshot,
  safeParseSessionStreamSnapshot,
  ReviewPerspectiveKeySchema,
  isBuiltInReviewPerspective,
  StackProviderSchema,
  StackProviderOperationKindSchema,
  StackProviderConflictKindSchema,
  LandingPublicationActionSchema,
  StackLayerStatusSchema,
  StackArtifactRefSchema,
  StackLayerWireSchema,
  TerminalFailureScopeSchema,
  TerminalFailureEnvelopeSchema,
  BuildResumeArtifactSourceSchema,
  BuildResumeArtifactPlanSchema,
  BuildResumeArtifactsEventSchema,
  QueueDispatchFailureStageSchema,
} from './events.schemas.js';

export { DaemonStreamSnapshotSchema, EforgeEventSchema } from './events.schemas.js';
