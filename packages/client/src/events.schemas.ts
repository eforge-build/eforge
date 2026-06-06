/**
 * Compatibility facade for eforge daemon SSE event schemas.
 *
 * The wire protocol is implemented in focused modules under
 * `packages/client/src/events/`. `EforgeEvent` remains derived from
 * `EforgeEventSchema` via `Static<typeof EforgeEventSchema>`, and public
 * consumers continue to import through @eforge-build/client barrels.
 */

export { ORCHESTRATION_MODES, REVIEW_PERSPECTIVES } from './events/constants.js';
export {
  AcceptanceCriteriaConflictSchema,
  AcceptanceCriterionVerdictSchema,
  AgentTerminalSubtypeSchema,
  BuildResumeArtifactPlanSchema,
  BuildResumeArtifactSourceSchema,
  BuildResumeArtifactsEventSchema,
  EvaluationIssueOutcomeSchema,
  LandingActionSchema,
  LandingPublicationActionSchema,
  ReviewPerspectiveKeySchema,
  StackArtifactRefSchema,
  StackLandingStatusSchema,
  StackLayerLandingWireSchema,
  StackLayerStatusSchema,
  StackLayerWireSchema,
  StackProviderConflictKindSchema,
  StackProviderOperationKindSchema,
  StackProviderSchema,
  TerminalFailureEnvelopeSchema,
  TerminalFailureScopeSchema,
} from './events/shared/schemas.js';
export { BuildDecisionSchema, PlanningDecisionEventSchema, PlanningDecisionSchema } from './events/decisions.js';
export { EventEnvelopeSchema } from './events/envelope.js';
export { EforgeEventSchema } from './events/root.js';
export { EforgeEventVariantsSchema } from './events/variants.js';
export { DaemonStreamSnapshotSchema, SessionStreamSnapshotSchema } from './events/snapshots.js';
export { SEVERITY_ORDER, isAlwaysYieldedAgentEvent, isBuiltInReviewPerspective } from './events/utilities.js';
export { parseEforgeEvent, safeParseDaemonStreamSnapshot, safeParseEforgeEvent, safeParseSessionStreamSnapshot } from './events/parse.js';

export type { BuildDecision, PlanningDecision, PlanningDecisionEvent } from './events/decisions.js';
export type { QueueEvent } from './events/queue-events.js';
export type { DaemonStreamSnapshot, SessionStreamSnapshot } from './events/snapshots.js';
export type { StackSyncActiveBuildPolicyWire, StackSyncOutcomeWire, StackSyncStatusWire, StackSyncTriggerWire } from './events/shared/stack-wire.js';
export type {
  AcceptanceCriteriaConflict,
  AcceptanceCriterionVerdict,
  AgentResultData,
  AgentRole,
  AgentTerminalSubtype,
  AutoBuildDesired,
  AutoBuildRuntimeMode,
  AutoBuildSchedulerState,
  AutoBuildTransitionDetail,
  BuildFailureSummary,
  BuildResumeArtifactPlan,
  BuildResumeArtifactSource,
  BuildResumeArtifactsEvent,
  BuildResumeCompleteEvent,
  BuildResumeIneligibleEvent,
  BuildResumeStartEvent,
  BuildResumeStateEvent,
  ClarificationQuestion,
  DaemonRunUpsertEvent,
  EforgeEvent,
  EforgeResult,
  EforgeState,
  EvaluationIssueOutcome,
  ExpeditionModule,
  FailingPlanEntry,
  LandedCommit,
  LandingAction,
  LandingPublicationAction,
  OrchestrationConfig,
  PipelineComposition,
  PlanFile,
  PlanState,
  PlanSummaryEntry,
  PrdValidationGap,
  ReconciliationReport,
  RecoveryVerdict,
  ReviewIssue,
  ReviewPerspective,
  ReviewPerspectiveKey,
  ShardScope,
  StackArtifactRef,
  StackLayerStatus,
  StackLayerWire,
  StackProvider,
  StackProviderConflictKind,
  StackProviderOperationKind,
  StalenessVerdict,
  TerminalFailureEnvelope,
  TerminalFailureScope,
  TestIssue,
  ValidationRepairClass,
  EforgeStatus
} from './events/root.js';
