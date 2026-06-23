/**
 * Direct non-stacked PR base synchronization.
 *
 * Fetches origin/<baseBranch>, rebases the engine-owned artifact branch onto
 * the fetched base before validation, and provides the final pre-PR freshness
 * check used immediately before publishing direct PRs.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type { MergeConflictInfo, MergeResolver } from './worktree-ops.js';
import { isRegisteredRemote, validateBranchName, validateRemoteName } from './trunk-sync.js';

const exec = promisify(execFile);

export const DIRECT_PR_REMOTE = 'origin';
export const DEFAULT_DIRECT_PR_REBASE_CONFLICT_ATTEMPTS = 12;
export const DEFAULT_DIRECT_PR_FRESHNESS_RETRIES = 2;

export interface DirectPrBaseSyncPoint {
  remote: string;
  baseBranch: string;
  baseSha: string;
  featureSha: string;
  rebased: boolean;
}

export type DirectPrBaseSyncFailureReason =
  | 'invalid-remote'
  | 'invalid-branch'
  | 'remote-unregistered'
  | 'fetch-failed'
  | 'fetch-head-unresolved'
  | 'checkout-failed'
  | 'rebase-failed'
  | 'conflict-resolution-failed'
  | 'conflicts-remain'
  | 'rebase-continue-failed'
  | 'conflict-attempts-exhausted';

export type DirectPrBaseSyncResult =
  | { ok: true; point: DirectPrBaseSyncPoint }
  | { ok: false; reason: DirectPrBaseSyncFailureReason; message: string; baseBranch: string; remote: string };

export type DirectPrFreshnessCheckResult =
  | { kind: 'fresh'; remote: string; baseBranch: string; validatedBaseSha: string; fetchedBaseSha: string }
  | { kind: 'base-advanced'; remote: string; baseBranch: string; validatedBaseSha: string; fetchedBaseSha: string }
  | { kind: 'failed'; remote: string; baseBranch: string; reason: string };

export interface SyncDirectPrBaseOptions {
  cwd: string;
  featureBranch: string;
  baseBranch: string;
  remote?: string;
  mergeResolver?: MergeResolver;
  conflictAttempts?: number;
}

export interface CheckDirectPrBaseFreshnessOptions {
  cwd: string;
  syncPoint: DirectPrBaseSyncPoint;
}

function gitEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_TERMINAL_PROMPT: '0',
    GIT_EDITOR: 'true',
    GIT_SEQUENCE_EDITOR: 'true',
  };
}

function shortSha(sha: string): string {
  return sha.slice(0, 12);
}

function failure(
  reason: DirectPrBaseSyncFailureReason,
  message: string,
  remote: string,
  baseBranch: string,
): DirectPrBaseSyncResult {
  return { ok: false, reason, message, remote, baseBranch };
}

async function resolveCommitSha(cwd: string, ref: string): Promise<string | undefined> {
  try {
    const { stdout } = await exec('git', ['rev-parse', `${ref}^{commit}`], { cwd, env: gitEnv() });
    const sha = stdout.trim();
    return sha.length > 0 ? sha : undefined;
  } catch {
    return undefined;
  }
}

async function isAncestor(cwd: string, ancestor: string, descendant: string): Promise<boolean> {
  try {
    await exec('git', ['merge-base', '--is-ancestor', ancestor, descendant], { cwd, env: gitEnv() });
    return true;
  } catch {
    return false;
  }
}

async function fetchBase(cwd: string, remote: string, baseBranch: string): Promise<string | undefined> {
  await exec('git', ['fetch', '--no-tags', '--no-recurse-submodules', remote, baseBranch], {
    cwd,
    timeout: 30_000,
    env: gitEnv(),
  });
  return resolveCommitSha(cwd, 'FETCH_HEAD');
}

async function getUnmergedPaths(cwd: string): Promise<string[]> {
  const { stdout } = await exec('git', ['diff', '--name-only', '--diff-filter=U'], { cwd, env: gitEnv() });
  return stdout.trim().split('\n').filter(Boolean);
}

async function getConflictDiff(cwd: string): Promise<string> {
  try {
    const { stdout } = await exec('git', ['diff'], { cwd, env: gitEnv() });
    return stdout;
  } catch {
    return '';
  }
}

async function abortRebase(cwd: string): Promise<void> {
  try {
    await exec('git', ['rebase', '--abort'], { cwd, env: gitEnv() });
  } catch {
    // Best-effort abort; callers report the original failure.
  }
}

async function validateRemoteAndBranch(cwd: string, remote: string, baseBranch: string): Promise<string | undefined> {
  const remoteErr = validateRemoteName(remote);
  if (remoteErr) return remoteErr;

  if (!(await isRegisteredRemote(remote, cwd))) {
    return `Remote '${remote}' is not a configured git remote`;
  }

  const branchErr = await validateBranchName(baseBranch, cwd);
  if (branchErr) return branchErr;
  return undefined;
}

async function finishConflictedRebase({
  cwd,
  featureBranch,
  baseBranch,
  mergeResolver,
  maxAttempts,
}: {
  cwd: string;
  featureBranch: string;
  baseBranch: string;
  mergeResolver?: MergeResolver;
  maxAttempts: number;
}): Promise<{ ok: true } | { ok: false; reason: DirectPrBaseSyncFailureReason; message: string }> {
  let attempts = 0;

  while (true) {
    const conflictedFiles = await getUnmergedPaths(cwd);
    if (conflictedFiles.length === 0) {
      return {
        ok: false,
        reason: 'rebase-continue-failed',
        message: `Direct PR base sync rebase failed without active conflicts on '${baseBranch}'`,
      };
    }

    if (!mergeResolver) {
      return {
        ok: false,
        reason: 'conflict-resolution-failed',
        message: `Direct PR base sync rebase conflicted on '${baseBranch}' and no merge resolver is configured`,
      };
    }

    if (attempts >= maxAttempts) {
      return {
        ok: false,
        reason: 'conflict-attempts-exhausted',
        message: `Direct PR base sync exhausted ${maxAttempts} conflict-resolution attempt(s) for '${baseBranch}'`,
      };
    }

    attempts += 1;
    const conflict: MergeConflictInfo = {
      branch: featureBranch,
      baseBranch,
      conflictedFiles,
      conflictDiff: await getConflictDiff(cwd),
    };

    const resolved = await mergeResolver(cwd, conflict).catch(() => false);
    if (!resolved) {
      return {
        ok: false,
        reason: 'conflict-resolution-failed',
        message: `Direct PR base sync conflict resolver failed for '${baseBranch}'`,
      };
    }

    const remaining = await getUnmergedPaths(cwd);
    if (remaining.length > 0) {
      return {
        ok: false,
        reason: 'conflicts-remain',
        message: `Direct PR base sync conflict resolver left ${remaining.length} unmerged file(s) for '${baseBranch}'`,
      };
    }

    try {
      await exec('git', ['rebase', '--continue'], { cwd, env: gitEnv() });
      return { ok: true };
    } catch {
      const activeConflicts = await getUnmergedPaths(cwd);
      if (activeConflicts.length === 0) {
        return {
          ok: false,
          reason: 'rebase-continue-failed',
          message: `Direct PR base sync rebase --continue failed without active conflicts on '${baseBranch}'`,
        };
      }
    }
  }
}

export async function syncDirectPrBase(options: SyncDirectPrBaseOptions): Promise<DirectPrBaseSyncResult> {
  const remote = options.remote ?? DIRECT_PR_REMOTE;
  const maxAttempts = options.conflictAttempts ?? DEFAULT_DIRECT_PR_REBASE_CONFLICT_ATTEMPTS;

  const validationErr = await validateRemoteAndBranch(options.cwd, remote, options.baseBranch);
  if (validationErr) {
    const remoteNameErr = validateRemoteName(remote);
    const reason = remoteNameErr || validationErr.startsWith('Remote ') ? 'invalid-remote' : 'invalid-branch';
    return failure(reason, validationErr, remote, options.baseBranch);
  }

  try {
    await exec('git', ['checkout', options.featureBranch], { cwd: options.cwd, env: gitEnv() });
  } catch (err) {
    return failure(
      'checkout-failed',
      `Direct PR base sync could not check out '${options.featureBranch}': ${(err as Error).message}`,
      remote,
      options.baseBranch,
    );
  }

  let fetchedBaseSha: string | undefined;
  try {
    fetchedBaseSha = await fetchBase(options.cwd, remote, options.baseBranch);
  } catch (err) {
    return failure(
      'fetch-failed',
      `Direct PR base sync failed to fetch '${remote}/${options.baseBranch}': ${(err as Error).message}`,
      remote,
      options.baseBranch,
    );
  }

  if (!fetchedBaseSha) {
    return failure(
      'fetch-head-unresolved',
      `Direct PR base sync could not resolve FETCH_HEAD for '${remote}/${options.baseBranch}'`,
      remote,
      options.baseBranch,
    );
  }

  const headSha = await resolveCommitSha(options.cwd, 'HEAD');
  if (!headSha) {
    return failure('rebase-failed', `Direct PR base sync could not resolve feature branch HEAD`, remote, options.baseBranch);
  }

  if (await isAncestor(options.cwd, fetchedBaseSha, headSha)) {
    return {
      ok: true,
      point: { remote, baseBranch: options.baseBranch, baseSha: fetchedBaseSha, featureSha: headSha, rebased: false },
    };
  }

  try {
    await exec('git', ['rebase', fetchedBaseSha], { cwd: options.cwd, env: gitEnv() });
  } catch {
    const rebaseResult = await finishConflictedRebase({
      cwd: options.cwd,
      featureBranch: options.featureBranch,
      baseBranch: options.baseBranch,
      mergeResolver: options.mergeResolver,
      maxAttempts,
    });
    if (!rebaseResult.ok) {
      await abortRebase(options.cwd);
      return failure(rebaseResult.reason, rebaseResult.message, remote, options.baseBranch);
    }
  }

  const featureSha = await resolveCommitSha(options.cwd, 'HEAD');
  if (!featureSha) {
    await abortRebase(options.cwd);
    return failure('rebase-failed', `Direct PR base sync could not resolve feature branch HEAD after rebase`, remote, options.baseBranch);
  }

  return {
    ok: true,
    point: { remote, baseBranch: options.baseBranch, baseSha: fetchedBaseSha, featureSha, rebased: true },
  };
}

export async function checkDirectPrBaseFreshness(
  options: CheckDirectPrBaseFreshnessOptions,
): Promise<DirectPrFreshnessCheckResult> {
  const { cwd, syncPoint } = options;
  const validationErr = await validateRemoteAndBranch(cwd, syncPoint.remote, syncPoint.baseBranch);
  if (validationErr) {
    return { kind: 'failed', remote: syncPoint.remote, baseBranch: syncPoint.baseBranch, reason: validationErr };
  }

  let fetchedBaseSha: string | undefined;
  try {
    fetchedBaseSha = await fetchBase(cwd, syncPoint.remote, syncPoint.baseBranch);
  } catch (err) {
    return {
      kind: 'failed',
      remote: syncPoint.remote,
      baseBranch: syncPoint.baseBranch,
      reason: `Direct PR freshness check failed to fetch '${syncPoint.remote}/${syncPoint.baseBranch}': ${(err as Error).message}`,
    };
  }

  if (!fetchedBaseSha) {
    return {
      kind: 'failed',
      remote: syncPoint.remote,
      baseBranch: syncPoint.baseBranch,
      reason: `Direct PR freshness check could not resolve FETCH_HEAD for '${syncPoint.remote}/${syncPoint.baseBranch}'`,
    };
  }

  if (fetchedBaseSha !== syncPoint.baseSha) {
    return {
      kind: 'base-advanced',
      remote: syncPoint.remote,
      baseBranch: syncPoint.baseBranch,
      validatedBaseSha: syncPoint.baseSha,
      fetchedBaseSha,
    };
  }

  return {
    kind: 'fresh',
    remote: syncPoint.remote,
    baseBranch: syncPoint.baseBranch,
    validatedBaseSha: syncPoint.baseSha,
    fetchedBaseSha,
  };
}

export function describeDirectPrBaseSyncPoint(point: DirectPrBaseSyncPoint): string {
  const action = point.rebased ? 'rebased' : 'already contained';
  return `Direct PR base sync ${action} '${point.remote}/${point.baseBranch}' at ${shortSha(point.baseSha)}; feature HEAD ${shortSha(point.featureSha)}`;
}
