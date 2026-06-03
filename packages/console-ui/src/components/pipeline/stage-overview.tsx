import type { PipelineStage, BuildStageSpec } from '@/lib/run-state';
import type { AgentThread } from '@/lib/run-state';
import { STAGE_STATUS_STYLES } from './pipeline-colors';
import { getBuildStageStatuses, buildStageName, getStageStatus, type StageStatus } from './agent-stage-map';

// --- eforge:region plan-01-review-cycle-inspector ---
function StagePill({ stage, status = 'pending', hoveredStage, onStageHover, selectable, onSelect, ariaLabel }: {
  stage: string;
  status?: StageStatus;
  hoveredStage: string | null;
  onStageHover: (stage: string | null) => void;
  selectable?: boolean;
  onSelect?: () => void;
  ariaLabel?: string;
}) {
  const isHighlighted = hoveredStage === stage;
  const isDimmed = hoveredStage !== null && hoveredStage !== stage;
  const className = `px-1.5 py-0.5 rounded text-10px font-medium whitespace-nowrap transition-all duration-150 ${STAGE_STATUS_STYLES[status]}${isHighlighted ? ' ring-1 ring-foreground/40 brightness-125' : ''}${isDimmed ? ' opacity-40' : ''}${selectable ? ' cursor-pointer focus:outline-none focus:ring-1 focus:ring-offset-1 focus:ring-foreground/50' : ''}`;
  const hoverProps = {
    onMouseEnter: () => onStageHover(stage),
    onMouseLeave: () => onStageHover(null),
  };
  const style = status === 'active' ? { animation: 'pulse-opacity 2s ease-in-out infinite' } : undefined;

  if (selectable && onSelect) {
    return (
      <button
        type="button"
        className={className}
        style={style}
        onClick={onSelect}
        aria-label={ariaLabel}
        {...hoverProps}
      >
        {stage}
      </button>
    );
  }

  return (
    <span
      className={className}
      style={style}
      {...hoverProps}
    >
      {stage}
    </span>
  );
}
// --- eforge:endregion plan-01-review-cycle-inspector ---

export function Chevron() {
  return (
    <svg className="w-3 h-3 text-text-dim/30 shrink-0" viewBox="0 0 12 12" fill="none">
      <path d="M4 2l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function StageOverview({ compile, activeStages, completedStages, hoveredStage, onStageHover }: {
  compile: string[];
  activeStages: Set<string>;
  completedStages: Set<string>;
  hoveredStage: string | null;
  onStageHover: (stage: string | null) => void;
}) {
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {compile.map((stage, i) => (
        <div key={`c-${i}`} className="flex items-center gap-1">
          {i > 0 && <Chevron />}
          <StagePill stage={stage} status={getStageStatus(stage, activeStages, completedStages)} hoveredStage={hoveredStage} onStageHover={onStageHover} />
        </div>
      ))}
    </div>
  );
}

export function BuildStageProgress({ buildStages, currentStage, hoveredStage, onStageHover, threads, onStageSelect, planId }: {
  buildStages?: BuildStageSpec[];
  currentStage?: PipelineStage;
  hoveredStage: string | null;
  onStageHover: (stage: string | null) => void;
  threads?: AgentThread[];
  // --- eforge:region plan-01-review-cycle-inspector ---
  onStageSelect?: (stage: string) => void;
  planId?: string;
  // --- eforge:endregion plan-01-review-cycle-inspector ---
}) {
  if (!buildStages || buildStages.length === 0) return null;

  const statuses = getBuildStageStatuses(buildStages, currentStage, threads);

  return (
    <div className="flex items-center gap-1 flex-wrap mb-0.5">
      {buildStages.map((spec, i) => {
        const status = statuses[i];
        // --- eforge:region plan-01-review-cycle-inspector ---
        const renderPill = (stage: string) => {
          const selectable = stage === 'review-cycle' && onStageSelect !== undefined;
          return (
            <StagePill
              key={stage}
              stage={stage}
              status={status}
              hoveredStage={hoveredStage}
              onStageHover={onStageHover}
              selectable={selectable}
              onSelect={selectable ? () => onStageSelect(stage) : undefined}
              ariaLabel={selectable ? `Open ${stage} inspector for plan ${planId ?? 'unknown plan'}` : undefined}
            />
          );
        };
        // --- eforge:endregion plan-01-review-cycle-inspector ---
        if (Array.isArray(spec)) {
          // Parallel group: render in a bordered container
          return (
            <div key={`b-${i}`} className="flex items-center gap-1">
              {i > 0 && <Chevron />}
              <div className={`flex items-center gap-0.5 border rounded px-1 py-0.5 ${STAGE_STATUS_STYLES[status].replace(/bg-\S+/, '')} border-current/20`}>
                {spec.map((s) => renderPill(s))}
              </div>
            </div>
          );
        }
        return (
          <div key={`b-${i}`} className="flex items-center gap-1">
            {i > 0 && <Chevron />}
            {renderPill(spec)}
          </div>
        );
      })}
    </div>
  );
}
