export { hashExtensionDirectory, hashExtensionFile } from './hash.js';
export {
  getTrustRecord,
  getTrustStorePath,
  readTrustStore,
  removeTrustRecord,
  upsertTrustRecord,
  writeTrustStore,
  TRUST_STORE_FILENAME,
} from './trust-store.js';
export type { ExtensionTrustRecord, ExtensionTrustStore } from './trust-store.js';
export { parsePackageManifest } from './package-manifest.js';
export type {
  EforgeExtensionManifest,
  ExtensionPackageMetadata,
  PackageManifestError,
  PackageManifestErrorCode,
  PackageManifestParseResult,
} from './package-manifest.js';
export {
  INSTALL_SIDECAR_FILENAME,
  readInstallSidecar,
  writeInstallSidecar,
} from './install-metadata.js';
export type {
  InstallIntegrity,
  InstallSidecarData,
  InstallSourceKind,
  InstallTargetScope,
  ReadInstallSidecarResult,
} from './install-metadata.js';
export type {
  NativeExtensionCandidate,
  NativeExtensionDiagnostic,
  NativeExtensionDiscoveryResult,
  NativeExtensionFormat,
  NativeExtensionInstallProvenance,
  NativeExtensionLayout,
  NativeExtensionLoaderOptions,
  NativeExtensionLoaderStrategy,
  NativeExtensionLoadResult,
  NativeExtensionPackageProvenance,
  NativeExtensionRegistry,
  NativeExtensionCapabilityDeclaration,
  NativeExtensionCapabilityRequirement,
  NativeExtensionDependencyDeclaration,
  NativeExtensionDependencyManifest,
  NativeExtensionContributionAvailability,
  NativeExtensionContributionRequirements,
  NativeExtensionDependencyAvailability,
  NativeExtensionResolvedDependency,
  NativeExtensionResolvedDependencyState,
  NativeExtensionScope,
  NativeExtensionShadow,
  NativeExtensionSource,
  NativeExtensionStatus,
  NativeExtensionTrust,
  NativeExtensionTrustState,
  LoadedNativeExtension,
  EventHookRegistration,
  AgentRunRegistration,
  PolicyGateKind,
  PolicyGateMethod,
  PolicyGateRegistration,
  ProfileRouterRegistration,
  InputSourceRegistration,
  ReviewerPerspectiveRegistration,
  ReviewerPerspectiveApplicability,
  ValidationProviderRegistration,
  ToolRegistration,
  PrdEnricherRegistration,
  ActionRegistration,
  AgentTaskRegistration,
  AgentTaskRegistrationSpec,
  AgentTaskPromptSourceSpec,
  ConsoleContributionRegistration,
  ConsoleWorkstationRegistration,
  IntegrationCommandRegistration,
  DeepLinkRegistration,
  ExtensionActionOutputProfile,
  ExtensionActionSpec,
  ConsoleContributionSpec,
  ConsoleWorkstationBaseSpec,
  ConsoleWorkstationFrameBundleSpec,
  ConsoleWorkstationSrcDocSpec,
  ConsoleWorkstationFrameBundleWorkstationSpec,
  ConsoleWorkstationSpec,
  IntegrationCommandSpec,
  ExtensionDeepLinkSpec,
} from './types.js';
export { discoverNativeExtensions } from './discovery.js';
export { createExtensionRecorder, mergeRecorderState } from './recorder.js';
export { loadNativeExtensions } from './loader.js';
export {
  applyContributionAvailability,
  buildExtensionLookupContext,
  finalizeCandidateDependencyAvailability,
  finalizeRegistryDependencyAvailability,
  isContributionAvailable,
  isValidVersionConstraintSyntax,
  resolveExtensionDependencyGraph,
  versionSatisfies,
} from './dependency-resolution.js';
export {
  DEFAULT_EVENT_HOOK_DRAIN_GRACE_MS,
  DEFAULT_EVENT_HOOK_EXEC_OUTPUT_LIMIT_BYTES,
  DEFAULT_NATIVE_EVENT_HOOK_TIMEOUT_MS,
  withNativeEventHooks,
} from './event-runtime.js';
export type {
  EventHookContext,
  EventHookExecOptions,
  EventHookExecResult,
  NativeEventHookRuntimeOptions,
} from './event-runtime.js';
export {
  withAgentContextHooks,
  executeAgentRunHooks,
} from './agent-context-runtime.js';
export type {
  AgentContextHookRuntimeOptions,
  AgentRunHooksExecutionResult,
} from './agent-context-runtime.js';
export {
  executeProfileRouters,
  buildProfileRouterContext,
} from './profile-router-runtime.js';
export type {
  RouterSelection,
  ProfileRouterExecutionResult,
  ExecuteProfileRoutersOptions,
  BuildProfileRouterContextDeps,
} from './profile-router-runtime.js';
export {
  buildFinalMergePolicyGateContext,
  buildPlanMergePolicyGateContext,
  buildPolicyGateContext,
  buildQueueDispatchPolicyGateContext,
  executePolicyGate,
  validatePolicyDecision,
} from './policy-gate-runtime.js';
export type {
  AnyPolicyGateContext,
  ExecutePolicyGateOptions,
  FinalMergePolicyGateContext,
  FinalMergePolicyGateTarget,
  PlanMergePolicyGateContext,
  PlanMergePolicyGateTarget,
  PolicyGateContextHelpersOptions,
  PolicyGateDecisionKind,
  PolicyGateExecutionResult,
  PolicyGateFailurePolicy,
  PolicyGateTarget,
  QueueDispatchContinueRepairMetadata,
  QueueDispatchPolicyGateContext,
  QueueDispatchPolicyGateTarget,
} from './policy-gate-runtime.js';
export type { NativeExtensionRegistryProjection } from './projector.js';
export { projectExtensionRegistry } from './projector.js';
export { EXTENSION_LOCAL_CONTRIBUTION_ID_RE, isValidExtensionLocalContributionId, resolveExtensionContributionId } from './ids.js';
export {
  WORKSTATION_ASSETS_DIR,
  normalizeWorkstationBundleRoot,
  normalizeWorkstationBundleAssetPath,
} from './workstation-bundle-paths.js';
export {
  ConsoleWorkstationAssetCatalogError,
  buildConsoleWorkstationAssetCatalog,
  buildConsoleWorkstationFrameBundleManifest,
  findConsoleWorkstationBundleAsset,
} from './workstation-assets.js';
export type {
  ConsoleWorkstationAssetCatalog,
  ConsoleWorkstationAssetCatalogErrorCode,
  ConsoleWorkstationBundleAssetLookupResult,
  ConsoleWorkstationCatalogAsset,
} from './workstation-assets.js';
export {
  buildExtensionContributionManifest,
  buildActionDetails,
  buildAgentTaskDetails,
  buildConsoleContributionDetails,
  buildConsoleWorkstationDetails,
  buildIntegrationCommandDetails,
  buildDeepLinkDetails,
} from './manifest.js';
export { dispatchExtensionAction } from './action-runtime.js';
export type { DispatchExtensionActionOptions, DispatchExtensionActionResult } from './action-runtime.js';
export {
  parseExtensionEventFixtureFile,
  replayNativeExtensionEvents,
  testNativeExtensions,
} from './replay.js';
export type {
  ExtensionEventFixtureParseResult,
  ExtensionFixtureFormat,
  NativeExtensionDeferredRegistrationFamily,
  NativeExtensionDeferredRegistrationSummary,
  NativeExtensionReplayCounts,
  NativeExtensionReplayMatch,
  NativeExtensionReplayOptions,
  NativeExtensionReplayResult,
  NativeExtensionReplaySource,
} from './replay.js';
export {
  SUPPORTED_EXTENSION_SCAFFOLD_TEMPLATES,
  ScaffoldNativeExtensionError,
  scaffoldNativeExtension,
} from './scaffold.js';
export type {
  ExtensionScaffoldErrorCode,
  ExtensionScaffoldRequestScope,
  ExtensionScaffoldTemplate,
  ScaffoldNativeExtensionOptions,
  ScaffoldNativeExtensionResult,
} from './scaffold.js';
export {
  evaluateApplicability,
  selectExtensionPerspectives,
  buildExtensionPerspectivePromptSection,
  DEFAULT_APPLICABILITY_TIMEOUT_MS,
} from './reviewer-perspective-runtime.js';
export type {
  ApplicabilityInput,
  ApplicabilityOutcome,
  SelectExtensionPerspectivesOptions,
  SelectExtensionPerspectivesResult,
} from './reviewer-perspective-runtime.js';

export {
  runValidationProvider,
  normalizeValidationResult,
} from './validation-provider-runtime.js';
export type {
  NormalizedValidationAnnotation,
  NormalizedValidationFailureKind,
  NormalizedValidationResult,
  ValidationProviderRuntimeContext,
  RunValidationProviderOptions,
  RunValidationProviderResult,
} from './validation-provider-runtime.js';
