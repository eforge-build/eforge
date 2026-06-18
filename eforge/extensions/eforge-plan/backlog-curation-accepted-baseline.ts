import { collectBacklogCurationGitDelta, writeAcceptedAnalysisBaseline } from './backlog-curation-git-delta.js';

// --- eforge:region plan-04-plan-03-prospective-overlay-apply ---
export async function recordAcceptedAnalysisBaselineForApply(cwd: string, input: {
  taskId: string;
  passKind: 'backlog-curation' | 'recommendation-refresh';
  sourceFingerprint?: string;
  acceptedAt?: string;
}): Promise<void> {
  if (input.sourceFingerprint === undefined || input.sourceFingerprint.trim().length === 0) return;
  const gitDelta = await collectBacklogCurationGitDelta({ cwd, enrichPullRequests: false });
  await writeAcceptedAnalysisBaseline(cwd, {
    taskId: input.taskId,
    passKind: input.passKind,
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
// --- eforge:endregion plan-04-plan-03-prospective-overlay-apply ---
