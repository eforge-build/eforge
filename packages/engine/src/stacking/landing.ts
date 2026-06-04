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
import type { MergeResolver } from '../worktree-ops.js';
import type {
  ProviderCommandResult,
  StackProviderAdapter,
  StackProviderErrorClassification,
} from './provider.js';
import type { StackBaseContext } from './base-resolver.js';
import type { LandingPublicationAction, StackLayer } from './types.js';
import { updateStackLayerLanding, updateStackLayerStatusAndLanding } from './state.js';
import { recoverLandingConflict, type LandingConflictRecoveryResult } from './landing-conflict-recovery.js';
import {
  initialLandingBaseDecision,
  landingBaseMetadata,
  preflightLandingBase,
  proveLandingHeadFreshness,
  stackContextForLandingDecision,
  type LandingBaseDecision,
  type LandingBasePreflightResult,
  type StackLandingBaseMetadata,
} from './landing-base.js';
import { stackProviderCommandEvent, stackProviderCommandEventFromError } from './provider-events.js';
// PR URL parsing and redaction are delegated to provider helpers (parsePrUrl, isValidPrUrl, redactMessage)
// to avoid direct git-spice imports in orchestration code.
import { runCleanup } from '../landing.js';
import { editPullRequest } from '../worktree-ops.js';
import type { PullRequestMetadata } from '../pr-metadata.js';
import { emitStackLandingAutoMergeEvents } from './landing-auto-merge.js';

export type { StackLandingBaseMetadata } from './landing-base.js';

const execFileAsync = promisify(execFile);

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
  /** Whether to run cleanup on the feature branch before provider.submitBranch. */
  shouldCleanup?: boolean;
  /** Plan set name for cleanup commit message. */
  cleanupPlanSet?: string;
  /** Output directory containing plan files. */
  cleanupOutputDir?: string;
  /** Path to the PRD file to remove during cleanup. */
  cleanupPrdFilePath?: string;
  /** Configured PR auto-merge policy (from landing.pr.autoMerge). Defaults to 'ask'. */
  prAutoMergePolicy?: 'ask' | 'always' | 'never';
  /** Per-run PR auto-merge intent (from landingAutoMerge option). */
  landingAutoMerge?: boolean;
  /** Optional deterministic PR metadata to apply via `gh pr edit` after URL discovery. */
  metadata?: PullRequestMetadata;
  /**
   * Optional lazy metadata factory called after cleanup and the PR URL discovery
   * attempt, and before `gh pr edit`. Takes precedence over `metadata` when both
   * are provided. The edit is only applied when a PR URL was discovered; if no URL
   * is found the resolved metadata is discarded. Best-effort: factory errors fall
   * back to `metadata` if present, or skip the edit entirely.
   */
  metadataFactory?: (context: StackLandingBaseMetadata) => Promise<PullRequestMetadata>;
  // --- eforge:region stack-landing-recovery ---
  /** Optional merge resolver used as fallback after deterministic conflict cleanup. */
  mergeResolver?: MergeResolver;
  /** Validation commands to run after provider conflict recovery and before submit. */
  postRecoveryValidationCommands?: string[];
  /** Timeout in milliseconds for post-recovery validation commands. */
  validationTimeoutMs?: number;
  /** Abort signal propagated to post-recovery validation. */
  signal?: AbortSignal;
  /** Maximum provider conflict recovery attempts. Defaults to the recovery helper's policy. */
  maxConflictRecoveryAttempts?: number;
  // --- eforge:endregion stack-landing-recovery ---
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

// --- eforge:region stack-landing-recovery ---
function isRecoverableRestackConflict(
  classification: StackProviderErrorClassification | undefined,
): classification is StackProviderErrorClassification {
  return classification?.kind === 'recoverable-conflict' && classification.recoverable === true;
}

function providerCanRecoverLandingConflict(provider: StackProviderAdapter): boolean {
  return provider.classifyError !== undefined &&
    provider.getInterruptedOperation !== undefined &&
    provider.continueInterruptedOperation !== undefined;
}

async function classifyProviderError(
  provider: StackProviderAdapter,
  mergeWorktreePath: string,
  err: unknown,
): Promise<StackProviderErrorClassification | undefined> {
  if (!provider.classifyError) return undefined;
  try {
    return await provider.classifyError(mergeWorktreePath, err);
  } catch {
    return undefined;
  }
}

async function* consumeRecovery(
  recovery: AsyncGenerator<EforgeEvent, LandingConflictRecoveryResult>,
): AsyncGenerator<EforgeEvent, LandingConflictRecoveryResult> {
  while (true) {
    const next = await recovery.next();
    if (next.done === true) return next.value;
    yield next.value;
  }
}

function restackRecoveryFailureReason(result: LandingConflictRecoveryResult | undefined): string {
  const reason = result?.reason ?? 'Recovery did not complete';
  const abortOutcome = result?.abortAttempted === true
    ? ` (${result.abortSucceeded ? 'abort succeeded' : 'abort failed'})`
    : '';
  return `Restack conflict recovery failed: ${reason}${abortOutcome}`;
}
// --- eforge:endregion stack-landing-recovery ---

// ---------------------------------------------------------------------------
// Stack landing generator
// ---------------------------------------------------------------------------

/**
 * Execute the git-spice landing workflow for a single stacked layer.
 *
 * For `landingAction === 'pr'`:
 *   1. Emits and persists `stack:landing:update` started.
 *   2. Runs landing-base preflight; if a parent base has landed, retargets to trunk.
 *   3. Calls `provider.syncRepo`, then tracks the branch against the effective base.
 *   4. Runs optional cleanup once (non-fatal) before any submit attempt.
 *   5. Restacks, repeats final base preflight/repair for disappearing parent bases,
 *      then proves HEAD contains the fetched remote base.
 *   6. On stale freshness, retries provider sync + restack + freshness proof once.
 *   7. Calls `provider.submitBranch`, discovers the PR URL, applies metadata, and
 *      persists/emits `stack:landing:update` complete; failures persist/emits failed.
 *
 * For non-pr actions (`merge`, `leave`) or when stacked landing is not
 * applicable, emits `stack:landing:update` skipped and returns.
 */
export async function* executeStackLanding(opts: StackLandingOptions): AsyncGenerator<EforgeEvent> {
  const { cwd, mergeWorktreePath, stackContext, landingAction, provider,
    shouldCleanup, cleanupPlanSet, cleanupOutputDir, cleanupPrdFilePath } = opts;
  const { prAutoMergePolicy = 'ask', landingAutoMerge } = opts;
  const { metadata } = opts;
  const { metadataFactory } = opts;
  const { prdId, stackId, branch, baseBranch, provider: providerName } = stackContext;
  // Use provider-level helpers for redaction, PR URL parsing, and validation
  // to avoid direct git-spice imports in orchestration code.
  const redact = provider.redactMessage.bind(provider);

  const ts = (): string => new Date().toISOString();
  const startedAt = ts();

  if (landingAction !== 'pr') {
    // Non-PR landing action: skip git-spice submission and persist the outcome.
    const completedAt = ts();
    // Non-PR actions produce terminal layer statuses: merge→'merged', leave→'landed'.
    const layerStatusForSkip: StackLayer['status'] = landingAction === 'merge' ? 'merged' : 'landed';
    await updateStackLayerStatusAndLanding(cwd, prdId, layerStatusForSkip, {
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

  let baseDecision = initialLandingBaseDecision(stackContext, baseBranch ?? 'main');
  let effectiveStackContext = stackContextForLandingDecision(stackContext, baseDecision);
  const failLanding = async (reason: string): Promise<EforgeEvent> => {
    const failedAt = ts();
    const metadataFields = stackContext.parentPrdId !== undefined ? landingBaseMetadata(baseDecision) : {};
    await updateStackLayerStatusAndLanding(cwd, prdId, 'failed', {
      action: landingAction,
      status: 'failed',
      reason,
      ...metadataFields,
      startedAt,
      completedAt: failedAt,
    });
    return {
      timestamp: failedAt,
      type: 'stack:landing:update',
      prdId,
      stackId,
      action: landingAction,
      branch,
      status: 'failed',
      reason,
      ...metadataFields,
    } as EforgeEvent;
  };
  const runBasePreflight = async (): Promise<LandingBasePreflightResult | { ok: false; decision: LandingBaseDecision; reason: string; retargetError: unknown }> => {
    try {
      return await preflightLandingBase({ cwd, mergeWorktreePath, stackContext: effectiveStackContext, provider, decision: baseDecision });
    } catch (err) {
      return { ok: false, decision: baseDecision, reason: redact(err instanceof Error ? err.message : String(err)), retargetError: err };
    }
  };
  async function* runProviderSync(): AsyncGenerator<EforgeEvent, { ok: true } | { ok: false; reason: string }> {
    try {
      const syncResult = await provider.syncRepo(mergeWorktreePath);
      yield stackProviderCommandEvent(providerName, branch, syncResult, redact);
      return { ok: true };
    } catch (err) {
      const commandEvent = stackProviderCommandEventFromError(providerName, branch, err, redact);
      if (commandEvent) yield commandEvent;
      return { ok: false, reason: redact(err instanceof Error ? err.message : String(err)) };
    }
  }
  async function* runRestackWithRecovery(): AsyncGenerator<EforgeEvent, { ok: true } | { ok: false; reason: string }> {
    try {
      const restackResult = await provider.restackBranch(mergeWorktreePath);
      yield stackProviderCommandEvent(providerName, branch, restackResult, redact);
      return { ok: true };
    } catch (err) {
      const commandEvent = stackProviderCommandEventFromError(providerName, branch, err, redact);
      if (commandEvent) yield commandEvent;

      // --- eforge:region stack-landing-recovery ---
      const classification = await classifyProviderError(provider, mergeWorktreePath, err);
      if (isRecoverableRestackConflict(classification) && providerCanRecoverLandingConflict(provider)) {
        const recoveryResult = yield* consumeRecovery(recoverLandingConflict({
          cwd,
          mergeWorktreePath,
          stackContext: effectiveStackContext,
          provider,
          classification,
          mergeResolver: opts.mergeResolver,
          maxAttempts: opts.maxConflictRecoveryAttempts,
          postRecoveryValidationCommands: opts.postRecoveryValidationCommands,
          validationTimeoutMs: opts.validationTimeoutMs,
          signal: opts.signal,
        }));
        if (recoveryResult.recovered) return { ok: true };
        return { ok: false, reason: restackRecoveryFailureReason(recoveryResult) };
      }
      // --- eforge:endregion stack-landing-recovery ---

      return { ok: false, reason: redact(err instanceof Error ? err.message : String(err)) };
    }
  }

  const preflight = await runBasePreflight();
  baseDecision = preflight.decision;
  effectiveStackContext = stackContextForLandingDecision(stackContext, baseDecision);
  if (!preflight.ok) {
    if ('retargetError' in preflight) {
      const commandEvent = stackProviderCommandEventFromError(providerName, branch, preflight.retargetError, redact);
      if (commandEvent) yield commandEvent;
    }
    yield await failLanding(preflight.reason);
    return;
  }
  if (preflight.retargetResult !== undefined) yield stackProviderCommandEvent(providerName, branch, preflight.retargetResult, redact);

  // Step 1: Sync repo before tracking against the effective base.
  const initialSync = yield* runProviderSync();
  if (!initialSync.ok) {
    yield await failLanding(initialSync.reason);
    return;
  }

  // Step 2: Track branch against the effective base
  let trackResult: ProviderCommandResult;
  try {
    trackResult = await provider.trackBranch(mergeWorktreePath, baseDecision.effectiveBaseBranch);
    yield stackProviderCommandEvent(providerName, branch, trackResult, redact);
  } catch (err) {
    const commandEvent = stackProviderCommandEventFromError(providerName, branch, err, redact);
    if (commandEvent) yield commandEvent;
    yield await failLanding(redact(err instanceof Error ? err.message : String(err)));
    return;
  }

  // Step 3 (pre-submit): Run cleanup before submitting the PR, if configured.
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

  // Step 4: Restack, repair a disappearing parent base, and prove remote-base freshness.
  const maxFreshnessAttempts = 2;
  for (let attempt = 0; attempt < maxFreshnessAttempts; attempt += 1) {
    if (attempt > 0) {
      const retrySync = yield* runProviderSync();
      if (!retrySync.ok) {
        yield await failLanding(retrySync.reason);
        return;
      }
    }

    const restack = yield* runRestackWithRecovery();
    if (!restack.ok) {
      yield await failLanding(restack.reason);
      return;
    }

    const finalPreflight = await runBasePreflight();
    baseDecision = finalPreflight.decision;
    effectiveStackContext = stackContextForLandingDecision(stackContext, baseDecision);
    if (!finalPreflight.ok) {
      if ('retargetError' in finalPreflight) {
        const commandEvent = stackProviderCommandEventFromError(providerName, branch, finalPreflight.retargetError, redact);
        if (commandEvent) yield commandEvent;
      }
      yield await failLanding(finalPreflight.reason);
      return;
    }
    if (finalPreflight.retargetResult !== undefined) {
      yield stackProviderCommandEvent(providerName, branch, finalPreflight.retargetResult, redact);
      const repairedRestack = yield* runRestackWithRecovery();
      if (!repairedRestack.ok) {
        yield await failLanding(repairedRestack.reason);
        return;
      }
    }

    const freshness = await proveLandingHeadFreshness({ mergeWorktreePath, stackContext: effectiveStackContext, decision: baseDecision });
    if (freshness.kind === 'fresh') break;
    if (freshness.kind === 'failed') {
      if (freshness.error !== undefined) {
        const commandEvent = stackProviderCommandEventFromError(providerName, branch, freshness.error, redact);
        if (commandEvent) yield commandEvent;
      }
      yield await failLanding(redact(freshness.reason));
      return;
    }
    if (attempt + 1 >= maxFreshnessAttempts) {
      yield await failLanding(redact(freshness.reason));
      return;
    }
  }

  // Step 5: Submit the branch as a PR
  let submitResult: ProviderCommandResult;
  try {
    submitResult = await provider.submitBranch(mergeWorktreePath);
    yield stackProviderCommandEvent(providerName, branch, submitResult, redact);
  } catch (err) {
    const commandEvent = stackProviderCommandEventFromError(providerName, branch, err, redact);
    if (commandEvent) yield commandEvent;
    const reason = redact(err instanceof Error ? err.message : String(err));
    yield await failLanding(reason);
    return;
  }

  // Step 5: Discover PR URL — parse from submit output, then gh fallback
  const prUrl =
    provider.parsePrUrl(submitResult.stdout) ??
    (await discoverPrUrlViaGh(mergeWorktreePath, branch, provider.isValidPrUrl.bind(provider)));

  // Resolve metadata: prefer lazy factory (called after cleanup) over static metadata.
  let resolvedMetadata: PullRequestMetadata | undefined = metadata;
  if (metadataFactory !== undefined) {
    try {
      resolvedMetadata = await metadataFactory(baseDecision);
    } catch {
      // Best-effort: fall back to static metadata (or skip edit if also absent)
    }
  }
  // Step 5a: Apply deterministic PR metadata via gh pr edit (non-fatal).
  if (prUrl !== undefined && resolvedMetadata !== undefined) {
    try {
      await editPullRequest(mergeWorktreePath, prUrl, resolvedMetadata);
    } catch (editErr) {
      yield {
        timestamp: ts(),
        type: 'planning:progress',
        message: `PR metadata update failed (non-fatal): ${(editErr as Error).message}`,
      } as EforgeEvent;
    }
  }

  // Step 6: Persist complete landing state with layer status transition to 'landed'
  const completedAt = ts();
  await updateStackLayerStatusAndLanding(cwd, prdId, 'landed', {
    action: landingAction,
    status: 'complete',
    ...(prUrl !== undefined && { prUrl }),
    ...(stackContext.parentPrdId !== undefined ? landingBaseMetadata(baseDecision) : {}),
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
    ...(stackContext.parentPrdId !== undefined ? landingBaseMetadata(baseDecision) : {}),
  } as EforgeEvent;

  // Step 7: Attempt PR auto-merge (non-fatal) after successful PR landing.
  yield* emitStackLandingAutoMergeEvents({
    mergeWorktreePath,
    branch,
    baseBranch: baseDecision.effectiveBaseBranch,
    prUrl,
    prAutoMergePolicy,
    landingAutoMerge,
    timestamp: ts,
  });
}
