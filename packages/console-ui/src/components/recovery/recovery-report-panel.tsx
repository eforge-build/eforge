import * as React from 'react';
import type {
  ReadSidecarResponse,
  ResumeEligibilityResponse,
  RecoveryAppliedMetadata,
  AcceptSuccessPreviewResponse,
} from '@eforge-build/client/browser';
import { ConfirmAction } from '@/components/recovery/confirm-action';
import { SafeMarkdown } from '@/components/recovery/safe-markdown';
import { AdvancedCascadeSection } from '@/components/recovery/advanced-cascade-section';
import { AcceptSuccessAction, type AcceptSuccessApplyInput } from '@/components/recovery/accept-success-action';
import type {
  RecoveryConfidenceValue,
  RecoveryVerdictValue,
} from '@/components/recovery/verdict-chip';

export type ReportStatus = 'loading' | 'loaded' | 'missing' | 'error';

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
  /**
   * Durable applied marker from the sidecar. When present the mutating sidecar
   * action is hidden so an already-applied verdict cannot be re-applied (the
   * dialog also transitions to a completion panel in this case).
   */
  appliedMetadata: RecoveryAppliedMetadata | undefined;
  eligibility: ResumeEligibilityResponse | null;
  eligibilityError: string | null;
  applyError: string | null;
  analysisStarted: boolean;
  analysisError: string | null;
  resumeError: string | null;
  applyingSidecar: boolean;
  startingAnalysis: boolean;
  startingResume: boolean;
  /** Read-only accepted-success preview; the action renders only when eligible. */
  acceptSuccessPreview: AcceptSuccessPreviewResponse | null;
  acceptingSuccess: boolean;
  acceptSuccessError: string | null;
  onAcceptSuccess: (input: AcceptSuccessApplyInput) => void;
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
  appliedMetadata,
  eligibility,
  eligibilityError,
  applyError,
  analysisStarted,
  analysisError,
  resumeError,
  applyingSidecar,
  startingAnalysis,
  startingResume,
  acceptSuccessPreview,
  acceptingSuccess,
  acceptSuccessError,
  onAcceptSuccess,
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

      {/* Sidecar verdict action. Hidden once a durable applied marker exists so
          an already-applied verdict cannot be re-applied (the dialog also swaps
          in a completion panel in that case). Success transitions are owned by
          the completion panel, so only the error stays here. */}
      {reportStatus === 'loaded' && sidecar && !appliedMetadata && (
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
              disabled={applyingSidecar}
            />
          ) : null}
          {applyError && (
            <p role="alert" className="text-sm text-destructive">{applyError}</p>
          )}
        </section>
      )}

      {/* Accepted-success action. A focused human recovery path for builds whose
          implementation is acceptable but PRD/acceptance validation failed on a
          bad or unverifiable criterion. Rendered only when the preview reports
          the PRD eligible; success transitions to a completion panel. */}
      {acceptSuccessPreview?.status === 'eligible' && (
        <AcceptSuccessAction
          preview={acceptSuccessPreview}
          applying={acceptingSuccess}
          error={acceptSuccessError}
          onApply={onAcceptSuccess}
        />
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
            disabled={startingResume}
          />
        )}
        {eligibility && !eligibility.eligible && (
          <p className="text-sm text-muted-foreground">{eligibility.reason}</p>
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
