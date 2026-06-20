import { join, resolve } from 'node:path';
import { validatePlanSetName } from '../plan.js';
import type { BuildFailureSummary } from '../events.js';
import {
  requeueFailedPrdForCompiledResume,
  type RequeueCompiledResumeResult,
} from '../queue/resume-cascade.js';
import { buildFailureSummary } from '../recovery/failure-summary.js';
import { tryReadRecoverySidecarProjection } from '../recovery/sidecar-read.js';
import { computeWorktreeBase } from '../worktree-ops.js';
// --- eforge:region plan-03-engine-recovery-guidance ---
import type { RecoveryGuidancePrepareResponse } from '@eforge-build/client';
import { prepareRecoveryGuidance, recoveryGuidanceResumeBlocker } from '../recovery/guidance.js';
// --- eforge:endregion plan-03-engine-recovery-guidance ---

export interface QueuedCompiledResumeMetadata {
  prdId: string;
  setName: string;
  featureBranch: string;
  baseBranch: string;
}

export interface ResolveQueuedCompiledResumeMetadataOptions {
  cwd: string;
  prdId: string;
  setName?: string;
  queueDir?: string;
  dbPath?: string;
  trunkBranch?: string;
}

export interface PrepareQueuedCompiledResumeOptions extends ResolveQueuedCompiledResumeMetadataOptions {
  outputDir?: string;
  profileOverride?: string;
  checkEligibility?: boolean;
}

// --- eforge:region plan-03-engine-recovery-guidance ---
export type PrepareQueuedCompiledResumeResult = RequeueCompiledResumeResult & { recoveryGuidance?: RecoveryGuidancePrepareResponse };
// --- eforge:endregion plan-03-engine-recovery-guidance ---

export async function resolveQueuedCompiledResumeMetadata(
  options: ResolveQueuedCompiledResumeMetadataOptions,
): Promise<QueuedCompiledResumeMetadata> {
  assertSafePathSegment(options.prdId, 'prdId');

  const queueDir = options.queueDir ?? '.eforge/queue';
  const failedDir = join(resolve(options.cwd, queueDir), 'failed');
  const setName = options.setName ?? await readResumeSetName({ prdId: options.prdId, failedDir });
  validatePlanSetName(setName);
  validateResumeGitRefName(setName);

  const sidecarSummary = await readRecoverySidecarSummary(failedDir, options.prdId);
  const canUseSidecarSummary = options.setName === undefined || nonEmpty(sidecarSummary?.setName) === setName;
  let summary: BuildFailureSummary | undefined;
  try {
    summary = await buildFailureSummary({
      setName,
      prdId: options.prdId,
      cwd: options.cwd,
      dbPath: options.dbPath,
      trunkBranch: options.trunkBranch,
    });
  } catch {
    summary = canUseSidecarSummary ? sidecarSummary : undefined;
  }

  const matchingSidecarSummary = canUseSidecarSummary ? sidecarSummary : undefined;
  const featureBranch = nonEmpty(matchingSidecarSummary?.featureBranch) ?? nonEmpty(summary?.featureBranch) ?? `eforge/${setName}`;
  const baseBranch = nonEmpty(matchingSidecarSummary?.baseBranch) ?? nonEmpty(summary?.baseBranch) ?? options.trunkBranch ?? 'main';

  return {
    prdId: options.prdId,
    setName,
    featureBranch,
    baseBranch,
  };
}

export async function prepareFailedPrdForQueuedCompiledResume(
  options: PrepareQueuedCompiledResumeOptions,
): Promise<PrepareQueuedCompiledResumeResult> {
  const metadata = await resolveQueuedCompiledResumeMetadata(options);

  if (options.checkEligibility !== false) {
    const mergeWorktreePath = join(computeWorktreeBase(options.cwd, metadata.setName), '__merge__');
    const { projectResumeEligibility } = await import('./compiled-build.js');
    const eligibility = await projectResumeEligibility({
      cwd: options.cwd,
      setName: metadata.setName,
      prdId: metadata.prdId,
      mergeWorktreePath,
      outputDir: options.outputDir ?? 'eforge/plans',
      dbPath: options.dbPath,
      trunkBranch: options.trunkBranch,
      featureBranch: metadata.featureBranch,
      baseBranch: metadata.baseBranch,
    });
    if (!eligibility.eligible) {
      return {
        status: 'blocked',
        prdId: metadata.prdId,
        setName: metadata.setName,
        featureBranch: metadata.featureBranch,
        baseBranch: metadata.baseBranch,
        reason: eligibility.reason,
      };
    }
  }

  // --- eforge:region plan-03-engine-recovery-guidance ---
  let recoveryGuidance: RecoveryGuidancePrepareResponse;
  try {
    recoveryGuidance = await prepareRecoveryGuidance({
      cwd: options.cwd,
      prdId: metadata.prdId,
      setName: metadata.setName,
      featureBranch: metadata.featureBranch,
      baseBranch: metadata.baseBranch,
      queueDir: options.queueDir,
      outputDir: options.outputDir ?? 'eforge/plans',
      ...(options.dbPath !== undefined ? { dbPath: options.dbPath } : {}),
      ...(options.trunkBranch !== undefined ? { trunkBranch: options.trunkBranch } : {}),
    });
  } catch (err) {
    return {
      status: 'blocked',
      prdId: metadata.prdId,
      setName: metadata.setName,
      featureBranch: metadata.featureBranch,
      baseBranch: metadata.baseBranch,
      reason: `Recovery guidance could not be prepared: ${(err as Error).message}`,
    };
  }
  const guidanceBlocker = recoveryGuidanceResumeBlocker(recoveryGuidance);
  if (guidanceBlocker) {
    return {
      status: 'blocked',
      prdId: metadata.prdId,
      setName: metadata.setName,
      featureBranch: metadata.featureBranch,
      baseBranch: metadata.baseBranch,
      reason: guidanceBlocker,
      recoveryGuidance,
    };
  }
  // --- eforge:endregion plan-03-engine-recovery-guidance ---

  const requeueResult = await requeueFailedPrdForCompiledResume({
    cwd: options.cwd,
    prdId: metadata.prdId,
    queueDir: options.queueDir,
    setName: metadata.setName,
    featureBranch: metadata.featureBranch,
    baseBranch: metadata.baseBranch,
    ...(options.profileOverride !== undefined ? { profileOverride: options.profileOverride } : {}),
  });
  // --- eforge:region plan-03-engine-recovery-guidance ---
  return { ...requeueResult, recoveryGuidance };
  // --- eforge:endregion plan-03-engine-recovery-guidance ---
}

async function readResumeSetName(opts: { prdId: string; failedDir: string }): Promise<string> {
  const projection = await tryReadRecoverySidecarProjection(opts.failedDir, opts.prdId);
  return nonEmpty(projection?.sidecar.setName) ?? opts.prdId;
}

async function readRecoverySidecarSummary(failedDir: string, prdId: string): Promise<BuildFailureSummary | undefined> {
  return (await tryReadRecoverySidecarProjection(failedDir, prdId))?.summary;
}

function nonEmpty(value: string | undefined): string | undefined {
  return value && value.trim().length > 0 ? value : undefined;
}

function assertSafePathSegment(value: string, label: string): void {
  if (!value || value.includes('/') || value.includes('\\') || value.includes('..')) {
    throw new Error(`Invalid ${label}: must not contain path separators or traversal sequences`);
  }
}

function validateResumeGitRefName(setName: string): void {
  if (/^[.-]|[.]$|[\x00-\x20~^:?*[\\{}@]/.test(setName) || setName.endsWith('.lock') || setName.includes('..')) {
    throw new Error(`Invalid setName: contains characters that are not allowed in a branch ref`);
  }
}
