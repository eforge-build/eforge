/**
 * Engine barrel — re-exports engine internals that consumers (daemon routes,
 * MCP tools, CLI, skills) should import from a single stable entry point.
 *
 * Individual engine sub-modules are also importable directly via
 * `@eforge-build/engine/<module>` for callers that prefer fine-grained imports.
 *
 * Note: Playbook API has moved to @eforge-build/input.
 * Note: Set-resolver types have moved to @eforge-build/scopes.
 */

// --- eforge:region plan-01-config-and-trunk-resolution ---
export { resolveTrunkBranch, isTrunkBranch } from './branch-policy.js';
export type { BranchPolicy } from './branch-policy.js';
// --- eforge:endregion plan-01-config-and-trunk-resolution ---
// --- eforge:region plan-02-queue-runtime-and-prd-provenance ---
export { materializePrdArtifact } from './prd-queue.js';
export { moveFailedWithSidecar } from './prd-queue.js';
// --- eforge:endregion plan-02-queue-runtime-and-prd-provenance ---
