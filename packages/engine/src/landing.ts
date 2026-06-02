/**
 * Landing actions — parameterised post-build branch disposition.
 *
 * `executeLandingAction` is an async generator that:
 *   - Emits `landing:start`, then performs the chosen action, then emits
 *     `landing:complete` or `landing:skipped`.
 *   - For `merge`: additionally emits `merge:finalize:*` events for backward
 *     compatibility with existing consumers.
 *   - For `pr`: pushes the feature branch and creates a PR via `gh`.
 *   - For `leave`: a no-op — the branch is preserved as-is.
 *
 * The generator returns a `LandingResult` capturing whether landing
 * succeeded and optional metadata (PR URL, commit SHA).
 *
 * Branch-aware workflow classification:
 *   - `trunk-pr`: pr when baseBranch is trunk
 *   - `trunk-local-merge`: merge when baseBranch is trunk + opt-in
 *   - `feature-pr`: pr when baseBranch is non-trunk feature branch (direct PR: featureBranch → baseBranch)
 *   - `feature-local-merge`: merge when baseBranch is non-trunk feature branch
 *   - `leave-branch`: no landing action
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type { EforgeEvent, EforgeState, OrchestrationConfig } from './events.js';
import { PullRequestFreshnessError, type PullRequestFreshnessGuard, type WorktreeManager } from './worktree-manager.js';
import type { MergeResolver } from './worktree-ops.js';
import type { ModelTracker } from './model-tracker.js';
import { composeCommitMessage, buildProvenanceTrailers } from './model-tracker.js';
import { cleanupPlanFiles } from './cleanup.js';
import { renderPullRequestMetadata } from './pr-metadata.js';
import { collectBuildArtifactProvenance, type BuildArtifactProvenanceRef } from './provenance.js';
import { resolveTrunkBranch, isTrunkBranch } from './branch-policy.js';
import type { EforgeConfig } from './config.js';
import { resolvePrAutoMergeIntent } from './config.js';

const exec = promisify(execFile);

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type LandingAction = 'pr' | 'merge' | 'leave';

/**
 * Classified workflow derived from the action + trunk policy.
 */
export type LandingWorkflow =
  | 'trunk-pr'
  | 'trunk-local-merge'
  | 'feature-pr'
  | 'feature-local-merge'
  | 'leave-branch';

export interface LandingActionOptions {
  action: LandingAction;
  featureBranch: string;
  baseBranch: string;
  repoRoot: string;
  mergeWorktreePath: string;
  worktreeManager: WorktreeManager;
  mergeResolver?: MergeResolver;
  modelTracker: ModelTracker;
  /** Commit message used for merge action (pre-composed, used as fallback). */
  commitMessage: string;
  /**
   * Raw commit body (before trailer composition) for the merge action.
   * When provided, landing recomposes the commit message with provenance trailers
   * after cleanup/provenance collection. Falls back to `commitMessage` when absent.
   */
  rawCommitBody?: string;
  signal?: AbortSignal;
  shouldCleanup?: boolean;
  cleanupPlanSet?: string;
  cleanupOutputDir?: string;
  cleanupPrdFilePath?: string;
  state: EforgeState;
  config: OrchestrationConfig;
  /** EforgeConfig subset for trunk policy resolution. When omitted, trunk defaults to "main". */
  engineConfig?: Pick<EforgeConfig, 'build'>;
  /** Configured PR auto-merge policy (from landing.pr.autoMerge). Defaults to 'ask'. */
  prAutoMergePolicy?: 'ask' | 'always' | 'never';
  /** Per-run PR auto-merge intent (from landingAutoMerge build option / PRD frontmatter). */
  landingAutoMerge?: boolean;
  // --- eforge:region plan-01-direct-pr-base-sync ---
  /** Direct PR freshness guard before pushing the artifact branch. */
  beforePushFreshnessGuard?: PullRequestFreshnessGuard;
  /** Direct PR freshness guard immediately before PR creation / existing-PR fallback. */
  beforeCreateFreshnessGuard?: PullRequestFreshnessGuard;
  /** Use force-with-lease for direct PR artifact branch publication. */
  forceWithLease?: boolean;
  // --- eforge:endregion plan-01-direct-pr-base-sync ---
}

// --- eforge:region plan-01-direct-pr-base-sync ---
export interface LandingFreshnessRetry {
  reason: string;
  fetchedBaseSha?: string;
}
// --- eforge:endregion plan-01-direct-pr-base-sync ---

export interface LandingResult {
  landingSucceeded: boolean;
  prUrl?: string;
  commitSha?: string;
  // --- eforge:region plan-01-direct-pr-base-sync ---
  freshnessRetry?: LandingFreshnessRetry;
  // --- eforge:endregion plan-01-direct-pr-base-sync ---
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Run cleanup on the feature branch in the merge worktree.
 * Non-fatal: emits a progress event on failure and continues.
 *
 * Exported for reuse by stacked PR landing (plan-03-stack-landing-lifecycle-cleanup).
 */
export async function* runCleanup(
  mergeWorktreePath: string,
  featureBranch: string,
  cleanupPlanSet: string,
  cleanupOutputDir: string,
  cleanupPrdFilePath: string | undefined,
  ts: () => string,
): AsyncGenerator<EforgeEvent> {
  try {
    await exec('git', ['checkout', featureBranch], { cwd: mergeWorktreePath });
    for await (const event of cleanupPlanFiles(
      mergeWorktreePath,
      cleanupPlanSet,
      cleanupOutputDir,
      cleanupPrdFilePath,
    )) {
      yield event;
    }
  } catch (cleanupErr) {
    yield {
      type: 'planning:progress' as const,
      message: `Feature branch cleanup failed (non-fatal): ${(cleanupErr as Error).message}`,
      timestamp: ts(),
    } as EforgeEvent;
  }
}

/**
 * Dirty-tree detection and auto-recovery on repoRoot.
 * Returns after recovery or throws when cleanup cannot complete.
 */
async function* recoverDirtyTree(
  repoRoot: string,
  ts: () => string,
): AsyncGenerator<EforgeEvent> {
  const { stdout: statusOut } = await exec('git', ['status', '--porcelain'], { cwd: repoRoot });
  const dirtyFiles = statusOut.trim().split('\n').filter(Boolean);
  if (dirtyFiles.length === 0) return;

  const preview = dirtyFiles.slice(0, 10).join('\n');
  const suffix = dirtyFiles.length > 10 ? `\n... and ${dirtyFiles.length - 10} more` : '';
  yield {
    type: 'planning:progress' as const,
    message: `Dirty working tree detected in repoRoot (${dirtyFiles.length} files). Attempting auto-recovery.\n${preview}${suffix}`,
    timestamp: ts(),
  } as EforgeEvent;

  await exec('git', ['checkout', '--', '.'], { cwd: repoRoot });
  await exec('git', ['clean', '-fd'], { cwd: repoRoot });

  const { stdout: statusAfter } = await exec('git', ['status', '--porcelain'], { cwd: repoRoot });
  const remainingFiles = statusAfter.trim().split('\n').filter(Boolean);
  if (remainingFiles.length > 0) {
    const remainingPreview = remainingFiles.slice(0, 10).join('\n');
    throw new Error(
      `Failed to clean dirty working tree in repoRoot. Remaining files (${remainingFiles.length}):\n${remainingPreview}`,
    );
  }

  yield {
    type: 'planning:progress' as const,
    message: 'Dirty working tree auto-recovery succeeded.',
    timestamp: ts(),
  } as EforgeEvent;
}

// ---------------------------------------------------------------------------
// executeLandingAction
// ---------------------------------------------------------------------------

/**
 * Execute the configured landing action and emit the corresponding events.
 *
 * Returns a `LandingResult` as the generator's return value. Callers should
 * consume the generator manually (not via `yield*`) to capture the result:
 *
 * ```ts
 * const gen = executeLandingAction(opts);
 * let result: LandingResult = { landingSucceeded: false };
 * while (true) {
 *   const { value, done } = await gen.next();
 *   if (done) { result = value; break; }
 *   yield value;
 * }
 * ```
 */
export async function* executeLandingAction(
  opts: LandingActionOptions,
): AsyncGenerator<EforgeEvent, LandingResult> {
  const {
    action,
    featureBranch,
    baseBranch,
    repoRoot,
    mergeWorktreePath,
    worktreeManager,
    mergeResolver,
    commitMessage,
    rawCommitBody,
    shouldCleanup,
    cleanupPlanSet,
    cleanupOutputDir,
    cleanupPrdFilePath,
    prAutoMergePolicy = 'ask',
    landingAutoMerge,
    // --- eforge:region plan-01-direct-pr-base-sync ---
    beforePushFreshnessGuard,
    beforeCreateFreshnessGuard,
    forceWithLease,
    // --- eforge:endregion plan-01-direct-pr-base-sync ---
  } = opts;

  const ts = (): string => new Date().toISOString();

  // Resolve trunk branch and classify the workflow before emitting landing:start.
  const trunk = await resolveTrunkBranch(opts.engineConfig, repoRoot);
  const baseBranchIsTrunk = isTrunkBranch(baseBranch, trunk);
  const allowLocalMergeToTrunk = opts.engineConfig?.build?.allowLocalMergeToTrunk ?? false;

  let workflow: LandingWorkflow;
  if (action === 'leave') {
    workflow = 'leave-branch';
  } else if (action === 'merge') {
    workflow = baseBranchIsTrunk ? 'trunk-local-merge' : 'feature-local-merge';
  } else {
    // pr
    workflow = baseBranchIsTrunk ? 'trunk-pr' : 'feature-pr';
  }

  yield {
    type: 'landing:start' as const,
    action,
    featureBranch,
    baseBranch,
    trunkBranch: trunk,
    workflow,
    timestamp: ts(),
  } as EforgeEvent;

  // Reject merge when baseBranch is trunk and opt-in is absent.
  if (action === 'merge' && baseBranchIsTrunk && !allowLocalMergeToTrunk) {
    const reason = `Local merge to trunk '${trunk}' is not permitted (set allowLocalMergeToTrunk: true to opt in)`;
    yield {
      type: 'merge:finalize:skipped' as const,
      featureBranch,
      baseBranch,
      reason,
      timestamp: ts(),
    } as EforgeEvent;
    yield {
      type: 'landing:skipped' as const,
      action,
      featureBranch,
      baseBranch,
      reason,
      timestamp: ts(),
    } as EforgeEvent;
    return { landingSucceeded: false };
  }

  // ---------------------------------------------------------------------------
  // merge
  // ---------------------------------------------------------------------------

  if (action === 'merge') {
    yield {
      type: 'merge:finalize:start' as const,
      featureBranch,
      baseBranch,
      timestamp: ts(),
    } as EforgeEvent;

    try {
      // Pre-merge dirty tree detection and auto-recovery on repoRoot
      for await (const event of recoverDirtyTree(repoRoot, ts)) {
        yield event;
      }

      // Run cleanup BEFORE the final merge (for both trunk and non-trunk paths).
      if (shouldCleanup && cleanupPlanSet && cleanupOutputDir) {
        for await (const event of runCleanup(
          mergeWorktreePath,
          featureBranch,
          cleanupPlanSet,
          cleanupOutputDir,
          cleanupPrdFilePath,
          ts,
        )) {
          yield event;
        }
      }

      // After cleanup, collect provenance and compose the final commit message
      // with Eforge-Source-* trailers when a raw commit body was provided.
      let finalCommitMessage = commitMessage;
      if (rawCommitBody !== undefined && cleanupPlanSet && cleanupOutputDir) {
        try {
          const provenanceRefs = await collectBuildArtifactProvenance(mergeWorktreePath, {
            planSetName: cleanupPlanSet,
            outputDir: cleanupOutputDir,
            prdArtifactPath: cleanupPrdFilePath,
          });
          const provenanceTrailers = buildProvenanceTrailers(provenanceRefs);
          finalCommitMessage = composeCommitMessage(rawCommitBody, opts.modelTracker, { provenanceTrailers });
        } catch {
          // Best-effort: provenance failure must not block the merge
        }
      }

      const commitSha = await worktreeManager.mergeToBase(baseBranch, finalCommitMessage, mergeResolver);

      yield {
        type: 'merge:finalize:complete' as const,
        featureBranch,
        baseBranch,
        commitSha,
        timestamp: ts(),
      } as EforgeEvent;

      yield {
        type: 'landing:complete' as const,
        action,
        featureBranch,
        baseBranch,
        commitSha,
        timestamp: ts(),
      } as EforgeEvent;

      return { landingSucceeded: true, commitSha };
    } catch (err) {
      const reason = `Final merge failed: ${(err as Error).message}`;
      yield {
        type: 'merge:finalize:skipped' as const,
        featureBranch,
        baseBranch,
        reason,
        timestamp: ts(),
      } as EforgeEvent;
      yield {
        type: 'landing:skipped' as const,
        action,
        featureBranch,
        baseBranch,
        reason,
        timestamp: ts(),
      } as EforgeEvent;
      return { landingSucceeded: false };
    }
  }

  // ---------------------------------------------------------------------------
  // pr
  // ---------------------------------------------------------------------------

  if (action === 'pr') {
    // Run cleanup BEFORE issuing the PR for both trunk-pr and feature-pr.
    if (shouldCleanup && cleanupPlanSet && cleanupOutputDir) {
      for await (const event of runCleanup(
        mergeWorktreePath,
        featureBranch,
        cleanupPlanSet,
        cleanupOutputDir,
        cleanupPrdFilePath,
        ts,
      )) {
        yield event;
      }
    }

    // Collect build artifact provenance after cleanup and before PR creation (best-effort).
    // Uses git history so it works regardless of whether cleanup removed files from HEAD.
    let provenanceRefs: BuildArtifactProvenanceRef[] = [];
    if (cleanupPlanSet && cleanupOutputDir) {
      try {
        provenanceRefs = await collectBuildArtifactProvenance(mergeWorktreePath, {
          planSetName: cleanupPlanSet,
          outputDir: cleanupOutputDir,
          prdArtifactPath: cleanupPrdFilePath,
        });
      } catch {
        // Best-effort: provenance failure must not fail landing
      }
    }

    try {
      // Direct PR workflow: always publish featureBranch -> baseBranch
      const prMetadata = renderPullRequestMetadata({
        config: opts.config,
        featureBranch,
        baseBranch,
        modelTracker: opts.modelTracker,
        provenanceRefs: provenanceRefs.length > 0 ? provenanceRefs : undefined,
      });
      const prResult = await worktreeManager.issuePr({
        baseBranch,
        metadata: prMetadata,
        // --- eforge:region plan-01-direct-pr-base-sync ---
        beforePushFreshnessGuard,
        beforeCreateFreshnessGuard,
        forceWithLease,
        // --- eforge:endregion plan-01-direct-pr-base-sync ---
      });
      const url = prResult.url;

      yield {
        type: 'landing:complete' as const,
        action,
        featureBranch,
        baseBranch,
        prUrl: url,
        timestamp: ts(),
      } as EforgeEvent;

      // Attempt PR auto-merge (non-fatal) after successful PR creation.
      const shouldAutoMerge = resolvePrAutoMergeIntent(prAutoMergePolicy, landingAutoMerge);
      if (shouldAutoMerge) {
        yield {
          type: 'landing:auto-merge:start' as const,
          featureBranch,
          baseBranch,
          prUrl: url,
          timestamp: ts(),
        } as unknown as EforgeEvent;
        try {
          await worktreeManager.enablePrAutoMerge(url);
          yield {
            type: 'landing:auto-merge:complete' as const,
            featureBranch,
            baseBranch,
            prUrl: url,
            timestamp: ts(),
          } as unknown as EforgeEvent;
        } catch (autoMergeErr) {
          yield {
            type: 'landing:auto-merge:skipped' as const,
            featureBranch,
            baseBranch,
            prUrl: url,
            reason: `gh pr merge failed: ${(autoMergeErr as Error).message}`,
            timestamp: ts(),
          } as unknown as EforgeEvent;
        }
      } else {
        const skipReason = prAutoMergePolicy === 'never'
          ? 'Auto-merge policy is "never"'
          : (prAutoMergePolicy === 'always' && landingAutoMerge === false)
            ? 'Auto-merge explicitly disabled for this run'
            : 'Auto-merge not requested (policy is "ask")';
        yield {
          type: 'landing:auto-merge:skipped' as const,
          featureBranch,
          baseBranch,
          prUrl: url,
          reason: skipReason,
          timestamp: ts(),
        } as unknown as EforgeEvent;
      }

      return { landingSucceeded: true, prUrl: url };
    } catch (err) {
      const reason = (err as Error).message;
      // --- eforge:region plan-01-direct-pr-base-sync ---
      if (err instanceof PullRequestFreshnessError && err.retryable) {
        yield {
          type: 'planning:progress' as const,
          message: `Direct PR freshness guard requested retry: ${reason}`,
          timestamp: ts(),
        } as EforgeEvent;
        return { landingSucceeded: false, freshnessRetry: { reason, fetchedBaseSha: err.fetchedBaseSha } };
      }
      // --- eforge:endregion plan-01-direct-pr-base-sync ---
      yield {
        type: 'landing:skipped' as const,
        action,
        featureBranch,
        baseBranch,
        reason,
        timestamp: ts(),
      } as EforgeEvent;
      return { landingSucceeded: false };
    }
  }

  // ---------------------------------------------------------------------------
  // leave (no-op)
  // ---------------------------------------------------------------------------

  await worktreeManager.leaveBranch();
  yield {
    type: 'landing:complete' as const,
    action,
    featureBranch,
    baseBranch,
    timestamp: ts(),
  } as EforgeEvent;

  return { landingSucceeded: true };
}
