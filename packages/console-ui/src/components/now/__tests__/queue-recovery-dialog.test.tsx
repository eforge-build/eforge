import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import * as React from 'react';
import { QueueRecoveryDialog } from '../queue-recovery-dialog';
import {
  applySidecarRecovery,
  applyQueueRecovery,
  fetchQueueRecoveryAnalysis,
  fetchRecoverySidecar,
  fetchResumeEligibility,
  startResumeBuild,
  triggerRecoveryAnalysis,
  QUEUE_RECOVERY_STRATEGY_RETRY_AND_REACTIVATE,
  type ApplyRecoveryResponse,
  type QueueRecoveryAnalyzeResponse,
  type QueueRecoveryApplyResponse,
  type ReadSidecarResponse,
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
  vi.mocked(startResumeBuild).mockReset().mockResolvedValue({ sessionId: 'resume-1', pid: 4242 });
  vi.mocked(fetchQueueRecoveryAnalysis).mockReset().mockResolvedValue(analysisFixture());
  vi.mocked(applyQueueRecovery).mockReset().mockResolvedValue(cascadeApplyFixture());
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
    expect(await screen.findByText(/re-queueing the PRD/)).toBeDefined();
  });

  it('split calls sidecar apply and reports continuation-aware successor PRD wording', async () => {
    vi.mocked(fetchRecoverySidecar).mockResolvedValue(sidecarFixture('split', 'medium'));
    vi.mocked(applySidecarRecovery).mockResolvedValue(applyFixture('split'));
    renderDialog();

    fireEvent.click(await screen.findByRole('button', { name: 'Enqueue successor PRD' }));
    expect(applySidecarRecovery).not.toHaveBeenCalled();

    fireEvent.click(await screen.findByRole('button', { name: 'Enqueue' }));
    await waitFor(() => expect(applySidecarRecovery).toHaveBeenCalledTimes(1));
    expect(applyQueueRecovery).not.toHaveBeenCalled();
    expect(await screen.findByText(/enqueuing the successor PRD/)).toBeDefined();
    expect(screen.getByText(/preserved feature branch/)).toBeDefined();
  });

  it('abandon calls sidecar apply and reports archiving or removing the failed PRD', async () => {
    vi.mocked(fetchRecoverySidecar).mockResolvedValue(sidecarFixture('abandon', 'high'));
    vi.mocked(applySidecarRecovery).mockResolvedValue(applyFixture('abandon'));
    renderDialog();

    fireEvent.click(await screen.findByRole('button', { name: 'Archive failed PRD' }));
    expect(applySidecarRecovery).not.toHaveBeenCalled();

    fireEvent.click(await screen.findByRole('button', { name: 'Archive' }));
    await waitFor(() => expect(applySidecarRecovery).toHaveBeenCalledTimes(1));
    expect(applyQueueRecovery).not.toHaveBeenCalled();
    expect(await screen.findByText(/archiving or removing the failed PRD/)).toBeDefined();
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

  it('displays the returned session id and process id on resume success', async () => {
    vi.mocked(fetchResumeEligibility).mockResolvedValue(eligibleFixture());
    vi.mocked(startResumeBuild).mockResolvedValue({ sessionId: 'resume-1', pid: 4242 });
    renderDialog();

    fireEvent.click(await screen.findByRole('button', { name: 'Resume compiled build' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Resume' }));

    expect(await screen.findByText('Resume started')).toBeDefined();
    expect(screen.getByText(/resume-1/)).toBeDefined();
    expect(screen.getByText(/4242/)).toBeDefined();
  });

  it('displays the daemon reason when resume is ineligible', async () => {
    vi.mocked(fetchResumeEligibility).mockResolvedValue(ineligibleFixture('Worktree was cleaned up.'));
    renderDialog();
    expect(await screen.findByText('Worktree was cleaned up.')).toBeDefined();
  });

  it('displays the helper error message on resume failure', async () => {
    vi.mocked(fetchResumeEligibility).mockResolvedValue(eligibleFixture());
    vi.mocked(startResumeBuild).mockRejectedValue(new Error('Recovery request failed (500): resume worker crashed'));
    renderDialog();

    fireEvent.click(await screen.findByRole('button', { name: 'Resume compiled build' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Resume' }));

    expect(await screen.findByText(/resume worker crashed/)).toBeDefined();
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
