/**
 * Shared stack base repair primitives.
 *
 * These helpers keep git/ref probing and trunk-integration evidence collection
 * in one place so dispatch-time base resolution and landing-time repair can
 * make the same fail-closed decisions.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { isRegisteredRemote, validateRemoteName } from '../trunk-sync.js';
import { redactProviderMessage } from './git-spice.js';

const exec = promisify(execFile);

export type StackBaseRepairReason = 'parent-artifact-already-integrated';

export interface StackBaseRepairEvidence {
  /** Recorded parent artifact branch/ref from the registry or stack layer. */
  parentArtifactRef?: string;
  /** Commit proven from the parent artifact ref tip or recorded commit SHA. */
  parentArtifactCommit?: string;
  /** Base that would have been used before repair/normalization. */
  originalBaseBranch?: string;
  /** Base that should be used after repair/normalization. */
  effectiveBaseBranch?: string;
  /** Resolved trunk branch name from branch policy. */
  trunkBranch?: string;
  /** Remote used for trunk integration proof, when configured/available. */
  trunkRemote?: string;
  /** Ref used for trunk integration proof, preferring refs/remotes/<remote>/<trunk>. */
  trunkIntegrationRef?: string;
  /** Reason the effective base differs from the original base. */
  repairReason?: StackBaseRepairReason;
}

export type RemoteBranchExistsResult =
  | {
      exists: true;
      branch: string;
      remote: string;
    }
  | {
      exists: false;
      branch: string;
      remote: string;
      reason: 'not-found' | 'query-failed';
      stderr?: string;
    };

/**
 * Resolve a ref to a commit SHA using git's commit-peeling syntax.
 *
 * Returns undefined when the ref/commit does not resolve.
 */
export async function resolveRefCommit(cwd: string, ref: string): Promise<string | undefined> {
  try {
    const { stdout } = await exec('git', ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`], { cwd });
    const commit = stdout.trim();
    return commit || undefined;
  } catch {
    return undefined;
  }
}

/** Return true when the ref resolves to a commit. */
export async function refResolvesToCommit(cwd: string, ref: string): Promise<boolean> {
  return (await resolveRefCommit(cwd, ref)) !== undefined;
}

/**
 * Resolve a commit ref or throw with git's failure semantics.
 */
export async function requireRefCommit(cwd: string, ref: string): Promise<string> {
  const { stdout } = await exec('git', ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`], { cwd });
  return stdout.trim();
}

/**
 * Prefer refs/remotes/<remote>/<trunk> for trunk integration proofs when it resolves;
 * otherwise fall back to the fully qualified local trunk branch ref.
 */
export async function resolveTrunkIntegrationRef(
  cwd: string,
  trunkBranch: string,
  remote = 'origin',
): Promise<string> {
  const remoteTrunkRef = `refs/remotes/${remote}/${trunkBranch}`;
  if (await refResolvesToCommit(cwd, remoteTrunkRef)) {
    return remoteTrunkRef;
  }
  return `refs/heads/${trunkBranch}`;
}

/**
 * Return true when potentialAncestor is an ancestor of descendant.
 *
 * Non-zero git results fail closed as false, including missing refs.
 */
export async function isAncestor(cwd: string, potentialAncestor: string, descendant: string): Promise<boolean> {
  try {
    await exec('git', ['merge-base', '--is-ancestor', potentialAncestor, descendant], { cwd });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check remote branch existence via ls-remote, distinguishing missing heads from
 * remote/query failures.
 */
export async function remoteBranchExists(
  cwd: string,
  branch: string,
  remote = 'origin',
): Promise<RemoteBranchExistsResult> {
  const remoteNameError = validateRemoteName(remote);
  if (remoteNameError !== undefined || !(await isRegisteredRemote(remote, cwd))) {
    return { exists: false, branch, remote, reason: 'query-failed' };
  }

  const exactHeadRef = `refs/heads/${branch}`;
  try {
    const { stdout } = await exec('git', ['ls-remote', '--exit-code', '--heads', remote, exactHeadRef], { cwd });
    const exists = stdout.split('\n').some((line) => line.trim().endsWith(`\t${exactHeadRef}`));
    if (exists) {
      return { exists: true, branch, remote };
    }
    return { exists: false, branch, remote, reason: 'not-found' };
  } catch (err) {
    const execErr = err as { code?: number | string; stderr?: string };
    const stderr = execErr.stderr !== undefined ? redactProviderMessage(execErr.stderr) : undefined;
    if (execErr.code === 2) {
      return {
        exists: false,
        branch,
        remote,
        reason: 'not-found',
        ...(stderr !== undefined ? { stderr } : {}),
      };
    }
    return {
      exists: false,
      branch,
      remote,
      reason: 'query-failed',
      ...(stderr !== undefined ? { stderr } : {}),
    };
  }
}
