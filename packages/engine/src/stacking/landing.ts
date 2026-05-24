/**
 * Stack landing helper.
 *
 * Wraps git-spice provider calls for a single stacked layer: tracks the
 * artifact branch against its resolved base, submits the PR, discovers the PR
 * URL, and persists durable landing state to `.eforge/stacks/layers.json`.
 *
 * Emits `stack:provider:command` events from real invocations and
 * `stack:landing:update` events for started, complete, skipped, and failed
 * outcomes. Callers must never emit these events directly.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { EforgeEvent } from '../events.js';
import type { ProviderCommandResult, StackProviderAdapter } from './provider.js';
import type { StackBaseContext } from './base-resolver.js';
import type { LandingPublicationAction, StackLayer } from './types.js';
import { updateStackLayerLanding, updateStackLayerStatusAndLanding } from './state.js';
import { isGitHubPullRequestUrl, parseGitSpicePrUrl, redactProviderMessage } from './git-spice.js';
// --- eforge:region plan-03-stack-landing-lifecycle-cleanup ---
import { runCleanup } from '../landing.js';
// --- eforge:endregion plan-03-stack-landing-lifecycle-cleanup ---

const execFileAsync = promisify(execFile);

type ProviderCommandErrorLike = {
  command?: unknown;
  args?: unknown;
  exitCode?: unknown;
};

function stackProviderCommandEvent(
  providerName: StackBaseContext['provider'],
  branch: string,
  result: ProviderCommandResult,
): EforgeEvent {
  return {
    timestamp: new Date().toISOString(),
    type: 'stack:provider:command',
    provider: providerName,
    command: redactProviderMessage(result.command),
    args: result.args.map((arg) => redactProviderMessage(arg)),
    exitCode: result.exitCode,
    branch,
  } as EforgeEvent;
}

function stackProviderCommandEventFromError(
  providerName: StackBaseContext['provider'],
  branch: string,
  err: unknown,
): EforgeEvent | undefined {
  if (err === null || typeof err !== 'object') return undefined;
  const candidate = err as ProviderCommandErrorLike;
  if (
    typeof candidate.command !== 'string' ||
    !Array.isArray(candidate.args) ||
    !candidate.args.every((arg): arg is string => typeof arg === 'string') ||
    typeof candidate.exitCode !== 'number'
  ) {
    return undefined;
  }

  return stackProviderCommandEvent(providerName, branch, {
    command: candidate.command,
    args: candidate.args,
    stdout: '',
    stderr: '',
    exitCode: candidate.exitCode,
  });
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

export interface StackLandingOptions {
  /** Project root (cwd) — used for `.eforge/stacks/layers.json` persistence. */
  cwd: string;
  /** Path to the merge worktree where the artifact branch is checked out. */
  mergeWorktreePath: string;
  /** Resolved stack context for this layer. */
  stackContext: StackBaseContext;
  /** Landing action vocabulary for this layer. */
  landingAction: LandingPublicationAction;
  /** Instantiated provider adapter. */
  provider: StackProviderAdapter;
  // --- eforge:region plan-03-stack-landing-lifecycle-cleanup ---
  /** Whether to run cleanup on the feature branch before provider.submitBranch. */
  shouldCleanup?: boolean;
  /** Plan set name for cleanup commit message. */
  cleanupPlanSet?: string;
  /** Output directory containing plan files. */
  cleanupOutputDir?: string;
  /** Path to the PRD file to remove during cleanup. */
  cleanupPrdFilePath?: string;
  // --- eforge:endregion plan-03-stack-landing-lifecycle-cleanup ---
}

// ---------------------------------------------------------------------------
// PR URL discovery fallback
// ---------------------------------------------------------------------------

/**
 * Best-effort PR URL discovery via `gh pr view`.
 *
 * Used as a fallback when the git-spice submit output does not contain a
 * parseable PR URL. Never throws — returns `undefined` on any error.
 */
async function discoverPrUrlViaGh(cwd: string, branch: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync(
      'gh',
      ['pr', 'view', branch, '--json', 'url', '-q', '.url'],
      { cwd },
    );
    const url = stdout.trim();
    return url && isGitHubPullRequestUrl(url) ? url : undefined;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// Stack landing generator
// ---------------------------------------------------------------------------

/**
 * Execute the git-spice landing workflow for a single stacked layer.
 *
 * For `landingAction === 'pr'`:
 *   1. Emits `stack:landing:update` started
 *   2. Calls `provider.trackBranch` → emits `stack:provider:command`
 *   3. Calls `provider.submitBranch` → emits `stack:provider:command`
 *   4. Discovers PR URL from submit output (or via `gh pr view` fallback)
 *   5. Persists landing state and emits `stack:landing:update` complete/failed
 *
 * For non-pr actions (`merge`, `leave`) or when stacked landing is not
 * applicable, emits `stack:landing:update` skipped and returns.
 */
export async function* executeStackLanding(opts: StackLandingOptions): AsyncGenerator<EforgeEvent> {
  // --- eforge:region plan-03-stack-landing-lifecycle-cleanup ---
  const { cwd, mergeWorktreePath, stackContext, landingAction, provider,
    shouldCleanup, cleanupPlanSet, cleanupOutputDir, cleanupPrdFilePath } = opts;
  // --- eforge:endregion plan-03-stack-landing-lifecycle-cleanup ---
  const { prdId, stackId, branch, baseBranch, provider: providerName } = stackContext;

  const ts = (): string => new Date().toISOString();
  const startedAt = ts();

  if (landingAction !== 'pr') {
    // Non-PR landing action: skip git-spice submission and persist the outcome.
    const completedAt = ts();
    // --- eforge:region plan-03-stack-landing-lifecycle-cleanup ---
    // Non-PR actions produce terminal layer statuses: merge→'merged', leave→'landed'.
    const layerStatusForSkip: StackLayer['status'] = landingAction === 'merge' ? 'merged' : 'landed';
    await updateStackLayerStatusAndLanding(cwd, prdId, layerStatusForSkip, {
    // --- eforge:endregion plan-03-stack-landing-lifecycle-cleanup ---
      action: landingAction,
      status: 'skipped',
      reason: `Landing action is '${landingAction}', not 'pr'`,
      startedAt,
      completedAt,
    });
    yield {
      timestamp: completedAt,
      type: 'stack:landing:update',
      prdId,
      stackId,
      action: landingAction,
      branch,
      status: 'skipped',
      reason: `Landing action is '${landingAction}', not 'pr'`,
    } as EforgeEvent;
    return;
  }

  // Emit landing:update started and persist
  yield {
    timestamp: startedAt,
    type: 'stack:landing:update',
    prdId,
    stackId,
    action: landingAction,
    branch,
    status: 'started',
  } as EforgeEvent;

  await updateStackLayerLanding(cwd, prdId, {
    action: landingAction,
    status: 'started',
    startedAt,
  });

  // Step 1: Track branch against the resolved base
  const resolvedBase = baseBranch ?? 'main';
  let trackResult: ProviderCommandResult;
  try {
    trackResult = await provider.trackBranch(mergeWorktreePath, resolvedBase);
    yield stackProviderCommandEvent(providerName, branch, trackResult);
  } catch (err) {
    const commandEvent = stackProviderCommandEventFromError(providerName, branch, err);
    if (commandEvent) yield commandEvent;
    const reason = redactProviderMessage(err instanceof Error ? err.message : String(err));
    const failedAt = ts();
    // --- eforge:region plan-03-stack-landing-lifecycle-cleanup ---
    await updateStackLayerStatusAndLanding(cwd, prdId, 'failed', {
    // --- eforge:endregion plan-03-stack-landing-lifecycle-cleanup ---
      action: landingAction,
      status: 'failed',
      reason,
      startedAt,
      completedAt: failedAt,
    });
    yield {
      timestamp: failedAt,
      type: 'stack:landing:update',
      prdId,
      stackId,
      action: landingAction,
      branch,
      status: 'failed',
      reason,
    } as EforgeEvent;
    return;
  }

  // --- eforge:region plan-03-stack-landing-lifecycle-cleanup ---
  // Step 2 (pre-submit): Run cleanup before submitting the PR, if configured.
  if (shouldCleanup && cleanupPlanSet && cleanupOutputDir) {
    for await (const event of runCleanup(
      mergeWorktreePath,
      branch,
      cleanupPlanSet,
      cleanupOutputDir,
      cleanupPrdFilePath,
      ts,
    )) {
      yield event;
    }
  }
  // --- eforge:endregion plan-03-stack-landing-lifecycle-cleanup ---

  // Step 3: Submit the branch as a PR
  let submitResult: ProviderCommandResult;
  try {
    submitResult = await provider.submitBranch(mergeWorktreePath);
    yield stackProviderCommandEvent(providerName, branch, submitResult);
  } catch (err) {
    const commandEvent = stackProviderCommandEventFromError(providerName, branch, err);
    if (commandEvent) yield commandEvent;
    const reason = redactProviderMessage(err instanceof Error ? err.message : String(err));
    const failedAt = ts();
    // --- eforge:region plan-03-stack-landing-lifecycle-cleanup ---
    await updateStackLayerStatusAndLanding(cwd, prdId, 'failed', {
    // --- eforge:endregion plan-03-stack-landing-lifecycle-cleanup ---
      action: landingAction,
      status: 'failed',
      reason,
      startedAt,
      completedAt: failedAt,
    });
    yield {
      timestamp: failedAt,
      type: 'stack:landing:update',
      prdId,
      stackId,
      action: landingAction,
      branch,
      status: 'failed',
      reason,
    } as EforgeEvent;
    return;
  }

  // Step 4: Discover PR URL — parse from submit output, then gh fallback
  const prUrl =
    parseGitSpicePrUrl(submitResult.stdout) ??
    (await discoverPrUrlViaGh(mergeWorktreePath, branch));

  // Step 5: Persist complete landing state with layer status transition to 'landed'
  const completedAt = ts();
  // --- eforge:region plan-03-stack-landing-lifecycle-cleanup ---
  await updateStackLayerStatusAndLanding(cwd, prdId, 'landed', {
  // --- eforge:endregion plan-03-stack-landing-lifecycle-cleanup ---
    action: landingAction,
    status: 'complete',
    ...(prUrl !== undefined && { prUrl }),
    startedAt,
    completedAt,
  });

  yield {
    timestamp: completedAt,
    type: 'stack:landing:update',
    prdId,
    stackId,
    action: landingAction,
    branch,
    status: 'complete',
    ...(prUrl !== undefined && { prUrl }),
  } as EforgeEvent;
}
