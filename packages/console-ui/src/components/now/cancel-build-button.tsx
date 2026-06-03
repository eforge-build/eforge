import * as React from 'react';
import { ConfirmAction } from '@/components/recovery/confirm-action';
import { useCancelBuild } from '@/hooks/use-cancel-build';

interface CancelBuildButtonProps {
  sessionId: string;
  /** Human label for the build, shown in the confirmation copy. */
  label: string;
}

/**
 * Cancel control for an active build card. The actual cancel never fires
 * without explicit confirmation: the trigger opens an `AlertDialog` (via
 * `ConfirmAction`) and only the dialog's confirm button issues the request.
 */
export function CancelBuildButton({ sessionId, label }: CancelBuildButtonProps) {
  const { cancelling, cancel } = useCancelBuild(sessionId);
  return (
    <ConfirmAction
      triggerLabel={cancelling ? 'Cancelling…' : 'Cancel'}
      triggerVariant="outline"
      triggerClassName="h-6 px-2 text-xs text-muted-foreground hover:text-destructive hover:border-destructive/50"
      title="Cancel this build?"
      description={
        <>
          This immediately stops <strong>{label}</strong>. Any work already
          committed is kept, but in-progress agents are terminated. This cannot
          be undone.
        </>
      }
      confirmLabel="Cancel build"
      disabled={cancelling}
      onConfirm={cancel}
    />
  );
}
