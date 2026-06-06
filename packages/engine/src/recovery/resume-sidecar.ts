import { join } from 'node:path';
import { projectResumeEligibility } from '../resume/compiled-build.js';
import { computeWorktreeBase } from '../worktree-ops.js';
import { truncateMiddleText, truncateText } from './text-bounds.js';

const RESUME_REASON_CHARS = 1_000;
const RESUME_DIFF_STAT_CHARS = 4_000;

export type RecoverySidecarResumeEligibilitySource = 'projectResumeEligibility' | 'inspection-error';

export type RecoverySidecarResumeEligibility =
  | {
      source: RecoverySidecarResumeEligibilitySource;
      eligible: true;
      featureBranch: string;
      artifactAvailability: 'merge-worktree' | 'feature-branch' | 'branch-history';
      artifactCommit?: string;
      landedCommitCount: number;
      diffStat: string;
      failingPlanId?: string;
      partial?: boolean;
    }
  | {
      source: RecoverySidecarResumeEligibilitySource;
      eligible: false;
      featureBranch: string;
      reason: string;
      checkedPath?: string;
    };

export interface RecoverySidecarRecoveryOption {
  kind: 'compiled-build-resume';
  action: 'eforge_resume_build';
  recommended: boolean;
  reason: string;
}

export interface RecoverySidecarResumeEvidence {
  resumeEligibility: RecoverySidecarResumeEligibility;
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
}

/**
 * Read-only projection for recovery sidecars. This must not queue resume work,
 * create worktrees, materialize artifacts, or mutate queue state.
 */
export async function projectRecoverySidecarResumeEvidence(options: ProjectRecoverySidecarResumeEvidenceOptions): Promise<RecoverySidecarResumeEvidence> {
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
    });

    if (projected.eligible) {
      const resumeEligibility: RecoverySidecarResumeEligibility = {
        source: 'projectResumeEligibility',
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
        resumeEligibility,
        recoveryOptions: [compiledResumeOption('Compiled plan artifacts are eligible for scheduler-owned resume.')],
      };
    }

    return {
      resumeEligibility: {
        source: 'projectResumeEligibility',
        eligible: false,
        featureBranch: projected.featureBranch,
        reason: boundReason(projected.reason, 'resume ineligibility reason'),
        ...(projected.checkedPath !== undefined ? { checkedPath: projected.checkedPath } : {}),
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      resumeEligibility: {
        source: 'inspection-error',
        eligible: false,
        featureBranch,
        reason: `Resume eligibility inspection failed: ${boundReason(message, 'resume inspection failure')}`,
      },
    };
  }
}

function compiledResumeOption(reason: string): RecoverySidecarRecoveryOption {
  return {
    kind: 'compiled-build-resume',
    action: 'eforge_resume_build',
    recommended: true,
    reason,
  };
}

function boundReason(reason: string, label: string): string {
  const bounded = truncateText(reason.trim() || 'Resume eligibility inspection did not provide a reason.', RESUME_REASON_CHARS, label);
  return bounded.text;
}

function boundDiffStat(diffStat: string): string {
  return truncateMiddleText(diffStat, RESUME_DIFF_STAT_CHARS, 'resume diff stat').text;
}
