import * as React from 'react';
import type { ConsoleProjectState } from '@/lib/project-state';
import type { UseActiveSessionStreamsResult } from '@/hooks/use-active-session-streams';
import { selectNowDashboardModel } from '@/lib/selectors/now';
import { NowStateBanner } from '@/components/now/now-state-banner';
import { AttentionPanel } from '@/components/now/attention-panel';
import { ActiveBuildsGrid } from '@/components/now/active-builds-grid';
import { QueueSnapshotCard } from '@/components/now/queue-snapshot-card';
import { RecentRunsCard } from '@/components/now/recent-runs-card';
import { StackSummaryCard } from '@/components/now/stack-summary-card';
import { StackSyncStatusCard } from '@/components/now/stack-sync-status-card';
import { RecentActivityCard } from '@/components/now/recent-activity-card';

interface NowDashboardProps {
  projectState: ConsoleProjectState;
  activeSessions: UseActiveSessionStreamsResult;
}

export function NowDashboard({ projectState, activeSessions }: NowDashboardProps) {
  const [tick, setTick] = React.useState(() => Date.now());

  React.useEffect(() => {
    const id = setInterval(() => setTick(Date.now()), 5_000);
    return () => clearInterval(id);
  }, []);

  const now = tick;
  const model = selectNowDashboardModel(projectState, activeSessions, now);

  return (
    <div className="space-y-4">
      {/* Connection/state banner */}
      {model.connectionBanner && (
        <NowStateBanner banner={model.connectionBanner} />
      )}

      {/* Attention section */}
      <AttentionPanel items={model.attention} hiddenCount={model.attentionHiddenCount} />

      {/* Active builds grid */}
      <ActiveBuildsGrid cards={model.activeBuilds} />

      {/* Queue snapshot and recent runs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
        <QueueSnapshotCard summary={model.queue} />
        <RecentRunsCard runs={model.recentRuns} />
      </div>

      {/* Stack summary (only when stack layers exist) */}
      {model.stack && <StackSummaryCard summary={model.stack} />}

      {/* Stack sync status and controls (when stacking is configured) */}
      {model.stack && <StackSyncStatusCard sync={model.stackSync} />}

      {/* Recent activity preview */}
      <RecentActivityCard items={model.activity} hiddenCount={model.activityHiddenCount} now={now} />
    </div>
  );
}
