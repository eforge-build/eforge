import * as React from 'react';
import { cn } from '@/lib/utils';
import type { ConsoleProjectState } from '@/lib/project-state';
import { selectNowStatusSummary } from '@/lib/selectors/now';
import { formatRelativeTime, formatAbsoluteTimestamp } from '@/lib/format';

interface StatusStripProps {
  projectState: ConsoleProjectState;
}

export function StatusStrip({ projectState }: StatusStripProps) {
  const [now, setNow] = React.useState(() => Date.now());

  React.useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, []);

  const summary = selectNowStatusSummary(projectState, {}, now);

  const connectionLabel =
    summary.connectionStatus === 'connected'
      ? 'Connected'
      : summary.connectionStatus === 'connecting'
        ? 'Connecting...'
        : 'Disconnected';

  const connectionColor =
    summary.connectionStatus === 'connected'
      ? 'text-green'
      : summary.connectionStatus === 'connecting'
        ? 'text-yellow'
        : 'text-red';

  const dotColor =
    summary.connectionStatus === 'connected'
      ? 'bg-green'
      : summary.connectionStatus === 'connecting'
        ? 'bg-yellow'
        : 'bg-red';

  const absoluteTs =
    projectState.lastEventAt != null || projectState.lastSnapshotAt != null
      ? Math.max(projectState.lastEventAt ?? 0, projectState.lastSnapshotAt ?? 0)
      : null;
  const relativeLabel =
    summary.lastUpdateMsAgo != null ? formatRelativeTime(summary.lastUpdateMsAgo) : '--';
  const absoluteLabel = absoluteTs != null ? formatAbsoluteTimestamp(absoluteTs) : null;

  return (
    <div
      className="flex items-center gap-4 px-3 py-1 border-t border-border text-xs text-muted-foreground"
      aria-label="connection and daemon status"
    >
      {/* Connection status */}
      <span className={cn('flex items-center gap-1', connectionColor)}>
        <span
          className={cn('inline-block w-1.5 h-1.5 rounded-full', dotColor)}
          aria-hidden="true"
        />
        {connectionLabel}
      </span>

      <span className="text-border">|</span>

      {/* Queue count */}
      <span>
        Queue: <span className="text-foreground">{summary.queueDepth}</span>
      </span>

      {/* Active builds */}
      <span>
        Active: <span className="text-foreground">{summary.activeBuildCount}</span>
      </span>

      {/* Auto-build */}
      <span>
        Auto-build:{' '}
        <span
          className={cn(
            summary.autoBuildEnabled ? 'text-green' : 'text-muted-foreground',
          )}
        >
          {summary.autoBuildEnabled === null ? '--' : summary.autoBuildEnabled ? 'on' : 'off'}
        </span>
      </span>

      {/* Last update */}
      <span className="ml-auto">
        Updated: <span className="text-foreground">{relativeLabel}</span>
        {absoluteLabel != null && (
          <span className="text-muted-foreground ml-1">({absoluteLabel})</span>
        )}
      </span>
    </div>
  );
}
