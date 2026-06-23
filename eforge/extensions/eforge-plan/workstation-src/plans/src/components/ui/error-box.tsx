import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Destructive-tinted inline error message. Replaces the repeated `border
 * border-destructive/40 bg-destructive/10 … text-destructive-foreground` boxes.
 */
export function ErrorBox({ className, children }: { className?: string; children: React.ReactNode }) {
  return <p className={cn('rounded border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive-foreground', className)}>{children}</p>;
}
