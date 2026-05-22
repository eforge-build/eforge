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
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type { EforgeEvent, EforgeState, OrchestrationConfig } from './events.js';
import type { WorktreeManager } from './worktree-manager.js';
import type { MergeResolver } from './worktree-ops.js';
import type { ModelTracker } from './model-tracker.js';
import { cleanupPlanFiles } from './cleanup.js';

const exec = promisify(execFile);

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type LandingAction = 'merge-to-base-branch' | 'issue-pr' | 'leave-branch';

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
}

export interface LandingResult {
  landingSucceeded: boolean;
  prUrl?: string;
  commitSha?: string;
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
    shouldCleanup,
    cleanupPlanSet,
    cleanupOutputDir,
    cleanupPrdFilePath,
  } = opts;

  const ts = (): string => new Date().toISOString();

  yield {
    type: 'landing:start' as const,
    action,
    featureBranch,
    baseBranch,
    timestamp: ts(),
  } as EforgeEvent;

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
      {
        const { stdout: statusOut } = await exec('git', ['status', '--porcelain'], { cwd: repoRoot });
        const dirtyFiles = statusOut.trim().split('\n').filter(Boolean);
        if (dirtyFiles.length > 0) {
          const preview = dirtyFiles.slice(0, 10).join('\n');
          const suffix = dirtyFiles.length > 10 ? `\n... and ${dirtyFiles.length - 10} more` : '';
          yield {
            type: 'planning:progress' as const,
            message: `Dirty working tree detected in repoRoot (${dirtyFiles.length} files). Attempting auto-recovery.\n${preview}${suffix}`,
            timestamp: ts(),
          } as EforgeEvent;

          // Auto-recover: discard modifications and remove untracked files
          await exec('git', ['checkout', '--', '.'], { cwd: repoRoot });
          await exec('git', ['clean', '-fd'], { cwd: repoRoot });

          // Verify recovery succeeded
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
      }

      // Run cleanup on the feature branch before the final merge
      if (shouldCleanup && cleanupPlanSet && cleanupOutputDir) {
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
    try {
      const { url } = await worktreeManager.issuePr({ baseBranch });
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
