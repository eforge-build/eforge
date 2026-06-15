/**
 * build:resume:artifacts — seeds recovered compiled artifacts for resume sessions.
 *
 * This projection is intentionally limited to source/plan/orchestration state.
 * It must not synthesize historical planning, agent, token, cost, usage, or
 * file-change activity for the resumed run.
 */
import type { EventHandler } from './handler-types';
import type { PipelineStage, RunState } from '../types';

function realResumePlanIds(state: Readonly<RunState>): Set<string> {
  const ids = new Set<string>();
  for (const plan of state.earlyOrchestration?.plans ?? []) ids.add(plan.id);
  for (const plan of state.resumeArtifacts) ids.add(plan.id);
  return ids;
}

function applySeedOverlays(
  planStatuses: Record<string, PipelineStage>,
  allowedPlanIds: ReadonlySet<string>,
  seededMerged: readonly string[],
  seededPending: readonly string[],
): Record<string, PipelineStage> {
  for (const planId of seededMerged) {
    if (!allowedPlanIds.has(planId)) continue;
    if (planStatuses[planId] === undefined || planStatuses[planId] === 'plan') {
      planStatuses[planId] = 'complete';
    }
  }
  for (const planId of seededPending) {
    if (!allowedPlanIds.has(planId)) continue;
    if (planStatuses[planId] === undefined) {
      planStatuses[planId] = 'plan';
    }
  }
  return planStatuses;
}

function pruneUnbackedResumeSeedStatuses(
  planStatuses: Record<string, PipelineStage>,
  allowedPlanIds: ReadonlySet<string>,
  seededMerged: readonly string[],
  seededPending: readonly string[],
): Record<string, PipelineStage> {
  const seeded = new Set([...seededMerged, ...seededPending]);
  for (const planId of seeded) {
    if (allowedPlanIds.has(planId)) continue;
    if (planStatuses[planId] === 'plan') {
      delete planStatuses[planId];
    }
  }
  return planStatuses;
}

export const handleBuildResumeState: EventHandler<'build:resume:state'> = (event, state) => {
  const allowedPlanIds = realResumePlanIds(state);
  const basePlanStatuses = allowedPlanIds.size > 0
    ? pruneUnbackedResumeSeedStatuses({ ...state.planStatuses }, allowedPlanIds, event.seededMerged, event.seededPending)
    : { ...state.planStatuses };
  const planStatuses = applySeedOverlays(
    basePlanStatuses,
    allowedPlanIds,
    event.seededMerged,
    event.seededPending,
  );

  return {
    planStatuses,
    resumeSeededMerged: [...event.seededMerged],
    resumeSeededPending: [...event.seededPending],
  };
};

export const handleBuildResumeArtifacts: EventHandler<'build:resume:artifacts'> = (event, state) => {
  const allowedPlanIds = new Set([
    ...event.orchestration.plans.map((plan) => plan.id),
    ...event.plans.map((plan) => plan.id),
  ]);
  const planStatuses = pruneUnbackedResumeSeedStatuses(
    { ...state.planStatuses },
    allowedPlanIds,
    state.resumeSeededMerged,
    state.resumeSeededPending,
  );
  for (const plan of event.plans) {
    if (planStatuses[plan.id] === undefined) {
      planStatuses[plan.id] = 'plan';
    }
  }

  return {
    planStatuses: applySeedOverlays(planStatuses, allowedPlanIds, state.resumeSeededMerged, state.resumeSeededPending),
    earlyOrchestration: event.orchestration,
    resumeArtifacts: event.plans,
    resumeSource: event.source,
  };
};
