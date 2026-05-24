/**
 * Artifact registry public exports.
 *
 * The artifact registry is the engine-wide source of truth for dependency
 * readiness. Every successful queued PRD build records a durable artifact
 * entry here before the landing step begins.
 */

export {
  artifactRegistrySchema,
  artifactRegistryPath,
  loadArtifactRegistry,
  saveArtifactRegistry,
  upsertArtifact,
  lookupArtifactByPrdId,
  hasUsableArtifact,
  // --- eforge:region plan-01-runtime-artifact-diagnostics ---
  updateArtifactRecord,
  // --- eforge:endregion plan-01-runtime-artifact-diagnostics ---
} from './registry.js';

export type {
  ArtifactRecord,
  ArtifactRegistry,
  // --- eforge:region plan-01-runtime-artifact-diagnostics ---
  ArtifactRecordUpdates,
  // --- eforge:endregion plan-01-runtime-artifact-diagnostics ---
} from './registry.js';

// --- eforge:region plan-01-runtime-artifact-diagnostics ---
export {
  completionRegistryPath,
  loadCompletionRegistry,
  saveCompletionRegistry,
  upsertCompletion,
  lookupCompletion,
} from './completions.js';

export type { CompletionRecord, CompletionRegistry } from './completions.js';
// --- eforge:endregion plan-01-runtime-artifact-diagnostics ---
