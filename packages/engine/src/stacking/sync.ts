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
// --- eforge:region plan-01-core-daemon-stack-sync ---
import type { StackSyncTrigger, StackSyncActiveBuildPolicy } from './sync-state.js';
// --- eforge:endregion plan-01-core-daemon-stack-sync ---

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
export type StackSyncOutcome = 'skipped' | 'complete' | 'failed' | 'conflict' | 'deferred';

/** Report returned by `performStackSync`. */
export interface StackSyncReport {
  /** Overall outcome. */
  outcome: StackSyncOutcome;
  /** Human-readable reason (always present for 'skipped', 'failed', 'conflict', 'deferred'). */
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
  // --- eforge:region plan-01-core-daemon-stack-sync ---
  /** The trigger that initiated this sync, when set by the caller. */
  trigger?: StackSyncTrigger;
  /** The active-build policy used, when set by the caller. */
  activeBuildPolicy?: StackSyncActiveBuildPolicy;
  // --- eforge:endregion plan-01-core-daemon-stack-sync ---
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
  // --- eforge:region plan-01-core-daemon-stack-sync ---
  /** The trigger that initiated this sync (propagated to the report). */
  trigger?: StackSyncTrigger;
  /**
   * How to handle active-build overlap in wet mode.
   *
   * 'skip' (default) — return 'skipped' outcome when excluded candidates exist.
   * 'defer'          — return 'deferred' outcome instead, indicating the sync
   *                    should be retried when active builds complete.
   *
   * Dry-runs always use 'skip' semantics since they do not execute commands.
   */
  activeBuildPolicy?: StackSyncActiveBuildPolicy;
  // --- eforge:endregion plan-01-core-daemon-stack-sync ---
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
  redact: (message: string) => string,
): StackSyncProviderCommand {
  return {
    command: result.command,
    args: result.args,
    dryRun,
    ran: !dryRun,
    ...(result.stdout !== undefined && { stdout: redact(result.stdout) }),
    ...(result.stderr !== undefined && { stderr: redact(result.stderr) }),
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
  // --- eforge:region plan-01-core-daemon-stack-sync ---
  const { cwd, dryRun = false, excludedBranchPrefixes = [], trigger, activeBuildPolicy = 'skip' } = opts;
  // --- eforge:endregion plan-01-core-daemon-stack-sync ---
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

  // --- eforge:region plan-01-core-daemon-stack-sync ---
  // Use provider for command previews (no hard-coded argv outside the adapter)
  const provider = createProvider(config.stacking);
  const syncRepoPreview = provider.commandPreview(['repo', 'sync']);
  const restackStackPreview = provider.commandPreview(['stack', 'restack']);
  // --- eforge:endregion plan-01-core-daemon-stack-sync ---

  // Compute exclusion state up-front so dry-run and wet-run use the same logic.
  const hasExcludedCandidates = allCandidates.length > restackCandidates.length;
  // Restack only runs when there are candidates AND none were excluded (same condition as wet run).
  const wouldRestack = restackCandidates.length > 0 && !hasExcludedCandidates;
  const restackSkippedReason =
    hasExcludedCandidates && restackCandidates.length > 0
      ? 'stack restack skipped: active-build branches overlap the stack; restack cannot be scoped to exclude them'
      : undefined;

  // --- eforge:region plan-01-core-daemon-stack-sync ---
  // Common metadata fields to spread into every return value.
  const metaFields = {
    ...(trigger !== undefined && { trigger }),
    ...(activeBuildPolicy !== 'skip' && { activeBuildPolicy }),
  };
  // --- eforge:endregion plan-01-core-daemon-stack-sync ---

  // Build the command list
  const syncRepoDryRecord: StackSyncProviderCommand = {
    command: syncRepoPreview.command,
    args: syncRepoPreview.args,
    dryRun: true,
    ran: false,
  };
  const restackDryRecord: StackSyncProviderCommand | undefined =
    wouldRestack
      ? {
          command: restackStackPreview.command,
          args: restackStackPreview.args,
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
      ...metaFields,
    };
  }

  // --- eforge:region plan-01-core-daemon-stack-sync ---
  // Wet sync: short-circuit before any provider mutation when active-build
  // branches overlap the stack candidates.
  if (hasExcludedCandidates) {
    if (activeBuildPolicy === 'defer') {
      return {
        outcome: 'deferred',
        reason: 'stack sync deferred: active builds overlap the stack; retry when builds complete',
        stackingActive: true,
        dryRun: false,
        localTrunkSha,
        originTrunkSha,
        fastForward,
        restackCandidates,
        excludedCandidates,
        providerCommands: [],
        ...metaFields,
      };
    } else {
      // activeBuildPolicy === 'skip' (default): skip the sync entirely rather
      // than executing repo sync which could mutate stack branches mid-build.
      return {
        outcome: 'skipped',
        reason: 'stack sync skipped: active builds overlap the stack; skipping to avoid mutation during build',
        stackingActive: true,
        dryRun: false,
        localTrunkSha,
        originTrunkSha,
        fastForward,
        restackCandidates,
        excludedCandidates,
        providerCommands: [],
        ...metaFields,
      };
    }
  }
  // --- eforge:endregion plan-01-core-daemon-stack-sync ---

  // Wet run: execute repo sync
  try {
    const syncResult = await provider.syncRepo(cwd);
    providerCommands.push(buildCommandRecord(syncResult, false, provider.redactMessage.bind(provider)));
  } catch (err) {
    const errorMsg = provider.redactMessage(err instanceof Error ? err.message : String(err));
    const failedPreview = provider.commandPreview(['repo', 'sync']);
    providerCommands.push({
      command: failedPreview.command,
      args: failedPreview.args,
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
      ...metaFields,
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
      providerCommands.push(buildCommandRecord(restackResult, false, provider.redactMessage.bind(provider)));
    } catch (err) {
      const errorMsg = provider.redactMessage(err instanceof Error ? err.message : String(err));
      const isConflict = /conflict/i.test(errorMsg);
      const failedPreview = provider.commandPreview(['stack', 'restack']);
      providerCommands.push({
        command: failedPreview.command,
        args: failedPreview.args,
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
        ...metaFields,
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
    ...metaFields,
  };
}
