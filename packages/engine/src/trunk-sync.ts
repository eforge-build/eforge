/**
 * Pre-compile trunk sync gate.
 *
 * Fetches remote trunk before compile and selects a reproducible base SHA when
 * the remote is ahead of the local trunk. The helper is non-mutating: it never
 * checks out, pulls, resets, or rebases local refs. Only FETCH_HEAD is updated.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { EforgeConfig } from './config.js';
import { resolveTrunkBranch } from './branch-policy.js';

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Exported types
// ---------------------------------------------------------------------------

/**
 * Outcome of a trunk sync operation.
 *
 * - `disabled`           — `build.trunkSync.enabled` is false; helper short-circuited.
 * - `skipped`            — Not applicable (child stacked PRD, non-trunk candidate, fetch unavailable, etc.).
 * - `remote-equal`       — Local and remote trunk are at the same commit; using fetched SHA.
 * - `remote-ahead`       — Remote trunk is ahead of local; using fetched SHA.
 * - `local-ahead`        — Local trunk is ahead of remote; using local trunk.
 * - `diverged-use-local` — Trunks diverged; `onDiverged: warn` applied; using local trunk.
 * - `diverged-use-remote`— Trunks diverged; `onDiverged: use-remote` applied; using fetched SHA.
 * - `failed`             — Configuration validation failed or `onDiverged: fail` triggered.
 */
export type TrunkSyncOutcome =
  | 'disabled'
  | 'skipped'
  | 'remote-equal'
  | 'remote-ahead'
  | 'local-ahead'
  | 'diverged-use-local'
  | 'diverged-use-remote'
  | 'failed';

/** Result returned by `prepareTrunkSyncBase`. */
export interface TrunkSyncResult {
  /** The selected base ref (branch name or fetched commit SHA). */
  baseRef: string;
  /** The resolved trunk branch name. */
  trunkBranch: string;
  /** The configured remote name. */
  remote: string;
  /** Local trunk commit SHA (when available). */
  localSha?: string;
  /** Fetched remote trunk commit SHA (when available). */
  remoteSha?: string;
  /** Outcome classification. */
  outcome: TrunkSyncOutcome;
  /**
   * Informational diagnostic messages. Callers should emit these as
   * `planning:progress` events.
   */
  diagnostics: string[];
  /**
   * Warning-level messages for divergence or fallback situations. Callers
   * should emit these as `config:warning` events.
   */
  warnings: string[];
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Validate the syntax of a git remote name.
 * Returns an error string when validation fails (i.e. the value is unsuitable
 * for use as a git remote name argument), or undefined on success.
 *
 * This is a fast, synchronous check. It rejects control characters, leading
 * dashes, URL-like values, and path-like values that `git fetch` would treat
 * as repository URLs/paths rather than remote names, which could cause
 * unexpected outbound fetches or credential leakage in diagnostics.
 */
export function validateRemoteName(name: string): string | undefined {
  if (!name || name.trim() === '') {
    return 'Remote name must not be empty';
  }
  if (name.startsWith('-')) {
    return `Remote name must not start with '-'`;
  }
  // Reject control characters and whitespace
  if (/[\x00-\x1f\x7f\s]/.test(name)) {
    return 'Remote name contains invalid characters (control characters or whitespace are not allowed)';
  }
  // Reject URL-like or path-like values that git fetch would treat as repo URLs/paths.
  // These are the main security concern: git accepts arbitrary URLs as the remote argument.
  if (
    name.includes('://')
    || /^[^/\s]+@[^/\s]+:/.test(name)
    || name.startsWith('/')
    || name.startsWith('./')
    || name.startsWith('../')
    || name.includes('\\')
  ) {
    return 'Remote name must be a registered remote name, not a URL or path';
  }
  return undefined;
}

/**
 * Check whether `name` is a registered git remote in the repository at `cwd`.
 * Returns false when the remote is not found or when `git remote` fails
 * (in which case the caller falls back gracefully, same as a fetch failure).
 */
export async function isRegisteredRemote(name: string, cwd: string): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync('git', ['remote'], { cwd });
    const remotes = stdout.split('\n').map((r) => r.trim()).filter(Boolean);
    return remotes.includes(name);
  } catch {
    // Cannot list remotes — treat as "unknown"; the subsequent fetch will also fail gracefully.
    return false;
  }
}

/** Validate a git branch name. Returns an error string or undefined. */
export async function validateBranchName(name: string, cwd: string): Promise<string | undefined> {
  if (!name || name.trim() === '') {
    return 'Branch name must not be empty';
  }
  if (name.startsWith('-')) {
    return `Branch name '${name}' must not start with '-'`;
  }
  // Reject control characters and whitespace
  if (/[\x00-\x1f\x7f\s]/.test(name)) {
    return `Branch name '${name}' contains invalid characters (control characters or whitespace are not allowed)`;
  }
  // Full git validation — git check-ref-format does not require a git repo
  try {
    await execFileAsync('git', ['check-ref-format', '--branch', name], { cwd });
  } catch {
    return `Branch name '${name}' is not a valid git branch refname`;
  }
  return undefined;
}

/** Resolve a ref to its commit SHA. Returns undefined when the ref does not exist. */
async function resolveCommitSha(cwd: string, ref: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', `${ref}^{commit}`], { cwd });
    const sha = stdout.trim();
    return sha || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Check whether `ancestor` is an ancestor of `descendant`.
 * Returns false on any error (ref not found, not a git repo, etc.).
 */
async function isAncestor(cwd: string, ancestor: string, descendant: string): Promise<boolean> {
  try {
    await execFileAsync('git', ['merge-base', '--is-ancestor', ancestor, descendant], { cwd });
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Main helper
// ---------------------------------------------------------------------------

/**
 * Prepare the compile base ref by checking remote trunk freshness.
 *
 * The helper is non-mutating with respect to local refs and the working tree:
 * it only runs `git fetch --no-tags <remote> <trunkBranch>` (which updates
 * FETCH_HEAD) and read-only git commands. It never runs checkout, pull,
 * reset, or rebase.
 *
 * @param options.cwd           - Repository root.
 * @param options.config        - Resolved engine config (needs `build.trunkSync`).
 * @param options.candidateBase - The base ref that compile() would use without intervention.
 * @param options.parentPrdId   - When present, signals a child stacked PRD; helper is skipped.
 */
export async function prepareTrunkSyncBase({
  cwd,
  config,
  candidateBase,
  parentPrdId,
}: {
  cwd: string;
  config: Pick<EforgeConfig, 'build'>;
  candidateBase: string;
  parentPrdId?: string;
}): Promise<TrunkSyncResult> {
  const trunkSyncConfig = config.build.trunkSync;
  const remote = trunkSyncConfig.remote;

  // 1. Short-circuit when disabled
  if (!trunkSyncConfig.enabled) {
    // Pass the configured remote so HEAD resolution uses refs/remotes/<remote>/HEAD
    const trunkBranch = await resolveTrunkBranch(config, cwd, remote);
    return {
      baseRef: candidateBase,
      trunkBranch,
      remote,
      outcome: 'disabled',
      diagnostics: [],
      warnings: [],
    };
  }

  // 2. Skip for child stacked PRDs — they use the parent artifact base
  if (parentPrdId !== undefined) {
    const trunkBranch = await resolveTrunkBranch(config, cwd, remote);
    return {
      baseRef: candidateBase,
      trunkBranch,
      remote,
      outcome: 'skipped',
      diagnostics: [
        `Trunk sync skipped: child stacked PRD (parent: ${parentPrdId}) uses parent artifact base '${candidateBase}'`,
      ],
      warnings: [],
    };
  }

  // 3. Resolve trunk branch against the configured remote so fork/upstream workflows
  // with a non-origin remote detect the correct default branch.
  const trunkBranch = await resolveTrunkBranch(config, cwd, remote);

  // 4. Skip when the candidate base is not the trunk branch
  if (candidateBase !== trunkBranch) {
    return {
      baseRef: candidateBase,
      trunkBranch,
      remote,
      outcome: 'skipped',
      diagnostics: [
        `Trunk sync skipped: candidate base '${candidateBase}' is not the trunk branch '${trunkBranch}'`,
      ],
      warnings: [],
    };
  }

  // 5. Validate remote name syntax (fast fail for URLs, paths, and obviously invalid values)
  const remoteErr = validateRemoteName(remote);
  if (remoteErr) {
    return {
      baseRef: candidateBase,
      trunkBranch,
      remote,
      outcome: 'failed',
      diagnostics: [],
      warnings: [remoteErr],
    };
  }

  // 5a. Check remote is registered in this repository.
  // If the remote name looks valid but isn't configured, fall back gracefully
  // (same treatment as a failed fetch) so offline/fork workflows with a different
  // remote name degrade gracefully rather than hard-failing.
  const remoteRegistered = await isRegisteredRemote(remote, cwd);
  if (!remoteRegistered) {
    const msg = `Trunk sync: '${remote}' is not a configured git remote; falling back to local trunk '${candidateBase}'`;
    return {
      baseRef: candidateBase,
      trunkBranch,
      remote,
      outcome: 'skipped',
      diagnostics: [msg],
      warnings: [],
    };
  }

  const branchErr = await validateBranchName(trunkBranch, cwd);
  if (branchErr) {
    return {
      baseRef: candidateBase,
      trunkBranch,
      remote,
      outcome: 'failed',
      diagnostics: [],
      warnings: [branchErr],
    };
  }

  // 6. Fetch remote trunk (non-mutating — only FETCH_HEAD is updated)
  // Run with GIT_TERMINAL_PROMPT=0 to suppress interactive credential prompts,
  // and a 30-second timeout to prevent slow/hostile remotes from hanging builds.
  let remoteSha: string | undefined;
  try {
    await execFileAsync('git', ['fetch', '--no-tags', '--no-recurse-submodules', remote, trunkBranch], {
      cwd,
      timeout: 30_000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
    remoteSha = await resolveCommitSha(cwd, 'FETCH_HEAD');
  } catch {
    // Remote or branch unavailable — fall back to local trunk regardless of policy.
    // (onDiverged applies to true divergence, not network failures.)
    const msg = `Trunk sync: fetch of '${remote}/${trunkBranch}' failed; falling back to local trunk '${candidateBase}'`;
    return {
      baseRef: candidateBase,
      trunkBranch,
      remote,
      outcome: 'skipped',
      diagnostics: [msg],
      warnings: [],
    };
  }

  if (!remoteSha) {
    const msg = `Trunk sync: could not resolve FETCH_HEAD after fetching '${remote}/${trunkBranch}'; falling back to local trunk '${candidateBase}'`;
    return {
      baseRef: candidateBase,
      trunkBranch,
      remote,
      outcome: 'skipped',
      diagnostics: [msg],
      warnings: [],
    };
  }

  // 7. Resolve local trunk SHA
  const localSha = await resolveCommitSha(cwd, trunkBranch);

  // Local trunk not found — use fetched SHA
  if (!localSha) {
    return {
      baseRef: remoteSha,
      trunkBranch,
      remote,
      remoteSha,
      outcome: 'remote-ahead',
      diagnostics: [
        `Trunk sync: local '${trunkBranch}' not found locally; using fetched SHA ${remoteSha.slice(0, 12)}`,
      ],
      warnings: [],
    };
  }

  // 8. Compare local and remote SHAs
  if (localSha === remoteSha) {
    // Equal: use fetched SHA for reproducibility
    return {
      baseRef: remoteSha,
      trunkBranch,
      remote,
      localSha,
      remoteSha,
      outcome: 'remote-equal',
      diagnostics: [
        `Trunk sync: local and remote '${trunkBranch}' are equal at ${remoteSha.slice(0, 12)}; using fetched SHA`,
      ],
      warnings: [],
    };
  }

  // Check: is local an ancestor of remote? (remote is ahead)
  const localIsAncestorOfRemote = await isAncestor(cwd, localSha, remoteSha);
  if (localIsAncestorOfRemote) {
    return {
      baseRef: remoteSha,
      trunkBranch,
      remote,
      localSha,
      remoteSha,
      outcome: 'remote-ahead',
      diagnostics: [
        `Trunk sync: remote '${remote}/${trunkBranch}' is ahead of local; using fetched SHA ${remoteSha.slice(0, 12)}`,
      ],
      warnings: [],
    };
  }

  // Check: is remote an ancestor of local? (local is ahead)
  const remoteIsAncestorOfLocal = await isAncestor(cwd, remoteSha, localSha);
  if (remoteIsAncestorOfLocal) {
    return {
      baseRef: candidateBase,
      trunkBranch,
      remote,
      localSha,
      remoteSha,
      outcome: 'local-ahead',
      diagnostics: [
        `Trunk sync: local '${trunkBranch}' is ahead of remote; using local trunk`,
      ],
      warnings: [
        `Trunk sync: local '${trunkBranch}' (${localSha.slice(0, 12)}) is ahead of '${remote}/${trunkBranch}' (${remoteSha.slice(0, 12)}); this may indicate unpushed local commits`,
      ],
    };
  }

  // True divergence: neither is an ancestor of the other
  const policy = trunkSyncConfig.onDiverged;

  if (policy === 'fail') {
    return {
      baseRef: candidateBase,
      trunkBranch,
      remote,
      localSha,
      remoteSha,
      outcome: 'failed',
      diagnostics: [],
      warnings: [
        `Trunk sync: local '${trunkBranch}' (${localSha.slice(0, 12)}) has diverged from '${remote}/${trunkBranch}' (${remoteSha.slice(0, 12)}); failing build as configured by build.trunkSync.onDiverged: fail`,
      ],
    };
  }

  if (policy === 'use-remote') {
    return {
      baseRef: remoteSha,
      trunkBranch,
      remote,
      localSha,
      remoteSha,
      outcome: 'diverged-use-remote',
      diagnostics: [
        `Trunk sync: diverged trunks — using fetched remote SHA ${remoteSha.slice(0, 12)} as configured by build.trunkSync.onDiverged: use-remote`,
      ],
      warnings: [
        `Trunk sync: local '${trunkBranch}' (${localSha.slice(0, 12)}) and '${remote}/${trunkBranch}' (${remoteSha.slice(0, 12)}) have diverged; using remote SHA`,
      ],
    };
  }

  // Default: warn — emit diagnostic, fall back to local trunk
  return {
    baseRef: candidateBase,
    trunkBranch,
    remote,
    localSha,
    remoteSha,
    outcome: 'diverged-use-local',
    diagnostics: [
      `Trunk sync: diverged trunks — using local '${trunkBranch}' as configured by build.trunkSync.onDiverged: warn`,
    ],
    warnings: [
      `Trunk sync: local '${trunkBranch}' (${localSha.slice(0, 12)}) and '${remote}/${trunkBranch}' (${remoteSha.slice(0, 12)}) have diverged; falling back to local trunk`,
    ],
  };
}
