import * as React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { NowStackSummary } from '@/lib/selectors/now';

interface StackSummaryCardProps {
  summary: NowStackSummary | null;
}

function stackStatusVariant(status: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  const s = status.toLowerCase();
  if (s === 'failed') return 'destructive';
  if (s === 'landed' || s === 'merged' || s === 'built') return 'secondary';
  if (s === 'building') return 'default';
  return 'outline';
}

export function StackSummaryCard({ summary }: StackSummaryCardProps) {
  if (!summary) return null;

  return (
    <Card className="mb-4">
      <CardHeader className="pb-2 pt-4 px-4">
        <CardTitle className="text-sm font-semibold">Stack layers</CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        {/* Status counts */}
        <div className="flex flex-wrap gap-2 mb-3">
          {Object.entries(summary.byStatus).map(([status, count]) => (
            <span key={status} className="text-xs text-muted-foreground capitalize">
              {status}:{' '}
              <span className="font-medium text-foreground">{count}</span>
            </span>
          ))}
        </div>

        {/* Top rows */}
        <ul className="space-y-1.5">
          {summary.topRows.map((row) => (
            <li
              key={row.prdId}
              className="flex items-start gap-2 text-xs"
            >
              <Badge
                variant={stackStatusVariant(row.status)}
                className="shrink-0 capitalize text-xs"
              >
                {row.status}
              </Badge>
              <div className="min-w-0">
                <p className="text-foreground truncate font-mono">{row.prdId}</p>
                <p className="text-muted-foreground truncate">
                  {row.provider} / {row.stackId} &middot; {row.branch}
                  {row.baseBranch && ` ← ${row.baseBranch}`}
                </p>
                {row.landingStatus && (
                  <p className="text-muted-foreground">
                    landing: {row.landingStatus}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ul>
        {summary.hiddenCount > 0 && (
          <p className="text-xs text-muted-foreground mt-2">
            + {summary.hiddenCount} more layer{summary.hiddenCount > 1 ? 's' : ''}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
