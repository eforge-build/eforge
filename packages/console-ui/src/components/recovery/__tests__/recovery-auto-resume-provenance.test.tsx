// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ComponentProps } from 'react';
import type { ReadSidecarResponse, ContinueRepairEligibilityResponse } from '@eforge-build/client/browser';
import { RecoveryReportPanel } from '../recovery-report-panel';

afterEach(cleanup);

function sidecar(overrides: Partial<ReadSidecarResponse['json']> = {}): ReadSidecarResponse {
  return {
    markdown: '# Recovery report\n\nContinue and repair is recommended.',
    json: {
      schemaVersion: 3,
      generatedAt: '2026-01-01T00:00:00.000Z',
      prdId: 'failed-prd',
      setName: 'failed-set',
      verdict: { verdict: 'continue-repair', confidence: 'high' },
      report: {
        operatorSummary: 'Preserved artifacts are available.',
        recommendedAction: 'Continue and repair build.',
        keyEvidence: [],
        completedWork: [],
        remainingWork: [],
        risks: [],
      },
      boundedEvidence: {
        identity: {
          prdId: 'failed-prd',
          setName: 'failed-set',
          featureBranch: 'eforge/failed-set',
          baseBranch: 'main',
          failedAt: '2026-01-01T00:00:00.000Z',
        },
        plans: [],
        failingPlan: { planId: 'plan-01' },
        landedCommits: [],
        modelsUsed: [],
      },
      continueRepairEligibility: {
        source: 'continueRepairEligibility',
        eligible: true,
        featureBranch: 'eforge/failed-set',
        artifactAvailability: 'feature-branch',
        landedCommitCount: 1,
      },
      ...overrides,
    },
  } as unknown as ReadSidecarResponse;
}

function eligible(): ContinueRepairEligibilityResponse {
  return {
    prdId: 'failed-prd',
    setName: 'failed-set',
    featureBranch: 'eforge/failed-set',
    eligible: true,
    artifactAvailability: 'feature-branch',
    landedCommitCount: 1,
  } as unknown as ContinueRepairEligibilityResponse;
}

function renderPanel(props: Partial<ComponentProps<typeof RecoveryReportPanel>> = {}) {
  const defaults: ComponentProps<typeof RecoveryReportPanel> = {
    prdId: 'failed-prd',
    reportStatus: 'loaded',
    sidecar: sidecar(),
    reportError: null,
    sidecarVerdict: 'continue-repair',
    effectiveVerdict: 'continue-repair',
    effectiveConfidence: 'high',
    appliedMetadata: undefined,
    eligibility: eligible(),
    eligibilityError: null,
    applyError: null,
    analysisStarted: false,
    analysisError: null,
    continueRepairError: null,
    applyingSidecar: false,
    startingAnalysis: false,
    startingContinueRepair: false,
    acceptSuccessPreview: null,
    acceptingSuccess: false,
    acceptSuccessError: null,
    onAcceptSuccess: vi.fn(),
    onApplySidecar: vi.fn(),
    onRunAnalysis: vi.fn(),
    onContinueRepair: vi.fn(),
    refreshQueue: vi.fn(),
  };
  return render(<RecoveryReportPanel {...defaults} {...props} />);
}

describe('RecoveryReportPanel recovery auto-resume provenance', () => {
  it('keeps confirmed manual recovery controls visible when automatic decisions are present', () => {
    renderPanel({
      sidecar: sidecar({
        autoResume: {
          attempts: 1,
          lastAttemptAt: '2026-01-01T00:01:00.000Z',
          stoppedReason: 'attempt-budget-exhausted',
        },
      }),
    });

    expect(screen.getByText('Automatic recovery decision')).toBeTruthy();
    expect(screen.getByText(/Automatic continue-and-repair attempts: 1 · stopped: attempt-budget-exhausted/)).toBeTruthy();
    expect(screen.getByText('Last automatic attempt: 2026-01-01T00:01:00.000Z')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Continue and repair build' })).toBeTruthy();
  });

  it('labels automatic decisions separately from already-applied user-confirmed recovery provenance', () => {
    renderPanel({
      sidecar: sidecar({
        autoResume: {
          attempts: 2,
          lastAttemptAt: '2026-01-01T00:02:00.000Z',
          stoppedReason: 'repeated-failure-signature',
        },
      }),
      appliedMetadata: {
        action: 'continue-repair',
        appliedAt: '2026-01-01T00:03:00.000Z',
      },
    });

    expect(screen.getByText('Automatic recovery decision')).toBeTruthy();
    expect(screen.getByText(/stopped: repeated-failure-signature/)).toBeTruthy();
    expect(screen.getByText('Applied recovery provenance')).toBeTruthy();
    expect(screen.getByText(/Continue and repair build was already applied/i)).toBeTruthy();
  });
});
