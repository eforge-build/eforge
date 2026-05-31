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
  updateArtifactRecord,
} from './registry.js';

export type {
  ArtifactRecord,
  ArtifactRegistry,
  ArtifactRecordUpdates,
} from './registry.js';

export {
  completionRegistryPath,
  loadCompletionRegistry,
  saveCompletionRegistry,
  upsertCompletion,
  lookupCompletion,
} from './completions.js';

export type { CompletionRecord, CompletionRegistry } from './completions.js';
