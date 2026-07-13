import type { PlanInfo } from '@eforge-build/client/browser';
import type { BuildResumeArtifactPlan, BuildStageSpec, OrchestrationConfig, ReviewProfileConfig, StoredEvent } from './types';

/** Display metadata for one compiled plan. Canonical IDs remain authoritative. */
export interface PlanPresentation {
  id: string;
  name: string;
  ordinal: string;
  label: string;
  previewName: string;
  previewBody: string;
  dependsOn: readonly string[];
  build: readonly BuildStageSpec[];
  review?: ReviewProfileConfig;
  branch?: string;
  tooltip: readonly string[];
}

export interface PlanPresentationInput {
  orchestration?: OrchestrationConfig | null;
  restPlans?: readonly PlanInfo[] | null;
  resumeArtifacts?: readonly BuildResumeArtifactPlan[];
  events?: readonly StoredEvent[];
}

type LivePlan = { id: string; name: string; body: string; dependsOn: string[]; branch?: string };

function latestLivePlans(events: readonly StoredEvent[] = []): LivePlan[] {
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index].event;
    if (event.type === 'planning:complete') {
      return event.plans.map((plan) => ({
        id: plan.id, name: plan.name, body: plan.body, dependsOn: plan.dependsOn, branch: plan.branch,
      }));
    }
  }
  return [];
}

/**
 * Produces the sole compiled-plan display model. Live reduced orchestration owns
 * identity and declaration order; REST is deliberately preview-body-only when
 * live metadata exists, preventing an old snapshot from renaming a plan.
 */
export function buildPlanPresentation({ orchestration, restPlans, resumeArtifacts = [], events = [] }: PlanPresentationInput): PlanPresentation[] {
  const livePlans = latestLivePlans(events);
  const liveById = new Map(livePlans.map((plan) => [plan.id, plan]));
  const orchestrationPlans = orchestration?.plans ?? [];
  const orchestrationById = new Map(orchestrationPlans.map((plan) => [plan.id, plan]));
  const restById = new Map((restPlans ?? []).filter((plan) => plan.type === 'plan').map((plan) => [plan.id, plan]));
  const resumeById = new Map(resumeArtifacts.map((plan) => [plan.id, plan]));
  // Select exactly one declaration source. Lower-precedence sources may enrich
  // a declared plan, but cannot resurrect a removed plan as a display lane.
  const declarations = orchestrationPlans.length > 0
    ? orchestrationPlans
    : livePlans.length > 0
      ? livePlans
      : restById.size > 0
        ? [...restById.values()]
        : resumeArtifacts;
  const ids = declarations.map((plan) => plan.id);

  return ids.map((id, index) => {
    const live = liveById.get(id);
    const orchestrationPlan = orchestrationById.get(id);
    const rest = restById.get(id);
    const resume = resumeById.get(id);
    const name = orchestrationPlan?.name?.trim() || live?.name?.trim() || resume?.name?.trim() || rest?.name?.trim() || id;
    const ordinal = String(index + 1).padStart(2, '0');
    const label = `Plan ${ordinal} — ${name}`;
    const dependsOn = orchestrationPlan?.dependsOn ?? live?.dependsOn ?? resume?.dependsOn ?? rest?.dependsOn ?? [];
    const previewBody = rest?.body || live?.body || resume?.body || '';
    return {
      id, name, ordinal, label, previewName: name, previewBody, dependsOn,
      build: orchestrationPlan?.build ?? rest?.build ?? resume?.build ?? [], review: orchestrationPlan?.review ?? rest?.review ?? resume?.review,
      branch: orchestrationPlan?.branch ?? live?.branch ?? resume?.branch,
      tooltip: [label, `ID: ${id}`, ...(dependsOn.length > 0 ? [`Depends on: ${dependsOn.join(', ')}`] : [])],
    };
  });
}

/** Compatibility helper for selectors that only have declaration metadata. */
export function planPresentation(index: number, name: string | undefined, planId: string): PlanPresentation {
  const readableName = name?.trim() || planId;
  const ordinal = String(index + 1).padStart(2, '0');
  const label = `Plan ${ordinal} — ${readableName}`;
  return {
    id: planId, name: readableName, ordinal, label, previewName: readableName, previewBody: '',
    dependsOn: [], build: [], tooltip: [label, `ID: ${planId}`],
  };
}
