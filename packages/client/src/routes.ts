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
  RecoveryVerdictSidecar,
  ReadSidecarResponse,
  ResumeBuildRequest,
  ResumeBuildResponse,
  ResumeEligibilityRequest,
  ResumeEligibilityResponse,
  ResumeArtifactAvailability,
  ApplyRecoveryRequest,
  ApplyRecoveryResponse,
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
  SessionPlanCreateFromPlaybookRequest,
  SessionPlanCreateFromPlaybookResponse,
  SessionPlanMigrateLegacyResponse,
} from './routes/session-plan.js';

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
