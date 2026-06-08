import { loadSessionPlan, writeSessionPlan, type PlanningProfile, type SessionPlan } from '../../../packages/input/src/index.js';

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
