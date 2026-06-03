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
import { enqueuePrd, inferTitle } from '../prd-queue.js';
import { extractExpectedAcceptanceCriteria } from '../validation/acceptance-criteria.js';
import { requireAcceptanceCriteriaInventoryFromPrd, stripAcceptanceCriteriaInventoryBlock, type CanonicalAcceptanceCriteriaInventory } from '../validation/acceptance-criteria-inventory.js';
import { deriveSplitRecoveryContinuation } from './continuation.js';

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
export async function applyRecoverySplit(
  options: ApplyHelperOptions,
  verdict: RecoveryVerdict,
  context: { summary?: BuildFailureSummary } = {},
): Promise<{ commitSha: string; successorPrdId: string }> {
  const { cwd, prdId, queueDir } = options;

  if (!verdict.suggestedSuccessorPrd) {
    throw new Error(`split verdict for ${prdId} is missing suggestedSuccessorPrd`);
  }

  // Strip any agent-emitted YAML frontmatter and leading whitespace
  const body = verdict.suggestedSuccessorPrd
    .replace(/^\s*---\r?\n[\s\S]*?\r?\n---\r?\n?/, '')
    .replace(/^\s+/, '');

  const visibleBody = stripAcceptanceCriteriaInventoryBlock(body).trimEnd();
  const acceptanceCriteriaInventory = readOrBuildRecoveryInventory(body, visibleBody);
  const title = inferTitle(visibleBody);
  const recoveryContinuation = await deriveSplitRecoveryContinuation({ cwd, prdId, summary: context.summary });

  const { id: successorPrdId } = await enqueuePrd({
    body: visibleBody,
    title,
    acceptanceCriteriaInventory,
    queueDir,
    cwd,
    depends_on: [],
    ...(recoveryContinuation !== undefined && {
      recovery_from: recoveryContinuation.sourcePrdId,
      recovery_set_name: recoveryContinuation.setName,
      recovery_feature_branch: recoveryContinuation.featureBranch,
      recovery_base_branch: recoveryContinuation.baseBranch,
    }),
  });

  // No git operations needed — queue is filesystem-only
  return { commitSha: '', successorPrdId };
}

/**
 * Apply an `abandon` verdict: permanently remove the failed PRD and both sidecar
 * files from the queue. Filesystem-only — queue state is runtime, not tracked in git.
 */
function readOrBuildRecoveryInventory(body: string, visibleBody: string): CanonicalAcceptanceCriteriaInventory {
  try {
    return requireAcceptanceCriteriaInventoryFromPrd(body);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!/missing.*inventory|missing-block/i.test(message)) throw err;
  }
  return {
    version: 1,
    criteria: extractExpectedAcceptanceCriteria(visibleBody, { allowFallbackSections: true }).map((criterion, index) => ({
      id: `ac-${String(index + 1).padStart(3, '0')}`,
      text: criterion.text,
      raw: criterion.raw,
      sourceQuote: criterion.raw,
      confidence: 1,
    })),
  };
}

export async function applyRecoveryAbandon(
  options: ApplyHelperOptions,
): Promise<{ commitSha: string }> {
  const { prdId, queueDir } = options;
  const failedDir = join(queueDir, 'failed');
  const failedPrdPath = join(failedDir, `${prdId}.md`);
  const recoveryMdPath = join(failedDir, `${prdId}.recovery.md`);
  const recoveryJsonPath = join(failedDir, `${prdId}.recovery.json`);

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
