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
  fetchContinueRepairEligibility,
  startContinueRepair,
  triggerRecoveryAnalysis,
  QUEUE_RECOVERY_STRATEGY_RETRY_AND_REACTIVATE,
  type AcceptSuccessPreviewResponse,
  type AcceptSuccessResponse,
  type ApplyRecoveryResponse,
  type QueueRecoveryAnalyzeResponse,
  type QueueRecoveryApplyResponse,
  type ReadSidecarResponse,
  type ContinueRepairResponse,
  type ContinueRepairEligibilityResponse,
} from '@eforge-build/client/browser';

vi.mock('@eforge-build/client/browser', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@eforge-build/client/browser')>();
  return {
    ...actual,
    fetchRecoverySidecar: vi.fn(),
    fetchContinueRepairEligibility: vi.fn(),
    applySidecarRecovery: vi.fn(),
    triggerRecoveryAnalysis: vi.fn(),
    startContinueRepair: vi.fn(),
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
      schemaVersion: 3,
      generatedAt: '2026-01-01T00:00:00Z',
      prdId: 'failed-prd',
      setName: 'demo-set',
      verdict: { verdict, confidence },
      report: { operatorSummary: 'Root cause analysis.', recommendedAction: verdict === 'continue-repair' ? 'Continue and repair build.' : 'Retry from scratch.', keyEvidence: [], completedWork: [], remainingWork: [], risks: [] },
      boundedEvidence: {
        identity: { prdId: 'failed-prd', setName: 'demo-set', featureBranch: 'eforge/demo-set', baseBranch: 'main', failedAt: '2026-01-01T00:00:00Z' },
        plans: [],
        failingPlan: { planId: 'plan-01' },
        landedCommits: [],
        modelsUsed: [],
      },
    },
  } as unknown as ReadSidecarResponse;
}

function applyFixture(verdict: ApplyRecoveryResponse['verdict']): ApplyRecoveryResponse {
  return { verdict };
}

function appliedSidecarFixture(): ReadSidecarResponse {
  return {
    ...sidecarFixture('continue-repair', 'high'),
    markdown: '# Recovery report\n\nAlready applied.',
    json: {
      ...sidecarFixture('continue-repair', 'high').json,
      applied: { action: 'continue-repair', appliedAt: '2026-01-02T00:00:00Z' },
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

function eligibleFixture(): ContinueRepairEligibilityResponse {
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

function queuedContinueRepairFixture(overrides: Partial<ContinueRepairResponse> = {}): ContinueRepairResponse {
  return {
    kind: 'queued',
    prdId: 'failed-prd',
    setName: 'demo-set',
    featureBranch: 'eforge/demo',
    baseBranch: 'main',
    movedDescendantIds: ['child-prd'],
    status: 'queued',
    profile: 'continue-profile',
    ...overrides,
  };
}

function ineligibleFixture(reason = 'No preserved compiled artifacts found.'): ContinueRepairEligibilityResponse {
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

function repairAnalysisFixture(overrides: Partial<QueueRecoveryAnalyzeResponse> = {}): QueueRecoveryAnalyzeResponse {
  return analysisFixture({
    eligible: false,
    dependencyClassifications: [
      { targetPrdId: 'failed-prd', dependentPrdId: 'failed-prd', dependencyPrdId: 'active-dep', status: 'blocking', reason: 'still active' },
      { targetPrdId: 'failed-prd', dependentPrdId: 'failed-prd', dependencyPrdId: 'done-dep', status: 'satisfied', reason: 'usable artifact' },
      { targetPrdId: 'child', dependentPrdId: 'child', dependencyPrdId: 'terminal-dep', status: 'terminal', reason: 'failed upstream' },
      { targetPrdId: 'child', dependentPrdId: 'child', dependencyPrdId: 'stale-dep', status: 'stale-historical', reason: 'missing artifact' },
    ],
    dispatchPreflight: {
      canApply: false,
      blockers: [{ code: 'dispatch-preflight-blocked', prdId: 'failed-prd', message: 'choose stack_parent', severity: 'blocker' }],
      warnings: [{ code: 'stale-historical-dependency', prdId: 'child', message: 'stale dependency remains', severity: 'warning' }],
      items: [{ targetPrdId: 'failed-prd', canDispatch: false, blockers: ['choose stack_parent'], warnings: [], stackingEnabled: true, meaningfulDependencyIds: ['done-dep', 'active-dep'], requiresStackParentChoice: true }],
    },
    availableRepairActions: [{ kind: 'remove-depends-on', targetPrdId: 'failed-prd', dependencyIds: ['done-dep'] }],
    blockers: [{ code: 'dispatch-preflight-blocked', prdId: 'failed-prd', message: 'choose stack_parent', severity: 'blocker' }],
    ...overrides,
  });
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
  vi.mocked(fetchContinueRepairEligibility).mockReset().mockResolvedValue(ineligibleFixture());
  vi.mocked(applySidecarRecovery).mockReset().mockResolvedValue(applyFixture('retry'));
  vi.mocked(triggerRecoveryAnalysis).mockReset().mockResolvedValue({ sessionId: 'analysis-1', pid: 11 });
  vi.mocked(startContinueRepair).mockReset().mockResolvedValue(queuedContinueRepairFixture());
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

    fireEvent.click(await screen.findByRole('button', { name: 'Retry from scratch' }));
    expect(applySidecarRecovery).not.toHaveBeenCalled();

    fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(applySidecarRecovery).toHaveBeenCalledTimes(1));
    expect(applyQueueRecovery).not.toHaveBeenCalled();
    expect(await screen.findByText(/the PRD has been re-queued/)).toBeDefined();
  });

  it('continue-repair sidecar queues continue-and-repair and hides retry', async () => {
    vi.mocked(fetchRecoverySidecar).mockResolvedValue(sidecarFixture('continue-repair', 'medium'));
    vi.mocked(fetchContinueRepairEligibility).mockResolvedValue(eligibleFixture());
    vi.mocked(startContinueRepair).mockResolvedValue(queuedContinueRepairFixture());
    renderDialog();

    fireEvent.click(await screen.findByRole('button', { name: 'Continue and repair build' }));
    expect(startContinueRepair).not.toHaveBeenCalled();

    fireEvent.click(await screen.findByRole('button', { name: 'Continue build' }));
    await waitFor(() => expect(startContinueRepair).toHaveBeenCalledTimes(1));
    expect(applySidecarRecovery).not.toHaveBeenCalled();
    expect(applyQueueRecovery).not.toHaveBeenCalled();
    expect(await screen.findByText('Continue and repair queued')).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Retry from scratch' })).toBeNull();
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

  it('opens an already-applied completion panel from a continue-repair sidecar marker without calling apply', async () => {
    vi.mocked(fetchRecoverySidecar).mockResolvedValue(appliedSidecarFixture());
    renderDialog();

    expect(await screen.findByText('Recovery already applied')).toBeDefined();
    expect(screen.getAllByText('continue-repair').length).toBeGreaterThan(0);
    // The mutating action must never be offered or invoked for an applied row.
    expect(screen.queryByRole('button', { name: 'Continue and repair build' })).toBeNull();
    expect(applySidecarRecovery).not.toHaveBeenCalled();
    expect(startContinueRepair).not.toHaveBeenCalled();
  });

  it('keeps a successful sidecar apply visible when the queue refresh fails', async () => {
    vi.mocked(fetchRecoverySidecar).mockResolvedValue(sidecarFixture('retry', 'high'));
    vi.mocked(applySidecarRecovery).mockResolvedValue(applyFixture('retry'));
    const refreshQueue = vi.fn().mockRejectedValue(new Error('refresh boom'));
    render(
      <QueueRecoveryDialog open prdId="failed-prd" onOpenChange={vi.fn()} refreshQueue={refreshQueue} />,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Retry from scratch' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Retry' }));

    // Mutation success stays visible; the refresh failure is secondary follow-up.
    expect(await screen.findByText(/the PRD has been re-queued/)).toBeDefined();
    expect(screen.getByText(/refresh boom/)).toBeDefined();
  });

  it('manual renders manual review required and no primary sidecar apply button', async () => {
    vi.mocked(fetchRecoverySidecar).mockResolvedValue(sidecarFixture('manual', 'low'));
    renderDialog();

    expect(await screen.findByText('Manual review / manual replanning required.')).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Retry from scratch' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Continue and repair build' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Archive failed PRD' })).toBeNull();
  });
});

describe('QueueRecoveryDialog - continue-and-repair', () => {
  it('renders Continue and repair build when eligible', async () => {
    vi.mocked(fetchContinueRepairEligibility).mockResolvedValue(eligibleFixture());
    renderDialog();
    expect(await screen.findByRole('button', { name: 'Continue and repair build' })).toBeDefined();
    expect(screen.getAllByRole('button', { name: 'Continue and repair build' })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Retry from scratch' })).toBeNull();
  });

  it('opens a confirmation before the continue-and-repair helper is called', async () => {
    vi.mocked(fetchContinueRepairEligibility).mockResolvedValue(eligibleFixture());
    renderDialog();

    fireEvent.click(await screen.findByRole('button', { name: 'Continue and repair build' }));
    expect(startContinueRepair).not.toHaveBeenCalled();

    fireEvent.click(await screen.findByRole('button', { name: 'Continue build' }));
    await waitFor(() => expect(startContinueRepair).toHaveBeenCalledTimes(1));
  });

  it('displays queued metadata on continue-and-repair success and refreshes the queue', async () => {
    vi.mocked(fetchContinueRepairEligibility).mockResolvedValue(eligibleFixture());
    vi.mocked(startContinueRepair).mockResolvedValue(queuedContinueRepairFixture());
    const { refreshQueue } = renderDialog();

    fireEvent.click(await screen.findByRole('button', { name: 'Continue and repair build' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Continue build' }));

    expect(await screen.findByText('Continue and repair queued')).toBeDefined();
    expect(screen.getAllByText(/failed-prd/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/demo-set/).length).toBeGreaterThan(0);
    expect(screen.getByText(/eforge\/demo/)).toBeDefined();
    expect(screen.getByText(/continue-profile/)).toBeDefined();
    expect(screen.queryByText(/Session:/)).toBeNull();
    expect(screen.queryByText(/PID:/)).toBeNull();
    await waitFor(() => expect(refreshQueue).toHaveBeenCalledTimes(1));
  });

  it('treats an already-queued continue-and-repair as a success completion showing the daemon detail', async () => {
    vi.mocked(fetchContinueRepairEligibility).mockResolvedValue(eligibleFixture());
    vi.mocked(startContinueRepair).mockResolvedValue(
      queuedContinueRepairFixture({ status: 'already-queued', detail: 'Continue and repair already queued for failed-prd.' }),
    );
    renderDialog();

    fireEvent.click(await screen.findByRole('button', { name: 'Continue and repair build' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Continue build' }));

    expect(await screen.findByText('Continue and repair queued')).toBeDefined();
    expect(screen.getByText(/Continue and repair already queued for failed-prd/)).toBeDefined();
  });

  it('shows the status when an already-queued continue-and-repair has no detail', async () => {
    vi.mocked(fetchContinueRepairEligibility).mockResolvedValue(eligibleFixture());
    vi.mocked(startContinueRepair).mockResolvedValue(
      queuedContinueRepairFixture({ status: 'already-queued', detail: undefined }),
    );
    renderDialog();

    fireEvent.click(await screen.findByRole('button', { name: 'Continue and repair build' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Continue build' }));

    expect(await screen.findByText('Continue-and-repair status: already-queued')).toBeDefined();
  });

  it('displays the daemon reason when continue-and-repair is ineligible', async () => {
    vi.mocked(fetchContinueRepairEligibility).mockResolvedValue(ineligibleFixture('Worktree was cleaned up.'));
    renderDialog();
    expect(await screen.findByText('Worktree was cleaned up.')).toBeDefined();
  });

  it('displays the helper error message on continue-and-repair failure', async () => {
    vi.mocked(fetchContinueRepairEligibility).mockResolvedValue(eligibleFixture());
    vi.mocked(startContinueRepair).mockRejectedValue(new Error('Recovery request failed (500): continue-and-repair queue failed'));
    renderDialog();

    fireEvent.click(await screen.findByRole('button', { name: 'Continue and repair build' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Continue build' }));

    expect(await screen.findByText(/continue-and-repair queue failed/)).toBeDefined();
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

  it('confirmation lists cleanup, landing, audit, selected dependents, and defined auto-merge intent', async () => {
    vi.mocked(fetchAcceptSuccessPreview).mockResolvedValue(eligiblePreviewFixture({ effectiveLandingAutoMerge: true } as unknown as Partial<AcceptSuccessPreviewResponse>));
    renderDialog();

    fireEvent.change(await screen.findByLabelText('Reason category'), { target: { value: 'bad_acceptance_criterion' } });
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Criterion was wrong.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Accept build as successful' }));

    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(/commit removal of plan\/PRD artifacts for demo-set/)).toBeDefined();
    expect(within(dialog).getByText(/open a pull request/)).toBeDefined();
    expect(within(dialog).getByText(/PR auto-merge: enabled\./)).toBeDefined();
    expect(within(dialog).getByText(/record set demo-set, feature branch eforge\/demo, base branch main, 3 landed commits/)).toBeDefined();
    expect(within(dialog).getByText(/unblock dep-open/)).toBeDefined();
  });

  it('omits auto-merge intent from confirmation when preview does not define it', async () => {
    vi.mocked(fetchAcceptSuccessPreview).mockResolvedValue(eligiblePreviewFixture());
    renderDialog();

    fireEvent.change(await screen.findByLabelText('Reason category'), { target: { value: 'bad_acceptance_criterion' } });
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Criterion was wrong.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Accept build as successful' }));

    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).queryByText(/PR auto-merge:/)).toBeNull();
  });

  it('applies accepted-success and shows a completion panel with reason, cleanup, landing, and dependents', async () => {
    vi.mocked(fetchAcceptSuccessPreview).mockResolvedValue(eligiblePreviewFixture());
    const accepted = acceptedResponseFixture();
    accepted.applied.landing = {
      ...accepted.applied.landing,
      autoMerge: { status: 'failed', reason: 'branch protection blocked' },
    };
    vi.mocked(acceptRecoverySuccess).mockResolvedValue(accepted);
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
    expect(screen.getByText(/auto-merge failed — branch protection blocked/)).toBeDefined();
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

describe('QueueRecoveryDialog - dispatch blocker callout', () => {
  it('displays imported dispatch failure stage, timestamp, and reason above the recovery report', async () => {
    renderDialog({ dispatchFailure: { reason: 'stack_parent is required', stage: 'stacking-validation', timestamp: '2026-01-01T00:00:00.000Z' } });
    expect(await screen.findByText('Pre-session dispatch blocker')).toBeDefined();
    expect(screen.getByText(/Dispatch blocked before session:start \(stacking-validation\): stack_parent is required/)).toBeDefined();
    expect(screen.getByText(/Stage: stacking-validation/)).toBeDefined();
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
    expect(await screen.findByText(/can contradict manual guidance/)).toBeDefined();
  });

  it('renders dependency classifications, dispatch preflight warnings, and repair result metadata', async () => {
    vi.mocked(fetchQueueRecoveryAnalysis).mockResolvedValue(repairAnalysisFixture({ dispatchPreflight: { canApply: true, blockers: [], warnings: [{ code: 'stale-historical-dependency', prdId: 'child', message: 'stale dependency remains', severity: 'warning' }], items: [] }, blockers: [] }));
    vi.mocked(applyQueueRecovery).mockResolvedValue(cascadeApplyFixture({
      repairResults: [{
        action: { kind: 'remove-depends-on', targetPrdId: 'failed-prd', dependencyIds: ['done-dep'] },
        status: 'applied',
        before: { dependsOn: ['done-dep'] },
        after: { dependsOn: [] },
      }],
    }));
    renderDialog();

    fireEvent.click(await screen.findByRole('button', { name: 'Show' }));
    expect(await screen.findByText('blocking')).toBeDefined();
    expect(screen.getByText('satisfied')).toBeDefined();
    expect(screen.getByText('terminal')).toBeDefined();
    expect(screen.getByText('stale-historical')).toBeDefined();
    expect(screen.getByText(/stale dependency remains/)).toBeDefined();
    const remove = screen.getByRole('checkbox');
    expect((remove as HTMLButtonElement).getAttribute('aria-checked')).toBe('false');
    fireEvent.click(remove);

    fireEvent.click(screen.getByRole('button', { name: 'Apply queue-cascade recovery' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(/requeues the existing PRD artifact/)).toBeDefined();
    expect(within(dialog).getByText(/Frontmatter is preserved unless/i)).toBeDefined();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Apply' }));

    await waitFor(() => expect(applyQueueRecovery).toHaveBeenCalledWith(expect.objectContaining({
      repairActions: [{ kind: 'remove-depends-on', targetPrdId: 'failed-prd', dependencyIds: ['done-dep'] }],
      confirmDependencyRemoval: true,
    })));
    expect(await screen.findByText(/remove-depends-on failed-prd: applied/)).toBeDefined();
    expect(screen.getByText(/before:/)).toBeDefined();
  });

  it('sends selected stack_parent repair actions after an explicit operator choice', async () => {
    vi.mocked(fetchQueueRecoveryAnalysis).mockResolvedValue(repairAnalysisFixture({
      availableRepairActions: [
        { kind: 'remove-depends-on', targetPrdId: 'failed-prd', dependencyIds: ['done-dep'] },
        { kind: 'set-stack-parent', targetPrdId: 'failed-prd', selectedParentId: 'done-dep' },
      ],
    }));
    renderDialog();

    fireEvent.click(await screen.findByRole('button', { name: 'Show' }));
    expect(await screen.findByText(/Select stack_parent for/)).toBeDefined();
    const stackParentTrigger = screen.getByRole('combobox');
    fireEvent.keyDown(stackParentTrigger, { key: 'ArrowDown' });
    fireEvent.click(await screen.findByRole('option', { name: 'done-dep' }));

    fireEvent.click(await screen.findByRole('button', { name: 'Apply queue-cascade recovery' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Apply' }));

    await waitFor(() => expect(applyQueueRecovery).toHaveBeenCalledWith(expect.objectContaining({
      repairActions: [{ kind: 'set-stack-parent', targetPrdId: 'failed-prd', selectedParentId: 'done-dep' }],
    })));
  });

  it('keeps queue-cascade apply disabled while required stack_parent choices are unresolved', async () => {
    vi.mocked(fetchQueueRecoveryAnalysis).mockResolvedValue(repairAnalysisFixture());
    renderDialog();

    fireEvent.click(await screen.findByRole('button', { name: 'Show' }));
    expect(await screen.findByText(/requires an explicit stack_parent selection/)).toBeDefined();
    expect((screen.getByRole('button', { name: 'Apply queue-cascade recovery' }) as HTMLButtonElement).disabled).toBe(true);
    expect(applyQueueRecovery).not.toHaveBeenCalled();
  });

  it('warns when the recovery verdict has low confidence', async () => {
    vi.mocked(fetchRecoverySidecar).mockResolvedValue(sidecarFixture('retry', 'low'));
    renderDialog();
    expect(await screen.findByText(/low confidence/)).toBeDefined();
  });
});
