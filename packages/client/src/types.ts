import type { EforgeEvent } from './events.js';
import type { ConsoleContributionManifestEntry, ConsoleWorkstationManifestEntry, ExtensionActionManifestEntry, ExtensionDeepLinkManifestEntry, IntegrationCommandManifestEntry } from './extension-contributions.js';
import type { RecoveryAppliedMetadata } from './routes/recovery.js';

// GET /api/health
export interface HealthResponse {
  status: 'ok';
  pid: number;
}

// GET /api/auto-build, POST /api/auto-build
export type AutoBuildDesired = 'enabled' | 'disabled';
export type AutoBuildRuntimeMode =
  | 'disabled'
  | 'starting'
  | 'running'
  | 'paused'
  | 'stopping'
  | 'restarting'
  | 'faulted';

export interface AutoBuildSchedulerState {
  alive: boolean;
  paused: boolean;
  lastMutationReason?: string;
  /** Number of builds currently running, as reported by the scheduler. */
  runningCount?: number;
  /** Maximum concurrent build limit configured in the daemon, as reported by the scheduler. */
  limit?: number;
}

export interface AutoBuildTransitionDetail {
  at: string;
  previousMode: AutoBuildRuntimeMode;
  nextMode: AutoBuildRuntimeMode;
  desired: AutoBuildDesired;
  reason?: string;
  source: string;
}

export interface AutoBuildState {
  enabled: boolean;
  watcher: {
    running: boolean;
    pid: number | null;
    sessionId: string | null;
  };
  desired?: AutoBuildDesired;
  mode?: AutoBuildRuntimeMode;
  scheduler?: AutoBuildSchedulerState;
  lastTransition?: AutoBuildTransitionDetail;
  reason?: string;
}

// GET /api/project-context
export interface ProjectContext {
  cwd: string | null;
  gitRemote: string | null;
}

// GET /api/config/show - opaque, full EforgeConfig has engine deps
export type ConfigShowResponse = unknown;

/**
 * Source provenance entry returned by GET /api/config/show?verbose=true.
 *
 * Describes where a config file was resolved from and whether it was found.
 */
export interface ConfigSourceInfo {
  /** Absolute path to the config file, or null when not resolved. */
  path: string | null;
  /** Whether the config file was found at the resolved path. */
  found: boolean;
}

/**
 * Typed response for GET /api/config/show?verbose=true.
 *
 * The `resolved` field is opaque — it contains the full merged config object
 * whose shape is engine-internal. The `sources` field exposes per-source
 * provenance metadata useful for UI (e.g., offering to update a specific file).
 */
export interface ConfigShowVerboseResponse {
  /** Merged resolved config. Opaque; engine-internal shape. */
  resolved?: Record<string, unknown>;
  /** Per-source provenance info keyed by config scope. */
  sources?: {
    local?: ConfigSourceInfo;
    project?: ConfigSourceInfo;
    user?: ConfigSourceInfo;
  };
}

// GET /api/config/validate
export interface ConfigValidateResponse {
  configFound: boolean;
  valid: boolean;
  errors?: string[];
  config?: unknown;
}

export type ExtensionScope = 'user' | 'project-team' | 'project-local' | 'external';
export type ExtensionSource = 'auto' | 'explicit';

/**
 * Serializable summary of the declarative portion of a reviewer perspective's applicability
 * rules. Function-form applicability (`fn`) is not exposed; its presence is indicated by
 * `hasFn: true`.
 */
export interface ReviewerPerspectiveApplicabilitySummary {
  fileGlobs?: string[];
  paths?: string[];
  extensions?: string[];
  categories?: Array<'code' | 'api' | 'docs' | 'config' | 'deps' | 'test'>;
  minChangedFiles?: number;
  minChangedLines?: number;
  /** True when the extension registered a custom applicability function (body not exposed). */
  hasFn?: boolean;
}

/**
 * Safe metadata about a registered reviewer perspective.
 *
 * Includes key, label, description, extension provenance, and the serializable
 * portion of the applicability rules. The `promptFragment` field is intentionally
 * omitted to keep management surfaces concise; the function form of applicability
 * is indicated by `applicability.hasFn`.
 */
export interface ReviewerPerspectiveDetail {
  key: string;
  label: string;
  description: string;
  extensionName: string;
  extensionPath: string;
  applicability?: ReviewerPerspectiveApplicabilitySummary;
}

/**
 * Safe metadata about a registered validation provider.
 *
 * Includes name, description, kind, optional commandCount, and extension provenance.
 * Raw command strings are intentionally omitted; only the count is exposed.
 */
export interface ValidationProviderDetail {
  name: string;
  description: string;
  /** 'function' when registered with `validate`, 'commands' when registered with `commands`. */
  kind: 'function' | 'commands';
  /** Number of commands in the commands array (only present when kind is 'commands'). */
  commandCount?: number;
  extensionName: string;
  extensionPath: string;
}

export type ExtensionStatus = 'pending' | 'loaded' | 'shadowed' | 'skipped' | 'error' | 'excluded';
export type ExtensionDiagnosticSeverity = 'warning' | 'error';
export type ExtensionFormat = 'js' | 'mjs' | 'ts' | 'mts';
export type ExtensionLayout = 'file' | 'directory';
export type ExtensionTrust = 'trusted' | 'untrusted';
export type ExtensionTrustState = 'not-required' | 'untrusted' | 'trusted' | 'changed';
export type ExtensionScaffoldScope = 'local' | 'project' | 'user';
export type ExtensionScaffoldTemplate = 'event-logger' | 'blank';

export interface ExtensionDiagnostic {
  severity: ExtensionDiagnosticSeverity;
  code: string;
  message: string;
  name?: string;
  path?: string;
  scope?: ExtensionScope;
  source?: ExtensionSource;
  currentHash?: string;
  trustedHash?: string;
}

export interface ExtensionShadow {
  name: string;
  path: string;
  entrypoint?: string;
  scope: Exclude<ExtensionScope, 'external'>;
  format?: ExtensionFormat;
  layout?: ExtensionLayout;
}

export interface ExtensionRegistrationSummary {
  eventHooks: number; agentRunHooks: number; policyGates: number; profileRouters: number; inputSources: number; reviewerPerspectives: number; validationProviders: number; tools: number; prdEnrichers: number;
  actions: number; consoleContributions: number; consoleWorkstations: number; integrationCommands: number; deepLinks: number;
}

export type ExtensionActionDetail = ExtensionActionManifestEntry; export type ConsoleContributionDetail = ConsoleContributionManifestEntry; export type ConsoleWorkstationDetail = ConsoleWorkstationManifestEntry; export type IntegrationCommandDetail = IntegrationCommandManifestEntry; export type ExtensionDeepLinkDetail = ExtensionDeepLinkManifestEntry;

export interface ExtensionEntry {
  name: string;
  path: string;
  entrypoint?: string;
  scope: ExtensionScope;
  source: ExtensionSource;
  status: ExtensionStatus;
  enabled?: boolean;
  trust?: ExtensionTrust;
  /** Richer trust classification for project/team trust enforcement. */
  trustState?: ExtensionTrustState;
  /** SHA-256 hash of the extension content computed at discovery time (project-team candidates only). */
  currentHash?: string;
  /** SHA-256 hash stored in the trust record at the time the extension was trusted. */
  trustedHash?: string;
  /** ISO-8601 timestamp from the local trust record, when present. */
  trustedAt?: string;
  /** Optional annotation from the local trust record identifying who trusted the extension. */
  trustedBy?: string;
  /** Absolute local path to the trust store consulted by the engine, when exposed by engine projections. */
  trustStorePath?: string;
  format?: ExtensionFormat;
  layout?: ExtensionLayout;
  strategy?: string;
  shadows: ExtensionShadow[];
  registrations: ExtensionRegistrationSummary;
  diagnostics: ExtensionDiagnostic[];
  /** Metadata for each reviewer perspective registered by this extension. Absent when the extension has no registered perspectives. */
  reviewerPerspectiveDetails?: ReviewerPerspectiveDetail[];
  /** Metadata for each validation provider registered by this extension. Absent when the extension has no registered providers. */
  validationProviderDetails?: ValidationProviderDetail[];
  actionDetails?: ExtensionActionDetail[]; consoleContributionDetails?: ConsoleContributionDetail[]; consoleWorkstationDetails?: ConsoleWorkstationDetail[]; integrationCommandDetails?: IntegrationCommandDetail[]; deepLinkDetails?: ExtensionDeepLinkDetail[];
  /** Package provenance, populated for directory-layout extensions with a `package.json`. */
  package?: ExtensionPackageProvenance;
  /** Install provenance, populated when a `.eforge-install.json` sidecar exists. */
  install?: ExtensionInstallProvenance;
}

export interface ExtensionListResponse {
  extensions: ExtensionEntry[];
  diagnostics: ExtensionDiagnostic[];
  totals: ExtensionRegistrationSummary;
}

export interface ExtensionShowResponse {
  extension: ExtensionEntry;
}

export interface ExtensionValidateResponse {
  valid: boolean;
  extensions: ExtensionEntry[];
  diagnostics: ExtensionDiagnostic[];
}

export interface ExtensionTestRequest {
  name?: string;
  path?: string;
  fixture?: string;
  run?: 'latest' | string;
  event?: string;
}

export interface ExtensionTestSource {
  kind: 'none' | 'fixture' | 'run';
  fixture?: string;
  run?: string;
  sessionId?: string;
  event?: string;
}

export interface ExtensionTestReplayCounts {
  inputEventCount: number;
  filteredEventCount: number;
  emittedEventCount: number;
  diagnosticEventCount: number;
}

export interface ExtensionTestMatch {
  eventIndex: number;
  eventType: string;
  extensionName: string;
  extensionPath: string;
  pattern: string;
}

export type ExtensionTestDiagnosticEvent = Extract<
  EforgeEvent,
  { type: 'extension:event-handler:failed' | 'extension:event-handler:timeout' }
>;

export type ExtensionTestDeferredRegistrationFamily =
  | 'agentRunHooks' | 'policyGates' | 'profileRouters' | 'inputSources' | 'reviewerPerspectives' | 'validationProviders' | 'tools' | 'prdEnrichers'
  | 'actions' | 'consoleContributions' | 'consoleWorkstations' | 'integrationCommands' | 'deepLinks';

export interface ExtensionTestDeferredRegistrationSummary {
  family: ExtensionTestDeferredRegistrationFamily;
  count: number;
  extensions: Array<{ name: string; path: string; count: number }>;
}

export interface ExtensionTestResponse {
  valid: boolean;
  source: ExtensionTestSource;
  extensions: ExtensionEntry[];
  diagnostics: ExtensionDiagnostic[];
  replay: ExtensionTestReplayCounts;
  matches: ExtensionTestMatch[];
  emittedDiagnostics: ExtensionTestDiagnosticEvent[];
  deferredRegistrations: ExtensionTestDeferredRegistrationSummary[];
}

/**
 * Package provenance wire type — included in `ExtensionEntry` for directory-layout
 * extensions that have a `package.json`.
 */
export interface ExtensionPackageProvenance {
  /** npm package name. */
  packageName?: string;
  /** npm package version. */
  version?: string;
  /** npm package description. */
  description?: string;
  /** Logical extension name from `eforge.extension.name`, when present. */
  eforgeExtensionName?: string;
  /** Relative entrypoint from `eforge.extension.entrypoint`, when present. */
  eforgeEntrypoint?: string;
  /** Repository URL. */
  repository?: string;
  /** Homepage URL. */
  homepage?: string;
}

/**
 * Install provenance wire type — included in `ExtensionEntry` when a
 * `.eforge-install.json` sidecar exists alongside the extension directory.
 */
export interface ExtensionInstallProvenance {
  /** Source kind: npm, git, path, or url. */
  sourceKind: string;
  /** Source specifier as provided at install time. */
  sourceSpec: string;
  /** Resolved version from the package at install time, if available. */
  resolvedVersion?: string;
  /** Integrity hash, if recorded. */
  integrity?: { algorithm: string; value: string };
  /** ISO-8601 timestamp of when the package was installed. */
  installedAt: string;
  /** Scope into which the package was installed. */
  targetScope: string;
}

/** POST /api/extensions/install — install an extension package from a registry or path. */
export interface ExtensionInstallRequest {
  /** Package specifier: npm package name, local directory path, local tarball path, or npm-supported tarball/file specifier. Git URLs are rejected until git install support ships. */
  source: string;
  /** Target scope for the install. Defaults to 'local'. */
  scope?: 'local' | 'project' | 'user';
  /** Logical extension name override. Uses the package name or directory basename when absent. */
  name?: string;
  /** Overwrite an existing extension at the target scope. */
  force?: boolean;
  /** Trust the extension after install (project-team scope only). */
  trust?: boolean;
  /** Annotation identifying who is trusting the extension (only used when trust is true). */
  trustedBy?: string;
}

/** Response for POST /api/extensions/install. */
export interface ExtensionInstallResponse {
  /** The installed extension entry. */
  extension: ExtensionEntry;
  /** Human-readable message with next steps. */
  message: string;
}

/** POST /api/extensions/update — update an installed extension package. */
export interface ExtensionUpdateRequest {
  /** Extension name to update. Mutually exclusive with path. */
  name?: string;
  /** Extension path to update. Mutually exclusive with name. */
  path?: string;
  /** Version specifier or channel to update to (e.g., `latest`, `^2.0.0`). Defaults to latest. */
  version?: string;
  /** Trust the updated extension after install (project-team scope only). */
  trust?: boolean;
  /** Annotation identifying who is trusting the extension (only used when trust is true). */
  trustedBy?: string;
}

/** Response for POST /api/extensions/update. */
export interface ExtensionUpdateResponse {
  /** The updated extension entry. */
  extension: ExtensionEntry;
  /** Previous version before the update, if known. */
  previousVersion?: string;
  /** Human-readable message with next steps. */
  message: string;
}

/** POST /api/extensions/remove — remove an installed extension package. */
export interface ExtensionRemoveRequest {
  /** Extension name to remove. Mutually exclusive with path. */
  name?: string;
  /** Extension path to remove. Mutually exclusive with name. */
  path?: string;
  /** Remove without prompting (for programmatic callers). */
  force?: boolean;
}

/** Response for POST /api/extensions/remove. */
export interface ExtensionRemoveResponse {
  /** Human-readable message describing what was removed. */
  message: string;
}

/** POST /api/extensions/promote — promote a project-local extension to project-team scope. */
export interface ExtensionPromoteRequest {
  /** Extension name to promote. Mutually exclusive with path. */
  name?: string;
  /** Extension path to promote. Mutually exclusive with name. */
  path?: string;
  /** Overwrite an existing extension at the project-team scope. */
  force?: boolean;
  /** Trust the promoted extension after promotion. */
  trust?: boolean;
  /** Annotation identifying who is trusting the extension (only used when trust is true). */
  trustedBy?: string;
}

/** Response for POST /api/extensions/promote. */
export interface ExtensionPromoteResponse {
  /** The promoted extension entry at its new scope. */
  extension: ExtensionEntry;
  /** Human-readable message with next steps. */
  message: string;
}

/** POST /api/extensions/demote — demote a project-team extension to project-local scope. */
export interface ExtensionDemoteRequest {
  /** Extension name to demote. Mutually exclusive with path. */
  name?: string;
  /** Extension path to demote. Mutually exclusive with name. */
  path?: string;
  /** Overwrite an existing extension at the project-local scope. */
  force?: boolean;
}

/** Response for POST /api/extensions/demote. */
export interface ExtensionDemoteResponse {
  /** The demoted extension entry at its new scope. */
  extension: ExtensionEntry;
  /** Human-readable message with next steps. */
  message: string;
}

/** POST /api/extensions/trust — trust a project-team extension by name or path. */
export interface ExtensionTrustRequest {
  /** Extension name (targets a project-team candidate by name). Mutually exclusive with path. */
  name?: string;
  /** Extension file/directory path (must resolve to a project-team candidate). Mutually exclusive with name. */
  path?: string;
  /** Optional annotation identifying who is trusting the extension. */
  trustedBy?: string;
}

/** POST /api/extensions/untrust — remove trust for a project-team extension by name or path. */
export interface ExtensionUntrustRequest {
  /** Extension name (targets a project-team candidate by name). Mutually exclusive with path. */
  name?: string;
  /** Extension file/directory path (must resolve to a project-team candidate). Mutually exclusive with name. */
  path?: string;
}

/** Response for POST /api/extensions/trust and POST /api/extensions/untrust. */
export interface ExtensionTrustResponse {
  /** The updated extension candidate entry reflecting the new trust state. */
  extension: ExtensionEntry;
  /** Human-readable message with next steps. */
  message: string;
}

/** Alias for trust/untrust response — same shape. */
export type ExtensionUntrustResponse = ExtensionTrustResponse;

export interface ExtensionNewRequest {
  name: string;
  scope?: ExtensionScaffoldScope;
  template?: ExtensionScaffoldTemplate;
  force?: boolean;
}

export interface ExtensionNewResponse {
  name: string;
  template: ExtensionScaffoldTemplate;
  requestScope: ExtensionScaffoldScope;
  scope: Exclude<ExtensionScope, 'external'>;
  configDir: string;
  scopeDir: string;
  extensionsDir: string;
  path: string;
  created: true;
  overwritten: boolean;
  message: string;
}

export interface ExtensionReloadWatcherMetadata {
  wasRunning: boolean;
  restarted: boolean;
  running: boolean;
  previousSessionId: string | null;
  sessionId: string | null;
  message: string;
}

export interface ExtensionReloadResponse extends ExtensionListResponse, ExtensionReloadWatcherMetadata {
  watcher: ExtensionReloadWatcherMetadata;
}

// GET /api/queue (array of these)
export interface QueueItem {
  id: string;
  title: string;
  status: string;
  priority?: number;
  created?: string;
  dependsOn?: string[];
  /**
   * Recovery verdict for failed items. Populated by the daemon when a
   * `<prdId>.recovery.json` sidecar exists in the `failed/` directory.
   * Absent when no sidecar is present or the sidecar is malformed.
   */
  recoveryVerdict?: {
    verdict: 'retry' | 'split' | 'abandon' | 'manual';
    confidence: 'low' | 'medium' | 'high';
  };
  /** Durable applied-recovery marker; set when the failed item's sidecar carries a valid `applied` object. */
  recoveryApplied?: RecoveryAppliedMetadata;
}

// GET /api/session-metadata (values in Record<string, SessionMetadata>)
export interface SessionMetadata {
  planCount: number | null;
  baseProfile: string | null;
}

// GET /api/runs (array of these)
export interface RunInfo {
  id: string;
  sessionId?: string;
  planSet: string;
  command: string;
  status: string;
  startedAt: string;
  completedAt?: string;
  cwd: string;
  pid?: number;
}

/**
 * Token + dollar spend aggregated for a single local calendar day, derived from
 * `agent:usage` (tokens) and `agent:result` (cost) events. `input` follows the
 * canonical convention `input = uncachedInput + cacheRead + cacheCreation`, so
 * cache hit rate is `cacheRead / tokensIn`.
 */
export interface DailySpend {
  /** Local calendar day, `YYYY-MM-DD`. */
  date: string;
  tokensIn: number;
  tokensOut: number;
  tokensTotal: number;
  cacheRead: number;
  cacheCreation: number;
  costUsd: number;
}

/**
 * Token + dollar spend aggregated for a single model across the whole window,
 * derived from `agent:result.result.modelUsage`. `tokensTotal` follows the same
 * convention as {@link DailySpend} (`inputTokens + outputTokens`, where
 * `inputTokens` already includes cache tokens), so cache hit rate is
 * `cacheReadTokens / inputTokens`.
 */
export interface ModelSpend {
  /** Provider model id, e.g. `claude-opus-4-7`. */
  model: string;
  /**
   * Harness that ran the model (`claude-sdk` or `pi`), or null for historical
   * spend recorded before harness attribution existed. The same model id run
   * under different harnesses/providers is reported as separate rows.
   */
  harness: 'claude-sdk' | 'pi' | null;
  /** Provider routing the model (e.g. `anthropic`, `openrouter`), or null. */
  provider: string | null;
  inputTokens: number;
  outputTokens: number;
  tokensTotal: number;
  cacheReadTokens: number;
  costUsd: number;
}

/** Response body for GET /api/spend?days=N. Days are ordered oldest -> newest. */
export interface SpendSummary {
  /** Size of the lookback window in days (1-90). */
  windowDays: number;
  days: DailySpend[];
  /** Per-model spend over the whole window, ordered by cost descending. */
  models: ModelSpend[];
  /** Per-model spend for today only, ordered by cost descending. */
  modelsToday: ModelSpend[];
}

// Types used within orchestration and plan endpoints.
// Single owner: these types cross the daemon HTTP boundary and are re-exported
// by @eforge-build/engine for engine-internal use. Do not duplicate elsewhere.
export type BuildStageSpec = string | string[];

export interface ReviewProfileConfig {
  strategy: 'auto' | 'single' | 'parallel';
  /** Review perspective keys. Built-ins: code, security, api, docs, test, verify.
   * Custom extension keys are also accepted (lowercase slugs). */
  perspectives: string[];
  maxRounds: number;
  evaluatorStrictness: 'strict' | 'standard' | 'lenient';
}

// GET /api/run-summary/:id
export interface RunSummary {
  sessionId: string;
  status: 'unknown' | 'running' | 'failed' | 'completed';
  runs: Array<{
    id: string;
    command: string;
    status: string;
    startedAt: string;
    completedAt: string | null;
  }>;
  plans: Array<{
    id: string;
    status: 'pending' | 'running' | 'completed' | 'failed';
    branch: string | null;
    dependsOn: string[];
  }>;
  currentPhase: string | null;
  currentAgent: string | null;
  eventCounts: {
    total: number;
    errors: number;
  };
  duration: {
    startedAt: string | null;
    completedAt: string | null;
    seconds: number | null;
  };
}

// GET /api/run-state/:id
export interface RunState {
  status: 'unknown' | 'running' | 'failed' | 'completed';
  events: Array<{
    id: number;
    runId: string;
    type: string;
    planId?: string;
    agent?: string;
    data: string;
    timestamp: string;
  }>;
}

// GET /api/plans/:id (array of these)
export interface PlanInfo {
  id: string;
  name: string;
  body: string;
  dependsOn: string[];
  type: 'architecture' | 'module' | 'plan';
  build?: BuildStageSpec[];
  review?: ReviewProfileConfig;
}

// Type alias for the plans endpoint response
export type PlansResponse = PlanInfo[];

// GET /api/diff/:sessionId/:planId (bulk)
export interface DiffBulkResponse {
  files: Array<{
    path: string;
    diff: string;
  }>;
}

// GET /api/diff/:sessionId/:planId?file=path (single)
export interface DiffSingleResponse {
  diff: string | null;
}

// Union for the diff endpoint
export type DiffResponse = DiffBulkResponse | DiffSingleResponse;

// POST /api/enqueue
export interface EnqueueResponse {
  sessionId: string;
  pid: number;
  autoBuild: boolean;
}

// POST /api/cancel/:id
export interface CancelResponse {
  status: 'cancelled';
  sessionId: string;
}

// POST /api/daemon/stop
export interface StopDaemonResponse {
  status: 'stopping';
  force: boolean;
}

// POST /api/keep-alive
export interface KeepAliveResponse {
  status: 'ok';
}

// ---------------------------------------------------------------------------
// Agent runtime profile management (renamed from backend in DAEMON_API_VERSION 10)
// ---------------------------------------------------------------------------

/** Optional descriptive metadata carried by agent runtime profile files. */
export interface ProfileMetadata {
  description?: string;
  whenToUse?: string[];
  tags?: string[];
}

/** A single agent runtime profile entry returned by the list endpoint. */
export interface AgentRuntimeProfileInfo {
  name: string;
  harness: 'claude-sdk' | 'pi' | undefined;
  path: string;
  scope: 'local' | 'project' | 'user';
  shadowedBy?: 'local' | 'project';
  metadata?: ProfileMetadata;
}

/** Source of the active agent runtime profile resolution. */
export type AgentRuntimeProfileSource = 'local' | 'project' | 'user-local' | 'missing' | 'none';

// GET /api/profile/list
export interface ProfileListResponse {
  profiles: AgentRuntimeProfileInfo[];
  active: string | null;
  source: AgentRuntimeProfileSource;
}

// GET /api/profile/show
export interface ProfileShowResponse {
  active: string | null;
  source: AgentRuntimeProfileSource;
  resolved: {
    harness: 'claude-sdk' | 'pi' | undefined;
    /** The parsed profile partial config. Opaque to the client. */
    profile: unknown | null;
    scope?: 'local' | 'project' | 'user';
    metadata?: ProfileMetadata;
  };
}

/** Optional scope filter for the list endpoint. */
export interface ProfileListRequest {
  scope?: 'local' | 'project' | 'user' | 'all';
}

// POST /api/profile/use
export interface ProfileUseRequest {
  name: string;
  scope?: 'local' | 'project' | 'user';
}

export interface ProfileUseResponse {
  active: string;
}

// POST /api/profile/create
export interface ProfileCreateRequest {
  name: string;
  /**
   * Agents config block — opaque to the client. Should carry tier recipes
   * under `agents.tiers` (each with self-contained harness + model + effort).
   */
  agents?: unknown;
  metadata?: ProfileMetadata;
  overwrite?: boolean;
  scope?: 'local' | 'project' | 'user';
}

export interface ProfileCreateResponse {
  path: string;
}

// DELETE /api/profile/:name
export interface ProfileDeleteRequest {
  force?: boolean;
  scope?: 'local' | 'project' | 'user';
}

export interface ProfileDeleteResponse {
  deleted: string;
}

// ---------------------------------------------------------------------------
// Model listing (DAEMON_API_VERSION 10)
// ---------------------------------------------------------------------------

// GET /api/models/providers?harness=pi|claude-sdk
export interface ModelProvidersResponse {
  providers: string[];
}

/** A single model entry returned by the model-listing endpoints. */
export interface ModelInfo {
  id: string;
  provider?: string;
  contextWindow?: number;
  releasedAt?: string;
  deprecated?: boolean;
}

// GET /api/models/list?harness=pi|claude-sdk&provider=<optional>
export interface ModelListResponse {
  models: ModelInfo[];
}

// Stack layer wire shapes — canonical source of truth for API responses.
export type {
  StackProvider,
  StackProviderOperationKind,
  StackProviderConflictKind,
  LandingPublicationAction,
  StackLayerStatus,
  StackArtifactRef,
  StackLayerWire,
} from './events.js';
