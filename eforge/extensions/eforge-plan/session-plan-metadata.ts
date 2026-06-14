import { loadSessionPlan, writeSessionPlan, type PlanningProfile, type SessionPlan } from '../../../packages/input/src/index.js';

export interface SessionPlanSourceMetadata {
  sourceItemIds: string[];
  sourceEpicIds: string[];
  sourceRecommendationRef?: string;
  promotedAt: string;
}

export interface SessionPlanSourceMetadataUpdate extends SessionPlanSourceMetadata {
  cwd: string;
  session: string;
}

export interface SessionPlanMetadataUpdate {
  cwd: string;
  session: string;
  profile?: PlanningProfile | null;
  agentProfile?: string | null;
  openQuestions?: string[];
}

export async function updateSessionPlanMetadata(input: SessionPlanMetadataUpdate): Promise<SessionPlan> {
  const plan = await loadSessionPlan({ cwd: input.cwd, session: input.session });
  const updated: SessionPlan = { ...plan };
  if (input.profile !== undefined) {
    updated.profile = input.profile;
  }
  if (input.agentProfile !== undefined) {
    const agentProfile = input.agentProfile?.trim() ?? '';
    if (agentProfile.length > 0) {
      updated.agent_profile = agentProfile;
    } else {
      delete (updated as Partial<SessionPlan>).agent_profile;
    }
  }
  if (input.openQuestions !== undefined) {
    updated.open_questions = input.openQuestions;
  }
  await writeSessionPlan({ cwd: input.cwd, plan: updated });
  return updated;
}

export async function readSessionPlanSourceMetadata(input: { cwd: string; session: string }): Promise<SessionPlanSourceMetadata | null> {
  return getSessionPlanSourceMetadata(await loadSessionPlan({ cwd: input.cwd, session: input.session }));
}

export async function updateSessionPlanSourceMetadata(input: SessionPlanSourceMetadataUpdate): Promise<SessionPlan> {
  const plan = await loadSessionPlan({ cwd: input.cwd, session: input.session });
  const updated = withSessionPlanSourceMetadata(plan, input);
  await writeSessionPlan({ cwd: input.cwd, plan: updated });
  return updated;
}

export function getSessionPlanSourceMetadata(plan: SessionPlan): SessionPlanSourceMetadata | null {
  const extensionMetadata = asRecord((plan as SessionPlan & { eforge_plan?: unknown }).eforge_plan);
  const sourceItemIds = stringArray(extensionMetadata.source_item_ids);
  const sourceEpicIds = stringArray(extensionMetadata.source_epic_ids);
  const sourceRecommendationRef = stringOrUndefined(extensionMetadata.source_recommendation_ref);
  const promotedAt = stringOrUndefined(extensionMetadata.promoted_at);
  if (promotedAt === undefined || (sourceItemIds.length === 0 && sourceEpicIds.length === 0 && sourceRecommendationRef === undefined)) {
    return null;
  }
  return { sourceItemIds, sourceEpicIds, ...(sourceRecommendationRef !== undefined && { sourceRecommendationRef }), promotedAt };
}

function withSessionPlanSourceMetadata(plan: SessionPlan, metadata: SessionPlanSourceMetadata): SessionPlan {
  const extensionMetadata: Record<string, unknown> = {
    ...asRecord((plan as SessionPlan & { eforge_plan?: unknown }).eforge_plan),
    source_item_ids: [...metadata.sourceItemIds],
    source_epic_ids: [...metadata.sourceEpicIds],
    promoted_at: metadata.promotedAt,
  };
  if (metadata.sourceRecommendationRef !== undefined) {
    extensionMetadata.source_recommendation_ref = metadata.sourceRecommendationRef;
  } else {
    delete extensionMetadata.source_recommendation_ref;
  }
  if (metadata.sourceItemIds.length === 1) {
    extensionMetadata.source_item_id = metadata.sourceItemIds[0];
  } else {
    delete extensionMetadata.source_item_id;
  }
  if (metadata.sourceEpicIds.length === 1) {
    extensionMetadata.source_epic_id = metadata.sourceEpicIds[0];
  } else {
    delete extensionMetadata.source_epic_id;
  }
  return { ...plan, eforge_plan: extensionMetadata } as SessionPlan;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0) : [];
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}
