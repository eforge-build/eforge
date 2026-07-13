import { resolveTrunkBranch } from '../branch-policy.js';
import type { EforgeConfig } from '../config.js';
import {
  fetchRemoteBranchHeadCommit,
  proveAncestor,
  refResolvesToCommit,
  resolveRefCommit,
  resolveRemoteBranchHeadCommit,
} from '../stacking/base-repair.js';
import { isRegisteredRemote, validateRemoteName } from '../trunk-sync.js';

export type ValidationBaseResolution =
  | { available: true; baseRef: string; repaired: boolean }
  | { available: false; reason: string; code: 'missing-pin' | 'invalid-pin' | 'unresolved-pin' | 'unresolved-base' | 'unintegrated-pin' | 'pin-not-ancestor-of-base' | 'pin-not-ancestor-of-head' | 'proof-failed' };

async function resolveFreshTrunkCommit(cwd: string, trunkBranch: string, remote: string): Promise<{ commit?: string; ref: string; error?: string }> {
  // A tracking ref can survive remote deletion or advancement. When a usable
  // remote is configured, fetch its trunk into FETCH_HEAD for a fresh proof.
  if (validateRemoteName(remote) === undefined && await isRegisteredRemote(remote, cwd)) {
    const remoteHead = await resolveRemoteBranchHeadCommit(cwd, trunkBranch, remote);
    if (!remoteHead.ok && remoteHead.reason === 'query-failed') {
      return { ref: `${remote}/${trunkBranch}`, error: `Could not query configured trunk '${remote}/${trunkBranch}'${remoteHead.stderr ? `: ${remoteHead.stderr}` : '.'}` };
    }
    if (remoteHead.ok) {
      const fetched = await fetchRemoteBranchHeadCommit(cwd, trunkBranch, remote);
      if (!fetched.ok) {
        return { ref: `${remote}/${trunkBranch}`, error: `Could not refresh configured trunk '${remote}/${trunkBranch}'${fetched.stderr ? `: ${fetched.stderr}` : '.'}` };
      }
      return { commit: fetched.commit, ref: `${remote}/${trunkBranch}` };
    }
  }

  const ref = `refs/heads/${trunkBranch}`;
  return { commit: await resolveRefCommit(cwd, ref), ref };
}

/**
 * Resolve the immutable validation base without changing stack/landing topology.
 * A missing logical parent can only be repaired to configured trunk after the
 * dispatch-time pin is proven ancestral to that trunk integration ref.
 */
export async function resolveValidationBase(options: {
  cwd: string;
  baseBranch: string;
  diffBaseRef?: string;
  /** Persisted orchestration provenance, never inferred from branch naming. */
  stackedValidationPinRequired?: boolean;
  config: Pick<EforgeConfig, 'build'>;
}): Promise<ValidationBaseResolution> {
  const { cwd, baseBranch, diffBaseRef, config, stackedValidationPinRequired = false } = options;
  if (!diffBaseRef) {
    if (stackedValidationPinRequired) {
      return { available: false, code: 'missing-pin', reason: `Stacked validation base '${baseBranch}' has no immutable diff_base_ref pin.` };
    }
    return (await refResolvesToCommit(cwd, baseBranch))
      ? { available: true, baseRef: baseBranch, repaired: false }
      : { available: false, code: 'unresolved-base', reason: `Validation base '${baseBranch}' does not resolve.` };
  }
  // A persisted pin is untrusted orchestration input: accept only a canonical
  // full object ID, never a movable symbolic ref or an abbreviated SHA.
  if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(diffBaseRef)) {
    return { available: false, code: 'invalid-pin', reason: `Pinned validation base '${diffBaseRef}' is not a canonical full commit object ID.` };
  }
  const resolvedPin = await resolveRefCommit(cwd, diffBaseRef);
  if (!resolvedPin) {
    return { available: false, code: 'unresolved-pin', reason: `Pinned validation base '${diffBaseRef}' does not resolve.` };
  }
  if (resolvedPin !== diffBaseRef) {
    return { available: false, code: 'invalid-pin', reason: `Pinned validation base '${diffBaseRef}' is not its canonical commit object ID.` };
  }
  try {
    // A resolving object name alone is insufficient: the pin must be evidence
    // for this exact child, not an arbitrary commit reachable elsewhere.
    const headProof = await proveAncestor(cwd, diffBaseRef, 'HEAD');
    if (headProof.result === 'failed') {
      return { available: false, code: 'proof-failed', reason: `Could not prove pinned validation base '${diffBaseRef}' ancestral to child HEAD: ${headProof.reason}` };
    }
    if (headProof.result === 'not-ancestor') {
      return { available: false, code: 'pin-not-ancestor-of-head', reason: `Pinned validation base '${diffBaseRef}' is not proven ancestral to child HEAD.` };
    }
    if (await refResolvesToCommit(cwd, baseBranch)) {
      const baseProof = await proveAncestor(cwd, diffBaseRef, baseBranch);
      if (baseProof.result === 'ancestor') return { available: true, baseRef: diffBaseRef, repaired: false };
      if (baseProof.result === 'failed') {
        return { available: false, code: 'proof-failed', reason: `Could not prove pinned validation base '${diffBaseRef}' ancestral to logical base '${baseBranch}': ${baseProof.reason}` };
      }
      // Non-stacked trunk sync pins the fetched remote commit while the local
      // trunk branch can legitimately still point behind it.
      const remote = config.build.trunkSync?.remote ?? 'origin';
      const trunkBranch = await resolveTrunkBranch({ build: config.build }, cwd, remote);
      const localProof = await proveAncestor(cwd, baseBranch, diffBaseRef);
      if (localProof.result === 'failed') {
        return { available: false, code: 'proof-failed', reason: `Could not prove logical base '${baseBranch}' behind pinned validation base '${diffBaseRef}': ${localProof.reason}` };
      }
      if (baseBranch === trunkBranch && localProof.result === 'ancestor') return { available: true, baseRef: diffBaseRef, repaired: false };
      return { available: false, code: 'pin-not-ancestor-of-base', reason: `Pinned validation base '${diffBaseRef}' is not proven ancestral to logical base '${baseBranch}'.` };
    }

    const remote = config.build.trunkSync?.remote ?? 'origin';
    const trunkBranch = await resolveTrunkBranch({ build: config.build }, cwd, remote);
    const freshTrunk = await resolveFreshTrunkCommit(cwd, trunkBranch, remote);
    if (freshTrunk.error) return { available: false, code: 'proof-failed', reason: freshTrunk.error };
    if (!freshTrunk.commit) return { available: false, code: 'unintegrated-pin', reason: `Logical validation base '${baseBranch}' is unavailable and configured trunk '${freshTrunk.ref}' does not resolve.` };
    const trunkProof = await proveAncestor(cwd, diffBaseRef, freshTrunk.commit);
    if (trunkProof.result === 'failed') return { available: false, code: 'proof-failed', reason: `Could not prove pinned validation base '${diffBaseRef}' integrated into configured trunk '${freshTrunk.ref}': ${trunkProof.reason}` };
    if (trunkProof.result === 'not-ancestor') return { available: false, code: 'unintegrated-pin', reason: `Logical validation base '${baseBranch}' is unavailable and pinned base '${diffBaseRef}' is not proven integrated into configured trunk '${freshTrunk.ref}'.` };
    return { available: true, baseRef: freshTrunk.commit, repaired: true };
  } catch (err) {
    return { available: false, code: 'proof-failed', reason: `Could not resolve validation base '${diffBaseRef}' for '${baseBranch}': ${err instanceof Error ? err.message : String(err)}` };
  }
}
