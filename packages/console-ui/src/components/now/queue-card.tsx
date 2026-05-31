/**
 * QueueCard — read-oriented view of the build queue.
 *
 * Renders queue items as rows with status badge, title, priority chip, and
 * dependency chips. Failed rows expose an explicit queue cascade inspection
 * action; no recovery mutation happens during render or expansion.
 */
import * as React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { NowQueueItem, NowQueueSummary } from '@/lib/selectors/now';
import { selectPrdDisplayLabel } from '@/lib/selectors/labels';
import { QueueRecoveryDialog } from './queue-recovery-dialog';

interface QueueCardProps {
  summary: NowQueueSummary;
  refreshQueue?: () => Promise<void> | void;
}

function statusVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  const s = status.toLowerCase();
  if (s === 'failed') return 'destructive';
  if (s === 'running') return 'default';
  if (s === 'skipped') return 'outline';
  return 'secondary';
}

function blockedByLabel(dependsOn: string[]): string {
  return dependsOn.map((depId) => selectPrdDisplayLabel(undefined, depId)).join(', ');
}

export function QueueCard({ summary, refreshQueue = () => undefined }: QueueCardProps) {
  const [expanded, setExpanded] = React.useState(false);
  const [selectedRecoveryItem, setSelectedRecoveryItem] = React.useState<NowQueueItem | null>(null);
  const items = expanded ? (summary.allItems ?? summary.topItems) : summary.topItems;

  return (
    <Card>
      <CardHeader className="pb-2 pt-4 px-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold">Queue</CardTitle>
          {summary.total > 0 && (
            <span className="text-xs text-muted-foreground">{summary.total} item{summary.total !== 1 ? 's' : ''}</span>
          )}
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        {summary.total === 0 ? (
          <p className="text-sm text-muted-foreground">Queue is empty</p>
        ) : (
          <>
            {/* Summary counts — running items are shown above as active build cards */}
            <div className="flex flex-wrap gap-2 mb-3">
              {summary.pendingCount > 0 && (
                <span className="text-xs text-muted-foreground">
                  Pending: <span className="font-medium text-foreground">{summary.pendingCount}</span>
                </span>
              )}
              {summary.failedCount > 0 && (
                <span className="text-xs text-destructive">
                  Failed: <span className="font-medium">{summary.failedCount}</span>
                </span>
              )}
              {summary.skippedCount > 0 && (
                <span className="text-xs text-muted-foreground">
                  Skipped: <span className="font-medium text-foreground">{summary.skippedCount}</span>
                </span>
              )}
              {summary.withDependenciesCount > 0 && (
                <span className="text-xs text-muted-foreground">
                  Blocked: <span className="font-medium text-foreground">{summary.withDependenciesCount}</span>
                </span>
              )}
            </div>

            {/* Top items — display only */}
            <ul className="space-y-1.5">
              {items.map((item) => (
                <li key={item.id} className="flex items-start gap-2">
                  <Badge
                    variant={statusVariant(item.status)}
                    className="shrink-0 capitalize text-xs"
                  >
                    {item.status}
                  </Badge>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-foreground truncate">{item.title}</p>
                    {item.priority != null && (
                      <span className="inline-block text-xs text-muted-foreground">
                        priority {item.priority}
                      </span>
                    )}
                    {item.dependsOn && item.dependsOn.length > 0 && (
                      <p className="text-xs text-muted-foreground">
                        blocked by {blockedByLabel(item.dependsOn)}
                      </p>
                    )}
                    {item.recoveryVerdict && (
                      <p className="text-xs text-muted-foreground">
                        {item.recoveryVerdict.verdict} / {item.recoveryVerdict.confidence}
                      </p>
                    )}
                    {!item.recoveryVerdict && item.status.toLowerCase() === 'failed' && (
                      <p className="text-xs text-muted-foreground">recovery pending</p>
                    )}
                    {item.status.toLowerCase() === 'failed' && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="mt-1 h-auto px-0 py-0 text-xs text-muted-foreground hover:text-foreground"
                        onClick={() => setSelectedRecoveryItem(item)}
                      >
                        Inspect cascade
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            {summary.hiddenCount > 0 && !expanded && (
              <button
                type="button"
                className="mt-2 text-xs text-muted-foreground transition-colors hover:text-foreground"
                onClick={() => setExpanded(true)}
              >
                + {summary.hiddenCount} more — show all
              </button>
            )}
          </>
        )}
      </CardContent>
      <QueueRecoveryDialog
        open={selectedRecoveryItem != null}
        prdId={selectedRecoveryItem?.id ?? null}
        prdTitle={selectedRecoveryItem?.title}
        onOpenChange={(open) => {
          if (!open) setSelectedRecoveryItem(null);
        }}
        refreshQueue={refreshQueue}
      />
    </Card>
  );
}
