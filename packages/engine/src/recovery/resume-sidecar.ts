import { join } from 'node:path';
import type { BuildFailureSummary } from '@eforge-build/client';
import { projectResumeEligibility } from '../resume/compiled-build.js';
import { computeWorktreeBase } from '../worktree-ops.js';
import { truncateMiddleText, truncateText } from './text-bounds.js';

export type RecoverySidecarContinueRepairEligibilitySource = 'continueRepairEligibility' | 'inspection-error';
export type RecoverySidecarContinueRepairArtifactAvailability = 'merge-worktree' | 'feature-branch' | 'branch-history';

export type RecoverySidecarContinueRepairEligibility =
  | {
      source: RecoverySidecarContinueRepairEligibilitySource;
      eligible: true;
      featureBranch: string;
      artifactAvailability: RecoverySidecarContinueRepairArtifactAvailability;
      artifactCommit?: string;
      landedCommitCount: number;
      diffStat: string;
      failingPlanId?: string;
      partial?: boolean;
    }
  | {
      source: RecoverySidecarContinueRepairEligibilitySource;
      eligible: false;
      featureBranch: string;
      reason: string;
      checkedPath?: string;
    };

export interface RecoverySidecarRecoveryOption {
  kind: 'continue-repair';
  action: 'continue-repair';
  recommended: boolean;
  reason: string;
}

const CONTINUE_REPAIR_REASON_CHARS = 1_000;
const CONTINUE_REPAIR_DIFF_STAT_CHARS = 4_000;

export interface RecoverySidecarContinueRepairEvidence {
  continueRepairEligibility: RecoverySidecarContinueRepairEligibility;
  recoveryOptions?: RecoverySidecarRecoveryOption[];
}

export interface ProjectRecoverySidecarResumeEvidenceOptions {
  cwd: string;
  setName: string;
  prdId: string;
  outputDir: string;
  dbPath?: string;
  trunkBranch?: string;
  featureBranch?: string;
  baseBranch?: string;
  failureSummary?: BuildFailureSummary;
}

/**
 * Read-only projection for recovery sidecars. This must not queue repair work,
 * create worktrees, materialize artifacts, or mutate queue state.
 */
export async function projectRecoverySidecarResumeEvidence(options: ProjectRecoverySidecarResumeEvidenceOptions): Promise<RecoverySidecarContinueRepairEvidence> {
  const featureBranch = options.featureBranch ?? `eforge/${options.setName}`;
  const mergeWorktreePath = join(computeWorktreeBase(options.cwd, options.setName), '__merge__');

  try {
    const projected = await projectResumeEligibility({
      cwd: options.cwd,
      setName: options.setName,
      prdId: options.prdId,
      mergeWorktreePath,
      outputDir: options.outputDir,
      ...(options.dbPath !== undefined ? { dbPath: options.dbPath } : {}),
      ...(options.trunkBranch !== undefined ? { trunkBranch: options.trunkBranch } : {}),
      ...(options.featureBranch !== undefined ? { featureBranch: options.featureBranch } : {}),
      ...(options.baseBranch !== undefined ? { baseBranch: options.baseBranch } : {}),
      ...(options.failureSummary !== undefined ? { failureSummary: options.failureSummary } : {}),
    });

    if (projected.eligible) {
      const continueRepairEligibility: RecoverySidecarContinueRepairEligibility = {
        source: 'continueRepairEligibility',
        eligible: true,
        featureBranch: projected.featureBranch,
        artifactAvailability: projected.artifactAvailability,
        ...(projected.artifactCommit !== undefined ? { artifactCommit: projected.artifactCommit } : {}),
        landedCommitCount: projected.landedCommitCount,
        diffStat: boundDiffStat(projected.diffStat),
        ...(projected.failingPlanId !== undefined ? { failingPlanId: projected.failingPlanId } : {}),
        ...(projected.partial !== undefined ? { partial: projected.partial } : {}),
      };
      return {
        continueRepairEligibility,
        ...(projected.partial === true ? {} : { recoveryOptions: [continueRepairOption('Compiled plan artifacts are eligible for continue-and-repair.')] }),
      };
    }

    return {
      continueRepairEligibility: {
        source: 'continueRepairEligibility',
        eligible: false,
        featureBranch: projected.featureBranch,
        reason: boundReason(projected.reason, 'continue-and-repair ineligibility reason'),
        ...(projected.checkedPath !== undefined ? { checkedPath: projected.checkedPath } : {}),
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      continueRepairEligibility: {
        source: 'inspection-error',
        eligible: false,
        featureBranch,
        reason: `Continue-and-repair eligibility inspection failed: ${boundReason(message, 'continue-and-repair inspection failure')}`,
      },
    };
  }
}

function continueRepairOption(reason: string): RecoverySidecarRecoveryOption {
  return {
    kind: 'continue-repair',
    action: 'continue-repair',
    recommended: true,
    reason,
  };
}

function boundReason(reason: string, label: string): string {
  const bounded = truncateText(reason.trim() || 'Continue-and-repair eligibility inspection did not provide a reason.', CONTINUE_REPAIR_REASON_CHARS, label);
  return bounded.text;
}

function boundDiffStat(diffStat: string): string {
  return truncateMiddleText(diffStat, CONTINUE_REPAIR_DIFF_STAT_CHARS, 'continue-and-repair diff stat').text;
}
