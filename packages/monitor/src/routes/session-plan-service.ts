import { VALID_PLANNING_DEPTHS, VALID_PLANNING_TYPES, VALID_PROFILES } from './content-validation.js';

export async function listSessionPlansWire(cwd: string, includeSubmitted: boolean) {
  const { listSessionPlans, loadSessionPlan, getReadinessDetail } = await import('@eforge-build/input');
  const statuses: Array<'planning' | 'ready' | 'submitted'> = includeSubmitted ? ['planning', 'ready', 'submitted'] : ['planning', 'ready'];
  const entries = await listSessionPlans({ cwd, statuses });
  const plans = await Promise.all(entries.map(async (entry) => {
    try { const plan = await loadSessionPlan({ cwd, session: entry.session }); const readiness = getReadinessDetail(plan); return { session: entry.session, topic: entry.topic, status: entry.status, path: entry.path, ready: readiness.ready, missingDimensions: readiness.missingDimensions, ...(entry.eforge_session !== undefined ? { eforge_session: entry.eforge_session } : {}), ...(readiness.acDiagnostics?.length ? { acDiagnostics: readiness.acDiagnostics } : {}) }; }
    catch { return { session: entry.session, topic: entry.topic, status: entry.status, path: entry.path, ready: false, missingDimensions: [], ...(entry.eforge_session !== undefined ? { eforge_session: entry.eforge_session } : {}) }; }
  }));
  return { plans };
}
export async function showSessionPlan(cwd: string, session: string) {
  const { loadSessionPlan, getReadinessDetail, resolveSessionPlanPath } = await import('@eforge-build/input');
  const plan = await loadSessionPlan({ cwd, session }); const readiness = getReadinessDetail(plan); const path = resolveSessionPlanPath({ cwd, session });
  const { body, sections: _sections, ...frontmatter } = plan as typeof plan & { sections: unknown };
  return { plan: { ...frontmatter, body }, readiness, path };
}
export async function createSessionPlanWire(cwd: string, body: any) {
  const { createSessionPlan, writeSessionPlan, resolveSessionPlanPath } = await import('@eforge-build/input');
  const plan = createSessionPlan({ session: body.session, topic: body.topic, planningType: body.planning_type as typeof VALID_PLANNING_TYPES[number] | undefined, planningDepth: body.planning_depth as typeof VALID_PLANNING_DEPTHS[number] | undefined, profile: body.profile as typeof VALID_PROFILES[number] | null | undefined, agentProfile: body.agent_profile as string | undefined });
  await writeSessionPlan({ cwd, plan }); return { session: body.session, path: resolveSessionPlanPath({ cwd, session: body.session }) };
}
export async function setSection(cwd: string, body: any) { const m = await import('@eforge-build/input'); const plan = await m.loadSessionPlan({ cwd, session: body.session }); const updated = m.setSessionPlanSection(plan, body.dimension, body.content); await m.writeSessionPlan({ cwd, plan: updated }); return { session: body.session, readiness: m.getReadinessDetail(updated) }; }
export async function skipDimensionWire(cwd: string, body: any) { const m = await import('@eforge-build/input'); const plan = await m.loadSessionPlan({ cwd, session: body.session }); const updated = m.skipDimension(plan, body.dimension, body.reason); await m.writeSessionPlan({ cwd, plan: updated }); return { session: body.session, readiness: m.getReadinessDetail(updated) }; }
export async function setStatusWire(cwd: string, body: any) { const m = await import('@eforge-build/input'); const plan = await m.loadSessionPlan({ cwd, session: body.session }); if (body.status === 'ready') { const readiness = m.getReadinessDetail(plan); if (readiness.acDiagnostics?.length) { const issueMsg = readiness.acDiagnostics.map((d: any) => d.message).join('; '); throw Object.assign(new Error(`Cannot mark session plan ready: acceptance criteria quality issues: ${issueMsg}`), { statusCode: 400, body: { error: `Cannot mark session plan ready: acceptance criteria quality issues: ${issueMsg}`, readiness } }); } } const updated = m.setSessionPlanStatus(plan, body.status, body.eforge_session ? { eforge_session: body.eforge_session } : undefined); await m.writeSessionPlan({ cwd, plan: updated }); return { session: body.session }; }
export async function selectDimensionsWire(cwd: string, body: any) { const m = await import('@eforge-build/input'); const plan = await m.loadSessionPlan({ cwd, session: body.session }); const updated = m.setSessionPlanDimensions(plan, { planningType: body.planning_type, planningDepth: body.planning_depth, overwrite: typeof body.overwrite === 'boolean' ? body.overwrite : undefined }); await m.writeSessionPlan({ cwd, plan: updated }); return { session: body.session, required_dimensions: updated.required_dimensions, optional_dimensions: updated.optional_dimensions, readiness: m.getReadinessDetail(updated) }; }
export async function readinessWire(cwd: string, session: string) { const { loadSessionPlan, getReadinessDetail } = await import('@eforge-build/input'); return getReadinessDetail(await loadSessionPlan({ cwd, session })); }
export async function migrateLegacy(cwd: string, session: string) { const m = await import('@eforge-build/input'); const plan = await m.loadSessionPlan({ cwd, session }); const migrated = m.migrateBooleanDimensions(plan); const wasMigrated = migrated !== plan; if (wasMigrated) await m.writeSessionPlan({ cwd, plan: migrated }); return { session, migrated: wasMigrated }; }
