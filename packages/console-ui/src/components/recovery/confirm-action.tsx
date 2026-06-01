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

interface ConfirmActionProps {
  /** Label for the button that opens the confirmation dialog. */
  triggerLabel: string;
  /** Title shown inside the confirmation dialog. */
  title: string;
  /** Body copy describing what the confirmed action will do. */
  description: React.ReactNode;
  /** Label for the button that performs the action after confirmation. */
  confirmLabel: string;
  /** Invoked only after the user confirms. */
  onConfirm: () => void;
  disabled?: boolean;
  triggerVariant?: React.ComponentProps<typeof Button>['variant'];
  triggerClassName?: string;
}

/**
 * A button that opens an `AlertDialog` confirmation before invoking its action.
 *
 * No mutating or worker-spawning recovery action runs without the user first
 * confirming through this dialog. `onConfirm` fires only when the dialog's
 * action button is clicked.
 */
export function ConfirmAction({
  triggerLabel,
  title,
  description,
  confirmLabel,
  onConfirm,
  disabled,
  triggerVariant = 'default',
  triggerClassName,
}: ConfirmActionProps) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button type="button" variant={triggerVariant} size="sm" disabled={disabled} className={triggerClassName}>
          {triggerLabel}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>{confirmLabel}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
