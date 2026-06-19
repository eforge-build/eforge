import { collectBacklogCurationGitDelta, writeAcceptedAnalysisBaseline } from './backlog-curation-git-delta.js';
import { normalizeBacklogCurationScanMode, type BacklogCurationScanMode } from './backlog-curation-schemas.js';

type AcceptedAnalysisBaselineApplyInput = {
  taskId: string;
  sourceFingerprint?: string;
  acceptedAt?: string;
} & (
  | { passKind: 'recommendation-refresh' }
  | { passKind: 'backlog-curation'; scanMode?: BacklogCurationScanMode }
);

export async function recordAcceptedAnalysisBaselineForApply(cwd: string, input: AcceptedAnalysisBaselineApplyInput): Promise<void> {
  if (input.sourceFingerprint === undefined || input.sourceFingerprint.trim().length === 0) return;
  const gitDelta = await collectBacklogCurationGitDelta({ cwd, enrichPullRequests: false });
  await writeAcceptedAnalysisBaseline(cwd, {
    taskId: input.taskId,
    passKind: acceptedBaselinePassKind(input),
    sourceFingerprint: input.sourceFingerprint,
    acceptedAt: input.acceptedAt ?? new Date().toISOString(),
    git: {
      headCommit: gitDelta.currentHead?.commit ?? null,
      ...(gitDelta.currentHead?.time !== undefined && { headCommittedAt: gitDelta.currentHead.time }),
    },
    coverage: gitDelta.coverage,
    diagnostics: gitDelta.diagnostics,
  });
}

function acceptedBaselinePassKind(input: AcceptedAnalysisBaselineApplyInput): string {
  if (input.passKind === 'recommendation-refresh') return 'recommendation-refresh';
  return `backlog-curation:${normalizeBacklogCurationScanMode(input.scanMode)}`;
}
