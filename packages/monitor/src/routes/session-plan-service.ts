import type {
  SessionPlanCreateRequest,
  SessionPlanCreateResponse,
  SessionPlanDataWire,
  SessionPlanListResponse,
  SessionPlanMigrateLegacyResponse,
  SessionPlanReadinessResponse,
  SessionPlanSelectDimensionsRequest,
  SessionPlanSelectDimensionsResponse,
  SessionPlanSetSectionRequest,
  SessionPlanSetSectionResponse,
  SessionPlanSetStatusRequest,
  SessionPlanSetStatusResponse,
  SessionPlanShowResponse,
  SessionPlanSkipDimensionRequest,
  SessionPlanSkipDimensionResponse,
} from '@eforge-build/client';

async function getPlanningAdapter() {
  const { createSessionPlanningWorkflowAdapter, isSessionPlanReadinessError } = await import('@eforge-build/input');
  return {
    adapter: createSessionPlanningWorkflowAdapter(),
    isReadinessError: isSessionPlanReadinessError,
  };
}

export async function listSessionPlansWire(cwd: string, includeSubmitted: boolean): Promise<SessionPlanListResponse> {
  const { adapter } = await getPlanningAdapter();
  const entries = await adapter.flat.list({ cwd, includeSubmitted });
  return {
    plans: entries.map((entry) => ({
      session: entry.session,
      topic: entry.topic,
      status: entry.status,
      path: entry.path,
      ready: entry.ready,
      missingDimensions: entry.missingDimensions,
      ...(entry.eforge_session !== undefined ? { eforge_session: entry.eforge_session } : {}),
    })),
  };
}

export async function showSessionPlan(cwd: string, session: string): Promise<SessionPlanShowResponse> {
  const { adapter } = await getPlanningAdapter();
  const result = await adapter.flat.load({ cwd, session });
  const { sections: _sections, ...plan } = result.plan;
  return {
    plan: plan as SessionPlanDataWire,
    readiness: result.readiness,
    path: result.path,
  };
}

export async function createSessionPlanWire(cwd: string, body: SessionPlanCreateRequest): Promise<SessionPlanCreateResponse> {
  const { adapter } = await getPlanningAdapter();
  const result = await adapter.flat.create({
    cwd,
    session: body.session,
    topic: body.topic,
    planningType: body.planning_type,
    planningDepth: body.planning_depth,
    profile: body.profile,
    agentProfile: body.agent_profile,
  });
  return { session: result.plan.session, path: result.path };
}

export async function setSection(cwd: string, body: SessionPlanSetSectionRequest): Promise<SessionPlanSetSectionResponse> {
  const { adapter } = await getPlanningAdapter();
  const result = await adapter.flat.setSection({
    cwd,
    session: body.session,
    dimension: body.dimension,
    content: body.content,
  });
  return { session: body.session, readiness: result.readiness };
}

export async function skipDimensionWire(cwd: string, body: SessionPlanSkipDimensionRequest): Promise<SessionPlanSkipDimensionResponse> {
  const { adapter } = await getPlanningAdapter();
  const result = await adapter.flat.skipDimension({
    cwd,
    session: body.session,
    dimension: body.dimension,
    reason: body.reason,
  });
  return { session: body.session, readiness: result.readiness };
}

export async function setStatusWire(cwd: string, body: SessionPlanSetStatusRequest): Promise<SessionPlanSetStatusResponse> {
  const { adapter, isReadinessError } = await getPlanningAdapter();
  try {
    await adapter.flat.setStatus({
      cwd,
      session: body.session,
      status: body.status,
      eforge_session: body.eforge_session,
    });
  } catch (err) {
    if (isReadinessError(err)) {
      throw Object.assign(new Error(err.message), {
        statusCode: 400,
        body: { error: err.message, readiness: err.readiness },
      });
    }
    throw err;
  }
  return { session: body.session };
}

export async function selectDimensionsWire(cwd: string, body: SessionPlanSelectDimensionsRequest): Promise<SessionPlanSelectDimensionsResponse> {
  const { adapter } = await getPlanningAdapter();
  const result = await adapter.flat.selectDimensions({
    cwd,
    session: body.session,
    planningType: body.planning_type,
    planningDepth: body.planning_depth,
    overwrite: typeof body.overwrite === 'boolean' ? body.overwrite : undefined,
  });
  return {
    session: body.session,
    required_dimensions: result.plan.required_dimensions,
    optional_dimensions: result.plan.optional_dimensions,
    readiness: result.readiness,
  };
}

export async function readinessWire(cwd: string, session: string): Promise<SessionPlanReadinessResponse> {
  const { adapter } = await getPlanningAdapter();
  return adapter.flat.readiness({ cwd, session });
}

export async function migrateLegacy(cwd: string, session: string): Promise<SessionPlanMigrateLegacyResponse> {
  const { adapter } = await getPlanningAdapter();
  const result = await adapter.flat.migrateLegacy({ cwd, session });
  return { session, migrated: result.migrated };
}
