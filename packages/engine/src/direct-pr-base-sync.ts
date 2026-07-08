/**
 * Direct non-stacked PR base synchronization.
 *
 * Fetches origin/<baseBranch>, rebases the engine-owned artifact branch onto
 * the fetched base before validation, and provides the final pre-PR freshness
 * check used immediately before publishing direct PRs.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type { BaseSyncEvent, EforgeEvent } from '@eforge-build/client';
import type { MergeConflictInfo, MergeResolver } from './worktree-ops.js';
import { isRegisteredRemote, validateBranchName, validateRemoteName } from './trunk-sync.js';

const exec = promisify(execFile);

export const DIRECT_PR_REMOTE = 'origin';
export const DEFAULT_DIRECT_PR_REBASE_CONFLICT_ATTEMPTS = 12;
export const MIN_DIRECT_PR_REBASE_CONFLICT_ATTEMPTS = 1;
export const MAX_DIRECT_PR_REBASE_CONFLICT_ATTEMPTS = 100;
export const DEFAULT_DIRECT_PR_FRESHNESS_RETRIES = 2;

export function resolveDirectPrBaseSyncConflictAttempts(
  configValue?: number,
  overrideValue?: number,
): number {
  const selected = overrideValue ?? configValue ?? DEFAULT_DIRECT_PR_REBASE_CONFLICT_ATTEMPTS;
  if (!Number.isFinite(selected) || !Number.isInteger(selected)) {
    throw new RangeError('landing.directPrBaseSync.conflictAttempts must be a finite integer (legacy compile.directPrBaseSyncConflictAttempts is used only when the landing key is unset)');
  }
  return Math.max(
    MIN_DIRECT_PR_REBASE_CONFLICT_ATTEMPTS,
    Math.min(selected, MAX_DIRECT_PR_REBASE_CONFLICT_ATTEMPTS),
  );
}

export interface DirectPrBaseSyncPoint {
  remote: string;
  baseBranch: string;
  baseSha: string;
  featureSha: string;
  rebased: boolean;
}

export type DirectPrBaseSyncFailureReason =
  | 'invalid-conflict-attempts'
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

type EventInput<T extends { timestamp: string }> = T extends unknown ? Omit<T, 'timestamp'> : never;

export interface SyncDirectPrBaseOptions {
  cwd: string;
  featureBranch: string;
  baseBranch: string;
  remote?: string;
  mergeResolver?: MergeResolver;
  conflictAttempts?: number;
  onEvent?: (event: EforgeEvent) => void;
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

function emitBaseSyncEvent(
  onEvent: SyncDirectPrBaseOptions['onEvent'] | undefined,
  event: EventInput<BaseSyncEvent>,
): void {
  onEvent?.({ ...event, timestamp: new Date().toISOString() } as EforgeEvent);
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
  remote,
  onEvent,
}: {
  cwd: string;
  featureBranch: string;
  baseBranch: string;
  mergeResolver?: MergeResolver;
  maxAttempts: number;
  remote: string;
  onEvent?: SyncDirectPrBaseOptions['onEvent'];
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
      emitBaseSyncEvent(onEvent, { type: 'base-sync:budget:exhausted', remote, baseBranch, featureBranch, attempts, maxAttempts, conflictedFiles });
      return {
        ok: false,
        reason: 'conflict-attempts-exhausted',
        message: `Direct PR base sync exhausted ${maxAttempts} conflict-resolution attempt(s) for '${baseBranch}'. Raise landing.directPrBaseSync.conflictAttempts (or legacy compile.directPrBaseSyncConflictAttempts when the landing key is unset) or complete the rebase manually.`,
      };
    }

    attempts += 1;
    emitBaseSyncEvent(onEvent, { type: 'base-sync:conflict:attempt', remote, baseBranch, featureBranch, attempt: attempts, maxAttempts, conflictedFiles });
    const conflict: MergeConflictInfo = {
      branch: featureBranch,
      baseBranch,
      conflictedFiles,
      conflictDiff: await getConflictDiff(cwd),
    };

    emitBaseSyncEvent(onEvent, { type: 'base-sync:resolver:start', remote, baseBranch, featureBranch, attempt: attempts, maxAttempts });
    const resolved = await mergeResolver(cwd, conflict).catch(() => false);
    if (!resolved) {
      emitBaseSyncEvent(onEvent, { type: 'base-sync:resolver:complete', remote, baseBranch, featureBranch, attempt: attempts, maxAttempts, resolved: false, remainingConflicts: conflictedFiles.length });
      return {
        ok: false,
        reason: 'conflict-resolution-failed',
        message: `Direct PR base sync conflict resolver failed for '${baseBranch}'`,
      };
    }

    const remaining = await getUnmergedPaths(cwd);
    emitBaseSyncEvent(onEvent, { type: 'base-sync:resolver:complete', remote, baseBranch, featureBranch, attempt: attempts, maxAttempts, resolved: remaining.length === 0, remainingConflicts: remaining.length });
    if (remaining.length > 0) {
      return {
        ok: false,
        reason: 'conflicts-remain',
        message: `Direct PR base sync conflict resolver left ${remaining.length} unmerged file(s) for '${baseBranch}'`,
      };
    }

    try {
      emitBaseSyncEvent(onEvent, { type: 'base-sync:rebase:continue', remote, baseBranch, featureBranch, attempt: attempts, maxAttempts });
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
  let maxAttempts: number;
  try {
    maxAttempts = resolveDirectPrBaseSyncConflictAttempts(undefined, options.conflictAttempts);
  } catch (err) {
    return failure(
      'invalid-conflict-attempts',
      `Invalid direct PR base sync conflict attempt budget: ${(err as Error).message}`,
      remote,
      options.baseBranch,
    );
  }

  const validationErr = await validateRemoteAndBranch(options.cwd, remote, options.baseBranch);
  if (validationErr) {
    const remoteNameErr = validateRemoteName(remote);
    const reason = remoteNameErr || validationErr.startsWith('Remote ') ? 'invalid-remote' : 'invalid-branch';
    return failure(reason, validationErr, remote, options.baseBranch);
  }
  const featureBranchErr = await validateBranchName(options.featureBranch, options.cwd);
  if (featureBranchErr) {
    return failure('invalid-branch', featureBranchErr, remote, options.baseBranch);
  }

  emitBaseSyncEvent(options.onEvent, { type: 'base-sync:start', remote, baseBranch: options.baseBranch, featureBranch: options.featureBranch, maxAttempts });

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
    emitBaseSyncEvent(options.onEvent, { type: 'base-sync:success', remote, baseBranch: options.baseBranch, featureBranch: options.featureBranch, baseSha: fetchedBaseSha, featureSha: headSha, rebased: false });
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
      remote,
      onEvent: options.onEvent,
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

  emitBaseSyncEvent(options.onEvent, { type: 'base-sync:success', remote, baseBranch: options.baseBranch, featureBranch: options.featureBranch, baseSha: fetchedBaseSha, featureSha, rebased: true });
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
