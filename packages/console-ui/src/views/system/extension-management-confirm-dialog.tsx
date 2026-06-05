/**
 * Generic confirmation gate for System extension management actions
 * (reload, trust, re-trust, untrust, promote, demote).
 *
 * Every mutating action on the management surface routes through this dialog so
 * a single accidental or socially induced click cannot reload, trust, untrust,
 * promote, or demote an extension. The dialog renders an action-specific title
 * and consequence sentence, the target extension's identity (name, path, scope,
 * trust state) when the action targets a row, and an always-present
 * supply-chain / unsandboxed-code warning. `onConfirm` fires only after the user
 * confirms.
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

/** Identity of the extension an action targets. Omitted for global reload. */
export interface ConfirmDialogTarget {
  name: string;
  path: string;
  scope: string;
  trustState?: string;
}

interface ExtensionManagementConfirmDialogProps {
  /** Dialog heading describing the action. */
  title: string;
  /** Action-specific consequence copy. */
  consequence: string;
  /** Confirm button label (also the action verb). */
  confirmLabel: string;
  /** Invoked only after the user confirms in the dialog. */
  onConfirm: () => void;
  /** Target extension identity. Omit for global actions like reload. */
  target?: ConfirmDialogTarget;
  /** The trigger control. Clicking it opens the confirmation dialog. */
  children: React.ReactNode;
}

export function ExtensionManagementConfirmDialog({
  title,
  consequence,
  confirmLabel,
  onConfirm,
  target,
  children,
}: ExtensionManagementConfirmDialogProps) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>{children}</AlertDialogTrigger>
      <AlertDialogContent onClick={(e) => e.stopPropagation()}>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2">
              <p>{consequence}</p>
              <p className="text-destructive">
                Extension code is unsandboxed native code. Only continue if you trust the
                source and have reviewed the supply chain for the code this action affects.
              </p>
              {target && (
                <dl className="space-y-1 text-xs">
                  <div className="flex gap-2">
                    <dt className="shrink-0 font-medium text-foreground">Extension</dt>
                    <dd className="font-mono break-all">{target.name}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="shrink-0 font-medium text-foreground">Path</dt>
                    <dd className="font-mono break-all">{target.path}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="shrink-0 font-medium text-foreground">Scope</dt>
                    <dd className="font-mono">{target.scope}</dd>
                  </div>
                  {target.trustState && (
                    <div className="flex gap-2">
                      <dt className="shrink-0 font-medium text-foreground">Trust state</dt>
                      <dd className="font-mono">{target.trustState}</dd>
                    </div>
                  )}
                </dl>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>{confirmLabel}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
