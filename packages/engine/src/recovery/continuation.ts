import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { BuildFailureSummary } from '../events.js';

const exec = promisify(execFile);

export interface RecoveryContinuationMetadata {
  sourcePrdId: string;
  setName: string;
  featureBranch: string;
  baseBranch: string;
}

export function hasPartialLandedOrMergedWork(summary: BuildFailureSummary): boolean {
  const landedCommits = Array.isArray(summary.landedCommits) ? summary.landedCommits : [];
  if (landedCommits.length > 0) return true;
  const plans = Array.isArray(summary.plans) ? summary.plans : [];
  return plans.some((plan) => {
    const mergedAt = (plan as { mergedAt?: unknown }).mergedAt;
    if (typeof mergedAt === 'string' && mergedAt.trim().length > 0) return true;
    return plan.status === 'merged' || (typeof plan.commitSha === 'string' && plan.commitSha.length > 0);
  });
}

export async function deriveSplitRecoveryContinuation(options: {
  cwd: string;
  prdId: string;
  summary?: BuildFailureSummary;
}): Promise<RecoveryContinuationMetadata | undefined> {
  const { cwd, prdId, summary } = options;
  if (!summary || !hasPartialLandedOrMergedWork(summary)) return undefined;

  const setName = requireNonEmpty(summary.setName, 'setName', prdId);
  const featureBranch = requireNonEmpty(summary.featureBranch, 'featureBranch', prdId);
  const baseBranch = requireNonEmpty(summary.baseBranch, 'baseBranch', prdId);

  await validateContinuationRef({ cwd, prdId, ref: featureBranch, label: 'featureBranch' });
  await validateContinuationRef({ cwd, prdId, ref: baseBranch, label: 'baseBranch' });

  return {
    sourcePrdId: prdId,
    setName,
    featureBranch,
    baseBranch,
  };
}

function requireNonEmpty(value: unknown, label: string, prdId: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Missing recovery ${label} for failed PRD ${prdId}`);
  }
  return value;
}

async function validateContinuationRef(options: {
  cwd: string;
  prdId: string;
  ref: string;
  label: 'featureBranch' | 'baseBranch';
}): Promise<void> {
  const { cwd, prdId, ref, label } = options;
  const unsafeReason = getUnsafeRefReason(ref);
  if (unsafeReason) {
    throw new Error(`Invalid recovery ${label} ref '${ref}' for failed PRD ${prdId}: ${unsafeReason}`);
  }

  try {
    await exec('git', ['check-ref-format', '--branch', ref], { cwd });
  } catch (err) {
    throw new Error(`Invalid recovery ${label} ref '${ref}' for failed PRD ${prdId}: git check-ref-format failed (${errorMessage(err)})`);
  }

  try {
    await exec('git', ['rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`], { cwd });
  } catch (err) {
    throw new Error(`Invalid recovery ${label} ref '${ref}' for failed PRD ${prdId}: ref does not resolve to a commit (${errorMessage(err)})`);
  }
}

function getUnsafeRefReason(ref: string): string | undefined {
  if (ref.length === 0) return 'ref is empty';
  if (ref.startsWith('-')) return 'ref must not begin with -';
  if (/[\x00-\x20\x7f]/.test(ref)) return 'ref contains NUL, control, or whitespace characters';
  if (ref.includes('..')) return 'ref must not contain ..';
  if (ref.includes('@{')) return 'ref must not contain @{';
  if (/[~^:?*\[\]\\{}]/.test(ref)) return 'ref contains git revision metacharacters';
  return undefined;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
