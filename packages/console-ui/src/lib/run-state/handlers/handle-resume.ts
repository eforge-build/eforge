/**
 * build:resume:artifacts — seeds recovered compiled artifacts for resume sessions.
 *
 * This projection is intentionally limited to source/plan/orchestration state.
 * It must not synthesize historical planning, agent, token, cost, usage, or
 * file-change activity for the resumed run.
 */
import type { EventHandler } from './handler-types';

export const handleBuildResumeArtifacts: EventHandler<'build:resume:artifacts'> = (event, state) => {
  const planStatuses = { ...state.planStatuses };
  for (const plan of event.plans) {
    if (planStatuses[plan.id] === undefined) {
      planStatuses[plan.id] = 'plan';
    }
  }

  return {
    planStatuses,
    earlyOrchestration: event.orchestration,
    resumeArtifacts: event.plans,
    resumeSource: event.source,
  };
};
