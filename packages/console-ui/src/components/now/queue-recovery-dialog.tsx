import * as React from 'react';
import {
  acceptRecoverySuccess,
  applySidecarRecovery,
  fetchAcceptSuccessPreview,
  fetchRecoverySidecar,
  fetchResumeEligibility,
  startResumeBuild,
  triggerRecoveryAnalysis,
  type AcceptSuccessPreviewResponse,
  type ReadSidecarResponse,
  type ResumeEligibilityResponse,
} from '@eforge-build/client/browser';
import { SheetPanel } from '@/components/ui/sheet-panel';
import {
  RecoveryVerdictChip,
  asConfidence,
  asVerdict,
} from '@/components/recovery/verdict-chip';
import {
  RecoveryReportPanel,
  type ReportStatus,
} from '@/components/recovery/recovery-report-panel';
import {
  RecoveryCompletionPanel,
  type RecoveryCompletion,
} from '@/components/recovery/recovery-completion-panel';
import type { AcceptSuccessApplyInput } from '@/components/recovery/accept-success-action';

interface QueueRecoveryDialogProps {
  open: boolean;
  prdId: string | null;
  prdTitle?: string;
  /** Recovery verdict from the queue row, used before the sidecar loads. */
  verdict?: string;
  /** Recovery confidence from the queue row, used before the sidecar loads. */
  confidence?: string;
  onOpenChange: (open: boolean) => void;
  refreshQueue: () => Promise<void> | void;
}

function is404(err: unknown): boolean {
  return err instanceof Error && /\(404\)/.test(err.message);
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function QueueRecoveryDialog({
  open,
  prdId,
  prdTitle,
  verdict,
  confidence,
  onOpenChange,
  refreshQueue,
}: QueueRecoveryDialogProps) {
  const [sidecar, setSidecar] = React.useState<ReadSidecarResponse | null>(null);
  const [reportStatus, setReportStatus] = React.useState<ReportStatus>('loading');
  const [reportError, setReportError] = React.useState<string | null>(null);
  const [eligibility, setEligibility] = React.useState<ResumeEligibilityResponse | null>(null);
  const [eligibilityError, setEligibilityError] = React.useState<string | null>(null);
  const [applyError, setApplyError] = React.useState<string | null>(null);
  const [analysisStarted, setAnalysisStarted] = React.useState(false);
  const [analysisError, setAnalysisError] = React.useState<string | null>(null);
  const [resumeError, setResumeError] = React.useState<string | null>(null);
  const [applyingSidecar, setApplyingSidecar] = React.useState(false);
  const [startingAnalysis, setStartingAnalysis] = React.useState(false);
  const [startingResume, setStartingResume] = React.useState(false);
  const [acceptSuccessPreview, setAcceptSuccessPreview] =
    React.useState<AcceptSuccessPreviewResponse | null>(null);
  const [acceptingSuccess, setAcceptingSuccess] = React.useState(false);
  const [acceptSuccessError, setAcceptSuccessError] = React.useState<string | null>(null);
  // Stable terminal panel shown after a queue-affecting mutation succeeds or a
  // sidecar/preview reports durable applied state.
  const [completion, setCompletion] = React.useState<RecoveryCompletion | null>(null);

  React.useEffect(() => {
    if (!open || !prdId) return;
    let cancelled = false;
    setSidecar(null);
    setReportStatus('loading');
    setReportError(null);
    setEligibility(null);
    setEligibilityError(null);
    setApplyError(null);
    setAnalysisStarted(false);
    setAnalysisError(null);
    setResumeError(null);
    setApplyingSidecar(false);
    setStartingAnalysis(false);
    setStartingResume(false);
    setAcceptSuccessPreview(null);
    setAcceptingSuccess(false);
    setAcceptSuccessError(null);
    setCompletion(null);

    fetchRecoverySidecar({ prdId })
      .then((response) => {
        if (cancelled) return;
        // A parseable but old/malformed sidecar may be missing verdict/summary.
        // Narrow before treating it as loaded so render never crashes.
        const verdictValue = response?.json?.verdict?.verdict;
        const setNameValue = response?.json?.summary?.setName;
        if (typeof verdictValue !== 'string' || typeof setNameValue !== 'string') {
          setReportStatus('error');
          setReportError('Recovery report is malformed: missing verdict or summary fields.');
          return;
        }
        setSidecar(response);
        setReportStatus('loaded');
        // A durable applied marker means the verdict was already applied: show a
        // completion panel rather than the mutating action.
        const applied = response.json.applied;
        if (applied) {
          setCompletion((prev) => prev ?? { kind: 'already-applied', applied });
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (is404(err)) {
          setReportStatus('missing');
        } else {
          setReportStatus('error');
          setReportError(errorMessage(err));
        }
      });

    fetchResumeEligibility({ prdId })
      .then((response) => {
        if (!cancelled) setEligibility(response);
      })
      .catch((err: unknown) => {
        if (!cancelled) setEligibilityError(errorMessage(err));
      });

    fetchAcceptSuccessPreview({ prdId })
      .then((response) => {
        if (cancelled) return;
        setAcceptSuccessPreview(response);
        // An already-applied accepted-success preview is itself a completion.
        if (response.status === 'already-applied' && response.applied) {
          const applied = response.applied;
          setCompletion((prev) => prev ?? { kind: 'already-applied', applied });
        }
      })
      .catch((err: unknown) => {
        // Preview is best-effort: a failure just hides the accepted-success
        // action. It must not block the recovery report or resume flows.
        console.error('Failed to load accepted-success preview:', err);
      });

    return () => {
      cancelled = true;
    };
  }, [open, prdId]);

  const sidecarVerdict = sidecar?.json.verdict.verdict;
  const effectiveVerdict = asVerdict(sidecarVerdict ?? verdict);
  const effectiveConfidence = asConfidence(sidecar?.json.verdict.confidence ?? confidence);
  const setName = sidecar?.json.summary.setName;
  const appliedMetadata = sidecar?.json.applied;

  const handleApplySidecar = async () => {
    if (!prdId || applyingSidecar) return;
    setApplyingSidecar(true);
    setApplyError(null);
    try {
      const response = await applySidecarRecovery({ prdId });
      // The mutation succeeded; a refresh failure is secondary feedback only.
      let refreshError: string | undefined;
      try {
        await refreshQueue();
      } catch (err: unknown) {
        refreshError = errorMessage(err);
      }
      setCompletion({ kind: 'sidecar-apply', result: response, refreshError });
    } catch (err: unknown) {
      setApplyError(errorMessage(err));
    } finally {
      setApplyingSidecar(false);
    }
  };

  const handleRunAnalysis = async () => {
    if (!prdId || startingAnalysis) return;
    setStartingAnalysis(true);
    setAnalysisError(null);
    setAnalysisStarted(false);
    try {
      await triggerRecoveryAnalysis({ setName: setName ?? prdId, prdId });
      setAnalysisStarted(true);
    } catch (err: unknown) {
      setAnalysisError(errorMessage(err));
    } finally {
      setStartingAnalysis(false);
    }
  };

  const handleResume = async () => {
    if (!prdId || startingResume) return;
    setStartingResume(true);
    setResumeError(null);
    try {
      // Both `queued` and `already-queued` resolve (the helper only rejects on a
      // real failure), so any resolved response is a success completion.
      const response = await startResumeBuild({ prdId, setName: eligibility?.setName });
      let refreshError: string | undefined;
      try {
        await refreshQueue();
      } catch (err: unknown) {
        refreshError = errorMessage(err);
      }
      setCompletion({ kind: 'resume', result: response, refreshError });
    } catch (err: unknown) {
      setResumeError(errorMessage(err));
    } finally {
      setStartingResume(false);
    }
  };

  const handleAcceptSuccess = async (input: AcceptSuccessApplyInput) => {
    if (!prdId || acceptingSuccess) return;
    setAcceptingSuccess(true);
    setAcceptSuccessError(null);
    try {
      const response = await acceptRecoverySuccess({ prdId, ...input });
      let refreshError: string | undefined;
      try {
        await refreshQueue();
      } catch (err: unknown) {
        refreshError = errorMessage(err);
      }
      setCompletion({ kind: 'accepted-success', result: response, refreshError });
    } catch (err: unknown) {
      setAcceptSuccessError(errorMessage(err));
    } finally {
      setAcceptingSuccess(false);
    }
  };

  return (
    <SheetPanel
      open={open}
      onClose={() => onOpenChange(false)}
      className="w-full sm:max-w-3xl"
      title={
        <span className="flex items-center gap-2">
          <span>Recover failed build</span>
          {effectiveVerdict && effectiveConfidence && (
            <RecoveryVerdictChip verdict={effectiveVerdict} confidence={effectiveConfidence} />
          )}
        </span>
      }
      description={
        <span>
          {prdTitle ?? prdId ?? 'the selected failed PRD'}
          {prdId && <span className="ml-2 text-text-dim">{prdId}</span>}
        </span>
      }
    >
      {completion ? (
        <RecoveryCompletionPanel completion={completion} onOpenChange={onOpenChange} />
      ) : (
        <RecoveryReportPanel
          prdId={prdId}
          reportStatus={reportStatus}
          sidecar={sidecar}
          reportError={reportError}
          sidecarVerdict={sidecarVerdict}
          effectiveVerdict={effectiveVerdict}
          effectiveConfidence={effectiveConfidence}
          appliedMetadata={appliedMetadata}
          eligibility={eligibility}
          eligibilityError={eligibilityError}
          applyError={applyError}
          analysisStarted={analysisStarted}
          analysisError={analysisError}
          resumeError={resumeError}
          applyingSidecar={applyingSidecar}
          startingAnalysis={startingAnalysis}
          startingResume={startingResume}
          acceptSuccessPreview={acceptSuccessPreview}
          acceptingSuccess={acceptingSuccess}
          acceptSuccessError={acceptSuccessError}
          onAcceptSuccess={handleAcceptSuccess}
          onApplySidecar={handleApplySidecar}
          onRunAnalysis={handleRunAnalysis}
          onResume={handleResume}
          refreshQueue={refreshQueue}
        />
      )}
    </SheetPanel>
  );
}
