import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
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
  const entries = await adapter.flat.list({ cwd, includeSubmitted: true });
  const canonicalBySession = new Map(readCanonicalSessionPlanStatuses(cwd).map((plan) => [plan.session, plan]));
  const markdownSessions = new Set(entries.map((entry) => entry.session));
  const markdownPlans = entries.map((entry) => {
    const canonical = canonicalBySession.get(entry.session);
    const status = canonical?.status ?? entry.status;
    return {
      session: entry.session,
      topic: canonical?.topic ?? entry.topic,
      status,
      path: canonical?.path ?? entry.path,
      ready: entry.ready,
      missingDimensions: entry.missingDimensions,
      ...(canonical?.eforge_session ?? entry.eforge_session ? { eforge_session: canonical?.eforge_session ?? entry.eforge_session } : {}),
      ...(canonical ? { statusSource: 'eforge-plan-sqlite-session-plan-status', statusSourceDisclosure: SESSION_PLAN_STATUS_SOURCE_DISCLOSURE } : {}),
    };
  });
  const canonicalOnlyPlans = [...canonicalBySession.values()].filter((plan) => plan.session && !markdownSessions.has(plan.session)).map((plan) => ({
    session: plan.session!,
    topic: plan.topic ?? plan.session!,
    status: plan.status,
    path: plan.path ?? join('.eforge', 'session-plans', `${plan.session}.md`),
    ready: plan.status === 'ready',
    missingDimensions: [],
    ...(plan.eforge_session ? { eforge_session: plan.eforge_session } : {}),
    statusSource: 'eforge-plan-sqlite-session-plan-status',
    statusSourceDisclosure: SESSION_PLAN_STATUS_SOURCE_DISCLOSURE,
  }));
  const plans = [...markdownPlans, ...canonicalOnlyPlans]
    .filter((entry) => includeSubmitted || entry.status !== 'submitted')
    .filter((entry) => !TERMINAL_SESSION_PLAN_STATUSES.has(entry.status));
  return { plans };
}

export async function showSessionPlan(cwd: string, session: string): Promise<SessionPlanShowResponse> {
  const { adapter } = await getPlanningAdapter();
  const result = await adapter.flat.load({ cwd, session });
  const { sections: _sections, ...plan } = result.plan;
  return {
    plan: withCanonicalStatus(cwd, plan as SessionPlanDataWire),
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

const SESSION_PLAN_STATUS_SOURCE_DISCLOSURE = 'status source = canonical eforge-plan SQLite session-plan status records in the eforge-plan extension store; lifecycle/projection records, monitor events, event-tail output, and status fields are derived evidence or diagnostics.';
const SESSION_PLAN_MARKDOWN_FALLBACK_DISCLOSURE = 'status source = Markdown compatibility fallback because canonical eforge-plan SQLite session-plan status records were unavailable; lifecycle/projection records, monitor events, event-tail output, and status fields are derived evidence or diagnostics.';
const EFORGE_PLAN_SQLITE_RELATIVE_PATH = '.eforge/storage/extensions/eforge-plan/eforge-plan-private.sqlite';
const TERMINAL_SESSION_PLAN_STATUSES = new Set(['abandoned', 'canceled', 'cancelled', 'complete', 'completed', 'deleted', 'done', 'merged', 'removed', 'shipped', 'superseded']);

type CanonicalSessionPlanStatus = {
  session?: string;
  topic?: string;
  status: SessionPlanDataWire['status'];
  path?: string;
  eforge_session?: string;
};

type CanonicalSessionPlanStatusRow = { session?: string; topic?: string | null; status?: string; path?: string | null; eforge_session_id?: string | null } | undefined;

function canonicalStatusFromRow(row: CanonicalSessionPlanStatusRow): CanonicalSessionPlanStatus | undefined {
  if (!row?.status) return undefined;
  return {
    ...(row.session ? { session: row.session } : {}),
    ...(row.topic ? { topic: row.topic } : {}),
    status: row.status as SessionPlanDataWire['status'],
    ...(row.path ? { path: row.path } : {}),
    ...(row.eforge_session_id ? { eforge_session: row.eforge_session_id } : {}),
  };
}

function readCanonicalSessionPlanStatuses(cwd: string): CanonicalSessionPlanStatus[] {
  const dbPath = join(cwd, EFORGE_PLAN_SQLITE_RELATIVE_PATH);
  if (!existsSync(dbPath)) return [];
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const rows = db.prepare('SELECT session, topic, status, path, eforge_session_id FROM session_plans').all() as Exclude<CanonicalSessionPlanStatusRow, undefined>[];
    return rows.map(canonicalStatusFromRow).filter((row): row is CanonicalSessionPlanStatus => row?.session !== undefined);
  } finally {
    db.close();
  }
}

function readCanonicalSessionPlanStatus(cwd: string, session: string): CanonicalSessionPlanStatus | undefined {
  const dbPath = join(cwd, EFORGE_PLAN_SQLITE_RELATIVE_PATH);
  if (!existsSync(dbPath)) return undefined;
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const row = db.prepare('SELECT session, topic, status, path, eforge_session_id FROM session_plans WHERE session = ?').get(session) as { session?: string; topic?: string | null; status?: string; path?: string | null; eforge_session_id?: string | null } | undefined;
    return canonicalStatusFromRow(row);
  } finally {
    db.close();
  }
}

function withCanonicalStatus(cwd: string, plan: SessionPlanDataWire): SessionPlanDataWire {
  const canonical = readCanonicalSessionPlanStatus(cwd, plan.session);
  if (!canonical) return plan;
  return {
    ...plan,
    status: canonical.status,
    ...(canonical.eforge_session ? { eforge_session: canonical.eforge_session } : {}),
    statusSource: 'eforge-plan-sqlite-session-plan-status',
    statusSourceDisclosure: SESSION_PLAN_STATUS_SOURCE_DISCLOSURE,
  } as SessionPlanDataWire;
}

function canonicalStatusFailure(session: string, detail: string) {
  return Object.assign(new Error(`Session-plan set-status for ${session} could not update the canonical eforge-plan SQLite status source (${EFORGE_PLAN_SQLITE_RELATIVE_PATH}); no authoritative status success can be claimed. ${detail}`), {
    statusCode: 500,
    body: { error: `Could not update canonical session-plan status source for ${session}: ${detail}`, statusSourceDisclosure: SESSION_PLAN_STATUS_SOURCE_DISCLOSURE },
  });
}

function syncCanonicalSessionPlanStatus(cwd: string, body: SessionPlanSetStatusRequest): boolean {
  const dbPath = join(cwd, EFORGE_PLAN_SQLITE_RELATIVE_PATH);
  if (!existsSync(dbPath)) return false;
  const db = new DatabaseSync(dbPath);
  try {
    const existing = db.prepare('SELECT session FROM session_plans WHERE session = ?').get(body.session) as { session?: string } | undefined;
    if (!existing) return false;
    const now = new Date().toISOString();
    db.prepare('UPDATE session_plans SET status = ?, eforge_session_id = COALESCE(?, eforge_session_id), updated_at = ?, submitted_at = CASE WHEN ? = ? THEN COALESCE(submitted_at, ?) ELSE submitted_at END WHERE session = ?')
      .run(body.status, body.eforge_session ?? null, now, body.status, 'submitted', now, body.session);
    if (TERMINAL_SESSION_PLAN_STATUSES.has(body.status)) {
      db.prepare("UPDATE lifecycle_evidence SET is_current = 0, is_terminal = 1, status = ?, superseded_at = ? WHERE is_current = 1 AND session = ? AND reason_code = 'planned-session-plan'").run(body.status, now, body.session);
    } else {
      db.prepare("UPDATE lifecycle_evidence SET status = ? WHERE is_current = 1 AND session = ? AND reason_code = 'planned-session-plan'").run(body.status, body.session);
    }
    return true;
  } finally {
    db.close();
  }
}

export async function setStatusWire(cwd: string, body: SessionPlanSetStatusRequest): Promise<SessionPlanSetStatusResponse> {
  const { adapter, isReadinessError } = await getPlanningAdapter();
  const canonicalBefore = readCanonicalSessionPlanStatus(cwd, body.session);
  const requiresCanonicalStatusUpdate = canonicalBefore !== undefined;
  let previousStatus: SessionPlanDataWire['status'] | undefined;
  let previousEforgeSession: string | undefined;
  try {
    const loaded = await adapter.flat.load({ cwd, session: body.session });
    previousStatus = loaded.plan.status as SessionPlanDataWire['status'];
    previousEforgeSession = loaded.plan.eforge_session;
  } catch {
    // Preserve the adapter's original error if set-status itself fails.
  }
  try {
    await adapter.flat.setStatus({
      cwd,
      session: body.session,
      status: body.status,
      eforge_session: body.eforge_session,
    });
    try {
      const updated = syncCanonicalSessionPlanStatus(cwd, body);
      if (requiresCanonicalStatusUpdate && !updated) {
        if (previousStatus) {
          await adapter.flat.setStatus({ cwd, session: body.session, status: previousStatus, eforge_session: previousEforgeSession });
        }
        throw canonicalStatusFailure(body.session, 'No canonical session_plans row was updated; the extension status store may be missing or out of sync.');
      }
    } catch (err) {
      if (requiresCanonicalStatusUpdate) {
        if (previousStatus) {
          await adapter.flat.setStatus({ cwd, session: body.session, status: previousStatus, eforge_session: previousEforgeSession });
        }
        if ((err as { statusCode?: unknown }).statusCode) throw err;
        const detail = err instanceof Error ? err.message : String(err);
        throw canonicalStatusFailure(body.session, detail);
      }
    }
  } catch (err) {
    if (isReadinessError(err)) {
      throw Object.assign(new Error(err.message), {
        statusCode: 400,
        body: { error: err.message, readiness: err.readiness },
      });
    }
    throw err;
  }
  return requiresCanonicalStatusUpdate
    ? { session: body.session, status: body.status, statusSource: 'session-plan-set-status-bridge', statusSourceDisclosure: SESSION_PLAN_STATUS_SOURCE_DISCLOSURE }
    : { session: body.session, status: body.status, statusSource: 'markdown-compatibility-fallback', statusSourceDisclosure: SESSION_PLAN_MARKDOWN_FALLBACK_DISCLOSURE };
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
