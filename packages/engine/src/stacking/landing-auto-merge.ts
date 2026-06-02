import type { EforgeEvent } from '../events.js';
import { resolvePrAutoMergeIntent } from '../config.js';
import { enablePullRequestAutoMerge } from '../worktree-ops.js';

export interface StackLandingAutoMergeOptions {
  mergeWorktreePath: string;
  branch: string;
  baseBranch: string;
  prUrl?: string;
  prAutoMergePolicy: 'ask' | 'always' | 'never';
  landingAutoMerge?: boolean;
  timestamp: () => string;
}

export async function* emitStackLandingAutoMergeEvents(
  options: StackLandingAutoMergeOptions,
): AsyncGenerator<EforgeEvent> {
  const { mergeWorktreePath, branch, baseBranch, prUrl, prAutoMergePolicy, landingAutoMerge, timestamp } = options;
  const shouldAutoMerge = resolvePrAutoMergeIntent(prAutoMergePolicy, landingAutoMerge);
  if (shouldAutoMerge) {
    if (prUrl === undefined) {
      yield {
        timestamp: timestamp(),
        type: 'landing:auto-merge:skipped',
        featureBranch: branch,
        baseBranch,
        reason: 'No PR URL discovered; cannot enable auto-merge for stacked PR',
      } as unknown as EforgeEvent;
      return;
    }

    yield {
      timestamp: timestamp(),
      type: 'landing:auto-merge:start',
      featureBranch: branch,
      baseBranch,
      prUrl,
    } as unknown as EforgeEvent;
    try {
      await enablePullRequestAutoMerge(mergeWorktreePath, prUrl);
      yield {
        timestamp: timestamp(),
        type: 'landing:auto-merge:complete',
        featureBranch: branch,
        baseBranch,
        prUrl,
      } as unknown as EforgeEvent;
    } catch (autoMergeErr) {
      yield {
        timestamp: timestamp(),
        type: 'landing:auto-merge:skipped',
        featureBranch: branch,
        baseBranch,
        prUrl,
        reason: `gh pr merge failed: ${(autoMergeErr as Error).message}`,
      } as unknown as EforgeEvent;
    }
    return;
  }

  const skipReason = prAutoMergePolicy === 'never'
    ? 'Auto-merge policy is "never"'
    : (prAutoMergePolicy === 'always' && landingAutoMerge === false)
      ? 'Auto-merge explicitly disabled for this run'
      : 'Auto-merge not requested (policy is "ask")';
  yield {
    timestamp: timestamp(),
    type: 'landing:auto-merge:skipped',
    featureBranch: branch,
    baseBranch,
    ...(prUrl !== undefined && { prUrl }),
    reason: skipReason,
  } as unknown as EforgeEvent;
}
