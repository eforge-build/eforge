/**
 * Landing actions — parameterised post-build branch disposition.
 *
 * `executeLandingAction` is an async generator that:
 *   - Emits `landing:start`, then performs the chosen action, then emits
 *     `landing:complete` or `landing:skipped`.
 *   - For `merge-to-base-branch`: additionally emits `merge:finalize:*`
 *     events for backward compatibility with existing consumers.
 *   - For `issue-pr`: pushes the feature branch and creates a PR via `gh`.
 *   - For `leave-branch`: a no-op — the branch is preserved as-is.
 *
 * The generator returns a `LandingResult` capturing whether landing
 * succeeded and optional metadata (PR URL, commit SHA).
 *
 * --- eforge:region plan-03-branch-aware-landing ---
 * Branch-aware workflow classification:
 *   - `trunk-pr`: issue-pr when baseBranch is trunk
 *   - `trunk-local-merge`: merge-to-base-branch when baseBranch is trunk + opt-in
 *   - `feature-pr-after-local-merge`: issue-pr when baseBranch is non-trunk feature branch
 *   - `feature-local-merge`: merge-to-base-branch when baseBranch is non-trunk feature branch
 *   - `leave-branch`: no landing action
 * --- eforge:endregion plan-03-branch-aware-landing ---
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type { EforgeEvent, EforgeState, OrchestrationConfig } from './events.js';
import type { WorktreeManager } from './worktree-manager.js';
import type { MergeResolver } from './worktree-ops.js';
import type { ModelTracker } from './model-tracker.js';
import { cleanupPlanFiles } from './cleanup.js';
// --- eforge:region plan-03-branch-aware-landing ---
import { resolveTrunkBranch, isTrunkBranch } from './branch-policy.js';
import type { EforgeConfig } from './config.js';
// --- eforge:endregion plan-03-branch-aware-landing ---

const exec = promisify(execFile);

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type LandingAction = 'merge-to-base-branch' | 'issue-pr' | 'leave-branch';

// --- eforge:region plan-03-branch-aware-landing ---
/**
 * Classified workflow derived from the action + trunk policy.
 */
export type LandingWorkflow =
  | 'trunk-pr'
  | 'trunk-local-merge'
  | 'feature-pr-after-local-merge'
  | 'feature-local-merge'
  | 'leave-branch';
// --- eforge:endregion plan-03-branch-aware-landing ---

export interface LandingActionOptions {
  action: LandingAction;
  featureBranch: string;
  baseBranch: string;
  repoRoot: string;
  mergeWorktreePath: string;
  worktreeManager: WorktreeManager;
  mergeResolver?: MergeResolver;
  modelTracker: ModelTracker;
  /** Commit message used for merge-to-base-branch action. */
  commitMessage: string;
  signal?: AbortSignal;
  shouldCleanup?: boolean;
  cleanupPlanSet?: string;
  cleanupOutputDir?: string;
  cleanupPrdFilePath?: string;
  state: EforgeState;
  config: OrchestrationConfig;
  // --- eforge:region plan-03-branch-aware-landing ---
  /** EforgeConfig subset for trunk policy resolution. When omitted, trunk defaults to "main". */
  engineConfig?: Pick<EforgeConfig, 'build'>;
  // --- eforge:endregion plan-03-branch-aware-landing ---
}

export interface LandingResult {
  landingSucceeded: boolean;
  prUrl?: string;
  commitSha?: string;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

// --- eforge:region plan-03-branch-aware-landing ---
/**
 * Run cleanup on the feature branch in the merge worktree.
 * Non-fatal: emits a progress event on failure and continues.
 */
async function* runCleanup(
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
// --- eforge:endregion plan-03-branch-aware-landing ---

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
    shouldCleanup,
    cleanupPlanSet,
    cleanupOutputDir,
    cleanupPrdFilePath,
  } = opts;

  const ts = (): string => new Date().toISOString();

  // --- eforge:region plan-03-branch-aware-landing ---
  // Resolve trunk branch and classify the workflow before emitting landing:start.
  const trunk = await resolveTrunkBranch(opts.engineConfig, repoRoot);
  const baseBranchIsTrunk = isTrunkBranch(baseBranch, trunk);
  const allowLocalMergeToTrunk = opts.engineConfig?.build?.allowLocalMergeToTrunk ?? false;

  let workflow: LandingWorkflow;
  if (action === 'leave-branch') {
    workflow = 'leave-branch';
  } else if (action === 'merge-to-base-branch') {
    workflow = baseBranchIsTrunk ? 'trunk-local-merge' : 'feature-local-merge';
  } else {
    // issue-pr
    workflow = baseBranchIsTrunk ? 'trunk-pr' : 'feature-pr-after-local-merge';
  }
  // --- eforge:endregion plan-03-branch-aware-landing ---

  yield {
    type: 'landing:start' as const,
    action,
    featureBranch,
    baseBranch,
    // --- eforge:region plan-03-branch-aware-landing ---
    trunkBranch: trunk,
    workflow,
    // --- eforge:endregion plan-03-branch-aware-landing ---
    timestamp: ts(),
  } as EforgeEvent;

  // --- eforge:region plan-03-branch-aware-landing ---
  // Reject merge-to-base-branch when baseBranch is trunk and opt-in is absent.
  if (action === 'merge-to-base-branch' && baseBranchIsTrunk && !allowLocalMergeToTrunk) {
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
  // --- eforge:endregion plan-03-branch-aware-landing ---

  // ---------------------------------------------------------------------------
  // merge-to-base-branch
  // ---------------------------------------------------------------------------

  if (action === 'merge-to-base-branch') {
    yield {
      type: 'merge:finalize:start' as const,
      featureBranch,
      baseBranch,
      timestamp: ts(),
    } as EforgeEvent;

    try {
      // Pre-merge dirty tree detection and auto-recovery on repoRoot
      // --- eforge:region plan-03-branch-aware-landing ---
      for await (const event of recoverDirtyTree(repoRoot, ts)) {
        yield event;
      }
      // --- eforge:endregion plan-03-branch-aware-landing ---

      // --- eforge:region plan-03-branch-aware-landing ---
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
      // --- eforge:endregion plan-03-branch-aware-landing ---

      const commitSha = await worktreeManager.mergeToBase(baseBranch, commitMessage, mergeResolver);

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
  // issue-pr
  // ---------------------------------------------------------------------------

  if (action === 'issue-pr') {
    // --- eforge:region plan-03-branch-aware-landing ---
    // Run cleanup BEFORE issuing the PR for both trunk-pr and feature-pr-after-local-merge.
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
    // --- eforge:endregion plan-03-branch-aware-landing ---

    try {
      // --- eforge:region plan-03-branch-aware-landing ---
      let url: string;
      if (!baseBranchIsTrunk) {
        // Non-trunk: merge into the base feature branch first, push that branch,
        // then open a PR from the base feature branch to trunk.
        //
        // The feature-pr-after-local-merge workflow performs a local merge in
        // repoRoot (via mergeFeatureBranchToBase), which rejects on a dirty
        // working tree. Auto-recover dirty files first to match the behavior
        // of the merge-to-base-branch path above.
        for await (const event of recoverDirtyTree(repoRoot, ts)) {
          yield event;
        }
        const prResult = await worktreeManager.issuePr({
          baseBranch,
          trunkBranch: trunk,
          mergeIntoBaseFirst: true,
          commitMessage,
          mergeResolver,
        });
        url = prResult.url;
      } else {
        // Trunk: standard push-and-PR workflow
        const prResult = await worktreeManager.issuePr({ baseBranch });
        url = prResult.url;
      }
      // --- eforge:endregion plan-03-branch-aware-landing ---

      yield {
        type: 'landing:complete' as const,
        action,
        featureBranch,
        baseBranch,
        prUrl: url,
        timestamp: ts(),
      } as EforgeEvent;
      return { landingSucceeded: true, prUrl: url };
    } catch (err) {
      const reason = (err as Error).message;
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
  // leave-branch (no-op)
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
