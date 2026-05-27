/**
 * Stacking module — exports for use by later plans.
 *
 * Exports engine-owned stack domain types, state management utilities,
 * provider interface and factory, and the git-spice adapter.
 */

export type {
  StackProvider,
  LandingPublicationAction,
  StackLayerStatus,
  StackLandingStatus,
  StackArtifactRef,
  StackLayerLanding,
  StackLayer,
  StackState,
} from './types.js';

export {
  stackLayerSchema,
  stackStateSchema,
  stackStatePath,
  loadStackState,
  saveStackState,
  upsertStackLayer,
  lookupLayerByPrdId,
  getParentArtifactBranch,
  getRecordedArtifactRef,
  isArtifactAvailable,
  updateStackLayerLanding,
  markStackLayerFailed,
  // --- eforge:region plan-03-stack-landing-lifecycle-cleanup ---
  updateStackLayerStatusAndLanding,
  // --- eforge:endregion plan-03-stack-landing-lifecycle-cleanup ---
} from './state.js';

// --- eforge:region plan-02-artifact-aware-queue-base-resolution ---
export type { StackBaseContext } from './base-resolver.js';
export { resolveStackBaseContext } from './base-resolver.js';
export { recordSuccessfulBuildArtifact } from './artifacts.js';
// --- eforge:endregion plan-02-artifact-aware-queue-base-resolution ---

// --- eforge:region plan-02-git-spice-provider-and-git-primitives ---
export type { StackProviderAdapter, ProviderCommandResult } from './provider.js';
export { createProvider } from './provider.js';
export {
  GitSpiceAdapter,
  GitSpiceNotAvailableError,
  GitSpiceCommandError,
  createGitSpiceAdapter,
  parseGitSpicePrUrl,
} from './git-spice.js';
// --- eforge:endregion plan-02-git-spice-provider-and-git-primitives ---

// --- eforge:region plan-02-stack-provider-runtime ---
export { executeStackLanding } from './landing.js';
export type { StackLandingOptions } from './landing.js';
// --- eforge:endregion plan-02-stack-provider-runtime ---

// --- eforge:region plan-01-stack-sync-daemon-cli ---
export { performStackSync } from './sync.js';
export type {
  StackSyncOptions,
  StackSyncReport,
  StackSyncProviderCommand,
  StackSyncOutcome,
} from './sync.js';
// --- eforge:endregion plan-01-stack-sync-daemon-cli ---

// --- eforge:region plan-01-core-daemon-stack-sync ---
export type {
  StackSyncTrigger,
  StackSyncActiveBuildPolicy,
  StackSyncStatus,
  StackSyncStatusFile,
} from './sync-state.js';
export {
  stackSyncStatusPath,
  loadStackSyncStatus,
  loadStackSyncStatusSync,
  saveStackSyncStatus,
  setCurrentSyncStatus,
  completeCurrentSyncStatus,
} from './sync-state.js';
// --- eforge:endregion plan-01-core-daemon-stack-sync ---
