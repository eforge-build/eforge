import { resolveTrunkBranch } from '../branch-policy.js';
import type { EforgeConfig } from '../config.js';
import type { QueuedPrd } from '../prd-queue.js';
import { refExists } from '../worktree-ops.js';
import { getRecordedArtifactRef, loadStackState, lookupLayerByPrdId } from './state.js';
import { loadArtifactRegistry, lookupArtifactByPrdId } from '../artifacts/registry.js';

export interface StackBaseContext {
  prdId: string;
  stackId: string;
  parentPrdId?: string;
  provider: 'git-spice';
  branch: string;
  baseBranch: string;
}

export async function resolveStackBaseContext(options: {
  cwd: string;
  config: Pick<EforgeConfig, 'build' | 'stacking'>;
  prd: QueuedPrd;
  planSetName?: string;
}): Promise<StackBaseContext> {
  const { cwd, config, prd } = options;
  const prdId = prd.id;
  const branch = `eforge/${options.planSetName ?? prdId}`;
  const provider = prd.frontmatter.stack_provider ?? config.stacking.provider;
  const parentPrdId = prd.frontmatter.stack_parent;

  if (!parentPrdId) {
    const baseBranch = await resolveTrunkBranch({ build: config.build }, cwd);
    return {
      prdId,
      stackId: prd.frontmatter.stack_id ?? prdId,
      provider,
      branch,
      baseBranch,
    };
  }

  // Resolve parent artifact ref: check the provider-neutral artifact registry
  // first (written for all queued builds), then fall back to the stack layer
  // projection (written only for stacked builds).
  const artifactRegistry = await loadArtifactRegistry(cwd);
  const parentArtifactRecord = lookupArtifactByPrdId(artifactRegistry, parentPrdId);

  // Load stack state for stackId resolution and as fallback artifact ref.
  const stackState = await loadStackState(cwd);
  const parentLayer = lookupLayerByPrdId(stackState, parentPrdId);

  // Prefer artifact registry; fall back to stack layer projection.
  const artifactRef = (parentArtifactRecord?.status === 'built' ? parentArtifactRecord.artifactBranch : undefined)
    ?? getRecordedArtifactRef(stackState, parentPrdId);

  if (!artifactRef) {
    throw new Error(
      `Cannot resolve stack base for PRD '${prdId}': parent PRD '${parentPrdId}' has no recorded artifact ref. ` +
      `Rebuild or repair the parent artifact before dispatching the child.`,
    );
  }

  let baseBranch = artifactRef;
  if (!await refExists(cwd, artifactRef)) {
    // Try commitSha from registry first, then stack layer fallback.
    const commitSha = parentArtifactRecord?.commitSha ?? parentLayer?.artifact?.commitSha;
    if (commitSha && await refExists(cwd, commitSha)) {
      baseBranch = commitSha;
    } else {
      throw new Error(
        `Cannot resolve stack base for PRD '${prdId}': parent PRD '${parentPrdId}' recorded artifact ref '${artifactRef}' does not resolve. ` +
        `Rebuild or repair the parent artifact before dispatching the child.`,
      );
    }
  }

  return {
    prdId,
    // stackId: prefer frontmatter, then parent layer (topology), then parentPrdId fallback.
    stackId: prd.frontmatter.stack_id ?? parentLayer?.stackId ?? parentPrdId,
    parentPrdId,
    provider,
    branch,
    baseBranch,
  };
}
