import {
  createSessionPlan,
  getReadinessDetail,
  listSessionPlans,
  loadSessionPlan,
  migrateBooleanDimensions,
  normalizeBuildSource,
  resolveSessionPlanPath,
  resolveSessionPlanStorageRoot,
  setSessionPlanDimensions,
  setSessionPlanSection,
  setSessionPlanStatus,
  skipDimension,
  writeSessionPlan,
  type CreateSessionPlanOpts,
  type LoadSessionPlanOpts,
  type NormalizeBuildSourceInput,
  type NormalizeBuildSourceResult,
  type ResolveSessionPlanPathOpts,
  type SessionPlan,
  type SessionPlanListEntry,
  type SessionPlanStatus,
  type SetSessionPlanDimensionsOpts,
  type SetSessionPlanStatusMetadata,
} from './session-plan.js';
import {
  listSessionPlanSets,
  loadSessionPlanSet,
  validateLoadedSessionPlanSet,
  validateSessionPlanSet,
  type ListSessionPlanSetsOpts,
  type LoadSessionPlanSetOpts,
  type SessionPlanSetListEntry,
  type SessionPlanSetLoadResult,
  type SessionPlanSetValidationResult,
  type ValidateSessionPlanSetOpts,
} from './session-plan-set.js';

export const SESSION_PLANNING_WORKFLOW_ADAPTER_DESCRIPTOR = {
  id: 'builtin:session-planning',
  kind: 'workflow-input-adapter',
  sourceScope: 'project-local',
} as const;

export type SessionPlanReadinessDetail = ReturnType<typeof getReadinessDetail>;

export interface SessionPlanningListEntry extends SessionPlanListEntry {
  ready: boolean;
  missingDimensions: string[];
}

export interface SessionPlanningCreateAndWriteOptions extends CreateSessionPlanOpts {
  cwd: string;
}

export interface SessionPlanningSetSectionOptions extends LoadSessionPlanOpts {
  dimension: string;
  content: string;
}

export interface SessionPlanningSkipDimensionOptions extends LoadSessionPlanOpts {
  dimension: string;
  reason: string;
}

export interface SessionPlanningSetStatusOptions extends LoadSessionPlanOpts {
  status: SessionPlanStatus;
  metadata?: SetSessionPlanStatusMetadata;
  eforge_session?: string;
}

export interface SessionPlanningSelectDimensionsOptions extends LoadSessionPlanOpts, SetSessionPlanDimensionsOpts {}

export interface SessionPlanningLoadResult {
  plan: SessionPlan;
  readiness: SessionPlanReadinessDetail;
  path: string;
}

export interface SessionPlanningCreateResult {
  plan: SessionPlan;
  path: string;
}

export interface SessionPlanningMutationResult {
  plan: SessionPlan;
  readiness: SessionPlanReadinessDetail;
}

export interface SessionPlanningSetStatusResult {
  plan: SessionPlan;
}

export interface SessionPlanningMigrateLegacyResult {
  plan: SessionPlan;
  migrated: boolean;
}

export class SessionPlanReadinessError extends Error {
  readonly code = 'session-plan-readiness-failed' as const;
  readonly readiness: SessionPlanReadinessDetail;

  constructor(readiness: SessionPlanReadinessDetail, message = 'Session plan readiness failed') {
    super(message);
    this.name = 'SessionPlanReadinessError';
    this.readiness = readiness;
  }
}

export function isSessionPlanReadinessError(err: unknown): err is SessionPlanReadinessError {
  return err instanceof SessionPlanReadinessError;
}

export interface SessionPlanningWorkflowAdapter {
  descriptor: typeof SESSION_PLANNING_WORKFLOW_ADAPTER_DESCRIPTOR;
  flat: {
    resolveStorageRoot(cwd: string): string;
    resolvePath(opts: ResolveSessionPlanPathOpts): string;
    list(opts: { cwd: string; includeSubmitted?: boolean }): Promise<SessionPlanningListEntry[]>;
    load(opts: LoadSessionPlanOpts): Promise<SessionPlanningLoadResult>;
    create(opts: SessionPlanningCreateAndWriteOptions): Promise<SessionPlanningCreateResult>;
    setSection(opts: SessionPlanningSetSectionOptions): Promise<SessionPlanningMutationResult>;
    skipDimension(opts: SessionPlanningSkipDimensionOptions): Promise<SessionPlanningMutationResult>;
    setStatus(opts: SessionPlanningSetStatusOptions): Promise<SessionPlanningSetStatusResult>;
    selectDimensions(opts: SessionPlanningSelectDimensionsOptions): Promise<SessionPlanningMutationResult>;
    readiness(opts: LoadSessionPlanOpts): Promise<SessionPlanReadinessDetail>;
    migrateLegacy(opts: LoadSessionPlanOpts): Promise<SessionPlanningMigrateLegacyResult>;
    normalizeBuildSource(input: NormalizeBuildSourceInput): NormalizeBuildSourceResult;
  };
  planSets: {
    list(opts: { cwd: string; includeSubmitted?: boolean }): Promise<SessionPlanSetListEntry[]>;
    load(opts: LoadSessionPlanSetOpts): Promise<SessionPlanSetLoadResult>;
    validate(opts: ValidateSessionPlanSetOpts): Promise<SessionPlanSetValidationResult>;
    validateLoaded(loadResult: SessionPlanSetLoadResult): SessionPlanSetValidationResult;
  };
}

function statusesForFlatList(includeSubmitted?: boolean): SessionPlanStatus[] {
  return includeSubmitted === true ? ['planning', 'ready', 'submitted'] : ['planning', 'ready'];
}

async function listFlatPlans(opts: { cwd: string; includeSubmitted?: boolean }): Promise<SessionPlanningListEntry[]> {
  const entries = await listSessionPlans({ cwd: opts.cwd, statuses: statusesForFlatList(opts.includeSubmitted) });
  return Promise.all(entries.map(async (entry) => {
    try {
      const plan = await loadSessionPlan({ cwd: opts.cwd, session: entry.session });
      const readiness = getReadinessDetail(plan);
      return { ...entry, ready: readiness.ready, missingDimensions: readiness.missingDimensions };
    } catch {
      return { ...entry, ready: false, missingDimensions: [] };
    }
  }));
}

async function loadFlatPlan(opts: LoadSessionPlanOpts): Promise<SessionPlanningLoadResult> {
  const plan = await loadSessionPlan(opts);
  return { plan, readiness: getReadinessDetail(plan), path: resolveSessionPlanPath(opts) };
}

async function createFlatPlan(opts: SessionPlanningCreateAndWriteOptions): Promise<SessionPlanningCreateResult> {
  const plan = createSessionPlan(opts);
  await writeSessionPlan({ cwd: opts.cwd, plan });
  return { plan, path: resolveSessionPlanPath({ cwd: opts.cwd, session: plan.session }) };
}

async function setFlatSection(opts: SessionPlanningSetSectionOptions): Promise<SessionPlanningMutationResult> {
  const plan = await loadSessionPlan(opts);
  const updated = setSessionPlanSection(plan, opts.dimension, opts.content);
  await writeSessionPlan({ cwd: opts.cwd, plan: updated });
  return { plan: updated, readiness: getReadinessDetail(updated) };
}

async function skipFlatDimension(opts: SessionPlanningSkipDimensionOptions): Promise<SessionPlanningMutationResult> {
  const plan = await loadSessionPlan(opts);
  const updated = skipDimension(plan, opts.dimension, opts.reason);
  await writeSessionPlan({ cwd: opts.cwd, plan: updated });
  return { plan: updated, readiness: getReadinessDetail(updated) };
}

function assertReadyStatusAllowed(plan: SessionPlan): void {
  const readiness = getReadinessDetail(plan);
  if (readiness.acDiagnostics?.length) {
    const issueMsg = readiness.acDiagnostics.map((diagnostic) => diagnostic.message).join('; ');
    throw new SessionPlanReadinessError(
      readiness,
      `Cannot mark session plan ready: acceptance criteria quality issues: ${issueMsg}`,
    );
  }
}

async function setFlatStatus(opts: SessionPlanningSetStatusOptions): Promise<SessionPlanningSetStatusResult> {
  const plan = await loadSessionPlan(opts);
  if (opts.status === 'ready') {
    assertReadyStatusAllowed(plan);
  }
  const metadata = opts.metadata ?? (opts.eforge_session !== undefined ? { eforge_session: opts.eforge_session } : undefined);
  const updated = setSessionPlanStatus(plan, opts.status, metadata);
  await writeSessionPlan({ cwd: opts.cwd, plan: updated });
  return { plan: updated };
}

async function selectFlatDimensions(opts: SessionPlanningSelectDimensionsOptions): Promise<SessionPlanningMutationResult> {
  const plan = await loadSessionPlan(opts);
  const updated = setSessionPlanDimensions(plan, opts);
  await writeSessionPlan({ cwd: opts.cwd, plan: updated });
  return { plan: updated, readiness: getReadinessDetail(updated) };
}

async function migrateLegacyFlatPlan(opts: LoadSessionPlanOpts): Promise<SessionPlanningMigrateLegacyResult> {
  const plan = await loadSessionPlan(opts);
  const migratedPlan = migrateBooleanDimensions(plan);
  const migrated = migratedPlan !== plan;
  if (migrated) {
    await writeSessionPlan({ cwd: opts.cwd, plan: migratedPlan });
  }
  return { plan: migratedPlan, migrated };
}

async function listReadOnlyPlanSets(opts: ListSessionPlanSetsOpts & { includeSubmitted?: boolean }): Promise<SessionPlanSetListEntry[]> {
  const entries = await listSessionPlanSets(opts);
  return entries.filter((entry) => entry.status !== 'abandoned' && (opts.includeSubmitted === true || entry.status !== 'submitted'));
}

export function createSessionPlanningWorkflowAdapter(): SessionPlanningWorkflowAdapter {
  return {
    descriptor: SESSION_PLANNING_WORKFLOW_ADAPTER_DESCRIPTOR,
    flat: {
      resolveStorageRoot: resolveSessionPlanStorageRoot,
      resolvePath: resolveSessionPlanPath,
      list: listFlatPlans,
      load: loadFlatPlan,
      create: createFlatPlan,
      setSection: setFlatSection,
      skipDimension: skipFlatDimension,
      setStatus: setFlatStatus,
      selectDimensions: selectFlatDimensions,
      readiness: async (opts) => getReadinessDetail(await loadSessionPlan(opts)),
      migrateLegacy: migrateLegacyFlatPlan,
      normalizeBuildSource,
    },
    planSets: {
      list: listReadOnlyPlanSets,
      load: loadSessionPlanSet,
      validate: validateSessionPlanSet,
      validateLoaded: validateLoadedSessionPlanSet,
    },
  };
}
