import { memo, useMemo } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { usePlanPreview } from '@/components/preview';
import { formatDuration, formatNumber, formatThinking } from '@/lib/run-state/format';
import type { AgentThread, StoredEvent, DecisionPoint, Decision, MapReduceTimelineLane, MapReduceThreadDisplay } from '@/lib/run-state';
import type { PlanPresentation } from '@/lib/run-state/plan-presentation';
import type { AgentRole, PipelineStage, ReviewIssue, BuildStageSpec, ValidationCommandSpan } from '@/lib/run-state';
import { DecisionTimeline } from './decision-timeline';
import {
  EMPTY_EVENTS,
  EMPTY_SET,
  DEPTH_BAR_BG,
  prdPillClass,
  planPillClassFor,
  abbreviatePlanId,
  getAgentColor,
  VALIDATION_BAR_COLOR,
  PERSPECTIVE_ERROR_BAR_COLOR,
} from './pipeline-colors';
import { AGENT_TO_STAGE, REVIEW_AGENTS, resolveBuildStage } from './agent-stage-map';
import { ActivityOverlay } from './activity-overlay';
import { StageOverview, BuildStageProgress } from './stage-overview';
import { packIntoLanes } from './pack-lanes';

/** Below this rendered width, a bar's inline label is dropped (it would only
 *  show a clipped fragment); the agent name stays available via the tooltip. */
const MIN_LABEL_WIDTH_PERCENT = 4;

interface PlanRowProps {
  planId: string;
  threads: AgentThread[];
  sessionStart: number;
  totalSpan: number;
  endTime: number | null;
  issues?: ReviewIssue[];
  disablePreview?: boolean;
  hoveredStage: string | null;
  onStageHover: (stage: string | null) => void;
  eventsByAgent: Map<string, StoredEvent[]>;
  buildStages?: BuildStageSpec[];
  currentStage?: PipelineStage;
  prdSource?: { label: string; content: string } | null;
  planArtifact?: { name: string; body: string };
  /** Display-only metadata; all interactions continue to receive planId. */
  presentation?: PlanPresentation;
  dependsOn?: string[];
  depth?: number;
  compileStages?: string[];
  compileActiveStages?: Set<string>;
  compileCompletedStages?: Set<string>;
  validationCommands?: ValidationCommandSpan[];
  perspectiveErrors?: Array<{ perspective: string; error: string; timestamp: string }>;
  issuesByPerspective?: Record<string, ReviewIssue[]>;
  decisions?: DecisionPoint[];
  /** Map/reduce group-lane label + status tooltip (overrides the plain planId pill). */
  laneDisplay?: MapReduceTimelineLane;
  /** Per-agent bar label/tooltip overrides for map/reduce member threads, keyed by agentId. */
  threadDisplay?: Record<string, MapReduceThreadDisplay>;
  onDecisionSelect?: (decision: Decision) => void;
  onAgentSelect?: (agentId: string) => void;
  onStageSelect?: (stage: string) => void;
}

export function IssuesSummary({ issues }: { issues: ReviewIssue[] }) {
  const critical = issues.filter((i) => i.severity === 'critical').length;
  const warning = issues.filter((i) => i.severity === 'warning').length;
  const suggestion = issues.filter((i) => i.severity === 'suggestion').length;
  const parts: React.ReactNode[] = [];
  if (critical > 0) parts.push(<span key="c" className="text-red">{critical} critical</span>);
  if (warning > 0) parts.push(<span key="w" className="text-yellow">{warning} warning</span>);
  if (suggestion > 0) parts.push(<span key="s" className="text-text-dim">{suggestion} suggestion</span>);
  if (parts.length === 0) return null;
  return (
    <div className="text-10px mt-0.5 flex items-center gap-1">
      {parts.map((part, i) => (
        <span key={i} className="flex items-center gap-1">
          {i > 0 && <span className="opacity-30">·</span>}
          {part}
        </span>
      ))}
    </div>
  );
}

export function DepthBars({ depth }: { depth: number }) {
  if (depth <= 0) return null;
  return (
    <div className="flex items-stretch gap-1 self-stretch">
      {Array.from({ length: depth }).map((_, i) => (
        <div key={i} className={`w-0.5 self-stretch rounded-sm ${DEPTH_BAR_BG[i % DEPTH_BAR_BG.length]}`} />
      ))}
    </div>
  );
}

function PlanRowImpl({ planId, threads, sessionStart, totalSpan, endTime, issues, disablePreview, hoveredStage, onStageHover, eventsByAgent, buildStages, currentStage, prdSource, planArtifact, presentation, dependsOn, depth, compileStages, compileActiveStages, compileCompletedStages, validationCommands, perspectiveErrors, issuesByPerspective, decisions, laneDisplay, threadDisplay, onDecisionSelect, onAgentSelect, onStageSelect }: PlanRowProps) {
  const { openPreview, openContentPreview } = usePlanPreview();

  // Pack agent threads into the minimum number of lanes so sequential agents
  // (e.g. planner -> plan-reviewer -> plan-evaluator) share a single
  // row instead of cascading diagonally. Concurrent agents still fan out.
  const threadLanes = useMemo(
    () => packIntoLanes(
      threads,
      (t) => new Date(t.startedAt).getTime(),
      (t) => (t.endedAt ? new Date(t.endedAt).getTime() : (endTime ?? Date.now())),
    ),
    [threads, endTime],
  );

  // Pack validation commands into the minimum number of lanes so sequential
  // validations share a single row.
  const validationLanes = useMemo<ValidationCommandSpan[][]>(
    () => packIntoLanes(
      validationCommands ?? [],
      (s) => new Date(s.startedAt).getTime(),
      (s) => (s.endedAt ? new Date(s.endedAt).getTime() : (endTime ?? Date.now())),
    ),
    [validationCommands, endTime],
  );

  // Build tooltip text for plan pills
  const planTooltipText = useMemo(() => {
    const parts = presentation
      ? [...presentation.tooltip]
      : planArtifact
        ? [planArtifact.name || planId, `ID: ${planId}`]
        : [planId];
    if (dependsOn && dependsOn.length > 0) {
      const depLabels = dependsOn.map((d) => abbreviatePlanId(d)).join(', ');
      parts.push(`Depends on: ${depLabels}`);
    }
    return parts;
  }, [planId, planArtifact, presentation, dependsOn]);

  // Render left column label
  const leftLabel = (() => {
    if (prdSource) {
      return (
        <div className="flex items-stretch gap-1.5 min-w-0">
          <DepthBars depth={depth ?? 0} />
          <div className="flex-1 min-w-0 mt-0.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className={prdPillClass}
                  onClick={() => openContentPreview(prdSource.label, prdSource.content)}
                >
                  PRD
                </Button>
              </TooltipTrigger>
              <TooltipContent side="left">{prdSource.label}</TooltipContent>
            </Tooltip>
          </div>
        </div>
      );
    }
    if (planArtifact) {
      return (
        <div className="flex items-stretch gap-1.5 min-w-0">
          <DepthBars depth={depth ?? 0} />
          <div className="flex-1 min-w-0 mt-0.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className={`${planPillClassFor(depth ?? 0)} min-w-0 max-w-full justify-start`}
                  onClick={() => openPreview(planId, { name: planArtifact.name || planId, body: planArtifact.body })}
                >
                  <span className="truncate min-w-0">{presentation?.label ?? abbreviatePlanId(planId)}</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent side="left">
                {planTooltipText.map((line, i) => (
                  <div key={i}>{line}</div>
                ))}
              </TooltipContent>
            </Tooltip>
          </div>
        </div>
      );
    }
    if (laneDisplay) {
      return (
        <div className="flex items-stretch gap-1.5 min-w-0">
          <DepthBars depth={depth ?? 0} />
          <div className="flex-1 min-w-0 mt-0.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <span className={`${planPillClassFor(depth ?? 0)} cursor-default max-w-full`}>
                  <span className="truncate min-w-0">{laneDisplay.label}</span>
                </span>
              </TooltipTrigger>
              <TooltipContent side="left">
                {laneDisplay.tooltip.map((line, i) => (
                  <div key={i} className={i === 0 ? undefined : 'opacity-70'}>{line}</div>
                ))}
              </TooltipContent>
            </Tooltip>
          </div>
        </div>
      );
    }
    // Fallback: pill label
    return (
      <div className="flex items-stretch gap-1.5 min-w-0">
        <DepthBars depth={depth ?? 0} />
        <div className="flex-1 min-w-0 mt-0.5">
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className={`${planPillClassFor(depth ?? 0)} min-w-0 max-w-full justify-start`}
                onClick={disablePreview ? undefined : () => openPreview(planId)}
              >
                <span className="truncate min-w-0">{presentation?.label ?? abbreviatePlanId(planId)}</span>
              </Button>
            </TooltipTrigger>
            <TooltipContent side="left">
              {planTooltipText.map((line, i) => <div key={i}>{line}</div>)}
            </TooltipContent>
          </Tooltip>
        </div>
      </div>
    );
  })();

  // Renders two bare fragment children (left label + timeline content) that
  // become adjacent cells in the parent grid in thread-pipeline.tsx. Must be
  // rendered inside that two-column grid; it is not standalone.
  return (
    <>
      {leftLabel}
      <div className="flex flex-col gap-0.5 min-w-0 text-xs">
          {compileStages && (
            <StageOverview
              compile={compileStages}
              activeStages={compileActiveStages ?? EMPTY_SET}
              completedStages={compileCompletedStages ?? EMPTY_SET}
              hoveredStage={hoveredStage}
              onStageHover={onStageHover}
            />
          )}
          {!disablePreview && (
            <BuildStageProgress buildStages={buildStages} currentStage={currentStage} hoveredStage={hoveredStage} onStageHover={onStageHover} threads={threads} onStageSelect={onStageSelect} planId={planId} />
          )}
          {decisions && decisions.length > 0 && (
            <DecisionTimeline decisions={decisions} sessionStart={sessionStart} totalSpan={totalSpan} onDecisionSelect={onDecisionSelect} />
          )}
        <div className="bg-bg-tertiary rounded-sm overflow-hidden flex flex-col gap-px py-px min-h-4">
          {threadLanes.map((lane, laneIdx) => (
            <div key={`thread-lane-${laneIdx}`} className="relative h-4">
              {lane.map((thread) => {
            const threadStart = new Date(thread.startedAt).getTime();
            const threadEnd = thread.endedAt
              ? new Date(thread.endedAt).getTime()
              : (endTime ?? Date.now());
            const leftPercent = Math.max(0, ((threadStart - sessionStart) / totalSpan) * 100);
            const widthPercent = Math.max(0, Math.min(((threadEnd - threadStart) / totalSpan) * 100, 100 - leftPercent));
            const showLabel = widthPercent >= MIN_LABEL_WIDTH_PERCENT;
            const isRunning = thread.endedAt === null;
            const color = getAgentColor(thread.agent);
            const duration = thread.durationMs != null
              ? formatDuration(thread.durationMs)
              : isRunning
                ? 'running...'
                : formatDuration(threadEnd - threadStart);
            const display = threadDisplay?.[thread.agentId];
            const rawStage = AGENT_TO_STAGE[thread.agent as AgentRole];
            const stripStage = rawStage ? resolveBuildStage(rawStage, buildStages) : undefined;
            const isStripHighlighted = hoveredStage !== null && hoveredStage === stripStage;
            const isStripDimmed = hoveredStage !== null && hoveredStage !== stripStage;

            return (
                <Tooltip key={thread.agentId}>
                  <TooltipTrigger asChild>
                    <div
                      className={`absolute inset-y-0 rounded-sm border transition-all duration-150 ${color.bg} ${color.border} flex items-center overflow-hidden cursor-pointer${isStripHighlighted ? ' brightness-150 ring-1 ring-foreground/30' : ''}${isStripDimmed ? ' opacity-30' : ''}`}
                      style={{
                        left: `${leftPercent}%`,
                        width: `max(2px, ${widthPercent}%)`,
                        animation: isRunning ? 'pulse-opacity 2s ease-in-out infinite' : undefined,
                      }}
                      onMouseEnter={() => onStageHover(stripStage ?? null)}
                      onMouseLeave={() => onStageHover(null)}
                      onClick={() => onAgentSelect?.(thread.agentId)}
                      aria-label={`Open detail for ${thread.agent}`}
                    >
                      <ActivityOverlay
                        agentEvents={eventsByAgent.get(thread.agentId) ?? EMPTY_EVENTS}
                        threadStart={threadStart}
                        threadEnd={threadEnd}
                      />
                      {showLabel && (
                        <span className="text-9px truncate px-1 leading-4 text-foreground/70 relative z-10">
                          {display?.barLabel ?? thread.agent}{thread.totalTokens != null ? ` ${formatNumber(thread.totalTokens)}` : ''}
                        </span>
                      )}
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    {display ? (
                      <>
                        {display.tooltipLines.map((line, i) => (
                          <div key={i} className={i === 0 ? 'font-medium' : 'opacity-70'}>{line}</div>
                        ))}
                        <div className="opacity-50 text-10px">{thread.agent}</div>
                      </>
                    ) : (
                      <div className="font-medium">{thread.agent}</div>
                    )}
                    {(thread.harness || thread.model) && (
                      <div className="opacity-50 text-10px">
                        {[thread.harness, thread.model].filter(Boolean).join(' · ')}
                        {thread.harnessSource && (
                          <span className={thread.harnessSource === 'plan' ? ' text-blue-400' : ''}> ({thread.harnessSource})</span>
                        )}
                      </div>
                    )}
                    <div className={thread.effortSource === 'plan' ? 'text-blue-400 font-medium text-10px' : 'opacity-50 text-10px'}>
                      effort: {thread.effort
                        ? (thread.effortClamped && thread.effortOriginal
                          ? `${thread.effort} (clamped from ${thread.effortOriginal})`
                          : thread.effort)
                        : 'unset'}
                      {thread.effortSource && (
                        <span> ({thread.effortSource})</span>
                      )}
                    </div>
                    <div className={thread.thinkingSource === 'plan' ? 'text-blue-400 font-medium text-10px' : 'opacity-50 text-10px'}>
                      thinking: {thread.thinking
                        ? (thread.thinkingCoerced && thread.thinkingOriginal
                          ? `${thread.thinking} (coerced from ${formatThinking(thread.thinkingOriginal) ?? 'unknown'})`
                          : thread.thinking)
                        : 'unset'}
                      {thread.thinkingSource && (
                        <span> ({thread.thinkingSource})</span>
                      )}
                    </div>
                    {thread.tier && (
                      <div className={thread.tierSource === 'role' ? 'text-amber-400 font-medium text-10px' : 'opacity-50 text-10px'}>
                        tier: {thread.tier}
                        {thread.tierSource && (
                          <span> ({thread.tierSource})</span>
                        )}
                      </div>
                    )}
                    {thread.perspective && (
                      <div className="opacity-50 text-10px">
                        perspective: {thread.perspective}
                      </div>
                    )}
                    {thread.toolbelt !== undefined && (
                      <div className="opacity-50 text-10px">
                        toolbelt: {thread.toolbelt === null ? 'none' : thread.toolbelt}
                        {thread.toolbeltSource && ` (${thread.toolbeltSource})`}
                      </div>
                    )}
                    {thread.projectMcpSelection && (
                      <div className="opacity-50 text-10px">
                        project MCP: {thread.projectMcpSelection}
                      </div>
                    )}
                    {thread.projectMcpServerNames && thread.projectMcpServerNames.length > 0 && (
                      <div className="opacity-50 text-10px">
                        servers: {[...thread.projectMcpServerNames].sort().join(', ')}
                      </div>
                    )}
                    <div className="opacity-70">{duration}</div>
                    {thread.totalTokens != null && (
                      <div className="opacity-70">
                        {formatNumber(thread.totalTokens)} tokens
                        {thread.cacheRead != null && thread.inputTokens != null && thread.inputTokens > 0 && (
                          <span> ({Math.round(thread.cacheRead / thread.inputTokens * 100)}% cached)</span>
                        )}
                      </div>
                    )}
                    {thread.costUsd != null && thread.costUsd > 0 && (
                      <div className="opacity-70">${thread.costUsd.toFixed(4)}</div>
                    )}
                    {REVIEW_AGENTS.has(thread.agent) && (() => {
                      if (thread.perspective) {
                        const resolvedIssues = issuesByPerspective?.[thread.perspective] ?? [];
                        return resolvedIssues.length > 0 ? <IssuesSummary issues={resolvedIssues} /> : null;
                      }
                      return issues && issues.length > 0 ? <IssuesSummary issues={issues} /> : null;
                    })()}
                  </TooltipContent>
                </Tooltip>
            );
              })}
            </div>
          ))}
          {validationLanes.map((lane, laneIdx) => (
            <div key={`validation-lane-${laneIdx}`} className="relative h-4">
              {lane.map((span, idx) => {
                const spanStart = new Date(span.startedAt).getTime();
                const spanEnd = span.endedAt
                  ? new Date(span.endedAt).getTime()
                  : (endTime ?? Date.now());
                const leftPercent = Math.max(0, ((spanStart - sessionStart) / totalSpan) * 100);
                const widthPercent = Math.max(0, Math.min(((spanEnd - spanStart) / totalSpan) * 100, 100 - leftPercent));
                const showLabel = widthPercent >= MIN_LABEL_WIDTH_PERCENT;
                const isRunning = span.endedAt === null;
                const durationMs = spanEnd - spanStart;
                const durationStr = isRunning ? 'running...' : `${(durationMs / 1000).toFixed(1)}s`;
                const statusGlyph = span.status === 'passed' ? '✓' : span.status === 'failed' ? '✗' : span.status === 'timeout' ? '⧖' : '';
                const exitInfo = span.exitCode !== null ? ` (exit ${span.exitCode})` : '';

                return (
                  <Tooltip key={`validation-${laneIdx}-${idx}`}>
                    <TooltipTrigger asChild>
                      <div
                        className={`absolute inset-y-0 rounded-sm border transition-all duration-150 ${VALIDATION_BAR_COLOR.bg} ${VALIDATION_BAR_COLOR.border} flex items-center overflow-hidden cursor-default`}
                        style={{
                          left: `${leftPercent}%`,
                          width: `max(2px, ${widthPercent}%)`,
                          animation: isRunning ? 'pulse-opacity 2s ease-in-out infinite' : undefined,
                        }}
                      >
                        {showLabel && (
                          <span className="text-9px truncate px-1 leading-4 text-foreground/70 relative z-10">
                            {statusGlyph ? `${statusGlyph} ` : ''}{span.command}
                          </span>
                        )}
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="top">
                      <div className="font-medium">{span.command}</div>
                      <div className="opacity-70">{durationStr}</div>
                      {!isRunning && <div className="opacity-70">status: {span.status}{exitInfo}</div>}
                    </TooltipContent>
                  </Tooltip>
                );
              })}
            </div>
          ))}
          {perspectiveErrors && perspectiveErrors.length > 0 && (
            <div className="relative h-4">
              {perspectiveErrors.map((err, idx) => {
                const errTs = new Date(err.timestamp).getTime();
                const leftPercent = Math.max(0, ((errTs - sessionStart) / totalSpan) * 100);
                return (
                  <Tooltip key={`persp-err-${idx}`}>
                    <TooltipTrigger asChild>
                      <div
                        className={`absolute inset-y-0 rounded-sm border ${PERSPECTIVE_ERROR_BAR_COLOR.bg} ${PERSPECTIVE_ERROR_BAR_COLOR.border} flex items-center overflow-hidden cursor-default text-red`}
                        style={{
                          left: `${leftPercent}%`,
                          minWidth: '12px',
                          width: '12px',
                        }}
                      >
                        <span className="text-9px truncate px-0.5 leading-4 relative z-10">✗</span>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="top">
                      <div className="font-medium">Perspective error: {err.perspective}</div>
                      <div className="opacity-70 max-w-xs break-words">{err.error}</div>
                    </TooltipContent>
                  </Tooltip>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

export const PlanRow = memo(PlanRowImpl);
