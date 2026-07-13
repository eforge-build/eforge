import * as React from 'react';
import {
  QUEUE_RECOVERY_STRATEGY_RETRY_AND_REACTIVATE,
  applyQueueRecovery,
  fetchQueueRecoveryAnalysis,
  type QueueRecoveryAnalyzeResponse,
  type QueueRecoveryApplyResponse,
  type QueueRecoveryNotice,
  type QueueRecoveryOperation,
  type QueueRecoveryOperationResult,
} from '@eforge-build/client/browser';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ConfirmAction } from './confirm-action';
import { QueueCascadeRepairPanel } from './queue-cascade-repair-panel';
import { deriveCascadeRepairState, isSimpleQueueRetry, type RemovalSelection, type StackParentSelection } from './queue-cascade-repair-state';

// --- eforge:region cascade-recovery-contracts-and-labels ---
interface AdvancedCascadeSectionProps {
  prdId: string;
  /** Sidecar verdict, used to warn when queue-cascade may contradict guidance. */
  verdict?: string;
  /** Sidecar confidence, used to warn on low-confidence verdicts. */
  confidence?: string;
  refreshQueue: () => Promise<void> | void;
  /** Starts analysis only while the containing recovery dialog is open. */
  active: boolean;
}

function operationLabel(operation: QueueRecoveryOperation): string {
  if (operation.kind === 'move-prd') {
    return `${operation.prdId}: ${operation.expectedSourceLocation} → ${operation.targetLocation} — ${operation.reason}`;
  }
  return `${operation.prdId}: remove recovery sidecars from ${operation.expectedSourceLocation} — ${operation.reason}`;
}

function noticeLabel(notice: QueueRecoveryNotice): string {
  return notice.prdId ? `${notice.message} (${notice.prdId})` : notice.message;
}

function operationResultLabel(result: QueueRecoveryOperationResult): string {
  return `${result.operation.prdId}: ${result.status}${result.message ? ` — ${result.message}` : ''}`;
}

function NoticeList({ notices, empty }: { notices: QueueRecoveryNotice[]; empty?: string }) {
  if (notices.length === 0) {
    return empty ? <p className="text-xs text-muted-foreground">{empty}</p> : null;
  }
  return (
    <ul className="space-y-1">
      {notices.map((notice) => (
        <li key={`${notice.code}-${notice.prdId ?? ''}-${notice.message}`} className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">{notice.code}</span>: {noticeLabel(notice)}
        </li>
      ))}
    </ul>
  );
}
// --- eforge:endregion cascade-recovery-contracts-and-labels ---

/**
 * Advanced queue-cascade recovery. This is the lower-level repair operation that
 * moves the failed upstream back to the queue and may reactivate skipped
 * descendants. Simple retries are promoted to the dialog's primary action.
 */
export function AdvancedCascadeSection({ prdId, verdict, confidence, refreshQueue, active }: AdvancedCascadeSectionProps) {
  // --- eforge:region cascade-recovery-analysis-lifecycle ---
  const [open, setOpen] = React.useState(false);
  const [analysis, setAnalysis] = React.useState<QueueRecoveryAnalyzeResponse | null>(null);
  const [analyzedPrdId, setAnalyzedPrdId] = React.useState<string | null>(null);
  const [applyResult, setApplyResult] = React.useState<QueueRecoveryApplyResponse | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [applying, setApplying] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [selectedRemovals, setSelectedRemovals] = React.useState<RemovalSelection>({});
  const [selectedStackParents, setSelectedStackParents] = React.useState<StackParentSelection>({});
  const generationRef = React.useRef(0);
  const currentPrdIdRef = React.useRef(prdId);
  const activeRef = React.useRef(active);
  currentPrdIdRef.current = prdId;
  activeRef.current = active;

  React.useEffect(() => {
    ++generationRef.current;
    if (!active) {
      setApplying(false);
      setAnalysis(null);
      setAnalyzedPrdId(null);
      setApplyResult(null);
      setError(null);
      setSelectedRemovals({});
      setSelectedStackParents({});
      setOpen(false);
      return;
    }
    // Already have analysis for the current PRD — nothing to refetch.
    if (analysis && analyzedPrdId === prdId) return;
    // Capture this request's PRD so a stale completion (from a previous prdId
    // whose fetch was still in flight) is ignored rather than applied. We do NOT
    // guard on `loading`: when `prdId` changes out from under an in-flight
    // request, the old request is cancelled but its `finally` cannot clear
    // `loading`, so guarding on it would strand the section forever. Always
    // start the new request and reset stale state.
    const requestPrdId = prdId;
    let cancelled = false;
    setApplying(false);
    setLoading(true);
    setError(null);
    // Discard every PRD-specific state value before requesting the replacement
    // analysis, so neither stale selections nor a stale confirmation can leak.
    setAnalysis(null);
    setAnalyzedPrdId(null);
    setApplyResult(null);
    setSelectedRemovals({});
    setSelectedStackParents({});
    setOpen(false);
    fetchQueueRecoveryAnalysis({
      selectedPrdId: requestPrdId,
      strategy: QUEUE_RECOVERY_STRATEGY_RETRY_AND_REACTIVATE,
    })
      .then((response) => {
        if (!cancelled) {
          setAnalysis(response);
          setAnalyzedPrdId(requestPrdId);
          setSelectedRemovals({});
          setSelectedStackParents({});
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // `loading`/`analysis`/`analyzedPrdId` are intentionally excluded from deps:
    // including them re-runs this effect on `setLoading(true)`/`setAnalysis(null)`,
    // whose cleanup cancels the in-flight fetch. The guard above reads their
    // latest values from the closure and refetches when `prdId` changes.
  }, [active, prdId]);
  // --- eforge:endregion cascade-recovery-analysis-lifecycle ---

  // --- eforge:region cascade-recovery-application ---
  const blockers = analysis?.blockers ?? [];
  const warnings = analysis?.warnings ?? [];
  const applyBlockers = applyResult?.blockers ?? [];
  const repairState = analysis ? deriveCascadeRepairState(analysis, selectedRemovals, selectedStackParents, applyResult) : null;
  const skippedDescendants = analysis?.nodes.filter((node) => node.role === 'skipped-descendant') ?? [];
  const simpleRetry = analysis ? isSimpleQueueRetry(analysis) : false;
  const canApply = Boolean(
    analysis
      && analyzedPrdId === prdId
      && !loading
      && !applying
      && applyBlockers.length === 0
      && (repairState?.applyDisabledReasons.length ?? 0) === 0
      && !applyResult?.applied
      && analysis.operations.length > 0,
  );

  const handleApply = async () => {
    if (!analysis || analyzedPrdId !== prdId || !canApply) return;
    const applyingPrdId = analyzedPrdId;
    const applyingGeneration = generationRef.current;
    const isCurrentApply = () => (
      generationRef.current === applyingGeneration
      && currentPrdIdRef.current === applyingPrdId
      && activeRef.current
    );
    setApplying(true);
    setError(null);
    setApplyResult(null);
    try {
      const response = await applyQueueRecovery(simpleRetry
        ? {
          selectedPrdId: applyingPrdId,
          strategy: analysis.strategy,
          expectedOperations: analysis.operations,
        }
        : {
          selectedPrdId: applyingPrdId,
          strategy: analysis.strategy,
          expectedOperations: analysis.operations,
          repairActions: repairState?.selectedRepairActions,
          confirmDependencyRemoval: repairState?.requiresDependencyRemovalConfirmation === true,
        });
      if (isCurrentApply()) setApplyResult(response);
      if (response.applied) {
        await refreshQueue();
      }
    } catch (err: unknown) {
      if (isCurrentApply()) setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (isCurrentApply()) setApplying(false);
    }
  };
  // --- eforge:endregion cascade-recovery-application ---

  // --- eforge:region cascade-recovery-rendering ---
  return (
    <section className="space-y-2 rounded-md border border-dashed p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium text-foreground">
          {simpleRetry ? 'Retry failed build' : 'Advanced: queue-cascade retry/reactivation'}
        </h3>
        {!simpleRetry && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-auto px-0 py-0 text-xs text-muted-foreground hover:text-foreground"
            onClick={() => setOpen((prev) => !prev)}
          >
            {open ? 'Hide' : 'Show'}
          </Button>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        {simpleRetry
          ? 'The failed PRD will return to the queue and stale recovery sidecars will be removed.'
          : 'This advanced repair moves the failed upstream back to the queue and may reactivate skipped descendants.'}
      </p>

      {verdict === 'manual' && (
        <p role="alert" className="text-xs text-yellow">
          The recovery verdict requires manual review / manual replanning: queue-cascade retry/reactivation can contradict manual guidance.
        </p>
      )}
      {confidence === 'low' && (
        <p role="alert" className="text-xs text-yellow">
          The recovery verdict has low confidence; apply queue-cascade recovery with caution.
        </p>
      )}

      {loading && <p className="text-xs text-muted-foreground">Loading queue recovery analysis…</p>}
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}

      {analysis && simpleRetry && (
        <div className="space-y-2">
          {warnings.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-foreground">Warnings</p>
              <NoticeList notices={warnings} />
            </div>
          )}
          <ConfirmAction
            triggerLabel={applying ? 'Retrying…' : 'Retry build'}
            title="Retry build?"
            description="This returns the failed PRD to the queue and removes stale recovery sidecars."
            confirmLabel="Retry build"
            onConfirm={handleApply}
            disabled={!canApply}
          />
          {applyResult && (
            <div className="space-y-2 rounded-md border p-3">
              <p className={applyResult.applied ? 'text-sm text-foreground' : 'text-sm text-destructive'}>
                {applyResult.applied ? 'Build retry applied.' : 'Build retry was not applied.'}
              </p>
              <NoticeList notices={[...applyResult.blockers, ...applyResult.warnings]} />
            </div>
          )}
        </div>
      )}

      {analysis && !simpleRetry && blockers.length > 0 && (
        <div role="alert" className="space-y-1 rounded-md border border-destructive/30 p-2">
          <p className="text-xs font-medium text-destructive">Retry build unavailable.</p>
          <NoticeList notices={blockers} />
        </div>
      )}

      {open && !simpleRetry && (
        <div className="space-y-3">

          {analysis && (
            <>
              <div className="space-y-1">
                <p className="text-xs font-medium text-foreground">Skipped descendants</p>
                {skippedDescendants.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No skipped descendants reported.</p>
                ) : (
                  <ul className="space-y-1">
                    {skippedDescendants.map((node) => (
                      <li key={node.id} className="text-xs text-muted-foreground">
                        <span className="font-medium text-foreground">{node.title}</span> {node.id}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="space-y-1">
                <p className="text-xs font-medium text-foreground">Planned operations</p>
                {analysis.operations.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No operations planned.</p>
                ) : (
                  <ul className="space-y-1">
                    {analysis.operations.map((operation) => (
                      <li key={operation.id} className="text-xs text-muted-foreground">
                        <Badge variant="outline" className="mr-2 text-xs">{operation.kind}</Badge>
                        {operationLabel(operation)}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="space-y-1">
                <p className="text-xs font-medium text-foreground">Blockers</p>
                <NoticeList notices={[...blockers, ...applyBlockers]} empty="No blockers." />
              </div>

              <QueueCascadeRepairPanel
                analysis={analysis}
                selectedRemovals={selectedRemovals}
                selectedStackParents={selectedStackParents}
                applyResult={applyResult}
                onToggleRemoval={(key, checked) => setSelectedRemovals((prev) => ({ ...prev, [key]: checked }))}
                onSelectStackParent={(targetPrdId, parentId) => setSelectedStackParents((prev) => ({ ...prev, [targetPrdId]: parentId }))}
              />

              {warnings.length > 0 && (
                <div className="space-y-1">
                  <p className="text-xs font-medium text-foreground">Warnings</p>
                  <NoticeList notices={warnings} />
                </div>
              )}

              <ConfirmAction
                triggerLabel={applying ? 'Applying…' : 'Apply queue-cascade recovery'}
                title="Apply queue-cascade recovery?"
                description="This requeues the existing PRD artifact and may reactivate skipped descendants. Frontmatter is preserved unless the selected repairs apply metadata changes."
                confirmLabel="Apply"
                onConfirm={handleApply}
                disabled={!canApply}
              />
            </>
          )}

          {applyResult && (
            <div className="space-y-2 rounded-md border p-3">
              <p className={applyResult.applied ? 'text-sm text-foreground' : 'text-sm text-destructive'}>
                {applyResult.applied ? 'Queue-cascade recovery applied.' : 'Queue-cascade recovery was not applied.'}
              </p>
              <ul className="space-y-1">
                {applyResult.operationResults.map((result) => (
                  <li key={result.operation.id} className="text-xs text-muted-foreground">
                    {operationResultLabel(result)}
                  </li>
                ))}
              </ul>
              <NoticeList notices={applyResult.warnings} />
            </div>
          )}
        </div>
      )}
    </section>
  );
  // --- eforge:endregion cascade-recovery-rendering ---
}
