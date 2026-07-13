import * as React from 'react';
import type {
  ReadSidecarResponse,
  ContinueRepairEligibilityResponse,
  RecoveryAppliedMetadata,
  AcceptSuccessPreviewResponse,
  QueueItem,
} from '@eforge-build/client/browser';
import { ConfirmAction } from '@/components/recovery/confirm-action';
import { SafeMarkdown } from '@/components/recovery/safe-markdown';
import { AdvancedCascadeSection } from '@/components/recovery/advanced-cascade-section';
import { AcceptSuccessAction, type AcceptSuccessApplyInput } from '@/components/recovery/accept-success-action';
import { CompileScopeContextOptions } from '@/components/recovery/compile-scope-context-options';
import { formatQueueDispatchFailure, formatQueueDispatchFailureTimestamp } from '@/lib/selectors/queue-dispatch-failure';
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

type SidecarActionVerdict = 'retry' | 'continue-repair' | 'abandon';

const SIDECAR_ACTIONS: Record<SidecarActionVerdict, SidecarActionConfig> = {
  retry: {
    triggerLabel: 'Retry from scratch',
    title: 'Retry this PRD from scratch?',
    description: 'The recovery apply route will move the failed PRD back to the queue for a clean rebuild.',
    confirmLabel: 'Retry',
  },
  'continue-repair': {
    triggerLabel: 'Continue and repair build',
    title: 'Continue and repair this build?',
    description: 'Queue the failed PRD for scheduler-owned continue-and-repair from preserved compiled artifacts.',
    confirmLabel: 'Continue build',
  },
  abandon: {
    triggerLabel: 'Archive failed PRD',
    title: 'Archive this failed PRD?',
    description: 'The recovery apply route will archive or remove the failed PRD.',
    confirmLabel: 'Archive',
  },
};

function appliedActionLabel(applied: RecoveryAppliedMetadata): string {
  return applied.action === 'accepted-success' ? 'Accepted success' : SIDECAR_ACTIONS[applied.action].triggerLabel;
}

function isPrimarySidecarActionVerdict(verdict: RecoveryVerdictValue | undefined): verdict is Exclude<SidecarActionVerdict, 'retry'> {
  return verdict === 'continue-repair' || verdict === 'abandon';
}

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
  dispatchFailure?: QueueItem['dispatchFailure'];
  /**
   * Durable applied marker from the sidecar. When present the mutating sidecar
   * action is hidden so an already-applied verdict cannot be re-applied (the
   * dialog also transitions to a completion panel in this case).
   */
  appliedMetadata: RecoveryAppliedMetadata | undefined;
  eligibility: ContinueRepairEligibilityResponse | null;
  eligibilityError: string | null;
  applyError: string | null;
  analysisStarted: boolean;
  analysisError: string | null;
  continueRepairError: string | null;
  applyingSidecar: boolean;
  startingAnalysis: boolean;
  startingContinueRepair: boolean;
  /** Read-only accepted-success preview; the action renders only when eligible. */
  acceptSuccessPreview: AcceptSuccessPreviewResponse | null;
  acceptingSuccess: boolean;
  acceptSuccessError: string | null;
  onAcceptSuccess: (input: AcceptSuccessApplyInput) => void;
  onApplySidecar: () => void;
  onRunAnalysis: () => void;
  onContinueRepair: () => void;
  refreshQueue: () => Promise<void> | void;
  queueRecoveryActive?: boolean;
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
  dispatchFailure,
  appliedMetadata,
  eligibility,
  eligibilityError,
  applyError,
  analysisStarted,
  analysisError,
  continueRepairError,
  applyingSidecar,
  startingAnalysis,
  startingContinueRepair,
  acceptSuccessPreview,
  acceptingSuccess,
  acceptSuccessError,
  onAcceptSuccess,
  onApplySidecar,
  onRunAnalysis,
  onContinueRepair,
  refreshQueue,
  queueRecoveryActive = true,
}: RecoveryReportPanelProps) {
  const liveContinueRepairRecommended = Boolean(
    eligibility?.eligible && eligibility.partial !== true,
  );
  const recommendedVerdict: RecoveryVerdictValue | undefined = liveContinueRepairRecommended
    ? 'continue-repair'
    : sidecarVerdict;
  // Queue recovery owns retries: its automatic analysis can safely promote a
  // simple retry or retain the detailed cascade controls. Never compete with it
  // using the legacy sidecar retry mutation.
  const recommendedActionVerdict = isPrimarySidecarActionVerdict(recommendedVerdict) ? recommendedVerdict : undefined;
  const recommendedContinueRepair = recommendedActionVerdict === 'continue-repair';
  const continueRepairActionInRecommendation = Boolean(
    reportStatus === 'loaded' && sidecar && !appliedMetadata && recommendedContinueRepair,
  );
  const showContinueRepairPreflightAction = Boolean(
    liveContinueRepairRecommended && !continueRepairActionInRecommendation,
  );

  const dispatchFailureDetail = formatQueueDispatchFailure(dispatchFailure);
  const dispatchFailureTimestamp = formatQueueDispatchFailureTimestamp(dispatchFailure);

  return (
    <div className="space-y-4 px-4 py-4">
      {dispatchFailure && dispatchFailureDetail && (
        <section className="space-y-1 rounded-md border border-yellow/30 bg-yellow/10 p-3">
          <h3 className="text-sm font-medium text-foreground">Pre-session dispatch blocker</h3>
          <p className="text-sm text-muted-foreground">{dispatchFailureDetail}</p>
          <p className="text-xs text-muted-foreground">Stage: {dispatchFailure.stage}{dispatchFailureTimestamp ? ` · ${dispatchFailureTimestamp}` : ''}</p>
        </section>
      )}
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

      {reportStatus === 'loaded' && sidecar?.json.autoResume && (
        <section className="space-y-1 rounded-md border border-primary/30 bg-primary/10 p-3">
          <h3 className="text-sm font-medium text-foreground">Automatic recovery decision</h3>
          <p className="text-sm text-muted-foreground">
            Automatic continue-and-repair attempts: {sidecar.json.autoResume.attempts ?? 0}
            {sidecar.json.autoResume.stoppedReason ? ` · stopped: ${sidecar.json.autoResume.stoppedReason}` : ''}
          </p>
          {sidecar.json.autoResume.lastAttemptAt && (
            <p className="text-xs text-muted-foreground">Last automatic attempt: {sidecar.json.autoResume.lastAttemptAt}</p>
          )}
        </section>
      )}

      {appliedMetadata && (
        <section className="space-y-1 rounded-md border p-3">
          <h3 className="text-sm font-medium text-foreground">Applied recovery provenance</h3>
          <p className="text-sm text-muted-foreground">
            {appliedActionLabel(appliedMetadata)} was already applied. Manual controls below remain available when the backend exposes them.
          </p>
        </section>
      )}

      {reportStatus === 'loaded' && sidecar && (
        <CompileScopeContextOptions options={sidecar.json.recoveryOptions} />
      )}

      {/* Sidecar verdict action. Hidden once a durable applied marker exists so
          an already-applied verdict cannot be re-applied (the dialog also swaps
          in a completion panel in that case). Success transitions are owned by
          the completion panel, so only the error stays here. */}
      {reportStatus === 'loaded' && sidecar && !appliedMetadata && (
        <section className="space-y-2">
          <h3 className="text-sm font-medium text-foreground">Recommended recovery action</h3>
          {recommendedVerdict === 'manual' ? (
            <p className="text-sm text-muted-foreground">Manual review / manual replanning required.</p>
          ) : recommendedActionVerdict ? (
            <ConfirmAction
              triggerLabel={SIDECAR_ACTIONS[recommendedActionVerdict].triggerLabel}
              title={SIDECAR_ACTIONS[recommendedActionVerdict].title}
              description={SIDECAR_ACTIONS[recommendedActionVerdict].description}
              confirmLabel={SIDECAR_ACTIONS[recommendedActionVerdict].confirmLabel}
              onConfirm={recommendedContinueRepair ? onContinueRepair : onApplySidecar}
              disabled={recommendedContinueRepair ? startingContinueRepair : applyingSidecar}
            />
          ) : null}
          {continueRepairActionInRecommendation && continueRepairError ? (
            <p role="alert" className="text-sm text-destructive">{continueRepairError}</p>
          ) : applyError ? (
            <p role="alert" className="text-sm text-destructive">{applyError}</p>
          ) : null}
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

      {/* Continue-and-repair eligibility */}
      <section className="space-y-2">
        <h3 className="text-sm font-medium text-foreground">Continue-and-repair eligibility</h3>
        {eligibilityError && (
          <p role="alert" className="text-sm text-destructive">{eligibilityError}</p>
        )}
        {eligibility && eligibility.eligible && !showContinueRepairPreflightAction && (
          <p className="text-sm text-muted-foreground">Preserved compiled artifacts are eligible for continue-and-repair.</p>
        )}
        {showContinueRepairPreflightAction && eligibility?.eligible && (
          <ConfirmAction
            triggerLabel="Continue and repair build"
            title="Continue and repair this build?"
            description={`Continue and repair the build for ${eligibility.prdId} in set ${eligibility.setName}.`}
            confirmLabel="Continue build"
            onConfirm={onContinueRepair}
            disabled={startingContinueRepair}
          />
        )}
        {eligibility && !eligibility.eligible && (
          <p className="text-sm text-muted-foreground">{eligibility.reason}</p>
        )}
        {continueRepairError && !continueRepairActionInRecommendation && (
          <p role="alert" className="text-sm text-destructive">{continueRepairError}</p>
        )}
      </section>

      {/* Advanced queue-cascade */}
      {prdId && (
        <AdvancedCascadeSection
          prdId={prdId}
          verdict={effectiveVerdict}
          confidence={effectiveConfidence}
          refreshQueue={refreshQueue}
          active={queueRecoveryActive && prdId !== null}
        />
      )}
    </div>
  );
}
