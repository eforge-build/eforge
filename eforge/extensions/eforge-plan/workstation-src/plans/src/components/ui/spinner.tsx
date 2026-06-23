import * as React from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * The workstation's loading spinner. Wraps lucide's Loader2 with the standard
 * spin animation so busy buttons and inline waits read identically. Defaults to
 * the icon-button size (`h-4 w-4`); pass `className` to resize.
 */
export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('h-4 w-4 animate-spin', className)} aria-hidden="true" />;
}
