/**
 * Confirmation gate for project-team extension Trust/Re-trust actions.
 *
 * Trusting an extension records trust for code that can execute after reload, so
 * a single accidental or socially induced click must not grant execution trust.
 * This dialog wraps the trigger button and only calls `onConfirm` after the user
 * confirms, surfacing the extension name, path, current trust state, and a clear
 * code-trust warning. Shared by the Now strip and the System extensions section
 * so both surfaces use the same confirmation flow.
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
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import type { ExtensionTrustState } from '@eforge-build/client/browser';

interface TrustConfirmDialogProps {
  /** Extension display name. */
  name: string;
  /** Filesystem path of the extension. */
  path: string;
  /** Current trust state, when known. */
  trustState?: ExtensionTrustState;
  /** Action verb: "Trust" or "Re-trust". */
  actionLabel: string;
  /** Invoked only after the user confirms in the dialog. */
  onConfirm: () => void;
  /** The trigger button. Clicking it opens the confirmation dialog. */
  children: React.ReactNode;
}

export function TrustConfirmDialog({
  name,
  path,
  trustState,
  actionLabel,
  onConfirm,
  children,
}: TrustConfirmDialogProps) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>{children}</AlertDialogTrigger>
      <AlertDialogContent onClick={(e) => e.stopPropagation()}>
        <AlertDialogHeader>
          <AlertDialogTitle>{actionLabel} project-team extension?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2">
              <p>
                Trusting this extension lets its project-team code execute after the next
                reload. Only continue if you have reviewed the extension and trust its source.
              </p>
              <dl className="space-y-1 text-xs">
                <div className="flex gap-2">
                  <dt className="shrink-0 font-medium text-foreground">Extension</dt>
                  <dd className="font-mono break-all">{name}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="shrink-0 font-medium text-foreground">Path</dt>
                  <dd className="font-mono break-all">{path}</dd>
                </div>
                {trustState && (
                  <div className="flex gap-2">
                    <dt className="shrink-0 font-medium text-foreground">Current state</dt>
                    <dd className="font-mono">{trustState}</dd>
                  </div>
                )}
              </dl>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>{actionLabel}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
