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
  StackArtifactRef,
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
  isArtifactAvailable,
} from './state.js';

// --- eforge:region plan-02-git-spice-provider-and-git-primitives ---
export type { StackProviderAdapter } from './provider.js';
export { createProvider } from './provider.js';
export {
  GitSpiceAdapter,
  GitSpiceNotAvailableError,
  GitSpiceCommandError,
  createGitSpiceAdapter,
} from './git-spice.js';
// --- eforge:endregion plan-02-git-spice-provider-and-git-primitives ---
