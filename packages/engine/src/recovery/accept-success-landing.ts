import { execFile } from 'node:child_process';
import { rm } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { promisify } from 'node:util';

import type { AcceptSuccessLandingResult, BuildFailureSummary, EforgeEvent } from '@eforge-build/client';

import { resolveTrunkBranch, isTrunkBranch } from '../branch-policy.js';
import { DEFAULT_CONFIG } from '../config.js';
import { DIRECT_PR_REMOTE, checkDirectPrBaseFreshness, syncDirectPrBase, type DirectPrBaseSyncPoint, type DirectPrBaseSyncResult } from '../direct-pr-base-sync.js';
import type { OrchestrationConfig, EforgeState } from '../events.js';
import { executeLandingAction } from '../landing.js';
import { ModelTracker } from '../model-tracker.js';
import { WorktreeManager, type PullRequestFreshnessGuard } from '../worktree-manager.js';

const exec = promisify(execFile);

export interface AcceptSuccessLandingOptions {
  cwd: string;
  landingAction?: 'pr' | 'merge' | 'leave';
  planOutputDir?: string;
  trunkBranch?: string;
  allowLocalMergeToTrunk?: boolean;
  landingAutoMerge?: boolean;
  prAutoMergePolicy?: 'ask' | 'always' | 'never';
  directPrBaseSyncPoint?: DirectPrBaseSyncPoint;
}

async function gitRevParse(cwd: string, ref: string): Promise<string> {
  const { stdout } = await exec('git', ['rev-parse', ref], { cwd });
  return stdout.trim();
}

async function branchExists(cwd: string, branch: string): Promise<boolean> {
  try {
    await exec('git', ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], { cwd });
    return true;
  } catch {
    return false;
  }
}

async function addDetachedWorktree(cwd: string, ref: string): Promise<string> {
  const wtPath = join(cwd, '.eforge', 'tmp', `accept-landing-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  await exec('git', ['worktree', 'add', '--detach', '--quiet', wtPath, ref], { cwd });
  return wtPath;
}

export async function syncAcceptedSuccessPrBase(options: AcceptSuccessLandingOptions, summary: BuildFailureSummary): Promise<DirectPrBaseSyncResult> {
  const { cwd } = options;
  const featureBranch = summary.featureBranch;
  const baseBranch = summary.baseBranch;
  const originalSha = await gitRevParse(cwd, featureBranch);
  const tempBranch = `eforge/tmp/accept-success-${randomBytes(6).toString('hex')}`;
  await exec('git', ['branch', tempBranch, originalSha], { cwd });
  const wtPath = await addDetachedWorktree(cwd, tempBranch);
  try {
    const sync = await syncDirectPrBase({ cwd: wtPath, featureBranch: tempBranch, baseBranch, remote: DIRECT_PR_REMOTE });
    if (!sync.ok) return sync;
    await exec('git', ['update-ref', `refs/heads/${featureBranch}`, sync.point.featureSha, originalSha], { cwd });
    return { ok: true, point: { ...sync.point, featureSha: sync.point.featureSha } };
  } catch (err) {
    return { ok: false, reason: 'rebase-failed', message: `Direct PR base sync failed: ${(err as Error).message}`, baseBranch, remote: DIRECT_PR_REMOTE };
  } finally {
    await removeWorktree(cwd, wtPath);
    await exec('git', ['branch', '-D', tempBranch], { cwd }).catch(() => {});
  }
}

async function removeWorktree(cwd: string, wtPath: string): Promise<void> {
  try {
    await exec('git', ['worktree', 'remove', '--force', wtPath], { cwd });
  } catch {
    await rm(wtPath, { recursive: true, force: true }).catch(() => {});
    await exec('git', ['worktree', 'prune'], { cwd }).catch(() => {});
  }
}

function minimalConfig(summary: BuildFailureSummary): OrchestrationConfig {
  return {
    name: summary.setName,
    description: summary.setName,
    created: summary.failedAt,
    baseBranch: summary.baseBranch,
    pipeline: {
      compile: [],
      defaultBuild: [],
      defaultReview: { strategy: 'auto', perspectives: ['code'], maxRounds: 1, evaluatorStrictness: 'standard' },
      rationale: 'accepted-success recovery',
    },
    plans: (summary.plans.length > 0 ? summary.plans : [{ planId: summary.failingPlan.planId }]).map((plan) => ({
      id: plan.planId,
      name: plan.planId,
      dependsOn: [],
      branch: summary.featureBranch,
      build: [],
      review: { strategy: 'auto', perspectives: ['code'], maxRounds: 1, evaluatorStrictness: 'standard' },
    })),
  };
}

function minimalState(summary: BuildFailureSummary): EforgeState {
  const plans: EforgeState['plans'] = {};
  for (const plan of summary.plans.length > 0 ? summary.plans : [{ planId: summary.failingPlan.planId }]) {
    plans[plan.planId] = { status: 'merged', branch: summary.featureBranch, dependsOn: [], merged: true };
  }
  return {
    setName: summary.setName,
    status: 'running',
    startedAt: summary.failedAt,
    baseBranch: summary.baseBranch,
    featureBranch: summary.featureBranch,
    worktreeBase: join('.eforge', 'worktrees'),
    plans,
    completedPlans: Object.keys(plans),
  };
}

function landingFailureFromEvents(events: EforgeEvent[]): string | undefined {
  for (const event of events) {
    if (event.type === 'landing:skipped') return event.reason;
    if (event.type === 'merge:finalize:skipped') return event.reason;
  }
  return undefined;
}

function autoMergeFromEvents(events: EforgeEvent[]): AcceptSuccessLandingResult['autoMerge'] | undefined {
  const complete = events.find((event) => event.type === 'landing:auto-merge:complete');
  if (complete) return { status: 'complete' };
  const skipped = events.find((event) => event.type === 'landing:auto-merge:skipped') as Extract<EforgeEvent, { type: 'landing:auto-merge:skipped' }> | undefined;
  if (!skipped) return undefined;
  return skipped.reason.startsWith('gh pr merge failed:')
    ? { status: 'failed', reason: skipped.reason }
    : { status: 'skipped', reason: skipped.reason };
}

async function landMerge(options: AcceptSuccessLandingOptions, summary: BuildFailureSummary): Promise<AcceptSuccessLandingResult> {
  const { cwd } = options;
  const featureBranch = summary.featureBranch;
  const baseBranch = summary.baseBranch;
  const trunk = options.trunkBranch ?? await resolveTrunkBranch(undefined, cwd);
  if (isTrunkBranch(baseBranch, trunk) && !(options.allowLocalMergeToTrunk ?? false)) {
    return { action: 'merge', status: 'skipped', branch: featureBranch, reason: `Local merge to trunk '${trunk}' is not permitted (set allowLocalMergeToTrunk: true to opt in)` };
  }

  const expectedBaseSha = await gitRevParse(cwd, baseBranch);
  const wtPath = await addDetachedWorktree(cwd, baseBranch);
  try {
    try {
      await exec('git', ['merge', '--no-ff', '--no-edit', featureBranch], { cwd: wtPath });
    } catch {
      await exec('git', ['merge', '--abort'], { cwd: wtPath }).catch(() => {});
      return { action: 'merge', status: 'failed', branch: featureBranch, reason: 'Merge failed' };
    }
    const mergeCommitSha = await gitRevParse(wtPath, 'HEAD');
    try {
      await exec('git', ['update-ref', `refs/heads/${baseBranch}`, mergeCommitSha, expectedBaseSha], { cwd });
    } catch {
      return { action: 'merge', status: 'failed', branch: featureBranch, reason: 'Base branch advanced during landing; merge not applied' };
    }
    return { action: 'merge', status: 'complete', branch: featureBranch, mergeCommitSha };
  } finally {
    await removeWorktree(cwd, wtPath);
  }
}

async function landPr(options: AcceptSuccessLandingOptions, summary: BuildFailureSummary): Promise<AcceptSuccessLandingResult> {
  const { cwd } = options;
  const featureBranch = summary.featureBranch;
  const baseBranch = summary.baseBranch;
  const syncPoint = options.directPrBaseSyncPoint;
  const sync = syncPoint ? { ok: true as const, point: syncPoint } : await syncAcceptedSuccessPrBase(options, summary);
  if (!sync.ok) {
    return { action: 'pr', status: 'failed', branch: featureBranch, reason: sync.message };
  }

  const wtPath = await addDetachedWorktree(cwd, featureBranch);
  try {
    const freshnessGuard: PullRequestFreshnessGuard = async () => {
      const result = await checkDirectPrBaseFreshness({ cwd: wtPath, syncPoint: sync.point });
      if (result.kind === 'fresh') return { ok: true };
      if (result.kind === 'base-advanced') {
        return {
          ok: false,
          retryable: true,
          reason: `Direct PR base '${result.remote}/${result.baseBranch}' advanced after accepted-success base sync`,
          fetchedBaseSha: result.fetchedBaseSha,
        };
      }
      return { ok: false, retryable: false, reason: result.reason };
    };

    const worktreeManager = new WorktreeManager({
      repoRoot: wtPath,
      worktreeBase: join(wtPath, '.eforge', 'worktrees'),
      featureBranch,
      mergeWorktreePath: wtPath,
    });
    const events: EforgeEvent[] = [];
    const generator = executeLandingAction({
      action: 'pr',
      featureBranch,
      baseBranch,
      repoRoot: wtPath,
      mergeWorktreePath: wtPath,
      worktreeManager,
      modelTracker: new ModelTracker(),
      commitMessage: `build(${summary.setName}): accept successful recovery`,
      state: minimalState(summary),
      config: minimalConfig(summary),
      engineConfig: { build: { ...DEFAULT_CONFIG.build, trunkBranch: options.trunkBranch, allowLocalMergeToTrunk: options.allowLocalMergeToTrunk ?? false } },
      shouldCleanup: false,
      cleanupPlanSet: summary.setName,
      cleanupOutputDir: options.planOutputDir ?? 'eforge/plans',
      prAutoMergePolicy: options.prAutoMergePolicy,
      landingAutoMerge: options.landingAutoMerge,
      beforePushFreshnessGuard: freshnessGuard,
      beforeCreateFreshnessGuard: freshnessGuard,
      forceWithLease: true,
    });

    let result = { landingSucceeded: false } as Awaited<ReturnType<typeof executeLandingAction> extends AsyncGenerator<EforgeEvent, infer R> ? Promise<R> : never>;
    while (true) {
      const next = await generator.next();
      if (next.done) {
        result = next.value;
        break;
      }
      events.push(next.value);
    }

    if (result.freshnessRetry) {
      return { action: 'pr', status: 'failed', branch: featureBranch, reason: result.freshnessRetry.reason };
    }
    const autoMerge = autoMergeFromEvents(events);
    if (result.landingSucceeded) {
      return { action: 'pr', status: 'complete', branch: featureBranch, ...(result.prUrl ? { prUrl: result.prUrl } : {}), ...(autoMerge ? { autoMerge } : {}) };
    }
    return { action: 'pr', status: 'failed', branch: featureBranch, reason: landingFailureFromEvents(events) ?? 'PR landing failed', ...(autoMerge ? { autoMerge } : {}) };
  } finally {
    await removeWorktree(cwd, wtPath);
  }
}

export async function landAcceptedSuccessBuild(
  options: AcceptSuccessLandingOptions,
  summary: BuildFailureSummary,
): Promise<AcceptSuccessLandingResult> {
  const landingAction = options.landingAction ?? 'merge';
  const featureBranch = summary.featureBranch;
  if (!(await branchExists(options.cwd, featureBranch))) {
    return { action: landingAction, status: 'failed', branch: featureBranch, reason: `Feature branch '${featureBranch}' not found` };
  }
  if (landingAction === 'leave') return { action: 'leave', status: 'complete', branch: featureBranch };
  if (landingAction === 'merge') return landMerge(options, summary);
  return landPr(options, summary);
}
