import type {
  SessionPlan,
  SessionPlanningListEntry,
  SessionPlanReadinessDetail,
  SessionPlanSetListEntry,
  SessionPlanSetLoadResult,
  SessionPlanSetValidationResult,
} from '../../../packages/input/src/index.js';
import type { SessionPlanLifecycleProjection } from './backlog-domain.js';
import type { ListBoardOutput } from './schema.js';
import { toJsonSafeRecord } from './json-safe.js';

export type PlanningArtifactKey = `plan:${string}` | `plan-set:${string}`;

export function sessionPlanKey(session: string): PlanningArtifactKey {
  return `plan:${session}`;
}

export function sessionPlanSetKey(planSetId: string): PlanningArtifactKey {
  return `plan-set:${planSetId}`;
}

export function projectPlanningArtifacts(input: {
  plans: readonly SessionPlanningListEntry[];
  planSets: readonly SessionPlanSetListEntry[];
  board?: ListBoardOutput;
  lifecycleBySession?: ReadonlyMap<string, SessionPlanLifecycleProjection>;
}) {
  const plans = input.plans.map((entry) => projectPlanListEntry(entry, input.lifecycleBySession?.get(entry.session)));
  const planSets = input.planSets.map(projectPlanSetListEntry);
  return {
    artifacts: [...plans, ...planSets],
    plans,
    planSets,
    ...(input.board !== undefined ? { board: input.board } : {}),
  };
}

export function projectPlanListEntry(entry: SessionPlanningListEntry, lifecycle?: SessionPlanLifecycleProjection) {
  return {
    kind: 'plan' as const,
    key: sessionPlanKey(entry.session),
    session: entry.session,
    title: entry.topic,
    topic: entry.topic,
    status: entry.status,
    path: entry.path,
    ready: entry.ready,
    missingDimensions: entry.missingDimensions,
    ...(entry.eforge_session !== undefined ? { eforge_session: entry.eforge_session } : {}),
    ...(lifecycle !== undefined ? {
      sourceRefs: lifecycle.sourceRefs,
      lifecycleState: lifecycle.lifecycleState,
      itemRows: lifecycle.itemRows,
      linkRows: lifecycle.linkRows,
      failureEvidence: lifecycle.failureEvidence,
    } : {}),
  };
}

export function projectPlanSetListEntry(entry: SessionPlanSetListEntry) {
  return {
    kind: 'plan-set' as const,
    key: sessionPlanSetKey(entry.planSetId),
    id: entry.id,
    planSetId: entry.planSetId,
    title: entry.title,
    status: entry.status,
    strategy: entry.strategy,
    dir: entry.dir,
    manifestPath: entry.manifestPath,
    childCount: entry.childCount,
  };
}

export function projectSessionPlanDetail(input: { plan: SessionPlan; readiness: SessionPlanReadinessDetail; path: string; lifecycle?: SessionPlanLifecycleProjection }) {
  return {
    plan: projectSessionPlan(input.plan),
    readiness: input.readiness,
    path: input.path,
    ...(input.lifecycle !== undefined ? { sourceRefs: input.lifecycle.sourceRefs, lifecycle: input.lifecycle } : {}),
  };
}

export function projectSessionPlan(plan: SessionPlan) {
  const { sections, ...frontmatterAndBody } = plan;
  return {
    ...frontmatterAndBody,
    sections: Object.fromEntries([...sections.entries()].sort(([a], [b]) => a.localeCompare(b))),
  };
}

export function projectSessionPlanSetDetail(load: SessionPlanSetLoadResult, validation: SessionPlanSetValidationResult) {
  return {
    // planSet and validation are modelled as opaque JSON in ShowSessionPlanSetOutputSchema.
    planSet: toJsonSafeRecord(validation.summary),
    validation: toJsonSafeRecord(validation),
    dir: load.dir,
    manifestPath: load.manifestPath,
    ...(load.anchor?.exists === true && load.anchor.content !== undefined ? { anchorContent: load.anchor.content } : {}),
  };
}
