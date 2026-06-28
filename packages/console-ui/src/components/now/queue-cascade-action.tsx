import * as React from 'react';
import type {
  QueueCascadeApplyRequest,
  QueueCascadeApplyResponse,
  QueueCascadeOperation,
  QueueCascadePreviewResponse,
  QueueItemCapability,
} from '@eforge-build/client/browser';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { capabilityOrUnavailable, capabilityReason } from './queue-capability';
import { QueueActionDisabledReason } from './queue-action-disabled-reason';

interface QueueCascadeActionProps {
  itemId: string;
  itemTitle: string;
  operation: QueueCascadeOperation;
  capability?: QueueItemCapability;
  cascadeCapability?: QueueItemCapability;
  onPreviewCascade?: (id: string, operation: QueueCascadeOperation) => Promise<QueueCascadePreviewResponse>;
  onApplyCascade?: (id: string, request: QueueCascadeApplyRequest) => Promise<QueueCascadeApplyResponse>;
  onApplied?: (response: QueueCascadeApplyResponse) => void;
}

export function QueueCascadeAction({
  itemId,
  itemTitle,
  operation,
  capability,
  cascadeCapability,
  onPreviewCascade,
  onApplyCascade,
  onApplied,
}: QueueCascadeActionProps) {
  const [open, setOpen] = React.useState(false);
  const [preview, setPreview] = React.useState<QueueCascadePreviewResponse | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [applying, setApplying] = React.useState(false);
  const [useCascade, setUseCascade] = React.useState(false);
  const [confirmDependents, setConfirmDependents] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);
  const resolved = capabilityOrUnavailable(capability);
  const cascadeResolved = capabilityOrUnavailable(cascadeCapability);
  const disabledReason = capabilityReason(capability);
  const canOpen = resolved.allowed || cascadeResolved.allowed;
  const disabled = !canOpen || !onPreviewCascade || !onApplyCascade;
  const label = operation === 'cancel' ? 'Cancel PRD…' : 'Remove…';

  React.useEffect(() => {
    if (!open || preview || message || !onPreviewCascade) return;
    let cancelled = false;
    setLoading(true);
    setMessage(null);
    onPreviewCascade(itemId, operation)
      .then((response) => {
        if (!cancelled) setPreview(response);
      })
      .catch((err) => {
        if (!cancelled) setMessage(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [itemId, message, onPreviewCascade, open, operation, preview]);

  async function apply() {
    if (!preview || !onApplyCascade) return;
    const strategy = useCascade ? 'cascade-dependents' : 'target-only';
    const request: QueueCascadeApplyRequest = {
      operation,
      strategy,
      expectedAffected: preview.expectedAffected,
      confirmDependents: useCascade && confirmDependents,
    };
    setApplying(true);
    setMessage(null);
    try {
      const response = await onApplyCascade(itemId, request);
      if (response.applied) {
        setOpen(false);
        onApplied?.(response);
      } else {
        setMessage([...response.blockers, ...response.warnings].join(' ') || 'Queue cascade was not applied.');
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setApplying(false);
    }
  }

  const dependents = preview?.dependents ?? [];
  const hasDependents = dependents.length > 0;
  const confirmDisabled = applying || !preview || (useCascade ? (!confirmDependents || !cascadeResolved.allowed) : !resolved.allowed);

  return (
    <span className="inline-flex items-center gap-2">
      <AlertDialog open={open} onOpenChange={(next) => { setOpen(next); if (!next) { setPreview(null); setLoading(false); setUseCascade(false); setConfirmDependents(false); setMessage(null); } }}>
        <AlertDialogTrigger asChild>
          <Button type="button" size="sm" variant={operation === 'cancel' ? 'outline' : 'destructive'} disabled={disabled}>{label}</Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{operation === 'cancel' ? 'Cancel queued PRD?' : 'Remove queued item?'}</AlertDialogTitle>
            <AlertDialogDescription>
              Preview affected queue items before mutating {itemTitle} ({itemId}).
            </AlertDialogDescription>
          </AlertDialogHeader>
          {loading && <p className="text-sm text-muted-foreground">Loading cascade preview…</p>}
          {preview && (
            <div className="max-h-80 space-y-3 overflow-auto text-sm">
              <p>Affects {preview.expectedAffected.prdIds.length} PRD{preview.expectedAffected.prdIds.length === 1 ? '' : 's'}.</p>
              {[preview.target, ...dependents].map((affected) => (
                <div key={affected.prdId} className="rounded-md border border-border/60 p-2 text-xs">
                  <p className="font-medium text-foreground">{affected.prdId} · {affected.title}</p>
                  <p className="text-muted-foreground">{affected.status} · {affected.effect} · depth {affected.depth}</p>
                  {affected.blockers.length > 0 && <p className="text-destructive">{affected.blockers.join(' ')}</p>}
                </div>
              ))}
              {preview.warnings.length > 0 && <p className="text-yellow">{preview.warnings.join(' ')}</p>}
              {preview.blockers.length > 0 && <p className="text-destructive">{preview.blockers.join(' ')}</p>}
              {preview.defaultRefusalReason && <p className="text-muted-foreground">{preview.defaultRefusalReason}</p>}
              {hasDependents && (
                <label className="flex items-center gap-2 text-xs">
                  <Checkbox checked={useCascade} onCheckedChange={(checked) => { setUseCascade(Boolean(checked)); setConfirmDependents(false); }} />
                  Cascade to dependents
                </label>
              )}
              {useCascade && (
                <label className="flex items-center gap-2 text-xs">
                  <Checkbox checked={confirmDependents} onCheckedChange={(checked) => setConfirmDependents(Boolean(checked))} />
                  Confirm dependent mutation
                </label>
              )}
              {useCascade && !cascadeResolved.allowed && <QueueActionDisabledReason reason={capabilityReason(cascadeCapability)} />}
            </div>
          )}
          {message && <p role="alert" className="text-xs text-destructive">{message}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={applying}>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={confirmDisabled} onClick={(event) => { event.preventDefault(); void apply(); }}>
              {applying ? 'Applying…' : operation === 'cancel' ? 'Cancel PRD' : 'Remove'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {!resolved.allowed && <QueueActionDisabledReason reason={disabledReason} />}
    </span>
  );
}
