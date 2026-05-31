/**
 * Wire event types for the eforge daemon SSE stream.
 *
 * Types are derived from TypeBox schemas in `events.schemas.ts` (the wire-protocol
 * source of truth) and re-exported here so engine code continues to import from
 * './events.js' without changes.
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
  LandingPublicationActionSchema,
  StackLayerStatusSchema,
  StackArtifactRefSchema,
  StackLayerWireSchema,
  TerminalFailureScopeSchema,
  TerminalFailureEnvelopeSchema,
  BuildResumeArtifactSourceSchema,
  BuildResumeArtifactPlanSchema,
  BuildResumeArtifactsEventSchema,
} from './events.schemas.js';

export { EforgeEventSchema } from './events.schemas.js';
