/**
 * Missing request type shapes not yet declared in types.ts.
 * Re-export from index so callers can import the request/response pair together.
 */
import type { StackLayerWire } from './events.js';
import type { BuildFailureSummary, RecoveryVerdict } from './events.js';
/** POST /api/enqueue */
export interface EnqueueRequest {
  source: string;
  flags?: string[];
  /** Override the active profile for this build (profile name, validated at enqueue time). */
  profile?: string;
  /** Override the project-level landing action for this build. */
  landingAction?: 'pr' | 'merge' | 'leave';
  /** When true, enable GitHub PR auto-merge after PR creation (requires the effective landing action to be 'pr', whether supplied via landingAction or resolved from project config). */
  landingAutoMerge?: boolean;
  /**
   * Optional upstream queue item id. When provided, the enqueued PRD gains
   * `depends_on: [afterQueueId]` in its frontmatter. Placement depends on the
   * upstream state:
   * - Active upstream (pending/running/waiting): placed in `.eforge/queue/waiting/`
   *   and unblocked by the queue scheduler when the upstream completes.
   * - Completed upstream with a usable artifact: placed in the queue root as an
   *   immediately eligible dependent (no waiting required).
   *
   * Failed, skipped, and unknown ids are rejected with an error containing the
   * invalid id.
   *
   * Explicit `afterQueueId` takes precedence over any automatic dependency
   * detection performed during enqueue.
   */
  afterQueueId?: string;
}
/** POST /api/auto-build */
export interface AutoBuildSetRequest {
  enabled: boolean;
}

/** POST /api/daemon/stop */
export interface StopDaemonRequest {
  force?: boolean;
}

/** POST /api/recover */
export interface RecoverRequest {
  setName: string;
  prdId: string;
}

/** Response for POST /api/recover */
export interface RecoverResponse {
  sessionId: string;
  pid: number;
}

/** Query params for GET /api/recovery/sidecar */
export interface ReadSidecarRequest {
  prdId: string;
}

/**
 * JSON structure written by `eforge recover` into `<prdId>.recovery.json`.
 * Mirrors the shape produced by `writeRecoverySidecar` in the engine (schemaVersion: 1).
 *
 * `summary` and `verdict` use the shared wire types from @eforge-build/client so
 * new optional fields (e.g. failingPlans, commitSha, testPassed) are automatically
 * reflected here without requiring separate maintenance of this interface.
 * Legacy sidecars without the new optional fields still parse because all added
 * fields are optional.
 */
export interface RecoveryVerdictSidecar {
  schemaVersion: number;
  generatedAt: string;
  summary: BuildFailureSummary;
  verdict: RecoveryVerdict;
}

/** Response for GET /api/recovery/sidecar */
export interface ReadSidecarResponse {
  markdown: string;
  json: RecoveryVerdictSidecar;
}

/** POST /api/recover/resume-build */
export interface ResumeBuildRequest {
  prdId: string;
  /** Override the set name. When omitted, the set name is resolved from the recovery sidecar when available, otherwise derived from the prdId. */
  setName?: string;
}

/** Response for POST /api/recover/resume-build */
export interface ResumeBuildResponse {
  sessionId: string;
  pid: number;
}

/** POST /api/recover/apply */
export interface ApplyRecoveryRequest {
  prdId: string;
}

/**
 * Response for POST /api/recover/apply.
 *
 * The route applies the recovery verdict synchronously in-process and returns
 * the outcome directly. Replaces the old `{ sessionId, pid }` shape (v16) which
 * returned a detached worker's identifiers before the mutation completed.
 */
export interface ApplyRecoveryResponse {
  /** The verdict that was applied. */
  verdict: 'retry' | 'split' | 'abandon' | 'manual';
  /** SHA of the commit produced by the apply operation. Absent for `manual` (no-op). */
  commitSha?: string;
  /** ID of the successor PRD enqueued by a `split` verdict. */
  successorPrdId?: string;
  /** True when the verdict was `manual` and no git changes were made. */
  noAction?: boolean;
}

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
  queue: '/api/queue',
  queueRecoveryAnalyze: '/api/queue/recovery/analyze', queueRecoveryApply: '/api/queue/recovery/apply',
  sessionMetadata: '/api/session-metadata',
  runs: '/api/runs',
  events: '/api/events/:runId',
  runSummary: '/api/run-summary/:id',
  runState: '/api/run-state/:id',
  plans: '/api/plans/:runId',
  diff: '/api/diff/:sessionId/:planId',
  recover: '/api/recover',
  readRecoverySidecar: '/api/recovery/sidecar',
  applyRecovery: '/api/recover/apply',
  resumeBuild: '/api/recover/resume-build',
  schedulerKick: '/api/scheduler/kick',
  playbookList: '/api/playbook/list',
  playbookShow: '/api/playbook/show',
  playbookSave: '/api/playbook/save',
  playbookRun: '/api/playbook/run',
  playbookPromote: '/api/playbook/promote',
  playbookDemote: '/api/playbook/demote',
  playbookValidate: '/api/playbook/validate',
  playbookCopy: '/api/playbook/copy',
  sessionPlanList: '/api/session-plan/list',
  sessionPlanShow: '/api/session-plan/show',
  sessionPlanCreate: '/api/session-plan/create',
  sessionPlanSetSection: '/api/session-plan/set-section',
  sessionPlanSkipDimension: '/api/session-plan/skip-dimension',
  sessionPlanSetStatus: '/api/session-plan/set-status',
  sessionPlanSelectDimensions: '/api/session-plan/select-dimensions',
  sessionPlanReadiness: '/api/session-plan/readiness',
  sessionPlanMigrateLegacy: '/api/session-plan/migrate-legacy',
  sessionPlanCreateFromPlaybook: '/api/session-plan/create-from-playbook',
  sessionPlanSetList: '/api/session-plan-set/list',
  sessionPlanSetShow: '/api/session-plan-set/show',
  sessionPlanSetValidate: '/api/session-plan-set/validate',
  daemonEvents: '/api/daemon-events',
  stackLayers: '/api/stack/layers',
  stackSync: '/api/stack/sync',
  stackSyncStatus: '/api/stack/sync/status',
} as const;

/** Response body for GET /api/version */
export interface VersionResponse {
  /** Daemon HTTP API protocol version (DAEMON_API_VERSION). Bumps on breaking changes. */
  version: number;
  /**
   * eforge package version baked into the daemon bundle at build time
   * (`{semver}{-dirty?} ({sha})`). Compare against the CLI/proxy's own
   * EFORGE_VERSION to detect a stale daemon (rebuilt without restart).
   * Optional for backward compatibility with older daemons.
   */
  eforgeVersion?: string;
}

// ---------------------------------------------------------------------------
// Session-plan route request/response interfaces
// ---------------------------------------------------------------------------

/** Lifecycle status of a session plan. */
export type SessionPlanStatusWire = 'planning' | 'ready' | 'abandoned' | 'submitted';

/** Planning type of a session plan. */
export type PlanningTypeWire =
  | 'bugfix'
  | 'feature'
  | 'refactor'
  | 'architecture'
  | 'docs'
  | 'maintenance'
  | 'unknown';

/** Planning depth of a session plan. */
export type PlanningDepthWire = 'quick' | 'focused' | 'deep';

/** A skipped dimension entry. */
export interface SkippedDimensionWire {
  name: string;
  reason: string;
}

/** Query options for GET /api/session-plan/list */
export interface SessionPlanListRequest {
  /** When true, include plans with status `'submitted'` in addition to `'planning'` and `'ready'`. */
  includeSubmitted?: boolean;
}

/** A lightweight session plan listing entry. */
export interface SessionPlanListEntryWire {
  session: string;
  topic: string;
  status: SessionPlanStatusWire;
  path: string;
  ready: boolean;
  missingDimensions: string[];
  /** Associated eforge run session identifier. Present when the plan was submitted and declares `eforge_session`. */
  eforge_session?: string;
}

/** Readiness detail returned by mutation routes and the readiness GET. */
export interface SessionPlanReadinessDetail {
  ready: boolean;
  missingDimensions: string[];
  coveredDimensions: string[];
  skippedDimensions: string[];
}

/** Full session plan data as returned by the daemon. */
export interface SessionPlanDataWire {
  session: string;
  topic: string;
  status: SessionPlanStatusWire;
  planning_type: PlanningTypeWire;
  planning_depth: PlanningDepthWire;
  eforge_session?: string;
  required_dimensions: string[];
  optional_dimensions: string[];
  skipped_dimensions: SkippedDimensionWire[];
  open_questions: string[];
  profile: 'errand' | 'excursion' | 'expedition' | null;
  body: string;
  /** Optional inherited agent runtime profile name. Set when created from a planning-mode playbook with a profile. */
  agent_profile?: string;
}

/** Response for GET /api/session-plan/list */
export interface SessionPlanListResponse {
  plans: SessionPlanListEntryWire[];
}

/** Response for GET /api/session-plan/show */
export interface SessionPlanShowResponse {
  plan: SessionPlanDataWire;
  readiness: SessionPlanReadinessDetail;
  path: string;
}

/** Request body for POST /api/session-plan/create */
export interface SessionPlanCreateRequest {
  session: string;
  topic: string;
  planning_type?: PlanningTypeWire;
  planning_depth?: PlanningDepthWire;
  profile?: 'errand' | 'excursion' | 'expedition' | null;
  /** Optional inherited agent runtime profile name. Not validated at create time. */
  agent_profile?: string;
}

/** Response for POST /api/session-plan/create */
export interface SessionPlanCreateResponse {
  session: string;
  path: string;
}

/** Request body for POST /api/session-plan/set-section */
export interface SessionPlanSetSectionRequest {
  session: string;
  dimension: string;
  content: string;
}

/** Response for POST /api/session-plan/set-section */
export interface SessionPlanSetSectionResponse {
  session: string;
  readiness: SessionPlanReadinessDetail;
}

/** Request body for POST /api/session-plan/skip-dimension */
export interface SessionPlanSkipDimensionRequest {
  session: string;
  dimension: string;
  reason: string;
}

/** Response for POST /api/session-plan/skip-dimension */
export interface SessionPlanSkipDimensionResponse {
  session: string;
  readiness: SessionPlanReadinessDetail;
}

/** Request body for POST /api/session-plan/set-status */
export interface SessionPlanSetStatusRequest {
  session: string;
  status: SessionPlanStatusWire;
  /** Required when status is 'submitted'. */
  eforge_session?: string;
}

/** Response for POST /api/session-plan/set-status */
export interface SessionPlanSetStatusResponse {
  session: string;
}

/** Request body for POST /api/session-plan/select-dimensions */
export interface SessionPlanSelectDimensionsRequest {
  session: string;
  planning_type?: PlanningTypeWire;
  planning_depth?: PlanningDepthWire;
  overwrite?: boolean;
}

/** Response for POST /api/session-plan/select-dimensions */
export interface SessionPlanSelectDimensionsResponse {
  session: string;
  required_dimensions: string[];
  optional_dimensions: string[];
  readiness: SessionPlanReadinessDetail;
}

/** Response for GET /api/session-plan/readiness */
export interface SessionPlanReadinessResponse {
  ready: boolean;
  missingDimensions: string[];
  coveredDimensions: string[];
  skippedDimensions: string[];
}

/** Request body for POST /api/session-plan/migrate-legacy */
export interface SessionPlanMigrateLegacyRequest {
  session: string;
}

// ---------------------------------------------------------------------------
// Playbook run route request/response interfaces
// ---------------------------------------------------------------------------

/** Request body for POST /api/playbook/run */
export interface PlaybookRunRequest {
  name: string;
  afterQueueId?: string;
  /** Override the project-level landing action for this autonomous playbook run. */
  landingAction?: 'pr' | 'merge' | 'leave';
  /** When true, enable GitHub PR auto-merge after PR creation (requires the effective landing action to be 'pr', whether supplied via landingAction or resolved from project config). */
  landingAutoMerge?: boolean;
}

/** Response for POST /api/playbook/run when the playbook is autonomous */
export interface PlaybookRunEnqueuedResponse {
  kind: 'enqueued';
  id: string;
}

/**
 * Response for POST /api/playbook/run when the playbook is planning-mode.
 * The request is valid; the daemon returns this typed result so first-party clients
 * can delegate to an interactive agent (e.g. /eforge:plan or /skill:eforge-playbook run).
 * No session-plan file is written and nothing is enqueued.
 */
export interface PlaybookRunRequiresAgentResponse {
  kind: 'requires-agent';
  mode: 'planning';
  name: string;
  message: string;
}

/** Discriminated union response for POST /api/playbook/run */
export type PlaybookRunResponse = PlaybookRunEnqueuedResponse | PlaybookRunRequiresAgentResponse;

// ---------------------------------------------------------------------------
// Session-plan create-from-playbook route request/response interfaces
// ---------------------------------------------------------------------------

/** Request body for POST /api/session-plan/create-from-playbook */
export interface SessionPlanCreateFromPlaybookRequest {
  playbook_name: string;
  session?: string;
  topic?: string;
}

/** Response for POST /api/session-plan/create-from-playbook */
export interface SessionPlanCreateFromPlaybookResponse {
  session: string;
  path: string;
}

/** Response for POST /api/session-plan/migrate-legacy */
export interface SessionPlanMigrateLegacyResponse {
  session: string;
  /** True when the plan was on the legacy schema and got migrated; false when the plan was already on the current schema. */
  migrated: boolean;
}

/** Response for GET /api/stack/layers */
export interface StackLayersResponse {
  layers: StackLayerWire[];
}

/** A single provider command recorded in a POST /api/stack/sync response. */
export interface StackSyncProviderCommandWire {
  /** The resolved executable path. */
  command: string;
  /** The argv passed to the command (without the executable). */
  args: string[];
  /** True when the command was not executed (dry-run mode). */
  dryRun: boolean;
  /** True when the command was actually executed. Always false in dry-run mode. */
  ran: boolean;
  /** Captured stdout from the command (absent in dry-run). */
  stdout?: string;
  /** Captured stderr from the command (absent in dry-run). */
  stderr?: string;
  /** Exit code. Always 0 on success; absent in dry-run mode. */
  exitCode?: number;
}

/** An active-build skip entry in POST /api/stack/sync response. */
export interface StackSyncActiveBuildSkipWire {
  /** Branch prefix that was excluded (e.g. 'eforge/my-plan-set'). */
  branch: string;
  /** Worktree path associated with the active build, when available. */
  worktree?: string;
  /** Human-readable reason for the exclusion. */
  reason: string;
}

/** Outcome of a POST /api/stack/sync operation. */
export type StackSyncOutcomeWire = 'skipped' | 'complete' | 'failed' | 'conflict' | 'deferred';

/** Request body for POST /api/stack/sync */
export interface StackSyncRequest {
  /**
   * When true, determine what commands would run but do not execute them.
   * Branch SHAs are left unchanged.
   */
  dryRun?: boolean;
  /** The trigger that initiated this sync (propagated to the durable status record). */
  trigger?: 'manual' | 'after-build' | 'scheduled' | 'retry-deferred';
  /**
   * How to handle active-build overlap in wet mode.
   * 'skip' (default) — return 'skipped' outcome when excluded candidates exist.
   * 'defer'          — return 'deferred' outcome instead; retry when builds complete.
   * Dry-runs always use 'skip' semantics.
   */
  activeBuildPolicy?: 'skip' | 'defer';
}

/** Durable stack sync status record as returned by the status route. */
export interface StackSyncStatusWire {
  /** Unique identifier for this sync operation. */
  id: string;
  /** Trigger that initiated the sync. */
  trigger?: 'manual' | 'after-build' | 'scheduled' | 'retry-deferred';
  /** Active-build policy used for this sync. */
  activeBuildPolicy?: 'skip' | 'defer';
  /** ISO timestamp when the sync started. */
  startedAt: string;
  /** ISO timestamp when the sync completed (absent for in-progress syncs). */
  completedAt?: string;
  /**
   * Overall outcome. Absent for in-progress (current) records that have not
   * yet completed. Always present on terminal (last) records.
   */
  outcome?: StackSyncOutcomeWire;
  /** Human-readable reason (present for non-complete outcomes). */
  reason?: string;
  /** Error message when outcome is 'failed' or 'conflict'. */
  error?: string;
  /** Whether the sync was a dry run. */
  dryRun: boolean;
  /** SHA of the local trunk branch, when available. */
  localTrunkSha?: string;
  /** SHA of origin/<trunk>, when available. */
  originTrunkSha?: string;
  /** Whether the local trunk was at or behind origin. */
  fastForward?: boolean;
  /** Artifact branches eligible for restack after exclusion filtering. */
  restackCandidates: string[];
  /** Branches and worktrees skipped because active builds are using them (present on terminal records). */
  activeBuildSkips?: StackSyncActiveBuildSkipWire[];
  /** Provider commands that were executed or would be executed in dry-run mode (present on terminal records). */
  providerCommands?: StackSyncProviderCommandWire[];
}

/** Response for GET /api/stack/sync/status */
export interface StackSyncStatusResponse {
  /** The most recently completed (terminal) sync status. Absent when no sync has completed. */
  last?: StackSyncStatusWire;
  /** The currently in-progress sync status. Absent when no sync is running. */
  current?: StackSyncStatusWire;
}

/** Response for POST /api/stack/sync */
export interface StackSyncResponse {
  /** Overall outcome. */
  outcome: StackSyncOutcomeWire;
  /** Human-readable reason (always present for 'skipped', 'failed', 'conflict', 'deferred'). */
  reason?: string;
  /** True when stacking is enabled and active (false for 'skipped' outcome). */
  stackingActive: boolean;
  /** Whether the sync was a dry run. */
  dryRun: boolean;
  /** SHA of the local trunk branch, when available. */
  localTrunkSha?: string;
  /** SHA of origin/<trunk>, when available. */
  originTrunkSha?: string;
  /** Whether the local trunk is already at or behind origin (fast-forward eligible). */
  fastForward?: boolean;
  /** Artifact branches eligible for restack (after active-build exclusions). */
  restackCandidates: string[];
  /** Branches and worktrees skipped because active builds are using them. */
  activeBuildSkips: StackSyncActiveBuildSkipWire[];
  /** Provider commands that were executed or would be executed in dry-run mode. */
  providerCommands: StackSyncProviderCommandWire[];
  /** Error message when outcome is 'failed' or 'conflict'. */
  error?: string;
  /** Unique sync operation ID (present when routed through the daemon service). */
  syncId?: string;
  /** The trigger that initiated this sync (present when supplied in the request). */
  trigger?: 'manual' | 'after-build' | 'scheduled' | 'retry-deferred';
  /** Active-build policy used (present when supplied in the request). */
  activeBuildPolicy?: 'skip' | 'defer';
  /** ISO timestamp when the sync started (present when routed through the daemon service). */
  startedAt?: string;
  /** ISO timestamp when the sync completed (present when routed through the daemon service). */
  completedAt?: string;
}

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
