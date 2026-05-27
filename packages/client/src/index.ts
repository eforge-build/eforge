// --- eforge:region plan-01-schema-utility ---
export {
  safeParseWithSchema,
  parseWithSchema,
  formatSchemaError,
  getSchemaYaml,
} from './schema-utils.js';
export type { SafeParseResult, SchemaError, ValueError } from './schema-utils.js';
// --- eforge:endregion plan-01-schema-utility ---

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
} from './routes.js';

export {
  apiEnqueue,
  apiEnqueueIfRunning,
  apiCancel,
  apiCancelIfRunning,
  apiGetQueue,
  apiGetQueueIfRunning,
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
  // --- eforge:region plan-01-unified-pi-landing-ux ---
  apiShowConfigVerbose,
  apiShowConfigVerboseIfRunning,
  // --- eforge:endregion plan-01-unified-pi-landing-ux ---
} from './api/config.js';

// --- eforge:region plan-02-extension-tooling-surfaces ---
export {
  apiListExtensions,
  apiShowExtension,
  apiValidateExtensions,
  // --- eforge:region plan-01-extension-management-api ---
  apiNewExtension,
  apiReloadExtensions,
  // --- eforge:endregion plan-01-extension-management-api ---
  // --- eforge:region plan-01-engine-daemon-extension-replay ---
  apiTestExtension,
  // --- eforge:endregion plan-01-engine-daemon-extension-replay ---
  // --- eforge:region plan-02-management-surfaces ---
  apiTrustExtension,
  apiUntrustExtension,
  // --- eforge:endregion plan-02-management-surfaces ---
  // --- eforge:region plan-01-no-start-client-helpers ---
  apiListExtensionsIfRunning,
  apiShowExtensionIfRunning,
  apiValidateExtensionsIfRunning,
  apiNewExtensionIfRunning,
  apiReloadExtensionsIfRunning,
  apiTestExtensionIfRunning,
  apiTrustExtensionIfRunning,
  apiUntrustExtensionIfRunning,
  // --- eforge:endregion plan-01-no-start-client-helpers ---
  // --- eforge:region plan-01-extension-package-foundation ---
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
  // --- eforge:endregion plan-01-extension-package-foundation ---
} from './api/extensions.js';
// --- eforge:endregion plan-02-extension-tooling-surfaces ---

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
} from './routes.js';

// --- eforge:region plan-03-stack-daemon-ui ---
export type { StackLayersResponse } from './routes.js';
export { apiGetStackLayers, apiGetStackLayersIfRunning } from './api/stack.js';
// --- eforge:endregion plan-03-stack-daemon-ui ---

// --- eforge:region plan-01-stack-sync-daemon-cli ---
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
// --- eforge:endregion plan-01-stack-sync-daemon-cli ---

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

export type { ApplyRecoveryRequest, ApplyRecoveryResponse } from './routes.js';

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
  isAgentWorktreeCwd,
  DaemonInWorktreeError,
} from './daemon-client.js';

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
  // --- eforge:region plan-01-stack-contracts-config-state-events ---
  StackProvider,
  LandingPublicationAction,
  StackLayerStatus,
  StackArtifactRef,
  StackLayerWire,
  // --- eforge:endregion plan-01-stack-contracts-config-state-events ---
} from './events.js';

export { ORCHESTRATION_MODES, SEVERITY_ORDER, isAlwaysYieldedAgentEvent, EforgeEventSchema, REVIEW_PERSPECTIVES, BuildDecisionSchema, PlanningDecisionSchema,
  // --- eforge:region plan-01-validation-evidence-contract ---
  AcceptanceCriterionVerdictSchema,
  // --- eforge:endregion plan-01-validation-evidence-contract ---
  safeParseEforgeEvent, parseEforgeEvent, safeParseDaemonStreamSnapshot, safeParseSessionStreamSnapshot,
  // --- eforge:region plan-01-dynamic-perspective-contracts ---
  ReviewPerspectiveKeySchema, isBuiltInReviewPerspective,
  // --- eforge:endregion plan-01-dynamic-perspective-contracts ---
  // --- eforge:region plan-01-stack-contracts-config-state-events ---
  StackProviderSchema, LandingPublicationActionSchema, StackLayerStatusSchema, StackArtifactRefSchema, StackLayerWireSchema,
  // --- eforge:endregion plan-01-stack-contracts-config-state-events ---
} from './events.js';

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
  // --- eforge:region plan-01-engine-trust-foundation ---
  ExtensionTrustState,
  // --- eforge:endregion plan-01-engine-trust-foundation ---
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
  // --- eforge:region plan-02-validation-provider-projections-ui-docs ---
  ValidationProviderDetail,
  // --- eforge:endregion plan-02-validation-provider-projections-ui-docs ---
  ExtensionEntry,
  ExtensionListResponse,
  ExtensionShowResponse,
  ExtensionValidateResponse,
  // --- eforge:region plan-01-engine-daemon-extension-replay ---
  ExtensionTestRequest,
  ExtensionTestSource,
  ExtensionTestReplayCounts,
  ExtensionTestMatch,
  ExtensionTestDiagnosticEvent,
  ExtensionTestDeferredRegistrationFamily,
  ExtensionTestDeferredRegistrationSummary,
  ExtensionTestResponse,
  // --- eforge:endregion plan-01-engine-daemon-extension-replay ---
  // --- eforge:region plan-01-extension-management-api ---
  ExtensionNewRequest,
  ExtensionNewResponse,
  ExtensionReloadWatcherMetadata,
  ExtensionReloadResponse,
  // --- eforge:endregion plan-01-extension-management-api ---
  // --- eforge:region plan-02-management-surfaces ---
  ExtensionTrustRequest,
  ExtensionTrustResponse,
  ExtensionUntrustRequest,
  ExtensionUntrustResponse,
  // --- eforge:endregion plan-02-management-surfaces ---
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
