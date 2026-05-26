import * as React from 'react';
import type { NowStatusSummary } from '@/lib/selectors/now';
import { MetricCard } from './metric-card';
import { formatDuration, formatRelativeTime } from '@/lib/format';

interface NowStatusOverviewProps {
  status: NowStatusSummary;
}

export function NowStatusOverview({ status }: NowStatusOverviewProps) {
  const connectionLabel = status.isConnected
    ? 'Connected'
    : status.connectionStatus === 'connecting'
    ? 'Connecting'
    : 'Disconnected';

  let autoBuildLabel = 'Unknown';
  if (status.autoBuildMode != null) {
    autoBuildLabel = status.autoBuildMode;
  } else if (status.autoBuildEnabled != null) {
    autoBuildLabel = status.autoBuildEnabled ? 'Enabled' : 'Disabled';
  }
  if (status.autoBuildDesired != null && status.autoBuildDesired !== status.autoBuildMode) {
    autoBuildLabel += ` (desired: ${status.autoBuildDesired})`;
  }

  let schedulerLabel = 'Unknown';
  if (status.schedulerRunningCount != null && status.schedulerLimit != null) {
    schedulerLabel = `${status.schedulerRunningCount} / ${status.schedulerLimit}`;
  } else if (status.schedulerRunningCount != null) {
    schedulerLabel = String(status.schedulerRunningCount);
  }

  const uptimeLabel = status.uptimeMs != null ? formatDuration(status.uptimeMs) : 'Unknown';
  const lastUpdateLabel =
    status.lastUpdateMsAgo != null
      ? formatRelativeTime(status.lastUpdateMsAgo)
      : 'Unknown';

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
      <MetricCard label="Daemon" value={connectionLabel} />
      <MetricCard label="Auto-build" value={autoBuildLabel} />
      <MetricCard
        label="Scheduler"
        value={schedulerLabel}
        sub="running / limit"
      />
      <MetricCard
        label="Queue depth"
        value={status.queueDepth}
      />
      <MetricCard
        label="Active builds"
        value={status.activeBuildCount}
      />
      <MetricCard
        label="Running builds"
        value={status.runningBuilds ?? status.activeBuildCount}
      />
      {status.subscribers != null && (
        <MetricCard label="Subscribers" value={status.subscribers} />
      )}
      <MetricCard label="Uptime" value={uptimeLabel} />
      <MetricCard label="Last update" value={lastUpdateLabel} />
    </div>
  );
}
