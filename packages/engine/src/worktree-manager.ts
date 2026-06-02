/**
 * WorktreeManager — owns worktree lifecycle: creation, tracking, merging, and cleanup.
 * Wraps worktree-ops.ts pure functions with stateful tracking via a ManagedWorktree map.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { existsSync } from 'node:fs';

import {
  createWorktree,
  removeWorktree,
  mergeWorktree,
  mergeFeatureBranchToBase,
  recoverDriftedWorktree,
  cleanupWorktrees,
  getNameStatusDiff,
  type ExtensionDiff,
  getWorktreeDirtyFiles,
  type MergeResolver,
  pushFeatureBranch as pushFeatureBranchOp,
  createPullRequest as createPullRequestOp,
  getExistingPullRequestUrl,
  ensureGhAvailable,
  enablePullRequestAutoMerge,
  editPullRequest as editPullRequestOp,
} from './worktree-ops.js';
import type { PullRequestMetadata } from './pr-metadata.js';
import type { ModelTracker } from './model-tracker.js';
import { composeCommitMessage } from './model-tracker.js';
import type { EforgeEvent, EforgeState, ReconciliationReport } from './events.js';
import { mutateState } from './state.js';

const exec = promisify(execFile);

/** Status of a managed worktree. */
export type WorktreeStatus = 'active' | 'merged' | 'removed';

/** Type of managed worktree. */
export type WorktreeType = 'plan' | 'merge';

/** Tracking record for a worktree managed by WorktreeManager. */
export interface ManagedWorktree {
  type: WorktreeType;
  planId?: string;
  path: string;
  branch: string;
  status: WorktreeStatus;
  /** True if the plan was built directly on the merge worktree (no dedicated worktree). */
  builtOnMerge: boolean;
  /** Base commit captured before plan build mutations for policy diff summaries. */
  baseSha?: string;
}

/** Result of cleanupAll() - reports what happened during cleanup. */
export interface CleanupReport {
  /** Worktrees that were cleanly removed. */
  removed: string[];
  /** Worktrees that required fallback force removal. */
  fallback: string[];
  /** Worktrees that failed to remove entirely. */
  failed: string[];
}

// --- eforge:region plan-01-direct-pr-base-sync ---
export type PullRequestFreshnessGuardResult =
  | { ok: true }
  | { ok: false; retryable: boolean; reason: string; fetchedBaseSha?: string };

export type PullRequestFreshnessGuard = () => Promise<PullRequestFreshnessGuardResult>;

export class PullRequestFreshnessError extends Error {
  readonly retryable: boolean;
  readonly fetchedBaseSha?: string;

  constructor(result: Extract<PullRequestFreshnessGuardResult, { ok: false }>) {
    super(result.reason);
    this.name = 'PullRequestFreshnessError';
    this.retryable = result.retryable;
    this.fetchedBaseSha = result.fetchedBaseSha;
  }
}
// --- eforge:endregion plan-01-direct-pr-base-sync ---

export class WorktreeManager {
  private readonly repoRoot: string;
  private readonly worktreeBase: string;
  private readonly featureBranch: string;
  private readonly mergeWorktreePath: string;
  private readonly worktrees = new Map<string, ManagedWorktree>();

  constructor(opts: {
    repoRoot: string;
    worktreeBase: string;
    featureBranch: string;
    mergeWorktreePath: string;
  }) {
    this.repoRoot = opts.repoRoot;
    this.worktreeBase = opts.worktreeBase;
    this.featureBranch = opts.featureBranch;
    this.mergeWorktreePath = opts.mergeWorktreePath;
  }

  /**
   * Acquire a worktree for a plan. When `needsPlanWorktrees` is false
   * (maxConcurrency=1), returns the merge worktree path and records the plan
   * as `builtOnMerge: true`. When true, creates a dedicated worktree.
   */
  async acquireForPlan(
    planId: string,
    branch: string,
    needsPlanWorktrees: boolean,
  ): Promise<string> {
    const { stdout: baseShaOut } = await exec(
      'git',
      ['rev-parse', needsPlanWorktrees ? this.featureBranch : 'HEAD'],
      { cwd: needsPlanWorktrees ? this.repoRoot : this.mergeWorktreePath },
    );
    const baseSha = baseShaOut.trim();

    if (needsPlanWorktrees) {
      const worktreePath = await createWorktree(
        this.repoRoot,
        this.worktreeBase,
        branch,
        this.featureBranch,
      );
      this.worktrees.set(planId, {
        type: 'plan',
        planId,
        path: worktreePath,
        branch,
        status: 'active',
        builtOnMerge: false,
        baseSha,
      });
      return worktreePath;
    }

    // No concurrent plans - build directly on the merge worktree
    this.worktrees.set(planId, {
      type: 'plan',
      planId,
      path: this.mergeWorktreePath,
      branch,
      status: 'active',
      builtOnMerge: true,
      baseSha,
    });
    return this.mergeWorktreePath;
  }

  /**
   * Release a plan's worktree after build completes or fails.
   * For dedicated worktrees, removes the worktree. For merge worktree plans, no-op.
   */
  async releaseForPlan(planId: string): Promise<void> {
    const managed = this.worktrees.get(planId);
    if (!managed || managed.builtOnMerge) return;

    try {
      await removeWorktree(this.repoRoot, managed.path);
      managed.status = 'removed';
    } catch {
      // Best-effort worktree cleanup
    }
  }

  /**
   * Check if a plan was built directly on the merge worktree.
   */
  isBuiltOnMerge(planId: string): boolean {
    return this.worktrees.get(planId)?.builtOnMerge ?? false;
  }

  /**
   * Return the path/status diff a plan would contribute before merge mutation.
   */
  async getPlanDiff(
    planId: string,
    plan: { branch: string },
  ): Promise<ExtensionDiff> {
    const managed = this.worktrees.get(planId);
    if (!managed?.baseSha) return { files: [] };

    if (managed.builtOnMerge) {
      return getNameStatusDiff(this.mergeWorktreePath, managed.baseSha, 'HEAD');
    }

    return getNameStatusDiff(this.repoRoot, managed.baseSha, plan.branch);
  }

  /**
   * Return the path/status diff that would be merged from featureBranch to baseBranch.
   */
  async getFinalMergeDiff(baseBranch: string): Promise<ExtensionDiff> {
    const { stdout: mergeBaseOut } = await exec(
      'git',
      ['merge-base', baseBranch, this.featureBranch],
      { cwd: this.repoRoot },
    );
    const mergeBase = mergeBaseOut.trim();
    return getNameStatusDiff(this.repoRoot, mergeBase, this.featureBranch);
  }

  /**
   * Merge a completed plan into the feature branch.
   * For `builtOnMerge` plans, recovers from branch drift (commits already on featureBranch).
   * For dedicated worktree plans, performs a squash merge.
   *
   * Returns the commit SHA after merge.
   */
  async mergePlan(
    planId: string,
    plan: { id: string; name: string; branch: string },
    opts: {
      mode?: string;
      mergeResolver?: MergeResolver;
      recentlyMergedIds?: string[];
      planMap?: Map<string, { name: string }>;
      modelTracker?: ModelTracker;
      /** When true, a builtOnMerge plan with no committed changes since baseSha is allowed to proceed. */
      allowNoCommittedChanges?: boolean;
      /** Human-readable reason for the allowNoCommittedChanges waiver. */
      noCommittedChangesReason?: string;
      /**
       * Called synchronously when the allowNoCommittedChanges waiver is applied.
       * Callers can use this to emit a planning:progress waiver event after the merge resolves.
       */
      onNoCommittedChangesWaiver?: () => void;
    } = {},
  ): Promise<string> {
    const managed = this.worktrees.get(planId);
    const prefix = opts.mode === 'errand' ? 'fix' : 'feat';
    const commitMessage = composeCommitMessage(`${prefix}(${plan.id}): ${plan.name}`, opts.modelTracker);

    if (managed?.builtOnMerge) {
      // Plan built directly on the merge worktree - commits already on featureBranch.
      // Recover from any branch drift first, then capture HEAD SHA.
      await recoverDriftedWorktree(this.mergeWorktreePath, this.featureBranch, commitMessage);

      // Reject dirty tracked or untracked changes — all implementation work must be
      // committed so that validation and artifact recording operate on committed state.
      const dirtyFiles = await getWorktreeDirtyFiles(this.mergeWorktreePath);
      if (dirtyFiles.length > 0) {
        const preview = dirtyFiles.slice(0, 10).join('\n');
        const suffix = dirtyFiles.length > 10 ? `\n... and ${dirtyFiles.length - 10} more files` : '';
        throw new Error(
          `builtOnMerge plan '${planId}' has uncommitted changes in the merge worktree. ` +
          `Commit all implementation work before marking a plan complete.\n` +
          `Dirty files:\n${preview}${suffix}`,
        );
      }

      const { stdout: shaOut } = await exec('git', ['rev-parse', 'HEAD'], { cwd: this.mergeWorktreePath });
      const currentSha = shaOut.trim();

      // Enforce committed diff: builtOnMerge plans must have at least one committed file
      // change since baseSha so that validation and artifact recording operate on non-trivial
      // state. Dirty-work is already rejected above; this gate catches clean no-op builds,
      // including empty commits where HEAD advances but the committed diff vs baseSha is empty.
      if (managed?.baseSha) {
        const committedDiff = await getNameStatusDiff(this.mergeWorktreePath, managed.baseSha, 'HEAD');
        if (committedDiff.files.length === 0) {
          const waiverValid =
            opts.allowNoCommittedChanges === true &&
            typeof opts.noCommittedChangesReason === 'string' &&
            opts.noCommittedChangesReason.trim().length > 0;
          if (!waiverValid) {
            throw new Error(
              `builtOnMerge plan '${planId}' has no committed changes since baseSha (${managed.baseSha}). ` +
              `Either commit implementation work or configure allowNoCommittedChanges with a noCommittedChangesReason ` +
              `in the validation policy.`,
            );
          }
          opts.onNoCommittedChangesWaiver?.();
        }
      }

      if (managed) managed.status = 'merged';
      return currentSha;
    }

    // Dedicated worktree plan - squash merge into featureBranch
    // Wrap mergeResolver to inject plan context into MergeConflictInfo
    const baseResolver = opts.mergeResolver;
    const contextResolver: MergeResolver | undefined = baseResolver
      ? async (cwd, conflict) => {
          conflict.planName = plan.name;

          // Find the most recently merged plan as the likely conflict source
          if (opts.recentlyMergedIds && opts.recentlyMergedIds.length > 0 && opts.planMap) {
            const lastMergedId = opts.recentlyMergedIds[opts.recentlyMergedIds.length - 1];
            const otherPlan = opts.planMap.get(lastMergedId);
            if (otherPlan) {
              conflict.otherPlanName = otherPlan.name;
            }
          }

          return baseResolver(cwd, conflict);
        }
      : undefined;

    await mergeWorktree(this.mergeWorktreePath, plan.branch, this.featureBranch, commitMessage, contextResolver);

    // Capture the squash-merge commit SHA
    const { stdout: shaOut } = await exec('git', ['rev-parse', 'HEAD'], { cwd: this.mergeWorktreePath });

    // Best-effort branch deletion - squash merges leave branches "unmerged" so use -D (force)
    try {
      await exec('git', ['branch', '-D', plan.branch], { cwd: this.repoRoot });
    } catch {
      // Branch may already be deleted or never created
    }

    if (managed) managed.status = 'merged';
    return shaOut.trim();
  }

  /**
   * Merge the feature branch into baseBranch in the user's repoRoot.
   * Delegates to mergeFeatureBranchToBase from worktree-ops.
   */
  async mergeToBase(baseBranch: string, commitMessage: string, mergeResolver?: MergeResolver): Promise<string> {
    return mergeFeatureBranchToBase(
      this.repoRoot,
      this.featureBranch,
      baseBranch,
      commitMessage,
      mergeResolver,
    );
  }

  /**
   * Push the feature branch to the remote with tracking set.
   */
  async pushFeatureBranch(remote = 'origin', opts: { forceWithLease?: boolean } = {}): Promise<void> {
    // --- eforge:region plan-01-direct-pr-base-sync ---
    return pushFeatureBranchOp(this.mergeWorktreePath, this.featureBranch, remote, opts);
    // --- eforge:endregion plan-01-direct-pr-base-sync ---
  }

  /**
   * Create a pull request for the feature branch targeting baseBranch.
   * Pushes `featureBranch` first, then runs `gh pr create --base baseBranch --head featureBranch`.
   * Detects an already-existing PR and returns its URL instead of throwing.
   * When metadata is provided and an existing PR is found, attempts a best-effort
   * `gh pr edit` to apply deterministic title/body before returning the URL.
   * Returns `{ url }` on success or throws on any other failure.
   *
   * @param opts.baseBranch - The PR target (base) branch.
   * @param opts.metadata   - Optional deterministic PR title/body (no raw commit trailers).
   */
  async issuePr(opts: {
    baseBranch: string;
    metadata?: PullRequestMetadata;
    // --- eforge:region plan-01-direct-pr-base-sync ---
    forceWithLease?: boolean;
    beforePushFreshnessGuard?: PullRequestFreshnessGuard;
    beforeCreateFreshnessGuard?: PullRequestFreshnessGuard;
    // --- eforge:endregion plan-01-direct-pr-base-sync ---
  }): Promise<{ url: string }> {
    await ensureGhAvailable(this.mergeWorktreePath);

    // --- eforge:region plan-01-direct-pr-base-sync ---
    const runFreshnessGuard = async (guard: PullRequestFreshnessGuard | undefined): Promise<void> => {
      if (!guard) return;
      const result = await guard();
      if (!result.ok) throw new PullRequestFreshnessError(result);
    };

    await runFreshnessGuard(opts.beforePushFreshnessGuard);
    // --- eforge:endregion plan-01-direct-pr-base-sync ---

    // Direct PR workflow: push featureBranch, open PR featureBranch -> baseBranch
    await pushFeatureBranchOp(this.mergeWorktreePath, this.featureBranch, 'origin', {
      // --- eforge:region plan-01-direct-pr-base-sync ---
      forceWithLease: opts.forceWithLease,
      // --- eforge:endregion plan-01-direct-pr-base-sync ---
    });
    try {
      const metadata = opts.metadata ?? { title: this.featureBranch, body: '' };
      // --- eforge:region plan-01-direct-pr-base-sync ---
      await runFreshnessGuard(opts.beforeCreateFreshnessGuard);
      // --- eforge:endregion plan-01-direct-pr-base-sync ---
      return await createPullRequestOp(this.mergeWorktreePath, {
        baseBranch: opts.baseBranch,
        featureBranch: this.featureBranch,
        metadata,
      });
    } catch (err) {
      // --- eforge:region plan-01-direct-pr-base-sync ---
      if (err instanceof PullRequestFreshnessError) throw err;
      await runFreshnessGuard(opts.beforeCreateFreshnessGuard);
      // --- eforge:endregion plan-01-direct-pr-base-sync ---
      // PR may already exist — retrieve its URL
      const existing = await getExistingPullRequestUrl(this.mergeWorktreePath, this.featureBranch, {
        baseBranch: opts.baseBranch,
      });
      if (existing) {
        // Best-effort metadata repair on the existing PR.
        if (opts.metadata) {
          try {
            await editPullRequestOp(this.mergeWorktreePath, existing, opts.metadata);
          } catch {
            // Non-fatal: preserve existing URL even when metadata edit fails.
          }
        }
        return { url: existing };
      }
      throw err;
    }
  }

  /**
   * Leave the feature branch as-is: no merge, no PR.
   * No-op — the branch is preserved for manual workflow.
   */
  async leaveBranch(): Promise<void> {
    // No-op: branch remains for manual inspection or follow-up
  }

  /**
   * Enable GitHub PR auto-merge via `gh pr merge --auto --merge`.
   *
   * @param prUrlOrBranch - PR URL (preferred) or branch name passed to `gh pr merge`.
   *
   * Non-fatal by design: callers must catch errors and emit a
   * `landing:auto-merge:skipped` event rather than propagating the failure.
   */
  async enablePrAutoMerge(prUrlOrBranch: string): Promise<void> {
    return enablePullRequestAutoMerge(this.mergeWorktreePath, prUrlOrBranch);
  }

  /**
   * Reconcile persisted state with the actual filesystem and git state.
   * Checks that worktrees referenced in state actually exist and are on the
   * correct branches. Missing or corrupt worktrees have their worktreePath
   * cleared so they'll be re-created on retry.
   *
   * Returns the ReconciliationReport and the lifecycle events produced during
   * reconciliation. Callers should forward the events to the SSE event stream.
   */
  async reconcile(state: EforgeState): Promise<{ report: ReconciliationReport; events: readonly EforgeEvent[] }> {
    const report: ReconciliationReport = {
      valid: [],
      missing: [],
      corrupt: [],
      cleared: [],
    };
    const events: EforgeEvent[] = [];

    const makeEvent = (e: EforgeEvent): EforgeEvent => { events.push(e); return e; };

    // Check the merge worktree
    const mergeWtPath = state.mergeWorktreePath;
    if (mergeWtPath) {
      if (!existsSync(mergeWtPath)) {
        report.missing.push('__merge__');
        report.cleared.push('__merge__');
        mutateState(state, makeEvent({ type: 'merge:worktree:clear', timestamp: new Date().toISOString() }));
      } else {
        try {
          const { stdout } = await exec('git', ['branch', '--show-current'], { cwd: mergeWtPath });
          const currentBranch = stdout.trim();
          if (currentBranch !== this.featureBranch) {
            report.corrupt.push('__merge__');
            report.cleared.push('__merge__');
            try { await removeWorktree(this.repoRoot, mergeWtPath); } catch { /* best-effort */ }
            mutateState(state, makeEvent({ type: 'merge:worktree:clear', timestamp: new Date().toISOString() }));
          } else {
            report.valid.push('__merge__');
          }
        } catch {
          report.corrupt.push('__merge__');
          report.cleared.push('__merge__');
          try { await removeWorktree(this.repoRoot, mergeWtPath); } catch { /* best-effort */ }
          mutateState(state, makeEvent({ type: 'merge:worktree:clear', timestamp: new Date().toISOString() }));
        }
      }
    }

    // Check each plan's worktree
    for (const [planId, planState] of Object.entries(state.plans)) {
      const wtPath = planState.worktreePath;
      if (!wtPath) continue;

      if (!existsSync(wtPath)) {
        report.missing.push(planId);
        report.cleared.push(planId);
        planState.worktreePath = undefined;
        this.worktrees.delete(planId);
        if (planState.status === 'running') {
          mutateState(state, makeEvent({ type: 'plan:status:change', planId, status: 'pending', timestamp: new Date().toISOString() }));
        }
        continue;
      }

      try {
        const { stdout } = await exec('git', ['branch', '--show-current'], { cwd: wtPath });
        const currentBranch = stdout.trim();
        if (currentBranch !== planState.branch) {
          report.corrupt.push(planId);
          report.cleared.push(planId);
          try { await removeWorktree(this.repoRoot, wtPath); } catch { /* best-effort */ }
          planState.worktreePath = undefined;
          if (planState.status === 'running') {
            mutateState(state, makeEvent({ type: 'plan:status:change', planId, status: 'pending', timestamp: new Date().toISOString() }));
          }
        } else {
          report.valid.push(planId);
          if (!this.worktrees.has(planId)) {
            this.worktrees.set(planId, {
              type: 'plan',
              planId,
              path: wtPath,
              branch: planState.branch!,
              status: 'active',
              builtOnMerge: false,
            });
          }
        }
      } catch {
        report.corrupt.push(planId);
        report.cleared.push(planId);
        try { await removeWorktree(this.repoRoot, wtPath); } catch { /* best-effort */ }
        planState.worktreePath = undefined;
        if (planState.status === 'running') {
          mutateState(state, makeEvent({ type: 'plan:status:change', planId, status: 'pending', timestamp: new Date().toISOString() }));
        }
      }
    }

    return { report, events };
  }

  /**
   * Cleanup all managed worktrees and the worktree base directory.
   * Returns a structured CleanupReport.
   */
  async cleanupAll(): Promise<CleanupReport> {
    const report: CleanupReport = {
      removed: [],
      fallback: [],
      failed: [],
    };

    // Remove the merge worktree first
    try {
      const result = await removeWorktree(this.repoRoot, this.mergeWorktreePath);
      if (result.fallback) {
        report.fallback.push(this.mergeWorktreePath);
      } else {
        report.removed.push(this.mergeWorktreePath);
      }
    } catch {
      report.failed.push(this.mergeWorktreePath);
    }

    // Remove any remaining active plan worktrees
    for (const [, managed] of this.worktrees) {
      if (managed.status !== 'active' || managed.builtOnMerge) continue;

      try {
        const result = await removeWorktree(this.repoRoot, managed.path);
        managed.status = 'removed';
        if (result.fallback) {
          report.fallback.push(managed.path);
        } else {
          report.removed.push(managed.path);
        }
      } catch {
        report.failed.push(managed.path);
      }
    }

    // Prune git metadata and remove the base directory
    try {
      await cleanupWorktrees(this.repoRoot, this.worktreeBase);
    } catch {
      // Best-effort cleanup
    }

    return report;
  }
}
