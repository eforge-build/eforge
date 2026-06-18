import { readFile } from 'node:fs/promises';
import { relative } from 'node:path';
import { defineExtensionAction } from '@eforge-build/extension-sdk';
import { createSessionPlanningWorkflowAdapter } from '@eforge-build/input';
import { buildBoard, projectBoardOutput } from './board-actions.js';
import { toJsonSafeObject } from './json-safe.js';
import { projectSessionPlanLifecycle, projectSessionPlanSourceRefs } from './lifecycle-projection.js';
import { listBacklogEpics, listBacklogItems } from './markdown-store.js';
import { listTraceSidecars } from './trace-store.js';
import { summarizeProjectTraces } from './trace-activity.js';
import type { SessionPlanLifecycleProjection } from './backlog-domain.js';
import { updateSessionPlanMetadata } from './session-plan-metadata.js';
import {
  projectPlanningArtifacts,
  projectSessionPlanDetail,
  projectSessionPlan,
  projectSessionPlanSetDetail,
} from './session-plan-view-model.js';
import {
  CheckSessionPlanReadinessInputSchema,
  CheckSessionPlanReadinessOutputSchema,
  CreateSessionPlanInputSchema,
  CreateSessionPlanOutputSchema,
  DeleteSessionPlanInputSchema,
  DeleteSessionPlanOutputSchema,
  HandoffSessionPlanInputSchema,
  HandoffSessionPlanOutputSchema,
  ListPlanningArtifactsInputSchema,
  ListPlanningArtifactsOutputSchema,
  SelectSessionPlanDimensionsInputSchema,
  SelectSessionPlanDimensionsOutputSchema,
  SetSessionPlanReadyInputSchema,
  SetSessionPlanReadyOutputSchema,
  SetSessionPlanSectionInputSchema,
  SetSessionPlanSectionOutputSchema,
  ShowSessionPlanInputSchema,
  ShowSessionPlanOutputSchema,
  ShowSessionPlanSetInputSchema,
  ShowSessionPlanSetOutputSchema,
  UpdateSessionPlanMetadataInputSchema,
  UpdateSessionPlanMetadataOutputSchema,
} from './session-plan-schemas.js';

function adapter() {
  return createSessionPlanningWorkflowAdapter();
}

export const listPlanningArtifacts = defineExtensionAction({
  id: 'list-planning-artifacts',
  title: 'List planning artifacts',
  description: 'List flat session plans and session plan sets for the planning workstation, with legacy board data available by explicit opt-in.',
  inputSchema: ListPlanningArtifactsInputSchema,
  outputSchema: ListPlanningArtifactsOutputSchema,
  sideEffects: ['local-read'],
  async handler(input, ctx) {
    const planning = adapter();
    const [plans, planSets] = await Promise.all([
      planning.flat.list({ cwd: ctx.cwd, includeSubmitted: input.includeSubmitted }),
      planning.planSets.list({ cwd: ctx.cwd, includeSubmitted: input.includeSubmitted }),
    ]);
    const lifecycleBySession = await buildLifecycleBySession(ctx.cwd, plans.map((plan) => plan.session));
    if (input.includeBoard !== true) return toJsonSafeObject(projectPlanningArtifacts({ plans, planSets, lifecycleBySession }));
    try {
      const board = await buildBoard(ctx.cwd, { epic: input.epic, includeArchive: input.includeArchive });
      return toJsonSafeObject(projectPlanningArtifacts({ plans, planSets, board: projectBoardOutput(board), lifecycleBySession }));
    } catch {
      return toJsonSafeObject(projectPlanningArtifacts({ plans, planSets, lifecycleBySession }));
    }
  },
});

export const showSessionPlan = defineExtensionAction({
  id: 'show-session-plan',
  title: 'Show session plan',
  description: 'Read a flat session plan with readiness detail and a JSON-safe section record.',
  inputSchema: ShowSessionPlanInputSchema,
  outputSchema: ShowSessionPlanOutputSchema,
  sideEffects: ['local-read'],
  async handler(input, ctx) {
    const loaded = await adapter().flat.load({ cwd: ctx.cwd, session: input.session });
    const lifecycle = await buildLifecycleForPlan(ctx.cwd, loaded.plan);
    return toJsonSafeObject(projectSessionPlanDetail({ ...loaded, lifecycle }));
  },
});

export const showSessionPlanSet = defineExtensionAction({
  id: 'show-session-plan-set',
  title: 'Show session plan set',
  description: 'Read a session plan-set manifest, validation summary, and optional umbrella anchor content.',
  inputSchema: ShowSessionPlanSetInputSchema,
  outputSchema: ShowSessionPlanSetOutputSchema,
  sideEffects: ['local-read'],
  async handler(input, ctx) {
    const planning = adapter();
    const load = await planning.planSets.load({ cwd: ctx.cwd, planSetId: input.planSetId });
    const validation = planning.planSets.validateLoaded(load);
    return toJsonSafeObject(projectSessionPlanSetDetail(load, validation));
  },
});

export const createSessionPlanAction = defineExtensionAction({
  id: 'create-session-plan',
  title: 'Create session plan',
  description: 'Create a flat .eforge/session-plans/<session>.md planning artifact.',
  inputSchema: CreateSessionPlanInputSchema,
  outputSchema: CreateSessionPlanOutputSchema,
  sideEffects: ['local-write'],
  async handler(input, ctx) {
    const planning = adapter();
    const result = await planning.flat.create({
      cwd: ctx.cwd,
      session: input.session,
      topic: input.topic,
      planningType: input.planningType,
      planningDepth: input.planningDepth,
      profile: input.profile,
      agentProfile: input.agentProfile,
    });
    const readiness = await planning.flat.readiness({ cwd: ctx.cwd, session: result.plan.session });
    return toJsonSafeObject({ session: result.plan.session, path: result.path, plan: projectSessionPlan(result.plan), readiness });
  },
});

export const setSessionPlanSectionAction = defineExtensionAction({
  id: 'set-session-plan-section',
  title: 'Set session plan section',
  description: 'Replace or append a single dimension section in a flat session plan.',
  inputSchema: SetSessionPlanSectionInputSchema,
  outputSchema: SetSessionPlanSectionOutputSchema,
  sideEffects: ['local-write'],
  async handler(input, ctx) {
    const planning = adapter();
    const result = await planning.flat.setSection({
      cwd: ctx.cwd,
      session: input.session,
      dimension: input.dimension,
      content: input.content,
    });
    return toJsonSafeObject({ session: input.session, path: planning.flat.resolvePath({ cwd: ctx.cwd, session: input.session }), readiness: result.readiness, plan: projectSessionPlan(result.plan) });
  },
});

export const selectSessionPlanDimensions = defineExtensionAction({
  id: 'select-session-plan-dimensions',
  title: 'Select session plan dimensions',
  description: 'Apply planning type/depth selection and derived dimension lists to a session plan.',
  inputSchema: SelectSessionPlanDimensionsInputSchema,
  outputSchema: SelectSessionPlanDimensionsOutputSchema,
  sideEffects: ['local-write'],
  async handler(input, ctx) {
    const planning = adapter();
    const result = await planning.flat.selectDimensions({
      cwd: ctx.cwd,
      session: input.session,
      planningType: input.planningType,
      planningDepth: input.planningDepth,
      overwrite: input.overwrite,
    });
    return toJsonSafeObject({
      session: input.session,
      path: planning.flat.resolvePath({ cwd: ctx.cwd, session: input.session }),
      required_dimensions: result.plan.required_dimensions,
      optional_dimensions: result.plan.optional_dimensions,
      readiness: result.readiness,
      plan: projectSessionPlan(result.plan),
    });
  },
});

export const checkSessionPlanReadiness = defineExtensionAction({
  id: 'check-session-plan-readiness',
  title: 'Check session plan readiness',
  description: 'Return structured readiness detail for a flat session plan.',
  inputSchema: CheckSessionPlanReadinessInputSchema,
  outputSchema: CheckSessionPlanReadinessOutputSchema,
  sideEffects: ['local-read'],
  async handler(input, ctx) {
    return toJsonSafeObject({ session: input.session, readiness: await adapter().flat.readiness({ cwd: ctx.cwd, session: input.session }) });
  },
});

export const setSessionPlanReady = defineExtensionAction({
  id: 'set-session-plan-ready',
  title: 'Set session plan ready',
  description: 'Mark a session plan ready only when required dimensions and acceptance criteria diagnostics pass.',
  inputSchema: SetSessionPlanReadyInputSchema,
  outputSchema: SetSessionPlanReadyOutputSchema,
  sideEffects: ['local-write'],
  async handler(input, ctx) {
    const planning = adapter();
    const readiness = await planning.flat.readiness({ cwd: ctx.cwd, session: input.session });
    if (!readiness.ready) {
      return toJsonSafeObject({ kind: 'not-ready', session: input.session, readiness, message: 'Session plan is not ready; status was left unchanged.' });
    }
    const result = await planning.flat.setStatus({ cwd: ctx.cwd, session: input.session, status: 'ready' });
    return toJsonSafeObject({ kind: 'ready', session: input.session, status: result.plan.status, readiness, plan: projectSessionPlan(result.plan) });
  },
});

export const deleteSessionPlanAction = defineExtensionAction({
  id: 'delete-session-plan',
  title: 'Delete session plan',
  description: 'Hide a flat session plan from active planning lists by marking it abandoned; the Markdown file is retained.',
  inputSchema: DeleteSessionPlanInputSchema,
  outputSchema: DeleteSessionPlanOutputSchema,
  sideEffects: ['local-write'],
  async handler(input, ctx) {
    const result = await adapter().flat.setStatus({ cwd: ctx.cwd, session: input.session, status: 'abandoned' });
    return toJsonSafeObject({
      kind: 'deleted',
      session: input.session,
      status: 'abandoned',
      message: `Deleted ${input.session} from active plans by marking it abandoned.`,
      plan: projectSessionPlan(result.plan),
    });
  },
});

export const updateSessionPlanMetadataAction = defineExtensionAction({
  id: 'update-session-plan-metadata',
  title: 'Update session plan metadata',
  description: 'Update metadata not exposed by adapter mutations: profile, agent profile, and open questions.',
  inputSchema: UpdateSessionPlanMetadataInputSchema,
  outputSchema: UpdateSessionPlanMetadataOutputSchema,
  sideEffects: ['local-write'],
  async handler(input, ctx) {
    const plan = await updateSessionPlanMetadata({
      cwd: ctx.cwd,
      session: input.session,
      profile: input.profile,
      agentProfile: input.agentProfile,
      openQuestions: input.openQuestions,
    });
    const planning = adapter();
    return toJsonSafeObject({
      session: input.session,
      path: planning.flat.resolvePath({ cwd: ctx.cwd, session: input.session }),
      readiness: await planning.flat.readiness({ cwd: ctx.cwd, session: input.session }),
      plan: projectSessionPlan(plan),
    });
  },
});

export const handoffSessionPlan = defineExtensionAction({
  id: 'handoff-session-plan',
  title: 'Handoff session plan to build queue',
  description: 'Verify readiness and ready status, then enqueue the session plan through the daemon build queue.',
  inputSchema: HandoffSessionPlanInputSchema,
  outputSchema: HandoffSessionPlanOutputSchema,
  sideEffects: ['local-read', 'local-write', 'daemon-state', 'build-queue'],
  async handler(input, ctx) {
    const planning = adapter();
    const loaded = await planning.flat.load({ cwd: ctx.cwd, session: input.session });
    if (!loaded.readiness.ready) {
      return toJsonSafeObject({ kind: 'not-ready', session: input.session, readiness: loaded.readiness, message: 'Session plan is not ready; no handoff source path was produced.' });
    }
    if (loaded.plan.status !== 'ready') {
      return toJsonSafeObject({ kind: 'not-ready', session: input.session, readiness: loaded.readiness, message: `Session plan status is ${loaded.plan.status}; mark it ready before handoff.` });
    }
    await readFile(loaded.path, 'utf-8');
    const sourcePath = relative(ctx.cwd, loaded.path).replace(/\\/g, '/');
    const command = `eforge build ${quoteShellArg(sourcePath)}`;
    try {
      const enqueued = await ctx.buildQueue.enqueue({ source: sourcePath });
      return toJsonSafeObject({
        kind: 'enqueued',
        session: input.session,
        sourcePath,
        absolutePath: loaded.path,
        queueSessionId: enqueued.sessionId,
        pid: enqueued.pid,
        autoBuild: enqueued.autoBuild,
        message: `Enqueued ${sourcePath} for build${enqueued.autoBuild ? '; auto-build is enabled.' : '.'}`,
        readiness: loaded.readiness,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return toJsonSafeObject({
        kind: 'enqueue-failed',
        session: input.session,
        sourcePath,
        absolutePath: loaded.path,
        command,
        message: `Session plan is ready, but enqueue failed: ${message}. You can run ${command} manually.`,
        readiness: loaded.readiness,
      });
    }
  },
});

export const sessionPlanActions = [
  listPlanningArtifacts,
  showSessionPlan,
  showSessionPlanSet,
  createSessionPlanAction,
  setSessionPlanSectionAction,
  selectSessionPlanDimensions,
  checkSessionPlanReadiness,
  setSessionPlanReady,
  deleteSessionPlanAction,
  updateSessionPlanMetadataAction,
  handoffSessionPlan,
] as const;

async function buildLifecycleBySession(cwd: string, sessions: readonly string[]): Promise<Map<string, SessionPlanLifecycleProjection>> {
  const planning = adapter();
  const entries = await Promise.all(sessions.map(async (session) => {
    try {
      const loaded = await planning.flat.load({ cwd, session });
      return [session, await buildLifecycleForPlan(cwd, loaded.plan)] as const;
    } catch {
      return undefined;
    }
  }));
  return new Map(entries.filter((entry): entry is readonly [string, SessionPlanLifecycleProjection] => entry !== undefined));
}

async function buildLifecycleForPlan(cwd: string, plan: Parameters<typeof projectSessionPlanSourceRefs>[0]): Promise<SessionPlanLifecycleProjection> {
  const [items, epics, traces] = await Promise.all([listBacklogItems(cwd), listBacklogEpics(cwd), listTraceSidecars(cwd)]);
  const traceSummaries = await summarizeProjectTraces(cwd, traces);
  return projectSessionPlanLifecycle({ session: plan.session, sourceRefs: projectSessionPlanSourceRefs(plan), items, epics, traceSummaries });
}

function quoteShellArg(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}
