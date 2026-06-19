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
import { deriveCascadeRepairState, type RemovalSelection, type StackParentSelection } from './queue-cascade-repair-state';

interface AdvancedCascadeSectionProps {
  prdId: string;
  /** Sidecar verdict, used to warn when queue-cascade may contradict guidance. */
  verdict?: string;
  /** Sidecar confidence, used to warn on low-confidence verdicts. */
  confidence?: string;
  refreshQueue: () => Promise<void> | void;
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

/**
 * Advanced queue-cascade recovery. This is the lower-level repair operation that
 * moves the failed upstream back to the queue and may reactivate skipped
 * descendants. Analysis is fetched lazily only after the section is opened.
 */
export function AdvancedCascadeSection({ prdId, verdict, confidence, refreshQueue }: AdvancedCascadeSectionProps) {
  const [open, setOpen] = React.useState(false);
  const [analysis, setAnalysis] = React.useState<QueueRecoveryAnalyzeResponse | null>(null);
  const [analyzedPrdId, setAnalyzedPrdId] = React.useState<string | null>(null);
  const [applyResult, setApplyResult] = React.useState<QueueRecoveryApplyResponse | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [applying, setApplying] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [selectedRemovals, setSelectedRemovals] = React.useState<RemovalSelection>({});
  const [selectedStackParents, setSelectedStackParents] = React.useState<StackParentSelection>({});

  React.useEffect(() => {
    if (!open) return;
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
    setLoading(true);
    setError(null);
    // Discard any stale analysis/apply result carried over from a previous PRD
    // so the UI never displays or applies operations for the wrong PRD.
    setAnalysis(null);
    setApplyResult(null);
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
  }, [open, prdId]);

  const blockers = analysis?.blockers ?? [];
  const warnings = analysis?.warnings ?? [];
  const applyBlockers = applyResult?.blockers ?? [];
  const repairState = analysis ? deriveCascadeRepairState(analysis, selectedRemovals, selectedStackParents, applyResult) : null;
  const skippedDescendants = analysis?.nodes.filter((node) => node.role === 'skipped-descendant') ?? [];
  const canApply = Boolean(
    analysis
      && !loading
      && !applying
      && blockers.filter((notice) => notice.code !== 'dispatch-preflight-blocked').length === 0
      && applyBlockers.length === 0
      && (repairState?.applyDisabledReasons.length ?? 0) === 0
      && !applyResult?.applied
      && analysis.operations.length > 0,
  );

  const handleApply = async () => {
    if (!analysis || !canApply) return;
    setApplying(true);
    setError(null);
    setApplyResult(null);
    try {
      const response = await applyQueueRecovery({
        selectedPrdId: prdId,
        strategy: analysis.strategy,
        expectedOperations: analysis.operations,
        repairActions: repairState?.selectedRepairActions,
        confirmDependencyRemoval: repairState?.requiresDependencyRemovalConfirmation === true,
      });
      setApplyResult(response);
      if (response.applied) {
        await refreshQueue();
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setApplying(false);
    }
  };

  return (
    <section className="space-y-2 rounded-md border border-dashed p-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium text-foreground">Advanced: queue-cascade retry/reactivation</h3>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-auto px-0 py-0 text-xs text-muted-foreground hover:text-foreground"
          onClick={() => setOpen((prev) => !prev)}
        >
          {open ? 'Hide' : 'Show'}
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        This advanced repair moves the failed upstream back to the queue and may reactivate skipped descendants.
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

      {open && (
        <div className="space-y-3">
          {loading && <p className="text-xs text-muted-foreground">Loading queue recovery analysis…</p>}
          {error && <p role="alert" className="text-xs text-destructive">{error}</p>}

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
}
