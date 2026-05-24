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
} from './registry.js';

export type { ArtifactRecord, ArtifactRegistry } from './registry.js';
