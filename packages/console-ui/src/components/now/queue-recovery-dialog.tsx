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
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  RecoveryVerdictChip,
  type RecoveryConfidenceValue,
  type RecoveryVerdictValue,
} from '@/components/recovery/verdict-chip';
import { ConfirmAction } from '@/components/recovery/confirm-action';
import { SafeMarkdown } from '@/components/recovery/safe-markdown';
import { AdvancedCascadeSection } from '@/components/recovery/advanced-cascade-section';

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

type ReportStatus = 'loading' | 'loaded' | 'missing' | 'error';

const VERDICT_VALUES: RecoveryVerdictValue[] = ['retry', 'split', 'abandon', 'manual'];
const CONFIDENCE_VALUES: RecoveryConfidenceValue[] = ['low', 'medium', 'high'];

function asVerdict(value: string | undefined): RecoveryVerdictValue | undefined {
  return value && (VERDICT_VALUES as string[]).includes(value) ? (value as RecoveryVerdictValue) : undefined;
}

function asConfidence(value: string | undefined): RecoveryConfidenceValue | undefined {
  return value && (CONFIDENCE_VALUES as string[]).includes(value) ? (value as RecoveryConfidenceValue) : undefined;
}

function is404(err: unknown): boolean {
  return err instanceof Error && /\(404\)/.test(err.message);
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function applyResultMessage(result: ApplyRecoveryResponse): string {
  switch (result.verdict) {
    case 'retry':
      return 'Applied retry: re-queueing the PRD.';
    case 'split':
      return `Applied split: enqueuing the successor PRD${result.successorPrdId ? ` (${result.successorPrdId})` : ''}.`;
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
    description: 'The recovery apply route will enqueue the suggested successor PRD.',
    confirmLabel: 'Enqueue',
  },
  abandon: {
    triggerLabel: 'Archive failed PRD',
    title: 'Archive this failed PRD?',
    description: 'The recovery apply route will archive or remove the failed PRD.',
    confirmLabel: 'Archive',
  },
};

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
    } catch (err: unknown) {
      setResumeError(errorMessage(err));
    } finally {
      setStartingResume(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span>Recover failed build</span>
            {effectiveVerdict && effectiveConfidence && (
              <RecoveryVerdictChip verdict={effectiveVerdict} confidence={effectiveConfidence} />
            )}
          </DialogTitle>
          <DialogDescription>
            {prdTitle ?? prdId ?? 'the selected failed PRD'}
            {prdId && <span className="ml-2 text-xs text-muted-foreground">{prdId}</span>}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
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
                  onConfirm={handleRunAnalysis}
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
              <div className="rounded-md border p-3 text-xs">
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
                  onConfirm={handleApplySidecar}
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
                onConfirm={handleResume}
                disabled={startingResume || resumeResult !== null}
              />
            )}
            {eligibility && !eligibility.eligible && (
              <p className="text-sm text-muted-foreground">{eligibility.reason}</p>
            )}
            {resumeResult && (
              <div className="space-y-1 text-sm text-foreground">
                <p>Resume started</p>
                <p className="text-xs text-muted-foreground">Session: {resumeResult.sessionId}</p>
                <p className="text-xs text-muted-foreground">PID: {resumeResult.pid}</p>
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

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
