/**
 * ActivityDrawerLauncher — compact card showing 3 most recent activity events
 * with a button to open the full ActivityDrawer.
 *
 * Reading initial URL state (`?activity=open`) is handled by the parent
 * NowDashboard which controls the `onOpen` callback and open state.
 */
import * as React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import type { NowActivityPreviewItem } from '@/lib/selectors/now';
import { formatRelativeTime } from '@/lib/format';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LAUNCHER_PREVIEW_COUNT = 3;

// ---------------------------------------------------------------------------
// ActivityDrawerLauncher
// ---------------------------------------------------------------------------

interface ActivityDrawerLauncherProps {
  /** Up to 3 most recent activity preview items. */
  items: NowActivityPreviewItem[];
  /** Called when the user clicks to open the full activity drawer. */
  onOpen: () => void;
  /** Current tick time for relative timestamps. */
  now: number;
}

export function ActivityDrawerLauncher({ items, onOpen, now }: ActivityDrawerLauncherProps) {
  const preview = items.slice(0, LAUNCHER_PREVIEW_COUNT);

  return (
    <Card className="flex flex-col bg-card/50 border-border/60">
      <CardHeader className="pb-2 pt-4 px-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold text-muted-foreground">Activity</CardTitle>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-xs text-primary hover:text-primary"
            onClick={onOpen}
          >
            View all →
          </Button>
        </div>
      </CardHeader>
      <CardContent className="px-4 pb-4 flex-1">
        {preview.length === 0 ? (
          <p className="text-xs text-muted-foreground">No recent activity</p>
        ) : (
          <ul className="space-y-2">
            {preview.map((item) => (
              <li key={item.id} className="flex items-start gap-2 text-xs">
                <span className="text-muted-foreground shrink-0 font-mono tabular-nums">
                  {formatRelativeTime(now - item.receivedAt)}
                </span>
                <div className="min-w-0">
                  <p className="text-foreground truncate">{item.summary}</p>
                  <p className="text-muted-foreground font-mono truncate">{item.eventType}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
        <Button
          variant="outline"
          size="sm"
          className="w-full mt-3 text-xs"
          onClick={onOpen}
        >
          Open activity log →
        </Button>
      </CardContent>
    </Card>
  );
}
