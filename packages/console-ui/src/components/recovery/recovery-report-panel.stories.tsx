import type { Meta, StoryObj } from '@storybook/react-vite';
import type {
  ReadSidecarResponse,
  ContinueRepairEligibilityResponse,
  AcceptSuccessPreviewResponse,
} from '@eforge-build/client/browser';
import { SheetPanel } from '@/components/ui/sheet-panel';
import { RecoveryVerdictChip } from '@/components/recovery/verdict-chip';
import { RecoveryReportPanel } from './recovery-report-panel';

/**
 * Stories render the *presentational* RecoveryReportPanel inside the real
 * SheetPanel chrome with hand-crafted wire payloads, so the side-panel layout
 * (width, scroll, markdown formatting) is exercised with zero network access.
 * Wire shapes are owned by the client, so fixtures are cast through `unknown`.
 */

const REPORT_MARKDOWN = `# Recovery Analysis: add-queued-prd-priority-and-removal-controls

Generated: 2026-06-04T18:22:50.611Z  Set: add-queued-prd-priority-and-removal-controls  Feature Branch: eforge/add-queued-prd-priority-and-removal-controls

## Verdict

**CONTINUE-REPAIR** (confidence: high)

**Verdict Source:** deterministic

## Rationale

Preserved compiled artifacts are available for the failed build. Continue-and-repair is preferable to retrying from scratch because the previously completed work can be reused while the failed plan is repaired.

## Plans

| Plan | Status | Error |
| --- | --- | --- |
| plan-01-core-queue-control | completed | |
| plan-03-console-queue-controls | completed | |
| plan-02-host-queue-controls | failed | 4 blocking issue outcome(s) remain after 1 review round(s) |
| plan-04-queue-control-docs | blocked | Blocked by failed dependency: plan-02-host-queue-controls |

## Failing Plans

| Plan | Error |
| --- | --- |
| plan-02-host-queue-controls | 4 blocking issue outcome(s) remain after 1 review round(s) |

## Continue-and-Repair Eligibility

Preserved compiled artifacts are available from the merge worktree. Continue and repair the build to reuse landed work and repair the failed plan.

## Manual Guidance

If continue-and-repair is not appropriate, perform bounded manual replanning for the failed plan only instead of regenerating broad follow-up work.
`;

function sidecarFixture(): ReadSidecarResponse {
  return {
    markdown: REPORT_MARKDOWN,
    json: {
      schemaVersion: 3,
      generatedAt: '2026-06-04T18:22:50.611Z',
      prdId: 'add-queued-prd-priority-and-removal-controls',
      setName: 'add-queued-prd-priority-and-removal-controls',
      verdict: { verdict: 'continue-repair', confidence: 'high' },
      report: {
        operatorSummary: 'Preserved compiled artifacts are available for the failed build.',
        recommendedAction: 'Continue and repair build.',
        keyEvidence: ['Compiled artifacts are available from the merge worktree.'],
        completedWork: ['Core and Console queue-control work landed.'],
        remainingWork: ['Repair the failed host queue-control plan.'],
        risks: ['The preserved artifacts may become stale if the worktree is cleaned up.'],
      },
      boundedEvidence: {
        identity: {
          prdId: 'add-queued-prd-priority-and-removal-controls',
          setName: 'add-queued-prd-priority-and-removal-controls',
          featureBranch: 'eforge/add-queued-prd-priority-and-removal-controls',
          baseBranch: 'main',
          failedAt: '2026-06-04T18:22:50.611Z',
        },
        plans: [],
        failingPlan: { planId: 'plan-02-host-queue-controls' },
        landedCommits: [],
        modelsUsed: [],
      },
      continueRepairEligibility: {
        source: 'continueRepairEligibility',
        eligible: true,
        featureBranch: 'eforge/add-queued-prd-priority-and-removal-controls',
        artifactAvailability: 'merge-worktree',
        landedCommitCount: 2,
        diffStat: '3 files changed',
      },
    },
  } as unknown as ReadSidecarResponse;
}

function ineligibleFixture(): ContinueRepairEligibilityResponse {
  return {
    prdId: 'add-queued-prd-priority-and-removal-controls',
    setName: 'add-queued-prd-priority-and-removal-controls',
    featureBranch: 'eforge/add-queued-prd-priority-and-removal-controls',
    eligible: false,
    reason: 'No preserved compiled artifacts found.',
  };
}

function eligibleFixture(): ContinueRepairEligibilityResponse {
  return {
    prdId: 'add-queued-prd-priority-and-removal-controls',
    setName: 'add-queued-prd-priority-and-removal-controls',
    featureBranch: 'eforge/add-queued-prd-priority-and-removal-controls',
    eligible: true,
    artifactAvailability: 'merge-worktree',
    landedCommitCount: 2,
    diffStat: '3 files changed',
  };
}

function acceptSuccessPreviewFixture(): AcceptSuccessPreviewResponse {
  return {
    prdId: 'add-queued-prd-priority-and-removal-controls',
    status: 'eligible',
    landingAction: 'pr',
    cleanup: {
      planSet: 'add-queued-prd-priority-and-removal-controls',
      planArtifactsPresent: true,
      prdArtifactPresent: true,
      willCommit: true,
    },
    audit: {
      setName: 'add-queued-prd-priority-and-removal-controls',
      featureBranch: 'eforge/add-queued-prd-priority-and-removal-controls',
      baseBranch: 'main',
      landedCommitCount: 3,
    },
    dependentCandidates: [
      { prdId: 'docs-followup', title: 'Docs Follow-up', remainingDependencies: [], unblockable: true, blockedBy: [] },
      { prdId: 'blocked-followup', title: 'Blocked Follow-up', remainingDependencies: ['other'], unblockable: false, blockedBy: ['other'] },
    ],
  };
}

const meta = {
  title: 'Recovery/RecoveryReportPanel',
  component: RecoveryReportPanel,
  parameters: { layout: 'fullscreen' },
  // Render inside the real SheetPanel chrome so stories show the side-panel
  // exactly as the dashboard mounts it.
  decorators: [
    (Story) => (
      <SheetPanel
        open
        onClose={() => undefined}
        className="w-full sm:max-w-3xl"
        title={
          <span className="flex items-center gap-2">
            <span>Recover failed build</span>
            <RecoveryVerdictChip verdict="continue-repair" confidence="high" />
          </span>
        }
        description={
          <span>
            Add Queued PRD Priority and Removal Controls
            <span className="ml-2 text-text-dim">add-queued-prd-priority-and-removal-controls</span>
          </span>
        }
      >
        <Story />
      </SheetPanel>
    ),
  ],
  args: {
    prdId: 'add-queued-prd-priority-and-removal-controls',
    reportStatus: 'loading',
    sidecar: null,
    reportError: null,
    sidecarVerdict: undefined,
    effectiveVerdict: undefined,
    effectiveConfidence: undefined,
    appliedMetadata: undefined,
    eligibility: null,
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
    onAcceptSuccess: () => undefined,
    onApplySidecar: () => undefined,
    onRunAnalysis: () => undefined,
    onContinueRepair: () => undefined,
    refreshQueue: () => undefined,
  },
} satisfies Meta<typeof RecoveryReportPanel>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Loaded: Story = {
  args: {
    reportStatus: 'loaded',
    sidecar: sidecarFixture(),
    sidecarVerdict: 'continue-repair',
    effectiveVerdict: 'continue-repair',
    effectiveConfidence: 'high',
    eligibility: eligibleFixture(),
  },
};

export const Loading: Story = {
  args: { reportStatus: 'loading' },
};

export const Missing: Story = {
  args: { reportStatus: 'missing' },
};

export const ErrorState: Story = {
  args: {
    reportStatus: 'error',
    reportError: 'Recovery report is malformed: missing verdict or setName fields.',
  },
};

export const AcceptSuccessEligible: Story = {
  args: {
    reportStatus: 'loaded',
    sidecar: sidecarFixture(),
    sidecarVerdict: 'manual',
    effectiveVerdict: 'manual',
    effectiveConfidence: 'low',
    eligibility: ineligibleFixture(),
    acceptSuccessPreview: acceptSuccessPreviewFixture(),
  },
};
