import type { Meta, StoryObj } from '@storybook/react-vite';
import type {
  ReadSidecarResponse,
  ResumeEligibilityResponse,
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
 *
 * The "loaded" markdown deliberately mirrors a real recovery report: wide
 * tables (Plans, Final Review Issues) and a fenced "Suggested Successor PRD"
 * block with long lines — the exact content that clipped in the old modal.
 */

const REPORT_MARKDOWN = `# Recovery Analysis: add-queued-prd-priority-and-removal-controls

Generated: 2026-06-04T18:22:50.611Z  Set: add-queued-prd-priority-and-removal-controls  Feature Branch: eforge/add-queued-prd-priority-and-removal-controls

## Verdict

**SPLIT** (confidence: high)

**Verdict Source:** analyst

## Rationale

Meaningful work was already merged before the failure: plan-01-core-queue-control landed the client route/API surface and plan-03-console-queue-controls landed the Console queue actions. The failure is isolated to plan-02-host-queue-controls, which failed review with concrete, reviewer-confirmed race-safety blockers. A split is preferable to retrying the full PRD because the landed core and Console work should not be rebuilt.

## Plans

| Plan | Status | Error |
| --- | --- | --- |
| plan-01-core-queue-control | completed | |
| plan-03-console-queue-controls | completed | |
| plan-02-host-queue-controls | failed | 4 blocking issue outcome(s) remain after 1 review round(s) (4 unresolved, 0 newly introduced) |
| plan-04-queue-control-docs | blocked | Blocked by failed dependency: plan-02-host-queue-controls |

## Failing Plans

| Plan | Error |
| --- | --- |
| plan-02-host-queue-controls | 4 blocking issue outcome(s) remain after 1 review round(s) (4 unresolved, 0 newly introduced) |

## Review Failure Details

Plan ID: plan-02-host-queue-controls

### Final Review Issues

| Severity | Category | File | Line | Description |
| --- | --- | --- | --- | --- |
| blocking | correctness | packages/engine/src/queue/control.ts | 142 | The new Node client helper \`apiUpdateQueuePriority\` exposes priority as a required field but the daemon route treats it as optional, so stale located PRD data can be written after a concurrent claim. |
| blocking | race-safety | packages/engine/src/queue/control.ts | 210 | Priority updates must operate on the current existing file and fail if the file moved after claim. |
| blocking | race-safety | packages/engine/src/queue/control.ts | 268 | Waiting or other movable item mutations must avoid \`writeFile\` recreation after disappearance. |
| blocking | correctness | packages/engine/src/queue/control.ts | 301 | Root removal must confirm the file still exists after claim or use non-force removal. |

## Risks

- The landed core queue-control helper may still have race-safety defects around stale located PRD data, vanished files, and force removal.
- Rejected review suggestions attempted to change public client helper shapes; successor work must avoid re-breaking the contract.
- Docs/reference generation may drift after CLI/MCP/Pi tool additions unless regenerated and checked.

## Suggested Successor PRD

\`\`\`markdown
<![CDATA[
# Complete Host Queue Controls, Race-Safety Fixes, and Docs

## Overview

Continue the partially completed "Add Queued PRD Priority and Removal Controls" work on the preserved feature branch.

The previous build session already merged:
- \`plan-01-core-queue-control\`: core client-owned route/API surface, daemon routes, engine wiring.
- \`plan-03-console-queue-controls\`: Console Now queue priority and removal actions.

This successor PRD covers the remaining work:
- \`plan-02-host-queue-controls\`: finish CLI, Claude/MCP, and Pi host queue controls.
- Resolve the reviewer-confirmed queue-control race-safety blockers discovered while building plan-02.
- \`plan-04-queue-control-docs\`: update human and generated docs/reference artifacts.

## Scope

In scope:
- Finish \`plan-02-host-queue-controls\`.
- Add \`eforge queue priority <prdId> <priority>\`.
- Add \`eforge queue remove <prdId>\`.
]]>
\`\`\`
`;

function sidecarFixture(): ReadSidecarResponse {
  return {
    markdown: REPORT_MARKDOWN,
    json: {
      schemaVersion: 3,
      generatedAt: '2026-06-04T18:22:50.611Z',
      prdId: 'add-queued-prd-priority-and-removal-controls',
      setName: 'add-queued-prd-priority-and-removal-controls',
      verdict: { verdict: 'split', confidence: 'high' },
      report: {
        operatorSummary: 'Meaningful work was already merged before the failure.',
        recommendedAction: 'Enqueue the suggested successor PRD.',
        keyEvidence: ['plan-02-host-queue-controls failed review'],
        completedWork: ['Core and Console queue-control work landed.'],
        remainingWork: ['Finish host queue controls and docs.'],
        risks: ['Race-safety defects may remain.'],
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
    },
  } as unknown as ReadSidecarResponse;
}

function ineligibleFixture(): ResumeEligibilityResponse {
  return {
    prdId: 'add-queued-prd-priority-and-removal-controls',
    setName: 'add-queued-prd-priority-and-removal-controls',
    featureBranch: 'eforge/add-queued-prd-priority-and-removal-controls',
    eligible: false,
    reason: 'No compiled build artifacts found.',
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
            <RecoveryVerdictChip verdict="split" confidence="high" />
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
    resumeError: null,
    applyingSidecar: false,
    startingAnalysis: false,
    startingResume: false,
    acceptSuccessPreview: null,
    acceptingSuccess: false,
    acceptSuccessError: null,
    onAcceptSuccess: () => undefined,
    onApplySidecar: () => undefined,
    onRunAnalysis: () => undefined,
    onResume: () => undefined,
    refreshQueue: () => undefined,
  },
} satisfies Meta<typeof RecoveryReportPanel>;

export default meta;

type Story = StoryObj<typeof meta>;

export const Loaded: Story = {
  args: {
    reportStatus: 'loaded',
    sidecar: sidecarFixture(),
    sidecarVerdict: 'split',
    effectiveVerdict: 'split',
    effectiveConfidence: 'high',
    eligibility: ineligibleFixture(),
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
