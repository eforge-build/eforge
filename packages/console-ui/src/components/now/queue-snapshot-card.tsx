import * as React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { NowQueueSummary } from '@/lib/selectors/now';
import { toConsolePath } from '@/lib/navigation';

interface QueueSnapshotCardProps {
  summary: NowQueueSummary;
}

export function QueueSnapshotCard({ summary }: QueueSnapshotCardProps) {
  const queueHref = toConsolePath('queue');

  return (
    <Card className="mb-4">
      <CardHeader className="pb-2 pt-4 px-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold">Queue</CardTitle>
          <a
            href={queueHref}
            className="text-xs text-primary hover:underline"
          >
            View all
          </a>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        {summary.total === 0 ? (
          <p className="text-sm text-muted-foreground">Queue is empty</p>
        ) : (
          <>
            {/* Summary counts */}
            <div className="flex flex-wrap gap-2 mb-3">
              <span className="text-xs text-muted-foreground">
                Total: <span className="font-medium text-foreground">{summary.total}</span>
              </span>
              {summary.runningCount > 0 && (
                <span className="text-xs text-muted-foreground">
                  Running:{' '}
                  <span className="font-medium text-foreground">{summary.runningCount}</span>
                </span>
              )}
              {summary.pendingCount > 0 && (
                <span className="text-xs text-muted-foreground">
                  Pending:{' '}
                  <span className="font-medium text-foreground">{summary.pendingCount}</span>
                </span>
              )}
              {summary.failedCount > 0 && (
                <span className="text-xs text-destructive">
                  Failed:{' '}
                  <span className="font-medium">{summary.failedCount}</span>
                </span>
              )}
              {summary.withDependenciesCount > 0 && (
                <span className="text-xs text-muted-foreground">
                  Blocked:{' '}
                  <span className="font-medium text-foreground">
                    {summary.withDependenciesCount}
                  </span>
                </span>
              )}
            </div>

            {/* Top items */}
            <ul className="space-y-1.5">
              {summary.topItems.map((item) => (
                <li key={item.id} className="flex items-start gap-2">
                  <Badge
                    variant={
                      item.status.toLowerCase() === 'failed'
                        ? 'destructive'
                        : item.status.toLowerCase() === 'running'
                        ? 'default'
                        : 'secondary'
                    }
                    className="shrink-0 capitalize text-xs"
                  >
                    {item.status}
                  </Badge>
                  <div className="min-w-0">
                    <p className="text-xs text-foreground truncate">{item.title}</p>
                    {item.recoveryVerdict && (
                      <p className="text-xs text-muted-foreground">
                        {item.recoveryVerdict.verdict} / {item.recoveryVerdict.confidence}
                      </p>
                    )}
                    {!item.recoveryVerdict && item.status.toLowerCase() === 'failed' && (
                      <p className="text-xs text-muted-foreground">recovery pending</p>
                    )}
                    {item.dependsOn && item.dependsOn.length > 0 && (
                      <p className="text-xs text-muted-foreground">
                        depends on {item.dependsOn.length} item(s)
                      </p>
                    )}
                  </div>
                </li>
              ))}
            </ul>
            {summary.hiddenCount > 0 && (
              <p className="text-xs text-muted-foreground mt-2">
                + {summary.hiddenCount} more
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
