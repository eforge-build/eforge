import * as React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import type { NowActiveBuildCard as NowActiveBuildCardModel } from '@/lib/selectors/now';
import type { MiniGanttRow, PipelineStage } from '@/lib/run-state';
import { formatDuration, truncateId } from '@/lib/format';
import { BuildPipelineStrip } from './build-pipeline-strip';
import { cn } from '@/lib/utils';

interface ActiveBuildCardProps {
  card: NowActiveBuildCardModel;
  onNavigate?: (href: string) => void;
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

const STAGE_LABELS: Partial<Record<PipelineStage, string>> = {
  plan: 'waiting',
  implement: 'implementation',
  'doc-author': 'docs',
  'doc-sync': 'doc sync',
  test: 'testing',
  review: 'review',
  evaluate: 'evaluation',
  complete: 'complete',
  failed: 'failed',
};

function stageLabel(stage: PipelineStage | undefined): string {
  return stage ? STAGE_LABELS[stage] ?? stage : 'waiting';
}

function nextStageLabel(stage: PipelineStage | undefined): string | null {
  switch (stage) {
    case undefined:
    case 'plan':
      return 'implementation';
    case 'implement':
    case 'doc-author':
    case 'doc-sync':
      return 'test/review';
    case 'test':
      return 'review';
    case 'review':
    case 'evaluate':
      return 'merge/land';
    default:
      return null;
  }
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

function shortPlanReference(row: MiniGanttRow): string {
  const planMatch = row.planId.match(/^plan-(\d+)/i);
  if (!planMatch) return row.planName;
  return `Plan ${planMatch[1].padStart(2, '0')}`;
}

function currentSummary(card: NowActiveBuildCardModel): string {
  if (card.latestError) return 'Needs attention';

  if (card.lifecycle.phase === 'prd-validation') {
    return 'Validating PRD against acceptance criteria';
  }
  if (card.lifecycle.phase === 'gap-close') {
    return `${card.latestAgent ? `${card.latestAgent} ` : ''}closing acceptance gaps`.trim();
  }
  if (card.lifecycle.phase === 'final-validation') {
    return 'Final PRD validation pass';
  }
  if (card.lifecycle.phase === 'landing') {
    return 'Landing completed work';
  }

  const activeRows = card.miniGanttRows.filter(isActivePlan);
  const activeWorkers = activeRows.reduce((sum, row) => sum + (row.activeWorkerCount ?? 0), 0);

  if (activeRows.length > 1) {
    const workerText = activeWorkers > 0
      ? ` · ${activeWorkers} worker${activeWorkers === 1 ? '' : 's'}`
      : '';
    return `${activeRows.length} plans active${workerText}`;
  }

  if (activeRows.length === 1) {
    const row = activeRows[0];
    const agent = row.activeAgents?.[0] ?? card.latestAgent;
    return `${agent ? `${agent} on ` : ''}${row.planName} · ${stageLabel(row.stage)}`;
  }

  if (card.planProgress.pending > 0) {
    const waitingRow = card.miniGanttRows.find((row) => !row.stage || row.stage === 'plan');
    if (card.planProgress.pending === 1 && waitingRow) {
      return `Waiting to start ${shortPlanReference(waitingRow)}`;
    }
    return `${card.planProgress.pending} plans waiting to start`;
  }

  if (card.planProgress.total > 0 && card.planProgress.complete === card.planProgress.total) {
    return 'All plans built; landing work remains';
  }

  if (card.latestAgent) return `${card.latestAgent} active`;
  if (card.currentPhase) return card.currentPhase;
  return 'Preparing build';
}

function nextSummary(card: NowActiveBuildCardModel): string | null {
  if (card.lifecycle.phase === 'prd-validation') {
    return 'gap close only if validation finds gaps';
  }
  if (card.lifecycle.phase === 'gap-close') {
    return 'final PRD validation pass';
  }
  if (card.lifecycle.phase === 'final-validation') {
    return 'land if acceptance criteria pass';
  }
  if (card.lifecycle.phase === 'landing') {
    return 'run completion';
  }

  const activeRows = card.miniGanttRows.filter(isActivePlan);
  const nextStages = Array.from(new Set(activeRows.map((row) => nextStageLabel(row.stage)).filter(Boolean)));
  const pieces: string[] = [];

  if (nextStages.length > 0) pieces.push(nextStages.join(' / '));
  if (card.planProgress.pending > 0) {
    pieces.push(`${card.planProgress.pending} waiting`);
  }
  if (pieces.length > 0) return pieces.join(' · ');

  if (card.planProgress.total > 0 && card.planProgress.complete === card.planProgress.total) {
    return 'PRD validation';
  }
  return null;
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

export function ActiveBuildCard({ card, onNavigate }: ActiveBuildCardProps) {
  const durationLabel = formatDuration(card.durationMs);
  const streamBadgeVariant = STREAM_STATUS_BADGE[card.streamStatus] ?? 'outline';

  const summaryLabel = progressSummary(card);
  const tokensLabel = card.tokens > 0 ? `${card.tokens.toLocaleString()} tok` : null;
  const costLabel = card.cost > 0 ? `$${card.cost.toFixed(4)}` : null;
  const cacheLabel =
    card.cachePercent > 0 ? `${Math.round(card.cachePercent)}% cache` : null;
  const railSteps = buildRailSteps(card);
  const current = currentSummary(card);
  const next = nextSummary(card);
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

        <div className="rounded-lg border border-border/70 bg-muted/10 p-2 text-xs">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="font-medium text-foreground truncate" title={current}>
                Current: {current}
              </div>
              {next && (
                <div className="mt-0.5 text-muted-foreground truncate" title={next}>
                  Next: {next}
                </div>
              )}
            </div>
            <div className="shrink-0 text-muted-foreground">{durationLabel}</div>
          </div>
          {card.latestProgress && (
            <p className="mt-1 truncate text-muted-foreground" title={card.latestProgress}>
              {card.latestProgress}
            </p>
          )}
          {card.latestError && (
            <p className="mt-1 truncate text-destructive" title={card.latestError}>
              {card.latestError}
            </p>
          )}
        </div>

        <BuildPipelineStrip
          rows={card.miniGanttRows}
          hasPlanningRow={card.hasPlanningRow}
          maxRows={4}
        />

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
