import * as React from 'react';
import type { ConsoleProjectState } from '@/lib/project-state';
import type { UseActiveSessionStreamsResult } from '@/hooks/use-active-session-streams';
import { selectNowDashboardModel } from '@/lib/selectors/now';
import type { NowAttentionItem } from '@/lib/selectors/now';
import { NowStateBanner } from '@/components/now/now-state-banner';
import { AttentionPanel } from '@/components/now/attention-panel';
import { ActiveBuildsGrid } from '@/components/now/active-builds-grid';
import { QueueCard } from '@/components/now/queue-card';
import { MetricsPanel } from '@/components/now/metrics-panel';
import { useBuildMetricHistory } from '@/hooks/use-build-metric-history';
import { RunHistoryCard } from '@/components/now/run-history-card';
import { StackSyncAlert } from '@/components/now/stack-sync-alert';
import { ActivityDrawerLauncher } from '@/components/now/activity-drawer-launcher';
import { ActivityDrawer } from '@/components/now/activity-drawer';
import { toConsolePath } from '@/lib/navigation';

// ---------------------------------------------------------------------------
// URL query-param helpers
// ---------------------------------------------------------------------------

function readActivityOpenParam(): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('activity') === 'open';
}

// ---------------------------------------------------------------------------
// Attention partitioning
// ---------------------------------------------------------------------------

/**
 * System-level attention items describe daemon/stream health rather than a
 * specific queued PRD. Per-PRD failures and skips are owned by the Queue card
 * (which carries the Recover action), so only these system alerts surface in
 * the top strip — that removes the duplicate "Failed: …" rows that previously
 * appeared in both Attention and Queue.
 */
function isSystemAttentionItem(item: NowAttentionItem): boolean {
  return (
    item.id === 'stream-error' ||
    item.id === 'stale-heartbeat' ||
    item.id.startsWith('session-error-')
  );
}

// ---------------------------------------------------------------------------
// NowDashboard
// ---------------------------------------------------------------------------

interface NowDashboardProps {
  projectState: ConsoleProjectState;
  activeSessions: UseActiveSessionStreamsResult;
  onNavigate?: (href: string) => void;
  refreshQueue?: () => Promise<void> | void;
}

export function NowDashboard({ projectState, activeSessions, onNavigate, refreshQueue }: NowDashboardProps) {
  const [tick, setTick] = React.useState(() => Date.now());
  const [activityOpen, setActivityOpen] = React.useState(() => readActivityOpenParam());

  React.useEffect(() => {
    const id = setInterval(() => setTick(Date.now()), 5_000);
    return () => clearInterval(id);
  }, []);

  const now = tick;
  const model = selectNowDashboardModel(projectState, activeSessions, now);

  // Accrue rolling token/cost history for the active-build velocity sparklines.
  const metricHistory = useBuildMetricHistory(
    model.activeBuilds.map((b) => ({ sessionId: b.sessionId, tokens: b.tokens, cost: b.cost })),
    now,
  );

  const handleActivityOpen = React.useCallback(() => setActivityOpen(true), []);
  const handleActivityClose = React.useCallback(() => setActivityOpen(false), []);

  // Top strip carries only daemon/stream health; per-PRD failures live in Queue.
  const systemAlerts = React.useMemo(
    () => model.attention.filter(isSystemAttentionItem),
    [model.attention],
  );

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-4">
      {/* Connection/state banner */}
      {model.connectionBanner && (
        <NowStateBanner banner={model.connectionBanner} />
      )}

      {/* System alerts — daemon/stream health only, elevated above everything. */}
      <AttentionPanel items={systemAlerts} hiddenCount={0} title="System alerts" />

      {/* Stack sync escalation — only a conflict/failed/stuck-deferred sync
          surfaces here; normal sync housekeeping lives on System. */}
      <StackSyncAlert
        sync={model.stackSync}
        hasActiveBuilds={model.activeBuilds.length > 0}
        onManage={onNavigate ? () => onNavigate(toConsolePath('system')) : undefined}
      />

      {/* Operational shell: a wide main column for live work (active builds +
          queue) and a sticky rail of glanceable reference widgets. A single
          shared grid keeps every section's edges aligned instead of each
          section inventing its own width. Collapses to one column below lg. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
        {/* MAIN */}
        <div className="min-w-0 space-y-4">
          <ActiveBuildsGrid
            cards={model.activeBuilds}
            onNavigate={onNavigate}
            metricHistory={metricHistory}
          />
          <QueueCard stacks={model.queueStacks} summary={model.queue} refreshQueue={refreshQueue} />
        </div>

        {/* RAIL — glanceable reference widgets. Run history replaces the former
            Git stack history card (a redundant landing log: a failed land is
            already a failed build, so it added no signal the Queue/Build health
            didn't). The landed-PRD → branch → PR reference now lives in System. */}
        <aside className="space-y-4 lg:sticky lg:top-4">
          <MetricsPanel model={model.metrics} />
          <ActivityDrawerLauncher
            items={model.activity}
            onOpen={handleActivityOpen}
            now={now}
          />
          <RunHistoryCard runs={model.allRuns} onNavigate={onNavigate} compact />
        </aside>
      </div>

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
