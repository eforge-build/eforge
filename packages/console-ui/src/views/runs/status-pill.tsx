// --- eforge:region runs-build-entrypoints ---
import * as React from 'react';
import { Badge } from '@/components/ui/badge';
import type { RunRollupStatus } from '@/lib/selectors/runs';

interface StatusPillProps {
  status: RunRollupStatus | string;
  className?: string;
}

/** Small badge that renders a run/group rollup status with appropriate visual weight. */
export function StatusPill({ status, className }: StatusPillProps) {
  const variant = deriveVariant(status);
  return (
    <Badge variant={variant} className={className}>
      {status}
    </Badge>
  );
}

function deriveVariant(
  status: string,
): 'default' | 'secondary' | 'destructive' | 'outline' {
  const s = status.toLowerCase();
  if (s === 'running') return 'default';
  if (
    s === 'failed' ||
    s === 'failure' ||
    s === 'error' ||
    s === 'errored' ||
    s === 'killed' ||
    s === 'cancelled' ||
    s === 'canceled' ||
    s === 'stopped'
  )
    return 'destructive';
  if (s === 'completed' || s === 'complete' || s === 'success' || s === 'succeeded')
    return 'secondary';
  return 'outline';
}
// --- eforge:endregion runs-build-entrypoints ---
