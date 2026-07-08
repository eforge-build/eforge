import { memo, useMemo, useState } from 'react';
import { TooltipProvider } from '@/components/ui/tooltip';
import { SheetPanel } from '@/components/ui/sheet-panel';
import type { AgentThread, StoredEvent, DecisionPoint, Decision, MapReduceTimelineModel } from '@/lib/run-state';
import type { AgentRole, PipelineStage, ReviewIssue, OrchestrationConfig, BuildStageSpec, ValidationCommandSpan } from '@/lib/run-state';
import { decisionDetail, decisionSummary } from '@/lib/decision-format';
import { EMPTY_THREADS } from './pipeline-colors';
import { isFeatureBranchLane, isRegisteredPhaseLane, laneOrder } from '@/lib/run-state/lane-registry';
import { DecisionTimeline } from './decision-timeline';
import { AGENT_TO_STAGE, MIN_TIMELINE_WINDOW_MS } from './agent-stage-map';
import { ACTIVITY_STREAMING_TYPES } from './activity-overlay';
import { computeDepthMap } from './compute-depth-map';
import { PlanRow } from './plan-row';
import { AgentDetailSheet } from './agent-detail-sheet';
import { buildReviewCycleDetail } from './review-cycle-detail-model';
import { ReviewCycleDetailSheet } from './review-cycle-detail-sheet';

const VALIDATION_PHASE_LANES = new Set(['validation', 'final-validation']);

function validationLaneForStart(startedAt: string, events: StoredEvent[]): 'validation' | 'final-validation' {
  const startMs = new Date(startedAt).getTime();
  let gapCloseCompleted = false;

  for (const { event } of events) {
    const eventMs = new Date(event.timestamp).getTime();
    if (Number.isNaN(eventMs) || eventMs > startMs) continue;
    if (event.type === 'gap_close:complete') gapCloseCompleted = true;
  }

  return gapCloseCompleted ? 'final-validation' : 'validation';
}

function validationCommandsForLane(lane: string, validationCommands: ValidationCommandSpan[] | undefined, events: StoredEvent[]): ValidationCommandSpan[] | undefined {
  if (!VALIDATION_PHASE_LANES.has(lane) || !validationCommands || validationCommands.length === 0) return undefined;
  const spans = validationCommands.filter((span) => validationLaneForStart(span.startedAt, events) === lane);
  return spans.length > 0 ? spans : undefined;
}

function validationCommandLaneIds(validationCommands: ValidationCommandSpan[] | undefined, events: StoredEvent[]): string[] {
  if (!validationCommands || validationCommands.length === 0) return [];
  return Array.from(new Set(validationCommands.map((span) => validationLaneForStart(span.startedAt, events))));
}

const BASE_SYNC_LANE_ID = 'base-sync';

function baseSyncCommandsFromEvents(events: StoredEvent[]): ValidationCommandSpan[] | undefined {
  let startedAt: string | null = null;
  let endedAt: string | null = null;
  let status: ValidationCommandSpan['status'] = 'running';

  for (const { event } of events) {
    if (event.type === 'base-sync:start') {
      startedAt = event.timestamp;
      endedAt = null;
      status = 'running';
      continue;
    }
    if (startedAt === null) continue;
    if (event.type === 'base-sync:success') {
      endedAt = event.timestamp;
      status = 'passed';
    } else if (event.type === 'base-sync:budget:exhausted') {
      endedAt = event.timestamp;
      status = 'failed';
    }
  }

  if (startedAt === null) return undefined;
  return [{ command: 'Direct base sync', startedAt, endedAt, status, exitCode: null }];
}

interface ThreadPipelineProps {
  agentThreads: AgentThread[];
  startTime: number | null;
  endTime: number | null;
  planStatuses: Record<string, PipelineStage>;
  reviewIssues?: Record<string, ReviewIssue[]>;
  events: StoredEvent[];
  orchestration?: OrchestrationConfig | null;
  prdSource?: { label: string; content?: string } | null;
  planArtifacts?: Array<{ id: string; name: string; body: string }>;
  validationCommands?: ValidationCommandSpan[];
  perspectiveErrors?: Record<string, Array<{ perspective: string; error: string; timestamp: string }>>;
  reviewIssuesByPerspective?: Record<string, Record<string, ReviewIssue[]>>;
  decisions?: Record<string, DecisionPoint[]>;
  /**
   * Map/reduce timeline grouping (from `buildMapReduceTimeline`). Member agent
   * threads (planId == atomId / nodeId) collapse into the model's grouped lanes
   * (`Map atoms`, one lane per reduce level) instead of one row per member.
   */
  mapReduce?: MapReduceTimelineModel | null;
}

function ThreadPipelineImpl({ agentThreads, startTime, endTime, planStatuses, reviewIssues, events, orchestration, prdSource, planArtifacts, validationCommands, perspectiveErrors, reviewIssuesByPerspective, decisions, mapReduce }: ThreadPipelineProps) {
  const [hoveredStage, setHoveredStage] = useState<string | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [selectedDecision, setSelectedDecision] = useState<Decision | null>(null);
  const [selectedReviewCyclePlanId, setSelectedReviewCyclePlanId] = useState<string | null>(null);

  const planArtifactMap = useMemo(() => {
    const map = new Map<string, { name: string; body: string }>();
    if (planArtifacts) {
      for (const p of planArtifacts) {
        map.set(p.id, { name: p.name, body: p.body });
      }
    }
    return map;
  }, [planArtifacts]);

  const dependsByPlan = useMemo(() => {
    const map = new Map<string, string[]>();
    if (orchestration) {
      for (const plan of orchestration.plans) {
        if (plan.dependsOn.length > 0) {
          map.set(plan.id, plan.dependsOn);
        }
      }
    }
    return map;
  }, [orchestration]);

  const depthMap = useMemo(() => {
    if (!orchestration || orchestration.plans.length === 0) {
      return new Map<string, number>();
    }
    return computeDepthMap(orchestration.plans);
  }, [orchestration]);

  const { sessionStart, totalSpan } = useMemo(() => {
    const fallbackNow = endTime ?? Date.now();
    const start = startTime ?? fallbackNow;
    let maxEnd = fallbackNow;
    for (const thread of agentThreads) {
      if (thread.endedAt) {
        const end = new Date(thread.endedAt).getTime();
        if (end > maxEnd) maxEnd = end;
      }
    }
    return { sessionStart: start, totalSpan: Math.max(maxEnd - start, MIN_TIMELINE_WINDOW_MS) };
  }, [agentThreads, startTime, endTime]);

  const threadsByPlan = useMemo(() => {
    const map = new Map<string, AgentThread[]>();
    for (const thread of agentThreads) {
      const rawKey = thread.planId ?? '__global__';
      // Map/reduce member threads collapse into their grouped lane.
      const key = (thread.planId !== undefined && mapReduce?.laneIdByMember[thread.planId]) || rawKey;
      const arr = map.get(key);
      if (arr) {
        arr.push(thread);
      } else {
        map.set(key, [thread]);
      }
    }
    return map;
  }, [agentThreads, mapReduce]);

  const buildStagesByPlan = useMemo(() => {
    const map = new Map<string, BuildStageSpec[]>();
    if (orchestration) {
      for (const plan of orchestration.plans) {
        if (plan.build && plan.build.length > 0) {
          map.set(plan.id, plan.build);
        }
      }
    }
    return map;
  }, [orchestration]);

  const baseSyncCommands = useMemo(() => baseSyncCommandsFromEvents(events), [events]);

  const orderedPlanIds = useMemo(() => {
    const ids: string[] = [];
    const seen = new Set<string>();
    const add = (id: string) => {
      if (seen.has(id) || id === '__global__') return;
      seen.add(id);
      ids.push(id);
    };
    const realPlanIds = new Set<string>();
    for (const plan of orchestration?.plans ?? []) realPlanIds.add(plan.id);
    for (const plan of planArtifacts ?? []) realPlanIds.add(plan.id);
    const hasArtifactContext = (orchestration !== null && orchestration !== undefined) || (planArtifacts?.length ?? 0) > 0;
    const validationCommandIds = validationCommandLaneIds(validationCommands, events);
    const directBaseSyncLaneIds = baseSyncCommands ? [BASE_SYNC_LANE_ID] : [];
    const phaseLaneHasContent = (id: string) => threadsByPlan.has(id) || validationCommandIds.includes(id) || directBaseSyncLaneIds.includes(id);
    const isMapReduceLane = (id: string) => mapReduce?.laneIds.has(id) === true;
    const hasFeatureBranchThreads = (id: string) => isFeatureBranchLane(id) && threadsByPlan.has(id);
    const addPlanStatusLane = (id: string) => {
      if (!hasArtifactContext || realPlanIds.has(id) || isMapReduceLane(id) || hasFeatureBranchThreads(id) || (isRegisteredPhaseLane(id) && phaseLaneHasContent(id))) {
        add(id);
      }
    };

    // Seed from orchestration (preserves declared plan order), then artifacts,
    // then planStatuses defensively filtered against recovered artifacts, then
    // thread-backed lane keys, then validation-command phase lanes (commands are
    // emitted without planId but belong to validation).
    for (const plan of orchestration?.plans ?? []) add(plan.id);
    for (const plan of planArtifacts ?? []) add(plan.id);
    for (const id of Object.keys(planStatuses)) addPlanStatusLane(id);
    for (const id of threadsByPlan.keys()) addPlanStatusLane(id);
    for (const id of validationCommandIds) addPlanStatusLane(id);
    for (const id of directBaseSyncLaneIds) addPlanStatusLane(id);

    // Sort the full set by lane registry order; map/reduce group lanes join the
    // planning tier (order 0) so the compile phase reads chronologically. Within
    // the same order tier, preserve the insertion order (orchestration-declared
    // plans first, then first-thread-start order).
    const orderByIndex = new Map(ids.map((id, i) => [id, i]));
    const orderFor = (id: string) => (isMapReduceLane(id) ? 0 : laneOrder(id));
    ids.sort((a, b) => {
      const orderDiff = orderFor(a) - orderFor(b);
      if (orderDiff !== 0) return orderDiff;
      return (orderByIndex.get(a) ?? 0) - (orderByIndex.get(b) ?? 0);
    });

    return ids;
  }, [orchestration, planArtifacts, planStatuses, threadsByPlan, validationCommands, events, mapReduce, baseSyncCommands]);

  const mapReduceLaneById = useMemo(
    () => new Map((mapReduce?.lanes ?? []).map((lane) => [lane.id, lane])),
    [mapReduce],
  );

  const globalThreads = threadsByPlan.get('__global__') ?? EMPTY_THREADS;
  const hasGlobalThreads = globalThreads.length > 0;
  const hasPrdSource = prdSource !== null && prdSource !== undefined;
  const hasPlanningLane = orderedPlanIds.includes('planning');
  const hasThreadContent = orderedPlanIds.length > 0 || hasGlobalThreads || hasPrdSource;

  const { activeStages, completedStages } = useMemo(() => {
    const active = new Set<string>();
    const seen = new Set<string>();
    const running = new Set<string>();

    for (const thread of agentThreads) {
      const stage = AGENT_TO_STAGE[thread.agent as AgentRole];
      if (!stage) continue;
      seen.add(stage);
      if (thread.endedAt === null) {
        running.add(stage);
      }
    }

    const completed = new Set<string>();
    for (const stage of seen) {
      if (running.has(stage)) {
        active.add(stage);
      } else {
        completed.add(stage);
      }
    }

    return { activeStages: active, completedStages: completed };
  }, [agentThreads]);

  const eventsByAgent = useMemo(() => {
    const map = new Map<string, StoredEvent[]>();
    for (const stored of events) {
      const { event } = stored;
      if (!ACTIVITY_STREAMING_TYPES.has(event.type)) continue;
      if (!('agentId' in event)) continue;
      const aid = (event as { agentId: string }).agentId;
      let arr = map.get(aid);
      if (!arr) {
        arr = [];
        map.set(aid, arr);
      }
      arr.push(stored);
    }
    return map;
  }, [events]);

  const selectedThread = agentThreads.find((t) => t.agentId === selectedAgentId) ?? null;

  const selectedReviewCycleDetail = useMemo(() => {
    if (!selectedReviewCyclePlanId) return null;
    return buildReviewCycleDetail(
      events,
      threadsByPlan.get(selectedReviewCyclePlanId) ?? EMPTY_THREADS,
      selectedReviewCyclePlanId,
      decisions?.[selectedReviewCyclePlanId] ?? [],
    );
  }, [events, threadsByPlan, selectedReviewCyclePlanId, decisions]);

  const handleAgentSelect = (agentId: string) => {
    setSelectedDecision(null);
    setSelectedReviewCyclePlanId(null);
    setSelectedAgentId(agentId);
  };

  const handleDecisionSelect = (decision: Decision) => {
    setSelectedAgentId(null);
    setSelectedReviewCyclePlanId(null);
    setSelectedDecision(decision);
  };

  const handleStageSelect = (planId: string, stage: string) => {
    if (stage !== 'review-cycle') return;
    setSelectedAgentId(null);
    setSelectedDecision(null);
    setSelectedReviewCyclePlanId(planId);
  };

  const handleReviewCycleOpenAgent = handleAgentSelect;

  return (
    <TooltipProvider delayDuration={0}>
      <div>
        <h3 className="text-11px uppercase tracking-wider text-text-dim mb-2 flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-blue" />
          Pipeline
        </h3>

        {decisions?.['__run__'] && decisions['__run__'].length > 0 && (
          <div className="mb-2">
            <DecisionTimeline decisions={decisions['__run__']} sessionStart={sessionStart} totalSpan={totalSpan} label="Planning decisions" onDecisionSelect={handleDecisionSelect} />
          </div>
        )}

        {!hasThreadContent ? (
          <div className="text-11px text-text-dim italic">Waiting for agent activity...</div>
        ) : (
          <div className="grid grid-cols-[fit-content(180px)_minmax(0,1fr)] gap-x-2 gap-y-1.5 items-start">
            {hasGlobalThreads && (
              <PlanRow
                key="__compile__"
                planId="Compile"
                threads={globalThreads}
                sessionStart={sessionStart}
                totalSpan={totalSpan}
                endTime={endTime}
                disablePreview
                hoveredStage={hoveredStage}
                onStageHover={setHoveredStage}
                eventsByAgent={eventsByAgent}
                prdSource={!hasPlanningLane && prdSource ? { label: prdSource.label, content: prdSource.content ?? '' } : null}
                compileActiveStages={activeStages}
                compileCompletedStages={completedStages}
                onAgentSelect={handleAgentSelect}
              />
            )}
            {!hasGlobalThreads && !hasPlanningLane && prdSource && (
              <PlanRow
                key="__resume_source__"
                planId="Source"
                threads={EMPTY_THREADS}
                sessionStart={sessionStart}
                totalSpan={totalSpan}
                endTime={endTime}
                disablePreview
                hoveredStage={hoveredStage}
                onStageHover={setHoveredStage}
                eventsByAgent={eventsByAgent}
                prdSource={{ label: prdSource.label, content: prdSource.content ?? '' }}
                onAgentSelect={handleAgentSelect}
              />
            )}
            {orderedPlanIds.map((planId) => (
              <PlanRow
                key={planId}
                planId={planId}
                threads={threadsByPlan.get(planId) ?? EMPTY_THREADS}
                sessionStart={sessionStart}
                totalSpan={totalSpan}
                endTime={endTime}
                issues={reviewIssues?.[planId]}
                hoveredStage={hoveredStage}
                onStageHover={setHoveredStage}
                eventsByAgent={eventsByAgent}
                buildStages={buildStagesByPlan.get(planId)}
                currentStage={planStatuses[planId]}
                planArtifact={planArtifactMap.get(planId)}
                dependsOn={dependsByPlan.get(planId)}
                depth={depthMap.get(planId) ?? 0}
                perspectiveErrors={perspectiveErrors?.[planId]}
                issuesByPerspective={reviewIssuesByPerspective?.[planId]}
                decisions={decisions?.[planId]}
                validationCommands={planId === BASE_SYNC_LANE_ID ? baseSyncCommands : validationCommandsForLane(planId, validationCommands, events)}
                prdSource={planId === 'planning' && prdSource ? { label: prdSource.label, content: prdSource.content ?? '' } : undefined}
                laneDisplay={mapReduceLaneById.get(planId)}
                threadDisplay={mapReduce?.displayByAgentId}
                disablePreview={planId === 'planning'}
                onDecisionSelect={handleDecisionSelect}
                onAgentSelect={handleAgentSelect}
                onStageSelect={(stage) => handleStageSelect(planId, stage)}
              />
            ))}
          </div>
        )}

        <ReviewCycleDetailSheet
          detail={selectedReviewCycleDetail}
          open={selectedReviewCyclePlanId !== null}
          onClose={() => setSelectedReviewCyclePlanId(null)}
          onOpenAgent={handleReviewCycleOpenAgent}
        />
        {selectedDecision && (
          <SheetPanel
            open={selectedDecision !== null}
            onClose={() => setSelectedDecision(null)}
            title={`Decision: ${selectedDecision.kind}`}
            description={decisionSummary(selectedDecision)}
          >
            <pre className="text-xs font-mono whitespace-pre-wrap break-words bg-bg-secondary rounded p-3 overflow-auto max-h-[60vh] m-4">
              {decisionDetail(selectedDecision)}
            </pre>
          </SheetPanel>
        )}
        <AgentDetailSheet
          thread={selectedThread}
          events={events}
          open={selectedAgentId !== null}
          onClose={() => setSelectedAgentId(null)}
        />
      </div>
    </TooltipProvider>
  );
}

export const ThreadPipeline = memo(ThreadPipelineImpl);
