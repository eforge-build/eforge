import * as React from 'react';
import { Card, CardContent, CardHeader } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { NowActiveBuildCard as NowActiveBuildCardModel } from '@/lib/selectors/now';
import type { MiniGanttRow, PhaseProgressStatus } from '@/lib/run-state';
import { formatDuration, truncateId, compactTokens } from '@/lib/format';
import { MiniPlanSwimlane } from './mini-plan-swimlane';
import { CancelBuildButton } from './cancel-build-button';
import { QueueCascadeAction } from './queue-cascade-action';
import type { QueueRowActionCallbacks } from './queue-row-actions';
import { cn } from '@/lib/utils';

interface ActiveBuildCardProps extends Pick<QueueRowActionCallbacks, 'onPreviewCascade' | 'onApplyCascade'> {
  card: NowActiveBuildCardModel;
  onNavigate?: (href: string) => void;
}

const STREAM_STATUS_BADGE: Record<
  string,
  'default' | 'secondary' | 'destructive' | 'outline'
> = {
  connecting: 'secondary',
  disconnected: 'destructive',
};

type RailStatus = 'done' | 'active' | 'pending' | 'failed';

interface RailStep {
  key: string;
  label: string;
  status: RailStatus;
}

function isActivePlan(row: MiniGanttRow): boolean {
  return Boolean(row.stage && row.stage !== 'plan' && !row.isComplete && !row.isFailed);
}

function phaseStatusToRail(status: PhaseProgressStatus): RailStatus {
  switch (status) {
    case 'failed': return 'failed';
    case 'running': return 'active';
    case 'passed':
    case 'skipped':
      return 'done';
    case 'pending': return 'pending';
  }
}

function buildRailSteps(card: NowActiveBuildCardModel): RailStep[] {
  const progress = card.phaseProgress;
  return [
    { key: 'prd', label: 'PRD', status: phaseStatusToRail(progress.prd) },
    { key: 'plans', label: 'Plans', status: phaseStatusToRail(progress.plans) },
    { key: 'prd-validation', label: 'PRD check', status: phaseStatusToRail(progress.prdValidation) },
    { key: 'gap-close', label: 'Gap close', status: phaseStatusToRail(progress.gapClose) },
    { key: 'final-validation', label: 'Final check', status: phaseStatusToRail(progress.finalValidation) },
    { key: 'land', label: 'Land', status: phaseStatusToRail(progress.landing) },
  ];
}

function stepClass(status: RailStatus): string {
  switch (status) {
    case 'done':
      return 'border-primary/25 bg-primary/15 text-primary';
    case 'active':
      return 'border-blue/35 bg-blue/15 text-blue ring-1 ring-blue/20 motion-safe:animate-pulse';
    case 'failed':
      return 'border-destructive/35 bg-destructive/15 text-destructive';
    case 'pending':
      return 'border-border bg-muted/20 text-muted-foreground';
  }
}

function stepSymbol(status: RailStatus): string {
  switch (status) {
    case 'done': return '✓';
    case 'active': return '●';
    case 'failed': return '!';
    case 'pending': return '○';
  }
}

function progressSummary(card: NowActiveBuildCardModel): string | null {
  const { total, complete, running, pending, failed } = card.planProgress;
  if (total === 0) return null;
  const parts: string[] = [];
  if (running > 0) parts.push(`${running} active`);
  parts.push(`${complete}/${total} complete`);
  if (pending > 0) parts.push(`${pending} waiting`);
  if (failed > 0) parts.push(`${failed} failed`);
  return parts.join(' · ');
}

function BuildLifecycleRail({ steps }: { steps: RailStep[] }) {
  return (
    <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6" aria-label="Build progress">
      {steps.map((step) => (
        <div
          key={step.key}
          className={cn(
            'flex min-w-0 items-center justify-center gap-1 rounded-full border px-1.5 py-1 text-xs font-medium leading-none',
            stepClass(step.status),
          )}
          title={`${step.label}: ${step.status}`}
        >
          <span aria-hidden="true">{stepSymbol(step.status)}</span>
          <span className="truncate">{step.label}</span>
        </div>
      ))}
    </div>
  );
}

export function ActiveBuildCard({ card, onNavigate, onPreviewCascade, onApplyCascade }: ActiveBuildCardProps) {
  const durationLabel = formatDuration(card.durationMs);
  const streamBadgeVariant = STREAM_STATUS_BADGE[card.streamStatus] ?? 'secondary';
  // "connected" is the silent default — the card's own pulse signals liveness —
  // so the badge only appears when the stream needs attention.
  const showStreamBadge = card.streamStatus !== 'connected';

  const summaryLabel = progressSummary(card);
  const tokensLabel = card.tokens > 0 ? `${compactTokens(card.tokens)} input tok` : null;
  const costLabel = card.cost > 0 ? `$${card.cost.toFixed(2)}` : null;
  const cacheLabel = card.cachePercent > 0 ? `${Math.round(card.cachePercent)}% cache` : null;
  // `durationLabel` (formatDuration) always returns a non-empty string, so
  // metricBits is never empty and `metricBits[0]` below is always defined.
  const metricBits = [durationLabel, tokensLabel, costLabel, cacheLabel].filter(
    (bit): bit is string => Boolean(bit),
  );

  const railSteps = buildRailSteps(card);
  const hasActivePlan = card.miniGanttRows.some(isActivePlan);
  const hasActiveLifecyclePhase = Object.values(card.phaseProgress).some((status) => status === 'running');
  // A terminal failure stops the pulse; a transient transport hiccup does not —
  // the build is still live and reconnecting.
  const showLivePulse = !card.latestError;

  const title = card.planSet || truncateId(card.sessionId);
  const navigate = onNavigate ? () => onNavigate(card.href) : undefined;

  return (
    <Card
      className={cn(
        'relative flex flex-col overflow-hidden border-border/80 shadow-sm',
        card.latestError && 'border-l-2 border-l-destructive ring-1 ring-destructive/25',
      )}
    >
      {showLivePulse && (
        <div
          className={cn(
            'pointer-events-none absolute inset-0 motion-safe:animate-pulse',
            hasActivePlan || hasActiveLifecyclePhase ? 'bg-blue/5' : 'bg-muted/10',
          )}
          aria-hidden="true"
        />
      )}
      <CardHeader className="relative z-10 pb-2 pt-4 px-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0 space-y-1">
            {navigate ? (
              <button
                type="button"
                onClick={navigate}
                className="block max-w-full truncate text-left text-sm font-semibold text-foreground transition-colors hover:text-primary hover:underline focus:outline-none focus-visible:text-primary focus-visible:underline"
                title="Open build detail"
              >
                {title}
              </button>
            ) : (
              <h3 className="truncate text-sm font-semibold text-foreground">{title}</h3>
            )}
            <p className="text-xs text-muted-foreground truncate">
              {summaryLabel ?? card.command}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {showStreamBadge && (
              <Badge variant={streamBadgeVariant} className="capitalize text-xs">
                {card.streamStatus}
              </Badge>
            )}
            {card.queueControl && (
              <QueueCascadeAction
                itemId={card.queueControl.prdId}
                itemTitle={card.queueControl.title}
                operation="cancel"
                capability={card.queueControl.capabilities?.cancel}
                cascadeCapability={card.queueControl.capabilities?.cascadeCancel}
                onPreviewCascade={onPreviewCascade}
                onApplyCascade={onApplyCascade}
              />
            )}
            <CancelBuildButton sessionId={card.sessionId} label={title} />
          </div>
        </div>
      </CardHeader>
      <CardContent className="relative z-10 px-4 pb-4 space-y-3 flex-1">
        <BuildLifecycleRail steps={railSteps} />

        {(card.latestError || card.transientNotice || card.latestProgress) && (
          <div className="text-xs">
            {card.latestError ? (
              <p className="truncate text-destructive" title={card.latestError}>
                {card.latestError}
              </p>
            ) : card.transientNotice ? (
              <p className="flex items-center gap-1.5 truncate text-yellow/90" title={card.transientNotice}>
                <span
                  className="h-1.5 w-1.5 shrink-0 rounded-full bg-yellow motion-safe:animate-pulse"
                  aria-hidden="true"
                />
                {card.transientNotice}
              </p>
            ) : (
              <p className="truncate text-muted-foreground" title={card.latestProgress ?? undefined}>
                {card.latestProgress}
              </p>
            )}
          </div>
        )}

        <MiniPlanSwimlane
          lanes={card.planLanes}
          planning={card.planning}
          hasPlanningRow={card.hasPlanningRow}
          planningStatus={card.phaseProgress.prd}
        />

        {/* Consolidated live status: elapsed time + spend + throughput, plus the
            agent running right now. Replaces the former plan-progress donut and
            token/cost sparklines (mostly-flat, low-signal at this size). */}
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t pt-2 text-xs tabular-nums text-muted-foreground">
          <span className="font-medium text-foreground">{metricBits[0]}</span>
          {metricBits.slice(1).map((bit) => (
            <React.Fragment key={bit}>
              <span className="text-border" aria-hidden="true">·</span>
              <span>{bit}</span>
            </React.Fragment>
          ))}
          {card.latestAgent && (
            <>
              <span className="text-border" aria-hidden="true">·</span>
              <span className="text-blue">{card.latestAgent}</span>
            </>
          )}
        </div>

        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="min-w-0 truncate">
            {card.profile ?? card.command}
            <span className="mx-1.5 text-border">·</span>
            <code className="font-mono">{truncateId(card.sessionId)}</code>
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
