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
// --- eforge:region plan-01-core-daemon-stack-sync ---
// PR URL parsing and redaction are delegated to provider helpers (parsePrUrl, isValidPrUrl, redactMessage)
// to avoid direct git-spice imports in orchestration code.
// --- eforge:endregion plan-01-core-daemon-stack-sync ---
// --- eforge:region plan-03-stack-landing-lifecycle-cleanup ---
import { runCleanup } from '../landing.js';
// --- eforge:endregion plan-03-stack-landing-lifecycle-cleanup ---
// --- eforge:region plan-01-core-engine-auto-merge ---
import { resolvePrAutoMergeIntent } from '../config.js';
import { enablePullRequestAutoMerge } from '../worktree-ops.js';
// --- eforge:endregion plan-01-core-engine-auto-merge ---
// --- eforge:region plan-01-pr-metadata ---
import { editPullRequest } from '../worktree-ops.js';
import type { PullRequestMetadata } from '../pr-metadata.js';
// --- eforge:endregion plan-01-pr-metadata ---

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
  redact: (msg: string) => string,
): EforgeEvent {
  return {
    timestamp: new Date().toISOString(),
    type: 'stack:provider:command',
    provider: providerName,
    command: redact(result.command),
    args: result.args.map((arg) => redact(arg)),
    exitCode: result.exitCode,
    branch,
  } as EforgeEvent;
}

function stackProviderCommandEventFromError(
  providerName: StackBaseContext['provider'],
  branch: string,
  err: unknown,
  redact: (msg: string) => string,
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
  }, redact);
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
  // --- eforge:region plan-01-core-engine-auto-merge ---
  /** Configured PR auto-merge policy (from landing.pr.autoMerge). Defaults to 'ask'. */
  prAutoMergePolicy?: 'ask' | 'always' | 'never';
  /** Per-run PR auto-merge intent (from landingAutoMerge option). */
  landingAutoMerge?: boolean;
  // --- eforge:endregion plan-01-core-engine-auto-merge ---
  // --- eforge:region plan-01-pr-metadata ---
  /** Optional deterministic PR metadata to apply via `gh pr edit` after URL discovery. */
  metadata?: PullRequestMetadata;
  // --- eforge:endregion plan-01-pr-metadata ---
}

// ---------------------------------------------------------------------------
// PR URL discovery fallback
// ---------------------------------------------------------------------------

/**
 * Best-effort PR URL discovery via `gh pr view`.
 *
 * Used as a fallback when the provider submit output does not contain a
 * parseable PR URL. Never throws — returns `undefined` on any error.
 */
async function discoverPrUrlViaGh(
  cwd: string,
  branch: string,
  isValidPrUrl: (url: string) => boolean,
): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync(
      'gh',
      ['pr', 'view', branch, '--json', 'url', '-q', '.url'],
      { cwd },
    );
    const url = stdout.trim();
    return url && isValidPrUrl(url) ? url : undefined;
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
 *   3. Runs optional cleanup (non-fatal)
 *   4. Calls `provider.restackBranch` → emits `stack:provider:command`
 *   5. Calls `provider.submitBranch` → emits `stack:provider:command`
 *   6. Discovers PR URL from submit output (or via `gh pr view` fallback)
 *   7. Persists landing state and emits `stack:landing:update` complete/failed
 *
 * For non-pr actions (`merge`, `leave`) or when stacked landing is not
 * applicable, emits `stack:landing:update` skipped and returns.
 */
export async function* executeStackLanding(opts: StackLandingOptions): AsyncGenerator<EforgeEvent> {
  // --- eforge:region plan-03-stack-landing-lifecycle-cleanup ---
  const { cwd, mergeWorktreePath, stackContext, landingAction, provider,
    shouldCleanup, cleanupPlanSet, cleanupOutputDir, cleanupPrdFilePath } = opts;
  // --- eforge:endregion plan-03-stack-landing-lifecycle-cleanup ---
  // --- eforge:region plan-01-core-engine-auto-merge ---
  const { prAutoMergePolicy = 'ask', landingAutoMerge } = opts;
  // --- eforge:endregion plan-01-core-engine-auto-merge ---
  // --- eforge:region plan-01-pr-metadata ---
  const { metadata } = opts;
  // --- eforge:endregion plan-01-pr-metadata ---
  const { prdId, stackId, branch, baseBranch, provider: providerName } = stackContext;
  // --- eforge:region plan-01-core-daemon-stack-sync ---
  // Use provider-level helpers for redaction, PR URL parsing, and validation
  // to avoid direct git-spice imports in orchestration code.
  const redact = provider.redactMessage.bind(provider);
  // --- eforge:endregion plan-01-core-daemon-stack-sync ---

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
    yield stackProviderCommandEvent(providerName, branch, trackResult, redact);
  } catch (err) {
    const commandEvent = stackProviderCommandEventFromError(providerName, branch, err, redact);
    if (commandEvent) yield commandEvent;
    const reason = redact(err instanceof Error ? err.message : String(err));
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

  // --- eforge:region plan-01-restack-before-stacked-pr-submit ---
  // Step 3: Restack branch so it sits atop the latest base tip before submit
  let restackResult: ProviderCommandResult;
  try {
    restackResult = await provider.restackBranch(mergeWorktreePath);
    yield stackProviderCommandEvent(providerName, branch, restackResult, redact);
  } catch (err) {
    const commandEvent = stackProviderCommandEventFromError(providerName, branch, err, redact);
    if (commandEvent) yield commandEvent;
    const reason = redact(err instanceof Error ? err.message : String(err));
    const failedAt = ts();
    await updateStackLayerStatusAndLanding(cwd, prdId, 'failed', {
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
  // --- eforge:endregion plan-01-restack-before-stacked-pr-submit ---

  // Step 4: Submit the branch as a PR
  let submitResult: ProviderCommandResult;
  try {
    submitResult = await provider.submitBranch(mergeWorktreePath);
    yield stackProviderCommandEvent(providerName, branch, submitResult, redact);
  } catch (err) {
    const commandEvent = stackProviderCommandEventFromError(providerName, branch, err, redact);
    if (commandEvent) yield commandEvent;
    const reason = redact(err instanceof Error ? err.message : String(err));
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

  // Step 5: Discover PR URL — parse from submit output, then gh fallback
  // --- eforge:region plan-01-core-daemon-stack-sync ---
  const prUrl =
    provider.parsePrUrl(submitResult.stdout) ??
    (await discoverPrUrlViaGh(mergeWorktreePath, branch, provider.isValidPrUrl.bind(provider)));
  // --- eforge:endregion plan-01-core-daemon-stack-sync ---

  // --- eforge:region plan-01-pr-metadata ---
  // Step 5a: Apply deterministic PR metadata via gh pr edit (non-fatal).
  if (prUrl !== undefined && metadata !== undefined) {
    try {
      await editPullRequest(mergeWorktreePath, prUrl, metadata);
    } catch (editErr) {
      yield {
        timestamp: ts(),
        type: 'planning:progress',
        message: `PR metadata update failed (non-fatal): ${(editErr as Error).message}`,
      } as EforgeEvent;
    }
  }
  // --- eforge:endregion plan-01-pr-metadata ---

  // Step 6: Persist complete landing state with layer status transition to 'landed'
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

  // --- eforge:region plan-01-core-engine-auto-merge ---
  // Step 7: Attempt PR auto-merge (non-fatal) after successful PR landing.
  const shouldAutoMerge = resolvePrAutoMergeIntent(prAutoMergePolicy, landingAutoMerge);
  if (shouldAutoMerge) {
    if (prUrl === undefined) {
      // No PR URL was discovered from the git-spice output — skip auto-merge with a diagnostic.
      yield {
        timestamp: ts(),
        type: 'landing:auto-merge:skipped',
        featureBranch: branch,
        baseBranch: resolvedBase,
        reason: 'No PR URL discovered; cannot enable auto-merge for stacked PR',
      } as unknown as EforgeEvent;
    } else {
      yield {
        timestamp: ts(),
        type: 'landing:auto-merge:start',
        featureBranch: branch,
        baseBranch: resolvedBase,
        prUrl,
      } as unknown as EforgeEvent;
      try {
        await enablePullRequestAutoMerge(mergeWorktreePath, prUrl);
        yield {
          timestamp: ts(),
          type: 'landing:auto-merge:complete',
          featureBranch: branch,
          baseBranch: resolvedBase,
          prUrl,
        } as unknown as EforgeEvent;
      } catch (autoMergeErr) {
        yield {
          timestamp: ts(),
          type: 'landing:auto-merge:skipped',
          featureBranch: branch,
          baseBranch: resolvedBase,
          prUrl,
          reason: `gh pr merge failed: ${(autoMergeErr as Error).message}`,
        } as unknown as EforgeEvent;
      }
    }
  } else {
    const skipReason = prAutoMergePolicy === 'never'
      ? 'Auto-merge policy is "never"'
      : (prAutoMergePolicy === 'always' && landingAutoMerge === false)
        ? 'Auto-merge explicitly disabled for this run'
        : 'Auto-merge not requested (policy is "ask")';
    yield {
      timestamp: ts(),
      type: 'landing:auto-merge:skipped',
      featureBranch: branch,
      baseBranch: resolvedBase,
      ...(prUrl !== undefined && { prUrl }),
      reason: skipReason,
    } as unknown as EforgeEvent;
  }
  // --- eforge:endregion plan-01-core-engine-auto-merge ---
}
