/**
 * Unified retry policy for pipeline agents.
 *
 * Per-agent retry/continuation handling used to live as ad-hoc loops inside
 * `pipeline.ts` — each loop reached for its own predicates (max-turns,
 * dropped-submission), built its own continuation input (plan-dir scan,
 * completed-diff, evaluator re-entry), and emitted its own domain
 * continuation event.
 *
 * This module consolidates the pattern:
 *
 *   const policy = DEFAULT_RETRY_POLICIES[role];
 *   yield* withRetry(runAgent, policy, initialInput);
 *
 * `withRetry` iterates up to `policy.maxAttempts` attempts, yields every
 * event from each attempt, emits a generic `agent:retry` event + any policy
 * `onRetry` events between attempts, and rethrows (or propagates a held-back
 * terminal event) once attempts are exhausted.
 */

import { execFile } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { promisify } from 'node:util';

import type { AgentTerminalSubtype } from './harness.js';
import { classifyAgentTerminalSubtype, isPlannerSubmissionError } from './harness.js';
import { forgeCommit } from './git.js';
import { composeCommitMessage } from './model-tracker.js';
import { parsePlanFile } from './plan.js';
import type { EforgeEvent, AgentRole } from './events.js';
import type { ShardScope } from './schemas.js';
import type { EvaluationSnapshot } from './evaluation/index.js';

const exec = promisify(execFile);

// ---------------------------------------------------------------------------
// Core types
// ---------------------------------------------------------------------------

/**
 * Summary of a just-failed attempt passed to policy hooks so they can decide
 * whether to retry and (if so) build the next attempt's input.
 */
export interface RetryAttemptInfo<Input> {
  /** 1-indexed attempt that just failed. */
  attempt: number;
  /** Maximum attempts allowed by the policy. */
  maxAttempts: number;
  /** Terminal subtype extracted from the thrown error or yielded terminal event. */
  subtype: AgentTerminalSubtype;
  /** Events yielded during the attempt (including any held-back terminal event). */
  events: EforgeEvent[];
  /** The input that was passed to the attempt that just failed. */
  prevInput: Input;
  /** The error thrown by the attempt, if any (undefined when the attempt yielded a terminal event but did not throw). */
  error?: unknown;
}

/**
 * A continuation decision returned by `RetryPolicy.buildContinuationInput`.
 *
 * - `retry` — run another attempt with `input`.
 * - `abort-success` — stop retrying and treat the current state as a success.
 *   Used by the evaluator to short-circuit when the worktree became clean
 *   during the failed attempt (nothing left to evaluate).
 */
export type ContinuationDecision<Input> =
  | { kind: 'retry'; input: Input }
  | { kind: 'abort-success' };

/**
 * Retry policy for a single agent role.
 *
 * A policy describes:
 * - Which terminal subtypes are retryable (`retryableSubtypes`).
 * - An optional predicate that can approve retries based on events the agent
 *   emitted (`shouldRetry`) — used by the planner to detect dropped
 *   submissions which don't correspond to an SDK terminal subtype.
 * - How to build the next attempt's input given the failed attempt's events
 *   (`buildContinuationInput`). This is where agent-specific side effects
 *   like committing plan artifacts or building a completed-diff live.
 * - An optional `onRetry` hook that emits agent-specific continuation events
 *   (e.g. `plan:continuation`, `build:implement:continuation`) in addition
 *   to the generic `agent:retry` event emitted by the wrapper.
 */
export interface RetryPolicy<Input> {
  /** Agent role this policy applies to — used to stamp the `agent:retry` event. */
  agent: AgentRole;
  /** Total attempts allowed (`maxAttempts >= 1`). Retries allowed = `maxAttempts - 1`. */
  maxAttempts: number;
  /** Terminal subtypes that trigger a retry. */
  retryableSubtypes: ReadonlySet<AgentTerminalSubtype>;
  /** Optional extra predicate evaluated when `retryableSubtypes.has(subtype)` is false. */
  shouldRetry?: (info: RetryAttemptInfo<Input>) => boolean;
  /** Compute the next attempt's input from the failed attempt. May perform side effects (git, fs). */
  buildContinuationInput?: (info: RetryAttemptInfo<Input>) => Promise<ContinuationDecision<Input>> | ContinuationDecision<Input>;
  /** Emit agent-specific continuation events (e.g. `plan:continuation`) alongside `agent:retry`. */
  onRetry?: (info: RetryAttemptInfo<Input>) => EforgeEvent[];
  /** Short human-readable label used in the `agent:retry` event (e.g. `'planner-continuation'`). */
  label: string;
  /** Optional planId extraction for the `agent:retry` event. */
  planIdFromInput?: (input: Input) => string | undefined;
  /** Optional shardId extraction for the `agent:retry` event. */
  shardIdFromInput?: (input: Input) => string | undefined;
  /**
   * Optional hook called after classifying a terminal subtype.
   * If it returns true, the terminal error is downgraded to a warning (terminal success):
   * no new attempt is started, `onTerminalSuccess` events are emitted (if any),
   * the held-back terminal event is dropped, and the last successful result is returned.
   */
  terminalSuccessWhen?: (info: RetryAttemptInfo<Input>) => boolean | Promise<boolean>;
  /**
   * Emit domain events when `terminalSuccessWhen` triggers terminal success.
   * Typically used to emit an `agent:warning` event with a stable code.
   */
  onTerminalSuccess?: (info: RetryAttemptInfo<Input>) => EforgeEvent[];
}

// ---------------------------------------------------------------------------
// Predicates
// ---------------------------------------------------------------------------

/**
 * Returns true when attempt events contain an authoritative planner completion:
 * `planning:complete`, `planning:skip`, or `expedition:architecture:complete`.
 * Used to decide whether a late retryable infrastructure/transport error can be
 * downgraded to a warning instead of propagated.
 */
export function hasAuthoritativePlannerCheckpoint(events: readonly EforgeEvent[]): boolean {
  return events.some(
    (ev) =>
      ev.type === 'planning:complete' ||
      ev.type === 'planning:skip' ||
      ev.type === 'expedition:architecture:complete',
  );
}

/**
 * Returns true only when none of the planner boundary events have appeared:
 * `planning:submission`, `planning:skip`, `planning:complete`, or
 * `expedition:architecture:complete`. When all four are absent, the planner
 * has not yet produced any authoritative side-effect (file write or submission)
 * so rerunning is safe.
 */
export function isBeforePlannerSubmissionBoundary(events: readonly EforgeEvent[]): boolean {
  return !events.some(
    (ev) =>
      ev.type === 'planning:submission' ||
      ev.type === 'planning:skip' ||
      ev.type === 'planning:complete' ||
      ev.type === 'expedition:architecture:complete',
  );
}

/**
 * Returns true for terminal subtypes that indicate retryable infrastructure
 * or transport failures: `error_transient_transport` and
 * `error_pi_tool_infrastructure`.
 */
export function isRetryableInfrastructureSubtype(subtype: AgentTerminalSubtype): boolean {
  return subtype === 'error_transient_transport' || subtype === 'error_pi_tool_infrastructure';
}

export class EvaluatorNoVerdictsError extends Error {
  constructor(message = 'Evaluator produced no verdicts; review-fixer changes remain uncommitted.') {
    super(message);
    this.name = 'EvaluatorNoVerdictsError';
  }
}

export function isEvaluatorNoVerdictsError(err: unknown): err is EvaluatorNoVerdictsError {
  return err instanceof EvaluatorNoVerdictsError;
}

/** Extract an agent ID from attempt events, with a deterministic fallback. */
function extractAgentId(events: readonly EforgeEvent[], fallback: string): string {
  for (const ev of events) {
    if (ev.type === 'agent:start' && 'agentId' in ev && ev.agentId) return ev.agentId as string;
    if (ev.type === 'agent:result' && 'agentId' in ev && (ev as { agentId?: string }).agentId) {
      return (ev as { agentId: string }).agentId;
    }
  }
  return fallback;
}

/**
 * True when the events collected during a failed planner attempt indicate a
 * dropped submission — the agent completed the stream without calling either
 * of the submission tools (`submit_plan_set` / `submit_architecture`) and
 * without emitting a `<skip>` block that the planner surfaces as `plan:skip`.
 *
 * The check is "absence of a successful submission" rather than "presence of
 * a PlannerSubmissionError" so it works from just the event record, keeping
 * the predicate usable without the thrown error.
 */
export function isDroppedSubmission(events: readonly EforgeEvent[]): boolean {
  let sawSubmissionToolUse = false;
  let sawSkip = false;
  for (const ev of events) {
    if (ev.type === 'agent:tool_use' && isPlannerSubmissionToolName(ev.tool)) {
      sawSubmissionToolUse = true;
    }
    if (ev.type === 'planning:skip') {
      sawSkip = true;
    }
  }
  return !sawSubmissionToolUse && !sawSkip;
}

function isPlannerSubmissionToolName(tool: string): boolean {
  return tool === 'submit_plan_set' || tool === 'submit_architecture' || tool.endsWith('__submit_plan_set') || tool.endsWith('__submit_architecture');
}

export function hasCompactInspectionContinuation(events: readonly EforgeEvent[]): boolean {
  return events.some((ev) => ev.type === 'planning:inspection-summary');
}

// ---------------------------------------------------------------------------
// Internal helpers (duplicated from pipeline.ts to avoid circular imports)
// ---------------------------------------------------------------------------

/**
 * Commit plan artifacts as a checkpoint. No-ops safely when the plan directory
 * does not exist (happens on a dropped-submission retry where no files were
 * written). Mirrors the implementation in pipeline.ts — kept here so the
 * planner continuation builder can drive the side effect without creating
 * a circular dependency with `pipeline.ts`.
 */
export async function commitPlanArtifacts(
  commitCwd: string,
  planSetName: string,
  planFilesCwd?: string,
  outputDir?: string,
): Promise<void> {
  const planDir = resolve(planFilesCwd ?? commitCwd, outputDir ?? 'eforge/plans', planSetName);
  if (!existsSync(planDir)) return;
  await exec('git', ['add', planDir], { cwd: commitCwd });
  const { stdout: staged } = await exec('git', ['diff', '--cached', '--name-only'], { cwd: commitCwd });
  if (staged.trim().length === 0) return;
  await forgeCommit(commitCwd, composeCommitMessage(`plan(${planSetName}): initial planning artifacts`));
}

/**
 * Build a truncating continuation diff from a worktree. Mirrors the
 * implementation in pipeline.ts.
 */
export async function buildContinuationDiff(cwd: string, baseBranch: string): Promise<string> {
  const DIFF_CHAR_LIMIT = 50_000;
  const { stdout: diff } = await exec('git', ['diff', `${baseBranch}...HEAD`], { cwd });
  if (diff.length <= DIFF_CHAR_LIMIT) return diff;
  const { stdout: stat } = await exec('git', ['diff', '--stat', `${baseBranch}...HEAD`], { cwd });
  return `[Diff too large (${diff.length} chars) — showing file summary instead]\n\n${stat}`;
}

/** Check if a worktree has evaluator candidate changes, including untracked files. */
async function hasUnstagedChangesInternal(cwd: string): Promise<boolean> {
  try {
    const { stdout: tracked } = await exec('git', ['diff', '--name-only'], { cwd });
    if (tracked.trim().length > 0) return true;
    const { stdout: untracked } = await exec('git', ['ls-files', '--others', '--exclude-standard'], { cwd });
    return untracked.trim().length > 0;
  } catch {
    return false;
  }
}

/** Check if a worktree has any working-tree changes (staged or unstaged). */
async function hasAnyChanges(cwd: string): Promise<boolean> {
  try {
    const { stdout } = await exec('git', ['status', '--porcelain'], { cwd });
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Continuation-input builders (per-agent)
// ---------------------------------------------------------------------------

/**
 * Shape of the side-effect context a planner continuation builder needs.
 * Callers stash this into the planner Input so the continuation builder can
 * reach the right cwd / output dir without fishing through options.
 */
export interface PlannerContinuationSideEffects {
  cwd: string;
  planCommitCwd?: string;
  planSetName: string;
  outputDir: string;
}

/**
 * Minimal shape of the planner input the continuation builder must be able
 * to splice a `continuationContext` into. Real callers pass the full
 * `PlannerOptions`-shaped object; this type just pins the fields the
 * continuation builder touches, keeping the policy reusable.
 */
export interface PlannerContinuationInput {
  sideEffects: PlannerContinuationSideEffects;
  plannerOptions: Record<string, unknown> & {
    continuationContext?: {
      attempt: number;
      maxContinuations: number;
      existingPlans: string;
      reason: 'max_turns' | 'dropped_submission';
    };
  };
}

/**
 * Build the next planner attempt's input:
 * - Checkpoint plan artifacts via `commitPlanArtifacts` (side effect).
 * - Scan the plan directory (skip scan on dropped_submission) to build the
 *   `existingPlans` summary.
 * - Splice `continuationContext` into the planner options.
 */
export async function buildPlannerContinuationInput(
  info: RetryAttemptInfo<PlannerContinuationInput>,
): Promise<ContinuationDecision<PlannerContinuationInput>> {
  const { sideEffects, plannerOptions } = info.prevInput;
  const reason: 'max_turns' | 'dropped_submission' =
    info.subtype === 'error_max_turns' ? 'max_turns' : 'dropped_submission';

  // Checkpoint plan files written so far. Safe no-op when the plan dir
  // doesn't exist (dropped-submission attempts typically wrote nothing).
  await commitPlanArtifacts(
    sideEffects.planCommitCwd ?? sideEffects.cwd,
    sideEffects.planSetName,
    sideEffects.cwd,
    sideEffects.outputDir,
  );

  let existingPlans: string;
  if (reason === 'dropped_submission') {
    existingPlans = '[No existing plans — previous attempt did not submit]';
  } else {
    existingPlans = '[No existing plans found]';
    const planDir = resolve(sideEffects.cwd, sideEffects.outputDir, sideEffects.planSetName);
    if (existsSync(planDir)) {
      try {
        const entries = await readdir(planDir);
        const mdFiles = entries.filter((f) => f.endsWith('.md')).sort();
        const summaries: string[] = [];
        for (const file of mdFiles) {
          try {
            const plan = await parsePlanFile(resolve(planDir, file));
            summaries.push(`- **${plan.id}**: ${plan.name}`);
          } catch {
            summaries.push(`- ${file} (could not parse frontmatter)`);
          }
        }
        if (summaries.length > 0) existingPlans = summaries.join('\n');
      } catch {
        // Leave default text.
      }
    }
  }

  const nextAttempt = info.attempt; // 1-indexed attempt that just failed; next attempt = attempt (since event uses 1-indexed for the upcoming run)
  const nextInput: PlannerContinuationInput = {
    sideEffects,
    plannerOptions: {
      ...plannerOptions,
      continuationContext: {
        attempt: nextAttempt,
        maxContinuations: info.maxAttempts - 1,
        existingPlans,
        reason,
      },
    },
  };
  return { kind: 'retry', input: nextInput };
}

/**
 * Discriminated union describing how a builder continuation handoff was prepared.
 *
 * - `checkpointed-diff`: the worktree had changes; they were staged and committed.
 *   The `completedDiff` contains the cumulative diff from the base branch.
 * - `discovery-only`: the worktree was clean; no commit was made. The discovery
 *   fields capture what the previous attempt explored so the next attempt can
 *   resume without cold-starting codebase exploration.
 */
export type BuilderContinuationContext =
  | { attempt: number; maxContinuations: number; handoffMode: 'checkpointed-diff'; completedDiff: string }
  | {
      attempt: number;
      maxContinuations: number;
      handoffMode: 'discovery-only';
      filesInspected: string[];
      searches: string[];
      commands: string[];
      recentMessages: string[];
      toolResultSnippets: string[];
    };

/**
 * Shape of the builder input the continuation builder must be able to
 * augment with the continuation context.
 */
export interface BuilderContinuationInput {
  worktreePath: string;
  baseBranch: string;
  planId: string;
  builderOptions: Record<string, unknown> & {
    continuationContext?: BuilderContinuationContext;
  };
}

/**
 * Build the next builder attempt's input:
 * - If the worktree has changes: stage all, checkpoint commit, capture a completed diff,
 *   and return a `checkpointed-diff` continuation.
 * - If the worktree is clean (no changes): extract bounded discovery context from
 *   builder events in the attempt and return a `discovery-only` continuation without
 *   committing anything.
 */
export async function buildBuilderContinuationInput(
  info: RetryAttemptInfo<BuilderContinuationInput>,
): Promise<ContinuationDecision<BuilderContinuationInput>> {
  const { worktreePath, baseBranch, planId, builderOptions } = info.prevInput;

  const hasChanges = await hasAnyChanges(worktreePath);

  if (!hasChanges) {
    // No worktree changes — build a discovery-only handoff from the attempt's events.
    const discovery = extractBuilderDiscoveryContext(info.events);
    const nextInput: BuilderContinuationInput = {
      worktreePath,
      baseBranch,
      planId,
      builderOptions: {
        ...builderOptions,
        continuationContext: {
          attempt: info.attempt,
          maxContinuations: info.maxAttempts - 1,
          handoffMode: 'discovery-only',
          filesInspected: discovery.filesInspected,
          searches: discovery.searches,
          commands: discovery.commands,
          recentMessages: discovery.recentMessages,
          toolResultSnippets: discovery.toolResultSnippets,
        },
      },
    };
    return { kind: 'retry', input: nextInput };
  }

  // Worktree has changes — stage all, commit checkpoint, and build a diff handoff.
  await exec('git', ['add', '-A'], { cwd: worktreePath });
  await forgeCommit(
    worktreePath,
    composeCommitMessage(`wip(${planId}): continuation checkpoint (attempt ${info.attempt + 1})`),
  );

  let completedDiff: string;
  try {
    completedDiff = await buildContinuationDiff(worktreePath, baseBranch);
  } catch {
    completedDiff = '[Unable to generate diff]';
  }

  const nextInput: BuilderContinuationInput = {
    worktreePath,
    baseBranch,
    planId,
    builderOptions: {
      ...builderOptions,
      continuationContext: {
        attempt: info.attempt,
        maxContinuations: info.maxAttempts - 1,
        handoffMode: 'checkpointed-diff',
        completedDiff,
      },
    },
  };
  return { kind: 'retry', input: nextInput };
}

/**
 * Extended shape of the builder input for sharded builds.
 * Extends BuilderContinuationInput with shard identity and scope.
 * Used by buildShardedBuilderContinuationInput and the shard-specific retry policy.
 */
export interface BuilderShardContinuationInput extends BuilderContinuationInput {
  /** Shard identifier for this shard instance. */
  shardId: string;
  /** Scope definition (roots and/or files) owned by this shard. */
  shardScope: ShardScope;
}

/** Returns true if a file path is within a shard's declared scope. */
function fileMatchesShardScope(file: string, shardScope: ShardScope): boolean {
  if (shardScope.roots) {
    for (const root of shardScope.roots) {
      const prefix = root.endsWith('/') ? root : `${root}/`;
      if (file.startsWith(prefix) || file === root) return true;
    }
  }
  if (shardScope.files) {
    for (const f of shardScope.files) {
      if (file === f) return true;
    }
  }
  return false;
}

/**
 * Check whether any files with index or working-tree changes match a shard's scope.
 * Returns true when ANY scoped status entry exists — staged, unstaged, or untracked.
 * Used by buildShardedBuilderContinuationInput to decide whether to stash or go discovery-only.
 */
async function hasShardScopeChanges(cwd: string, shardScope: ShardScope): Promise<boolean> {
  try {
    const { stdout } = await exec('git', ['status', '--porcelain'], { cwd });
    const lines = stdout.trim().split('\n').filter(Boolean);
    for (const line of lines) {
      // Each line: XY <file> (status is 2 chars + space)
      const file = line.slice(3).trim().replace(/^"(.*)"$/, '$1');
      if (fileMatchesShardScope(file, shardScope)) return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Check whether any files in the *working tree* (unstaged or untracked) match a shard's scope.
 * This is the narrower check used to decide whether to stash: staged-only changes cannot be
 * stashed with --keep-index and require a different code path.
 */
async function hasShardScopeWorktreeChanges(cwd: string, shardScope: ShardScope): Promise<boolean> {
  try {
    const { stdout } = await exec('git', ['status', '--porcelain'], { cwd });
    const lines = stdout.trim().split('\n').filter(Boolean);
    for (const line of lines) {
      const file = line.slice(3).trim().replace(/^"(.*)"$/, '$1');
      const wtStatus = line[1];
      // Working-tree column is non-space for modified/deleted/untracked working-tree entries.
      if (wtStatus === ' ' || wtStatus === undefined) continue;
      if (fileMatchesShardScope(file, shardScope)) return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Stage any untracked files in the shard's scope so that git pathspec matching works
 * during stash. Without this, `git stash push -- <pathspec>` fails with
 * "pathspec did not match any file(s) known to git" for purely untracked files.
 */
async function stageUntrackedFilesInScope(cwd: string, shardScope: ShardScope): Promise<void> {
  const { stdout } = await exec('git', ['status', '--porcelain'], { cwd });
  const lines = stdout.trim().split('\n').filter(Boolean);
  const toStage: string[] = [];

  for (const line of lines) {
    // '??' indicates a completely untracked file
    if (line.slice(0, 2) !== '??') continue;
    const file = line.slice(3).trim().replace(/^"(.*)"$/, '$1');
    if (fileMatchesShardScope(file, shardScope)) {
      toStage.push(file);
    }
  }

  if (toStage.length > 0) {
    await exec('git', ['add', '--', ...toStage], { cwd });
  }
}

/**
 * Build the next shard-builder attempt's input:
 * - When the shard's scope has **no** status entries at all (clean): returns a
 *   discovery-only retry using exploration context from the failed attempt's events.
 * - When the shard's scope has **staged-only** changes (no working-tree changes):
 *   builds a `checkpointed-diff` continuation using `git diff --cached` so the
 *   staged diff is preserved in the next attempt's context without stashing.
 * - When the shard's scope has working-tree changes: stashes them with
 *   `git stash push --keep-index -m "eforge-shard-<id>-attempt-<N>" -- <scope-paths>`,
 *   builds a completedDiff from the stash, and returns a `checkpointed-diff` continuation.
 */
export async function buildShardedBuilderContinuationInput(
  info: RetryAttemptInfo<BuilderShardContinuationInput>,
): Promise<ContinuationDecision<BuilderShardContinuationInput>> {
  const { worktreePath, baseBranch, planId, shardId, shardScope, builderOptions } = info.prevInput;

  // Check if there are any scoped status entries (index or working-tree).
  const hasScopeChanges = await hasShardScopeChanges(worktreePath, shardScope);
  if (!hasScopeChanges) {
    // No scoped status entries at all — build a discovery-only handoff from the attempt's events.
    const discovery = extractBuilderDiscoveryContext(info.events);
    const nextInput: BuilderShardContinuationInput = {
      worktreePath,
      baseBranch,
      planId,
      shardId,
      shardScope,
      builderOptions: {
        ...builderOptions,
        continuationContext: {
          attempt: info.attempt,
          maxContinuations: info.maxAttempts - 1,
          handoffMode: 'discovery-only',
          filesInspected: discovery.filesInspected,
          searches: discovery.searches,
          commands: discovery.commands,
          recentMessages: discovery.recentMessages,
          toolResultSnippets: discovery.toolResultSnippets,
        },
      },
    };
    return { kind: 'retry', input: nextInput };
  }

  // Check if the scoped changes are working-tree changes (stashable) or staged-only.
  const hasWorktreeScopeChanges = await hasShardScopeWorktreeChanges(worktreePath, shardScope);
  if (!hasWorktreeScopeChanges) {
    // Staged-only scoped changes — cannot stash with --keep-index without losing nothing.
    // Build a continuation context from the staged diff so the next attempt has context.
    const scopePaths: string[] = [
      ...(shardScope.roots ?? []),
      ...(shardScope.files ?? []),
    ];
    let completedDiff: string;
    try {
      const diffArgs = ['diff', '--cached'];
      if (scopePaths.length > 0) diffArgs.push('--', ...scopePaths);
      const { stdout: stagedDiff } = await exec('git', diffArgs, { cwd: worktreePath });
      const DIFF_CHAR_LIMIT = 50_000;
      completedDiff = stagedDiff.length <= DIFF_CHAR_LIMIT
        ? stagedDiff
        : `[Diff too large (${stagedDiff.length} chars) — showing partial]\n${stagedDiff.slice(0, DIFF_CHAR_LIMIT)}`;
    } catch {
      completedDiff = '[Unable to generate staged diff]';
    }
    const nextInput: BuilderShardContinuationInput = {
      worktreePath,
      baseBranch,
      planId,
      shardId,
      shardScope,
      builderOptions: {
        ...builderOptions,
        continuationContext: {
          attempt: info.attempt,
          maxContinuations: info.maxAttempts - 1,
          handoffMode: 'checkpointed-diff',
          completedDiff,
        },
      },
    };
    return { kind: 'retry', input: nextInput };
  }

  // Build the list of scope paths for the stash
  const scopePaths: string[] = [
    ...(shardScope.roots ?? []),
    ...(shardScope.files ?? []),
  ];

  // Stage any untracked files in scope so the pathspec is known to git.
  // Without this, `git stash push -- <pathspec>` fails for purely untracked files.
  await stageUntrackedFilesInScope(worktreePath, shardScope);

  // Stash working-tree changes in the shard's scope only; keep staged changes staged.
  const stashMessage = `eforge-shard-${shardId}-attempt-${info.attempt}`;
  const stashArgs = ['stash', 'push', '--keep-index', '-m', stashMessage];
  if (scopePaths.length > 0) {
    stashArgs.push('--', ...scopePaths);
  }
  await exec('git', stashArgs, { cwd: worktreePath });

  // Capture the stash diff for the continuation context (truncated to 50k chars)
  let completedDiff: string;
  try {
    const { stdout: stashDiff } = await exec('git', ['stash', 'show', '-p', 'stash@{0}'], { cwd: worktreePath });
    const DIFF_CHAR_LIMIT = 50_000;
    completedDiff = stashDiff.length <= DIFF_CHAR_LIMIT
      ? stashDiff
      : `[Diff too large (${stashDiff.length} chars) — showing partial]\n${stashDiff.slice(0, DIFF_CHAR_LIMIT)}`;
  } catch {
    completedDiff = '[Unable to generate stash diff]';
  }

  const nextInput: BuilderShardContinuationInput = {
    worktreePath,
    baseBranch,
    planId,
    shardId,
    shardScope,
    builderOptions: {
      ...builderOptions,
      continuationContext: {
        attempt: info.attempt,
        maxContinuations: info.maxAttempts - 1,
        handoffMode: 'checkpointed-diff',
        completedDiff,
      },
    },
  };
  return { kind: 'retry', input: nextInput };
}

/**
 * Build a retry policy for a single sharded builder instance.
 * Uses stash-based checkpoints instead of commit-based (so concurrent shards don't race on HEAD).
 * Each shard gets its own retry budget.
 */
export function buildShardPolicy(
  shardId: string,
  maxAttempts: number,
): RetryPolicy<BuilderShardContinuationInput> {
  return {
    agent: 'builder',
    maxAttempts,
    retryableSubtypes: new Set([
      'error_max_turns',
      'error_transient_transport',
      'error_pi_tool_infrastructure',
    ]) as ReadonlySet<AgentTerminalSubtype>,
    buildContinuationInput: (info) =>
      buildShardedBuilderContinuationInput(info as RetryAttemptInfo<BuilderShardContinuationInput>) as Promise<ContinuationDecision<BuilderShardContinuationInput>>,
    onRetry: (info) => {
      const input = info.prevInput as BuilderShardContinuationInput;
      return [{
        timestamp: new Date().toISOString(),
        type: 'plan:build:implement:continuation',
        planId: input.planId,
        attempt: info.attempt,
        maxContinuations: info.maxAttempts - 1,
        shardId,
      }];
    },
    planIdFromInput: (input) => (input as BuilderShardContinuationInput).planId,
    shardIdFromInput: (input) => (input as BuilderShardContinuationInput).shardId,
    label: `builder-shard-${shardId}-continuation`,
  };
}

// ---------------------------------------------------------------------------
// Review-fixer continuation types and builder
// ---------------------------------------------------------------------------

/**
 * Context passed to the next review-fixer attempt's prompt so the agent
 * knows what was already fixed and doesn't repeat work.
 */
export interface ReviewFixerContinuationContext {
  /** 1-indexed number of the upcoming attempt (i.e. the attempt that just failed + 1). */
  attempt: number;
  /** Total continuations allowed (= maxAttempts - 1). */
  maxContinuations: number;
  /** Truncated diff of fixes already applied (from `git diff HEAD --`). */
  partialDiff: string;
  /** Untracked files present in the working tree (new files not yet tracked by git). */
  untrackedFiles?: string[];
  /** Files the previous attempt read or inspected. */
  filesInspected?: string[];
  /** Search and glob queries the previous attempt ran. */
  searches?: string[];
  /** Shell commands the previous attempt executed. */
  commands?: string[];
  /** Recent agent messages from the previous attempt (bounded). */
  recentMessages?: string[];
  /** Truncated tool-result snippets for useful findings. */
  toolResultSnippets?: string[];
}

// ---------------------------------------------------------------------------
// Discovery context extraction
// ---------------------------------------------------------------------------

const MAX_FILES_INSPECTED = 20;
const MAX_SEARCHES = 20;
const MAX_COMMANDS = 15;
const MAX_RECENT_MESSAGES = 5;
const MAX_TOOL_RESULT_SNIPPETS = 8;
const TOOL_RESULT_SNIPPET_LENGTH = 500;
/** Maximum character length for a single recent agent message included in the handoff context. */
const MAX_RECENT_MESSAGE_LENGTH = 2_000;
/** Maximum character length for a single search/glob summary string. */
const MAX_SEARCH_SUMMARY_LENGTH = 300;

export interface DiscoveryContext {
  filesInspected: string[];
  searches: string[];
  commands: string[];
  recentMessages: string[];
  toolResultSnippets: string[];
}

/**
 * Derive bounded discovery context from a failed agent's events, filtered by agent name.
 *
 * - Filters to events where `agent === agentName`.
 * - Processes `agent:tool_use` for Read, Grep, Glob, and Bash tool names.
 * - Pairs `agent:tool_result` with prior tool uses via `toolUseId` for snippets.
 * - Collects `agent:message` content as recent messages.
 * - Deduplicates file/search/command summaries; truncates snippet content.
 */
export function extractAgentDiscoveryContext(events: readonly EforgeEvent[], agentName: string): DiscoveryContext {
  const filesInspectedSet = new Set<string>();
  const searchesSet = new Set<string>();
  const commandsSet = new Set<string>();
  const recentMessages: string[] = [];
  const toolResultSnippets: string[] = [];

  // Index tool_use events by toolUseId for pairing with tool_result
  const toolUseIndex = new Map<string, { tool: string }>();

  for (const ev of events) {
    // Filter to the specified agent's events only
    if (!('agent' in ev) || (ev as { agent?: string }).agent !== agentName) continue;

    if (ev.type === 'agent:tool_use') {
      const tool = ev.tool as string;
      const input: Record<string, unknown> = typeof ev.input === 'object' && ev.input !== null
        ? ev.input as Record<string, unknown>
        : {};
      toolUseIndex.set(ev.toolUseId as string, { tool });

      if (tool === 'Read') {
        const filePath = typeof input.file_path === 'string' ? input.file_path : String(input.file_path ?? '');
        if (filePath) filesInspectedSet.add(filePath);
      } else if (tool === 'Grep') {
        const pattern = typeof input.pattern === 'string' ? input.pattern : '';
        const path = typeof input.path === 'string' ? ` in ${input.path}` : '';
        const rawSummary = `grep: ${pattern}${path}`.trim();
        const summary = rawSummary.length > MAX_SEARCH_SUMMARY_LENGTH
          ? `${rawSummary.slice(0, MAX_SEARCH_SUMMARY_LENGTH)}...`
          : rawSummary;
        if (pattern) searchesSet.add(summary);
      } else if (tool === 'Glob') {
        const pattern = typeof input.pattern === 'string' ? input.pattern : '';
        const rawSummary = `glob: ${pattern}`;
        const summary = rawSummary.length > MAX_SEARCH_SUMMARY_LENGTH
          ? `${rawSummary.slice(0, MAX_SEARCH_SUMMARY_LENGTH)}...`
          : rawSummary;
        if (pattern) searchesSet.add(summary);
      } else if (tool === 'Bash') {
        const cmd = typeof input.command === 'string'
          ? input.command.slice(0, 200)
          : '';
        if (cmd) commandsSet.add(cmd);
      }
    } else if (ev.type === 'agent:tool_result') {
      const toolUse = toolUseIndex.get(ev.toolUseId as string);
      const output = ev.output as string;
      if (toolUse && ['Read', 'Grep', 'Glob', 'Bash'].includes(toolUse.tool) && output.trim()) {
        const snippet = output.length > TOOL_RESULT_SNIPPET_LENGTH
          ? `${output.slice(0, TOOL_RESULT_SNIPPET_LENGTH)}...`
          : output;
        toolResultSnippets.push(`[${toolUse.tool}] ${snippet}`);
      }
    } else if (ev.type === 'agent:message') {
      const content = ev.content as string;
      const truncated = content.length > MAX_RECENT_MESSAGE_LENGTH
        ? `${content.slice(0, MAX_RECENT_MESSAGE_LENGTH)}...`
        : content;
      recentMessages.push(truncated);
    }
  }

  return {
    filesInspected: [...filesInspectedSet].slice(-MAX_FILES_INSPECTED),
    searches: [...searchesSet].slice(-MAX_SEARCHES),
    commands: [...commandsSet].slice(-MAX_COMMANDS),
    recentMessages: recentMessages.slice(-MAX_RECENT_MESSAGES),
    toolResultSnippets: toolResultSnippets.slice(-MAX_TOOL_RESULT_SNIPPETS),
  };
}

/**
 * Derive bounded discovery context from a failed review-fixer attempt's events.
 * Wrapper around `extractAgentDiscoveryContext` filtered to the `review-fixer` agent.
 */
export function extractReviewFixerDiscoveryContext(events: readonly EforgeEvent[]): DiscoveryContext {
  return extractAgentDiscoveryContext(events, 'review-fixer');
}

/**
 * Derive bounded discovery context from a failed builder attempt's events.
 * Wrapper around `extractAgentDiscoveryContext` filtered to the `builder` agent.
 */
export function extractBuilderDiscoveryContext(events: readonly EforgeEvent[]): DiscoveryContext {
  return extractAgentDiscoveryContext(events, 'builder');
}

/**
 * Input shape the review-fixer continuation builder reads and returns.
 */
export interface ReviewFixerContinuationInput {
  /** Working directory (the worktree where the review-fixer operates). */
  cwd: string;
  /** Plan identifier — passed through to the `plan:build:review:fix:continuation` event. */
  planId: string;
  /** Zero-based review-cycle round for lifecycle event metadata. */
  round?: number;
  /** Options forwarded to `runReviewFixer`. */
  reviewFixerOptions: Record<string, unknown> & {
    continuationContext?: ReviewFixerContinuationContext;
  };
}

/** Character limit for the partial diff passed to the review-fixer continuation prompt. */
const REVIEW_FIXER_DIFF_CHAR_LIMIT = 40_000;

/**
 * Build the next review-fixer attempt's input:
 * - Read `git diff HEAD --` (working-tree changes since HEAD — unstaged by design).
 * - If there are no changes, return `{ kind: 'retry' }` with an empty diff so
 *   the next attempt starts fresh (the fixer made no progress but we still give
 *   it another chance, using discovery context from the failed attempt).
 * - Extract bounded discovery context (files inspected, searches, commands,
 *   recent messages, tool-result snippets) from the failed attempt's events.
 * - Splice `continuationContext` with the partial diff and discovery context
 *   into the options.
 *
 * NOTE: This function is intentionally read-only with respect to git.
 * The review-fixer invariant is that it NEVER stages or commits changes.
 */
export async function buildReviewFixerContinuationInput(
  info: RetryAttemptInfo<ReviewFixerContinuationInput>,
): Promise<ContinuationDecision<ReviewFixerContinuationInput>> {
  const { cwd, planId, round, reviewFixerOptions } = info.prevInput;

  let partialDiff = '';
  try {
    const { stdout } = await exec('git', ['diff', 'HEAD', '--'], { cwd });
    partialDiff = stdout.length <= REVIEW_FIXER_DIFF_CHAR_LIMIT
      ? stdout
      : `[Diff too large (${stdout.length} chars) — showing truncated]\n${stdout.slice(0, REVIEW_FIXER_DIFF_CHAR_LIMIT)}`;
  } catch {
    partialDiff = '[Unable to generate diff]';
  }

  let untrackedFiles: string[] = [];
  try {
    const { stdout } = await exec('git', ['ls-files', '--others', '--exclude-standard'], { cwd });
    untrackedFiles = stdout.trim().split('\n').filter(Boolean);
  } catch {
    // best-effort; leave empty
  }

  const discovery = extractReviewFixerDiscoveryContext(info.events);

  const nextInput: ReviewFixerContinuationInput = {
    cwd,
    planId,
    ...(round !== undefined ? { round } : {}),
    reviewFixerOptions: {
      ...reviewFixerOptions,
      continuationContext: {
        attempt: info.attempt,
        maxContinuations: info.maxAttempts - 1,
        partialDiff,
        untrackedFiles,
        filesInspected: discovery.filesInspected,
        searches: discovery.searches,
        commands: discovery.commands,
        recentMessages: discovery.recentMessages,
        toolResultSnippets: discovery.toolResultSnippets,
      },
    },
  };
  return { kind: 'retry', input: nextInput };
}

/**
 * Shape of the evaluator input the continuation builder augments with
 * `evaluatorContinuationContext`. The `hasUnstagedChanges` short-circuit
 * runs before the context is built — callers that want to override the
 * check (e.g., in tests) can provide a custom `checkHasUnstagedChanges`.
 *
 * `planId` is optional so the same input shape serves both build-level
 * (per-plan) and compile-level (per-plan-set) evaluators. Only the build
 * evaluator's `agent:retry` event carries a planId.
 */
export interface EvaluatorContinuationInput {
  worktreePath: string;
  planId?: string;
  /** Zero-based review-cycle round for lifecycle event metadata. */
  round?: number;
  /** Immutable evaluation snapshot prepared before the evaluator attempt; preserved across continuations. */
  evaluationSnapshot?: EvaluationSnapshot;
  evaluatorOptions: Record<string, unknown> & {
    evaluatorContinuationContext?: {
      attempt: number;
      maxContinuations: number;
    };
  };
  /** Hook for tests to override the clean-worktree check. */
  checkHasUnstagedChanges?: (cwd: string) => Promise<boolean>;
}

/**
 * Build the next evaluator attempt's input:
 * - If no unstaged changes remain, return `abort-success` — the retry
 *   short-circuits to success.
 * - Otherwise preserve the immutable evaluation snapshot plus evaluator options
 *   and splice read-only `evaluatorContinuationContext` into the next attempt.
 */
export async function buildEvaluatorContinuationInput(
  info: RetryAttemptInfo<EvaluatorContinuationInput>,
): Promise<ContinuationDecision<EvaluatorContinuationInput>> {
  const { worktreePath, evaluatorOptions, checkHasUnstagedChanges } = info.prevInput;
  const check = checkHasUnstagedChanges ?? hasUnstagedChangesInternal;
  if (!(await check(worktreePath))) {
    return { kind: 'abort-success' };
  }
  const nextInput: EvaluatorContinuationInput = {
    worktreePath,
    ...(info.prevInput.planId !== undefined && { planId: info.prevInput.planId }),
    ...(info.prevInput.round !== undefined && { round: info.prevInput.round }),
    ...(info.prevInput.evaluationSnapshot !== undefined && { evaluationSnapshot: info.prevInput.evaluationSnapshot }),
    evaluatorOptions: {
      ...evaluatorOptions,
      evaluatorContinuationContext: {
        attempt: info.attempt,
        maxContinuations: info.maxAttempts - 1,
      },
    },
    checkHasUnstagedChanges,
  };
  return { kind: 'retry', input: nextInput };
}

// ---------------------------------------------------------------------------
// Default policy registry
// ---------------------------------------------------------------------------

const RETRYABLE_MAX_TURNS: ReadonlySet<AgentTerminalSubtype> = new Set(['error_max_turns']);
/**
 * Retryable subtypes for infrastructure and transport failures.
 * Exported for use in local retry policies (e.g. compile reviewer retry in runners.ts).
 */
export const RETRYABLE_INFRASTRUCTURE_SUBTYPES: ReadonlySet<AgentTerminalSubtype> = new Set([
  'error_transient_transport',
  'error_pi_tool_infrastructure',
]);

const RETRYABLE_MAX_TURNS_TRANSPORT_AND_INFRA: ReadonlySet<AgentTerminalSubtype> = new Set([
  'error_max_turns',
  'error_transient_transport',
  'error_pi_tool_infrastructure',
]);
const EMPTY_SUBTYPES: ReadonlySet<AgentTerminalSubtype> = new Set();

/**
 * Default retry policies keyed by agent role.
 *
 * Not every `AgentRole` is registered — `getPolicy(role)` returns a
 * no-retry default for unregistered roles. Preserves the numeric values
 * previously defined in `AGENT_MAX_CONTINUATIONS_DEFAULTS`
 * (`maxAttempts = maxContinuations + 1`, i.e. 1 initial attempt plus N retries):
 *   - planner: 3 (was maxContinuations 2)
 *   - evaluator: 2 (was maxContinuations 1)
 *   - plan-evaluator / cohesion-evaluator / architecture-evaluator: 2
 *   - builder: 4 (prior default: maxContinuations 3)
 */
export const DEFAULT_RETRY_POLICIES: Partial<Record<AgentRole, RetryPolicy<unknown>>> = {
  planner: {
    agent: 'planner',
    maxAttempts: 3,
    retryableSubtypes: EMPTY_SUBTYPES,
    // Only retry dropped-submission when the thrown error is actually a
    // `PlannerSubmissionError`. Inspecting events alone would also match
    // unrelated `AgentTerminalError` subtypes (e.g. `error_during_execution`,
    // `error_max_budget_usd`) that happen to have no submission tool call,
    // which the prior ad-hoc loop explicitly did not retry. Max-turns retries
    // are blocked after compact-inspection handoff, and infrastructure/transport
    // failures use the same continuation prompt only when the stream failed
    // before any planner boundary event; otherwise the submitted or completed
    // plans (or compact synthesis context) are already authoritative and
    // rerunning would duplicate side effects.
    shouldRetry: (info) =>
      (isPlannerSubmissionError(info.error) && isDroppedSubmission(info.events) && !hasCompactInspectionContinuation(info.events)) ||
      (info.subtype === 'error_max_turns' && !hasCompactInspectionContinuation(info.events)) ||
      (isRetryableInfrastructureSubtype(info.subtype) && isBeforePlannerSubmissionBoundary(info.events) && !hasCompactInspectionContinuation(info.events)),
    buildContinuationInput: (info) => buildPlannerContinuationInput(info as RetryAttemptInfo<PlannerContinuationInput>) as Promise<ContinuationDecision<unknown>>,
    onRetry: (info) => {
      const reason: 'max_turns' | 'dropped_submission' =
        info.subtype === 'error_max_turns' ? 'max_turns' : 'dropped_submission';
      return [{
        timestamp: new Date().toISOString(),
        type: 'planning:continuation',
        attempt: info.attempt,
        maxContinuations: info.maxAttempts - 1,
        reason,
      }];
    },
    label: 'planner-continuation',
    // After an authoritative planner completion event, a late retryable
    // infrastructure/transport error is downgraded to a warning rather than
    // propagated. No second attempt is started — the plans are already written.
    terminalSuccessWhen: (info) =>
      isRetryableInfrastructureSubtype(info.subtype) && hasAuthoritativePlannerCheckpoint(info.events),
    onTerminalSuccess: (info) => {
      const agentId = extractAgentId(info.events, `planner-unknown`);
      const message = info.error instanceof Error ? info.error.message : String(info.error);
      return [{
        timestamp: new Date().toISOString(),
        type: 'agent:warning',
        agent: 'planner',
        agentId,
        code: 'infrastructure-error-post-checkpoint-downgraded',
        message: `Retryable infrastructure error after planner checkpoint was downgraded: ${message}`,
      }];
    },
  },
  builder: {
    agent: 'builder',
    maxAttempts: 4,
    retryableSubtypes: RETRYABLE_MAX_TURNS_TRANSPORT_AND_INFRA,
    buildContinuationInput: (info) => buildBuilderContinuationInput(info as RetryAttemptInfo<BuilderContinuationInput>) as Promise<ContinuationDecision<unknown>>,
    onRetry: (info) => {
      const planId = (info.prevInput as BuilderContinuationInput).planId;
      return [{
        timestamp: new Date().toISOString(),
        type: 'plan:build:implement:continuation',
        planId,
        attempt: info.attempt,
        maxContinuations: info.maxAttempts - 1,
      }];
    },
    planIdFromInput: (input) => (input as BuilderContinuationInput).planId,
    label: 'builder-continuation',
  },
  evaluator: {
    agent: 'evaluator',
    maxAttempts: 2,
    retryableSubtypes: RETRYABLE_MAX_TURNS_TRANSPORT_AND_INFRA,
    shouldRetry: (info) => isEvaluatorNoVerdictsError(info.error),
    buildContinuationInput: (info) => buildEvaluatorContinuationInput(info as RetryAttemptInfo<EvaluatorContinuationInput>) as Promise<ContinuationDecision<unknown>>,
    onRetry: (info) => {
      const planId = (info.prevInput as EvaluatorContinuationInput).planId ?? '';
      const round = (info.prevInput as EvaluatorContinuationInput).round;
      return [{
        timestamp: new Date().toISOString(),
        type: 'plan:build:evaluate:continuation',
        planId,
        attempt: info.attempt,
        maxContinuations: info.maxAttempts - 1,
        ...(round !== undefined ? { round } : {}),
      }];
    },
    planIdFromInput: (input) => (input as EvaluatorContinuationInput).planId,
    label: 'evaluator-continuation',
  },
  'plan-evaluator': {
    agent: 'plan-evaluator',
    maxAttempts: 2,
    retryableSubtypes: RETRYABLE_MAX_TURNS_TRANSPORT_AND_INFRA,
    buildContinuationInput: (info) => buildEvaluatorContinuationInput(info as RetryAttemptInfo<EvaluatorContinuationInput>) as Promise<ContinuationDecision<unknown>>,
    onRetry: (info) => [{
      timestamp: new Date().toISOString(),
      type: 'planning:evaluate:continuation',
      attempt: info.attempt,
      maxContinuations: info.maxAttempts - 1,
    }],
    label: 'plan-evaluator-continuation',
  },
  'cohesion-evaluator': {
    agent: 'cohesion-evaluator',
    maxAttempts: 2,
    retryableSubtypes: RETRYABLE_MAX_TURNS_TRANSPORT_AND_INFRA,
    buildContinuationInput: (info) => buildEvaluatorContinuationInput(info as RetryAttemptInfo<EvaluatorContinuationInput>) as Promise<ContinuationDecision<unknown>>,
    onRetry: (info) => [{
      timestamp: new Date().toISOString(),
      type: 'planning:cohesion:evaluate:continuation',
      attempt: info.attempt,
      maxContinuations: info.maxAttempts - 1,
    }],
    label: 'cohesion-evaluator-continuation',
  },
  'architecture-evaluator': {
    agent: 'architecture-evaluator',
    maxAttempts: 2,
    retryableSubtypes: RETRYABLE_MAX_TURNS_TRANSPORT_AND_INFRA,
    buildContinuationInput: (info) => buildEvaluatorContinuationInput(info as RetryAttemptInfo<EvaluatorContinuationInput>) as Promise<ContinuationDecision<unknown>>,
    onRetry: (info) => [{
      timestamp: new Date().toISOString(),
      type: 'planning:architecture:evaluate:continuation',
      attempt: info.attempt,
      maxContinuations: info.maxAttempts - 1,
    }],
    label: 'architecture-evaluator-continuation',
  },
  'review-fixer': {
    agent: 'review-fixer' as AgentRole,
    maxAttempts: 3,
    retryableSubtypes: RETRYABLE_MAX_TURNS,
    buildContinuationInput: (info) =>
      buildReviewFixerContinuationInput(info as RetryAttemptInfo<ReviewFixerContinuationInput>) as Promise<ContinuationDecision<unknown>>,
    onRetry: (info) => {
      const planId = (info.prevInput as ReviewFixerContinuationInput).planId;
      const round = (info.prevInput as ReviewFixerContinuationInput).round;
      return [{
        timestamp: new Date().toISOString(),
        type: 'plan:build:review:fix:continuation',
        planId,
        attempt: info.attempt,
        maxContinuations: info.maxAttempts - 1,
        ...(round !== undefined ? { round } : {}),
      }];
    },
    planIdFromInput: (input) => (input as ReviewFixerContinuationInput).planId,
    label: 'review-fixer-continuation',
  },
};

/**
 * Look up the retry policy for a role. Returns a no-retry default for
 * roles that don't have an explicit policy registered.
 */
export function getPolicy(role: AgentRole): RetryPolicy<unknown> {
  const registered = DEFAULT_RETRY_POLICIES[role];
  if (registered) return registered;
  return {
    agent: role,
    maxAttempts: 1,
    retryableSubtypes: EMPTY_SUBTYPES,
    label: `${role}-no-retry`,
  };
}

// ---------------------------------------------------------------------------
// withRetry — the wrapper
// ---------------------------------------------------------------------------

/**
 * Classify a thrown error into an `AgentTerminalSubtype` for policy matching.
 * Returns `undefined` when the error is not one we know how to classify —
 * callers should treat `undefined` as non-retryable and rethrow.
 */
function classifyError(err: unknown): AgentTerminalSubtype | undefined {
  const classified = classifyAgentTerminalSubtype(err);
  if (classified) return classified;
  if (isPlannerSubmissionError(err) || isEvaluatorNoVerdictsError(err)) return 'error_during_execution';
  return undefined;
}

/**
 * Wrap an async-generator agent with the retry policy for its role.
 *
 * Contract:
 * - Yields every event from every attempt.
 * - When an attempt ends with a retryable terminal (thrown `AgentTerminalError`
 *   or yielded `build:failed` with `terminalSubtype`), emits an `agent:retry`
 *   event plus any policy-provided `onRetry` events, then runs the next
 *   attempt with the continuation-builder-supplied input.
 * - On `buildContinuationInput` returning `{ kind: 'abort-success' }`, stops
 *   retrying and returns normally (the held-back terminal event is dropped).
 * - On exhaustion, rethrows the captured error or yields the held-back
 *   terminal event.
 */
export async function* withRetry<Input, Result = void>(
  runAgent: (input: Input) => AsyncGenerator<EforgeEvent, Result>,
  policy: RetryPolicy<Input>,
  initialInput: Input,
): AsyncGenerator<EforgeEvent, Result | undefined> {
  let currentInput: Input = initialInput;
  let lastResult: Result | undefined;

  for (let attempt = 1; attempt <= policy.maxAttempts; attempt++) {
    const attemptEvents: EforgeEvent[] = [];
    let caughtError: unknown;
    let subtype: AgentTerminalSubtype | undefined;
    let heldBackTerminal: EforgeEvent | undefined;

    const gen = runAgent(currentInput);
    try {
      let next = await gen.next();
      while (!next.done) {
        const ev = next.value;
        attemptEvents.push(ev);

        // Stream-based terminal detection: build:failed with terminalSubtype.
        if (ev.type === 'plan:build:failed' && ev.terminalSubtype) {
          subtype = ev.terminalSubtype;
          heldBackTerminal = ev;
          // Hold back — may be replaced on retry.
          next = await gen.next();
          continue;
        }

        yield ev;
        next = await gen.next();
      }
      lastResult = next.value;
    } catch (err) {
      caughtError = err;
      subtype = classifyError(err);
      if (!subtype) {
        // Non-classifiable error — bail immediately.
        throw err;
      }
    }

    // No terminal detected — normal completion.
    if (!subtype) {
      return lastResult;
    }

    const info: RetryAttemptInfo<Input> = {
      attempt,
      maxAttempts: policy.maxAttempts,
      subtype,
      events: attemptEvents,
      prevInput: currentInput,
      error: caughtError,
    };

    // Check terminal-success hook before retry/propagate decision. When the
    // hook returns true, the terminal error is downgraded to a warning: no new
    // attempt is started, onTerminalSuccess events are emitted, the held-back
    // terminal event is dropped, and the last successful result is returned.
    if (policy.terminalSuccessWhen) {
      const isTerminalSuccess = await policy.terminalSuccessWhen(info);
      if (isTerminalSuccess) {
        if (policy.onTerminalSuccess) {
          for (const ev of policy.onTerminalSuccess(info)) {
            yield ev;
          }
        }
        return lastResult;
      }
    }

    const inSet = policy.retryableSubtypes.has(subtype);
    const customMatch = policy.shouldRetry?.(info) ?? false;
    const canRetry = attempt < policy.maxAttempts && (inSet || customMatch);

    if (!canRetry) {
      if (caughtError !== undefined) throw caughtError;
      if (heldBackTerminal) yield heldBackTerminal;
      return lastResult;
    }

    // Build the next attempt's input. If the continuation builder throws
    // (e.g. the builder continuation aborting when the worktree has no
    // changes), treat that as "cannot retry" and propagate the original
    // terminal (held-back event or caught error) rather than the build error.
    let nextInput: Input = currentInput;
    if (policy.buildContinuationInput) {
      let decision: ContinuationDecision<Input>;
      try {
        decision = await policy.buildContinuationInput(info);
      } catch {
        if (caughtError !== undefined) throw caughtError;
        if (heldBackTerminal) yield heldBackTerminal;
        return lastResult;
      }
      if (decision.kind === 'abort-success') {
        // Drop the held-back terminal event (if any) — treat the state as
        // success.
        return lastResult;
      }
      nextInput = decision.input;
    }

    // Emit the generic agent:retry notification first.
    const planId = policy.planIdFromInput ? policy.planIdFromInput(currentInput) : undefined;
    const shardId = policy.shardIdFromInput ? policy.shardIdFromInput(currentInput) : undefined;
    yield {
      timestamp: new Date().toISOString(),
      type: 'agent:retry',
      agent: policy.agent,
      attempt,
      maxAttempts: policy.maxAttempts,
      subtype,
      label: policy.label,
      ...(planId !== undefined && { planId }),
      ...(shardId !== undefined && { shardId }),
    };
    // Emit any policy-specific domain continuation events (plan:continuation, etc.).
    if (policy.onRetry) {
      for (const ev of policy.onRetry(info)) {
        yield ev;
      }
    }
    currentInput = nextInput;
  }

  // Exhausted maxAttempts without a successful run. This is only reachable
  // when the final attempt is allowed to retry but has no retries left — the
  // `canRetry` guard above handles propagation, so this path is defensive.
  return lastResult;
}
