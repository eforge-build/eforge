import * as React from 'react';
import type { QueueItemCapability } from '@eforge-build/client/browser';
import { Button } from '@/components/ui/button';
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

interface QueueHoldActionProps {
  itemId: string;
  itemTitle: string;
  held: boolean;
  capability?: QueueItemCapability;
  pending?: boolean;
  onHold?: (id: string, reason?: string) => Promise<void> | void;
  onUnhold?: (id: string) => Promise<void> | void;
}

export function QueueHoldAction({ itemId, itemTitle, held, capability, pending = false, onHold, onUnhold }: QueueHoldActionProps) {
  const [open, setOpen] = React.useState(false);
  const [reason, setReason] = React.useState('');
  const [localPending, setLocalPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const resolved = capabilityOrUnavailable(capability);
  const disabledReason = capabilityReason(capability);
  const disabled = pending || localPending || !resolved.allowed || (held ? !onUnhold : !onHold);
  const label = held ? 'Unhold…' : 'Hold…';

  async function confirm() {
    setLocalPending(true);
    setError(null);
    try {
      if (held) await onUnhold?.(itemId);
      else await onHold?.(itemId, reason.trim() || undefined);
      setOpen(false);
      setReason('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLocalPending(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogTrigger asChild>
          <Button type="button" size="sm" variant="outline" disabled={disabled}>{localPending ? 'Updating…' : label}</Button>
        </AlertDialogTrigger>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{held ? 'Unhold queued item?' : 'Hold queued item?'}</AlertDialogTitle>
            <AlertDialogDescription>
              {held ? `Allow ${itemTitle} (${itemId}) to launch again.` : `Prevent ${itemTitle} (${itemId}) from launching until unheld.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {!held && (
            <label className="block text-sm font-medium text-foreground">
              Hold reason (optional)
              <textarea
                aria-label={`Hold reason for ${itemTitle}`}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                disabled={localPending}
                className="mt-1 min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              />
            </label>
          )}
          {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={localPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={localPending} onClick={(event) => { event.preventDefault(); void confirm(); }}>
              {held ? 'Unhold' : 'Hold'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {!resolved.allowed && <QueueActionDisabledReason reason={disabledReason} />}
    </span>
  );
}
