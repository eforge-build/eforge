import * as React from 'react';
import type { ConsoleProjectState } from '@/lib/project-state';
import type { UseActiveSessionStreamsResult } from '@/hooks/use-active-session-streams';
import { selectNowDashboardModel } from '@/lib/selectors/now';
import { NowStateBanner } from '@/components/now/now-state-banner';
import { AttentionPanel } from '@/components/now/attention-panel';
import { ActiveBuildsGrid } from '@/components/now/active-builds-grid';
import { QueueCard } from '@/components/now/queue-card';
import { RunHistoryCard } from '@/components/now/run-history-card';
import { StackSummaryCard } from '@/components/now/stack-summary-card';
import { StackSyncStatusCard } from '@/components/now/stack-sync-status-card';
import { ActivityDrawerLauncher } from '@/components/now/activity-drawer-launcher';
import { ActivityDrawer } from '@/components/now/activity-drawer';

// ---------------------------------------------------------------------------
// URL query-param helpers
// ---------------------------------------------------------------------------

function readActivityOpenParam(): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('activity') === 'open';
}

// ---------------------------------------------------------------------------
// NowDashboard
// ---------------------------------------------------------------------------

interface NowDashboardProps {
  projectState: ConsoleProjectState;
  activeSessions: UseActiveSessionStreamsResult;
  onNavigate?: (href: string) => void;
}

export function NowDashboard({ projectState, activeSessions, onNavigate }: NowDashboardProps) {
  const [tick, setTick] = React.useState(() => Date.now());
  const [activityOpen, setActivityOpen] = React.useState(() => readActivityOpenParam());

  React.useEffect(() => {
    const id = setInterval(() => setTick(Date.now()), 5_000);
    return () => clearInterval(id);
  }, []);

  const now = tick;
  const model = selectNowDashboardModel(projectState, activeSessions, now);

  const handleActivityOpen = React.useCallback(() => setActivityOpen(true), []);
  const handleActivityClose = React.useCallback(() => setActivityOpen(false), []);

  return (
    <div className="space-y-4">
      {/* Connection/state banner */}
      {model.connectionBanner && (
        <NowStateBanner banner={model.connectionBanner} />
      )}

      {/* Attention section */}
      <AttentionPanel items={model.attention} hiddenCount={model.attentionHiddenCount} />

      {/* Active builds grid */}
      <ActiveBuildsGrid cards={model.activeBuilds} onNavigate={onNavigate} />

      {/* Queue */}
      <QueueCard summary={model.queue} />

      {/* Stack summary | Activity launcher (two-column) */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <StackSummaryCard summary={model.stack} />
        <ActivityDrawerLauncher
          items={model.activity}
          onOpen={handleActivityOpen}
          now={now}
        />
      </div>

      {/* Run history */}
      <RunHistoryCard runs={model.allRuns} onNavigate={onNavigate} />

      {/* Stack sync status and controls (when stacking is configured) */}
      {model.stack && <StackSyncStatusCard sync={model.stackSync} />}

      {/* Activity drawer — mounted once at page root */}
      <ActivityDrawer
        open={activityOpen}
        onClose={handleActivityClose}
        activity={projectState.recentActivity}
        now={now}
      />
    </div>
  );
}
