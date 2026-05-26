import * as React from 'react';
import type { QueueItem } from '@eforge-build/client/browser';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { DependencyChips } from './dependency-chips';
import { RecoveryVerdictChip } from './recovery-verdict-chip';

interface QueueItemRowProps {
  item: QueueItem;
}

const STATUS_BADGE_CLASSES: Record<string, string> = {
  running: 'border-blue-500/50 bg-blue-500/10 text-blue-700 dark:text-blue-400',
  pending: 'border-muted-foreground/30 bg-muted text-muted-foreground',
  failed: 'border-destructive/50 bg-destructive/10 text-destructive',
  waiting: 'border-yellow-500/50 bg-yellow-500/10 text-yellow-700 dark:text-yellow-400',
};

function getStatusBadgeClass(status: string): string {
  return STATUS_BADGE_CLASSES[status.toLowerCase()] ?? 'border-muted-foreground/30 text-muted-foreground';
}

function formatCreated(created: string): string {
  const date = new Date(created);
  if (!Number.isFinite(date.getTime())) {
    return created;
  }
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/**
 * Compact row/card for a single QueueItem. Displays id, title, status, priority,
 * created timestamp, dependencies, and recovery state. Read-only.
 */
export function QueueItemRow({ item }: QueueItemRowProps) {
  const isFailed = item.status.toLowerCase() === 'failed';

  return (
    <div
      className={cn(
        'flex flex-col gap-1.5 rounded-md border px-3 py-2 text-sm',
        isFailed && 'border-destructive/30 bg-destructive/5',
      )}
      aria-label={`Queue item ${item.id}`}
    >
      {/* Top row: id + status + priority */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-[10px] text-muted-foreground shrink-0">{item.id}</span>

        <Badge
          variant="outline"
          className={cn('text-[10px] px-1.5 py-0', getStatusBadgeClass(item.status))}
        >
          {item.status}
        </Badge>

        {item.priority != null && (
          <span className="text-[10px] text-muted-foreground">
            {`Priority ${item.priority}`}
          </span>
        )}

        {item.created && (
          <span className="ml-auto text-[10px] text-muted-foreground">
            {formatCreated(item.created)}
          </span>
        )}
      </div>

      {/* Title */}
      <p className="text-sm font-medium leading-tight text-foreground">{item.title}</p>

      {/* Dependencies */}
      {item.dependsOn && item.dependsOn.length > 0 && (
        <DependencyChips dependsOn={item.dependsOn} />
      )}

      {/* Recovery state (only for failed items) */}
      {isFailed && (
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-muted-foreground">Recovery:</span>
          {item.recoveryVerdict ? (
            <RecoveryVerdictChip recoveryVerdict={item.recoveryVerdict} />
          ) : (
            <span className="text-[10px] text-muted-foreground italic">recovery pending</span>
          )}
        </div>
      )}
    </div>
  );
}
