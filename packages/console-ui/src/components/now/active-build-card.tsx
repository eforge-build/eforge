import * as React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { NowActiveBuildCard as NowActiveBuildCardModel } from '@/lib/selectors/now';
import type { MiniGanttRow } from '@/lib/run-state';
import { formatDuration, truncateId, compactTokens } from '@/lib/format';
import { MiniPlanSwimlane } from './mini-plan-swimlane';
import { PlanProgressRing } from '@/components/charts/plan-progress-ring';
import { VelocitySparkline } from '@/components/charts/velocity-sparkline';
import type { BuildMetricSamples } from '@/hooks/use-build-metric-history';
import { cn } from '@/lib/utils';

interface ActiveBuildCardProps {
  card: NowActiveBuildCardModel;
  onNavigate?: (href: string) => void;
  /** Rolling token/cost history for the velocity sparklines. */
  samples?: BuildMetricSamples;
}

const STREAM_STATUS_BADGE: Record<
  string,
  'default' | 'secondary' | 'destructive' | 'outline'
> = {
  connected: 'outline',
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

function buildRailSteps(card: NowActiveBuildCardModel): RailStep[] {
  const rows = card.miniGanttRows;
  const phase = card.lifecycle.phase;
  const hasPlans = rows.length > 0 || card.planProgress.total > 0;
  const hasFailures = card.planProgress.failed > 0 || rows.some((row) => row.isFailed);
  const plansComplete = card.planProgress.total > 0 && card.planProgress.complete === card.planProgress.total;
  const planningDone = card.hasPlanningRow || hasPlans;
  const plansDone = plansComplete || ['prd-validation', 'gap-close', 'final-validation', 'landing'].includes(phase);
  const plansActive = hasPlans && !plansDone;
  const prdValidationDone =
    card.lifecycle.prdValidationComplete ||
    card.lifecycle.gapCloseObserved ||
    phase === 'final-validation' ||
    phase === 'landing';
  const gapCloseDone = card.lifecycle.gapCloseComplete || phase === 'final-validation' || phase === 'landing';

  return [
    {
      key: 'prd',
      label: 'PRD',
      status: planningDone ? 'done' : 'active',
    },
    {
      key: 'plans',
      label: 'Plans',
      status: hasFailures ? 'failed' : plansDone ? 'done' : plansActive ? 'active' : 'pending',
    },
    {
      key: 'prd-validation',
      label: 'PRD check',
      status: phase === 'prd-validation' ? 'active' : prdValidationDone ? 'done' : 'pending',
    },
    {
      key: 'gap-close',
      label: 'Gap close',
      status: phase === 'gap-close' ? 'active' : gapCloseDone ? 'done' : 'pending',
    },
    {
      key: 'final-validation',
      label: 'Final check',
      status: phase === 'final-validation' ? 'active' : card.lifecycle.finalValidationComplete ? 'done' : 'pending',
    },
    {
      key: 'land',
      label: 'Land',
      status: phase === 'landing' || card.lifecycle.finalValidationComplete ? 'active' : 'pending',
    },
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

export function ActiveBuildCard({ card, onNavigate, samples }: ActiveBuildCardProps) {
  const durationLabel = formatDuration(card.durationMs);
  const streamBadgeVariant = STREAM_STATUS_BADGE[card.streamStatus] ?? 'outline';

  const summaryLabel = progressSummary(card);
  const tokensLabel = card.tokens > 0 ? `${card.tokens.toLocaleString()} tok` : null;
  const costLabel = card.cost > 0 ? `$${card.cost.toFixed(4)}` : null;
  const cacheLabel =
    card.cachePercent > 0 ? `${Math.round(card.cachePercent)}% cache` : null;
  const railSteps = buildRailSteps(card);
  const hasActivePlan = card.miniGanttRows.some(isActivePlan);
  const hasActiveLifecyclePhase = ['prd-validation', 'gap-close', 'final-validation', 'landing'].includes(card.lifecycle.phase);
  const showLivePulse = !card.latestError;

  const handleClick = () => onNavigate?.(card.href);
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') handleClick();
  };

  return (
    <Card
      role={onNavigate ? 'button' : undefined}
      tabIndex={onNavigate ? 0 : undefined}
      onClick={onNavigate ? handleClick : undefined}
      onKeyDown={onNavigate ? handleKeyDown : undefined}
      className={cn(
        'relative flex flex-col overflow-hidden border-border/80 shadow-sm',
        card.latestError && 'border-l-2 border-l-destructive ring-1 ring-destructive/25',
        onNavigate && [
          'cursor-pointer',
          'transition-shadow duration-150',
          'hover:ring-1 hover:ring-primary/40',
          'focus:outline-none focus:ring-2 focus:ring-ring',
        ],
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
            <CardTitle className="text-sm font-semibold truncate">
              {card.planSet || truncateId(card.sessionId)}
            </CardTitle>
            <p className="text-xs text-muted-foreground truncate">
              {summaryLabel ?? card.command}
            </p>
          </div>
          <Badge
            variant={streamBadgeVariant}
            className={cn(
              'shrink-0 capitalize text-xs',
              card.streamStatus === 'connected' && 'border-border/70 bg-muted/10 text-muted-foreground shadow-none',
            )}
          >
            {card.streamStatus}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="relative z-10 px-4 pb-4 space-y-3 flex-1">
        <BuildLifecycleRail steps={railSteps} />

        <div className="flex items-start justify-between gap-2 text-xs">
          <div className="min-w-0">
            {card.latestError ? (
              <p className="truncate text-destructive" title={card.latestError}>
                {card.latestError}
              </p>
            ) : card.latestProgress ? (
              <p className="truncate text-muted-foreground" title={card.latestProgress}>
                {card.latestProgress}
              </p>
            ) : null}
          </div>
          <span className="shrink-0 tabular-nums text-muted-foreground">{durationLabel}</span>
        </div>

        <MiniPlanSwimlane
          lanes={card.planLanes}
          planning={card.planning}
          hasPlanningRow={card.hasPlanningRow}
        />

        {/* Metrics: plan-progress ring + live token/cost velocity sparklines */}
        <div className="flex items-stretch gap-3">
          {card.planProgress.total > 0 && (
            <PlanProgressRing counts={card.planProgress} />
          )}
          <div className="grid min-w-0 flex-1 grid-cols-2 gap-2">
            <VelocitySparkline
              label="Tokens"
              display={`${compactTokens(card.tokens)} tok`}
              samples={samples?.tokens ?? []}
              color="var(--color-blue)"
            />
            <VelocitySparkline
              label="Cost"
              display={`$${card.cost.toFixed(2)}`}
              samples={samples?.cost ?? []}
              color="var(--color-green)"
            />
          </div>
        </div>

        <div className="flex items-center justify-between gap-3 border-t pt-2 text-xs text-muted-foreground">
          <span className="min-w-0 truncate">
            {card.profile ?? card.command}
            <span className="mx-1.5 text-border">·</span>
            <code className="font-mono">{truncateId(card.sessionId)}</code>
          </span>
          <span className="shrink-0 flex gap-2">
            {tokensLabel && <span>{tokensLabel}</span>}
            {costLabel && <span>{costLabel}</span>}
            {cacheLabel && <span>{cacheLabel}</span>}
          </span>
        </div>

        {onNavigate && (
          <div className="flex items-center justify-end">
            <span className="text-xs text-primary font-medium">
              Inspect →
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
