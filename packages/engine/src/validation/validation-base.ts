import { resolveTrunkBranch } from '../branch-policy.js';
import type { EforgeConfig } from '../config.js';
import {
  isAncestor,
  refResolvesToCommit,
  resolveTrunkIntegrationRef,
} from '../stacking/base-repair.js';

export type ValidationBaseResolution =
  | { available: true; baseRef: string; repaired: boolean }
  | { available: false; reason: string; code: 'missing-pin' | 'invalid-pin' | 'unresolved-pin' | 'unresolved-base' | 'unintegrated-pin' | 'pin-not-ancestor-of-base' | 'pin-not-ancestor-of-head' };

/**
 * Resolve the immutable validation base without changing stack/landing topology.
 * A missing logical parent can only be repaired to configured trunk after the
 * dispatch-time pin is proven ancestral to that trunk integration ref.
 */
export async function resolveValidationBase(options: {
  cwd: string;
  baseBranch: string;
  diffBaseRef?: string;
  config: Pick<EforgeConfig, 'build'>;
}): Promise<ValidationBaseResolution> {
  const { cwd, baseBranch, diffBaseRef, config } = options;
  if (!diffBaseRef) {
    // Engine-owned stacked artifact branches must always carry the dispatch pin.
    // Treating a missing pin as a normal branch diff would silently fabricate
    // evidence after the parent branch disappears.
    if (baseBranch.startsWith('eforge/')) {
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
  if (!(await refResolvesToCommit(cwd, diffBaseRef))) {
    return { available: false, code: 'unresolved-pin', reason: `Pinned validation base '${diffBaseRef}' does not resolve.` };
  }
  // A resolving object name alone is insufficient: the pin must be evidence
  // for this exact child, not an arbitrary commit reachable elsewhere.
  if (!(await isAncestor(cwd, diffBaseRef, 'HEAD'))) {
    return { available: false, code: 'pin-not-ancestor-of-head', reason: `Pinned validation base '${diffBaseRef}' is not proven ancestral to child HEAD.` };
  }
  if (await refResolvesToCommit(cwd, baseBranch)) {
    if (await isAncestor(cwd, diffBaseRef, baseBranch)) {
      return { available: true, baseRef: diffBaseRef, repaired: false };
    }
    // Non-stacked trunk sync pins the fetched remote commit while the local
    // trunk branch can legitimately still point behind it. Keep that legacy
    // flow distinct from a stacked parent: only the configured logical trunk
    // may be behind a pin that is otherwise proven ancestral to this child.
    const remote = config.build.trunkSync?.remote ?? 'origin';
    const trunkBranch = await resolveTrunkBranch({ build: config.build }, cwd, remote);
    if (baseBranch === trunkBranch && await isAncestor(cwd, baseBranch, diffBaseRef)) {
      return { available: true, baseRef: diffBaseRef, repaired: false };
    }
    return { available: false, code: 'pin-not-ancestor-of-base', reason: `Pinned validation base '${diffBaseRef}' is not proven ancestral to logical base '${baseBranch}'.` };
  }

  try {
    const remote = config.build.trunkSync?.remote ?? 'origin';
    const trunkBranch = await resolveTrunkBranch({ build: config.build }, cwd, remote);
    const trunkRef = await resolveTrunkIntegrationRef(cwd, trunkBranch, remote);
    if (!(await refResolvesToCommit(cwd, trunkRef)) || !(await isAncestor(cwd, diffBaseRef, trunkRef))) {
      return {
        available: false,
        code: 'unintegrated-pin',
        reason: `Logical validation base '${baseBranch}' is unavailable and pinned base '${diffBaseRef}' is not proven integrated into configured trunk '${trunkRef}'.`,
      };
    }
    return { available: true, baseRef: trunkRef, repaired: true };
  } catch (err) {
    return {
      available: false,
      code: 'unintegrated-pin',
      reason: `Could not prove pinned validation base '${diffBaseRef}' integrated: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
