import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import * as React from 'react';
import { QueueRecoveryDialog } from '../queue-recovery-dialog';
import {
  acceptRecoverySuccess,
  applySidecarRecovery,
  applyQueueRecovery,
  fetchAcceptSuccessPreview,
  fetchQueueRecoveryAnalysis,
  fetchRecoverySidecar,
  fetchResumeEligibility,
  startResumeBuild,
  triggerRecoveryAnalysis,
  QUEUE_RECOVERY_STRATEGY_RETRY_AND_REACTIVATE,
  type AcceptSuccessPreviewResponse,
  type AcceptSuccessResponse,
  type ApplyRecoveryResponse,
  type QueueRecoveryAnalyzeResponse,
  type QueueRecoveryApplyResponse,
  type ReadSidecarResponse,
  type ResumeBuildResponse,
  type ResumeEligibilityResponse,
} from '@eforge-build/client/browser';

vi.mock('@eforge-build/client/browser', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@eforge-build/client/browser')>();
  return {
    ...actual,
    fetchRecoverySidecar: vi.fn(),
    fetchResumeEligibility: vi.fn(),
    applySidecarRecovery: vi.fn(),
    triggerRecoveryAnalysis: vi.fn(),
    startResumeBuild: vi.fn(),
    fetchQueueRecoveryAnalysis: vi.fn(),
    applyQueueRecovery: vi.fn(),
    fetchAcceptSuccessPreview: vi.fn(),
    acceptRecoverySuccess: vi.fn(),
  };
});

// ---------------------------------------------------------------------------
// Fixtures (hand-crafted and cast — wire shapes are owned by the client)
// ---------------------------------------------------------------------------

function sidecarFixture(verdict: string, confidence: string): ReadSidecarResponse {
  return {
    markdown: '# Recovery report\n\nRoot cause analysis for the failed build.',
    json: {
      schemaVersion: 1,
      generatedAt: '2026-01-01T00:00:00Z',
      summary: { prdId: 'failed-prd', setName: 'demo-set' },
      verdict: { verdict, confidence },
    },
  } as unknown as ReadSidecarResponse;
}

function applyFixture(verdict: ApplyRecoveryResponse['verdict']): ApplyRecoveryResponse {
  return { verdict, ...(verdict === 'split' ? { successorPrdId: 'successor-prd' } : {}) };
}

function appliedSidecarFixture(): ReadSidecarResponse {
  return {
    markdown: '# Recovery report\n\nAlready applied.',
    json: {
      schemaVersion: 1,
      generatedAt: '2026-01-01T00:00:00Z',
      summary: { prdId: 'failed-prd', setName: 'demo-set' },
      verdict: { verdict: 'split', confidence: 'high' },
      applied: { action: 'split', appliedAt: '2026-01-02T00:00:00Z', successorPrdId: 'successor-prd' },
    },
  } as unknown as ReadSidecarResponse;
}

function ineligiblePreviewFixture(): AcceptSuccessPreviewResponse {
  return {
    prdId: 'failed-prd',
    status: 'ineligible',
    reason: 'Build did not reach validation.',
    landingAction: 'leave',
    cleanup: { planSet: 'demo-set', planArtifactsPresent: false, prdArtifactPresent: false, willCommit: false },
    audit: { setName: 'demo-set', featureBranch: 'eforge/demo', baseBranch: 'main', landedCommitCount: 0 },
    dependentCandidates: [],
  };
}

function eligiblePreviewFixture(
  overrides: Partial<AcceptSuccessPreviewResponse> = {},
): AcceptSuccessPreviewResponse {
  return {
    prdId: 'failed-prd',
    status: 'eligible',
    landingAction: 'pr',
    cleanup: { planSet: 'demo-set', planArtifactsPresent: true, prdArtifactPresent: true, willCommit: true },
    audit: { setName: 'demo-set', featureBranch: 'eforge/demo', baseBranch: 'main', landedCommitCount: 3 },
    dependentCandidates: [
      { prdId: 'dep-open', title: 'Open Dependent', remainingDependencies: [], unblockable: true, blockedBy: [] },
      { prdId: 'dep-blocked', title: 'Blocked Dependent', remainingDependencies: ['other'], unblockable: false, blockedBy: ['other'] },
    ],
    ...overrides,
  };
}

function acceptedResponseFixture(): AcceptSuccessResponse {
  return {
    prdId: 'failed-prd',
    status: 'applied',
    applied: {
      action: 'accepted-success',
      acceptedAt: '2026-01-03T00:00:00Z',
      reasonCategory: 'bad_acceptance_criterion',
      reason: 'Acceptance criterion was wrong.',
      cleanup: { status: 'committed', commitSha: 'abc1234' },
      landing: { action: 'pr', status: 'complete', prUrl: 'https://example.test/pr/1' },
      dependents: { unblocked: ['dep-open'], remainedBlocked: [], notFound: [] },
    },
  };
}

function eligibleFixture(): ResumeEligibilityResponse {
  return {
    prdId: 'failed-prd',
    setName: 'demo-set',
    featureBranch: 'eforge/demo',
    eligible: true,
    artifactAvailability: 'merge-worktree',
    landedCommitCount: 2,
    diffStat: '3 files changed',
  };
}

function queuedResumeFixture(overrides: Partial<ResumeBuildResponse> = {}): ResumeBuildResponse {
  return {
    kind: 'queued',
    prdId: 'failed-prd',
    setName: 'demo-set',
    featureBranch: 'eforge/demo',
    baseBranch: 'main',
    movedDescendantIds: ['child-prd'],
    status: 'queued',
    profile: 'resume-profile',
    ...overrides,
  };
}

function ineligibleFixture(reason = 'No compiled build artifacts found.'): ResumeEligibilityResponse {
  return {
    prdId: 'failed-prd',
    setName: 'demo-set',
    featureBranch: 'eforge/demo',
    eligible: false,
    reason,
  };
}

function analysisFixture(overrides: Partial<QueueRecoveryAnalyzeResponse> = {}): QueueRecoveryAnalyzeResponse {
  return {
    selectedPrdId: 'failed-prd',
    strategy: QUEUE_RECOVERY_STRATEGY_RETRY_AND_REACTIVATE,
    eligible: true,
    nodes: [
      { id: 'failed-prd', title: 'Failed upstream', location: 'failed', status: 'failed', dependsOn: [], role: 'selected-failed-upstream' },
      { id: 'child', title: 'Skipped child', location: 'skipped', status: 'skipped', dependsOn: ['failed-prd'], role: 'skipped-descendant' },
    ],
    edges: [{ dependentId: 'child', dependencyId: 'failed-prd' }],
    operations: [
      { id: 'op-failed', kind: 'move-prd', prdId: 'failed-prd', expectedSourceLocation: 'failed', targetLocation: 'queue', reason: 'retry failed upstream' },
    ],
    warnings: [],
    blockers: [],
    ...overrides,
  };
}

function cascadeApplyFixture(overrides: Partial<QueueRecoveryApplyResponse> = {}): QueueRecoveryApplyResponse {
  const base = analysisFixture();
  return {
    selectedPrdId: base.selectedPrdId,
    strategy: base.strategy,
    applied: true,
    operationResults: base.operations.map((operation) => ({ operation, status: 'applied' })),
    warnings: [],
    blockers: [],
    ...overrides,
  };
}

function renderDialog(props: Partial<React.ComponentProps<typeof QueueRecoveryDialog>> = {}) {
  const refreshQueue = vi.fn();
  render(
    <QueueRecoveryDialog
      open
      prdId="failed-prd"
      prdTitle="Failed PRD title"
      onOpenChange={vi.fn()}
      refreshQueue={refreshQueue}
      {...props}
    />,
  );
  return { refreshQueue };
}

beforeEach(() => {
  vi.mocked(fetchRecoverySidecar).mockReset().mockResolvedValue(sidecarFixture('retry', 'high'));
  vi.mocked(fetchResumeEligibility).mockReset().mockResolvedValue(ineligibleFixture());
  vi.mocked(applySidecarRecovery).mockReset().mockResolvedValue(applyFixture('retry'));
  vi.mocked(triggerRecoveryAnalysis).mockReset().mockResolvedValue({ sessionId: 'analysis-1', pid: 11 });
  vi.mocked(startResumeBuild).mockReset().mockResolvedValue(queuedResumeFixture());
  vi.mocked(fetchQueueRecoveryAnalysis).mockReset().mockResolvedValue(analysisFixture());
  vi.mocked(applyQueueRecovery).mockReset().mockResolvedValue(cascadeApplyFixture());
  vi.mocked(fetchAcceptSuccessPreview).mockReset().mockResolvedValue(ineligiblePreviewFixture());
  vi.mocked(acceptRecoverySuccess).mockReset().mockResolvedValue(acceptedResponseFixture());
});

describe('QueueRecoveryDialog - header and report', () => {
  it('displays PRD title and PRD id', async () => {
    renderDialog();
    expect(await screen.findByText('Failed PRD title')).toBeDefined();
    expect(screen.getAllByText('failed-prd').length).toBeGreaterThan(0);
  });

  it('displays sidecar verdict and confidence when a sidecar exists', async () => {
    renderDialog();
    await screen.findByText('retry');
    expect(screen.getByText('high')).toBeDefined();
  });

  it('renders sidecar markdown inside a plan-prose container', async () => {
    const { container } = render(
      <QueueRecoveryDialog open prdId="failed-prd" onOpenChange={vi.fn()} refreshQueue={vi.fn()} />,
    );
    await screen.findByText(/Root cause analysis/);
    expect(container.ownerDocument.querySelector('.plan-prose')).not.toBeNull();
  });

  it('shows recovery pending and a confirmed Run recovery analysis action when sidecar is missing', async () => {
    vi.mocked(fetchRecoverySidecar).mockRejectedValue(new Error('Recovery request failed (404): not found'));
    renderDialog();

    expect(await screen.findByText(/recovery pending/)).toBeDefined();
    expect(triggerRecoveryAnalysis).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Run recovery analysis' }));
    expect(triggerRecoveryAnalysis).not.toHaveBeenCalled();

    fireEvent.click(await screen.findByRole('button', { name: 'Run analysis' }));
    await waitFor(() => expect(triggerRecoveryAnalysis).toHaveBeenCalledTimes(1));
  });
});

describe('QueueRecoveryDialog - sidecar verdict actions', () => {
  it('retry calls sidecar apply only after confirmation and not queue-cascade apply', async () => {
    vi.mocked(fetchRecoverySidecar).mockResolvedValue(sidecarFixture('retry', 'high'));
    vi.mocked(applySidecarRecovery).mockResolvedValue(applyFixture('retry'));
    renderDialog();

    fireEvent.click(await screen.findByRole('button', { name: 'Re-queue PRD' }));
    expect(applySidecarRecovery).not.toHaveBeenCalled();

    fireEvent.click(await screen.findByRole('button', { name: 'Re-queue' }));
    await waitFor(() => expect(applySidecarRecovery).toHaveBeenCalledTimes(1));
    expect(applyQueueRecovery).not.toHaveBeenCalled();
    expect(await screen.findByText(/the PRD has been re-queued/)).toBeDefined();
  });

  it('split transitions to a completion panel with the successor PRD id and hides the Enqueue action', async () => {
    vi.mocked(fetchRecoverySidecar).mockResolvedValue(sidecarFixture('split', 'medium'));
    vi.mocked(applySidecarRecovery).mockResolvedValue(applyFixture('split'));
    renderDialog();

    fireEvent.click(await screen.findByRole('button', { name: 'Enqueue successor PRD' }));
    expect(applySidecarRecovery).not.toHaveBeenCalled();

    fireEvent.click(await screen.findByRole('button', { name: 'Enqueue' }));
    await waitFor(() => expect(applySidecarRecovery).toHaveBeenCalledTimes(1));
    expect(applyQueueRecovery).not.toHaveBeenCalled();
    // Completion panel shows the successor PRD and the mutating action is gone.
    expect(await screen.findByText(/enqueued the successor PRD/)).toBeDefined();
    expect(screen.getAllByText(/successor-prd/).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'Enqueue successor PRD' })).toBeNull();
  });

  it('abandon transitions to a completion panel reporting the archived/removed PRD', async () => {
    vi.mocked(fetchRecoverySidecar).mockResolvedValue(sidecarFixture('abandon', 'high'));
    vi.mocked(applySidecarRecovery).mockResolvedValue(applyFixture('abandon'));
    renderDialog();

    fireEvent.click(await screen.findByRole('button', { name: 'Archive failed PRD' }));
    expect(applySidecarRecovery).not.toHaveBeenCalled();

    fireEvent.click(await screen.findByRole('button', { name: 'Archive' }));
    await waitFor(() => expect(applySidecarRecovery).toHaveBeenCalledTimes(1));
    expect(applyQueueRecovery).not.toHaveBeenCalled();
    expect(await screen.findByText(/archived or removed/)).toBeDefined();
  });

  it('opens an already-applied completion panel from a split sidecar marker without calling apply', async () => {
    vi.mocked(fetchRecoverySidecar).mockResolvedValue(appliedSidecarFixture());
    renderDialog();

    expect(await screen.findByText('Recovery already applied')).toBeDefined();
    expect(screen.getAllByText(/successor-prd/).length).toBeGreaterThan(0);
    // The mutating action must never be offered or invoked for an applied row.
    expect(screen.queryByRole('button', { name: 'Enqueue successor PRD' })).toBeNull();
    expect(applySidecarRecovery).not.toHaveBeenCalled();
  });

  it('keeps a successful sidecar apply visible when the queue refresh fails', async () => {
    vi.mocked(fetchRecoverySidecar).mockResolvedValue(sidecarFixture('retry', 'high'));
    vi.mocked(applySidecarRecovery).mockResolvedValue(applyFixture('retry'));
    const refreshQueue = vi.fn().mockRejectedValue(new Error('refresh boom'));
    render(
      <QueueRecoveryDialog open prdId="failed-prd" onOpenChange={vi.fn()} refreshQueue={refreshQueue} />,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Re-queue PRD' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Re-queue' }));

    // Mutation success stays visible; the refresh failure is secondary follow-up.
    expect(await screen.findByText(/the PRD has been re-queued/)).toBeDefined();
    expect(screen.getByText(/refresh boom/)).toBeDefined();
  });

  it('manual renders manual review required and no primary sidecar apply button', async () => {
    vi.mocked(fetchRecoverySidecar).mockResolvedValue(sidecarFixture('manual', 'low'));
    renderDialog();

    expect(await screen.findByText('Manual review required.')).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Re-queue PRD' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Enqueue successor PRD' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Archive failed PRD' })).toBeNull();
  });
});

describe('QueueRecoveryDialog - compiled-build resume', () => {
  it('renders Resume compiled build when eligible', async () => {
    vi.mocked(fetchResumeEligibility).mockResolvedValue(eligibleFixture());
    renderDialog();
    expect(await screen.findByRole('button', { name: 'Resume compiled build' })).toBeDefined();
  });

  it('opens a confirmation before the resume helper is called', async () => {
    vi.mocked(fetchResumeEligibility).mockResolvedValue(eligibleFixture());
    renderDialog();

    fireEvent.click(await screen.findByRole('button', { name: 'Resume compiled build' }));
    expect(startResumeBuild).not.toHaveBeenCalled();

    fireEvent.click(await screen.findByRole('button', { name: 'Resume' }));
    await waitFor(() => expect(startResumeBuild).toHaveBeenCalledTimes(1));
  });

  it('displays queued metadata on resume success and refreshes the queue', async () => {
    vi.mocked(fetchResumeEligibility).mockResolvedValue(eligibleFixture());
    vi.mocked(startResumeBuild).mockResolvedValue(queuedResumeFixture());
    const { refreshQueue } = renderDialog();

    fireEvent.click(await screen.findByRole('button', { name: 'Resume compiled build' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Resume' }));

    expect(await screen.findByText('Resume queued')).toBeDefined();
    expect(screen.getAllByText(/failed-prd/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/demo-set/).length).toBeGreaterThan(0);
    expect(screen.getByText(/eforge\/demo/)).toBeDefined();
    expect(screen.getByText(/resume-profile/)).toBeDefined();
    expect(screen.queryByText(/Session:/)).toBeNull();
    expect(screen.queryByText(/PID:/)).toBeNull();
    await waitFor(() => expect(refreshQueue).toHaveBeenCalledTimes(1));
  });

  it('treats an already-queued resume as a success completion showing the daemon detail', async () => {
    vi.mocked(fetchResumeEligibility).mockResolvedValue(eligibleFixture());
    vi.mocked(startResumeBuild).mockResolvedValue(
      queuedResumeFixture({ status: 'already-queued', detail: 'Resume already queued for failed-prd.' }),
    );
    renderDialog();

    fireEvent.click(await screen.findByRole('button', { name: 'Resume compiled build' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Resume' }));

    expect(await screen.findByText('Compiled build resumed')).toBeDefined();
    expect(screen.getByText(/Resume already queued for failed-prd/)).toBeDefined();
  });

  it('shows the status when an already-queued resume has no detail', async () => {
    vi.mocked(fetchResumeEligibility).mockResolvedValue(eligibleFixture());
    vi.mocked(startResumeBuild).mockResolvedValue(
      queuedResumeFixture({ status: 'already-queued', detail: undefined }),
    );
    renderDialog();

    fireEvent.click(await screen.findByRole('button', { name: 'Resume compiled build' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Resume' }));

    expect(await screen.findByText('Resume already-queued')).toBeDefined();
  });

  it('displays the daemon reason when resume is ineligible', async () => {
    vi.mocked(fetchResumeEligibility).mockResolvedValue(ineligibleFixture('Worktree was cleaned up.'));
    renderDialog();
    expect(await screen.findByText('Worktree was cleaned up.')).toBeDefined();
  });

  it('displays the helper error message on resume failure', async () => {
    vi.mocked(fetchResumeEligibility).mockResolvedValue(eligibleFixture());
    vi.mocked(startResumeBuild).mockRejectedValue(new Error('Recovery request failed (500): resume queue failed'));
    renderDialog();

    fireEvent.click(await screen.findByRole('button', { name: 'Resume compiled build' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Resume' }));

    expect(await screen.findByText(/resume queue failed/)).toBeDefined();
  });
});

describe('QueueRecoveryDialog - accepted success', () => {
  it('renders the accepted-success action only when the preview reports eligible', async () => {
    vi.mocked(fetchAcceptSuccessPreview).mockResolvedValue(eligiblePreviewFixture());
    renderDialog();
    expect(await screen.findByRole('button', { name: 'Accept build as successful' })).toBeDefined();
  });

  it('does not render the accepted-success action when the preview is ineligible', async () => {
    vi.mocked(fetchAcceptSuccessPreview).mockResolvedValue(ineligiblePreviewFixture());
    renderDialog();
    await screen.findByText(/Root cause analysis/);
    expect(screen.queryByRole('button', { name: 'Accept build as successful' })).toBeNull();
  });

  it('keeps the accept action disabled until a reason category and a non-whitespace note are set', async () => {
    vi.mocked(fetchAcceptSuccessPreview).mockResolvedValue(eligiblePreviewFixture());
    renderDialog();

    const trigger = (await screen.findByRole('button', { name: 'Accept build as successful' })) as HTMLButtonElement;
    expect(trigger.disabled).toBe(true);

    // A category alone is not enough.
    fireEvent.change(screen.getByLabelText('Reason category'), { target: { value: 'bad_acceptance_criterion' } });
    expect(trigger.disabled).toBe(true);

    // Whitespace-only note keeps it disabled.
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: '   ' } });
    expect(trigger.disabled).toBe(true);

    // Real note enables it.
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Criterion was wrong.' } });
    expect(trigger.disabled).toBe(false);
  });

  it('confirmation lists cleanup, landing, audit, and selected dependents', async () => {
    vi.mocked(fetchAcceptSuccessPreview).mockResolvedValue(eligiblePreviewFixture());
    renderDialog();

    fireEvent.change(await screen.findByLabelText('Reason category'), { target: { value: 'bad_acceptance_criterion' } });
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Criterion was wrong.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Accept build as successful' }));

    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(/commit removal of plan\/PRD artifacts for demo-set/)).toBeDefined();
    expect(within(dialog).getByText(/open a pull request/)).toBeDefined();
    expect(within(dialog).getByText(/record set demo-set, feature branch eforge\/demo, base branch main, 3 landed commits/)).toBeDefined();
    expect(within(dialog).getByText(/unblock dep-open/)).toBeDefined();
  });

  it('applies accepted-success and shows a completion panel with reason, cleanup, landing, and dependents', async () => {
    vi.mocked(fetchAcceptSuccessPreview).mockResolvedValue(eligiblePreviewFixture());
    vi.mocked(acceptRecoverySuccess).mockResolvedValue(acceptedResponseFixture());
    const { refreshQueue } = renderDialog();

    fireEvent.change(await screen.findByLabelText('Reason category'), { target: { value: 'bad_acceptance_criterion' } });
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Criterion was wrong.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Accept build as successful' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Accept as successful' }));

    await waitFor(() => expect(acceptRecoverySuccess).toHaveBeenCalledTimes(1));
    expect(acceptRecoverySuccess).toHaveBeenCalledWith({
      prdId: 'failed-prd',
      reasonCategory: 'bad_acceptance_criterion',
      reason: 'Criterion was wrong.',
      unblockDependentIds: ['dep-open'],
    });

    expect(await screen.findByText('Build accepted as successful')).toBeDefined();
    expect(screen.getByText('Bad / wrong acceptance criterion')).toBeDefined();
    expect(screen.getByText('Acceptance criterion was wrong.')).toBeDefined();
    expect(screen.getByText(/committed \(abc1234\)/)).toBeDefined();
    expect(screen.getByText(/pr — complete/)).toBeDefined();
    expect(screen.getByText('dep-open')).toBeDefined();
    await waitFor(() => expect(refreshQueue).toHaveBeenCalledTimes(1));
  });

  it('keeps an accepted-success completion visible when the queue refresh fails', async () => {
    vi.mocked(fetchAcceptSuccessPreview).mockResolvedValue(eligiblePreviewFixture());
    vi.mocked(acceptRecoverySuccess).mockResolvedValue(acceptedResponseFixture());
    const refreshQueue = vi.fn().mockRejectedValue(new Error('refresh boom'));
    render(
      <QueueRecoveryDialog open prdId="failed-prd" onOpenChange={vi.fn()} refreshQueue={refreshQueue} />,
    );

    fireEvent.change(await screen.findByLabelText('Reason category'), { target: { value: 'other' } });
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Accepted manually.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Accept build as successful' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Accept as successful' }));

    expect(await screen.findByText('Build accepted as successful')).toBeDefined();
    expect(screen.getByText(/refresh boom/)).toBeDefined();
  });
});

describe('QueueRecoveryDialog - advanced queue-cascade', () => {
  it('shows the required upstream/descendant copy', async () => {
    renderDialog();
    await screen.findByText(/Root cause analysis/);
    expect(screen.getByText(/moves the failed upstream back to the queue and may reactivate skipped descendants/)).toBeDefined();
  });

  it('fetches queue-cascade analysis only after the advanced section is opened', async () => {
    renderDialog();
    await screen.findByText(/Root cause analysis/);
    expect(fetchQueueRecoveryAnalysis).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Show' }));
    await waitFor(() => expect(fetchQueueRecoveryAnalysis).toHaveBeenCalledTimes(1));
  });

  it('applies queue-cascade recovery only after confirmation and not sidecar apply', async () => {
    renderDialog();
    await screen.findByText(/Root cause analysis/);

    fireEvent.click(screen.getByRole('button', { name: 'Show' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Apply queue-cascade recovery' }));
    expect(applyQueueRecovery).not.toHaveBeenCalled();

    fireEvent.click(await screen.findByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(applyQueueRecovery).toHaveBeenCalledTimes(1));
    expect(applySidecarRecovery).not.toHaveBeenCalled();
  });

  it('warns when the sidecar verdict is manual', async () => {
    vi.mocked(fetchRecoverySidecar).mockResolvedValue(sidecarFixture('manual', 'high'));
    renderDialog();
    expect(await screen.findByText(/can contradict manual review guidance/)).toBeDefined();
  });

  it('warns when the recovery verdict has low confidence', async () => {
    vi.mocked(fetchRecoverySidecar).mockResolvedValue(sidecarFixture('retry', 'low'));
    renderDialog();
    expect(await screen.findByText(/low confidence/)).toBeDefined();
  });
});
