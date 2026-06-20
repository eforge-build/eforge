import * as React from 'react';
import type {
  QueueCascadeApplyRequest,
  QueueCascadeApplyResponse,
  QueueCascadeOperation,
  QueueCascadePreviewResponse,
  QueueItem,
} from '@eforge-build/client/browser';
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
import { QueueHoldAction } from './queue-hold-action';
import { QueueCascadeAction } from './queue-cascade-action';
import { QueueActionDisabledReason } from './queue-action-disabled-reason';
import { capabilityOrUnavailable, capabilityReason, isHeld } from './queue-capability';

export interface QueueRowActionCallbacks {
  onSetPriority?: (id: string, priority: number) => Promise<void> | void;
  /** @deprecated Console destructive controls use preview/apply cascade callbacks. */
  onRemove?: (id: string) => Promise<void> | void;
  onOverrideDependency?: (id: string, dependencyId: string, reason?: string) => Promise<void> | void;
  onHold?: (id: string, reason?: string) => Promise<void> | void;
  onUnhold?: (id: string) => Promise<void> | void;
  onPreviewCascade?: (id: string, operation: QueueCascadeOperation) => Promise<QueueCascadePreviewResponse>;
  onApplyCascade?: (id: string, request: QueueCascadeApplyRequest) => Promise<QueueCascadeApplyResponse>;
}

interface QueueRowActionsProps extends QueueRowActionCallbacks {
  itemId: string;
  itemTitle: string;
  initialPriority?: number;
  dependencyIds?: string[];
  hold?: QueueItem['hold'];
  capabilities?: QueueItem['capabilities'];
  showCancel?: boolean;
}

export function QueueRowActions({
  itemId,
  itemTitle,
  initialPriority,
  dependencyIds = [],
  onSetPriority,
  onRemove,
  onOverrideDependency,
  onHold,
  onUnhold,
  onPreviewCascade,
  onApplyCascade,
  hold,
  capabilities,
  showCancel = false,
}: QueueRowActionsProps) {
  const [priorityValue, setPriorityValue] = React.useState(initialPriority != null ? String(initialPriority) : '');
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [removeOpen, setRemoveOpen] = React.useState(false);
  const [overrideOpen, setOverrideOpen] = React.useState(false);
  const [selectedDependencyId, setSelectedDependencyId] = React.useState(dependencyIds.length === 1 ? dependencyIds[0] : '');
  const [overrideReason, setOverrideReason] = React.useState('');
  const showOverrideDependency = Boolean(onOverrideDependency && dependencyIds.length > 0);
  const priorityAllowed = capabilityOrUnavailable(capabilities?.priority).allowed;
  const dependencyAllowed = capabilityOrUnavailable(capabilities?.dependencyOverride).allowed;

  React.useEffect(() => {
    if (!dependencyIds.includes(selectedDependencyId)) {
      setSelectedDependencyId(dependencyIds.length === 1 ? dependencyIds[0] : '');
    }
  }, [dependencyIds, selectedDependencyId]);

  if (!onSetPriority && !onRemove && !showOverrideDependency && !onHold && !onUnhold && !onPreviewCascade && !onApplyCascade) return null;

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

  async function handleConfirmOverrideDependency() {
    if (!onOverrideDependency || !selectedDependencyId) return;
    const reason = overrideReason.trim();
    const ok = await runAction(() => onOverrideDependency(itemId, selectedDependencyId, reason || undefined));
    if (ok) {
      setOverrideOpen(false);
      setOverrideReason('');
    }
  }

  return (
    <div className="mt-1 flex flex-wrap items-center gap-2">
      {onSetPriority && (
        <>
          {!priorityAllowed && <QueueActionDisabledReason reason={capabilityReason(capabilities?.priority)} />}
          <input
            type="number"
            aria-label={`Priority for ${itemTitle}`}
            value={priorityValue}
            onChange={(event) => setPriorityValue(event.target.value)}
            disabled={pending || !priorityAllowed}
            className="h-7 w-16 rounded-md border border-input bg-background px-2 text-xs"
          />
          <Button type="button" size="sm" variant="outline" disabled={pending || !priorityAllowed} onClick={handleSetPriority}>
            Set priority
          </Button>
        </>
      )}
      {(onHold || onUnhold) && (
        <QueueHoldAction
          itemId={itemId}
          itemTitle={itemTitle}
          held={isHeld(hold)}
          capability={isHeld(hold) ? capabilities?.unhold : capabilities?.hold}
          pending={pending}
          onHold={onHold}
          onUnhold={onUnhold}
        />
      )}
      {onRemove && !(onPreviewCascade && onApplyCascade) && (
        <AlertDialog open={removeOpen} onOpenChange={setRemoveOpen}>
          <AlertDialogTrigger asChild>
            <Button type="button" size="sm" variant="destructive" disabled={pending}>Remove</Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Remove queued item?</AlertDialogTitle>
              <AlertDialogDescription>Remove {itemTitle} ({itemId}) from the queue? This cannot be undone.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
              <AlertDialogAction disabled={pending} onClick={(event) => { event.preventDefault(); void handleConfirmRemove(); }}>Remove</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
      {!showCancel && onPreviewCascade && onApplyCascade && (
        <QueueCascadeAction
          itemId={itemId}
          itemTitle={itemTitle}
          operation="remove"
          capability={capabilities?.remove}
          cascadeCapability={capabilities?.cascadeRemove}
          onPreviewCascade={onPreviewCascade}
          onApplyCascade={onApplyCascade}
        />
      )}
      {showCancel && onPreviewCascade && onApplyCascade && (
        <QueueCascadeAction
          itemId={itemId}
          itemTitle={itemTitle}
          operation="cancel"
          capability={capabilities?.cancel}
          cascadeCapability={capabilities?.cascadeCancel}
          onPreviewCascade={onPreviewCascade}
          onApplyCascade={onApplyCascade}
        />
      )}
      {showOverrideDependency && (
        <AlertDialog open={overrideOpen} onOpenChange={setOverrideOpen}>
          <AlertDialogTrigger asChild>
            <Button type="button" size="sm" variant="destructive" disabled={pending || !dependencyAllowed}>
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
            {!dependencyAllowed && <QueueActionDisabledReason reason={capabilityReason(capabilities?.dependencyOverride)} />}
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
                  {dependencyIds.map((dependencyId) => <option key={dependencyId} value={dependencyId}>{dependencyId}</option>)}
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
              <AlertDialogAction disabled={pending || !selectedDependencyId} onClick={(event) => { event.preventDefault(); void handleConfirmOverrideDependency(); }}>
                Override dependency
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
      {error && <span role="alert" className="text-xs text-destructive">{error}</span>}
    </div>
  );
}
