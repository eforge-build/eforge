/**
 * Recovery verdict dispatch helpers — apply the verdict from a recovery sidecar.
 *
 * Each mutating helper performs one atomic filesystem mutation. Queue state
 * is runtime (`.eforge/queue` is gitignored), so no git operations are needed.
 * `manual` is a no-op: it returns without touching the working tree.
 *
 * Callers are expected to have already validated the verdict via recoveryVerdictSchema
 * before invoking these helpers.
 */

import { rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import type { ModelTracker } from '../model-tracker.js';
import type { BuildFailureSummary, RecoveryVerdict } from '../events.js';
import { enqueuePrd, inferTitle, loadQueue, getRecoveryContinuationFrontmatter } from '../prd-queue.js';
import { formatAcceptanceInventoryDiagnostics, requireAcceptanceCriteriaInventoryFromPrd, stripAcceptanceCriteriaInventoryBlock, validateCanonicalAcceptanceCriteriaInventory, type CanonicalAcceptanceCriteriaInventory } from '../validation/acceptance-criteria-inventory.js';
import { deriveSplitRecoveryContinuation } from './continuation.js';
import { readRawAppliedAction, readRecoveryAppliedMetadata, writeRecoveryAppliedMetadata } from './applied-sidecar.js';

export interface ApplyHelperOptions {
  /** Absolute working directory (repo root). */
  cwd: string;
  /** Plan ID of the failed PRD. */
  prdId: string;
  /** Absolute path to the queue directory (e.g. `<cwd>/eforge/queue`). */
  queueDir: string;
  /** Optional model tracker — retained for interface compatibility. */
  modelTracker?: ModelTracker;
}

export interface NormalizedRecoverySuccessorPrd {
  visibleBody: string;
  legacyAcceptanceCriteriaInventory?: CanonicalAcceptanceCriteriaInventory;
}

export function normalizeRecoverySuccessorPrd(markdown: string): NormalizedRecoverySuccessorPrd {
  const body = markdown
    .replace(/^\s*---\r?\n[\s\S]*?\r?\n---\r?\n?/, '')
    .replace(/^\s+/, '');
  const visibleBody = stripAcceptanceCriteriaInventoryBlock(body).trimEnd();
  let legacyAcceptanceCriteriaInventory: CanonicalAcceptanceCriteriaInventory | undefined;
  try {
    legacyAcceptanceCriteriaInventory = requireAcceptanceCriteriaInventoryFromPrd(body);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!/missing.*inventory|missing-block/i.test(message)) throw err;
  }
  return { visibleBody, legacyAcceptanceCriteriaInventory };
}

function validateRecoveryInventory(
  inventory: CanonicalAcceptanceCriteriaInventory,
  visibleBody: string,
): CanonicalAcceptanceCriteriaInventory {
  const result = validateCanonicalAcceptanceCriteriaInventory(inventory, visibleBody, { requireIds: false });
  if (!result.valid) throw new Error(formatAcceptanceInventoryDiagnostics(result.diagnostics));
  return result.inventory;
}

/**
 * Reject a sidecar recovery mutation when a durable applied marker for a
 * *different* recovery action already exists. Protects an already-applied marker
 * (notably `accepted-success`, whose rich audit summary lives on the same
 * sidecar) from being deleted or overwritten by a later retry/split/abandon
 * apply. Reads the raw `applied.action` so even a malformed marker is honored.
 *
 * Same-action idempotent paths are handled by the callers (split via
 * `checkSplitRecoveryIdempotency`); retry/abandon write no marker of their own,
 * so any pre-existing marker conflicts.
 */
async function assertNoConflictingAppliedMarker(
  sidecarJsonPath: string,
  action: 'retry' | 'split' | 'abandon',
): Promise<void> {
  const existingAction = await readRawAppliedAction(sidecarJsonPath);
  if (existingAction !== undefined && existingAction !== action) {
    throw new Error(
      `A different recovery action ('${existingAction}') was already applied to this PRD; refusing to apply '${action}' and overwrite its durable applied marker.`,
    );
  }
}

/**
 * Apply a `retry` verdict: move the failed PRD back to the queue and remove both
 * sidecar files. Auto-build will pick up the requeued PRD on the next tick.
 * Filesystem-only — queue state is runtime, not tracked in git.
 */
export async function applyRecoveryRetry(
  options: ApplyHelperOptions,
): Promise<{ commitSha: string }> {
  const { prdId, queueDir } = options;
  const failedDir = join(queueDir, 'failed');
  const failedPrdPath = join(failedDir, `${prdId}.md`);
  const queuedPrdPath = join(queueDir, `${prdId}.md`);
  const recoveryMdPath = join(failedDir, `${prdId}.recovery.md`);
  const recoveryJsonPath = join(failedDir, `${prdId}.recovery.json`);

  // Refuse to clobber another action's durable applied marker / audit record.
  await assertNoConflictingAppliedMarker(recoveryJsonPath, 'retry');

  // Move failed PRD back to queue root
  await rename(failedPrdPath, queuedPrdPath);
  // Remove both sidecar files
  await rm(recoveryMdPath, { force: true });
  await rm(recoveryJsonPath, { force: true });

  return { commitSha: '' };
}

/**
 * Apply a `split` verdict: write the suggested successor PRD to the queue directory.
 * The failed PRD and both sidecars remain under `failed/` as the audit trail.
 * Filesystem-only — queue state is runtime, not tracked in git.
 *
 * The agent's `suggestedSuccessorPrd` is treated as body only — any YAML frontmatter
 * is stripped before passing to `enqueuePrd`, which rebuilds clean frontmatter with
 * `depends_on: []`.
 */
export type SplitRecoveryAlreadyApplied = { commitSha: string; successorPrdId: string; status: 'already-applied' };

/**
 * Idempotency preflight for a `split` apply. Checks the durable applied marker
 * first, then scans the live queue (root and `waiting/`) for a successor whose
 * recovery continuation points back at this failed PRD — writing the marker when
 * one is found so a crash between enqueue and marker-write does not produce a
 * duplicate successor. Returns the already-applied result when the split is a
 * no-op, or `undefined` when the apply should proceed.
 *
 * This must run before any agent/extractor work (and before validating
 * `suggestedSuccessorPrd`) so an already-applied split short-circuits cleanly
 * even when the verdict is missing data or the extractor is unavailable.
 */
export async function checkSplitRecoveryIdempotency(
  options: ApplyHelperOptions,
): Promise<SplitRecoveryAlreadyApplied | undefined> {
  const { cwd, prdId, queueDir } = options;
  const sidecarJsonPath = join(queueDir, 'failed', `${prdId}.recovery.json`);

  // Idempotency: a durable applied marker means the successor was already enqueued.
  const existingApplied = await readRecoveryAppliedMetadata(sidecarJsonPath);
  if (existingApplied?.action === 'split' && existingApplied.successorPrdId) {
    return { commitSha: '', successorPrdId: existingApplied.successorPrdId, status: 'already-applied' };
  }

  // A durable applied marker for a *different* action (e.g. accepted-success)
  // must never be overwritten by a split apply — that would lose its audit
  // record. A same-action (`split`) marker is handled by the idempotent paths
  // above and the live-successor scan below.
  await assertNoConflictingAppliedMarker(sidecarJsonPath, 'split');

  // Crash window: a successor may have been enqueued before the marker was
  // written. Scan live queue locations for a successor whose recovery
  // continuation points back at this failed PRD; if found, record the marker
  // and treat the apply as already-applied rather than enqueueing a duplicate.
  const scannedSuccessorId = await findLiveSplitSuccessor(cwd, queueDir, prdId);
  if (scannedSuccessorId) {
    await writeSplitAppliedMarker(sidecarJsonPath, scannedSuccessorId);
    return { commitSha: '', successorPrdId: scannedSuccessorId, status: 'already-applied' };
  }

  return undefined;
}

export async function applyRecoverySplit(
  options: ApplyHelperOptions,
  verdict: RecoveryVerdict,
  context: { summary?: BuildFailureSummary; acceptanceCriteriaInventory?: CanonicalAcceptanceCriteriaInventory } = {},
): Promise<{ commitSha: string; successorPrdId: string; status: 'applied' | 'already-applied' }> {
  const { cwd, prdId, queueDir } = options;
  const sidecarJsonPath = join(queueDir, 'failed', `${prdId}.recovery.json`);

  // Idempotency preflight: durable applied marker or live-successor crash scan.
  const alreadyApplied = await checkSplitRecoveryIdempotency(options);
  if (alreadyApplied) return alreadyApplied;

  if (!verdict.suggestedSuccessorPrd) {
    throw new Error(`split verdict for ${prdId} is missing suggestedSuccessorPrd`);
  }

  const normalized = normalizeRecoverySuccessorPrd(verdict.suggestedSuccessorPrd);
  const visibleBody = normalized.visibleBody;
  const acceptanceCriteriaInventory = validateRecoveryInventory(
    context.acceptanceCriteriaInventory ?? normalized.legacyAcceptanceCriteriaInventory ?? (() => {
      throw new Error(`split verdict for ${prdId} is missing canonical acceptance criteria inventory; run the acceptance criteria extractor before applying recovery split`);
    })(),
    visibleBody,
  );
  const title = inferTitle(visibleBody);
  const recoveryContinuation = await deriveSplitRecoveryContinuation({ cwd, prdId, summary: context.summary });

  const { id: successorPrdId } = await enqueuePrd({
    body: visibleBody,
    title,
    acceptanceCriteriaInventory,
    queueDir,
    cwd,
    depends_on: [],
    // Durable idempotency marker written for every split successor, even when no
    // continuation (resume) metadata applies, so the crash-window scan can match
    // the successor back to this failed PRD before the applied marker is written.
    recovery_split_source: prdId,
    ...(recoveryContinuation !== undefined && {
      recovery_from: recoveryContinuation.sourcePrdId,
      recovery_set_name: recoveryContinuation.setName,
      recovery_feature_branch: recoveryContinuation.featureBranch,
      recovery_base_branch: recoveryContinuation.baseBranch,
    }),
  });

  // Record the durable applied marker so a repeated apply is idempotent.
  await writeSplitAppliedMarker(sidecarJsonPath, successorPrdId);

  // No git operations needed — queue is filesystem-only
  return { commitSha: '', successorPrdId, status: 'applied' };
}

/**
 * Scan the live queue (queue root and `waiting/`) for a successor PRD whose
 * parsed recovery continuation frontmatter points at `prdId`. Running PRDs
 * remain represented by queue-root files (with locks), so the root scan covers
 * them. Returns the successor's id, or `undefined` when none is found.
 *
 * Uses parsed continuation frontmatter (`getRecoveryContinuationFrontmatter`) —
 * never slug text — to match successors back to their source PRD.
 */
async function findLiveSplitSuccessor(
  cwd: string,
  queueDir: string,
  prdId: string,
): Promise<string | undefined> {
  for (const dir of [queueDir, join(queueDir, 'waiting')]) {
    let prds: Awaited<ReturnType<typeof loadQueue>>;
    try {
      prds = await loadQueue(dir, cwd);
    } catch {
      continue;
    }
    for (const prd of prds) {
      // Durable split-source marker is written for every split successor, even
      // those without full continuation metadata, so check it first.
      if (prd.frontmatter.recovery_split_source === prdId) return prd.id;
      let continuation: ReturnType<typeof getRecoveryContinuationFrontmatter>;
      try {
        continuation = getRecoveryContinuationFrontmatter(prd.frontmatter);
      } catch {
        continue; // incomplete continuation frontmatter — not a usable successor match
      }
      if (continuation && continuation.sourcePrdId === prdId) return prd.id;
    }
  }
  return undefined;
}

/** Write the durable split applied marker, preserving all existing sidecar fields. */
async function writeSplitAppliedMarker(sidecarJsonPath: string, successorPrdId: string): Promise<void> {
  await writeRecoveryAppliedMetadata(sidecarJsonPath, {
    action: 'split',
    appliedAt: new Date().toISOString(),
    successorPrdId,
  });
}

/**
 * Apply an `abandon` verdict: permanently remove the failed PRD and both sidecar
 * files from the queue. Filesystem-only — queue state is runtime, not tracked in git.
 */
export async function applyRecoveryAbandon(
  options: ApplyHelperOptions,
): Promise<{ commitSha: string }> {
  const { prdId, queueDir } = options;
  const failedDir = join(queueDir, 'failed');
  const failedPrdPath = join(failedDir, `${prdId}.md`);
  const recoveryMdPath = join(failedDir, `${prdId}.recovery.md`);
  const recoveryJsonPath = join(failedDir, `${prdId}.recovery.json`);

  // Refuse to clobber another action's durable applied marker / audit record.
  await assertNoConflictingAppliedMarker(recoveryJsonPath, 'abandon');

  await rm(failedPrdPath, { force: true });
  await rm(recoveryMdPath, { force: true });
  await rm(recoveryJsonPath, { force: true });

  return { commitSha: '' };
}

/**
 * Apply a `manual` verdict: no-op — no filesystem changes are made.
 * Returns `{ noAction: true }` so callers can surface guidance to read the
 * recovery report and act manually.
 */
export async function applyRecoveryManual(
  _options: ApplyHelperOptions,
): Promise<{ noAction: true }> {
  return { noAction: true };
}
