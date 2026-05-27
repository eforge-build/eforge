/**
 * BuildPipelineStrip — mini-Gantt pipeline visualization for an active build card.
 *
 * Renders one row per plan from RunState, plus an optional PRD row when planning
 * events exist. Each row shows the plan name alongside a horizontal strip of
 * stage-colored segments indicating progress through the build pipeline.
 *
 * Exported for reuse in plan-06 build-detail route.
 */
import * as React from 'react';
import { cn } from '@/lib/utils';
import type { MiniGanttRow, PipelineStage } from '@/lib/run-state';

// ---------------------------------------------------------------------------
// Stage ordering and color tokens
// ---------------------------------------------------------------------------

/** Ordered pipeline stages (excluding terminal states). */
const PIPELINE_STAGES: PipelineStage[] = [
  'plan',
  'implement',
  'doc-author',
  'doc-sync',
  'test',
  'review',
  'evaluate',
];

/** Map stage to its CSS background color class. */
function stageSegmentClass(
  segStage: PipelineStage,
  currentStage: PipelineStage | undefined,
  isComplete: boolean,
  isFailed: boolean,
): string {
  if (isFailed) {
    // All segments muted; last one red to indicate failure
    const segIdx = PIPELINE_STAGES.indexOf(segStage);
    const currentIdx = currentStage ? PIPELINE_STAGES.indexOf(currentStage) : -1;
    if (segIdx === currentIdx) return 'bg-destructive/80';
    if (segIdx < currentIdx) return 'bg-primary/30';
    return 'bg-muted/20';
  }
  if (isComplete) {
    return 'bg-primary/70';
  }
  if (!currentStage) {
    return 'bg-muted/20';
  }
  const segIdx = PIPELINE_STAGES.indexOf(segStage);
  const currentIdx = PIPELINE_STAGES.indexOf(currentStage);

  if (segIdx < currentIdx) return 'bg-primary/40';
  if (segIdx === currentIdx) return 'bg-primary';
  return 'bg-muted/20';
}

// ---------------------------------------------------------------------------
// Row component
// ---------------------------------------------------------------------------

function PlanRow({ row }: { row: MiniGanttRow }) {
  return (
    <div className="flex items-center gap-2 min-w-0" data-plan-id={row.planId}>
      <span className="shrink-0 w-24 truncate text-xs text-muted-foreground leading-none">
        {row.planName}
      </span>
      <div className="flex flex-1 gap-px h-1.5">
        {PIPELINE_STAGES.map((stage) => (
          <div
            key={stage}
            title={stage}
            className={cn(
              'flex-1 rounded-sm transition-colors',
              stageSegmentClass(stage, row.stage, row.isComplete, row.isFailed),
            )}
          />
        ))}
      </div>
      {row.isFailed && (
        <span className="shrink-0 text-xs text-destructive leading-none">failed</span>
      )}
      {row.isComplete && (
        <span className="shrink-0 text-xs text-primary leading-none">done</span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// PRD planning row
// ---------------------------------------------------------------------------

function PrdRow() {
  return (
    <div className="flex items-center gap-2 min-w-0">
      <span className="shrink-0 w-24 truncate text-xs text-muted-foreground italic leading-none">
        PRD planning
      </span>
      <div className="flex flex-1 gap-px h-1.5">
        <div
          className="flex-1 rounded-sm"
          style={{ backgroundColor: 'var(--color-blue)', opacity: 0.6 }}
          title="planning"
        />
      </div>
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
}

export function BuildPipelineStrip({ rows, hasPlanningRow }: BuildPipelineStripProps) {
  if (rows.length === 0 && !hasPlanningRow) return null;

  return (
    <div
      className="space-y-1.5 pt-2 border-t border-border"
      data-testid="build-pipeline-strip"
    >
      {hasPlanningRow && <PrdRow />}
      {rows.map((row) => (
        <PlanRow key={row.planId} row={row} />
      ))}
    </div>
  );
}
