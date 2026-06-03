import { join, resolve } from 'node:path';
import { readFile } from 'node:fs/promises';

import { validatePlanSetName } from '../plan.js';
import type { BuildFailureSummary } from '../events.js';
import {
  requeueFailedPrdForCompiledResume,
  type RequeueCompiledResumeResult,
} from '../queue/resume-cascade.js';
import { buildFailureSummary } from '../recovery/failure-summary.js';
import { computeWorktreeBase } from '../worktree-ops.js';

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

export type PrepareQueuedCompiledResumeResult = RequeueCompiledResumeResult;

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

  return requeueFailedPrdForCompiledResume({
    cwd: options.cwd,
    prdId: metadata.prdId,
    queueDir: options.queueDir,
    setName: metadata.setName,
    featureBranch: metadata.featureBranch,
    baseBranch: metadata.baseBranch,
    ...(options.profileOverride !== undefined ? { profileOverride: options.profileOverride } : {}),
  });
}

async function readResumeSetName(opts: { prdId: string; failedDir: string }): Promise<string> {
  const sidecarSummary = await readRecoverySidecarSummary(opts.failedDir, opts.prdId);
  return nonEmpty(sidecarSummary?.setName) ?? opts.prdId;
}

async function readRecoverySidecarSummary(failedDir: string, prdId: string): Promise<BuildFailureSummary | undefined> {
  try {
    const parsed = JSON.parse(await readFile(join(failedDir, `${prdId}.recovery.json`), 'utf-8')) as { summary?: BuildFailureSummary };
    return parsed.summary;
  } catch {
    return undefined;
  }
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
