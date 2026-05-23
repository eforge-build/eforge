/**
 * Engine-owned stack/layer domain types.
 *
 * These types mirror the shared wire shapes where needed but are the
 * authoritative representation for engine-internal operations.
 */

// ---------------------------------------------------------------------------
// Stack provider
// ---------------------------------------------------------------------------

/** Supported stack providers. Only git-spice is available in this release. */
export type StackProvider = 'git-spice';

// ---------------------------------------------------------------------------
// Landing publication action (shorthand vocabulary)
// ---------------------------------------------------------------------------

/**
 * Shorthand landing publication actions for stacked PRD builds.
 *
 * - `'pr'`    — issue a pull request for the feature branch
 * - `'merge'` — merge the feature branch to the base branch
 * - `'leave'` — leave the branch as-is without landing
 */
export type LandingPublicationAction = 'pr' | 'merge' | 'leave';

// ---------------------------------------------------------------------------
// Stack layer status
// ---------------------------------------------------------------------------

/** Lifecycle status of a single stack layer. */
export type StackLayerStatus =
  | 'pending'   // layer recorded but not yet built
  | 'building'  // layer is actively being built
  | 'built'     // build complete, artifact available
  | 'merged'    // layer merged into the feature branch
  | 'landed'    // artifact has been PR'd, merged, or left as configured
  | 'failed';   // build or landing failed

// ---------------------------------------------------------------------------
// Artifact reference
// ---------------------------------------------------------------------------

/** Reference to a build artifact (branch + optional commit/PR link). */
export interface StackArtifactRef {
  /** The branch name for this artifact. */
  branch: string;
  /** The commit SHA of the artifact, when available. */
  commitSha?: string;
  /** The PR URL for this artifact, when a PR has been issued. */
  prUrl?: string;
}

// ---------------------------------------------------------------------------
// Stack layer
// ---------------------------------------------------------------------------

/**
 * A single layer in a logical stack.
 *
 * Each layer corresponds to one PRD build within a stack. Layers are ordered
 * by their parent relationships, not by insertion order.
 */
export interface StackLayer {
  /** PRD id this layer belongs to. */
  prdId: string;
  /** Logical stack identifier (shared across all layers in the same stack). */
  stackId: string;
  /** PRD id of the parent layer, if any. Top of stack has no parent. */
  parentPrdId?: string;
  /** Stack provider used to manage this layer. */
  provider: StackProvider;
  /** Feature branch for this layer's work. */
  branch: string;
  /** Base branch at the time this layer was recorded. */
  baseBranch?: string;
  /** Build artifact reference, available once the layer is built. */
  artifact?: StackArtifactRef;
  /** Override landing action for this layer (inherits from config when absent). */
  landingAction?: LandingPublicationAction;
  /** Current lifecycle status. */
  status: StackLayerStatus;
  /** ISO-8601 timestamp when this layer was first recorded. */
  recordedAt: string;
  /** ISO-8601 timestamp of the last update to this layer. */
  updatedAt: string;
}

// ---------------------------------------------------------------------------
// Stack state (file root)
// ---------------------------------------------------------------------------

/**
 * Root shape of the `.eforge/stacks/layers.json` runtime state file.
 *
 * `version: 1` is the only supported version. The engine refuses to load
 * files with unknown versions.
 */
export interface StackState {
  /** File format version. Must be 1. */
  version: 1;
  /** All recorded stack layers, in insertion order. */
  layers: StackLayer[];
}
