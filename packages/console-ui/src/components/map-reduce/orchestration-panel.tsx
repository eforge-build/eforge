/**
 * Top-level map/reduce orchestration panel (Phase 3).
 *
 * The conditional entry point shown in place of the generic pipeline when
 * `isMapReduceRun` is true. Composes the compact `OrchestrationSummary` with the
 * vertical `StageBoard`, and owns the Board / Timeline toggle. "Timeline" renders
 * the `timeline` node supplied by the caller (the existing `PipelineSection`),
 * kept as the secondary "where is time spent" view; the panel itself stays
 * decoupled from the run-detail views.
 *
 * Derives the summary and board from `runState` via the pure selectors so the
 * whole panel is Storybook-fixturable from a single RunState.
 */
import { useMemo, useState } from 'react';
import type { RunState } from '@/lib/run-state';
import { buildMapReduceSummary, buildMapReduceBoard } from '@/lib/run-state';
import { OrchestrationSummary } from './orchestration-summary';
import { StageBoard } from './stage-board';
import { cn } from '@/lib/utils';

type PanelView = 'board' | 'timeline';

interface OrchestrationPanelProps {
  runState: RunState;
  /** Called with a node id (== planId) when a board node is clicked. */
  onSelectNode?: (planId: string) => void;
  /** The planId currently filtering the log, highlighted in the board. */
  selectedPlanId?: string | null;
  /** The fallback timeline view (the generic `PipelineSection`) for "Timeline" mode. */
  timeline: React.ReactNode;
}

function ToggleButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'px-2 py-0.5 text-11px rounded transition-colors',
        active ? 'bg-bg-secondary text-text-bright' : 'text-text-dim hover:text-text-bright',
      )}
    >
      {children}
    </button>
  );
}

export function OrchestrationPanel({ runState, onSelectNode, selectedPlanId, timeline }: OrchestrationPanelProps) {
  const [view, setView] = useState<PanelView>('board');

  const summary = useMemo(
    () => (runState.mapReduce ? buildMapReduceSummary(runState.mapReduce, runState.agentThreads) : null),
    [runState.mapReduce, runState.agentThreads],
  );
  const board = useMemo(
    () => (runState.mapReduce ? buildMapReduceBoard(runState.mapReduce, runState.agentThreads) : null),
    [runState.mapReduce, runState.agentThreads],
  );

  return (
    <div className="flex flex-col gap-3 px-6 py-3">
      <div className="flex items-center justify-end">
        <div className="inline-flex items-center gap-0.5 rounded-md border border-border p-0.5">
          <ToggleButton active={view === 'board'} onClick={() => setView('board')}>Board</ToggleButton>
          <ToggleButton active={view === 'timeline'} onClick={() => setView('timeline')}>Timeline</ToggleButton>
        </div>
      </div>

      {view === 'board' ? (
        <div className="flex flex-col gap-3">
          {summary && <OrchestrationSummary summary={summary} />}
          {board && <StageBoard board={board} onSelectNode={onSelectNode} selectedPlanId={selectedPlanId} />}
        </div>
      ) : (
        timeline
      )}
    </div>
  );
}
