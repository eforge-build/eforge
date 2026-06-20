import * as React from 'react';
import type { ConsoleProjectState } from '@/lib/project-state';
import type { UseActiveSessionStreamsResult } from '@/hooks/use-active-session-streams';
import { selectNowDashboardModel, selectNowAttentionItems } from '@/lib/selectors/now';
import type { NowAttentionItem } from '@/lib/selectors/now';
import { NowStateBanner } from '@/components/now/now-state-banner';
import { AttentionPanel } from '@/components/now/attention-panel';
import { ActiveBuildsGrid } from '@/components/now/active-builds-grid';
import { QueueCard } from '@/components/now/queue-card';
import { MetricsPanel } from '@/components/now/metrics-panel';
import { SpendCard } from '@/components/now/spend-card';
import { BuildHistoryCard } from '@/components/now/build-history-card';
import { useSpend } from '@/hooks/use-spend';
import { useExtensionTrustList } from '@/hooks/use-extension-trust-list';
import { useExtensionTrustMutation } from '@/hooks/use-extension-trust-mutation';
import { selectNowSpendPanel } from '@/lib/selectors/spend';
import { StackSyncAlert } from '@/components/now/stack-sync-alert';
import { QueueRecoveryDialog } from '@/components/now/queue-recovery-dialog';
import { toConsolePath } from '@/lib/navigation';
import { useQueueControlActions } from '@/hooks/use-queue-control-actions';
import { useFailedEnqueueActions } from '@/hooks/use-failed-enqueue-actions';

// ---------------------------------------------------------------------------
// Attention partitioning
// ---------------------------------------------------------------------------

/**
 * The "Needs attention" strip carries daemon/stream health plus actionable PRD
 * failures. A failed build already ran, so it belongs here as a todo, not in the
 * Queue card. Forward queue waiting/blocked items stay in the Queue card (its
 * stack view already shows the blocking), so they are excluded here to avoid
 * duplicating that surface. Applied as the selector's `keep` predicate so the
 * exclusion happens before the visible-item cap — a trailing extension trust
 * warning can never be displaced by queue-blocked items the strip won't render.
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
  refreshRuns?: () => Promise<void> | void;
  refreshFailedEnqueues?: () => Promise<void> | void;
}

export function NowDashboard({ projectState, activeSessions, onNavigate, refreshQueue, refreshRuns, refreshFailedEnqueues }: NowDashboardProps) {
  const [tick, setTick] = React.useState(() => Date.now());

  React.useEffect(() => {
    const id = setInterval(() => setTick(Date.now()), 5_000);
    return () => clearInterval(id);
  }, []);

  const now = tick;

  // Extension trust is a REST read (GET /api/extensions/list), not part of the
  // SSE snapshot. Untrusted/changed project-team extensions surface as
  // actionable warnings in the Needs attention strip; the mutation hook trusts
  // them in place and refreshes the list so a trusted item disappears.
  const extensionTrustList = useExtensionTrustList();
  const extensionTrustMutation = useExtensionTrustMutation(extensionTrustList.refresh);

  const model = selectNowDashboardModel(projectState, activeSessions, now, extensionTrustList.extensions);

  // Spend is a REST aggregation (GET /api/spend), not part of the SSE snapshot.
  // Refetch when the run count changes so a completed build updates the totals.
  const spendSummary = useSpend(7, projectState.runs.length);
  const spendModel = React.useMemo(() => {
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
    return selectNowSpendPanel(spendSummary, todayStr);
  }, [spendSummary, tick]);

  // Recovery payload for the failed-PRD item the user chose to recover; opens
  // the dialog hosted at page root. Failures live in the attention strip now,
  // so the dialog is hosted here rather than inside the Queue card.
  const [recoveryItem, setRecoveryItem] =
    React.useState<NonNullable<NowAttentionItem['recovery']> | null>(null);

  // Derive the strip from the uncapped candidate list with the strip filter
  // applied before the cap, so the visible items and the hidden count both
  // describe only what the strip will render.
  const strip = selectNowAttentionItems(
    projectState,
    activeSessions.sessions,
    now,
    extensionTrustList.extensions,
    isStripAttentionItem,
  );

  const queueActions = useQueueControlActions({ refreshQueue, refreshRuns });
  const failedEnqueueActions = useFailedEnqueueActions({ refreshQueue, refreshRuns, refreshFailedEnqueues });

  return (
    <div data-testid="now-dashboard" className="mx-auto w-full max-w-[1600px] space-y-4">
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
            items={strip.items}
            hiddenCount={strip.hiddenCount}
            title="Needs attention"
            onRecover={setRecoveryItem}
            extensionTrust={{
              pendingPath: extensionTrustMutation.pendingPath,
              errors: extensionTrustMutation.errors,
              onTrust: (payload) => extensionTrustMutation.onTrust(payload.path),
            }}
            failedEnqueueControls={{
              pendingRunId: failedEnqueueActions.pendingRunId,
              errorsByRunId: failedEnqueueActions.errorsByRunId,
              onReenqueue: failedEnqueueActions.reenqueue,
            }}
          />
          <ActiveBuildsGrid
            cards={model.activeBuilds}
            onNavigate={onNavigate}
            onPreviewCascade={queueActions.previewCascade}
            onApplyCascade={queueActions.applyCascade}
          />
          {/* Queue owns intake too now: a "Preparing PRD" run is work entering
              the queue, shown as the Intake lane inside the card rather than as
              a full-width peer of active builds. The at-a-glance Intake/Queued/
              Active counts live in the global header (PipelineChips). */}
          <QueueCard
            stacks={model.queueStacks}
            summary={model.queue}
            enqueueCards={model.enqueueCards}
            onSetPriority={queueActions.setPriority}
            onOverrideDependency={queueActions.overrideDependency}
            onHold={queueActions.hold}
            onUnhold={queueActions.unhold}
            onPreviewCascade={queueActions.previewCascade}
            onApplyCascade={queueActions.applyCascade}
          />
        </div>

        {/* RAIL — glanceable reference widgets. Build history (one row per
            session, rolled up from its phase runs) replaces the former Git stack
            history card (a redundant landing log: a failed land is already a
            failed build, so it added no signal the Queue/Build health didn't).
            The activity log now lives on System (it's daemon-level event flow,
            not a Now glance widget); the landed-PRD → branch → PR reference also
            lives in System. */}
        <aside className="space-y-4 lg:sticky lg:top-4">
          <SpendCard model={spendModel} />
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
        dispatchFailure={recoveryItem?.dispatchFailure}
        onOpenChange={(open) => {
          if (!open) setRecoveryItem(null);
        }}
        refreshQueue={refreshQueue ?? (() => undefined)}
      />
    </div>
  );
}
