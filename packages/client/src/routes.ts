/**
 * Backward-compatible facade for daemon route constants and route-local wire types.
 *
 * Keep this module as the public `./routes.js` import surface while grouped route
 * contracts live in focused files under `routes/`.
 */
export { API_ROUTES, buildPath, buildProfileListPath } from './routes/route-map.js';
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
  RecoverySidecarContinueRepairEligibilitySource,
  RecoverySidecarContinueRepairEligibility,
  RecoverySidecarSchemaVersion,
  RecoverySidecarContinueRepairOption,
  RecoverySidecarCompileScopeContextAction,
  RecoverySidecarCompileScopeContextOption,
  RecoverySidecarRecoveryOption,
  RecoveryVerdictSidecar,
  RecoveryAppliedMetadata,
  ReadSidecarResponse,
  ContinueRepairRequest,
  ContinueRepairResponse,
  ContinueRepairEligibilityRequest,
  ContinueRepairEligibilityResponse,
  ContinueRepairArtifactAvailability,
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

export {
  ACCEPT_SUCCESS_REASON_CATEGORIES,
  RECOVERY_SIDECAR_COMPILE_SCOPE_CONTEXT_ACTIONS,
  RECOVERY_SIDECAR_COMPILE_SCOPE_CONTEXT_REASON_MAX_BYTES,
  RecoverySidecarContinueRepairOptionSchema,
  RecoverySidecarCompileScopeContextActionSchema,
  RecoverySidecarCompileScopeContextOptionSchema,
  RecoverySidecarRecoveryOptionSchema,
} from './routes/recovery.js';

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
  SessionPlanMigrateLegacyResponse,
} from './routes/session-plan.js';

export type {
  QueueControlStatus,
  QueuePriorityRequest,
  QueuePriorityResponse,
  QueueRemoveResponse,
  QueueDependencyOverrideRequest,
  QueueDependencyOverrideResponse,
  QueueHoldRequest,
  QueueHoldResponse,
  QueueUnholdRequest,
  QueueUnholdResponse,
  QueueControlLocation,
  QueueCascadeOperation,
  QueueCascadeApplyResultStatus,
  QueueCascadeStrategy,
  QueueCascadeEffect,
  QueueCascadeRunningOwnership,
  QueueCascadeAffectedItem,
  QueueCascadeExpectedAffected,
  QueueCascadePreviewRequest,
  QueueCascadePreviewResponse,
  QueueCascadeApplyRequest,
  QueueCascadeApplyItemResult,
  QueueCascadeApplyResponse,
} from './routes/queue-control.js';

export type {
  RecoveryGuidancePrepareRequest,
  RecoveryGuidancePatchStatus,
  RecoveryGuidancePatchedPlan,
  RecoveryGuidancePrepareResponse,
} from './routes/recovery-guidance.js';

export type {
  FailedEnqueuesResponse,
  FailedEnqueueReenqueueRequest,
  FailedEnqueueReenqueueResponse,
  FailedEnqueueDismissRequest,
  FailedEnqueueDismissResponse,
} from './routes/failed-enqueue.js';

export type {
  SchedulerKickResponse,
  SchedulerPauseResponse,
  SchedulerResumeResponse,
} from './routes/scheduler.js';


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

// --- eforge:region extension-agent-task-contracts ---
export {
  EXTENSION_AGENT_TASK_ACTIVITY_LOG_MAX_ENTRIES,
  EXTENSION_AGENT_TASK_ACTIVITY_MESSAGE_MAX_LENGTH,
} from './extension-agent-tasks/constants.js';

export type {
  ExtensionAgentTaskActivityEntry,
  ExtensionAgentTaskCancelRequest,
  ExtensionAgentTaskCancelResponse,
  ExtensionAgentTaskGetRequest,
  ExtensionAgentTaskGetResponse,
  ExtensionAgentTaskId,
  ExtensionAgentTaskBacklogCurationItemProgress,
  ExtensionAgentTaskBacklogCurationProgress,
  ExtensionAgentTaskKind,
  ExtensionAgentTaskRecord,
  ExtensionAgentTaskSanitizedMetadata,
  ExtensionAgentTaskStartRequest,
  ExtensionAgentTaskStartResponse,
  ExtensionAgentTaskStatus,
  EforgePlanPlanningDraftInput,
  EforgePlanPlanningDraftResult,
} from './extension-agent-tasks.js';
// --- eforge:endregion extension-agent-task-contracts ---
