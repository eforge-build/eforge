/**
 * Plan progress selectors for the run-state subsystem.
 *
 * Provides plan status counts, current stage per plan, and mini-Gantt row
 * data derived from RunState.
 */
import type { RunState, PipelineStage, BuildStageSpec } from '../types';
import { isFeatureBranchLane, isRegisteredPhaseLane, laneLabel, laneOrder } from '../lane-registry';
import { planPresentation } from '../plan-presentation';

// --- eforge:region plan-status-and-gantt ---

/** Status counts across all plans in the run. */
export interface PlanStatusCounts {
  pending: number;
  running: number;
  complete: number;
  failed: number;
  total: number;
}

/**
 * Returns the count of plans in each status bucket.
 * Stages 'plan', 'implement', 'doc-author', 'doc-sync', 'test', 'review', 'review-fix', 'evaluate'
 * are treated as "running" (in-progress). 'complete' and 'failed' are terminal.
 * Plans without a status entry are counted as 'pending'.
 */
export function selectPlanStatusCounts(state: RunState): PlanStatusCounts {
  const planIds = selectAllPlanIds(state);
  let pending = 0;
  let running = 0;
  let complete = 0;
  let failed = 0;

  for (const id of planIds) {
    const stage = state.planStatuses[id];
    if (!stage || stage === 'plan') {
      pending++;
    } else if (stage === 'complete') {
      complete++;
    } else if (stage === 'failed') {
      failed++;
    } else {
      running++;
    }
  }

  return { pending, running, complete, failed, total: planIds.size };
}

/** All plan IDs known to the run state (from orchestration, resume artifacts, or statuses). */
function selectAllPlanIds(state: RunState): Set<string> {
  const ids = new Set<string>();
  const artifactPlans = state.resumeArtifacts;
  const orchestrationPlans = state.earlyOrchestration?.plans ?? [];
  if ((state.earlyOrchestration !== null && state.earlyOrchestration !== undefined) || artifactPlans.length > 0) {
    for (const plan of orchestrationPlans) ids.add(plan.id);
    for (const plan of artifactPlans) ids.add(plan.id);
    return ids;
  }
  for (const id of Object.keys(state.planStatuses)) ids.add(id);
  return ids;
}

/** The current pipeline stage for a specific plan, or undefined if not tracked. */
export function selectCurrentStageForPlan(state: RunState, planId: string): PipelineStage | undefined {
  return state.planStatuses[planId];
}

/** A row in the mini-Gantt chart for a plan. */
export interface MiniGanttRow {
  planId: string;
  planName: string;
  stage: PipelineStage | undefined;
  dependsOn: string[];
  isComplete: boolean;
  isFailed: boolean;
  /** Number of currently running agent threads for this plan. */
  activeWorkerCount: number;
  /** Agent role labels for currently running threads on this plan. */
  activeAgents: string[];
}

/**
 * Returns mini-Gantt rows for all plans, ordered by plan position in
 * earlyOrchestration (or alphabetically by planId if no orchestration).
 */
export function selectMiniGanttRows(state: RunState): MiniGanttRow[] {
  const orchPlans = state.earlyOrchestration?.plans ?? [];
  const allIds = selectAllPlanIds(state);
  const activeAgentsByPlan = new Map<string, string[]>();

  for (const thread of state.agentThreads) {
    if (!thread.planId || thread.endedAt !== null) continue;
    const agents = activeAgentsByPlan.get(thread.planId);
    if (agents) {
      agents.push(thread.agent);
    } else {
      activeAgentsByPlan.set(thread.planId, [thread.agent]);
    }
  }

  function makeRow(planId: string, planName: string, dependsOn: string[] = []): MiniGanttRow {
    const stage = state.planStatuses[planId];
    const activeAgents = activeAgentsByPlan.get(planId) ?? [];
    return {
      planId,
      planName,
      stage,
      dependsOn,
      isComplete: stage === 'complete',
      isFailed: stage === 'failed',
      activeWorkerCount: activeAgents.length,
      activeAgents,
    };
  }

  if (orchPlans.length > 0) {
    return orchPlans.map((plan) => makeRow(plan.id, plan.name, plan.dependsOn ?? []));
  }

  if (state.resumeArtifacts.length > 0) {
    return state.resumeArtifacts.map((plan) => makeRow(plan.id, plan.name, plan.dependsOn ?? []));
  }

  // Fallback: no orchestration — use planStatuses keys
  return Array.from(allIds).sort().map((id) => makeRow(id, id));
}

// --- eforge:endregion plan-status-and-gantt ---

// ---------------------------------------------------------------------------
// Plan-lane selectors (mini swimlane for the Now dashboard active-build cards)
// ---------------------------------------------------------------------------
// --- eforge:region plan-lanes ---

/** A single agent participating in a lane, with its accumulated token total. */
export interface PlanLaneAgent {
  /** Agent role label (e.g. 'builder', 'planner'). */
  agent: string;
  /** Total tokens accumulated by this agent so far (0 while a result is pending). */
  tokens: number;
  /** True when at least one thread for this agent is still running. */
  running: boolean;
}

/** A per-plan lane for the mini swimlane: stage track + the agents that ran on it. */
export interface PlanLane {
  /** Canonical ID used for selection, dependencies, and requests. */
  planId: string;
  /** Readable plan name, without presentation numbering. */
  planName: string;
  /** Display-only numbered label for declared plans. */
  presentationLabel?: string;
  /** Display-only tooltip lines; canonical ID is always included. */
  presentationTooltip?: readonly [string, string];
  /** Current pipeline stage for the plan, or undefined when not yet started. */
  stage: PipelineStage | undefined;
  /** Build-stage sequence from earlyOrchestration (empty when not compiled). */
  buildStages: BuildStageSpec[];
  isComplete: boolean;
  isFailed: boolean;
  /** Every agent that has worked the plan (one entry per role), in start order. */
  agents: PlanLaneAgent[];
}

/** Planning-phase lane summary (global, plan-less agents like planner/plan-reviewer). */
export interface PlanningLane {
  /** Aggregated planning agents (one entry per role), in start order. */
  agents: PlanLaneAgent[];
  /** True while any planning/map-reduce planning work is still running. */
  running: boolean;
}

function laneAgentTokens(thread: RunState['agentThreads'][number]): number {
  return thread.totalTokens ?? 0;
}

type OrderedPlanLaneAgent = PlanLaneAgent & { startedAt: string };

/**
 * Aggregates a set of agent threads into one entry per agent role: tokens are
 * summed across the role's threads (e.g. multiple review rounds), `running` is
 * true if any thread is still live, and entries are ordered by first start.
 */
function aggregateLaneAgentsWithStart(threads: RunState['agentThreads']): OrderedPlanLaneAgent[] {
  const order: string[] = [];
  const byAgent = new Map<string, { tokens: number; running: boolean; startedAt: string }>();
  for (const thread of threads) {
    const existing = byAgent.get(thread.agent);
    if (existing) {
      existing.tokens += laneAgentTokens(thread);
      existing.running = existing.running || thread.endedAt === null;
      if (thread.startedAt < existing.startedAt) existing.startedAt = thread.startedAt;
    } else {
      order.push(thread.agent);
      byAgent.set(thread.agent, { tokens: laneAgentTokens(thread), running: thread.endedAt === null, startedAt: thread.startedAt });
    }
  }
  return order
    .map((agent) => ({ agent, ...byAgent.get(agent)! }))
    .sort((a, b) => (a.startedAt < b.startedAt ? -1 : a.startedAt > b.startedAt ? 1 : 0));
}

function stripAgentStart(agents: OrderedPlanLaneAgent[]): PlanLaneAgent[] {
  return agents.map(({ agent, tokens, running }) => ({ agent, tokens, running }));
}

function aggregateLaneAgents(threads: RunState['agentThreads']): PlanLaneAgent[] {
  return stripAgentStart(aggregateLaneAgentsWithStart(threads));
}

// Lane labels and ordering are now sourced from the single lane registry
// (lib/run-state/lane-registry.ts). See laneLabel() / laneOrder().

/**
 * Earliest `gap_close:complete` timestamp in the run (ms since epoch), or null
 * when gap close has not completed. Computed once per selection so span
 * classification is O(spans + events) instead of O(spans x events).
 *
 * This is the single split point between first-round PRD validation and final
 * validation: every consumer that partitions validation activity around gap
 * close (plan lanes, phase progress, run-detail pipeline) must use it so the
 * surfaces cannot disagree about which side a span belongs to.
 */
export function earliestGapCloseCompleteMs(events: RunState['events']): number | null {
  let earliest: number | null = null;
  for (const { event } of events) {
    if (event.type !== 'gap_close:complete') continue;
    const eventMs = new Date(event.timestamp).getTime();
    if (Number.isNaN(eventMs)) continue;
    if (earliest === null || eventMs < earliest) earliest = eventMs;
  }
  return earliest;
}

function validationLaneForStart(startedAt: string, gapCloseCompleteMs: number | null): 'validation' | 'final-validation' {
  if (gapCloseCompleteMs === null) return 'validation';
  const startMs = new Date(startedAt).getTime();
  // A NaN start compares false here, matching the previous per-event scan
  // where an unparseable span start let any gap_close:complete event qualify.
  return gapCloseCompleteMs > startMs ? 'validation' : 'final-validation';
}

function validationCommandSpansByLane(state: RunState): Map<string, RunState['validationCommands']> {
  const byLane = new Map<string, RunState['validationCommands']>();
  const gapCloseCompleteMs = earliestGapCloseCompleteMs(state.events);
  for (const span of state.validationCommands) {
    const laneId = validationLaneForStart(span.startedAt, gapCloseCompleteMs);
    const spans = byLane.get(laneId);
    if (spans) {
      spans.push(span);
    } else {
      byLane.set(laneId, [span]);
    }
  }
  return byLane;
}

/**
 * True when the chronologically last item worked in a phase lane is a
 * validation command that failed or timed out. A run that aborts on a failed
 * final-validation command leaves every span ended, which would otherwise
 * derive completion and render "done" on a terminally failed phase. Agent
 * threads carry no pass/fail outcome, so a thread as the latest item keeps
 * the ended-means-done behavior (a later fixer round supersedes the failure).
 */
function lastLaneOutcomeFailed(
  threads: RunState['agentThreads'],
  spans: RunState['validationCommands'],
): boolean {
  let latestStart = '';
  let failed = false;
  for (const thread of threads) {
    if (thread.startedAt >= latestStart) {
      latestStart = thread.startedAt;
      failed = false;
    }
  }
  for (const span of spans) {
    if (span.startedAt >= latestStart) {
      latestStart = span.startedAt;
      failed = span.status === 'failed' || span.status === 'timeout';
    }
  }
  return failed;
}

/**
 * Returns per-plan lanes for the mini swimlane, ordered the same way as
 * {@link selectMiniGanttRows}. Each lane carries the build-stage sequence
 * (when the run was compiled) and every agent that has worked the plan with
 * its accumulated token total (running agents flagged live).
 *
 * Plans declared in `earlyOrchestration` come first, in declared order.
 * Dynamically-added lifecycle lanes (e.g. `gap-close`, compiled on demand and
 * thus absent from the orchestration) are appended afterwards so the card
 * swimlane stays consistent with the run-detail pipeline, which surfaces them
 * via `planStatuses`.
 */
export function selectPlanLanes(state: RunState): PlanLane[] {
  const orchPlans = state.earlyOrchestration?.plans ?? [];
  const artifactPlans = state.resumeArtifacts;
  const sourcePlans = orchPlans.length > 0 ? orchPlans : artifactPlans;
  const hasArtifactContext = (state.earlyOrchestration !== null && state.earlyOrchestration !== undefined) || artifactPlans.length > 0;
  const buildByPlan = new Map<string, BuildStageSpec[]>();
  for (const plan of sourcePlans) {
    buildByPlan.set(plan.id, plan.build ?? []);
  }

  const threadsByPlan = new Map<string, RunState['agentThreads']>();
  for (const thread of state.agentThreads) {
    if (!thread.planId) continue;
    const arr = threadsByPlan.get(thread.planId);
    if (arr) {
      arr.push(thread);
    } else {
      threadsByPlan.set(thread.planId, [thread]);
    }
  }

  const validationSpansByLane = validationCommandSpansByLane(state);

  // Phase lanes (validation, gap-close, final-validation) never receive
  // plan:status:change events, so without a derived signal a finished phase
  // would render as "waiting" forever. When no explicit status exists, treat a
  // phase lane as complete once it has content and nothing is still running —
  // a new fixer round re-activates it by starting a fresh thread. Explicit
  // planStatuses entries always win. A lane whose last outcome is a
  // failed/timed-out validation command never derives completion: everything
  // has ended, but the phase terminally failed rather than finished.
  const derivedLaneComplete = (planId: string, stage: PipelineStage | undefined): boolean => {
    if (stage !== undefined || (!isRegisteredPhaseLane(planId) && !isFeatureBranchLane(planId))) return false;
    const threads = threadsByPlan.get(planId) ?? [];
    const spans = validationSpansByLane.get(planId) ?? [];
    if (threads.length === 0 && spans.length === 0) return false;
    if (lastLaneOutcomeFailed(threads, spans)) return false;
    return threads.every((t) => t.endedAt !== null) && spans.every((s) => s.endedAt !== null);
  };

  const makeLane = (planId: string, planName: string, declarationIndex?: number): PlanLane => {
    const stage = state.planStatuses[planId];
    const presentation = declarationIndex === undefined ? undefined : planPresentation(declarationIndex, planName, planId);
    return {
      planId,
      planName,
      presentationLabel: presentation?.label,
      presentationTooltip: presentation?.tooltip,
      stage,
      buildStages: buildByPlan.get(planId) ?? [],
      isComplete: stage === 'complete' || derivedLaneComplete(planId, stage),
      isFailed: stage === 'failed',
      agents: aggregateLaneAgents(threadsByPlan.get(planId) ?? []),
    };
  };

  if (!hasArtifactContext) {
    return Array.from(selectAllPlanIds(state)).sort().map((id) => makeLane(id, id));
  }

  const lanes = sourcePlans.map((plan, index) => makeLane(plan.id, plan.name, index));

  // Append dynamically-added lanes (e.g. gap-close, validation, final-validation)
  // that have a status or live agents but were never part of the compiled
  // orchestration. Exclude 'planning' — it has its own dedicated row via
  // selectPlanningLane. Order by the lane registry instead of alphabetically.
  const known = new Set(sourcePlans.map((plan) => plan.id));
  const extras = new Set<string>();
  const phaseLaneHasContent = (id: string) => threadsByPlan.has(id) || validationSpansByLane.has(id);
  for (const id of Object.keys(state.planStatuses)) {
    if (known.has(id)) continue;
    if (isRegisteredPhaseLane(id) && phaseLaneHasContent(id)) extras.add(id);
  }
  for (const id of threadsByPlan.keys()) {
    if (!known.has(id) && (isRegisteredPhaseLane(id) || isFeatureBranchLane(id))) extras.add(id);
  }
  for (const id of validationSpansByLane.keys()) {
    if (!known.has(id) && isRegisteredPhaseLane(id)) extras.add(id);
  }
  // Order-0 phases fold into the dedicated planning row: 'planning' itself via
  // selectPlanningLane, and the pre-planning compiler phases (satisfaction
  // gate, repository exploration) whose threads roll into that same lane.
  for (const id of Array.from(extras)) {
    if (laneOrder(id) === 0) extras.delete(id);
  }
  for (const id of Array.from(extras).sort((a, b) => laneOrder(a) - laneOrder(b) || a.localeCompare(b))) {
    lanes.push(makeLane(id, laneLabel(id)));
  }

  return lanes;
}

// --- eforge:endregion plan-lanes ---

// --- eforge:region planning-lane ---

/**
 * Pre-planning compiler phases that fold into the planning lane. Their agent
 * threads are relabelled by phase so they stay distinguishable from the
 * planner agents proper in the expanded lane.
 *
 * Must stay in sync with the order-0 phase lanes in the lane registry
 * (lib/run-state/lane-registry.ts) minus 'planning' itself; exported so the
 * selector tests can enforce that invariant.
 */
export const PRE_PLANNING_AGENT_LABELS: Record<string, string> = {
  'satisfaction-gate': 'satisfaction-gate',
  'repository-exploration': 'repo-exploration',
};

/**
 * Aggregates map/reduce planning work into synthetic lane agents: one entry
 * for the map atoms and one per reduce depth, each summing member-thread
 * tokens and flagged running while any member is queued/running.
 */
function mapReducePlanningAgents(state: RunState): OrderedPlanLaneAgent[] {
  const mr = state.mapReduce;
  if (!mr) return [];

  const memberThreads = new Map<string, RunState['agentThreads']>();
  for (const thread of state.agentThreads) {
    if (!thread.planId) continue;
    const arr = memberThreads.get(thread.planId);
    if (arr) arr.push(thread);
    else memberThreads.set(thread.planId, [thread]);
  }

  const firstEventByMember = new Map<string, string>();
  const noteTime = (id: string, timestamp: string) => {
    const existing = firstEventByMember.get(id);
    if (existing === undefined || timestamp < existing) firstEventByMember.set(id, timestamp);
  };
  for (const { event } of state.events) {
    if (event.type === 'planning:map-reduce:atoms') for (const atom of event.atoms) noteTime(atom.atomId, event.timestamp);
    else if (event.type === 'planning:map-reduce:reduce-tree') for (const node of event.nodes) noteTime(node.nodeId, event.timestamp);
    else if (event.type === 'planning:map-reduce:atom:status') noteTime(event.atomId, event.timestamp);
    else if (event.type === 'planning:map-reduce:reduce:status') noteTime(event.nodeId, event.timestamp);
  }

  const memberAgent = (label: string, ids: string[], runningByStatus: boolean): OrderedPlanLaneAgent => {
    const threads = ids.flatMap((id) => memberThreads.get(id) ?? []);
    const startedAt = ids.reduce((earliest, id) => {
      const eventTime = firstEventByMember.get(id) ?? '';
      const threadTime = (memberThreads.get(id) ?? []).reduce((first, thread) => (first === '' || thread.startedAt < first ? thread.startedAt : first), '');
      const time = [eventTime, threadTime].filter(Boolean).sort()[0] ?? '';
      return earliest === '' || (time !== '' && time < earliest) ? time : earliest;
    }, '');
    return {
      agent: label,
      tokens: threads.reduce((sum, thread) => sum + laneAgentTokens(thread), 0),
      running: runningByStatus || threads.some((thread) => thread.endedAt === null),
      startedAt,
    };
  };

  const agents: OrderedPlanLaneAgent[] = [];
  if (mr.atomOrder.length > 0) {
    agents.push(memberAgent(
      `map atoms (${mr.atomOrder.length})`,
      mr.atomOrder,
      mr.atomOrder.some((id) => {
        const status = mr.atoms[id]?.status;
        return status === 'queued' || status === 'running';
      }),
    ));
  }

  const depths = [...new Set(mr.reduceOrder.map((id) => mr.reduceNodes[id]?.depth).filter((depth): depth is number => typeof depth === 'number'))].sort((a, b) => a - b);
  for (const depth of depths) {
    const ids = mr.reduceOrder.filter((id) => mr.reduceNodes[id]?.depth === depth);
    agents.push(memberAgent(
      `reduce L${depth + 1} (${ids.length})`,
      ids,
      ids.some((id) => {
        const status = mr.reduceNodes[id]?.status;
        return status === 'queued' || status === 'running';
      }),
    ));
  }

  return agents;
}

/**
 * Returns the planning-phase lane summary built from planning agents plus the
 * pre-planning compiler phases (PRD-satisfaction gate and repository
 * exploration), aggregating tokens per agent role.
 *
 * The pre-planning phases run before the planner and are conceptually part of
 * planning, so their threads roll into this lane instead of rendering as
 * separate swimlane rows. Validation-fixer / prd-validator threads (planId
 * 'validation' / 'final-validation') remain excluded and render in their own
 * phase lanes.
 */
export function selectPlanningLane(state: RunState): PlanningLane {
  const threads = state.agentThreads
    .filter((t) => t.planId === 'planning' || (t.planId != null && Object.hasOwn(PRE_PLANNING_AGENT_LABELS, t.planId)))
    .map((t) => (t.planId === 'planning' ? t : { ...t, agent: PRE_PLANNING_AGENT_LABELS[t.planId!] }));
  const orderedAgents = [...aggregateLaneAgentsWithStart(threads), ...mapReducePlanningAgents(state)]
    .sort((a, b) => (a.startedAt < b.startedAt ? -1 : a.startedAt > b.startedAt ? 1 : 0));
  const agents = stripAgentStart(orderedAgents);
  return { agents, running: agents.some((a) => a.running) };
}

// --- eforge:endregion planning-lane ---
