/**
 * Backward-compatible facade for daemon route constants and route-local wire types.
 *
 * Keep this module as the public `./routes.js` import surface while grouped route
 * contracts live in focused files under `routes/`.
 */
export { API_ROUTES, buildPath } from './routes/route-map.js';
export type { ApiRoute } from './routes/route-map.js';

export type {
  EnqueueRequest,
  AutoBuildSetRequest,
  StopDaemonRequest,
  VersionResponse,
} from './routes/core.js';

export type {
  RecoverRequest,
  RecoverResponse,
  ReadSidecarRequest,
  RecoverySidecarReport,
  RecoverySidecarBoundedEvidence,
  RecoverySidecarResumeEligibilitySource,
  RecoverySidecarResumeEligibility,
  RecoverySidecarRecoveryOption,
  RecoveryVerdictSidecar,
  RecoveryAppliedMetadata,
  ReadSidecarResponse,
  ResumeBuildRequest,
  ResumeBuildResponse,
  ResumeEligibilityRequest,
  ResumeEligibilityResponse,
  ResumeArtifactAvailability,
  ApplyRecoveryRequest,
  ApplyRecoveryResponse,
  AcceptSuccessReasonCategory,
  AcceptSuccessLandingAction,
  AcceptSuccessPreviewRequest,
  AcceptSuccessCleanupEffect,
  AcceptSuccessAuditFields,
  AcceptSuccessDependentCandidate,
  AcceptSuccessCleanupResult,
  AcceptSuccessAutoMergeResult,
  AcceptSuccessLandingResult,
  AcceptSuccessDependentResult,
  AcceptSuccessAppliedSummary,
  AcceptSuccessPreviewResponse,
  AcceptSuccessRequest,
  AcceptSuccessResponse,
} from './routes/recovery.js';

export { ACCEPT_SUCCESS_REASON_CATEGORIES } from './routes/recovery.js';

export type {
  SessionPlanStatusWire,
  PlanningTypeWire,
  PlanningDepthWire,
  SkippedDimensionWire,
  SessionPlanListRequest,
  SessionPlanListEntryWire,
  SessionPlanReadinessDetail,
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
  SessionPlanCreateFromPlaybookRequest,
  SessionPlanCreateFromPlaybookResponse,
  SessionPlanMigrateLegacyResponse,
} from './routes/session-plan.js';

export type {
  QueueControlStatus,
  QueuePriorityRequest,
  QueuePriorityResponse,
  QueueRemoveResponse,
  QueueDependencyOverrideRequest,
  QueueDependencyOverrideResponse,
} from './routes/queue-control.js';

export type {
  PlaybookRunRequest,
  PlaybookRunEnqueuedResponse,
  PlaybookRunRequiresAgentResponse,
  PlaybookRunResponse,
} from './routes/playbook.js';

export type {
  StackLayersResponse,
  StackSyncProviderCommandWire,
  StackSyncActiveBuildSkipWire,
  StackSyncOutcomeWire,
  StackSyncRequest,
  StackSyncStatusWire,
  StackSyncStatusResponse,
  StackSyncResponse,
} from './routes/stack.js';

// --- eforge:region plan-01-agent-task-contracts-engine-runner ---
export type {
  ExtensionAgentTaskCancelRequest,
  ExtensionAgentTaskCancelResponse,
  ExtensionAgentTaskGetRequest,
  ExtensionAgentTaskGetResponse,
  ExtensionAgentTaskId,
  ExtensionAgentTaskKind,
  ExtensionAgentTaskRecord,
  ExtensionAgentTaskSanitizedMetadata,
  ExtensionAgentTaskStartRequest,
  ExtensionAgentTaskStartResponse,
  ExtensionAgentTaskStatus,
  EforgePlanPlanningDraftInput,
  EforgePlanPlanningDraftResult,
} from './extension-agent-tasks.js';
// --- eforge:endregion plan-01-agent-task-contracts-engine-runner ---
