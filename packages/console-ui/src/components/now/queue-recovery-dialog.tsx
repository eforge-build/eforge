import * as React from 'react';
import {
  applySidecarRecovery,
  fetchRecoverySidecar,
  fetchResumeEligibility,
  startResumeBuild,
  triggerRecoveryAnalysis,
  type ApplyRecoveryResponse,
  type ReadSidecarResponse,
  type ResumeBuildResponse,
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
  const [applyResult, setApplyResult] = React.useState<ApplyRecoveryResponse | null>(null);
  const [applyError, setApplyError] = React.useState<string | null>(null);
  const [analysisStarted, setAnalysisStarted] = React.useState(false);
  const [analysisError, setAnalysisError] = React.useState<string | null>(null);
  const [resumeResult, setResumeResult] = React.useState<ResumeBuildResponse | null>(null);
  const [resumeError, setResumeError] = React.useState<string | null>(null);
  const [applyingSidecar, setApplyingSidecar] = React.useState(false);
  const [startingAnalysis, setStartingAnalysis] = React.useState(false);
  const [startingResume, setStartingResume] = React.useState(false);

  React.useEffect(() => {
    if (!open || !prdId) return;
    let cancelled = false;
    setSidecar(null);
    setReportStatus('loading');
    setReportError(null);
    setEligibility(null);
    setEligibilityError(null);
    setApplyResult(null);
    setApplyError(null);
    setAnalysisStarted(false);
    setAnalysisError(null);
    setResumeResult(null);
    setResumeError(null);
    setApplyingSidecar(false);
    setStartingAnalysis(false);
    setStartingResume(false);

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

    return () => {
      cancelled = true;
    };
  }, [open, prdId]);

  const sidecarVerdict = sidecar?.json.verdict.verdict;
  const effectiveVerdict = asVerdict(sidecarVerdict ?? verdict);
  const effectiveConfidence = asConfidence(sidecar?.json.verdict.confidence ?? confidence);
  const setName = sidecar?.json.summary.setName;

  const handleApplySidecar = async () => {
    if (!prdId || applyingSidecar) return;
    setApplyingSidecar(true);
    setApplyError(null);
    setApplyResult(null);
    try {
      const response = await applySidecarRecovery({ prdId });
      setApplyResult(response);
      await refreshQueue();
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
    setResumeResult(null);
    try {
      const response = await startResumeBuild({ prdId, setName: eligibility?.setName });
      setResumeResult(response);
      try {
        await refreshQueue();
      } catch (err: unknown) {
        console.error('Failed to refresh queue after resume build was queued:', err);
      }
    } catch (err: unknown) {
      setResumeError(errorMessage(err));
    } finally {
      setStartingResume(false);
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
      <RecoveryReportPanel
        prdId={prdId}
        reportStatus={reportStatus}
        sidecar={sidecar}
        reportError={reportError}
        sidecarVerdict={sidecarVerdict}
        effectiveVerdict={effectiveVerdict}
        effectiveConfidence={effectiveConfidence}
        eligibility={eligibility}
        eligibilityError={eligibilityError}
        applyResult={applyResult}
        applyError={applyError}
        analysisStarted={analysisStarted}
        analysisError={analysisError}
        resumeResult={resumeResult}
        resumeError={resumeError}
        applyingSidecar={applyingSidecar}
        startingAnalysis={startingAnalysis}
        startingResume={startingResume}
        onApplySidecar={handleApplySidecar}
        onRunAnalysis={handleRunAnalysis}
        onResume={handleResume}
        refreshQueue={refreshQueue}
      />
    </SheetPanel>
  );
}
