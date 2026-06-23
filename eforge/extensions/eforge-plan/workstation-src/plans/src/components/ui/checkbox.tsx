import * as React from 'react';
import { cn } from '@/lib/utils';

type CheckboxProps = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'>;

/**
 * Native checkbox with consistent sizing/accent. Wraps `<input type="checkbox">`
 * so the workstation's selection toggles (merge/split pickers, annotation
 * include-all) stop hand-styling raw inputs.
 */
export const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(({ className, ...props }, ref) => (
  <input
    ref={ref}
    type="checkbox"
    className={cn('h-3.5 w-3.5 shrink-0 cursor-pointer accent-primary disabled:cursor-not-allowed disabled:opacity-50', className)}
    {...props}
  />
));
Checkbox.displayName = 'Checkbox';
