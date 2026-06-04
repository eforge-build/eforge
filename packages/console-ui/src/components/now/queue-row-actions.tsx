/**
 * QueueRowActions — reusable set-priority and confirmed-remove controls shared
 * by loose queue rows and dependency-stack rows.
 *
 * The row owns its transient UI state (the priority input value, the pending
 * flag, and the latest error text). The parent owns the daemon mutation
 * callbacks and the post-success queue refresh — this component never inspects
 * queue filesystem paths, daemon wire shapes, or calls fetch directly. Numeric
 * validation rejects empty or non-integer values locally before invoking the
 * daemon; daemon rejections still surface as row-local error text.
 */
import * as React from 'react';
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

/** Mutation callbacks shared by loose and stack rows. Absent callback hides its action. */
export interface QueueRowActionCallbacks {
  onSetPriority?: (id: string, priority: number) => Promise<void> | void;
  onRemove?: (id: string) => Promise<void> | void;
}

interface QueueRowActionsProps extends QueueRowActionCallbacks {
  itemId: string;
  itemTitle: string;
  initialPriority?: number;
}

export function QueueRowActions({
  itemId,
  itemTitle,
  initialPriority,
  onSetPriority,
  onRemove,
}: QueueRowActionsProps) {
  const [priorityValue, setPriorityValue] = React.useState(
    initialPriority != null ? String(initialPriority) : '',
  );
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [removeOpen, setRemoveOpen] = React.useState(false);

  // Hide entirely when neither action is wired (e.g. read-only callers).
  if (!onSetPriority && !onRemove) return null;

  async function runAction(action: () => Promise<void> | void): Promise<boolean> {
    setPending(true);
    setError(null);
    try {
      await action();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return false;
    } finally {
      setPending(false);
    }
  }

  async function handleSetPriority() {
    if (!onSetPriority) return;
    const trimmedPriority = priorityValue.trim();
    const parsedPriority = Number(trimmedPriority);
    if (trimmedPriority === '' || !Number.isInteger(parsedPriority)) {
      setError('Priority must be an integer.');
      return;
    }
    await runAction(() => onSetPriority(itemId, parsedPriority));
  }

  async function handleConfirmRemove() {
    if (!onRemove) return;
    const ok = await runAction(() => onRemove(itemId));
    if (ok) setRemoveOpen(false);
  }

  return (
    <div className="mt-1 flex flex-wrap items-center gap-2">
      {onSetPriority && (
        <>
          <input
            type="number"
            aria-label={`Priority for ${itemTitle}`}
            value={priorityValue}
            onChange={(event) => setPriorityValue(event.target.value)}
            disabled={pending}
            className="h-7 w-16 rounded-md border border-input bg-background px-2 text-xs"
          />
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={handleSetPriority}
          >
            Set priority
          </Button>
        </>
      )}
      {onRemove && (
        <AlertDialog open={removeOpen} onOpenChange={setRemoveOpen}>
          <AlertDialogTrigger asChild>
            <Button type="button" size="sm" variant="destructive" disabled={pending}>
              Remove
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Remove queued item?</AlertDialogTitle>
              <AlertDialogDescription>
                Remove {itemTitle} ({itemId}) from the queue? This cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                disabled={pending}
                onClick={(event) => {
                  // Keep the dialog mounted through the async mutation; close it
                  // ourselves only on success so an error stays visible.
                  event.preventDefault();
                  void handleConfirmRemove();
                }}
              >
                Remove
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
      {error && (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      )}
    </div>
  );
}
