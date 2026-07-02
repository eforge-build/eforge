/**
 * Pipeline runners — runCompilePipeline, runBuildPipeline, and the shared runReviewCycle helper.
 *
 * runReviewCycle is co-located here (rather than in the stages files) so that both
 * compile-stages and build-stages can import it without creating a cross-import cycle
 * between the two stages modules.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { stat } from 'node:fs/promises';

import type { EforgeEvent, AgentRole } from '../events.js';
import type { TracingContext } from '../tracing.js';
import type { AgentTerminalSubtype } from '../harness.js';
import {
  withRetry,
  DEFAULT_RETRY_POLICIES,
  RETRYABLE_INFRASTRUCTURE_SUBTYPES,
  type RetryPolicy,
  type EvaluatorContinuationInput,
} from '../retry.js';
import { runParallel, type ParallelTask } from '../concurrency.js';
import { forgeCommit } from '../git.js';
import { composeCommitMessage } from '../model-tracker.js';
import { discardEvaluationCandidateFixes, restoreEvaluationSnapshotAfterFailure, type EvaluationSnapshot } from '../evaluation/index.js';

import type { PipelineContext, BuildStageContext } from './types.js';
import { getCompileStage, getBuildStage } from './registry.js';
import { commitPlanArtifacts } from './git-helpers.js';
import { createToolTracker } from './span-wiring.js';

const exec = promisify(execFile);

async function restoreOriginalEvaluationHead(snapshot: EvaluationSnapshot): Promise<void> {
  await restoreEvaluationSnapshotAfterFailure(snapshot);
  await discardEvaluationCandidateFixes(snapshot);
  await exec('git', ['reset', '--hard', snapshot.originalHead ?? snapshot.baseHead], { cwd: snapshot.cwd });
}

async function hasEvaluationCandidateChanges(cwd: string): Promise<boolean> {
  try {
    const { stdout: tracked } = await exec('git', ['diff', '--name-only'], { cwd });
    if (tracked.trim().length > 0) return true;
    const { stdout: untracked } = await exec('git', ['ls-files', '--others', '--exclude-standard'], { cwd });
    return untracked.trim().length > 0;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Shared review cycle helper (used by both compile and build stages)
// ---------------------------------------------------------------------------

/**
 * Configuration for a review -> evaluate cycle.
 * Used by both compile (plan review) and build (code review) stages.
 */
export interface ReviewCycleConfig {
  tracing: TracingContext;
  cwd: string;
  reviewer: {
    role: AgentRole;
    metadata: Record<string, unknown>;
    run: () => AsyncGenerator<EforgeEvent>;
  };
  evaluator: {
    role: AgentRole;
    metadata: Record<string, unknown>;
    run: (input: EvaluatorContinuationInput) => AsyncGenerator<EforgeEvent>;
    prepareInput?: () => Promise<Partial<EvaluatorContinuationInput>>;
  };
}

/**
 * Compile reviewer roles that receive one infrastructure/transport retry.
 * Other reviewer roles (e.g. `reviewer` in build stages) use the non-retry path.
 */
const RETRIABLE_REVIEWER_ROLES = new Set<AgentRole>([
  'plan-reviewer',
]);

/**
 * Run a review -> evaluate cycle. The reviewer runs first (non-fatal on error).
 * If the reviewer left unstaged changes, the evaluator runs to accept/reject them.
 * Both phases are traced with Langfuse spans. The evaluator phase delegates
 * continuation handling to `withRetry` using the role-specific policy from
 * `DEFAULT_RETRY_POLICIES`.
 */
export async function* runReviewCycle(config: ReviewCycleConfig): AsyncGenerator<EforgeEvent> {
  // Phase: Review (non-fatal on error)
  const reviewSpan = config.tracing.createSpan(config.reviewer.role, config.reviewer.metadata);
  reviewSpan.setInput(config.reviewer.metadata);
  const reviewTracker = createToolTracker(reviewSpan);
  try {
    if (RETRIABLE_REVIEWER_ROLES.has(config.reviewer.role)) {
      // Compile reviewers get one infrastructure/transport retry before swallowing failure.
      const reviewerRetryPolicy: RetryPolicy<unknown> = {
        agent: config.reviewer.role,
        maxAttempts: 2,
        retryableSubtypes: RETRYABLE_INFRASTRUCTURE_SUBTYPES as ReadonlySet<AgentTerminalSubtype>,
        label: `${config.reviewer.role}-infrastructure-retry`,
      };
      yield* withRetry<unknown>(
        async function* (_input: unknown) {
          for await (const event of config.reviewer.run()) {
            reviewTracker.handleEvent(event);
            yield event;
          }
        },
        reviewerRetryPolicy,
        undefined,
      );
    } else {
      for await (const event of config.reviewer.run()) {
        reviewTracker.handleEvent(event);
        yield event;
      }
    }
    reviewTracker.cleanup();
    reviewSpan.end();
  } catch (err) {
    reviewTracker.cleanup();
    reviewSpan.error(err as Error);
    return; // Review failed, skip evaluate
  }

  // Phase: Evaluate (only if reviewer left unstaged changes, non-fatal)
  if (await hasEvaluationCandidateChanges(config.cwd)) {
    // Wrap the evaluator.run() callback so it pulls continuationContext out of
    // the retry input. The policy's buildContinuationInput splices it in.
    //
    // The tracing span and tool tracker are created per-attempt (inside this
    // wrapper) so each retry gets its own span and fresh tool-call state.
    const runEvaluatorWrapped = async function* (input: EvaluatorContinuationInput): AsyncGenerator<EforgeEvent> {
      const evalSpan = config.tracing.createSpan(config.evaluator.role, config.evaluator.metadata);
      evalSpan.setInput({ ...config.evaluator.metadata, ...(input.evaluationSnapshot && { evaluationSnapshot: input.evaluationSnapshot }) });
      const evalTracker = createToolTracker(evalSpan);
      try {
        for await (const event of config.evaluator.run(input)) {
          evalTracker.handleEvent(event);
          yield event;
        }
        evalTracker.cleanup();
        evalSpan.end();
      } catch (err) {
        evalTracker.cleanup();
        evalSpan.error(err as Error);
        throw err;
      }
    };

    let preparedInput: Partial<EvaluatorContinuationInput> = {};
    try {
      preparedInput = await config.evaluator.prepareInput?.() ?? {};
    } catch (err) {
      yield { timestamp: new Date().toISOString(), type: 'planning:error', reason: err instanceof Error ? err.message : String(err) };
      return;
    }

    const initialInput: EvaluatorContinuationInput = {
      worktreePath: config.cwd,
      ...preparedInput,
      evaluatorOptions: preparedInput.evaluatorOptions ?? {},
    };

    const evalPolicy = DEFAULT_RETRY_POLICIES[config.evaluator.role] as RetryPolicy<EvaluatorContinuationInput> | undefined;
    if (!evalPolicy) {
      // No policy registered for this role — run without retry.
      try {
        for await (const event of runEvaluatorWrapped(initialInput)) {
          yield event;
        }
      } catch {
        if (initialInput.evaluationSnapshot) {
          try {
            await restoreOriginalEvaluationHead(initialInput.evaluationSnapshot);
          } catch {
            // Preserve evaluator non-fatal behavior even if best-effort restore fails.
          }
        }
        // Wrapper already recorded span error; swallow so evaluate stays non-fatal.
      }
      return;
    }

    try {
      for await (const event of withRetry(runEvaluatorWrapped, evalPolicy, initialInput)) {
        yield event;
      }
    } catch {
      if (initialInput.evaluationSnapshot) {
        try {
          await restoreOriginalEvaluationHead(initialInput.evaluationSnapshot);
        } catch {
          // Preserve evaluator non-fatal behavior even if best-effort restore fails.
        }
      }
      // Per-attempt spans already recorded errors inside the wrapper;
      // swallow so evaluate remains non-fatal.
    }
  }
}

// ---------------------------------------------------------------------------
// Pipeline runners
// ---------------------------------------------------------------------------

/**
 * Compile stages whose reviewers read committed plan artifacts (and whose
 * evaluators snapshot against HEAD~1) — plan artifacts are committed before
 * each of these runs.
 */
const PLAN_ARTIFACT_COMMIT_STAGES = new Set([
  'planning-quality-review-cycle',
]);

/**
 * Run the compile pipeline stages in sequence.
 * Handles the git commit of plan artifacts before review-cycle stages.
 */
export async function* runCompilePipeline(
  ctx: PipelineContext,
): AsyncGenerator<EforgeEvent> {
  // Index-based iteration: re-read ctx.pipeline.compile on each iteration
  // instead of capturing it once via for...of, so mid-pipeline changes to
  // ctx.pipeline are honored.
  let i = 0;
  let restarts = 0;
  const MAX_RESTARTS = 5;
  while (i < ctx.pipeline.compile.length) {
    const stageName = ctx.pipeline.compile[i];
    if (PLAN_ARTIFACT_COMMIT_STAGES.has(stageName)) {
      // Commit plan artifacts before running review cycles
      // (reviewers read committed files)
      if (ctx.plans.length > 0) {
        const commitCwd = ctx.planCommitCwd ?? ctx.cwd;
        await commitPlanArtifacts(commitCwd, ctx.planSetName, ctx.cwd, ctx.config.plan.outputDir, ctx.modelTracker);
      }
    }
    const stage = getCompileStage(stageName);
    for await (const event of stage(ctx)) {
      if (event.type === 'agent:start') ctx.modelTracker.record(event.model);
      yield event;
    }
    if (ctx.skipped) break;
    // If the stage at our current position is still the one we just ran, it
    // ran to completion — advance past it. This handles composers that shrink
    // or grow the list (e.g. ['planner', 'plan-review-cycle'] → ['planner'])
    // without triggering a re-run of the planner stage.
    //
    // If position i now holds a different stage, the current stage was
    // effectively short-circuited (e.g. plannerStage early-returned when the
    // composer replaced the compile list). Restart from the top of the new list.
    if (ctx.pipeline.compile[i] === stageName) {
      i++;
    } else {
      if (++restarts > MAX_RESTARTS) {
        throw new Error('Compile pipeline restarted too many times — possible infinite loop');
      }
      i = 0;
    }
  }
}

/**
 * Run the build pipeline stages for a single plan.
 * Each entry in the build pipeline is either a single stage name (run sequentially)
 * or an array of stage names (run concurrently via `runParallel`).
 * After a parallel group completes, any uncommitted changes are auto-committed.
 */
export async function* runBuildPipeline(
  ctx: BuildStageContext,
): AsyncGenerator<EforgeEvent> {
  yield { timestamp: new Date().toISOString(), type: 'plan:build:start', planId: ctx.planId };

  for (const spec of ctx.build) {
    if (Array.isArray(spec)) {
      // Parallel group — run all stages concurrently
      const tasks: ParallelTask<EforgeEvent>[] = spec.map((stageName) => {
        const stage = getBuildStage(stageName);
        return {
          id: stageName,
          run: () => stage(ctx),
        };
      });
      for await (const event of runParallel(tasks)) {
        if (event.type === 'agent:start') ctx.modelTracker.record(event.model);
        yield event;
      }

      // After parallel group, commit any uncommitted changes left by stages that didn't self-commit (defense-in-depth)
      try {
        const { stdout: statusOut } = await exec('git', ['status', '--porcelain'], { cwd: ctx.worktreePath });
        if (statusOut.trim().length > 0) {
          await exec('git', ['add', '-A'], { cwd: ctx.worktreePath });
          await forgeCommit(ctx.worktreePath, composeCommitMessage(`chore(${ctx.planId}): post-parallel-group auto-commit`, ctx.modelTracker));
        }
      } catch (err) {
        // Non-critical — best-effort commit, but yield a warning so it's observable
        yield { timestamp: new Date().toISOString(), type: 'plan:build:progress', planId: ctx.planId, message: `post-parallel-group auto-commit failed: ${err instanceof Error ? err.message : String(err)}` };
      }
    } else {
      // Sequential stage
      const stage = getBuildStage(spec);
      for await (const event of stage(ctx)) {
        if (event.type === 'agent:start') ctx.modelTracker.record(event.model);
        yield event;
      }
    }

    // Stop pipeline if a stage signaled failure (e.g., implement stage)
    if (ctx.buildFailed) return;
  }

  // Final guard: fail the pipeline when the plan worktree has uncommitted changes at
  // the end of all build stages. A dirty worktree means implementation work was not
  // committed, which would produce a silent no-op merge. Non-git contexts (unit tests
  // without a real worktree) skip the check gracefully. Real git errors (index lock,
  // permission failures, corruption) are treated as hard failures.

  // Stat the worktree path first so that ENOENT from exec() is never misread as
  // "not a git repository". A missing worktree path means we are in a unit-test
  // context without a real worktree — skip gracefully. A path that exists but
  // where git fails for other reasons (permissions, corruption, missing binary)
  // is treated as a hard failure.
  let worktreeExists = false;
  try {
    await stat(ctx.worktreePath);
    worktreeExists = true;
  } catch {
    // Path does not exist — not a real worktree (unit test). Skip gracefully.
  }

  let isGitRepo = false;
  if (worktreeExists) {
    try {
      await exec('git', ['rev-parse', '--is-inside-work-tree'], { cwd: ctx.worktreePath });
      isGitRepo = true;
    } catch (err) {
      // Distinguish "not a git repository" (expected in unit tests without a real worktree)
      // from real git failures (permissions, corruption, dubious ownership, missing git binary).
      // The path exists (confirmed above), so ENOENT here means git itself could not be launched.
      const stderr = (err as NodeJS.ErrnoException & { stderr?: string }).stderr ?? '';
      const isNotGitRepo =
        stderr.includes('not a git repository') ||
        stderr.includes('not a git repo');
      if (!isNotGitRepo) {
        // A real Git error (or missing git binary) — treat as a hard failure.
        const errorMsg = `Dirty worktree guard: git failed: ${err instanceof Error ? err.message : String(err)}`;
        yield { timestamp: new Date().toISOString(), type: 'plan:build:failed', planId: ctx.planId, error: errorMsg };
        ctx.buildFailed = true;
        return;
      }
      // Not a git repository — skip the dirty worktree guard gracefully.
    }
  }
  if (isGitRepo) {
    try {
      const { stdout: dirtyOut } = await exec('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: ctx.worktreePath });
      const dirtyFiles = dirtyOut.trimEnd().split(/\r?\n/).filter(Boolean);
      if (dirtyFiles.length > 0) {
        const errorMsg = `Plan pipeline completed with ${dirtyFiles.length} uncommitted file(s) in the worktree:\n${dirtyFiles.join('\n')}`;
        yield { timestamp: new Date().toISOString(), type: 'plan:build:failed', planId: ctx.planId, error: errorMsg };
        ctx.buildFailed = true;
        return;
      }
    } catch (err) {
      const errorMsg = `Dirty worktree guard: git status failed: ${err instanceof Error ? err.message : String(err)}`;
      yield { timestamp: new Date().toISOString(), type: 'plan:build:failed', planId: ctx.planId, error: errorMsg };
      ctx.buildFailed = true;
      return;
    }
  }

  yield { timestamp: new Date().toISOString(), type: 'plan:build:complete', planId: ctx.planId };
}
