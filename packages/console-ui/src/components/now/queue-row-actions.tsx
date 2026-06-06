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
  // --- eforge:region plan-03-console-override-control ---
  onOverrideDependency?: (id: string, dependencyId: string, reason?: string) => Promise<void> | void;
  // --- eforge:endregion plan-03-console-override-control ---
}

interface QueueRowActionsProps extends QueueRowActionCallbacks {
  itemId: string;
  itemTitle: string;
  initialPriority?: number;
  // --- eforge:region plan-03-console-override-control ---
  dependencyIds?: string[];
  // --- eforge:endregion plan-03-console-override-control ---
}

export function QueueRowActions({
  itemId,
  itemTitle,
  initialPriority,
  dependencyIds = [],
  onSetPriority,
  onRemove,
  onOverrideDependency,
}: QueueRowActionsProps) {
  const [priorityValue, setPriorityValue] = React.useState(
    initialPriority != null ? String(initialPriority) : '',
  );
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [removeOpen, setRemoveOpen] = React.useState(false);
  // --- eforge:region plan-03-console-override-control ---
  const [overrideOpen, setOverrideOpen] = React.useState(false);
  const [selectedDependencyId, setSelectedDependencyId] = React.useState(
    dependencyIds.length === 1 ? dependencyIds[0] : '',
  );
  const [overrideReason, setOverrideReason] = React.useState('');
  const showOverrideDependency = Boolean(onOverrideDependency && dependencyIds.length > 0);

  React.useEffect(() => {
    if (!dependencyIds.includes(selectedDependencyId)) {
      setSelectedDependencyId(dependencyIds.length === 1 ? dependencyIds[0] : '');
    }
  }, [dependencyIds, selectedDependencyId]);
  // --- eforge:endregion plan-03-console-override-control ---

  // Hide entirely when no action is wired (e.g. read-only callers).
  if (!onSetPriority && !onRemove && !showOverrideDependency) return null;

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

  // --- eforge:region plan-03-console-override-control ---
  async function handleConfirmOverrideDependency() {
    if (!onOverrideDependency || !selectedDependencyId) return;
    const reason = overrideReason.trim();
    const ok = await runAction(() => onOverrideDependency(itemId, selectedDependencyId, reason || undefined));
    if (ok) {
      setOverrideOpen(false);
      setOverrideReason('');
    }
  }
  // --- eforge:endregion plan-03-console-override-control ---

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
      {/* --- eforge:region plan-03-console-override-control --- */}
      {showOverrideDependency && (
        <AlertDialog open={overrideOpen} onOpenChange={setOverrideOpen}>
          <AlertDialogTrigger asChild>
            <Button type="button" size="sm" variant="destructive" disabled={pending}>
              Override dependency
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Override queue dependency?</AlertDialogTitle>
              <AlertDialogDescription>
                This bypasses queue dependency ordering for {itemTitle} ({itemId}). pre-PR merge/reconciliation must handle overlap before the work lands.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="space-y-3 py-2">
              <label className="block text-sm font-medium text-foreground">
                Dependency to override
                <select
                  aria-label={`Dependency to override for ${itemTitle}`}
                  value={selectedDependencyId}
                  onChange={(event) => setSelectedDependencyId(event.target.value)}
                  disabled={pending}
                  className="mt-1 h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                >
                  {dependencyIds.length > 1 && <option value="">Choose a dependency…</option>}
                  {dependencyIds.map((dependencyId) => (
                    <option key={dependencyId} value={dependencyId}>
                      {dependencyId}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm font-medium text-foreground">
                Reason (optional)
                <textarea
                  aria-label={`Reason for overriding ${itemTitle}`}
                  value={overrideReason}
                  onChange={(event) => setOverrideReason(event.target.value)}
                  disabled={pending}
                  className="mt-1 min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
              </label>
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                disabled={pending || !selectedDependencyId}
                onClick={(event) => {
                  event.preventDefault();
                  void handleConfirmOverrideDependency();
                }}
              >
                Override dependency
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
      {/* --- eforge:endregion plan-03-console-override-control --- */}
      {error && (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      )}
    </div>
  );
}
