/**
 * Accept-build-as-successful recovery action — preview and apply helpers.
 *
 * The accepted-success action is a focused human recovery path for a failed PRD
 * whose implementation and deterministic checks are acceptable but final PRD or
 * acceptance validation failed (bad/conflicting/externally-unverifiable
 * criterion). Preview is read-only. Apply is audited, idempotent after the
 * durable sidecar marker is written, and explicit about dependent unblocking:
 * it runs (or no-ops) the normal cleanup commit, applies the configured landing
 * action, records artifact/completion metadata for dependency readiness, moves
 * selected unblockable skipped dependents back to the queue root, and writes the
 * durable `accepted-success` sidecar marker.
 *
 * The failed PRD file and both recovery sidecars remain in `queue/failed/` as
 * audit records — acceptance never deletes them.
 */

import { execFile } from 'node:child_process';
import { readFile, writeFile, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { randomBytes } from 'node:crypto';

import type {
  AcceptSuccessAppliedSummary,
  AcceptSuccessCleanupEffect,
  AcceptSuccessCleanupResult,
  AcceptSuccessDependentCandidate,
  AcceptSuccessDependentResult,
  AcceptSuccessLandingAction,
  AcceptSuccessLandingResult,
  AcceptSuccessPreviewResponse,
  AcceptSuccessReasonCategory,
  AcceptSuccessRequest,
  AcceptSuccessResponse,
  BuildFailureSummary,
} from '@eforge-build/client';
import { ACCEPT_SUCCESS_REASON_CATEGORIES } from '@eforge-build/client';

import { cleanupPlanFiles } from '../cleanup.js';
import { resolveTrunkBranch, isTrunkBranch } from '../branch-policy.js';
import {
  loadArtifactRegistry,
  hasUsableArtifact,
  upsertArtifact,
  type ArtifactRegistry,
} from '../artifacts/registry.js';
import { upsertCompletion } from '../artifacts/completions.js';
import { loadQueue, type QueuedPrd } from '../prd-queue.js';
import {
  readRawAppliedAction,
  readAcceptSuccessAppliedMetadata,
  writeAcceptSuccessAppliedMetadata,
} from './applied-sidecar.js';

const exec = promisify(execFile);

const REASON_CATEGORY_SET = new Set<AcceptSuccessReasonCategory>(ACCEPT_SUCCESS_REASON_CATEGORIES);

/** Error with an HTTP status hint, surfaced by the monitor route as that status. */
export class AcceptSuccessError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'AcceptSuccessError';
  }
}

export interface AcceptSuccessHelperOptions {
  /** Repository root. */
  cwd: string;
  /** Plan ID of the failed PRD. */
  prdId: string;
  /** Absolute path to the queue directory (e.g. `<cwd>/.eforge/queue`). */
  queueDir: string;
  /** Effective landing action (resolved from project configuration). Default `merge`. */
  landingAction?: AcceptSuccessLandingAction;
  /** Relative plan output directory (resolved from configuration). Default `eforge/plans`. */
  planOutputDir?: string;
  /** Explicit trunk branch (`build.trunkBranch`); resolved via git when omitted. */
  trunkBranch?: string;
  /** Permit local merge directly to trunk (`build.allowLocalMergeToTrunk`). Default `false`. */
  allowLocalMergeToTrunk?: boolean;
}

// ---------------------------------------------------------------------------
// Validation / segment guards
// ---------------------------------------------------------------------------

function assertSafePrdId(prdId: string): void {
  if (!prdId || prdId.includes('/') || prdId.includes('\\') || prdId.includes('..')) {
    throw new AcceptSuccessError('Invalid prdId: must not contain path separators or traversal sequences', 400);
  }
}

/** Reject a sidecar `setName` that could escape the plan output dir as a path segment. */
function assertSafeSetName(setName: unknown): asserts setName is string {
  if (typeof setName !== 'string' || setName.length === 0 || setName.includes('..') ||
      setName.startsWith('/') || setName.startsWith('\\') || setName.includes('\0')) {
    throw new AcceptSuccessError('Recovery sidecar contains an unsafe or missing setName', 400);
  }
}

/** Validate a sidecar branch name with `git check-ref-format` before using it in git ops. */
async function assertValidGitBranch(cwd: string, branch: string, label: string): Promise<void> {
  if (typeof branch !== 'string' || branch.length === 0) {
    throw new AcceptSuccessError(`Recovery sidecar is missing the ${label}`, 400);
  }
  try {
    await exec('git', ['check-ref-format', `refs/heads/${branch}`], { cwd });
  } catch {
    throw new AcceptSuccessError(`Recovery sidecar contains an invalid ${label} '${branch}'`, 400);
  }
}

// ---------------------------------------------------------------------------
// Sidecar reads
// ---------------------------------------------------------------------------

interface LoadedSidecar {
  summary: BuildFailureSummary;
  sidecarJsonPath: string;
}

async function loadFailedSidecar(options: AcceptSuccessHelperOptions): Promise<LoadedSidecar> {
  const { cwd, prdId, queueDir } = options;
  const sidecarJsonPath = join(queueDir, 'failed', `${prdId}.recovery.json`);
  let raw: string;
  try {
    raw = await readFile(sidecarJsonPath, 'utf-8');
  } catch {
    throw new AcceptSuccessError(`No recovery sidecar found for ${prdId}`, 404);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new AcceptSuccessError(`Malformed recovery sidecar JSON for ${prdId}`, 400);
  }
  if (typeof parsed !== 'object' || parsed === null || !('summary' in parsed)) {
    throw new AcceptSuccessError(`Recovery sidecar for ${prdId} is missing the summary field`, 400);
  }
  const summary = (parsed as { summary?: unknown }).summary as BuildFailureSummary;
  if (typeof summary !== 'object' || summary === null || typeof summary.featureBranch !== 'string') {
    throw new AcceptSuccessError(`Invalid recovery summary in sidecar for ${prdId}`, 400);
  }
  // Defend destructive cleanup/landing against a tampered/mismatched sidecar.
  if (summary.prdId !== prdId) {
    throw new AcceptSuccessError(`Recovery sidecar prdId '${String(summary.prdId)}' does not match requested ${prdId}`, 400);
  }
  assertSafeSetName(summary.setName);
  await assertValidGitBranch(cwd, summary.featureBranch, 'featureBranch');
  await assertValidGitBranch(cwd, summary.baseBranch, 'baseBranch');
  return { summary, sidecarJsonPath };
}

// ---------------------------------------------------------------------------
// Eligibility
// ---------------------------------------------------------------------------

interface EligibilityResult {
  eligible: boolean;
  reason?: string;
}

/**
 * Accepted-success eligibility requires a sidecar summary that indicates PRD or
 * acceptance validation failure plus evidence of acceptable implementation:
 * non-empty landed commits and deterministic validation command evidence whose
 * exit codes are all `0` when commands are present.
 */
export function evaluateAcceptSuccessEligibility(summary: BuildFailureSummary): EligibilityResult {
  const acceptanceValidation = summary.acceptanceValidation;
  const terminalFailure = summary.terminalFailure;
  const prdOrAcceptanceFailure =
    acceptanceValidation?.passed === false ||
    terminalFailure?.scope === 'acceptance-validation' ||
    terminalFailure?.scope === 'prd-validation' ||
    terminalFailure?.acceptanceValidationPassed === false ||
    terminalFailure?.prdValidationPassed === false;
  if (!prdOrAcceptanceFailure) {
    return { eligible: false, reason: 'The build did not fail PRD or acceptance validation; accepted-success only applies to those failures.' };
  }

  const landedCommitCount = summary.landedCommits?.length ?? 0;
  if (landedCommitCount === 0) {
    return { eligible: false, reason: 'No landed commits found; there is no implementation to accept.' };
  }

  const commands = summary.validationCommands;
  if (commands && commands.length > 0) {
    const failing = commands.filter((c) => c.exitCode !== 0);
    if (failing.length > 0) {
      return { eligible: false, reason: `Deterministic validation commands did not all pass: ${failing.map((c) => c.command).join(', ')}.` };
    }
  }

  return { eligible: true };
}

// ---------------------------------------------------------------------------
// Git helpers (worktree-isolated cleanup + landing)
// ---------------------------------------------------------------------------

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

async function fileExistsOnBranch(cwd: string, branch: string, relPath: string): Promise<boolean> {
  try {
    await exec('git', ['cat-file', '-e', `${branch}:${relPath}`], { cwd });
    return true;
  } catch {
    return false;
  }
}

async function treePathPresentOnBranch(cwd: string, branch: string, relPath: string): Promise<boolean> {
  try {
    const { stdout } = await exec('git', ['ls-tree', '-r', '--name-only', branch, '--', relPath], { cwd });
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

async function addDetachedWorktree(cwd: string, ref: string): Promise<string> {
  const wtPath = join(cwd, '.eforge', 'tmp', `accept-${randomBytes(6).toString('hex')}`);
  await exec('git', ['worktree', 'add', '--detach', '--quiet', wtPath, ref], { cwd });
  return wtPath;
}

async function removeWorktree(cwd: string, wtPath: string): Promise<void> {
  try {
    await exec('git', ['worktree', 'remove', '--force', wtPath], { cwd });
  } catch {
    await rm(wtPath, { recursive: true, force: true }).catch(() => {});
    await exec('git', ['worktree', 'prune'], { cwd }).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

/**
 * Run the normal post-build cleanup on the feature branch in an isolated
 * detached worktree, then advance the branch ref to the cleanup commit. Reports
 * `committed` with the cleanup commit SHA when artifacts were removed, or `noop`
 * when no plan/PRD artifacts were present.
 */
async function runAcceptedSuccessCleanup(
  options: AcceptSuccessHelperOptions,
  summary: BuildFailureSummary,
): Promise<AcceptSuccessCleanupResult> {
  const { cwd, prdId, planOutputDir = 'eforge/plans' } = options;
  const featureBranch = summary.featureBranch;
  if (!(await branchExists(cwd, featureBranch))) return { status: 'noop' };

  const wtPath = await addDetachedWorktree(cwd, featureBranch);
  try {
    const before = await gitRevParse(wtPath, 'HEAD');
    const prdArtifactRelPath = `eforge/prds/${prdId}.md`;
    // Drain cleanup events — accepted-success does not emit build events.
    for await (const _event of cleanupPlanFiles(wtPath, summary.setName, planOutputDir, prdArtifactRelPath)) {
      void _event;
    }
    const after = await gitRevParse(wtPath, 'HEAD');
    if (after !== before) {
      await exec('git', ['update-ref', `refs/heads/${featureBranch}`, after], { cwd });
      return { status: 'committed', commitSha: after };
    }
    return { status: 'noop' };
  } finally {
    await removeWorktree(cwd, wtPath);
  }
}

// ---------------------------------------------------------------------------
// Landing
// ---------------------------------------------------------------------------

async function landAcceptedSuccessBuild(
  options: AcceptSuccessHelperOptions,
  summary: BuildFailureSummary,
): Promise<AcceptSuccessLandingResult> {
  const { cwd, landingAction = 'merge' } = options;
  const featureBranch = summary.featureBranch;
  const baseBranch = summary.baseBranch;

  if (!(await branchExists(cwd, featureBranch))) {
    return { action: landingAction, status: 'failed', branch: featureBranch, reason: `Feature branch '${featureBranch}' not found` };
  }

  if (landingAction === 'leave') {
    return { action: 'leave', status: 'complete', branch: featureBranch };
  }

  if (landingAction === 'merge') {
    // Enforce the same local-merge-to-trunk policy as the normal landing path:
    // refuse to merge directly into trunk unless explicitly opted in.
    const trunk = options.trunkBranch ?? await resolveTrunkBranch(undefined, cwd);
    if (isTrunkBranch(baseBranch, trunk) && !(options.allowLocalMergeToTrunk ?? false)) {
      return { action: 'merge', status: 'skipped', branch: featureBranch, reason: `Local merge to trunk '${trunk}' is not permitted (set allowLocalMergeToTrunk: true to opt in)` };
    }
    // Compare-and-swap base ref update: refuse to clobber a concurrently-advanced base.
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

  // pr
  try {
    await exec('git', ['push', 'origin', featureBranch], { cwd });
    const { stdout } = await exec('gh', ['pr', 'create', '--base', baseBranch, '--head', featureBranch, '--fill'], { cwd });
    const prUrl = stdout.trim().split('\n').find((line) => line.startsWith('http'));
    return { action: 'pr', status: 'complete', branch: featureBranch, ...(prUrl ? { prUrl } : {}) };
  } catch (err) {
    return { action: 'pr', status: 'failed', branch: featureBranch, reason: `PR creation failed: ${(err as Error).message}` };
  }
}

// ---------------------------------------------------------------------------
// Dependent candidates / movement
// ---------------------------------------------------------------------------

function directSkippedDependents(skipped: QueuedPrd[], acceptedPrdId: string): QueuedPrd[] {
  return skipped.filter((p) => p.frontmatter.depends_on?.includes(acceptedPrdId) ?? false);
}

function dependencyBlockers(
  remaining: string[],
  registry: ArtifactRegistry,
): string[] {
  return remaining.filter((dep) => !hasUsableArtifact(registry, dep));
}

async function buildDependentCandidates(
  options: AcceptSuccessHelperOptions,
): Promise<AcceptSuccessDependentCandidate[]> {
  const { cwd, prdId, queueDir } = options;
  const skipped = await loadQueue(join(queueDir, 'skipped'), cwd).catch((): QueuedPrd[] => []);
  const registry = await loadArtifactRegistry(cwd);
  return directSkippedDependents(skipped, prdId).map((prd) => {
    const remaining = (prd.frontmatter.depends_on ?? []).filter((d) => d !== prdId);
    const blockedBy = dependencyBlockers(remaining, registry);
    return {
      prdId: prd.id,
      title: prd.frontmatter.title,
      remainingDependencies: remaining,
      unblockable: blockedBy.length === 0,
      blockedBy,
    };
  });
}

/** Rewrite the `depends_on` frontmatter line, removing it entirely when empty. */
function setDependsOnInContent(content: string, remaining: string[]): string {
  if (remaining.length === 0) {
    return content.replace(/^depends_on:.*\r?\n/m, '');
  }
  const line = `depends_on: [${remaining.map((d) => `"${d}"`).join(', ')}]`;
  return content.replace(/^depends_on:.*$/m, line);
}

/**
 * Move selected, direct skipped dependents whose remaining dependencies are
 * satisfied back to the queue root with the accepted PRD removed from
 * `depends_on`. Selected dependents that remain blocked, or that are not direct
 * skipped dependents, are reported but left in place.
 */
async function moveSelectedDependents(
  options: AcceptSuccessHelperOptions,
  selectedIds: string[],
  registry: ArtifactRegistry,
): Promise<AcceptSuccessDependentResult> {
  const { cwd, prdId, queueDir } = options;
  const result: AcceptSuccessDependentResult = { unblocked: [], remainedBlocked: [], notFound: [] };
  if (selectedIds.length === 0) return result;

  const skipped = await loadQueue(join(queueDir, 'skipped'), cwd).catch((): QueuedPrd[] => []);
  const byId = new Map(directSkippedDependents(skipped, prdId).map((p) => [p.id, p] as const));

  for (const id of selectedIds) {
    const prd = byId.get(id);
    if (!prd) {
      result.notFound.push(id);
      continue;
    }
    const remaining = (prd.frontmatter.depends_on ?? []).filter((d) => d !== prdId);
    const blockedBy = dependencyBlockers(remaining, registry);
    if (blockedBy.length > 0) {
      result.remainedBlocked.push(id);
      continue;
    }
    const newContent = setDependsOnInContent(prd.content, remaining);
    const destPath = resolve(queueDir, `${id}.md`);
    // eslint-disable-next-line no-await-in-loop
    await writeFile(destPath, newContent, 'utf-8');
    // eslint-disable-next-line no-await-in-loop
    await rm(prd.filePath, { force: true });
    result.unblocked.push(id);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Preview
// ---------------------------------------------------------------------------

export async function previewAcceptSuccess(
  options: AcceptSuccessHelperOptions,
): Promise<AcceptSuccessPreviewResponse> {
  assertSafePrdId(options.prdId);
  const { cwd, prdId, planOutputDir = 'eforge/plans', landingAction = 'merge' } = options;
  const { summary, sidecarJsonPath } = await loadFailedSidecar(options);

  const featureBranch = summary.featureBranch;
  const hasFeatureBranch = await branchExists(cwd, featureBranch);
  const planArtifactsPresent = hasFeatureBranch
    ? await treePathPresentOnBranch(cwd, featureBranch, `${planOutputDir}/${summary.setName}`)
    : false;
  const prdArtifactPresent = hasFeatureBranch
    ? await fileExistsOnBranch(cwd, featureBranch, `eforge/prds/${prdId}.md`)
    : false;

  const cleanup: AcceptSuccessCleanupEffect = {
    planSet: summary.setName,
    planArtifactsPresent,
    prdArtifactPresent,
    willCommit: planArtifactsPresent || prdArtifactPresent,
  };

  const dependentCandidates = await buildDependentCandidates(options);

  const base = {
    prdId,
    landingAction,
    cleanup,
    audit: {
      setName: summary.setName,
      featureBranch,
      baseBranch: summary.baseBranch,
      landedCommitCount: summary.landedCommits?.length ?? 0,
    },
    dependentCandidates,
  } as const;

  const acceptApplied = await readAcceptSuccessAppliedMetadata(sidecarJsonPath);
  if (acceptApplied) {
    return { ...base, status: 'already-applied', applied: acceptApplied };
  }
  // Inspect the raw applied action before strict parsing so a malformed marker conflicts.
  const rawAppliedAction = await readRawAppliedAction(sidecarJsonPath);
  if (rawAppliedAction === 'accepted-success') {
    return { ...base, status: 'ineligible', reason: 'An accepted-success marker already exists but is malformed; inspect the recovery sidecar manually.' };
  }
  if (rawAppliedAction !== undefined) {
    return { ...base, status: 'ineligible', reason: `A different recovery action ('${rawAppliedAction}') was already applied to this PRD.` };
  }

  const eligibility = evaluateAcceptSuccessEligibility(summary);
  if (!eligibility.eligible) {
    return { ...base, status: 'ineligible', ...(eligibility.reason ? { reason: eligibility.reason } : {}) };
  }
  return { ...base, status: 'eligible' };
}

// ---------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------

function validateApplyRequest(request: AcceptSuccessRequest): { reasonCategory: AcceptSuccessReasonCategory; reason: string; unblockDependentIds: string[] } {
  if (!REASON_CATEGORY_SET.has(request.reasonCategory)) {
    throw new AcceptSuccessError(`Invalid or missing reasonCategory; expected one of: ${ACCEPT_SUCCESS_REASON_CATEGORIES.join(', ')}`, 400);
  }
  if (typeof request.reason !== 'string' || request.reason.trim().length === 0) {
    throw new AcceptSuccessError('A non-empty reason is required to accept a build as successful', 400);
  }
  const unblockDependentIds = request.unblockDependentIds ?? [];
  if (!Array.isArray(unblockDependentIds) || unblockDependentIds.some((id) => typeof id !== 'string')) {
    throw new AcceptSuccessError('unblockDependentIds must be an array of strings', 400);
  }
  return { reasonCategory: request.reasonCategory, reason: request.reason.trim(), unblockDependentIds };
}

export async function applyAcceptSuccess(
  options: AcceptSuccessHelperOptions,
  request: AcceptSuccessRequest,
): Promise<AcceptSuccessResponse> {
  assertSafePrdId(options.prdId);
  const validated = validateApplyRequest(request);
  const { cwd, prdId } = options;
  const { summary, sidecarJsonPath } = await loadFailedSidecar(options);

  // Idempotency: a durable accepted-success marker (the rich
  // `AcceptSuccessAppliedSummary`, keyed by `acceptedAt`) short-circuits without
  // re-running cleanup, landing, or dependent moves.
  const acceptApplied = await readAcceptSuccessAppliedMetadata(sidecarJsonPath);
  if (acceptApplied) {
    return { prdId, status: 'already-applied', applied: acceptApplied };
  }
  // Inspect the raw applied action before strict parsing so any other applied marker
  // (including a malformed one) conflicts rather than being silently overwritten.
  const rawAppliedAction = await readRawAppliedAction(sidecarJsonPath);
  if (rawAppliedAction === 'accepted-success') {
    throw new AcceptSuccessError(`An accepted-success marker already exists for ${prdId} but is malformed; refusing to overwrite. Inspect ${prdId}.recovery.json manually.`, 409);
  }
  if (rawAppliedAction !== undefined) {
    throw new AcceptSuccessError(`A different recovery action ('${rawAppliedAction}') was already applied to ${prdId}; cannot accept as successful.`, 409);
  }

  const eligibility = evaluateAcceptSuccessEligibility(summary);
  if (!eligibility.eligible) {
    throw new AcceptSuccessError(eligibility.reason ?? `${prdId} is not eligible to be accepted as successful`, 422);
  }

  const featureBranch = summary.featureBranch;
  if (!(await branchExists(cwd, featureBranch))) {
    throw new AcceptSuccessError(`Feature branch '${featureBranch}' not found; cannot accept build as successful`, 422);
  }

  // 1. Cleanup (or no-op) on the feature branch.
  const cleanup = await runAcceptedSuccessCleanup(options, summary);

  // 2. Landing.
  const landing = await landAcceptedSuccessBuild(options, summary);

  // 3. Record artifact + completion so dependents can treat the accepted build
  //    as satisfied once the accepted dependency is removed.
  const now = new Date().toISOString();
  const featureHeadSha = await gitRevParse(cwd, featureBranch);
  await upsertArtifact(cwd, {
    prdId,
    artifactBranch: featureBranch,
    commitSha: featureHeadSha,
    resolvedBase: summary.baseBranch,
    landingAction: options.landingAction ?? 'merge',
    status: 'built',
    recordedAt: now,
    updatedAt: now,
    landingStatus: landing.status,
    landingCompletedAt: now,
    ...(landing.prUrl ? { prUrl: landing.prUrl } : {}),
    ...(landing.status !== 'complete' && landing.reason ? { landingFailureReason: landing.reason } : {}),
  });
  await upsertCompletion(cwd, {
    prdId,
    status: 'completed',
    artifactAvailable: true,
    artifactBranch: featureBranch,
    completedAt: now,
    updatedAt: now,
  });

  // 4. Move selected unblockable skipped dependents (registry now includes the
  //    accepted PRD's artifact, so accepted-only dependents become satisfied).
  const registry = await loadArtifactRegistry(cwd);
  const dependents = await moveSelectedDependents(options, validated.unblockDependentIds, registry);

  // 5. Durable accepted-success marker — the idempotency anchor.
  const applied: AcceptSuccessAppliedSummary = {
    action: 'accepted-success',
    acceptedAt: now,
    reasonCategory: validated.reasonCategory,
    reason: validated.reason,
    cleanup,
    landing,
    dependents,
  };
  await writeAcceptSuccessAppliedMetadata(sidecarJsonPath, applied);

  return { prdId, status: 'applied', applied };
}
