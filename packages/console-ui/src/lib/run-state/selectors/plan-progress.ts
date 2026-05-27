/**
 * Plan progress selectors for the run-state subsystem.
 *
 * Provides plan status counts, current stage per plan, and mini-Gantt row
 * data derived from RunState.
 */
import type { RunState, PipelineStage } from '../types';

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
 * Stages 'plan', 'implement', 'doc-author', 'doc-sync', 'test', 'review', 'evaluate'
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

/** All plan IDs known to the run state (from orchestration, statuses, or events). */
function selectAllPlanIds(state: RunState): Set<string> {
  const ids = new Set<string>();
  for (const id of Object.keys(state.planStatuses)) ids.add(id);
  for (const plan of state.earlyOrchestration?.plans ?? []) ids.add(plan.id);
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
}

/**
 * Returns mini-Gantt rows for all plans, ordered by plan position in
 * earlyOrchestration (or alphabetically by planId if no orchestration).
 */
export function selectMiniGanttRows(state: RunState): MiniGanttRow[] {
  const orchPlans = state.earlyOrchestration?.plans ?? [];
  const allIds = selectAllPlanIds(state);

  if (orchPlans.length > 0) {
    return orchPlans.map((plan) => {
      const stage = state.planStatuses[plan.id];
      return {
        planId: plan.id,
        planName: plan.name,
        stage,
        dependsOn: plan.dependsOn ?? [],
        isComplete: stage === 'complete',
        isFailed: stage === 'failed',
      };
    });
  }

  // Fallback: no orchestration — use planStatuses keys
  return Array.from(allIds).sort().map((id) => {
    const stage = state.planStatuses[id];
    return {
      planId: id,
      planName: id,
      stage,
      dependsOn: [],
      isComplete: stage === 'complete',
      isFailed: stage === 'failed',
    };
  });
}
