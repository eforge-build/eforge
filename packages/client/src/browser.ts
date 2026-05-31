/**
 * Browser-safe entrypoint for @eforge-build/client.
 *
 * Exports everything from the main index that is safe to use in a browser
 * context. Specifically excludes:
 *   - lockfile.ts  (uses node:fs)
 *   - daemon-client.ts  (uses node:child_process, node:fs)
 *   - profile-utils.ts  (uses node:fs via daemon-client)
 *
 * session-stream.ts is safe: it branches on `typeof EventSource !== 'undefined'`
 * at runtime, using fetch in browser contexts. The `node:http` import in
 * session-stream.ts is only exercised on the Node path.
 */

export { API_ROUTES, buildPath } from './routes.js';
export type {
  ApiRoute,
  EnqueueRequest,
  AutoBuildSetRequest,
  StopDaemonRequest,
  VersionResponse,
  RecoverRequest,
  RecoverResponse,
  ReadSidecarRequest,
  RecoveryVerdictSidecar,
  ReadSidecarResponse,
  ApplyRecoveryRequest,
  ApplyRecoveryResponse,
  SessionPlanStatusWire,
  PlanningTypeWire,
  PlanningDepthWire,
  SkippedDimensionWire,
  SessionPlanListEntryWire,
  SessionPlanDataWire,
  SessionPlanListResponse,
  SessionPlanShowResponse,
  SessionPlanCreateRequest,
  SessionPlanCreateResponse,
  SessionPlanSetSectionRequest,
  SessionPlanSetSectionResponse,
  SessionPlanSkipDimensionRequest,
  SessionPlanSkipDimensionResponse,
  SessionPlanSetStatusRequest,
  SessionPlanSetStatusResponse,
  SessionPlanSelectDimensionsRequest,
  SessionPlanSelectDimensionsResponse,
  SessionPlanReadinessResponse,
  SessionPlanMigrateLegacyRequest,
  SessionPlanMigrateLegacyResponse,
  SessionPlanListRequest,
  // --- eforge:region plan-03-stack-daemon-ui ---
  StackLayersResponse,
  // --- eforge:endregion plan-03-stack-daemon-ui ---
  // --- eforge:region plan-02-client-surfaces-and-console ---
  StackSyncRequest,
  StackSyncResponse,
  StackSyncOutcomeWire,
  StackSyncActiveBuildSkipWire,
  StackSyncProviderCommandWire,
  StackSyncStatusWire,
  StackSyncStatusResponse,
  // --- eforge:endregion plan-02-client-surfaces-and-console ---
} from './routes.js';

// --- eforge:region plan-01-queue-recovery-api-engine ---
export type {
  QueueRecoveryStrategy,
  QueueRecoveryStrategyWire,
  QueueRecoveryLocation,
  QueueRecoveryNodeRole,
  QueueRecoveryNode,
  QueueRecoveryEdge,
  QueueRecoveryOperationKind,
  QueueRecoveryMovePrdOperation,
  QueueRecoveryRemoveRecoverySidecarsOperation,
  QueueRecoveryOperation,
  QueueRecoveryOperationStatus,
  QueueRecoveryOperationResult,
  QueueRecoveryNotice,
  QueueRecoveryAnalyzeRequest,
  QueueRecoveryAnalyzeResponse,
  QueueRecoveryApplyRequest,
  QueueRecoveryApplyResponse,
} from './queue-recovery.js';
export {
  QUEUE_RECOVERY_STRATEGY_RETRY_AND_REACTIVATE,
  isQueueRecoveryStrategy,
} from './queue-recovery.js';
export {
  fetchQueueRecoveryAnalysis,
  applyQueueRecovery,
} from './browser-queue-recovery.js';
// --- eforge:endregion plan-01-queue-recovery-api-engine ---

export type {
  HealthResponse,
  AutoBuildState,
  // --- eforge:region plan-01-supervisor-foundation ---
  AutoBuildDesired,
  AutoBuildRuntimeMode,
  AutoBuildSchedulerState,
  AutoBuildTransitionDetail,
  // --- eforge:endregion plan-01-supervisor-foundation ---
  ProjectContext,
  ConfigShowResponse,
  ConfigValidateResponse,
  // --- eforge:region plan-01-unified-pi-landing-ux ---
  ConfigSourceInfo,
  ConfigShowVerboseResponse,
  // --- eforge:endregion plan-01-unified-pi-landing-ux ---
  ExtensionScope,
  ExtensionSource,
  ExtensionStatus,
  ExtensionDiagnosticSeverity,
  ExtensionFormat,
  ExtensionLayout,
  ExtensionTrust,
  // --- eforge:region plan-01-extension-management-api ---
  ExtensionScaffoldScope,
  ExtensionScaffoldTemplate,
  // --- eforge:endregion plan-01-extension-management-api ---
  ExtensionDiagnostic,
  ExtensionShadow,
  ExtensionRegistrationSummary,
  // --- eforge:region plan-03-observability-docs-examples ---
  ReviewerPerspectiveApplicabilitySummary,
  ReviewerPerspectiveDetail,
  // --- eforge:endregion plan-03-observability-docs-examples ---
  ExtensionEntry,
  ExtensionListResponse,
  ExtensionShowResponse,
  ExtensionValidateResponse,
  // --- eforge:region plan-01-extension-management-api ---
  ExtensionNewRequest,
  ExtensionNewResponse,
  ExtensionReloadWatcherMetadata,
  ExtensionReloadResponse,
  // --- eforge:endregion plan-01-extension-management-api ---
  // --- eforge:region plan-01-extension-package-foundation ---
  ExtensionPackageProvenance,
  ExtensionInstallProvenance,
  ExtensionInstallRequest,
  ExtensionInstallResponse,
  ExtensionUpdateRequest,
  ExtensionUpdateResponse,
  ExtensionRemoveRequest,
  ExtensionRemoveResponse,
  ExtensionPromoteRequest,
  ExtensionPromoteResponse,
  ExtensionDemoteRequest,
  ExtensionDemoteResponse,
  // --- eforge:endregion plan-01-extension-package-foundation ---
  QueueItem,
  SessionMetadata,
  RunInfo,
  BuildStageSpec,
  ReviewProfileConfig,
  RunSummary,
  RunState,
  PlanInfo,
  PlansResponse,
  DiffBulkResponse,
  DiffSingleResponse,
  DiffResponse,
  EnqueueResponse,
  CancelResponse,
  StopDaemonResponse,
  KeepAliveResponse,
  AgentRuntimeProfileInfo,
  AgentRuntimeProfileSource,
  ProfileListRequest,
  ProfileListResponse,
  ProfileShowResponse,
  ProfileUseRequest,
  ProfileUseResponse,
  ProfileCreateRequest,
  ProfileCreateResponse,
  ProfileDeleteRequest,
  ProfileDeleteResponse,
  ModelProvidersResponse,
  ModelInfo,
  ModelListResponse,
} from './types.js';

export {
  parseSseChunk,
  subscribeWithSnapshot,
} from './session-stream.js';
export type {
  SessionSummary,
  SubscribeOptions,
  DaemonStreamEvent,
  ParsedSseBlock,
  DaemonStreamSnapshot,
  SessionStreamSnapshot,
  SubscribeWithSnapshotFrame,
} from './session-stream.js';

export { aggregateSessionSummary } from './aggregate-session-summary.js';

export {
  eventRegistry,
  DAEMON_EVENT_TYPES,
  getEventSummary,
  isPersistedDaemonEventType,
} from './event-registry.js';
export type {
  EventMeta,
  EventScope,
  ProjectableState,
} from './event-registry.js';

// Only the numeric constant is browser-safe; verifyApiVersion and
// clearApiVersionCache depend on Node-only lockfile/fs modules and are
// available on the main (Node) entrypoint only.
export { DAEMON_API_VERSION } from './api-version-const.js';

export type {
  EforgeEvent,
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
  AcceptanceCriteriaConflict,
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
  // --- eforge:region build-completion-recovery ---
  EvaluationIssueOutcome,
  // --- eforge:endregion build-completion-recovery ---
  // --- eforge:region plan-01-dynamic-perspective-contracts ---
  ReviewPerspectiveKey,
  // --- eforge:endregion plan-01-dynamic-perspective-contracts ---
  AgentTerminalSubtype,
  ShardScope,
  PipelineComposition,
  BuildDecision,
  PlanningDecision,
  PlanningDecisionEvent,
  // --- eforge:region plan-01-stack-contracts-config-state-events ---
  StackProvider,
  LandingPublicationAction,
  StackLayerStatus,
  StackArtifactRef,
  StackLayerWire,
  // --- eforge:endregion plan-01-stack-contracts-config-state-events ---
  // --- eforge:region plan-01-terminal-failure-contract ---
  TerminalFailureScope,
  TerminalFailureEnvelope,
  // --- eforge:endregion plan-01-terminal-failure-contract ---
  // --- eforge:region plan-02-resume-artifacts-projection ---
  BuildResumeArtifactSource,
  BuildResumeArtifactPlan,
  BuildResumeArtifactsEvent,
  // --- eforge:endregion plan-02-resume-artifacts-projection ---
} from './events.js';

// --- eforge:region system-configuration-view ---
export type {
  PlaybookScope,
  PlaybookArtifactSource,
  PlaybookMode,
  PlaybookShadow,
  PlaybookListEntry,
  PlaybookData,
  PlaybookListResponse,
  PlaybookShowResponse,
} from './api/playbook.js';
// --- eforge:endregion system-configuration-view ---

export { ORCHESTRATION_MODES, SEVERITY_ORDER, isAlwaysYieldedAgentEvent, REVIEW_PERSPECTIVES, EvaluationIssueOutcomeSchema, PlanningDecisionSchema,
  // --- eforge:region plan-01-validation-evidence-contract ---
  AcceptanceCriterionVerdictSchema, AcceptanceCriteriaConflictSchema,
  // --- eforge:endregion plan-01-validation-evidence-contract ---
  // --- eforge:region plan-01-dynamic-perspective-contracts ---
  ReviewPerspectiveKeySchema,
  isBuiltInReviewPerspective,
  // --- eforge:endregion plan-01-dynamic-perspective-contracts ---
  // --- eforge:region plan-01-stack-contracts-config-state-events ---
  StackProviderSchema, LandingPublicationActionSchema, StackLayerStatusSchema, StackArtifactRefSchema, StackLayerWireSchema,
  // --- eforge:endregion plan-01-stack-contracts-config-state-events ---
  // --- eforge:region plan-01-terminal-failure-contract ---
  TerminalFailureScopeSchema, TerminalFailureEnvelopeSchema,
  // --- eforge:endregion plan-01-terminal-failure-contract ---
  // --- eforge:region plan-02-resume-artifacts-projection ---
  BuildResumeArtifactSourceSchema, BuildResumeArtifactPlanSchema, BuildResumeArtifactsEventSchema,
  // --- eforge:endregion plan-02-resume-artifacts-projection ---
} from './events.js';
