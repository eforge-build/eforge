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
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface QueueRecoveryDialogProps {
  open: boolean;
  prdId: string | null;
  prdTitle?: string;
  onOpenChange: (open: boolean) => void;
  refreshQueue: () => Promise<void> | void;
}

function noticeLabel(notice: QueueRecoveryNotice): string {
  return notice.prdId ? `${notice.message} (${notice.prdId})` : notice.message;
}

function operationLabel(operation: QueueRecoveryOperation): string {
  if (operation.kind === 'move-prd') {
    return `${operation.prdId}: ${operation.expectedSourceLocation} → ${operation.targetLocation} — ${operation.reason}`;
  }
  return `${operation.prdId}: remove recovery sidecars from ${operation.expectedSourceLocation} — ${operation.reason}`;
}

function operationResultLabel(result: QueueRecoveryOperationResult): string {
  return `${result.operation.prdId}: ${result.status}${result.message ? ` — ${result.message}` : ''}`;
}

function DialogSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-1.5">
      <h3 className="text-sm font-medium text-foreground">{title}</h3>
      {children}
    </section>
  );
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

export function QueueRecoveryDialog({
  open,
  prdId,
  prdTitle,
  onOpenChange,
  refreshQueue,
}: QueueRecoveryDialogProps) {
  const [analysis, setAnalysis] = React.useState<QueueRecoveryAnalyzeResponse | null>(null);
  const [applyResult, setApplyResult] = React.useState<QueueRecoveryApplyResponse | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [applying, setApplying] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [warningsAcknowledged, setWarningsAcknowledged] = React.useState(false);

  React.useEffect(() => {
    if (!open || !prdId) return;
    let cancelled = false;
    setLoading(true);
    setAnalysis(null);
    setApplyResult(null);
    setError(null);
    setWarningsAcknowledged(false);

    fetchQueueRecoveryAnalysis({
      selectedPrdId: prdId,
      strategy: QUEUE_RECOVERY_STRATEGY_RETRY_AND_REACTIVATE,
    })
      .then((response) => {
        if (!cancelled) setAnalysis(response);
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
  }, [open, prdId]);

  const selectedNode = analysis?.nodes.find((node) => node.id === analysis.selectedPrdId);
  const skippedDescendants = analysis?.nodes.filter((node) => node.role === 'skipped-descendant') ?? [];
  const blockers = analysis?.blockers ?? [];
  const warnings = analysis?.warnings ?? [];
  const applyBlockers = applyResult?.blockers ?? [];
  const canApply = Boolean(
    analysis
      && !loading
      && !applying
      && blockers.length === 0
      && applyBlockers.length === 0
      && !applyResult?.applied
      && analysis.operations.length > 0
      && (warnings.length === 0 || warningsAcknowledged),
  );

  const handleApply = async () => {
    if (!analysis || !prdId || !canApply) return;
    setApplying(true);
    setError(null);
    setApplyResult(null);
    try {
      const response = await applyQueueRecovery({
        selectedPrdId: prdId,
        strategy: analysis.strategy,
        expectedOperations: analysis.operations,
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Inspect queue cascade</DialogTitle>
          <DialogDescription>
            Preview the daemon-planned recovery for {prdTitle ?? prdId ?? 'the selected failed PRD'} before applying changes.
          </DialogDescription>
        </DialogHeader>

        {loading && <p className="text-sm text-muted-foreground">Loading queue recovery analysis…</p>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

        {analysis && (
          <div className="space-y-4">
            <DialogSection title="Selected failed upstream">
              <p className="text-sm text-foreground">
                {selectedNode?.title ?? prdTitle ?? analysis.selectedPrdId}
                <span className="ml-2 text-xs text-muted-foreground">{analysis.selectedPrdId}</span>
              </p>
            </DialogSection>

            <DialogSection title="Skipped descendants">
              {skippedDescendants.length === 0 ? (
                <p className="text-xs text-muted-foreground">No skipped descendants reported by daemon analysis.</p>
              ) : (
                <ul className="space-y-1">
                  {skippedDescendants.map((node) => (
                    <li key={node.id} className="text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">{node.title}</span> {node.id}
                    </li>
                  ))}
                </ul>
              )}
            </DialogSection>

            <DialogSection title="Raw dependency edges">
              {analysis.edges.length === 0 ? (
                <p className="text-xs text-muted-foreground">No dependency edges returned.</p>
              ) : (
                <ul className="space-y-1">
                  {analysis.edges.map((edge) => (
                    <li key={`${edge.dependentId}->${edge.dependencyId}`} className="text-xs text-muted-foreground">
                      {edge.dependentId} depends on {edge.dependencyId}
                    </li>
                  ))}
                </ul>
              )}
            </DialogSection>

            <DialogSection title="Planned operations">
              {analysis.operations.length === 0 ? (
                <p className="text-xs text-muted-foreground">No operations planned.</p>
              ) : (
                <ul className="space-y-1">
                  {analysis.operations.map((operation) => (
                    <li key={operation.id} className="text-xs text-muted-foreground">
                      <Badge variant="outline" className="mr-2 text-[10px]">{operation.kind}</Badge>
                      {operationLabel(operation)}
                    </li>
                  ))}
                </ul>
              )}
            </DialogSection>

            <DialogSection title="Warnings">
              <NoticeList notices={warnings} empty="No warnings." />
              {warnings.length > 0 && (
                <label className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                  <Checkbox
                    checked={warningsAcknowledged}
                    onCheckedChange={(checked) => setWarningsAcknowledged(checked === true)}
                    aria-label="Acknowledge queue recovery warnings"
                  />
                  I acknowledge these daemon warnings before applying recovery.
                </label>
              )}
            </DialogSection>

            <DialogSection title="Blockers">
              <NoticeList notices={[...blockers, ...applyBlockers]} empty="No blockers." />
            </DialogSection>
          </div>
        )}

        {applyResult && (
          <div className="space-y-2 rounded-md border p-3">
            <p className={applyResult.applied ? 'text-sm text-foreground' : 'text-sm text-destructive'}>
              {applyResult.applied ? 'Queue recovery applied.' : 'Queue recovery was not applied.'}
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

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button type="button" onClick={handleApply} disabled={!canApply}>
            {applying ? 'Applying…' : 'Apply recovery'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
