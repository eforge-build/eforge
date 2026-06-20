/*
 * Recovery verdict dispatch helpers — apply the verdict from a recovery sidecar.
 *
 * Each mutating helper performs one atomic filesystem/queue mutation. Queue
 * state is runtime (`.eforge/queue` is gitignored). Retry and
 * continue-and-repair may also create a tracked compiled-plan guidance commit
 * via recovery guidance preparation. `manual` is a no-op: it returns without
 * touching the working tree.
 *
 * Callers are expected to have already validated the verdict via
 * recoveryVerdictSchema before invoking these helpers.
 */

import { constants } from 'node:fs';
import { access, link, mkdir, rm, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { ModelTracker } from '../model-tracker.js';
import { prepareFailedPrdForQueuedCompiledResume } from '../resume/queued-resume.js';
import { readRawAppliedAction, writeRecoveryAppliedMetadata } from './applied-sidecar.js';
import { prepareRecoveryGuidance, recoveryGuidanceResumeBlocker } from './guidance.js';

export interface ApplyHelperOptions {
  /** Absolute working directory (repo root). */
  cwd: string;
  /** Plan ID of the failed PRD. */
  prdId: string;
  /** Absolute path to the queue directory (e.g. `<cwd>/.eforge/queue`). */
  queueDir: string;
  /** Optional plan output directory for continue-and-repair eligibility checks. */
  outputDir?: string;
  /** Optional monitor DB path for continue-and-repair eligibility checks. */
  dbPath?: string;
  /** Optional trunk branch for continue-and-repair eligibility checks. */
  trunkBranch?: string;
  /** Optional model tracker — retained for interface compatibility. */
  modelTracker?: ModelTracker;
}

export interface ContinueRepairApplyResult {
  commitSha: string;
  status: 'queued' | 'already-queued';
  detail: string;
}

export class RecoveryApplyConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RecoveryApplyConflictError';
  }
}

/**
 * Reject a sidecar recovery mutation when a durable applied marker for a
 * *different* recovery action already exists. Protects an already-applied marker
 * (notably `accepted-success`, whose rich audit summary lives on the same
 * sidecar) from being deleted or overwritten by a later retry/continue-repair/
 * abandon apply. Reads the raw `applied.action` so even a malformed marker is
 * honored.
 */
async function assertNoConflictingAppliedMarker(
  sidecarJsonPath: string,
  action: 'retry' | 'continue-repair' | 'abandon',
): Promise<void> {
  const existingAction = await readRawAppliedAction(sidecarJsonPath);
  if (existingAction !== undefined && existingAction !== action) {
    throw new RecoveryApplyConflictError(
      `A different recovery action ('${existingAction}') was already applied to this PRD; refusing to apply '${action}' and overwrite its durable applied marker.`,
    );
  }
}

/**
 * Apply a `retry` verdict: prepare recovery guidance, then move the failed PRD
 * back to the queue and remove both sidecar files. Auto-build will pick up the
 * requeued PRD on the next tick. Queue movement is filesystem-only; guidance
 * patches may create a tracked commit.
 */
export async function applyRecoveryRetry(
  options: ApplyHelperOptions,
): Promise<{ commitSha: string; detail?: string }> {
  const { prdId, queueDir } = options;
  const failedDir = join(queueDir, 'failed');
  const failedPrdPath = join(failedDir, `${prdId}.md`);
  const queuedPrdPath = join(queueDir, `${prdId}.md`);
  const recoveryMdPath = join(failedDir, `${prdId}.recovery.md`);
  const recoveryJsonPath = join(failedDir, `${prdId}.recovery.json`);

  // Refuse to clobber another action's durable applied marker / audit record.
  await assertNoConflictingAppliedMarker(recoveryJsonPath, 'retry');

  // Move failed PRD back to queue root without clobbering an existing queued PRD.
  await assertRetryQueueMovePreflight({ prdId, failedPrdPath, queuedPrdPath });

  const recoveryGuidance = await prepareRetryRecoveryGuidance(options);

  try {
    await moveNoOverwrite(failedPrdPath, queuedPrdPath);
  } catch (err) {
    if (isQueueMoveConflict(err)) {
      throw new RecoveryApplyConflictError(queueMoveConflictMessage(prdId));
    }
    throw err;
  }
  // Remove both sidecar files
  await rm(recoveryMdPath, { force: true });
  await rm(recoveryJsonPath, { force: true });

  const guidanceStatuses = recoveryGuidance.plans.map((plan) => plan.status);
  const guidanceDetail = guidanceStatuses.length > 0 && guidanceStatuses.every((status) => status === 'patched' || status === 'already-current')
    ? `Recovery guidance ${guidanceStatuses.includes('patched') ? 'patched' : 'already current'}.`
    : undefined;

  return {
    commitSha: recoveryGuidance.commitSha ?? '',
    ...(guidanceDetail !== undefined ? { detail: guidanceDetail } : {}),
  };
}

async function prepareRetryRecoveryGuidance(options: ApplyHelperOptions) {
  try {
    const recoveryGuidance = await prepareRecoveryGuidance({
      cwd: options.cwd,
      prdId: options.prdId,
      queueDir: options.queueDir,
      outputDir: options.outputDir ?? 'eforge/plans',
      ...(options.dbPath !== undefined ? { dbPath: options.dbPath } : {}),
      ...(options.trunkBranch !== undefined ? { trunkBranch: options.trunkBranch } : {}),
    });
    const blocker = recoveryGuidanceResumeBlocker(recoveryGuidance);
    if (blocker) throw new RecoveryApplyConflictError(blocker);
    return recoveryGuidance;
  } catch (err) {
    if (err instanceof RecoveryApplyConflictError) throw err;
    throw new RecoveryApplyConflictError(`Recovery guidance could not be prepared: ${(err as Error).message}`);
  }
}

/**
 * Apply a `continue-repair` verdict: queue the failed PRD through the existing
 * compiled-artifact repair path. The failed sidecars remain as the audit trail
 * and receive a durable applied marker so repeated applies are idempotent.
 */
export async function applyRecoveryContinueRepair(
  options: ApplyHelperOptions,
): Promise<ContinueRepairApplyResult> {
  const { cwd, prdId, queueDir } = options;
  const sidecarJsonPath = join(queueDir, 'failed', `${prdId}.recovery.json`);

  await assertNoConflictingAppliedMarker(sidecarJsonPath, 'continue-repair');

  const result = await prepareFailedPrdForQueuedCompiledResume({
    cwd,
    prdId,
    queueDir,
    ...(options.outputDir !== undefined ? { outputDir: options.outputDir } : {}),
    ...(options.dbPath !== undefined ? { dbPath: options.dbPath } : {}),
    ...(options.trunkBranch !== undefined ? { trunkBranch: options.trunkBranch } : {}),
  });

  if (result.status === 'blocked') {
    throw new RecoveryApplyConflictError(result.reason);
  }

  await writeRecoveryAppliedMetadata(sidecarJsonPath, {
    action: 'continue-repair',
    appliedAt: new Date().toISOString(),
    ...(result.recoveryGuidance?.commitSha !== undefined ? { commitSha: result.recoveryGuidance.commitSha } : {}),
  });

  // --- eforge:region plan-03-engine-recovery-guidance ---
  const guidanceStatuses = result.recoveryGuidance?.plans.map((plan) => plan.status) ?? [];
  const guidanceDetail = guidanceStatuses.length > 0 && guidanceStatuses.every((status) => status === 'patched' || status === 'already-current')
    ? ` Recovery guidance ${guidanceStatuses.includes('patched') ? 'patched' : 'already current'}.`
    : '';

  return {
    commitSha: result.recoveryGuidance?.commitSha ?? '',
    status: result.status,
    detail: `${result.status === 'already-queued'
      ? 'Continue-and-repair was already queued.'
      : 'Continue-and-repair queued.'}${guidanceDetail}`,
  };
  // --- eforge:endregion plan-03-engine-recovery-guidance ---
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

async function assertRetryQueueMovePreflight(opts: { prdId: string; failedPrdPath: string; queuedPrdPath: string }): Promise<void> {
  if (!(await exists(opts.failedPrdPath))) {
    throw new RecoveryApplyConflictError(queueMoveConflictMessage(opts.prdId));
  }
  if (await exists(opts.queuedPrdPath)) {
    throw new RecoveryApplyConflictError(queueMoveConflictMessage(opts.prdId));
  }
}

function queueMoveConflictMessage(prdId: string): string {
  return `Failed PRD ${prdId}.md cannot be safely moved back to the queue; the failed source may be missing or the queue root already contains the PRD.`;
}

function isQueueMoveConflict(err: unknown): boolean {
  const code = (err as NodeJS.ErrnoException).code;
  return code === 'EEXIST' || code === 'ENOENT';
}

async function moveNoOverwrite(source: string, target: string): Promise<void> {
  await mkdir(dirname(target), { recursive: true });
  await link(source, target);
  try {
    await unlink(source);
  } catch (err) {
    await rm(target, { force: true });
    throw err;
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}
