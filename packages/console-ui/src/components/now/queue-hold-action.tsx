/**
 * QueueHoldDialog — controlled confirm dialog for holding / releasing a queued
 * item. Triggerless: the queue-row overflow menu owns the open state (and the
 * capability gating), so this renders as a sibling of the menu.
 */
import * as React from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

interface QueueHoldDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  itemId: string;
  itemTitle: string;
  held: boolean;
  onHold?: (id: string, reason?: string) => Promise<void> | void;
  onUnhold?: (id: string) => Promise<void> | void;
}

export function QueueHoldDialog({ open, onOpenChange, itemId, itemTitle, held, onHold, onUnhold }: QueueHoldDialogProps) {
  const [reason, setReason] = React.useState('');
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  function handleOpenChange(next: boolean) {
    if (!next) {
      setReason('');
      setError(null);
    }
    onOpenChange(next);
  }

  async function confirm() {
    setPending(true);
    setError(null);
    try {
      if (held) await onUnhold?.(itemId);
      else await onHold?.(itemId, reason.trim() || undefined);
      handleOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={handleOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{held ? 'Release hold?' : 'Hold queued item?'}</AlertDialogTitle>
          <AlertDialogDescription>
            {held ? `Allow ${itemTitle} (${itemId}) to launch again.` : `Prevent ${itemTitle} (${itemId}) from launching until the hold is released.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {!held && (
          <label className="block text-sm font-medium text-foreground">
            Hold reason (optional)
            <textarea
              aria-label={`Hold reason for ${itemTitle}`}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              disabled={pending}
              className="mt-1 min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
            />
          </label>
        )}
        {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <AlertDialogAction disabled={pending} onClick={(event) => { event.preventDefault(); void confirm(); }}>
            {pending ? 'Updating…' : held ? 'Release hold' : 'Hold'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
