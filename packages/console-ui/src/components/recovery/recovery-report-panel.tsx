import * as React from 'react';
import type {
  ApplyRecoveryResponse,
  ReadSidecarResponse,
  ResumeBuildResponse,
  ResumeEligibilityResponse,
} from '@eforge-build/client/browser';
import { ConfirmAction } from '@/components/recovery/confirm-action';
import { SafeMarkdown } from '@/components/recovery/safe-markdown';
import { AdvancedCascadeSection } from '@/components/recovery/advanced-cascade-section';
import type {
  RecoveryConfidenceValue,
  RecoveryVerdictValue,
} from '@/components/recovery/verdict-chip';

export type ReportStatus = 'loading' | 'loaded' | 'missing' | 'error';

function applyResultMessage(result: ApplyRecoveryResponse): string {
  switch (result.verdict) {
    case 'retry':
      return 'Applied retry: re-queueing the PRD.';
    case 'split':
      return `Applied split: enqueuing the successor PRD${result.successorPrdId ? ` (${result.successorPrdId})` : ''}. When the recovery report records landed partial work, the successor starts from the preserved feature branch while still targeting the original base branch.`;
    case 'abandon':
      return 'Applied abandon: archiving or removing the failed PRD.';
    case 'manual':
      return 'Manual review required: no action taken.';
  }
}

interface SidecarActionConfig {
  triggerLabel: string;
  title: string;
  description: string;
  confirmLabel: string;
}

const SIDECAR_ACTIONS: Record<'retry' | 'split' | 'abandon', SidecarActionConfig> = {
  retry: {
    triggerLabel: 'Re-queue PRD',
    title: 'Re-queue this PRD?',
    description: 'The recovery apply route will move the failed PRD back to the queue.',
    confirmLabel: 'Re-queue',
  },
  split: {
    triggerLabel: 'Enqueue successor PRD',
    title: 'Enqueue the successor PRD?',
    description: 'The recovery apply route will enqueue the suggested successor PRD. If the report records landed partial work, the successor may continue from the preserved feature branch while targeting the original base branch.',
    confirmLabel: 'Enqueue',
  },
  abandon: {
    triggerLabel: 'Archive failed PRD',
    title: 'Archive this failed PRD?',
    description: 'The recovery apply route will archive or remove the failed PRD.',
    confirmLabel: 'Archive',
  },
};

export interface RecoveryReportPanelProps {
  prdId: string | null;
  reportStatus: ReportStatus;
  sidecar: ReadSidecarResponse | null;
  reportError: string | null;
  /** Sidecar verdict, used to select the recommended action. */
  sidecarVerdict: RecoveryVerdictValue | undefined;
  /** Normalized verdict/confidence for the advanced queue-cascade section. */
  effectiveVerdict: RecoveryVerdictValue | undefined;
  effectiveConfidence: RecoveryConfidenceValue | undefined;
  eligibility: ResumeEligibilityResponse | null;
  eligibilityError: string | null;
  applyResult: ApplyRecoveryResponse | null;
  applyError: string | null;
  analysisStarted: boolean;
  analysisError: string | null;
  resumeResult: ResumeBuildResponse | null;
  resumeError: string | null;
  applyingSidecar: boolean;
  startingAnalysis: boolean;
  startingResume: boolean;
  onApplySidecar: () => void;
  onRunAnalysis: () => void;
  onResume: () => void;
  refreshQueue: () => Promise<void> | void;
}

/**
 * Presentational body of the recovery side panel. All data is supplied as
 * props so the layout can be exercised in Storybook without network access;
 * the data-fetching shell lives in QueueRecoveryDialog.
 */
export function RecoveryReportPanel({
  prdId,
  reportStatus,
  sidecar,
  reportError,
  sidecarVerdict,
  effectiveVerdict,
  effectiveConfidence,
  eligibility,
  eligibilityError,
  applyResult,
  applyError,
  analysisStarted,
  analysisError,
  resumeResult,
  resumeError,
  applyingSidecar,
  startingAnalysis,
  startingResume,
  onApplySidecar,
  onRunAnalysis,
  onResume,
  refreshQueue,
}: RecoveryReportPanelProps) {
  return (
    <div className="space-y-4 px-4 py-4">
      {/* Recovery report */}
      <section className="space-y-2">
        <h3 className="text-sm font-medium text-foreground">Recovery report</h3>
        {reportStatus === 'loading' && (
          <p className="text-sm text-muted-foreground">Loading recovery report…</p>
        )}
        {reportStatus === 'error' && (
          <p role="alert" className="text-sm text-destructive">{reportError}</p>
        )}
        {reportStatus === 'missing' && (
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">recovery pending — no recovery report exists yet.</p>
            <ConfirmAction
              triggerLabel="Run recovery analysis"
              title="Run recovery analysis?"
              description="This starts a recovery analysis worker that inspects the failed build and writes a recovery report."
              confirmLabel="Run analysis"
              onConfirm={onRunAnalysis}
              disabled={startingAnalysis || analysisStarted}
            />
            {analysisStarted && (
              <p className="text-xs text-foreground">Recovery analysis started.</p>
            )}
            {analysisError && (
              <p role="alert" className="text-xs text-destructive">{analysisError}</p>
            )}
          </div>
        )}
        {reportStatus === 'loaded' && sidecar && (
          <div className="rounded-md border p-3 text-sm">
            <SafeMarkdown markdown={sidecar.markdown} />
          </div>
        )}
      </section>

      {/* Sidecar verdict action */}
      {reportStatus === 'loaded' && sidecar && (
        <section className="space-y-2">
          <h3 className="text-sm font-medium text-foreground">Recommended recovery action</h3>
          {sidecarVerdict === 'manual' ? (
            <p className="text-sm text-muted-foreground">Manual review required.</p>
          ) : sidecarVerdict && SIDECAR_ACTIONS[sidecarVerdict] ? (
            <ConfirmAction
              triggerLabel={SIDECAR_ACTIONS[sidecarVerdict].triggerLabel}
              title={SIDECAR_ACTIONS[sidecarVerdict].title}
              description={SIDECAR_ACTIONS[sidecarVerdict].description}
              confirmLabel={SIDECAR_ACTIONS[sidecarVerdict].confirmLabel}
              onConfirm={onApplySidecar}
              disabled={applyingSidecar || applyResult !== null}
            />
          ) : null}
          {applyResult && (
            <p className="text-sm text-foreground">{applyResultMessage(applyResult)}</p>
          )}
          {applyError && (
            <p role="alert" className="text-sm text-destructive">{applyError}</p>
          )}
        </section>
      )}

      {/* Compiled-build resume */}
      <section className="space-y-2">
        <h3 className="text-sm font-medium text-foreground">Compiled-build resume</h3>
        {eligibilityError && (
          <p role="alert" className="text-sm text-destructive">{eligibilityError}</p>
        )}
        {eligibility && eligibility.eligible && (
          <ConfirmAction
            triggerLabel="Resume compiled build"
            title="Resume compiled build?"
            description={`Resume the compiled build for ${eligibility.prdId} in set ${eligibility.setName}.`}
            confirmLabel="Resume"
            onConfirm={onResume}
            disabled={startingResume || resumeResult !== null}
          />
        )}
        {eligibility && !eligibility.eligible && (
          <p className="text-sm text-muted-foreground">{eligibility.reason}</p>
        )}
        {resumeResult && (
          <div className="space-y-1 text-sm text-foreground">
            <p>Resume queued</p>
            <p className="text-xs text-muted-foreground">PRD: {resumeResult.prdId}</p>
            <p className="text-xs text-muted-foreground">Set: {resumeResult.setName}</p>
            <p className="text-xs text-muted-foreground">Feature branch: {resumeResult.featureBranch}</p>
            <p className="text-xs text-muted-foreground">Base branch: {resumeResult.baseBranch}</p>
            {resumeResult.profile && <p className="text-xs text-muted-foreground">Profile: {resumeResult.profile}</p>}
          </div>
        )}
        {resumeError && (
          <p role="alert" className="text-sm text-destructive">{resumeError}</p>
        )}
      </section>

      {/* Advanced queue-cascade */}
      {prdId && (
        <AdvancedCascadeSection
          prdId={prdId}
          verdict={effectiveVerdict}
          confidence={effectiveConfidence}
          refreshQueue={refreshQueue}
        />
      )}
    </div>
  );
}
