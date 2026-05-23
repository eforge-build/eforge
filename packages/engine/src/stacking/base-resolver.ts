import { resolveTrunkBranch } from '../branch-policy.js';
import type { EforgeConfig } from '../config.js';
import type { QueuedPrd } from '../prd-queue.js';
import { refExists } from '../worktree-ops.js';
import { getRecordedArtifactRef, loadStackState, lookupLayerByPrdId } from './state.js';

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

  const stackState = await loadStackState(cwd);
  const parentLayer = lookupLayerByPrdId(stackState, parentPrdId);
  if (!parentLayer) {
    throw new Error(
      `Cannot resolve stack base for PRD '${prdId}': parent PRD '${parentPrdId}' has no recorded stack layer. ` +
      `Rebuild or repair the parent artifact before dispatching the child.`,
    );
  }

  const artifactRef = getRecordedArtifactRef(stackState, parentPrdId);
  if (!artifactRef) {
    throw new Error(
      `Cannot resolve stack base for PRD '${prdId}': parent PRD '${parentPrdId}' has no recorded artifact ref. ` +
      `Rebuild or repair the parent artifact before dispatching the child.`,
    );
  }

  if (!await refExists(cwd, artifactRef)) {
    throw new Error(
      `Cannot resolve stack base for PRD '${prdId}': parent PRD '${parentPrdId}' recorded artifact ref '${artifactRef}' does not resolve. ` +
      `Rebuild or repair the parent artifact before dispatching the child.`,
    );
  }

  return {
    prdId,
    stackId: prd.frontmatter.stack_id ?? parentLayer.stackId,
    parentPrdId,
    provider,
    branch,
    baseBranch: artifactRef,
  };
}
