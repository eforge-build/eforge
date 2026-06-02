import { resolveTrunkBranch } from '../branch-policy.js';
import type { EforgeConfig } from '../config.js';
import type { QueuedPrd } from '../prd-queue.js';
import { getRecordedArtifactRef, loadStackState, lookupLayerByPrdId } from './state.js';
import { loadArtifactRegistry, lookupArtifactByPrdId } from '../artifacts/registry.js';
import {
  isAncestor,
  resolveRefCommit,
  resolveTrunkIntegrationRef,
} from './base-repair.js';
import type { StackBaseContext } from './types.js';
export type { StackBaseContext } from './types.js';

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

  const trunkBranch = await resolveTrunkBranch({ build: config.build }, cwd, config.build.trunkSync?.remote);
  const trunkRemote = config.build.trunkSync?.remote ?? 'origin';
  const trunkIntegrationRef = await resolveTrunkIntegrationRef(cwd, trunkBranch, trunkRemote);

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

  const stackId = prd.frontmatter.stack_id ?? parentLayer?.stackId ?? parentPrdId;
  const parentArtifactCommit = await resolveRefCommit(cwd, artifactRef);
  if (parentArtifactCommit) {
    if (await isAncestor(cwd, parentArtifactCommit, trunkIntegrationRef)) {
      return baseContext({
        prdId,
        stackId,
        parentPrdId,
        provider,
        branch,
        baseBranch: trunkBranch,
        artifactRef,
        parentArtifactCommit,
        originalBaseBranch: artifactRef,
        effectiveBaseBranch: trunkBranch,
        trunkBranch,
        trunkRemote,
        trunkIntegrationRef,
        repaired: true,
      });
    }

    return baseContext({
      prdId,
      stackId,
      parentPrdId,
      provider,
      branch,
      baseBranch: artifactRef,
      artifactRef,
      parentArtifactCommit,
      originalBaseBranch: artifactRef,
      effectiveBaseBranch: artifactRef,
      trunkBranch,
      trunkRemote,
      trunkIntegrationRef,
      repaired: false,
    });
  }

  // Try commitSha from registry first, then stack layer fallback.
  const recordedCommitSha = parentArtifactRecord?.commitSha ?? parentLayer?.artifact?.commitSha;
  const recordedCommit = recordedCommitSha ? await resolveRefCommit(cwd, recordedCommitSha) : undefined;
  if (recordedCommit && await isAncestor(cwd, recordedCommit, trunkIntegrationRef)) {
    return baseContext({
      prdId,
      stackId,
      parentPrdId,
      provider,
      branch,
      baseBranch: trunkBranch,
      artifactRef,
      parentArtifactCommit: recordedCommit,
      originalBaseBranch: artifactRef,
      effectiveBaseBranch: trunkBranch,
      trunkBranch,
      trunkRemote,
      trunkIntegrationRef,
      repaired: true,
    });
  }

  throw new Error(
    `Cannot resolve stack base for PRD '${prdId}': parent PRD '${parentPrdId}' recorded artifact ref '${artifactRef}' ` +
    `is missing locally, and recorded commit '${recordedCommitSha ?? 'none'}' is not proven integrated into trunk via '${trunkIntegrationRef}'. ` +
    `Fetch or restore the parent artifact branch, rebuild the parent artifact, or repair stack topology by retargeting the child to trunk '${trunkBranch}' after confirming the parent has landed.`,
  );
}

function baseContext(options: {
  prdId: string;
  stackId: string;
  parentPrdId: string;
  provider: StackBaseContext['provider'];
  branch: string;
  baseBranch: string;
  artifactRef: string;
  parentArtifactCommit: string;
  originalBaseBranch: string;
  effectiveBaseBranch: string;
  trunkBranch: string;
  trunkRemote: string;
  trunkIntegrationRef: string;
  repaired: boolean;
}): StackBaseContext {
  return {
    prdId: options.prdId,
    stackId: options.stackId,
    parentPrdId: options.parentPrdId,
    provider: options.provider,
    branch: options.branch,
    baseBranch: options.baseBranch,
    parentArtifactRef: options.artifactRef,
    parentArtifactCommit: options.parentArtifactCommit,
    originalBaseBranch: options.originalBaseBranch,
    effectiveBaseBranch: options.effectiveBaseBranch,
    trunkBranch: options.trunkBranch,
    trunkRemote: options.trunkRemote,
    trunkIntegrationRef: options.trunkIntegrationRef,
    ...(options.repaired ? { repairReason: 'parent-artifact-already-integrated' } : {}),
  };
}
