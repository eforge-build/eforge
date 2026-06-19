import type { EforgeProjectPaths } from '@eforge-build/extension-sdk/project-paths';
import type {
  ExtensionCapabilityDeclaration,
  ExtensionCapabilityLookup,
  ExtensionCapabilityRequirement,
  ExtensionContributionAvailability,
  ExtensionContributionRequirements,
  ExtensionDependencyAvailability,
  ExtensionDependencyDeclaration,
  ExtensionDependencyLookup,
  ExtensionDependencyManifest,
} from '@eforge-build/extension-sdk';
import type { Scope } from '@eforge-build/scopes';
import type {
  ExtensionActionOutputProfile as ClientExtensionActionOutputProfile,
  ExtensionActionRequestedBy,
  ExtensionActionSideEffect,
  ExtensionAgentTaskCancelResponse,
  ExtensionAgentTaskGetResponse,
  ExtensionAgentTaskStartRequest,
  ExtensionAgentTaskStartResponse,
  ExtensionJsonValue,
  EnqueueRequest,
  EnqueueResponse,
} from '@eforge-build/client';

/**
 * Package provenance attached to directory-layout extensions that have a `package.json`.
 * Fields mirror npm package metadata and the optional `eforge.extension` block.
 */
export type NativeExtensionCapabilityDeclaration = ExtensionCapabilityDeclaration;
export type NativeExtensionCapabilityRequirement = ExtensionCapabilityRequirement;
export type NativeExtensionDependencyDeclaration = ExtensionDependencyDeclaration;
export type NativeExtensionDependencyManifest = ExtensionDependencyManifest;
export type NativeExtensionContributionRequirements = ExtensionContributionRequirements;
export type NativeExtensionContributionAvailability = ExtensionContributionAvailability;
export type NativeExtensionDependencyAvailability = ExtensionDependencyAvailability;

export interface NativeExtensionResolvedDependency extends Omit<ExtensionDependencyAvailability, 'diagnostics'> {
  kind: 'required' | 'optional';
  requiredVersion?: string;
  providerPath?: string;
  diagnostics: NativeExtensionDiagnostic[];
}

export interface NativeExtensionResolvedDependencyState {
  available: boolean;
  required: NativeExtensionResolvedDependency[];
  optional: NativeExtensionResolvedDependency[];
  diagnostics: NativeExtensionDiagnostic[];
}

export interface NativeExtensionPackageProvenance {
  /** npm package name from `package.json#name`. */
  packageName?: string;
  /** npm package version from `package.json#version`. */
  version?: string;
  /** npm package description from `package.json#description`. */
  description?: string;
  /** Logical extension name from `package.json#eforge.extension.name`, when present. */
  eforgeExtensionName?: string;
  /** Relative entrypoint from `package.json#eforge.extension.entrypoint`, when present. */
  eforgeEntrypoint?: string;
  /** Repository URL from `package.json#repository`. */
  repository?: string;
  /** Homepage URL from `package.json#homepage`. */
  homepage?: string;
  /** Public capabilities declared in `package.json#eforge.extension.capabilities`. */
  capabilities?: NativeExtensionCapabilityDeclaration[];
  /** Dependencies declared in `package.json#eforge.extension.dependencies`. */
  dependencies?: NativeExtensionDependencyManifest;
}

/**
 * Install provenance attached when a `.eforge-install.json` sidecar exists
 * alongside the extension package directory.
 */
export interface NativeExtensionInstallProvenance {
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

export type EventPattern = string;
export type ExtensionHandler = (...args: never[]) => unknown;
export interface ProfileRouterSpec { name: string; selectBuildProfile?: ExtensionHandler; resolve?: ExtensionHandler }
export interface InputSourceAdapter { name: string; description: string; fetch: ExtensionHandler }
export interface ReviewerPerspectiveApplicability {
  fileGlobs?: string[];
  paths?: string[];
  extensions?: string[];
  categories?: Array<'code' | 'api' | 'docs' | 'config' | 'deps' | 'test'>;
  minChangedFiles?: number;
  minChangedLines?: number;
  fn?: (changedFiles: string[], changedLines: number) => boolean | Promise<boolean>;
}
export interface ReviewerPerspectiveSpec { key: string; label: string; description: string; promptFragment: string; appliesTo?: ReviewerPerspectiveApplicability; }
export interface ValidationProviderSpec { name: string; description: string; validate?: ExtensionHandler; commands?: string[] }
export interface ExtensionTool { name: string; description: string; inputSchema: object; handler: ExtensionHandler }
export interface PrdEnricherSpec { name: string; description: string; enrich: ExtensionHandler }
export type PolicyGateKind = 'queue-dispatch' | 'plan-merge' | 'final-merge';
export type PolicyGateMethod = 'beforeQueueDispatch' | 'beforePlanMerge' | 'beforeFinalMerge';

// --- eforge:region extension-agent-task-context ---
export interface ExtensionAgentTasksApiShape {
  start(request: Omit<ExtensionAgentTaskStartRequest, 'requestedBy'>): Promise<ExtensionAgentTaskStartResponse>;
  get(taskId: string): Promise<ExtensionAgentTaskGetResponse>;
  cancel(taskId: string, reason?: string): Promise<ExtensionAgentTaskCancelResponse>;
}
// --- eforge:endregion extension-agent-task-context ---

// --- eforge:region extension-build-queue-context ---
export interface ExtensionBuildQueueApiShape {
  enqueue(request: EnqueueRequest): Promise<EnqueueResponse>;
}
// --- eforge:endregion extension-build-queue-context ---

export type ExtensionActionOutputProfile = ClientExtensionActionOutputProfile;

export interface ExtensionActionContextShape {
  invocationId: string;
  actionId: string;
  /**
   * Caller-declared display provenance from the HTTP request. This is not an
   * authenticated identity and must not be used for authorization decisions.
   */
  requestedBy: ExtensionActionRequestedBy;
  cwd: string;
  /** Aborted when the daemon action timeout elapses; handlers should stop side effects promptly. */
  signal: AbortSignal;
  logger: { debug(message: string): void; info(message: string): void; warn(message: string): void; error(message: string): void };
  paths: EforgeProjectPaths;
  dependencies: ExtensionDependencyLookup;
  capabilities: ExtensionCapabilityLookup;
  // --- eforge:region extension-agent-task-context ---
  agentTasks: ExtensionAgentTasksApiShape;
  // --- eforge:endregion extension-agent-task-context ---
  // --- eforge:region extension-build-queue-context ---
  buildQueue: ExtensionBuildQueueApiShape;
  // --- eforge:endregion extension-build-queue-context ---
}
export interface ExtensionActionSpec {
  id: string;
  title: string;
  description?: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  outputProfile?: ExtensionActionOutputProfile;
  sideEffects?: ExtensionActionSideEffect[];
  requirements?: NativeExtensionContributionRequirements;
  availability?: NativeExtensionContributionAvailability;
  handler: (input: Record<string, unknown>, ctx: ExtensionActionContextShape) => ExtensionJsonValue | Promise<ExtensionJsonValue> | unknown;
}
export interface ExtensionActionBindingSpec { actionId: string; inputDefaults?: Record<string, unknown> }
export type ConsoleContributionBlockSpec =
  | { rendererId: 'text'; title?: string; content: string }
  | { rendererId: 'markdown'; title?: string; content: string }
  | { rendererId: 'status-badge'; title?: string; content: string; status: string }
  | { rendererId: 'link'; title?: string; content: string; href: string }
  | { rendererId: 'action-button'; title?: string; content: string; action: ExtensionActionBindingSpec }
  | { rendererId: 'action-form'; title?: string; content: string; action: ExtensionActionBindingSpec };
export interface ConsoleContributionSpec { id: string; title: string; description?: string; blocks: ConsoleContributionBlockSpec[]; requirements?: NativeExtensionContributionRequirements; availability?: NativeExtensionContributionAvailability }
export interface ConsoleWorkstationBaseSpec { id: string; title: string; description?: string; allowedActions?: string[]; requirements?: NativeExtensionContributionRequirements; availability?: NativeExtensionContributionAvailability }
export interface ConsoleWorkstationFrameBundleSpec { root: string; entrypoint: string; styles?: string[]; assets?: string[]; browserSdkVersion?: 1 }
export interface ConsoleWorkstationSrcDocSpec extends ConsoleWorkstationBaseSpec { srcDoc: string; frameBundle?: never }
export interface ConsoleWorkstationFrameBundleWorkstationSpec extends ConsoleWorkstationBaseSpec { srcDoc?: never; frameBundle: ConsoleWorkstationFrameBundleSpec }
export type ConsoleWorkstationSpec = ConsoleWorkstationSrcDocSpec | ConsoleWorkstationFrameBundleWorkstationSpec;
export interface IntegrationCommandSpec { id: string; label: string; description?: string; inputSchema?: Record<string, unknown>; requirements?: NativeExtensionContributionRequirements; availability?: NativeExtensionContributionAvailability; action: ExtensionActionBindingSpec }
export interface ExtensionDeepLinkSpec { id: string; label: string; description?: string; urlTemplate?: string; requirements?: NativeExtensionContributionRequirements; availability?: NativeExtensionContributionAvailability; action?: ExtensionActionBindingSpec }

export interface EforgeExtensionAPIShape {
  onEvent(pattern: EventPattern, handler: ExtensionHandler): void;
  onAgentRun(handler: ExtensionHandler): void;
  beforeQueueDispatch(handler: ExtensionHandler): void;
  beforePlanMerge(handler: ExtensionHandler): void;
  beforeFinalMerge(handler: ExtensionHandler): void;
  registerProfileRouter(spec: ProfileRouterSpec): void;
  registerInputSource(adapter: InputSourceAdapter): void;
  registerPrdEnricher(enricher: PrdEnricherSpec): void;
  registerReviewerPerspective(spec: ReviewerPerspectiveSpec): void;
  registerValidationProvider(spec: ValidationProviderSpec): void;
  registerTool(tool: ExtensionTool): void;
  registerAction(action: ExtensionActionSpec): void;
  registerConsoleContribution(contribution: ConsoleContributionSpec): void;
  registerConsoleWorkstation(workstation: ConsoleWorkstationSpec): void;
  registerIntegrationCommand(command: IntegrationCommandSpec): void;
  registerDeepLink(deepLink: ExtensionDeepLinkSpec): void;
}
export type EforgeExtensionFactoryShape = (api: EforgeExtensionAPIShape) => void | Promise<void>;

export type NativeExtensionSource = 'auto' | 'explicit';
export type NativeExtensionScope = Scope | 'external';
export type NativeExtensionTrust = 'trusted' | 'untrusted';
/**
 * Richer trust state for native extensions.
 *
 * - `not-required` — user, project-local, or external path; no project/team trust gate applies.
 * - `untrusted`    — project-team candidate with no matching trust record.
 * - `trusted`      — project-team candidate whose current hash matches the stored trust record.
 * - `changed`      — project-team candidate that was previously trusted but whose content has changed.
 */
export type NativeExtensionTrustState = 'not-required' | 'untrusted' | 'trusted' | 'changed';
export type NativeExtensionStatus = 'pending' | 'shadowed' | 'loaded' | 'skipped' | 'error';
export type NativeExtensionFormat = 'js' | 'mjs' | 'ts' | 'mts';
export type NativeExtensionLayout = 'file' | 'directory';
export type NativeExtensionLoaderStrategy = 'dynamic-import' | 'jiti';
export type NativeExtensionDiagnosticSeverity = 'warning' | 'error';

export interface NativeExtensionDiagnostic {
  severity: NativeExtensionDiagnosticSeverity;
  code: string;
  message: string;
  name?: string;
  path?: string;
  extensionName?: string;
  scope?: NativeExtensionScope;
  source?: NativeExtensionSource;
  /** Current content hash (included in trust-related diagnostics for project-team extensions). */
  currentHash?: string;
  /** Trusted hash from the trust record (included in `extension:trust-changed` diagnostics). */
  trustedHash?: string;
  dependencyName?: string;
  providerName?: string;
  capabilityName?: string;
  requiredVersion?: string;
  actualVersion?: string;
  dependencyKind?: 'required' | 'optional';
}

export interface NativeExtensionShadow {
  name: string;
  path: string;
  entrypoint?: string;
  scope: Scope;
  format?: NativeExtensionFormat;
  layout?: NativeExtensionLayout;
}

export interface NativeExtensionCandidate {
  name: string;
  path: string;
  entrypoint?: string;
  scope: NativeExtensionScope;
  source: NativeExtensionSource;
  format?: NativeExtensionFormat;
  layout?: NativeExtensionLayout;
  /** Backward-compatible coarse trust: `'trusted'` or `'untrusted'`. See `trustState` for richer classification. */
  trust: NativeExtensionTrust;
  /**
   * Richer trust classification set during discovery.
   * - `not-required` for user, project-local, and external candidates.
   * - `untrusted`, `trusted`, or `changed` for project-team candidates.
   */
  trustState?: NativeExtensionTrustState;
  /** SHA-256 hash of the extension content computed at discovery time (project-team candidates only). */
  currentHash?: string;
  /** SHA-256 hash stored in the trust record at the time the extension was trusted (if a record exists). */
  trustedHash?: string;
  /** ISO-8601 timestamp from the trust record (if a record exists). */
  trustedAt?: string;
  /** Optional annotation from the trust record identifying who trusted the extension. */
  trustedBy?: string;
  /** Absolute path to the trust store file that was consulted during discovery. */
  trustStorePath?: string;
  status: NativeExtensionStatus;
  shadows: NativeExtensionShadow[];
  diagnostics: NativeExtensionDiagnostic[];
  /** Package provenance, populated for directory-layout extensions with a `package.json`. */
  packageProvenance?: NativeExtensionPackageProvenance;
  /** Install provenance, populated when a `.eforge-install.json` sidecar exists. */
  installProvenance?: NativeExtensionInstallProvenance;
  /** Public capabilities declared without importing extension code. */
  capabilities?: NativeExtensionCapabilityDeclaration[];
  /** Required and optional dependency declarations parsed without importing extension code. */
  dependencies?: NativeExtensionDependencyManifest;
  /** Dependency availability after graph resolution. */
  resolvedDependencies?: NativeExtensionResolvedDependencyState;
}

export interface NativeExtensionDiscoveryResult {
  candidates: NativeExtensionCandidate[];
  diagnostics: NativeExtensionDiagnostic[];
}

export interface BaseExtensionRegistration<TKind extends string, TValue> {
  kind: TKind;
  extensionName: string;
  extensionPath: string;
  value: TValue;
  requirements?: NativeExtensionContributionRequirements;
  availability?: NativeExtensionContributionAvailability;
}

export type EventHookRegistration = BaseExtensionRegistration<'eventHook', {
  pattern: EventPattern;
  handler: ExtensionHandler;
}>;
export type AgentRunRegistration = BaseExtensionRegistration<'agentRunHook', ExtensionHandler>;
export type PolicyGateRegistration = BaseExtensionRegistration<'policyGate', ExtensionHandler> & {
  gateKind: PolicyGateKind;
  method: PolicyGateMethod;
  registrationIndex: number;
};
export type ProfileRouterRegistration = BaseExtensionRegistration<'profileRouter', ProfileRouterSpec> & { name: string };
export type InputSourceRegistration = BaseExtensionRegistration<'inputSource', InputSourceAdapter> & { name: string };
export type ReviewerPerspectiveRegistration = BaseExtensionRegistration<'reviewerPerspective', ReviewerPerspectiveSpec> & { name: string };
export type ValidationProviderRegistration = BaseExtensionRegistration<'validationProvider', ValidationProviderSpec> & { name: string };
export type ToolRegistration = BaseExtensionRegistration<'tool', ExtensionTool> & { name: string };
export type PrdEnricherRegistration = BaseExtensionRegistration<'prdEnricher', PrdEnricherSpec> & { name: string };

export type ActionRegistration = BaseExtensionRegistration<'action', ExtensionActionSpec> & { localId: string; id: string };
export type ConsoleContributionRegistration = BaseExtensionRegistration<'consoleContribution', ConsoleContributionSpec> & { localId: string; id: string };
export type ConsoleWorkstationRegistration = BaseExtensionRegistration<'consoleWorkstation', ConsoleWorkstationSpec> & { localId: string; id: string };
export type IntegrationCommandRegistration = BaseExtensionRegistration<'integrationCommand', IntegrationCommandSpec> & { localId: string; id: string };
export type DeepLinkRegistration = BaseExtensionRegistration<'deepLink', ExtensionDeepLinkSpec> & { localId: string; id: string };

export interface NativeExtensionRecorderState {
  eventHooks: EventHookRegistration[];
  agentRunHooks: AgentRunRegistration[];
  policyGates: PolicyGateRegistration[];
  profileRouters: ProfileRouterRegistration[];
  inputSources: InputSourceRegistration[];
  reviewerPerspectives: ReviewerPerspectiveRegistration[];
  validationProviders: ValidationProviderRegistration[];
  tools: ToolRegistration[];
  prdEnrichers: PrdEnricherRegistration[];
  actions: ActionRegistration[];
  consoleContributions: ConsoleContributionRegistration[];
  consoleWorkstations: ConsoleWorkstationRegistration[];
  integrationCommands: IntegrationCommandRegistration[];
  deepLinks: DeepLinkRegistration[];
  diagnostics: NativeExtensionDiagnostic[];
}

export interface LoadedNativeExtension {
  name: string;
  path: string;
  entrypoint: string;
  scope: NativeExtensionScope;
  source: NativeExtensionSource;
  strategy: NativeExtensionLoaderStrategy;
  /** Package provenance, populated for directory-layout extensions with a `package.json`. */
  packageProvenance?: NativeExtensionPackageProvenance;
  /** Install provenance, populated when a `.eforge-install.json` sidecar exists. */
  installProvenance?: NativeExtensionInstallProvenance;
  capabilities?: NativeExtensionCapabilityDeclaration[];
  dependencies?: NativeExtensionDependencyManifest;
  resolvedDependencies?: NativeExtensionResolvedDependencyState;
  registrations: {
    eventHooks: number;
    agentRunHooks: number;
    policyGates: number;
    profileRouters: number;
    inputSources: number;
    reviewerPerspectives: number;
    validationProviders: number;
    tools: number;
    prdEnrichers: number;
    actions: number;
    consoleContributions: number;
    consoleWorkstations: number;
    integrationCommands: number;
    deepLinks: number;
  };
}

export interface NativeExtensionRegistry extends NativeExtensionRecorderState {
  extensions: LoadedNativeExtension[];
  candidates: NativeExtensionCandidate[];
}

export interface NativeExtensionLoadResult {
  registry: NativeExtensionRegistry;
  diagnostics: NativeExtensionDiagnostic[];
  candidates: NativeExtensionCandidate[];
}

export interface NativeExtensionLoaderOptions {
  cwd: string;
  configDir: string;
  config: {
    enabled: boolean;
    include?: string[];
    exclude?: string[];
    paths?: string[];
  };
}
