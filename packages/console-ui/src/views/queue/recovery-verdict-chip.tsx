import * as React from 'react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { QueueItem } from '@eforge-build/client/browser';

type RecoveryVerdict = NonNullable<QueueItem['recoveryVerdict']>;

interface RecoveryVerdictChipProps {
  recoveryVerdict: RecoveryVerdict;
}

const VERDICT_LABELS: Record<RecoveryVerdict['verdict'], string> = {
  retry: 'retry',
  split: 'split',
  abandon: 'abandon',
  manual: 'manual',
};

const CONFIDENCE_CLASSES: Record<RecoveryVerdict['confidence'], string> = {
  high: 'border-green-500/50 bg-green-500/10 text-green-700 dark:text-green-400',
  medium: 'border-yellow-500/50 bg-yellow-500/10 text-yellow-700 dark:text-yellow-400',
  low: 'border-orange-500/50 bg-orange-500/10 text-orange-700 dark:text-orange-400',
};

/**
 * Console-local badge for a recovery verdict (verdict + confidence level).
 */
export function RecoveryVerdictChip({ recoveryVerdict }: RecoveryVerdictChipProps) {
  const { verdict, confidence } = recoveryVerdict;
  return (
    <Badge
      variant="outline"
      className={cn('text-[10px] px-1.5 py-0 gap-1', CONFIDENCE_CLASSES[confidence])}
      aria-label={`Recovery verdict: ${verdict}, confidence: ${confidence}`}
    >
      {VERDICT_LABELS[verdict]}
      <span className="opacity-70">{confidence}</span>
    </Badge>
  );
}
