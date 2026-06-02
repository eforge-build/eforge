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
import { loadStackState, lookupLayerByPrdId, updateStackLayerLanding, updateStackLayerStatusAndLanding } from './state.js';
import { loadArtifactRegistry, lookupArtifactByPrdId } from '../artifacts/registry.js';
import { fetchRemoteBranchHeadCommit, isAncestor, remoteBranchExists, resolveRefCommit, type StackBaseRepairReason } from './base-repair.js';
import { recoverLandingConflict, type LandingConflictRecoveryResult } from './landing-conflict-recovery.js';
import { stackProviderCommandEvent, stackProviderCommandEventFromError } from './provider-events.js';
// PR URL parsing and redaction are delegated to provider helpers (parsePrUrl, isValidPrUrl, redactMessage)
// to avoid direct git-spice imports in orchestration code.
import { runCleanup } from '../landing.js';
import { resolvePrAutoMergeIntent } from '../config.js';
import { enablePullRequestAutoMerge } from '../worktree-ops.js';
import { editPullRequest } from '../worktree-ops.js';
import type { PullRequestMetadata } from '../pr-metadata.js';

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

export interface StackLandingBaseMetadata {
  originalBaseBranch?: string;
  effectiveBaseBranch: string;
  baseRepairReason?: StackBaseRepairReason;
}

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

// --- eforge:region plan-02-landing-preflight-and-observability ---
type LandingBaseDecision = StackLandingBaseMetadata;

type LandingBasePreflightResult =
  | { ok: true; decision: LandingBaseDecision; retargetResult?: ProviderCommandResult }
  | { ok: false; decision: LandingBaseDecision; reason: string };

function initialLandingBaseDecision(stackContext: StackBaseContext, fallbackBase: string): LandingBaseDecision {
  const effectiveBaseBranch = stackContext.baseBranch ?? fallbackBase;
  const originalBaseBranch = stackContext.originalBaseBranch ?? effectiveBaseBranch;
  return {
    originalBaseBranch,
    effectiveBaseBranch,
    ...(stackContext.repairReason !== undefined && { baseRepairReason: stackContext.repairReason }),
  };
}

function landingBaseMetadata(decision: LandingBaseDecision): Partial<LandingBaseDecision> {
  return {
    originalBaseBranch: decision.originalBaseBranch,
    effectiveBaseBranch: decision.effectiveBaseBranch,
    ...(decision.baseRepairReason !== undefined && { baseRepairReason: decision.baseRepairReason }),
  };
}

async function resolveParentArtifactCommit(cwd: string, stackContext: StackBaseContext): Promise<string | undefined> {
  if (stackContext.parentArtifactCommit !== undefined) return stackContext.parentArtifactCommit;
  if (stackContext.parentPrdId === undefined) return undefined;
  const [registry, stackState] = await Promise.all([loadArtifactRegistry(cwd), loadStackState(cwd)]);
  const artifactRecord = lookupArtifactByPrdId(registry, stackContext.parentPrdId);
  const parentLayer = lookupLayerByPrdId(stackState, stackContext.parentPrdId);
  const artifactRef = stackContext.parentArtifactRef
    ?? (artifactRecord?.status === 'built' ? artifactRecord.artifactBranch : undefined)
    ?? parentLayer?.artifact?.branch;
  const refCommit = artifactRef !== undefined ? await resolveRefCommit(cwd, artifactRef) : undefined;
  if (refCommit !== undefined) return refCommit;
  const recordedCommit = artifactRecord?.commitSha ?? parentLayer?.artifact?.commitSha;
  return recordedCommit !== undefined ? resolveRefCommit(cwd, recordedCommit) : undefined;
}

async function verifyParentIntegratedIntoRemoteTrunk(options: {
  cwd: string;
  mergeWorktreePath: string;
  stackContext: StackBaseContext;
  decision: LandingBaseDecision;
  remote: string;
  trunkBranch: string;
  missingBaseBranch?: string;
}): Promise<{ ok: true; parentCommit: string; remoteTrunkCommit: string } | { ok: false; reason: string }> {
  const { cwd, mergeWorktreePath, stackContext, decision, remote, trunkBranch, missingBaseBranch } = options;
  const parentCommit = await resolveParentArtifactCommit(cwd, stackContext);
  const baseDescription = missingBaseBranch !== undefined
    ? `Remote base branch '${missingBaseBranch}' is missing on remote '${remote}' and `
    : `Effective trunk base '${decision.effectiveBaseBranch}' requires current remote integration proof, but `;
  if (parentCommit === undefined) {
    return { ok: false, reason: `${baseDescription}parent artifact commit evidence is unavailable; cannot prove the parent is integrated into trunk '${trunkBranch}'` };
  }
  const remoteTrunk = await fetchRemoteBranchHeadCommit(mergeWorktreePath, trunkBranch, remote);
  if (!remoteTrunk.ok) {
    return { ok: false, reason: `${baseDescription}current trunk '${trunkBranch}' could not be resolved from remote '${remote}'${remoteTrunk.stderr ? `: ${remoteTrunk.stderr}` : ''}` };
  }
  if (!await isAncestor(mergeWorktreePath, parentCommit, remoteTrunk.commit)) {
    return { ok: false, reason: `${baseDescription}parent artifact commit '${parentCommit}' is not an ancestor of current remote trunk '${remoteTrunk.commit}'` };
  }
  return { ok: true, parentCommit, remoteTrunkCommit: remoteTrunk.commit };
}

function requiresCurrentTrunkProof(decision: LandingBaseDecision, trunkBranch: string): boolean {
  return decision.effectiveBaseBranch === trunkBranch &&
    (decision.baseRepairReason !== undefined || decision.originalBaseBranch !== decision.effectiveBaseBranch);
}

function stackContextForLandingDecision(
  stackContext: StackBaseContext,
  decision: LandingBaseDecision,
): StackBaseContext {
  const effectiveContext: StackBaseContext = {
    ...stackContext,
    baseBranch: decision.effectiveBaseBranch,
    originalBaseBranch: decision.originalBaseBranch,
    effectiveBaseBranch: decision.effectiveBaseBranch,
  };
  if (decision.baseRepairReason !== undefined) {
    effectiveContext.repairReason = decision.baseRepairReason;
  } else {
    delete effectiveContext.repairReason;
  }
  return effectiveContext;
}

async function preflightLandingBase(options: {
  cwd: string;
  mergeWorktreePath: string;
  stackContext: StackBaseContext;
  provider: StackProviderAdapter;
  decision: LandingBaseDecision;
}): Promise<LandingBasePreflightResult> {
  const { cwd, mergeWorktreePath, stackContext, provider } = options;
  const decision = { ...options.decision };
  if (stackContext.parentPrdId === undefined) return { ok: true, decision };
  const remote = stackContext.trunkRemote ?? 'origin';
  const trunkBranch = stackContext.trunkBranch ?? 'main';
  const remoteCheck = await remoteBranchExists(mergeWorktreePath, decision.effectiveBaseBranch, remote);
  if (remoteCheck.exists) {
    if (requiresCurrentTrunkProof(decision, trunkBranch)) {
      const proof = await verifyParentIntegratedIntoRemoteTrunk({ cwd, mergeWorktreePath, stackContext, decision, remote, trunkBranch });
      if (!proof.ok) return { ok: false, decision, reason: proof.reason };
    }
    return { ok: true, decision };
  }
  if (remoteCheck.reason === 'query-failed') {
    return { ok: false, decision, reason: `Cannot verify remote base branch '${decision.effectiveBaseBranch}' on remote '${remote}'; remote query failed${remoteCheck.stderr ? `: ${remoteCheck.stderr}` : ''}` };
  }
  if (decision.effectiveBaseBranch === trunkBranch) {
    return { ok: false, decision, reason: `Remote base branch '${decision.effectiveBaseBranch}' is missing on remote '${remote}'; cannot submit stacked child against a missing trunk base` };
  }
  const proof = await verifyParentIntegratedIntoRemoteTrunk({ cwd, mergeWorktreePath, stackContext, decision, remote, trunkBranch, missingBaseBranch: decision.effectiveBaseBranch });
  if (!proof.ok) return { ok: false, decision, reason: proof.reason };
  const repairedDecision: LandingBaseDecision = {
    originalBaseBranch: decision.originalBaseBranch ?? decision.effectiveBaseBranch,
    effectiveBaseBranch: trunkBranch,
    baseRepairReason: 'parent-artifact-already-integrated',
  };
  const retargetResult = await provider.retargetBranch(mergeWorktreePath, stackContext.branch, trunkBranch);
  return { ok: true, decision: repairedDecision, retargetResult };
}
// --- eforge:endregion plan-02-landing-preflight-and-observability ---

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

  // --- eforge:region plan-02-landing-preflight-and-observability ---
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
  // --- eforge:endregion plan-02-landing-preflight-and-observability ---

  // Step 1: Track branch against the effective base
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

  // Step 3: Restack branch so it sits atop the latest base tip before submit
  try {
    const restackResult = await provider.restackBranch(mergeWorktreePath);
    yield stackProviderCommandEvent(providerName, branch, restackResult, redact);
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
      if (recoveryResult.recovered) {
        // Recovery completed the interrupted restack; continue through the existing submit path.
      } else {
        const reason = restackRecoveryFailureReason(recoveryResult);
        yield await failLanding(reason);
        return;
      }
    // --- eforge:endregion stack-landing-recovery ---
    } else {
      const reason = redact(err instanceof Error ? err.message : String(err));
      yield await failLanding(reason);
      return;
    }
  }

  // --- eforge:region plan-02-landing-preflight-and-observability ---
  const finalPreflight = await runBasePreflight();
  baseDecision = finalPreflight.decision;
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
    try {
      const repairedRestack = await provider.restackBranch(mergeWorktreePath);
      yield stackProviderCommandEvent(providerName, branch, repairedRestack, redact);
    } catch (err) {
      const commandEvent = stackProviderCommandEventFromError(providerName, branch, err, redact);
      if (commandEvent) yield commandEvent;
      yield await failLanding(redact(err instanceof Error ? err.message : String(err)));
      return;
    }
  }
  // --- eforge:endregion plan-02-landing-preflight-and-observability ---

  // Step 4: Submit the branch as a PR
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
  const shouldAutoMerge = resolvePrAutoMergeIntent(prAutoMergePolicy, landingAutoMerge);
  const autoMergeBaseBranch = baseDecision.effectiveBaseBranch;
  if (shouldAutoMerge) {
    if (prUrl === undefined) {
      // No PR URL was discovered from the git-spice output — skip auto-merge with a diagnostic.
      yield {
        timestamp: ts(),
        type: 'landing:auto-merge:skipped',
        featureBranch: branch,
        baseBranch: autoMergeBaseBranch,
        reason: 'No PR URL discovered; cannot enable auto-merge for stacked PR',
      } as unknown as EforgeEvent;
    } else {
      yield {
        timestamp: ts(),
        type: 'landing:auto-merge:start',
        featureBranch: branch,
        baseBranch: autoMergeBaseBranch,
        prUrl,
      } as unknown as EforgeEvent;
      try {
        await enablePullRequestAutoMerge(mergeWorktreePath, prUrl);
        yield {
          timestamp: ts(),
          type: 'landing:auto-merge:complete',
          featureBranch: branch,
          baseBranch: autoMergeBaseBranch,
          prUrl,
        } as unknown as EforgeEvent;
      } catch (autoMergeErr) {
        yield {
          timestamp: ts(),
          type: 'landing:auto-merge:skipped',
          featureBranch: branch,
          baseBranch: autoMergeBaseBranch,
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
      baseBranch: autoMergeBaseBranch,
      ...(prUrl !== undefined && { prUrl }),
      reason: skipReason,
    } as unknown as EforgeEvent;
  }
}
