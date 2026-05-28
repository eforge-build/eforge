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
  // --- eforge:region plan-01-terminal-failure-contract ---
  TerminalFailureScope,
  TerminalFailureEnvelope,
  // --- eforge:endregion plan-01-terminal-failure-contract ---
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
  // --- eforge:region plan-01-validation-evidence-contract ---
  AcceptanceCriterionVerdict,
  // --- eforge:endregion plan-01-validation-evidence-contract ---
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
  // --- eforge:region plan-01-dynamic-perspective-contracts ---
  ReviewPerspectiveKey,
  // --- eforge:endregion plan-01-dynamic-perspective-contracts ---
  AgentTerminalSubtype,
  ShardScope,
  PipelineComposition,
  BuildDecision,
  PlanningDecision,
  PlanningDecisionEvent,
  // --- eforge:region plan-01-supervisor-foundation ---
  AutoBuildDesired,
  AutoBuildRuntimeMode,
  AutoBuildSchedulerState,
  AutoBuildTransitionDetail,
  // --- eforge:endregion plan-01-supervisor-foundation ---
  // --- eforge:region plan-01-stack-contracts-config-state-events ---
  StackProvider,
  LandingPublicationAction,
  StackLayerStatus,
  StackArtifactRef,
  StackLayerWire,
  // --- eforge:endregion plan-01-stack-contracts-config-state-events ---
} from './events.schemas.js';

export {
  ORCHESTRATION_MODES,
  SEVERITY_ORDER,
  isAlwaysYieldedAgentEvent,
  REVIEW_PERSPECTIVES,
  BuildDecisionSchema,
  PlanningDecisionSchema,
  // --- eforge:region plan-01-validation-evidence-contract ---
  AcceptanceCriterionVerdictSchema,
  // --- eforge:endregion plan-01-validation-evidence-contract ---
  safeParseEforgeEvent,
  parseEforgeEvent,
  safeParseDaemonStreamSnapshot,
  safeParseSessionStreamSnapshot,
  // --- eforge:region plan-01-dynamic-perspective-contracts ---
  ReviewPerspectiveKeySchema,
  isBuiltInReviewPerspective,
  // --- eforge:endregion plan-01-dynamic-perspective-contracts ---
  // --- eforge:region plan-01-stack-contracts-config-state-events ---
  StackProviderSchema,
  LandingPublicationActionSchema,
  StackLayerStatusSchema,
  StackArtifactRefSchema,
  StackLayerWireSchema,
  // --- eforge:endregion plan-01-stack-contracts-config-state-events ---
  // --- eforge:region plan-01-terminal-failure-contract ---
  TerminalFailureScopeSchema,
  TerminalFailureEnvelopeSchema,
  // --- eforge:endregion plan-01-terminal-failure-contract ---
} from './events.schemas.js';

export { EforgeEventSchema } from './events.schemas.js';
