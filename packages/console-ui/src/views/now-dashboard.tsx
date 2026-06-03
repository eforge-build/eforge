import * as React from 'react';
import type { ConsoleProjectState } from '@/lib/project-state';
import type { UseActiveSessionStreamsResult } from '@/hooks/use-active-session-streams';
import { selectNowDashboardModel } from '@/lib/selectors/now';
import type { NowAttentionItem } from '@/lib/selectors/now';
import { NowStateBanner } from '@/components/now/now-state-banner';
import { AttentionPanel } from '@/components/now/attention-panel';
import { ActiveBuildsGrid } from '@/components/now/active-builds-grid';
import { EnqueueCard } from '@/components/now/enqueue-card';
import { QueueCard } from '@/components/now/queue-card';
import { MetricsPanel } from '@/components/now/metrics-panel';
import { BuildHistoryCard } from '@/components/now/build-history-card';
import { StackSyncAlert } from '@/components/now/stack-sync-alert';
import { QueueRecoveryDialog } from '@/components/now/queue-recovery-dialog';
import { toConsolePath } from '@/lib/navigation';

// ---------------------------------------------------------------------------
// Attention partitioning
// ---------------------------------------------------------------------------

/**
 * The "Needs attention" strip carries daemon/stream health plus actionable PRD
 * failures (failed items, with the Recover action, and skipped cascade
 * artifacts). A failed build already ran, so it is not forward queue work — it
 * belongs here as a todo, not in the Queue card. Forward queue waiting/blocked
 * items stay in the Queue card (its stack view already shows the blocking), so
 * they are excluded here to avoid duplicating that surface.
 */
function isStripAttentionItem(item: NowAttentionItem): boolean {
  return (
    !item.id.startsWith('queue-blocked-') &&
    !item.id.startsWith('queue-stack-blocked-')
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

  React.useEffect(() => {
    const id = setInterval(() => setTick(Date.now()), 5_000);
    return () => clearInterval(id);
  }, []);

  const now = tick;
  const model = selectNowDashboardModel(projectState, activeSessions, now);

  // Recovery payload for the failed-PRD item the user chose to recover; opens
  // the dialog hosted at page root. Failures live in the attention strip now,
  // so the dialog is hosted here rather than inside the Queue card.
  const [recoveryItem, setRecoveryItem] =
    React.useState<NonNullable<NowAttentionItem['recovery']> | null>(null);

  // Strip carries daemon/stream health + actionable failures; forward queue
  // waiting/blocked items stay in the Queue card.
  const stripItems = React.useMemo(
    () => model.attention.filter(isStripAttentionItem),
    [model.attention],
  );

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-4">
      {/* Connection/state banner */}
      {model.connectionBanner && (
        <NowStateBanner banner={model.connectionBanner} />
      )}

      {/* Stack sync escalation — only a conflict/failed/stuck-deferred sync
          surfaces here; normal sync housekeeping lives on System. */}
      <StackSyncAlert
        sync={model.stackSync}
        hasActiveBuilds={model.activeBuilds.length > 0}
        onManage={onNavigate ? () => onNavigate(toConsolePath('system')) : undefined}
      />

      {/* Operational shell: a wide main column for live work (needs attention +
          active builds + queue) and a sticky rail of glanceable reference
          widgets. A single shared grid keeps every section's edges aligned
          instead of each section inventing its own width, and the rail rides up
          to the top alongside Needs attention. Collapses to one column below
          lg. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_360px] lg:items-start">
        {/* MAIN */}
        <div className="min-w-0 space-y-4">
          {/* Needs attention — daemon/stream health + actionable PRD failures
              (with the Recover action), leading the live-work column. */}
          <AttentionPanel
            items={stripItems}
            hiddenCount={model.attentionHiddenCount}
            title="Needs attention"
            onRecover={setRecoveryItem}
          />
          {model.enqueueCards.length > 0 && (
            <div className="grid grid-cols-1 gap-3">
              {model.enqueueCards.map((card) => (
                <EnqueueCard key={card.sessionId} card={card} />
              ))}
            </div>
          )}
          <ActiveBuildsGrid cards={model.activeBuilds} onNavigate={onNavigate} />
          <QueueCard stacks={model.queueStacks} summary={model.queue} />
        </div>

        {/* RAIL — glanceable reference widgets. Build history (one row per
            session, rolled up from its phase runs) replaces the former Git stack
            history card (a redundant landing log: a failed land is already a
            failed build, so it added no signal the Queue/Build health didn't).
            The activity log now lives on System (it's daemon-level event flow,
            not a Now glance widget); the landed-PRD → branch → PR reference also
            lives in System. */}
        <aside className="space-y-4 lg:sticky lg:top-4">
          <MetricsPanel model={model.metrics} />
          <BuildHistoryCard builds={model.builds} onNavigate={onNavigate} compact />
        </aside>
      </div>

      {/* Recovery dialog — opened from the Needs attention strip, hosted once at
          page root. */}
      <QueueRecoveryDialog
        open={recoveryItem != null}
        prdId={recoveryItem?.prdId ?? null}
        prdTitle={recoveryItem?.prdTitle}
        verdict={recoveryItem?.verdict}
        confidence={recoveryItem?.confidence}
        onOpenChange={(open) => {
          if (!open) setRecoveryItem(null);
        }}
        refreshQueue={refreshQueue ?? (() => undefined)}
      />
    </div>
  );
}
