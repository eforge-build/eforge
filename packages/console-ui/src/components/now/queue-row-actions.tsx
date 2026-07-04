/**
 * QueueRowActions — per-row overflow (⋯) menu for queue item controls.
 *
 * All actions live behind one kebab menu so queue rows stay quiet: Set
 * priority…, Hold…/Release hold…, Override dependency…, and the destructive
 * Remove…/Cancel PRD… cascade flow. Menu items gate on daemon capabilities and
 * render the disabled reason inline (tooltips do not fire on disabled Radix
 * items).
 *
 * Radix menu→dialog pattern: every dialog renders as a SIBLING of the
 * DropdownMenu, never inside DropdownMenuContent. Items call
 * `event.preventDefault()` in onSelect and we close the controlled menu
 * ourselves before opening the dialog — otherwise Radix's close-with-focus
 * restore races the dialog mount and leaves the page inert
 * (pointer-events: none on body).
 */
import * as React from 'react';
import { MoreHorizontal } from 'lucide-react';
import type {
  QueueCascadeApplyRequest,
  QueueCascadeApplyResponse,
  QueueCascadeOperation,
  QueueCascadePreviewResponse,
  QueueItem,
} from '@eforge-build/client/browser';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
import { QueueHoldDialog } from './queue-hold-action';
import { QueueCascadeDialog } from './queue-cascade-action';
import { QueuePriorityDialog, type PrioritySibling } from './queue-priority-dialog';
import { QueueActionDisabledReason } from './queue-action-disabled-reason';
import { capabilityOrUnavailable, capabilityReason, isHeld } from './queue-capability';
import { cn } from '@/lib/utils';

// --- eforge:region row-action-contracts ---
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
  /** Forward queue items used by the priority dialog's presets and landing preview. */
  prioritySiblings?: PrioritySibling[];
  hold?: QueueItem['hold'];
  capabilities?: QueueItem['capabilities'];
  showCancel?: boolean;
}

type ActiveDialog = 'priority' | 'hold' | 'override' | 'cascade' | 'remove' | null;
// --- eforge:endregion row-action-contracts ---

// --- eforge:region action-menu-item ---
function ActionMenuItem({
  label,
  disabled,
  reason,
  destructive = false,
  onOpen,
}: {
  label: string;
  disabled: boolean;
  reason?: string;
  destructive?: boolean;
  onOpen: () => void;
}) {
  return (
    <DropdownMenuItem
      disabled={disabled}
      className={cn(destructive && 'text-destructive focus:text-destructive')}
      onSelect={(event) => {
        event.preventDefault();
        onOpen();
      }}
    >
      <span className="flex flex-col gap-0.5">
        <span>{label}</span>
        {disabled && reason && <QueueActionDisabledReason reason={reason} />}
      </span>
    </DropdownMenuItem>
  );
}
// --- eforge:endregion action-menu-item ---

// --- eforge:region queue-row-actions-menu-and-dialogs ---
export function QueueRowActions({
  itemId,
  itemTitle,
  initialPriority,
  dependencyIds = [],
  prioritySiblings = [],
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
  const [menuOpen, setMenuOpen] = React.useState(false);
  const [activeDialog, setActiveDialog] = React.useState<ActiveDialog>(null);
  const [selectedDependencyId, setSelectedDependencyId] = React.useState(dependencyIds.length === 1 ? dependencyIds[0] : '');
  const [overrideReason, setOverrideReason] = React.useState('');
  const [pending, setPending] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const held = isHeld(hold);
  const showOverrideDependency = Boolean(onOverrideDependency && dependencyIds.length > 0);
  const hasCascade = Boolean(onPreviewCascade && onApplyCascade);
  const priorityCapability = capabilityOrUnavailable(capabilities?.priority);
  const holdCapability = capabilityOrUnavailable(held ? capabilities?.unhold : capabilities?.hold);
  const dependencyCapability = capabilityOrUnavailable(capabilities?.dependencyOverride);
  const cascadeOperation: QueueCascadeOperation = showCancel ? 'cancel' : 'remove';
  const cascadeCapability = showCancel ? capabilities?.cancel : capabilities?.remove;
  const cascadeDependentsCapability = showCancel ? capabilities?.cascadeCancel : capabilities?.cascadeRemove;
  const cascadeAllowed =
    capabilityOrUnavailable(cascadeCapability).allowed || capabilityOrUnavailable(cascadeDependentsCapability).allowed;
  // The separator before the destructive section only makes sense when a
  // non-destructive item renders above it.
  const hasNonDestructiveItems = Boolean(onSetPriority || onHold || onUnhold) || showOverrideDependency;

  React.useEffect(() => {
    if (!dependencyIds.includes(selectedDependencyId)) {
      setSelectedDependencyId(dependencyIds.length === 1 ? dependencyIds[0] : '');
    }
  }, [dependencyIds, selectedDependencyId]);

  if (!onSetPriority && !onRemove && !showOverrideDependency && !onHold && !onUnhold && !hasCascade) return null;

  // The inline dialogs (remove, override) share `error`/`pending` state, so a
  // stale failure from one dialog must not leak into the next: reset on every
  // open and on close, matching QueuePriorityDialog/QueueHoldDialog/
  // QueueCascadeDialog which reset their own state the same way.
  const openDialog = (dialog: Exclude<ActiveDialog, null>) => {
    setMenuOpen(false);
    setError(null);
    setPending(false);
    setActiveDialog(dialog);
  };
  const dialogOpenChange = (open: boolean) => {
    if (!open) {
      setActiveDialog(null);
      setError(null);
      setPending(false);
    }
  };

  async function handleConfirmOverrideDependency() {
    if (!onOverrideDependency || !selectedDependencyId) return;
    const reason = overrideReason.trim();
    setPending(true);
    setError(null);
    try {
      await onOverrideDependency(itemId, selectedDependencyId, reason || undefined);
      setActiveDialog(null);
      setOverrideReason('');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  }

  async function handleConfirmRemove() {
    if (!onRemove) return;
    setPending(true);
    setError(null);
    try {
      await onRemove(itemId);
      setActiveDialog(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 w-6 shrink-0 p-0 text-muted-foreground hover:text-foreground"
            aria-label={`Queue actions for ${itemTitle}`}
          >
            <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          {onSetPriority && (
            <ActionMenuItem
              label="Set priority…"
              disabled={!priorityCapability.allowed}
              reason={capabilityReason(capabilities?.priority)}
              onOpen={() => openDialog('priority')}
            />
          )}
          {(onHold || onUnhold) && (
            <ActionMenuItem
              label={held ? 'Release hold…' : 'Hold…'}
              disabled={!holdCapability.allowed || (held ? !onUnhold : !onHold)}
              reason={capabilityReason(held ? capabilities?.unhold : capabilities?.hold)}
              onOpen={() => openDialog('hold')}
            />
          )}
          {showOverrideDependency && (
            <ActionMenuItem
              label="Override dependency…"
              disabled={!dependencyCapability.allowed}
              reason={capabilityReason(capabilities?.dependencyOverride)}
              onOpen={() => openDialog('override')}
            />
          )}
          {(hasCascade || onRemove) && (
            <>
              {hasNonDestructiveItems && <DropdownMenuSeparator />}
              {hasCascade ? (
                <ActionMenuItem
                  label={showCancel ? 'Cancel PRD…' : 'Remove…'}
                  destructive
                  disabled={!cascadeAllowed}
                  reason={capabilityReason(cascadeCapability)}
                  onOpen={() => openDialog('cascade')}
                />
              ) : (
                <ActionMenuItem label="Remove…" destructive disabled={false} onOpen={() => openDialog('remove')} />
              )}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Dialogs are siblings of the menu — see module comment. */}
      {onSetPriority && (
        <QueuePriorityDialog
          open={activeDialog === 'priority'}
          onOpenChange={dialogOpenChange}
          itemId={itemId}
          itemTitle={itemTitle}
          currentPriority={initialPriority}
          siblings={prioritySiblings}
          onSetPriority={onSetPriority}
        />
      )}
      {(onHold || onUnhold) && (
        <QueueHoldDialog
          open={activeDialog === 'hold'}
          onOpenChange={dialogOpenChange}
          itemId={itemId}
          itemTitle={itemTitle}
          held={held}
          onHold={onHold}
          onUnhold={onUnhold}
        />
      )}
      {hasCascade && (
        <QueueCascadeDialog
          open={activeDialog === 'cascade'}
          onOpenChange={dialogOpenChange}
          itemId={itemId}
          itemTitle={itemTitle}
          operation={cascadeOperation}
          capability={cascadeCapability}
          cascadeCapability={cascadeDependentsCapability}
          onPreviewCascade={onPreviewCascade}
          onApplyCascade={onApplyCascade}
        />
      )}
      {onRemove && !hasCascade && (
        <AlertDialog open={activeDialog === 'remove'} onOpenChange={dialogOpenChange}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Remove queued item?</AlertDialogTitle>
              <AlertDialogDescription>Remove {itemTitle} ({itemId}) from the queue? This cannot be undone.</AlertDialogDescription>
            </AlertDialogHeader>
            {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
            <AlertDialogFooter>
              <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
              <AlertDialogAction disabled={pending} onClick={(event) => { event.preventDefault(); void handleConfirmRemove(); }}>Remove</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
      {showOverrideDependency && (
        <AlertDialog open={activeDialog === 'override'} onOpenChange={dialogOpenChange}>
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
            {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
            <AlertDialogFooter>
              <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
              <AlertDialogAction disabled={pending || !selectedDependencyId} onClick={(event) => { event.preventDefault(); void handleConfirmOverrideDependency(); }}>
                Override dependency
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      )}
    </>
  );
}
// --- eforge:endregion queue-row-actions-menu-and-dialogs ---
