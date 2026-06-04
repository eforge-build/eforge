/**
 * Stack landing base helpers.
 *
 * Landing orchestration delegates effective-base preflight/repair and the
 * remote-base freshness proof here so provider-boundary code stays focused on
 * provider command ordering.
 */

import { loadArtifactRegistry, lookupArtifactByPrdId } from '../artifacts/registry.js';
import type { StackBaseContext } from './base-resolver.js';
import {
  fetchRemoteBranchHeadCommit,
  isAncestor,
  remoteBranchExists,
  resolveRefCommit,
  type StackBaseRepairReason,
} from './base-repair.js';
import type { ProviderCommandResult, StackProviderAdapter } from './provider.js';
import { loadStackState, lookupLayerByPrdId } from './state.js';

export interface StackLandingBaseMetadata {
  originalBaseBranch?: string;
  effectiveBaseBranch: string;
  baseRepairReason?: StackBaseRepairReason;
}

export type LandingBaseDecision = StackLandingBaseMetadata;

export type LandingBasePreflightResult =
  | { ok: true; decision: LandingBaseDecision; retargetResult?: ProviderCommandResult }
  | { ok: false; decision: LandingBaseDecision; reason: string };

export type LandingFreshnessCheckResult =
  | { kind: 'fresh'; remote: string; branch: string; fetchedBaseSha: string; headSha: string }
  | { kind: 'stale'; remote: string; branch: string; fetchedBaseSha: string; headSha: string; reason: string }
  | { kind: 'failed'; remote: string; branch: string; reason: string; error?: unknown };

export function initialLandingBaseDecision(stackContext: StackBaseContext, fallbackBase: string): LandingBaseDecision {
  const effectiveBaseBranch = stackContext.baseBranch ?? fallbackBase;
  const originalBaseBranch = stackContext.originalBaseBranch ?? effectiveBaseBranch;
  return {
    originalBaseBranch,
    effectiveBaseBranch,
    ...(stackContext.repairReason !== undefined && { baseRepairReason: stackContext.repairReason }),
  };
}

export function landingBaseMetadata(decision: LandingBaseDecision): Partial<LandingBaseDecision> {
  return {
    originalBaseBranch: decision.originalBaseBranch,
    effectiveBaseBranch: decision.effectiveBaseBranch,
    ...(decision.baseRepairReason !== undefined && { baseRepairReason: decision.baseRepairReason }),
  };
}

export function stackContextForLandingDecision(
  stackContext: StackBaseContext,
  decision: LandingBaseDecision,
): StackBaseContext {
  const effectiveContext: StackBaseContext = {
    ...stackContext,
    baseBranch: decision.effectiveBaseBranch,
    originalBaseBranch: decision.originalBaseBranch,
    effectiveBaseBranch: decision.effectiveBaseBranch,
  };
  if (decision.baseRepairReason !== undefined) {
    effectiveContext.repairReason = decision.baseRepairReason;
  } else {
    delete effectiveContext.repairReason;
  }
  return effectiveContext;
}

export async function preflightLandingBase(options: {
  cwd: string;
  mergeWorktreePath: string;
  stackContext: StackBaseContext;
  provider: StackProviderAdapter;
  decision: LandingBaseDecision;
}): Promise<LandingBasePreflightResult> {
  const { cwd, mergeWorktreePath, stackContext, provider } = options;
  const decision = { ...options.decision };
  if (stackContext.parentPrdId === undefined) return { ok: true, decision };
  const remote = stackContext.trunkRemote ?? 'origin';
  const trunkBranch = stackContext.trunkBranch ?? 'main';
  const remoteCheck = await remoteBranchExists(mergeWorktreePath, decision.effectiveBaseBranch, remote);
  if (remoteCheck.exists) {
    if (requiresCurrentTrunkProof(decision, trunkBranch)) {
      const proof = await verifyParentIntegratedIntoRemoteTrunk({ cwd, mergeWorktreePath, stackContext, decision, remote, trunkBranch });
      if (!proof.ok) return { ok: false, decision, reason: proof.reason };
    }
    return { ok: true, decision };
  }
  if (remoteCheck.reason === 'query-failed') {
    return { ok: false, decision, reason: `Cannot verify remote base branch '${decision.effectiveBaseBranch}' on remote '${remote}'; remote query failed${remoteCheck.stderr ? `: ${remoteCheck.stderr}` : ''}` };
  }
  if (decision.effectiveBaseBranch === trunkBranch) {
    return { ok: false, decision, reason: `Remote base branch '${decision.effectiveBaseBranch}' is missing on remote '${remote}'; cannot submit stacked child against a missing trunk base` };
  }
  const proof = await verifyParentIntegratedIntoRemoteTrunk({ cwd, mergeWorktreePath, stackContext, decision, remote, trunkBranch, missingBaseBranch: decision.effectiveBaseBranch });
  if (!proof.ok) return { ok: false, decision, reason: proof.reason };
  const repairedDecision: LandingBaseDecision = {
    originalBaseBranch: decision.originalBaseBranch ?? decision.effectiveBaseBranch,
    effectiveBaseBranch: trunkBranch,
    baseRepairReason: 'parent-artifact-already-integrated',
  };
  const retargetResult = await provider.retargetBranch(mergeWorktreePath, stackContext.branch, trunkBranch);
  return { ok: true, decision: repairedDecision, retargetResult };
}

export async function proveLandingHeadFreshness(options: {
  mergeWorktreePath: string;
  stackContext: StackBaseContext;
  decision: LandingBaseDecision;
}): Promise<LandingFreshnessCheckResult> {
  const { mergeWorktreePath, stackContext, decision } = options;
  const remote = stackContext.trunkRemote ?? 'origin';
  const branch = decision.effectiveBaseBranch;
  try {
    const fetchedBase = await fetchRemoteBranchHeadCommit(mergeWorktreePath, branch, remote);
    if (!fetchedBase.ok) {
      return {
        kind: 'failed',
        remote,
        branch,
        reason: `Cannot prove landing freshness: remote base '${remote}/${branch}' could not be fetched${fetchedBase.stderr ? `: ${fetchedBase.stderr}` : ''}`,
        ...(fetchedBase.error !== undefined ? { error: fetchedBase.error } : {}),
      };
    }
    const headSha = await resolveRefCommit(mergeWorktreePath, 'HEAD');
    if (headSha === undefined) {
      return { kind: 'failed', remote, branch, reason: `Cannot prove landing freshness: HEAD could not be resolved after fetching '${remote}/${branch}' at '${fetchedBase.commit}'` };
    }
    if (await isAncestor(mergeWorktreePath, fetchedBase.commit, headSha)) {
      return { kind: 'fresh', remote, branch, fetchedBaseSha: fetchedBase.commit, headSha };
    }
    return {
      kind: 'stale',
      remote,
      branch,
      fetchedBaseSha: fetchedBase.commit,
      headSha,
      reason: `Cannot prove landing freshness: fetched remote base '${remote}/${branch}' at '${fetchedBase.commit}' is not an ancestor of HEAD '${headSha}'`,
    };
  } catch (error) {
    return {
      kind: 'failed',
      remote,
      branch,
      reason: `Cannot prove landing freshness for '${remote}/${branch}': ${error instanceof Error ? error.message : String(error)}`,
      error,
    };
  }
}

async function resolveParentArtifactCommit(cwd: string, stackContext: StackBaseContext): Promise<string | undefined> {
  if (stackContext.parentArtifactCommit !== undefined) return stackContext.parentArtifactCommit;
  if (stackContext.parentPrdId === undefined) return undefined;
  const [registry, stackState] = await Promise.all([loadArtifactRegistry(cwd), loadStackState(cwd)]);
  const artifactRecord = lookupArtifactByPrdId(registry, stackContext.parentPrdId);
  const parentLayer = lookupLayerByPrdId(stackState, stackContext.parentPrdId);
  const artifactRef = stackContext.parentArtifactRef
    ?? (artifactRecord?.status === 'built' ? artifactRecord.artifactBranch : undefined)
    ?? parentLayer?.artifact?.branch;
  const refCommit = artifactRef !== undefined ? await resolveRefCommit(cwd, artifactRef) : undefined;
  if (refCommit !== undefined) return refCommit;
  const recordedCommit = artifactRecord?.commitSha ?? parentLayer?.artifact?.commitSha;
  return recordedCommit !== undefined ? resolveRefCommit(cwd, recordedCommit) : undefined;
}

async function verifyParentIntegratedIntoRemoteTrunk(options: {
  cwd: string;
  mergeWorktreePath: string;
  stackContext: StackBaseContext;
  decision: LandingBaseDecision;
  remote: string;
  trunkBranch: string;
  missingBaseBranch?: string;
}): Promise<{ ok: true; parentCommit: string; remoteTrunkCommit: string } | { ok: false; reason: string }> {
  const { cwd, mergeWorktreePath, stackContext, decision, remote, trunkBranch, missingBaseBranch } = options;
  const parentCommit = await resolveParentArtifactCommit(cwd, stackContext);
  const baseDescription = missingBaseBranch !== undefined
    ? `Remote base branch '${missingBaseBranch}' is missing on remote '${remote}' and `
    : `Effective trunk base '${decision.effectiveBaseBranch}' requires current remote integration proof, but `;
  if (parentCommit === undefined) {
    return { ok: false, reason: `${baseDescription}parent artifact commit evidence is unavailable; cannot prove the parent is integrated into trunk '${trunkBranch}'` };
  }
  const remoteTrunk = await fetchRemoteBranchHeadCommit(mergeWorktreePath, trunkBranch, remote);
  if (!remoteTrunk.ok) {
    return { ok: false, reason: `${baseDescription}current trunk '${trunkBranch}' could not be resolved from remote '${remote}'${remoteTrunk.stderr ? `: ${remoteTrunk.stderr}` : ''}` };
  }
  if (!await isAncestor(mergeWorktreePath, parentCommit, remoteTrunk.commit)) {
    return { ok: false, reason: `${baseDescription}parent artifact commit '${parentCommit}' is not an ancestor of current remote trunk '${remoteTrunk.commit}'` };
  }
  return { ok: true, parentCommit, remoteTrunkCommit: remoteTrunk.commit };
}

function requiresCurrentTrunkProof(decision: LandingBaseDecision, trunkBranch: string): boolean {
  return decision.effectiveBaseBranch === trunkBranch &&
    (decision.baseRepairReason !== undefined || decision.originalBaseBranch !== decision.effectiveBaseBranch);
}
