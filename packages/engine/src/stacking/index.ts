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
  updateStackLayerStatusAndLanding,
} from './state.js';

export type { StackBaseContext } from './base-resolver.js';
export { resolveStackBaseContext } from './base-resolver.js';
export type {
  StackBaseRepairReason,
  StackBaseRepairEvidence,
  RemoteBranchExistsResult,
} from './base-repair.js';
export {
  resolveRefCommit,
  refResolvesToCommit,
  requireRefCommit,
  resolveTrunkIntegrationRef,
  isAncestor,
  remoteBranchExists,
} from './base-repair.js';
export { recordSuccessfulBuildArtifact } from './artifacts.js';

export type {
  StackProviderAdapter,
  ProviderCommandResult,
  StackProviderErrorKind,
  StackProviderOperationKind,
  StackProviderConflictKind,
  StackProviderErrorClassification,
  StackProviderInterruptedOperation,
} from './provider.js';
export { createProvider } from './provider.js';
export { stackProviderCommandEvent, stackProviderCommandEventFromError } from './provider-events.js';
export { recoverLandingConflict } from './landing-conflict-recovery.js';
export type {
  LandingConflictRecoveryOptions,
  LandingConflictRecoveryResult,
} from './landing-conflict-recovery.js';
export {
  GitSpiceAdapter,
  GitSpiceNotAvailableError,
  GitSpiceCommandError,
  createGitSpiceAdapter,
  parseGitSpicePrUrl,
  redactProviderMessage,
} from './git-spice.js';

export { executeStackLanding } from './landing.js';
export type { StackLandingBaseMetadata, StackLandingOptions } from './landing.js';

export { performStackSync } from './sync.js';
export type {
  StackSyncOptions,
  StackSyncReport,
  StackSyncProviderCommand,
  StackSyncOutcome,
} from './sync.js';

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
