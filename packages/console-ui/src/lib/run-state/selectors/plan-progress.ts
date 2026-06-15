/**
 * Plan progress selectors for the run-state subsystem.
 *
 * Provides plan status counts, current stage per plan, and mini-Gantt row
 * data derived from RunState.
 */
import type { RunState, PipelineStage, BuildStageSpec } from '../types';
import { isRegisteredPhaseLane, laneLabel, laneOrder } from '../lane-registry';

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

// ---------------------------------------------------------------------------
// Plan-lane selectors (mini swimlane for the Now dashboard active-build cards)
// ---------------------------------------------------------------------------

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
  planId: string;
  planName: string;
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
  /** True while any planning agent is still running. */
  running: boolean;
}

function laneAgentTokens(thread: RunState['agentThreads'][number]): number {
  return thread.totalTokens ?? 0;
}

/**
 * Aggregates a set of agent threads into one entry per agent role: tokens are
 * summed across the role's threads (e.g. multiple review rounds), `running` is
 * true if any thread is still live, and entries are ordered by first start.
 */
function aggregateLaneAgents(threads: RunState['agentThreads']): PlanLaneAgent[] {
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
      byAgent.set(thread.agent, {
        tokens: laneAgentTokens(thread),
        running: thread.endedAt === null,
        startedAt: thread.startedAt,
      });
    }
  }
  return order
    .map((agent) => ({ agent, ...byAgent.get(agent)! }))
    .sort((a, b) => (a.startedAt < b.startedAt ? -1 : a.startedAt > b.startedAt ? 1 : 0))
    .map(({ agent, tokens, running }) => ({ agent, tokens, running }));
}

// Lane labels and ordering are now sourced from the single lane registry
// (lib/run-state/lane-registry.ts). See laneLabel() / laneOrder().

function validationLaneForStart(startedAt: string, events: RunState['events']): 'validation' | 'final-validation' {
  const startMs = new Date(startedAt).getTime();
  let gapCloseCompleted = false;

  for (const { event } of events) {
    const eventMs = new Date(event.timestamp).getTime();
    if (Number.isNaN(eventMs) || eventMs > startMs) continue;
    if (event.type === 'gap_close:complete') gapCloseCompleted = true;
  }

  return gapCloseCompleted ? 'final-validation' : 'validation';
}

function validationCommandLaneIds(state: RunState): Set<string> {
  if (state.validationCommands.length === 0) return new Set();
  return new Set(state.validationCommands.map((span) => validationLaneForStart(span.startedAt, state.events)));
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

  const makeLane = (planId: string, planName: string): PlanLane => {
    const stage = state.planStatuses[planId];
    return {
      planId,
      planName,
      stage,
      buildStages: buildByPlan.get(planId) ?? [],
      isComplete: stage === 'complete',
      isFailed: stage === 'failed',
      agents: aggregateLaneAgents(threadsByPlan.get(planId) ?? []),
    };
  };

  if (!hasArtifactContext) {
    return Array.from(selectAllPlanIds(state)).sort().map((id) => makeLane(id, id));
  }

  const lanes = sourcePlans.map((plan) => makeLane(plan.id, plan.name));

  // Append dynamically-added lanes (e.g. gap-close, validation, final-validation)
  // that have a status or live agents but were never part of the compiled
  // orchestration. Exclude 'planning' — it has its own dedicated row via
  // selectPlanningLane. Order by the lane registry instead of alphabetically.
  const known = new Set(sourcePlans.map((plan) => plan.id));
  const extras = new Set<string>();
  const validationCommandIds = validationCommandLaneIds(state);
  const phaseLaneHasContent = (id: string) => threadsByPlan.has(id) || validationCommandIds.has(id);
  for (const id of Object.keys(state.planStatuses)) {
    if (known.has(id)) continue;
    if (isRegisteredPhaseLane(id) && phaseLaneHasContent(id)) extras.add(id);
  }
  for (const id of threadsByPlan.keys()) {
    if (!known.has(id) && isRegisteredPhaseLane(id)) extras.add(id);
  }
  for (const id of validationCommandIds) {
    if (!known.has(id) && isRegisteredPhaseLane(id)) extras.add(id);
  }
  extras.delete('planning');
  for (const id of Array.from(extras).sort((a, b) => laneOrder(a) - laneOrder(b) || a.localeCompare(b))) {
    lanes.push(makeLane(id, laneLabel(id)));
  }

  return lanes;
}

/**
 * Returns the planning-phase lane summary built from agents with
 * `planId === 'planning'`, aggregating tokens per agent role.
 *
 * Re-scoped from `!t.planId` to `t.planId === 'planning'` so that
 * validation-fixer / prd-validator threads (planId 'validation' /
 * 'final-validation') are excluded and rendered in their own phase lanes.
 */
export function selectPlanningLane(state: RunState): PlanningLane {
  const agents = aggregateLaneAgents(state.agentThreads.filter((t) => t.planId === 'planning'));
  return { agents, running: agents.some((a) => a.running) };
}
