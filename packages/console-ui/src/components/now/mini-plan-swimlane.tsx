/**
 * MiniPlanSwimlane — compact per-plan swimlane for active build cards.
 *
 * A trimmed, read-only cousin of the run-detail ThreadPipeline. Instead of a
 * shared time axis (illegible at card width), each plan gets a left-to-right
 * build-stage track with the current stage highlighted, plus the agent(s)
 * running right now and their live token totals. Stage status is computed with
 * the same helpers the detail view uses, so the two stay consistent.
 *
 * The stage track shows *position*, not percent-complete; the agent token bar
 * shows *relative magnitude* across the card. Neither implies progress.
 */
import * as React from 'react';
import { cn } from '@/lib/utils';
import { compactTokens } from '@/lib/format';
import type { PlanLane, PlanLaneAgent, PlanningLane, PipelineStage } from '@/lib/run-state';
import { STAGE_STATUS_STYLES } from '@/components/pipeline/pipeline-colors';
import { Chevron } from '@/components/pipeline/stage-overview';
import { getBuildStageStatuses, buildStageName, type StageStatus } from '@/components/pipeline/agent-stage-map';

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

const FALLBACK_STAGE_LABELS: Partial<Record<PipelineStage, string>> = {
  plan: 'waiting',
  implement: 'implement',
  'doc-author': 'docs',
  'doc-sync': 'doc sync',
  test: 'test',
  review: 'review',
  evaluate: 'evaluate',
  complete: 'done',
  failed: 'failed',
};

function shortPlanLabel(lane: PlanLane): string {
  const planMatch = lane.planId.match(/^plan-(\d+)/i);
  if (!planMatch) return lane.planName;
  return `Plan ${planMatch[1].padStart(2, '0')} · ${lane.planName}`;
}

function isLaneActive(lane: PlanLane): boolean {
  return lane.stage != null && lane.stage !== 'plan' && !lane.isComplete && !lane.isFailed;
}

// ---------------------------------------------------------------------------
// Stage track
// ---------------------------------------------------------------------------

function StageChip({ label, status }: { label: string; status: StageStatus }) {
  return (
    <span
      className={cn(
        'rounded px-1.5 py-0.5 text-10px font-medium leading-none whitespace-nowrap',
        STAGE_STATUS_STYLES[status],
      )}
      style={status === 'active' ? { animation: 'pulse-opacity 2s ease-in-out infinite' } : undefined}
    >
      {label}
    </span>
  );
}

function MiniStageTrack({ lane }: { lane: PlanLane }) {
  if (lane.buildStages.length === 0) {
    // Fallback: no compiled build sequence — show the single current stage.
    if (!lane.stage) return null;
    const status: StageStatus = lane.isComplete
      ? 'completed'
      : lane.isFailed
        ? 'failed'
        : isLaneActive(lane)
          ? 'active'
          : 'pending';
    return (
      <div className="flex flex-wrap items-center gap-1">
        <StageChip label={FALLBACK_STAGE_LABELS[lane.stage] ?? lane.stage} status={status} />
      </div>
    );
  }

  const statuses = getBuildStageStatuses(lane.buildStages, lane.stage);
  return (
    <div className="flex flex-wrap items-center gap-1">
      {lane.buildStages.map((spec, i) => (
        <div key={`${buildStageName(spec)}-${i}`} className="flex items-center gap-1">
          {i > 0 && <Chevron />}
          <StageChip label={buildStageName(spec)} status={statuses[i]} />
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Running agents
// ---------------------------------------------------------------------------

function AgentLine({ agent, maxTokens }: { agent: PlanLaneAgent; maxTokens: number }) {
  const widthPct = maxTokens > 0 && agent.tokens > 0 ? Math.max(2, (agent.tokens / maxTokens) * 100) : 0;
  return (
    <div className="flex items-center gap-2">
      <span
        className={cn(
          'h-1.5 w-1.5 shrink-0 rounded-full',
          agent.running ? 'bg-blue motion-safe:animate-pulse' : 'bg-muted-foreground/40',
        )}
        aria-hidden="true"
      />
      <span className={cn('shrink-0 text-xs font-medium', agent.running ? 'text-blue' : 'text-muted-foreground')}>
        {agent.agent}
      </span>
      {agent.tokens > 0 && (
        <span className="shrink-0 text-10px tabular-nums text-muted-foreground">
          {compactTokens(agent.tokens)}
        </span>
      )}
      {widthPct > 0 && (
        <div
          className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-muted/25"
          title="Relative token usage across this build"
        >
          <div
            className={cn('h-full rounded-full', agent.running ? 'bg-blue/45' : 'bg-muted-foreground/30')}
            style={{ width: `${widthPct}%` }}
          />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Plan lane
// ---------------------------------------------------------------------------

function statusIcon(lane: PlanLane): React.ReactNode {
  if (lane.isFailed) return <span className="shrink-0 text-xs text-destructive">failed</span>;
  if (lane.isComplete) return <span className="shrink-0 text-xs text-primary">✓ done</span>;
  if (!isLaneActive(lane)) return <span className="shrink-0 text-xs text-muted-foreground">waiting</span>;
  return null;
}

function PlanLaneRow({ lane, maxTokens }: { lane: PlanLane; maxTokens: number }) {
  const active = isLaneActive(lane);
  return (
    <div
      className={cn(
        'space-y-1.5 rounded-md border border-border/60 bg-muted/5 px-2 py-1.5',
        active && 'border-blue/35 bg-blue/5 shadow-sm shadow-blue/10',
        lane.isFailed && 'border-destructive/35 bg-destructive/5',
      )}
      data-plan-id={lane.planId}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-xs font-medium text-foreground" title={lane.planName}>
          {shortPlanLabel(lane)}
        </span>
        {statusIcon(lane)}
      </div>
      <MiniStageTrack lane={lane} />
      {lane.agents.length > 0 && (
        <div className="space-y-1">
          {lane.agents.map((agent, i) => (
            <AgentLine key={`${agent.agent}-${i}`} agent={agent} maxTokens={maxTokens} />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// PRD (planning) lane
// ---------------------------------------------------------------------------

function PrdLaneRow({ planning, maxTokens }: { planning: PlanningLane; maxTokens: number }) {
  return (
    <div
      className={cn(
        'space-y-1.5 rounded-md border border-border/60 bg-muted/5 px-2 py-1.5',
        planning.running && 'border-blue/35 bg-blue/5 shadow-sm shadow-blue/10',
      )}
      data-plan-id="__prd__"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 rounded bg-yellow/15 px-1.5 py-0.5 text-10px font-semibold uppercase tracking-wide text-yellow/80">
            PRD
          </span>
          <span className="truncate text-xs font-medium text-foreground">planning</span>
        </span>
        {!planning.running && <span className="shrink-0 text-xs text-primary">✓ done</span>}
      </div>
      {planning.agents.length > 0 && (
        <div className="space-y-1">
          {planning.agents.map((agent, i) => (
            <AgentLine key={`${agent.agent}-${i}`} agent={agent} maxTokens={maxTokens} />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// MiniPlanSwimlane
// ---------------------------------------------------------------------------

export interface MiniPlanSwimlaneProps {
  lanes: PlanLane[];
  planning: PlanningLane;
  /** True when planning events exist in the run state (shows the PRD lane). */
  hasPlanningRow: boolean;
  /** Optional initial lane limit; overflow is available through disclosure. */
  maxRows?: number;
}

export function MiniPlanSwimlane({ lanes, planning, hasPlanningRow, maxRows }: MiniPlanSwimlaneProps) {
  const [expanded, setExpanded] = React.useState(false);
  if (lanes.length === 0 && !hasPlanningRow) return null;

  // Normalize token bars across every agent on the card (planning + plans) so a
  // single agent never fills the bar and lanes stay comparable.
  const maxTokens = lanes.reduce(
    (max, lane) => lane.agents.reduce((m, a) => Math.max(m, a.tokens), max),
    planning.agents.reduce((m, a) => Math.max(m, a.tokens), 0),
  );

  const shouldLimit = maxRows != null && lanes.length > maxRows && !expanded;
  const visibleLanes = shouldLimit ? lanes.slice(0, maxRows) : lanes;
  const hiddenCount = Math.max(0, lanes.length - visibleLanes.length);

  return (
    <div className="space-y-1.5 border-t border-border pt-2" data-testid="mini-plan-swimlane">
      {hasPlanningRow && <PrdLaneRow planning={planning} maxTokens={maxTokens} />}
      {visibleLanes.map((lane) => (
        <PlanLaneRow key={lane.planId} lane={lane} maxTokens={maxTokens} />
      ))}
      {hiddenCount > 0 && (
        <button
          type="button"
          className="w-full rounded-md border border-dashed border-border/70 px-2 py-1 text-left text-xs text-muted-foreground transition-colors hover:border-primary/60 hover:text-foreground"
          onClick={(e) => {
            e.stopPropagation();
            setExpanded(true);
          }}
        >
          + {hiddenCount} more plan{hiddenCount === 1 ? '' : 's'} — show all
        </button>
      )}
    </div>
  );
}
