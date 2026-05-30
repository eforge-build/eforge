/**
 * BuildPipelineStrip — compact plan-lane visualization for active build cards.
 *
 * The dashboard version is intentionally higher-signal than the full run-detail
 * timeline: it shows one small rail per plan and active worker counts. When a
 * caller opts into row limiting, overflow is hidden behind an explicit
 * disclosure instead of being permanently summarized.
 */
import * as React from 'react';
import { cn } from '@/lib/utils';
import type { MiniGanttRow, PipelineStage } from '@/lib/run-state';

// ---------------------------------------------------------------------------
// Stage ordering and labels
// ---------------------------------------------------------------------------

const STAGE_LABELS: Partial<Record<PipelineStage, string>> = {
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

function stageLabel(stage: PipelineStage | undefined): string {
  return stage ? STAGE_LABELS[stage] ?? stage : 'waiting';
}

function rowTone(row: MiniGanttRow): string {
  if (row.isFailed) return 'text-destructive border-destructive/25 bg-destructive/10';
  if (row.isComplete) return 'text-primary border-primary/20 bg-primary/10';
  if (row.stage && row.stage !== 'plan') return 'text-blue border-blue/25 bg-blue/10';
  return 'text-muted-foreground border-border bg-muted/15';
}

// ---------------------------------------------------------------------------
// Row component
// ---------------------------------------------------------------------------

function shortPlanLabel(row: MiniGanttRow): string {
  const planMatch = row.planId.match(/^plan-(\d+)/i);
  if (!planMatch) return row.planName;
  const planNumber = planMatch[1].padStart(2, '0');
  return `Plan ${planNumber} · ${row.planName}`;
}

function PlanActivityTrack({ row, isActive }: { row: MiniGanttRow; isActive: boolean }) {
  const title = isActive
    ? 'Active work indicator — not a percentage estimate'
    : row.isComplete
      ? 'Plan complete'
      : row.isFailed
        ? 'Plan failed'
        : 'Plan waiting';

  return (
    <div className="col-span-2 h-1.5 overflow-hidden rounded-full bg-muted/25" title={title}>
      {row.isComplete && <div className="h-full w-full rounded-full bg-primary/70" />}
      {row.isFailed && <div className="h-full w-full rounded-full bg-destructive/80" />}
      {isActive && (
        <div className="h-full w-full rounded-full bg-blue/40 motion-safe:animate-pulse" />
      )}
    </div>
  );
}

function PlanRow({ row }: { row: MiniGanttRow }) {
  const activeWorkers = row.activeWorkerCount ?? 0;
  const stage = stageLabel(row.stage);
  const workerTitle = row.activeAgents?.length
    ? `Active workers: ${row.activeAgents.join(', ')}`
    : undefined;
  const planLabel = shortPlanLabel(row);

  const isActive = row.stage != null && row.stage !== 'plan' && !row.isComplete && !row.isFailed;

  return (
    <div
      className={cn(
        'grid grid-cols-[minmax(0,1fr)_auto] gap-x-2 gap-y-1 rounded-md border border-border/60 bg-muted/5 px-2 py-1.5 transition-colors',
        isActive && 'border-blue/35 bg-blue/5 shadow-sm shadow-blue/10',
      )}
      data-plan-id={row.planId}
    >
      <div className="min-w-0 flex items-center gap-2">
        <span className="truncate text-xs font-medium text-foreground" title={row.planName}>
          {planLabel}
        </span>
        {activeWorkers > 1 && (
          <span
            className="shrink-0 rounded-full bg-blue/15 px-1.5 py-0.5 text-xs font-medium text-blue"
            title={workerTitle}
          >
            {activeWorkers} workers
          </span>
        )}
        {activeWorkers === 1 && row.activeAgents?.[0] && (
          <span
            className="shrink-0 rounded-full bg-blue/10 px-1.5 py-0.5 text-xs text-blue"
            title={workerTitle}
          >
            {row.activeAgents[0]}
          </span>
        )}
      </div>
      <span
        className={cn(
          'row-span-2 self-center shrink-0 rounded-full border px-1.5 py-0.5 text-xs font-medium leading-none',
          rowTone(row),
        )}
      >
        {stage}
      </span>
      <PlanActivityTrack row={row} isActive={isActive} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// PRD planning row
// ---------------------------------------------------------------------------

function PrdRow() {
  return (
    <div className="flex items-center justify-between gap-2 rounded-md border border-border/60 bg-muted/5 px-2 py-1 text-xs text-muted-foreground">
      <span className="truncate italic">PRD planning</span>
      <span className="shrink-0 text-primary">✓ done</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// BuildPipelineStrip
// ---------------------------------------------------------------------------

export interface BuildPipelineStripProps {
  /** Mini-Gantt rows derived from RunState.earlyOrchestration.plans. */
  rows: MiniGanttRow[];
  /** True when planning events exist in the run state. */
  hasPlanningRow: boolean;
  /** Optional initial row limit; overflow is available through disclosure. */
  maxRows?: number;
}

export function BuildPipelineStrip({ rows, hasPlanningRow, maxRows }: BuildPipelineStripProps) {
  const [expanded, setExpanded] = React.useState(false);
  if (rows.length === 0 && !hasPlanningRow) return null;

  const shouldLimit = maxRows != null && rows.length > maxRows && !expanded;
  const visibleRows = shouldLimit ? rows.slice(0, maxRows) : rows;
  const hiddenCount = Math.max(0, rows.length - visibleRows.length);

  return (
    <div
      className="space-y-1.5 pt-2 border-t border-border"
      data-testid="build-pipeline-strip"
    >
      {hasPlanningRow && <PrdRow />}
      {visibleRows.map((row) => (
        <PlanRow key={row.planId} row={row} />
      ))}
      {hiddenCount > 0 && (
        <button
          type="button"
          className="w-full rounded-md border border-dashed border-border/70 px-2 py-1 text-left text-xs text-muted-foreground transition-colors hover:border-primary/60 hover:text-foreground"
          onClick={() => setExpanded(true)}
        >
          + {hiddenCount} more plan{hiddenCount === 1 ? '' : 's'} — show all
        </button>
      )}
    </div>
  );
}
