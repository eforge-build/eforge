import * as React from 'react';
import { formatRelativeTime } from '@/lib/format-time';
import type { PlanningTaskActivityEntry } from '@/types';

function latestActivityEntry(activityLog: PlanningTaskActivityEntry[] | undefined): PlanningTaskActivityEntry | undefined {
  return activityLog && activityLog.length > 0 ? activityLog[activityLog.length - 1] : undefined;
}

function ActivityTimestamp({ timestamp }: { timestamp: string }) {
  return <time dateTime={timestamp} title={timestamp}>{formatRelativeTime(timestamp) ?? timestamp}</time>;
}

export function PlanningTaskLatestActivity({ activityLog }: { activityLog?: PlanningTaskActivityEntry[] }) {
  const latest = latestActivityEntry(activityLog);
  if (!latest) return null;
  return (
    <p className="mt-2 min-w-0 break-words text-xs text-muted-foreground">
      <span className="font-medium text-foreground">Latest activity:</span>{' '}
      <span>{latest.message}</span>{' '}
      <span className="whitespace-nowrap">· <ActivityTimestamp timestamp={latest.timestamp} /></span>
    </p>
  );
}

export function PlanningTaskActivityTimeline({ activityLog }: { activityLog?: PlanningTaskActivityEntry[] }) {
  const latest = latestActivityEntry(activityLog);
  if (!latest || !activityLog || activityLog.length === 0) return null;
  return (
    <section className="mt-3 rounded-md border border-border bg-background/60 p-3 text-sm" aria-label="Recent planning task activity">
      <h3 className="text-sm font-semibold text-foreground">Recent activity</h3>
      <div className="mt-2 rounded-md border border-primary/30 bg-primary/10 p-2 text-xs">
        <div className="font-medium text-text-bright">Latest activity</div>
        <div className="mt-1 break-words text-foreground">{latest.message}</div>
        <div className="mt-1 text-muted-foreground"><ActivityTimestamp timestamp={latest.timestamp} /></div>
      </div>
      <ol className="mt-3 grid gap-2 text-xs">
        {activityLog.map((entry, index) => (
          <li key={`${entry.timestamp}-${index}`} className="grid gap-0.5 rounded border border-border/70 bg-muted/20 p-2">
            <span className="break-words text-foreground">{entry.message}</span>
            <span className="text-muted-foreground"><ActivityTimestamp timestamp={entry.timestamp} /></span>
          </li>
        ))}
      </ol>
    </section>
  );
}
