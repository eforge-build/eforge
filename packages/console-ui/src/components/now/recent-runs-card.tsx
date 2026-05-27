import * as React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { NowRecentRunItem } from '@/lib/selectors/now';
import { formatDuration } from '@/lib/format';
interface RecentRunsCardProps {
  runs: NowRecentRunItem[];
}

function runBadgeVariant(
  status: string,
): 'default' | 'secondary' | 'destructive' | 'outline' {
  const s = status.toLowerCase();
  if (s === 'failed' || s === 'failure' || s === 'error') return 'destructive';
  if (s === 'completed' || s === 'complete' || s === 'success' || s === 'succeeded') return 'secondary';
  return 'default';
}

export function RecentRunsCard({ runs }: RecentRunsCardProps) {
  return (
    <Card className="mb-4">
      <CardHeader className="pb-2 pt-4 px-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold">Recent runs</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        {runs.length === 0 ? (
          <p className="text-sm text-muted-foreground">No recent runs</p>
        ) : (
          <ul className="space-y-2">
            {runs.map((run) => (
              <li key={run.id} className="flex items-start gap-2">
                <Badge
                  variant={runBadgeVariant(run.status)}
                  className="shrink-0 capitalize text-xs mt-0.5"
                >
                  {run.status}
                </Badge>
                <div className="min-w-0 flex-1">
                  <p className="text-xs text-foreground truncate">{run.planSet}</p>
                  <p className="text-xs text-muted-foreground truncate">{run.command}</p>
                </div>
                {run.durationMs != null && (
                  <span className="text-xs text-muted-foreground shrink-0">
                    {formatDuration(run.durationMs)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
