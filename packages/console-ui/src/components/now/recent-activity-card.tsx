import * as React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { NowActivityPreviewItem } from '@/lib/selectors/now';
import { formatRelativeTime } from '@/lib/format';
import { toConsolePath } from '@/lib/navigation';

interface RecentActivityCardProps {
  items: NowActivityPreviewItem[];
  hiddenCount: number;
  now?: number;
}

export function RecentActivityCard({ items, hiddenCount, now }: RecentActivityCardProps) {
  const activityHref = toConsolePath('activity');
  const currentNow = now ?? Date.now();

  return (
    <Card className="mb-4">
      <CardHeader className="pb-2 pt-4 px-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold">Recent activity</CardTitle>
          <a
            href={activityHref}
            className="text-xs text-primary hover:underline"
          >
            View all
          </a>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4">
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No recent activity in the daemon snapshot
          </p>
        ) : (
          <>
            <ul className="space-y-2">
              {items.map((item) => (
                <li key={item.id} className="flex items-start gap-2 text-xs">
                  <span className="text-muted-foreground shrink-0 font-mono">
                    {formatRelativeTime(currentNow - item.receivedAt)}
                  </span>
                  <div className="min-w-0">
                    <p className="text-foreground truncate">{item.summary}</p>
                    <p className="text-muted-foreground font-mono">{item.eventType}</p>
                  </div>
                </li>
              ))}
            </ul>
            {hiddenCount > 0 && (
              <p className="text-xs text-muted-foreground mt-2">
                + {hiddenCount} more event{hiddenCount > 1 ? 's' : ''}
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
