export { safeParseWithSchema, parseWithSchema, formatSchemaError, getSchemaYaml } from './schema-utils.js';
export type { SafeParseResult, SchemaError, ValueError } from './schema-utils.js';

export { API_ROUTES, buildPath } from './routes.js';
export { isTransientTransportError } from './transient-transport.js';
export type {
  ApiRoute,
  EnqueueRequest,
  AutoBuildSetRequest,
  StopDaemonRequest,
  VersionResponse,
  RecoverRequest,
  RecoverResponse,
  ReadSidecarRequest,
  RecoverySidecarReport,
  RecoverySidecarBoundedEvidence,
  RecoverySidecarContinueRepairEligibilitySource,
  RecoverySidecarContinueRepairEligibility,
  RecoverySidecarRecoveryOption,
  RecoveryVerdictSidecar,
  ReadSidecarResponse,
  QueueControlStatus,
  QueuePriorityRequest,
  QueuePriorityResponse,
  QueueRemoveResponse,
  QueueDependencyOverrideRequest,
  QueueDependencyOverrideResponse,
} from './routes.js';

export {
  updateQueuePriority,
  removeQueueItem,
  overrideQueueDependency,
} from './browser-queue-control.js';

export {
  apiEnqueue,
  apiEnqueueIfRunning,
  apiCancel,
  apiCancelIfRunning,
  apiGetQueue,
  apiGetQueueIfRunning,
  apiUpdateQueuePriority,
  apiUpdateQueuePriorityIfRunning,
  apiRemoveQueueItem,
  apiRemoveQueueItemIfRunning,
  apiOverrideQueueDependency,
  apiOverrideQueueDependencyIfRunning,
  apiGetRuns,
  apiGetRunsIfRunning,
  apiGetLatestRunFromRuns,
  apiGetLatestRunFromRunsIfRunning,
  apiGetRunningRuns,
  apiGetRunningRunsIfRunning,
  apiGetRunningSessionSummaries,
  apiGetRunningSessionSummariesIfRunning,
  apiGetRunSummary,
  apiGetRunSummaryIfRunning,
  apiGetRunState,
  apiGetRunStateIfRunning,
  apiGetPlans,
  apiGetPlansIfRunning,
  apiGetDiff,
  apiGetDiffIfRunning,
  apiGetSessionMetadata,
  apiGetSessionMetadataIfRunning,
} from './api/queue.js';

export {
  apiListProfiles,
  apiListProfilesIfRunning,
  apiShowProfile,
  apiShowProfileIfRunning,
  apiUseProfile,
  apiUseProfileIfRunning,
  apiCreateProfile,
  apiCreateProfileIfRunning,
  apiDeleteProfile,
  apiDeleteProfileIfRunning,
} from './api/profile.js';

export {
  apiHealth,
  apiHealthIfRunning,
  apiKeepAlive,
  apiKeepAliveIfRunning,
  apiGetProjectContext,
  apiGetProjectContextIfRunning,
  apiGetAutoBuild,
  apiGetAutoBuildIfRunning,
  apiSetAutoBuild,
  apiSetAutoBuildIfRunning,
} from './api/status.js';

export {
  apiShowConfig,
  apiShowConfigIfRunning,
  apiValidateConfig,
  apiValidateConfigIfRunning,
  apiShowConfigVerbose,
  apiShowConfigVerboseIfRunning,
} from './api/config.js';

export {
  apiListExtensions,
  apiShowExtension,
  apiValidateExtensions,
  apiNewExtension,
  apiReloadExtensions,
  apiTestExtension,
  apiTrustExtension,
  apiUntrustExtension,
  apiListExtensionsIfRunning,
  apiShowExtensionIfRunning,
  apiValidateExtensionsIfRunning,
  apiNewExtensionIfRunning,
  apiReloadExtensionsIfRunning,
  apiTestExtensionIfRunning,
  apiTrustExtensionIfRunning,
  apiUntrustExtensionIfRunning,
  apiInstallExtension,
  apiInstallExtensionIfRunning,
  apiUpdateExtension,
  apiUpdateExtensionIfRunning,
  apiRemoveExtension,
  apiRemoveExtensionIfRunning,
  apiPromoteExtension,
  apiPromoteExtensionIfRunning,
  apiDemoteExtension,
  apiDemoteExtensionIfRunning,
} from './api/extensions.js';

export * from './extension-contributions.js'; export * from './extension-contribution-output-formatting.js';
export * from './api/extension-contributions.js';
export * from './api/extension-contribution-dispatch.js';
export * from './extension-agent-tasks.js';
export * from './api/extension-agent-tasks.js';
export {
  dispatchEforgeExtensionAction,
  EFORGE_EXTENSION_ACTIONS,
} from './api/extension-tool-dispatch.js';
export type {
  EforgeExtensionAction,
  EforgeExtensionActionParams,
  EforgeExtensionActionHelpers,
} from './api/extension-tool-dispatch.js';

export {
  apiListModelProviders,
  apiListModelProvidersIfRunning,
  apiListModels,
  apiListModelsIfRunning,
} from './api/models.js';

export { apiStopDaemon, apiStopDaemonIfRunning } from './api/daemon.js';

export { apiSchedulerKick } from './api/scheduler.js';
export type { SchedulerKickResponse } from './api/scheduler.js';

export { apiRecover, apiRecoverIfRunning } from './api/recover.js';

export { apiReadRecoverySidecar, apiReadRecoverySidecarIfRunning } from './api/recovery-sidecar.js';

export { apiApplyRecovery, apiApplyRecoveryIfRunning } from './api/apply-recovery.js';

export {
  apiAcceptRecoverySuccessPreview, apiAcceptRecoverySuccessPreviewIfRunning,
  apiAcceptRecoverySuccess, apiAcceptRecoverySuccessIfRunning,
} from './api/accept-recovery-success.js';
export { ACCEPT_SUCCESS_REASON_CATEGORIES } from './routes.js';
export type {
  AcceptSuccessReasonCategory, AcceptSuccessLandingAction, AcceptSuccessPreviewRequest, AcceptSuccessCleanupEffect,
  AcceptSuccessAuditFields, AcceptSuccessDependentCandidate, AcceptSuccessCleanupResult, AcceptSuccessAutoMergeResult, AcceptSuccessLandingResult,
  AcceptSuccessDependentResult, AcceptSuccessAppliedSummary, AcceptSuccessPreviewResponse, AcceptSuccessRequest, AcceptSuccessResponse,
} from './routes.js';

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
  apiAnalyzeQueueRecovery,
  apiAnalyzeQueueRecoveryIfRunning,
  apiApplyQueueRecovery,
  apiApplyQueueRecoveryIfRunning,
} from './api/queue-recovery.js';

export {
  apiPlaybookList,
  apiPlaybookListIfRunning,
  apiPlaybookShow,
  apiPlaybookShowIfRunning,
  apiPlaybookSave,
  apiPlaybookSaveIfRunning,
  apiPlaybookRun,
  apiPlaybookRunIfRunning,
  apiPlaybookPromote,
  apiPlaybookPromoteIfRunning,
  apiPlaybookDemote,
  apiPlaybookDemoteIfRunning,
  apiPlaybookValidate,
  apiPlaybookValidateIfRunning,
  apiPlaybookCopy,
  apiPlaybookCopyIfRunning,
} from './api/playbook.js';

export type {
  PlaybookScope,
  PlaybookArtifactSource,
  PlaybookMode,
  PlaybookShadow,
  PlaybookListEntry,
  PlaybookData,
  PlaybookFrontmatterFields,
  PlaybookBodyFields,
  PlaybookSaveBody,
  PlaybookListResponse,
  PlaybookShowResponse,
  PlaybookSaveResponse,
  PlaybookPromoteResponse,
  PlaybookDemoteResponse,
  PlaybookValidateResponse,
  PlaybookCopyResponse,
} from './api/playbook.js';

export type {
  PlaybookRunRequest,
  PlaybookRunResponse,
  PlaybookRunEnqueuedResponse,
  PlaybookRunRequiresAgentResponse,
  PlaybookRunPlanningUnavailableResponse,
  PlaybookPlanningEntryMetadata,
  PlaybookPlanningRequiredCapability,
  PlaybookPlanningUnavailableDiagnostic,
} from './routes.js';

export type { StackLayersResponse } from './routes.js';
export { apiGetStackLayers, apiGetStackLayersIfRunning } from './api/stack.js';

export type {
  StackSyncRequest,
  StackSyncResponse,
  StackSyncProviderCommandWire,
  StackSyncActiveBuildSkipWire,
  StackSyncOutcomeWire,
  StackSyncStatusWire,
  StackSyncStatusResponse,
} from './routes.js';
export {
  apiStackSync,
  apiStackSyncIfRunning,
  apiGetStackSyncStatus,
  apiGetStackSyncStatusIfRunning,
} from './api/stack.js';
export {
  DaemonNotDiscoverableError,
  discoverProjectRootCwd,
  daemonRequestFromWorktree,
} from './daemon-client.js';

export {
  apiSessionPlanList,
  apiSessionPlanListIfRunning,
  apiSessionPlanShow,
  apiSessionPlanShowIfRunning,
  apiSessionPlanCreate,
  apiSessionPlanCreateIfRunning,
  apiSessionPlanSetSection,
  apiSessionPlanSetSectionIfRunning,
  apiSessionPlanSkipDimension,
  apiSessionPlanSkipDimensionIfRunning,
  apiSessionPlanSetStatus,
  apiSessionPlanSetStatusIfRunning,
  apiSessionPlanSelectDimensions,
  apiSessionPlanSelectDimensionsIfRunning,
  apiSessionPlanReadiness,
  apiSessionPlanReadinessIfRunning,
  apiSessionPlanMigrateLegacy,
  apiSessionPlanMigrateLegacyIfRunning,
  apiSessionPlanCreateFromPlaybook,
  apiSessionPlanCreateFromPlaybookIfRunning,
} from './api/session-plan.js';

export type {
  SessionPlanListRequest,
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
  SessionPlanCreateFromPlaybookRequest,
  SessionPlanCreateFromPlaybookResponse,
} from './api/session-plan.js';

export {
  apiSessionPlanSetList,
  apiSessionPlanSetListIfRunning,
  apiSessionPlanSetShow,
  apiSessionPlanSetShowIfRunning,
  apiSessionPlanSetValidate,
  apiSessionPlanSetValidateIfRunning,
} from './api/session-plan-set.js';

export type {
  SessionPlanSetStatusWire,
  SessionPlanSetStrategyWire,
  SessionPlanSetChildKindWire,
  SessionPlanSetDiagnosticCodeWire,
  SessionPlanSetExternalRefWire,
  SessionPlanSetDiagnosticWire,
  SessionPlanSetChildValidationSummaryWire,
  SessionPlanSetChildSummaryWire,
  SessionPlanSetAnchorSummaryWire,
  SessionPlanSetSummaryWire,
  SessionPlanSetValidationResultWire,
  SessionPlanSetListEntryWire,
  SessionPlanSetListRequest,
  SessionPlanSetListResponse,
  SessionPlanSetShowRequest,
  SessionPlanSetShowResponse,
  SessionPlanSetValidateRequest,
  SessionPlanSetValidateResponse,
} from './session-plan-set.js';

export type { ApplyRecoveryRequest, ApplyRecoveryResponse, RecoveryAppliedMetadata } from './routes.js';

export type { ContinueRepairRequest, ContinueRepairResponse } from './routes.js';
export { apiContinueRepair, apiContinueRepairIfRunning } from './api/continue-repair.js';

export type {
  ContinueRepairEligibilityRequest,
  ContinueRepairEligibilityResponse,
  ContinueRepairArtifactAvailability,
} from './routes.js';
export {
  apiCheckContinueRepairEligibility,
  apiCheckContinueRepairEligibilityIfRunning,
} from './api/continue-repair-eligibility.js';

export {
  type LockfileData,
  LOCKFILE_NAME,
  LOCKFILE_POLL_INTERVAL_MS,
  LOCKFILE_POLL_TIMEOUT_MS,
  readLockfile,
  isPidAlive,
  isServerAlive,
  lockfilePath,
  writeLockfile,
  updateLockfile,
  removeLockfile,
  killPidIfAlive,
} from './lockfile.js';

export {
  DAEMON_START_TIMEOUT_MS,
  DAEMON_POLL_INTERVAL_MS,
  sleep,
  ensureDaemon,
  daemonRequest,
  daemonRequestIfRunning,
  daemonRequestWithStatus,
  daemonRequestWithStatusIfRunning,
  isAgentWorktreeCwd,
  DaemonInWorktreeError,
} from './daemon-client.js';
export type { DaemonRequestWithStatusResult } from './daemon-client.js';

export { DAEMON_API_VERSION, verifyApiVersion, clearApiVersionCache } from './api-version.js';

export { sanitizeProfileName, parseRawConfigLegacy } from './profile-utils.js';

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

export type {
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
  StackProvider,
  StackProviderOperationKind,
  StackProviderConflictKind,
  LandingPublicationAction,
  StackLayerStatus,
  StackArtifactRef,
  StackLayerWire,
  TerminalFailureScope,
  TerminalFailureEnvelope,
  BuildResumeStartEvent,
  BuildResumeStateEvent,
  BuildResumeIneligibleEvent,
  BuildResumeArtifactSource,
  BuildResumeArtifactPlan,
  BuildResumeArtifactsEvent,
  BuildResumeCompleteEvent,
} from './events.js';

export { ORCHESTRATION_MODES, SEVERITY_ORDER, isAlwaysYieldedAgentEvent, EforgeEventSchema, REVIEW_PERSPECTIVES, AgentTerminalSubtypeSchema, EvaluationIssueOutcomeSchema, BuildDecisionSchema, PlanningDecisionSchema,
  AcceptanceCriterionVerdictSchema, AcceptanceCriteriaConflictSchema,
  safeParseEforgeEvent, parseEforgeEvent, safeParseDaemonStreamSnapshot, safeParseSessionStreamSnapshot,
  ReviewPerspectiveKeySchema, isBuiltInReviewPerspective,
  StackProviderSchema, StackProviderOperationKindSchema, StackProviderConflictKindSchema, LandingPublicationActionSchema, StackLayerStatusSchema, StackArtifactRefSchema, StackLayerWireSchema,
  TerminalFailureScopeSchema, TerminalFailureEnvelopeSchema,
  BuildResumeArtifactSourceSchema, BuildResumeArtifactPlanSchema, BuildResumeArtifactsEventSchema,
} from './events.js';

export type {
  HealthResponse,
  AutoBuildState,
  AutoBuildDesired,
  AutoBuildRuntimeMode,
  AutoBuildSchedulerState,
  AutoBuildTransitionDetail,
  ProjectContext,
  ConfigShowResponse,
  ConfigValidateResponse,
  ConfigSourceInfo,
  ConfigShowVerboseResponse,
  ExtensionScope,
  ExtensionSource,
  ExtensionStatus,
  ExtensionDiagnosticSeverity,
  ExtensionFormat,
  ExtensionLayout,
  ExtensionTrust, ExtensionTrustState, ExtensionCapabilityDeclaration, ExtensionDependencyDeclaration, ExtensionDependencyManifest, ExtensionResolvedDependency, ExtensionResolvedDependencyState,
  ExtensionScaffoldScope,
  ExtensionScaffoldTemplate,
  ExtensionDiagnostic,
  ExtensionShadow,
  ExtensionRegistrationSummary,
  ReviewerPerspectiveApplicabilitySummary,
  ReviewerPerspectiveDetail,
  ValidationProviderDetail,
  ExtensionActionDetail,
  ConsoleContributionDetail,
  ConsoleWorkstationDetail,
  IntegrationCommandDetail,
  ExtensionDeepLinkDetail,
  ExtensionEntry,
  ExtensionListResponse,
  ExtensionShowResponse,
  ExtensionValidateResponse,
  ExtensionTestRequest,
  ExtensionTestSource,
  ExtensionTestReplayCounts,
  ExtensionTestMatch,
  ExtensionTestDiagnosticEvent,
  ExtensionTestDeferredRegistrationFamily,
  ExtensionTestDeferredRegistrationSummary,
  ExtensionTestResponse,
  ExtensionNewRequest,
  ExtensionNewResponse,
  ExtensionReloadWatcherMetadata,
  ExtensionReloadResponse,
  ExtensionTrustRequest,
  ExtensionTrustResponse,
  ExtensionUntrustRequest,
  ExtensionUntrustResponse,
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
  QueueItem,
  SessionMetadata,
  RunInfo,
  DailySpend,
  ModelSpend,
  SpendSummary,
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
