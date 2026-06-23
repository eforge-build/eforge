import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Dashed-border quiet placeholder for "nothing here yet" states. Replaces the
 * repeated `rounded-md border border-dashed p-… text-… text-muted-foreground`
 * paragraphs. Pass `className` to vary padding/text size.
 */
export function EmptyState({ className, children }: { className?: string; children: React.ReactNode }) {
  return <p className={cn('rounded-md border border-dashed p-3 text-sm text-muted-foreground', className)}>{children}</p>;
}
