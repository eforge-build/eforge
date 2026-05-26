/**
 * Engine-level stack sync helper.
 *
 * Orchestrates a git-spice repo sync + restack cycle for non-active-build
 * branches. Callers (daemon route) collect active-build exclusions and pass
 * them in; the helper filters restack candidates from the stack state and
 * either dry-runs or executes the provider commands.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { EforgeConfig } from '../config.js';
import { resolveTrunkBranch } from '../branch-policy.js';
import { createProvider } from './provider.js';
import { loadStackState } from './state.js';
import type { ProviderCommandResult } from './provider.js';
import { redactProviderMessage } from './git-spice.js';

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Exported types
// ---------------------------------------------------------------------------

/** A single provider command recorded in a sync report. */
export interface StackSyncProviderCommand {
  /** The resolved executable path (e.g. '/usr/local/bin/git-spice'). */
  command: string;
  /** The argv passed to the command (without the executable). */
  args: string[];
  /** True when the command was not executed (dry-run mode). */
  dryRun: boolean;
  /** True when the command was actually executed. Always false in dry-run mode. */
  ran: boolean;
  /** Captured stdout from the command (absent in dry-run). */
  stdout?: string;
  /** Captured stderr from the command (absent in dry-run). */
  stderr?: string;
  /** Exit code. Always 0 on success; absent in dry-run mode. */
  exitCode?: number;
}

/** Outcome of a stack sync operation. */
export type StackSyncOutcome = 'skipped' | 'complete' | 'failed' | 'conflict';

/** Report returned by `performStackSync`. */
export interface StackSyncReport {
  /** Overall outcome. */
  outcome: StackSyncOutcome;
  /** Human-readable reason (always present for 'skipped', 'failed', 'conflict'). */
  reason?: string;
  /** True when stacking is active (always true for non-skipped outcomes). */
  stackingActive: boolean;
  /** Whether the sync was a dry run. */
  dryRun: boolean;
  /** SHA of the local trunk branch, when available. */
  localTrunkSha?: string;
  /** SHA of origin/<trunk>, when available. */
  originTrunkSha?: string;
  /** Whether the local trunk is already at or behind origin (fast-forward eligible). */
  fastForward?: boolean;
  /** Artifact branches eligible for restack (after exclusion filtering). */
  restackCandidates: string[];
  /** Artifact branches that were excluded from restack because they matched an active-build prefix. */
  excludedCandidates: string[];
  /** Provider commands that were executed or would be executed in dry-run. */
  providerCommands: StackSyncProviderCommand[];
  /** Error message when outcome is 'failed' or 'conflict'. */
  error?: string;
}

/** Options for `performStackSync`. */
export interface StackSyncOptions {
  /** Project working directory. */
  cwd: string;
  /** When true, build the command list without executing any git-spice commands. */
  dryRun?: boolean;
  /**
   * Branch name prefixes to exclude from restack candidates.
   * A layer's artifact branch is excluded when it equals or starts with
   * `<prefix>/` for any entry in this list.
   */
  excludedBranchPrefixes?: string[];
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function getGitSha(cwd: string, ref: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', ref], { cwd });
    return stdout.trim() || undefined;
  } catch {
    return undefined;
  }
}

async function isAncestor(
  cwd: string,
  potentialAncestor: string,
  descendant: string,
): Promise<boolean> {
  try {
    await execFileAsync(
      'git',
      ['merge-base', '--is-ancestor', potentialAncestor, descendant],
      { cwd },
    );
    return true;
  } catch {
    return false;
  }
}

function buildCommandRecord(
  result: ProviderCommandResult,
  dryRun: boolean,
): StackSyncProviderCommand {
  return {
    command: result.command,
    args: result.args,
    dryRun,
    ran: !dryRun,
    ...(result.stdout !== undefined && { stdout: redactProviderMessage(result.stdout) }),
    ...(result.stderr !== undefined && { stderr: redactProviderMessage(result.stderr) }),
    exitCode: result.exitCode,
  };
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Perform (or dry-run) a git-spice stack sync cycle.
 *
 * Flow:
 *   1. Resolve the trunk branch and fetch local/origin SHAs for fast-forward detection.
 *   2. Load the stack state; collect artifact branches as restack candidates.
 *   3. Filter out branches matching any `excludedBranchPrefixes` entry.
 *   4. Build the provider command list: `repo sync` + `stack restack` when candidates exist.
 *   5. In dry-run mode return the command list with `ran: false` without executing anything.
 *   6. In wet mode execute the commands and record results; map provider errors to
 *      `failed` or `conflict` outcomes.
 *
 * The caller (daemon route) is responsible for:
 *   - Checking `config.stacking.enabled` and short-circuiting before this call.
 *   - Deriving `activeBuildSkips` from running DB runs and merging them into the
 *     HTTP response alongside this report.
 */
export async function performStackSync(
  config: EforgeConfig,
  opts: StackSyncOptions,
): Promise<StackSyncReport> {
  const { cwd, dryRun = false, excludedBranchPrefixes = [] } = opts;
  const providerCommands: StackSyncProviderCommand[] = [];

  // Resolve trunk branch and get SHAs for fast-forward reporting
  const trunk = await resolveTrunkBranch(config, cwd);
  const localTrunkSha = await getGitSha(cwd, trunk);
  const originTrunkSha = await getGitSha(cwd, `origin/${trunk}`);
  let fastForward: boolean | undefined;
  if (localTrunkSha !== undefined && originTrunkSha !== undefined) {
    if (localTrunkSha === originTrunkSha) {
      fastForward = true;
    } else {
      fastForward = await isAncestor(cwd, localTrunkSha, originTrunkSha);
    }
  }

  // Load stack state and build restack candidates
  const state = await loadStackState(cwd);
  const allCandidates = state.layers
    .filter((layer) => layer.artifact?.branch !== undefined)
    .map((layer) => layer.artifact!.branch);

  // Filter out active-build exclusions
  const restackCandidates = allCandidates.filter(
    (branch) =>
      !excludedBranchPrefixes.some(
        (prefix) => branch === prefix || branch.startsWith(`${prefix}/`),
      ),
  );
  const excludedCandidates = allCandidates.filter(
    (branch) =>
      excludedBranchPrefixes.some(
        (prefix) => branch === prefix || branch.startsWith(`${prefix}/`),
      ),
  );

  // Determine the provider command name (for dry-run records)
  const gsCommand = config.stacking.gitSpice?.command ?? 'git-spice';
  const provider = createProvider(config.stacking);

  // Compute exclusion state up-front so dry-run and wet-run use the same logic.
  const hasExcludedCandidates = allCandidates.length > restackCandidates.length;
  // Restack only runs when there are candidates AND none were excluded (same condition as wet run).
  const wouldRestack = restackCandidates.length > 0 && !hasExcludedCandidates;
  const restackSkippedReason =
    hasExcludedCandidates && restackCandidates.length > 0
      ? 'stack restack skipped: active-build branches overlap the stack; restack cannot be scoped to exclude them'
      : undefined;

  // Build the command list
  const syncRepoDryRecord: StackSyncProviderCommand = {
    command: gsCommand,
    args: ['repo', 'sync'],
    dryRun: true,
    ran: false,
  };
  const restackDryRecord: StackSyncProviderCommand | undefined =
    wouldRestack
      ? {
          command: gsCommand,
          args: ['stack', 'restack'],
          dryRun: true,
          ran: false,
        }
      : undefined;

  if (dryRun) {
    providerCommands.push(syncRepoDryRecord);
    if (restackDryRecord) providerCommands.push(restackDryRecord);
    return {
      outcome: 'complete',
      ...(restackSkippedReason !== undefined && { reason: restackSkippedReason }),
      stackingActive: true,
      dryRun: true,
      localTrunkSha,
      originTrunkSha,
      fastForward,
      restackCandidates,
      excludedCandidates,
      providerCommands,
    };
  }

  // Wet run: execute repo sync
  try {
    const syncResult = await provider.syncRepo(cwd);
    providerCommands.push(buildCommandRecord(syncResult, false));
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    providerCommands.push({
      command: gsCommand,
      args: ['repo', 'sync'],
      dryRun: false,
      ran: true,
      stderr: errorMsg,
      exitCode: 1,
    });
    return {
      outcome: 'failed',
      reason: `repo sync failed: ${errorMsg}`,
      stackingActive: true,
      dryRun: false,
      localTrunkSha,
      originTrunkSha,
      fastForward,
      restackCandidates,
      excludedCandidates,
      providerCommands,
      error: errorMsg,
    };
  }

  // Recompute trunk SHAs and fast-forward status post-sync to reflect actual repo state
  const postSyncLocalTrunkSha = await getGitSha(cwd, trunk);
  const postSyncOriginTrunkSha = await getGitSha(cwd, `origin/${trunk}`);
  let postSyncFastForward: boolean | undefined;
  if (postSyncLocalTrunkSha !== undefined && postSyncOriginTrunkSha !== undefined) {
    if (postSyncLocalTrunkSha === postSyncOriginTrunkSha) {
      postSyncFastForward = true;
    } else {
      postSyncFastForward = await isAncestor(cwd, postSyncLocalTrunkSha, postSyncOriginTrunkSha);
    }
  }

  // Wet run: execute stack restack (when candidates exist and no active-build branches
  // overlap the stack — global restack cannot be scoped to specific branches, so we must
  // skip it entirely when any candidate was excluded to avoid mutating active-build worktrees)
  if (wouldRestack) {
    try {
      const restackResult = await provider.restackStack(cwd);
      providerCommands.push(buildCommandRecord(restackResult, false));
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      const isConflict = /conflict/i.test(errorMsg);
      providerCommands.push({
        command: gsCommand,
        args: ['stack', 'restack'],
        dryRun: false,
        ran: true,
        stderr: errorMsg,
        exitCode: 1,
      });
      return {
        outcome: isConflict ? 'conflict' : 'failed',
        reason: `stack restack failed: ${errorMsg}`,
        stackingActive: true,
        dryRun: false,
        localTrunkSha: postSyncLocalTrunkSha,
        originTrunkSha: postSyncOriginTrunkSha,
        fastForward: postSyncFastForward,
        restackCandidates,
        excludedCandidates,
        providerCommands,
        error: errorMsg,
      };
    }
  }

  return {
    outcome: 'complete',
    ...(restackSkippedReason !== undefined && { reason: restackSkippedReason }),
    stackingActive: true,
    dryRun: false,
    localTrunkSha: postSyncLocalTrunkSha,
    originTrunkSha: postSyncOriginTrunkSha,
    fastForward: postSyncFastForward,
    restackCandidates,
    excludedCandidates,
    providerCommands,
  };
}
