/**
 * Central API route map for the eforge daemon HTTP API.
 *
 * Single source of truth for all `/api/...` path patterns. Consumers import
 * these constants instead of embedding literal strings, so a route rename
 * surfaces as a compile-time error everywhere.
 *
 * Patterns with `:param` placeholders are resolved at call-time with
 * `buildPath(pattern, params)`.
 */
export const API_ROUTES = {
  keepAlive: '/api/keep-alive',
  enqueue: '/api/enqueue',
  cancel: '/api/cancel/:sessionId',
  daemonStop: '/api/daemon/stop',
  autoBuildGet: '/api/auto-build',
  autoBuildSet: '/api/auto-build',
  profileList: '/api/profile/list',
  profileShow: '/api/profile/show',
  profileUse: '/api/profile/use',
  profileCreate: '/api/profile/create',
  profileDelete: '/api/profile/:name',
  modelProviders: '/api/models/providers',
  modelList: '/api/models/list',
  projectContext: '/api/project-context',
  health: '/api/health',
  version: '/api/version',
  configShow: '/api/config/show',
  configValidate: '/api/config/validate',
  extensionList: '/api/extensions/list',
  extensionShow: '/api/extensions/show',
  extensionValidate: '/api/extensions/validate',
  extensionTest: '/api/extensions/test',
  extensionTrust: '/api/extensions/trust',
  extensionUntrust: '/api/extensions/untrust',
  extensionNew: '/api/extensions/new',
  extensionReload: '/api/extensions/reload',
  extensionInstall: '/api/extensions/install',
  extensionUpdate: '/api/extensions/update',
  extensionRemove: '/api/extensions/remove',
  extensionPromote: '/api/extensions/promote',
  extensionDemote: '/api/extensions/demote',
  extensionContributionManifest: '/api/extensions/contributions',
  extensionWorkstationFrame: '/api/extensions/workstations/:workstationId/frame',
  extensionWorkstationAsset: '/api/extensions/workstations/:workstationId/assets/:assetId',
  extensionActionInvoke: '/api/extensions/actions/invoke',
  // --- eforge:region extension-agent-task-routes ---
  extensionAgentTaskStart: '/api/extensions/agent-tasks',
  extensionAgentTaskGet: '/api/extensions/agent-tasks/:taskId',
  extensionAgentTaskCancel: '/api/extensions/agent-tasks/:taskId/cancel',
  // --- eforge:endregion extension-agent-task-routes ---
  queue: '/api/queue',
  queuePriority: '/api/queue/:prdId/priority',
  queueRemove: '/api/queue/:prdId',
  queueDependencyOverride: '/api/queue/:prdId/dependencies/override',
  queueHold: '/api/queue/:prdId/hold',
  queueUnhold: '/api/queue/:prdId/unhold',
  queueCascadePreview: '/api/queue/:prdId/cascade/preview',
  queueCascadeApply: '/api/queue/:prdId/cascade/apply',
  queueRecoveryAnalyze: '/api/queue/recovery/analyze',
  queueRecoveryApply: '/api/queue/recovery/apply',
  sessionMetadata: '/api/session-metadata',
  runs: '/api/runs',
  spend: '/api/spend',
  // --- eforge:region plan-01-efficiency-analytics-foundation ---
  efficiencyAnalytics: '/api/efficiency-analytics',
  // --- eforge:endregion plan-01-efficiency-analytics-foundation ---
  events: '/api/events/:runId',
  runSummary: '/api/run-summary/:id',
  runState: '/api/run-state/:id',
  plans: '/api/plans/:runId',
  diff: '/api/diff/:sessionId/:planId',
  recover: '/api/recover',
  recoveryGuidancePrepare: '/api/recover/guidance/prepare',
  readRecoverySidecar: '/api/recovery/sidecar',
  applyRecovery: '/api/recover/apply',
  acceptRecoverySuccessPreview: '/api/recover/accept-success/preview',
  acceptRecoverySuccess: '/api/recover/accept-success',
  continueRepair: '/api/recover/continue-repair',
  continueRepairEligibility: '/api/recover/continue-repair/eligibility',
  schedulerKick: '/api/scheduler/kick',
  failedEnqueues: '/api/enqueue/failed',
  failedEnqueueReenqueue: '/api/enqueue/failed/:runId/reenqueue',
  failedEnqueueDismiss: '/api/enqueue/failed/:runId/dismiss',
  schedulerPause: '/api/scheduler/pause',
  schedulerResume: '/api/scheduler/resume',
  sessionPlanList: '/api/session-plan/list',
  sessionPlanShow: '/api/session-plan/show',
  sessionPlanCreate: '/api/session-plan/create',
  sessionPlanSetSection: '/api/session-plan/set-section',
  sessionPlanSkipDimension: '/api/session-plan/skip-dimension',
  sessionPlanSetStatus: '/api/session-plan/set-status',
  sessionPlanSelectDimensions: '/api/session-plan/select-dimensions',
  sessionPlanReadiness: '/api/session-plan/readiness',
  sessionPlanMigrateLegacy: '/api/session-plan/migrate-legacy',
  sessionPlanSetList: '/api/session-plan-set/list',
  sessionPlanSetShow: '/api/session-plan-set/show',
  sessionPlanSetValidate: '/api/session-plan-set/validate',
  daemonEvents: '/api/daemon-events',
  stackLayers: '/api/stack/layers',
  stackSync: '/api/stack/sync',
  stackSyncStatus: '/api/stack/sync/status',
} as const;

export type ApiRoute = (typeof API_ROUTES)[keyof typeof API_ROUTES];

/**
 * Resolve a route pattern with `:param` placeholders into a concrete path.
 *
 * @example
 * buildPath(API_ROUTES.cancel, { sessionId: 'abc-123' })
 * // => '/api/cancel/abc-123'
 */
export function buildPath(pattern: string, params: Record<string, string>): string {
  return Object.entries(params).reduce(
    (path, [key, value]) => path.replace(`:${key}`, encodeURIComponent(value)),
    pattern,
  );
}
