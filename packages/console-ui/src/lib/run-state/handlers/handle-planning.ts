/**
 * Handlers for compile-phase planning events.
 *
 * planning:complete — seeds planStatuses with 'plan' for every submitted plan
 *   and synthesizes earlyOrchestration so the UI can render the dependency graph
 *   before the SWR-fetched orchestration config arrives.
 * planning:skip — captures the satisfaction-gate skip reason so the run detail
 *   view can render the skipped outcome.
 *   All other planning:* variants have no state effect and live in IGNORED_EVENT_TYPES.
 */
import type { BuildStageSpec, ReviewProfileConfig, OrchestrationConfig } from '../types';
import type { EventHandler } from './handler-types';

export const handlePlanningSkip: EventHandler<'planning:skip'> = (event, _state) => {
  return { skipReason: event.reason };
};

export const handlePlanningComplete: EventHandler<'planning:complete'> = (event, state) => {
  const updated = { ...state.planStatuses };
  for (const plan of event.plans) {
    updated[plan.id] = 'plan';
  }

  // Build a lookup for planConfigs by id so we can enrich each plan entry.
  const planConfigsById: Record<string, { build?: BuildStageSpec[]; review?: ReviewProfileConfig }> = {};
  for (const pc of event.planConfigs ?? []) {
    planConfigsById[pc.id] = pc;
  }

  const defaultReview: ReviewProfileConfig = {
    strategy: 'auto',
    perspectives: [],
    maxRounds: 1,
    evaluatorStrictness: 'standard',
  };

  // Synthesize an early orchestration so the UI can render dependency bars,
  // tooltips, and graph edges immediately — before the SWR fetch returns.
  // A REST orchestration snapshot can arrive before the live completion
  // event. Keep its richer pipeline/build configuration, while the event is
  // authoritative for the newly available declaration order and plan metadata.
  const priorPlansById = new Map((state.earlyOrchestration?.plans ?? []).map((plan) => [plan.id, plan]));
  const earlyOrchestration = {
    ...(state.earlyOrchestration ?? {}),
    name: state.earlyOrchestration?.name ?? '',
    description: state.earlyOrchestration?.description ?? '',
    created: state.earlyOrchestration?.created ?? '',
    baseBranch: state.earlyOrchestration?.baseBranch ?? '',
    pipeline: state.earlyOrchestration?.pipeline ?? {
      compile: [] as string[],
      defaultBuild: [] as BuildStageSpec[],
      defaultReview,
      rationale: '',
    },
    plans: event.plans.map((plan) => {
      const prior = priorPlansById.get(plan.id);
      const config = planConfigsById[plan.id];
      return {
        ...prior,
        id: plan.id,
        name: plan.name?.trim() || prior?.name || plan.id,
        dependsOn: plan.dependsOn,
        branch: plan.branch,
        build: config?.build ?? prior?.build ?? ([] as BuildStageSpec[]),
        review: config?.review ?? prior?.review ?? defaultReview,
      };
    }),
  } as unknown as OrchestrationConfig;

  return { planStatuses: updated, earlyOrchestration };
};
