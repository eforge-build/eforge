import { readFile } from 'node:fs/promises';
import { createSessionPlanningWorkflowAdapter, getReadinessDetail, selectDimensions, setSessionPlanSection, writeSessionPlan, type SessionPlan } from '@eforge-build/input';
import { EXTENSION_AGENT_TASK_KIND_EFORGE_PLAN_PLANNING_DRAFT, parseEforgePlanPlanningDraftResult, type EforgePlanPlanningPlanRevisionTurn, type ExtensionAgentTaskRecord } from '@eforge-build/client';
import { listBacklogEpics, listBacklogItems } from './markdown-store.js';
import { projectSessionPlanLifecycle, projectSessionPlanSourceRefs } from './lifecycle-projection.js';
import { listTraceSidecars } from './trace-store.js';
import { summarizeProjectTraces } from './trace-activity.js';
import { projectSessionPlan, projectSessionPlanDetail } from './session-plan-view-model.js';
import { boundedSourceText } from './planner-source-bounds.js';
import { canonicalJson, sha256 } from './markdown-store-support.js';
import type { PlanRevisionSessionEntry, PlanRevisionTurnAnnotationSnapshot, PlanRevisionTurnEntry } from './planning-agent-task-schemas.js';
import { projectAnnotationSnapshotForSource, summarizeAnnotationSnapshot } from './plan-revision-annotations.js';

export async function loadFlatPlanRevisionTarget(cwd: string, session: string) {
  const planning = createSessionPlanningWorkflowAdapter();
  const loaded = await planning.flat.load({ cwd, session });
  const [rawMarkdown, lifecycle] = await Promise.all([readFile(loaded.path, 'utf-8'), buildLifecycleForPlan(cwd, loaded.plan)]);
  return { ...loaded, rawMarkdown, sourceRefs: lifecycle.sourceRefs, lifecycle, detail: projectSessionPlanDetail({ ...loaded, lifecycle }) };
}

export function computeFlatPlanFingerprint(plan: SessionPlan): string {
  return sha256(canonicalJson(projectSessionPlan(plan)));
}

export function computeFlatSectionHashes(plan: SessionPlan): Array<{ dimension: string; sha256: string }> {
  return [...allowedDimensions(plan)].sort().map((dimension) => ({ dimension, sha256: sha256(sectionContentForDimension(plan, dimension)) }));
}

export function buildPlanRevisionSourceText(params: { targetSession: string; plan: SessionPlan; readiness: unknown; path: string; sourceRefs?: unknown; lifecycle?: unknown; basePlanFingerprint: string; baseSectionHashes: unknown[]; recentTurns: unknown[]; userMessage: string; annotationSnapshot?: PlanRevisionTurnAnnotationSnapshot; redraft?: Record<string, unknown> }): string {
  return boundedSourceText(params.userMessage, {
    schemaVersion: 1,
    purpose: 'plan-revision-turn',
    targetSession: params.targetSession,
    basePlanFingerprint: params.basePlanFingerprint,
    baseSectionHashes: params.baseSectionHashes,
    plan: projectSessionPlan(params.plan),
    readiness: params.readiness,
    path: params.path,
    sourceRefs: params.sourceRefs,
    lifecycle: params.lifecycle,
    recentTurns: params.recentTurns,
    userMessage: params.userMessage,
    ...(params.annotationSnapshot !== undefined && { annotationSnapshot: projectAnnotationSnapshotForSource(params.annotationSnapshot) }),
  }, params.redraft, revisionFallbackContext);
}

export async function buildRecentRevisionTurnContext(ctx: { agentTasks: { get(taskId: string): Promise<{ task: ExtensionAgentTaskRecord }> } }, sessionEntry: PlanRevisionSessionEntry, limit = 6): Promise<unknown[]> {
  const turns = sessionEntry.turns.slice(0, limit);
  return Promise.all(turns.map(async (turn) => {
    try {
      const response = await ctx.agentTasks.get(turn.taskId);
      const result = response.task.status === 'completed' ? parseResultIfPossible(response.task) : undefined;
      const planRevisionTurn = (result as { planRevisionTurn?: EforgePlanPlanningPlanRevisionTurn } | undefined)?.planRevisionTurn;
      return {
        turnId: turn.turnId,
        taskId: turn.taskId,
        userMessage: turn.userMessage,
        status: response.task.status,
        ...(planRevisionTurn !== undefined && { assistantMessage: planRevisionTurn.assistantMessage }),
        ...(Array.isArray((result as { clarificationQuestions?: unknown[] } | undefined)?.clarificationQuestions) && { clarificationQuestions: (result as { clarificationQuestions: unknown[] }).clarificationQuestions }),
        ...(turn.appliedAt !== undefined && { appliedAt: turn.appliedAt, appliedSections: turn.appliedSections ?? [] }),
        ...(turn.annotationSnapshot !== undefined && { annotationSnapshot: summarizeAnnotationSnapshot(turn.annotationSnapshot) }),
      };
    } catch (err) {
      return { turnId: turn.turnId, taskId: turn.taskId, userMessage: turn.userMessage, staleReason: err instanceof Error ? err.message : String(err) };
    }
  }));
}

export function resolveCompletedRevisionTurnResult(task: ExtensionAgentTaskRecord, storedTurn: PlanRevisionTurnEntry, targetSession: string): EforgePlanPlanningPlanRevisionTurn {
  if (task.kind !== EXTENSION_AGENT_TASK_KIND_EFORGE_PLAN_PLANNING_DRAFT || task.status !== 'completed') throw new Error(`Task ${storedTurn.taskId} is not a completed planning draft.`);
  const parsed = parseEforgePlanPlanningDraftResult(task.result);
  const turn = (parsed as { planRevisionTurn?: EforgePlanPlanningPlanRevisionTurn }).planRevisionTurn;
  if (turn === undefined) throw new Error('Completed task result does not include a planRevisionTurn.');
  if (turn.targetSession !== targetSession) throw new Error(`Revision result targets ${turn.targetSession}, not ${targetSession}.`);
  if (turn.basePlanFingerprint !== storedTurn.basePlanFingerprint) throw new Error('Revision result base fingerprint does not match the stored turn.');
  return turn;
}

export function validateRevisionPatchSections(plan: SessionPlan, turnResult: EforgePlanPlanningPlanRevisionTurn): { ok: true; sections: Array<{ dimension: string; content: string }> } | { ok: false; message: string } {
  const patchSections = turnResult.proposedPatch?.sections;
  if (patchSections === undefined || patchSections.length === 0) return { ok: false, message: 'Revision turn does not include section patches to apply.' };
  const allowed = allowedDimensions(plan);
  const normalizedPatch = normalizeProposedRevisionPatchSections(patchSections);
  if (!normalizedPatch.ok) return { ok: false, message: normalizedPatch.message };
  const sections = [...normalizedPatch.sectionsByDimension.values()];
  for (const section of sections) {
    if (!allowed.has(section.dimension)) return { ok: false, message: `Section ${section.dimension} is not an allowed flat session-plan dimension.` };
  }
  return { ok: true, sections };
}

export async function applyRevisionPatchSections(cwd: string, session: string, turnResult: EforgePlanPlanningPlanRevisionTurn, sections: string[]) {
  const planning = createSessionPlanningWorkflowAdapter();
  const normalizedPatch = normalizeProposedRevisionPatchSections(turnResult.proposedPatch?.sections ?? []);
  if (!normalizedPatch.ok) throw new Error(normalizedPatch.message);
  const byDimension = new Map([...normalizedPatch.sectionsByDimension].map(([dimension, section]) => [dimension, section.content]));
  let plan = (await planning.flat.load({ cwd, session })).plan;
  for (const rawDimension of sections) {
    const dimension = normalizeDimension(rawDimension);
    const content = byDimension.get(dimension);
    if (content === undefined) throw new Error(`Revision turn did not propose a patch for ${rawDimension}.`);
    plan = setSessionPlanSection(plan, dimension, content);
  }
  // Apply resolved open questions from the patch metadata. Without this, a turn
  // that resolves open questions only updates the body section, leaving the stale
  // frontmatter open_questions list (shown in the Open Questions panel) untouched.
  const resolvedOpenQuestions = turnResult.proposedPatch?.metadata?.openQuestions;
  if (resolvedOpenQuestions !== undefined) plan = { ...plan, open_questions: resolvedOpenQuestions };
  await writeSessionPlan({ cwd, session, plan });
  return projectRevisionPlanResult(cwd, session, plan);
}

/** Shape one in-memory flat plan into the `applied` revision-apply output payload. */
export function projectRevisionPlanResult(cwd: string, session: string, plan: SessionPlan) {
  return { session, readiness: getReadinessDetail(plan), plan: projectSessionPlan(plan), path: createSessionPlanningWorkflowAdapter().flat.resolvePath({ cwd, session }) };
}

function normalizeProposedRevisionPatchSections(patchSections: NonNullable<NonNullable<EforgePlanPlanningPlanRevisionTurn['proposedPatch']>['sections']>): { ok: true; sectionsByDimension: Map<string, { dimension: string; content: string }> } | { ok: false; message: string } {
  const sectionsByDimension = new Map<string, { dimension: string; content: string }>();
  for (const section of patchSections) {
    const dimension = normalizeDimension(section.dimension);
    if (dimension === '') return { ok: false, message: 'Revision turn proposed a patch with an empty section dimension.' };
    if (sectionsByDimension.has(dimension)) return { ok: false, message: `Revision turn proposed duplicate patches for ${dimension}.` };
    sectionsByDimension.set(dimension, { ...section, dimension });
  }
  return { ok: true, sectionsByDimension };
}

function sectionContentForDimension(plan: SessionPlan, dimension: string): string {
  return plan.sections.get(dimension) ?? plan.sections.get(dimension.replace(/-/g, ' ')) ?? '';
}

function revisionFallbackContext(bounded: Record<string, unknown>, metadata: Record<string, unknown>): Record<string, unknown> {
  metadata.revisionContextSummarized = true;
  const plan = bounded.plan !== null && typeof bounded.plan === 'object' ? bounded.plan as Record<string, unknown> : undefined;
  const readiness = bounded.readiness !== null && typeof bounded.readiness === 'object' ? bounded.readiness as Record<string, unknown> : undefined;
  return {
    schemaVersion: bounded.schemaVersion,
    purpose: bounded.purpose,
    targetSession: bounded.targetSession,
    basePlanFingerprint: bounded.basePlanFingerprint,
    baseSectionHashes: bounded.baseSectionHashes,
    userMessage: bounded.userMessage,
    path: bounded.path,
    ...(plan !== undefined && { plan: pickDefined(plan, ['session', 'topic', 'status', 'planning_type', 'planning_depth']) }),
    ...(readiness !== undefined && { readiness: pickDefined(readiness, ['ready', 'status', 'missingRequiredDimensions', 'openQuestions']) }),
    ...(bounded.annotationSnapshot !== undefined && { annotationSnapshot: summarizeFallbackAnnotationSnapshot(bounded.annotationSnapshot) }),
  };
}

function pickDefined(source: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  return Object.fromEntries(keys.flatMap((key) => source[key] === undefined ? [] : [[key, source[key]]]));
}

function allowedDimensions(plan: SessionPlan): Set<string> {
  const dims = selectDimensions(plan);
  return new Set([...dims.required, ...dims.optional, ...dims.skipped, ...plan.sections.keys()].map(normalizeDimension));
}

function normalizeDimension(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

async function buildLifecycleForPlan(cwd: string, plan: SessionPlan) {
  const [items, epics, traces] = await Promise.all([listBacklogItems(cwd), listBacklogEpics(cwd), listTraceSidecars(cwd)]);
  return projectSessionPlanLifecycle({ session: plan.session, sourceRefs: projectSessionPlanSourceRefs(plan), items, epics, traceSummaries: await summarizeProjectTraces(cwd, traces) });
}

function parseResultIfPossible(task: ExtensionAgentTaskRecord): Record<string, unknown> | undefined {
  try {
    return parseEforgePlanPlanningDraftResult((task as { result?: unknown }).result) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}


function summarizeFallbackAnnotationSnapshot(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return undefined;
  const snapshot = value as { steering?: unknown; selectedAnnotationIds?: unknown; openAnnotationIds?: unknown; includeOpenAnnotations?: unknown; annotations?: unknown };
  const selectedAnnotationIds = Array.isArray(snapshot.selectedAnnotationIds) ? snapshot.selectedAnnotationIds : [];
  const openAnnotationIds = Array.isArray(snapshot.openAnnotationIds) ? snapshot.openAnnotationIds : [];
  const annotations = Array.isArray(snapshot.annotations) ? snapshot.annotations : [];
  return {
    ...(typeof snapshot.steering === 'string' && { steering: boundFallbackText(snapshot.steering, 500) }),
    includeOpenAnnotations: snapshot.includeOpenAnnotations === true,
    selectedAnnotationIds,
    openAnnotationIds,
    selectedCount: selectedAnnotationIds.length,
    openCount: openAnnotationIds.length,
    annotationCount: annotations.length,
    annotations: annotations.slice(0, 4).map(summarizeFallbackAnnotation),
  };
}

function summarizeFallbackAnnotation(entry: unknown): Record<string, unknown> {
  const annotation = entry !== null && typeof entry === 'object' ? entry as { annotationId?: unknown; body?: unknown; target?: unknown; snapshotReason?: unknown } : {};
  const target = annotation.target !== null && typeof annotation.target === 'object' ? annotation.target as { kind?: unknown; dimension?: unknown; label?: unknown; capturedText?: unknown; quoteContext?: unknown } : {};
  const quoteContext = target.quoteContext !== null && typeof target.quoteContext === 'object' ? target.quoteContext as { exact?: unknown; prefix?: unknown; suffix?: unknown } : {};
  return {
    annotationId: annotation.annotationId,
    snapshotReason: annotation.snapshotReason,
    ...(typeof annotation.body === 'string' && { bodyPreview: boundFallbackText(annotation.body, 160) }),
    target: {
      kind: target.kind,
      ...(typeof target.dimension === 'string' && { dimension: target.dimension }),
      ...(typeof target.label === 'string' && { label: boundFallbackText(target.label, 120) }),
      ...(typeof target.capturedText === 'string' && { capturedTextPreview: boundFallbackText(target.capturedText, 160) }),
      quoteContext: {
        ...(typeof quoteContext.exact === 'string' && { exactPreview: boundFallbackText(quoteContext.exact, 160) }),
        ...(typeof quoteContext.prefix === 'string' && { prefixPreview: boundFallbackText(quoteContext.prefix, 120) }),
        ...(typeof quoteContext.suffix === 'string' && { suffixPreview: boundFallbackText(quoteContext.suffix, 120) }),
      },
    },
  };
}

function boundFallbackText(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}
