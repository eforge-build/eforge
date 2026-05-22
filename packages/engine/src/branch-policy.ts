/**
 * Branch policy helpers — trunk branch identity and merge-policy checks.
 *
 * Trunk resolution precedence:
 *   1. config.build.trunkBranch (explicit user config) — returned immediately, no git I/O.
 *   2. git symbolic-ref refs/remotes/origin/HEAD --short — strips the "origin/" prefix.
 *   3. "main" — universal fallback when git fails or origin/HEAD is unset.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { EforgeConfig } from './config.js';

const exec = promisify(execFile);

/** Resolved trunk-branch policy for a project. */
export interface BranchPolicy {
  /** The resolved trunk branch name. */
  trunkBranch: string;
  /** Whether local merges directly to trunk are permitted. */
  allowLocalMergeToTrunk: boolean;
}

/**
 * Resolve the trunk branch for the project.
 *
 * Precedence:
 *   1. `config.build.trunkBranch` when set — returned immediately, no git I/O.
 *   2. `git symbolic-ref refs/remotes/origin/HEAD --short` — strips the `origin/` prefix.
 *   3. `"main"` — universal fallback when git fails or origin/HEAD is unset.
 *
 * @param config - The resolved EforgeConfig, or `undefined` when called from
 *                 code paths that don't have a full config (e.g. failure recovery).
 * @param cwd    - Repository root used for git invocations.
 */
export async function resolveTrunkBranch(
  config: Pick<EforgeConfig, 'build'> | undefined,
  cwd: string,
): Promise<string> {
  if (config?.build?.trunkBranch) {
    return config.build.trunkBranch;
  }

  try {
    const { stdout } = await exec(
      'git',
      ['symbolic-ref', 'refs/remotes/origin/HEAD', '--short'],
      { cwd },
    );
    const ref = stdout.trim();
    // Strip "origin/" prefix (e.g., "origin/main" → "main")
    const stripped = ref.replace(/^origin\//, '');
    if (stripped) return stripped;
  } catch {
    // origin/HEAD unset, no remote, or not a git repo — fall through to default
  }

  return 'main';
}

/**
 * Check whether a branch is the trunk branch.
 *
 * @param branch - The branch name to check.
 * @param trunk  - The resolved trunk branch name (from `resolveTrunkBranch`).
 */
export function isTrunkBranch(branch: string, trunk: string): boolean {
  return branch === trunk;
}
