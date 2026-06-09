import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { EXTENSION_AGENT_TASK_KIND_EFORGE_PLAN_PLANNING_DRAFT } from '../../../packages/client/src/extension-agent-tasks.js';
import { createSessionPlanningWorkflowAdapter, type PlanningDepth, type PlanningType } from '../../../packages/input/src/index.js';
import {
  blockerRiskProjection,
  dependencyProjection,
  extractMarkdownSections,
  isOpenStatus,
  orderedSourceReferenceSummaries,
  type BacklogEpic,
  type BacklogItem,
} from './backlog-domain.js';
import { listBacklogEpics, listBacklogItems } from './markdown-store.js';
import { promoteBacklogSelection } from './promote.js';
import { resolvePromotionSelection } from './promotion-selection.js';
import {
  createEmptyRecommendationModel,
  readRecommendations,
  resolveRecommendationsPathForCwd,
  summarizeRecommendations,
  writeRecommendations,
} from './recommendations-store.js';
import { updateSessionPlanMetadata, updateSessionPlanSourceMetadata, type SessionPlanSourceMetadata } from './session-plan-metadata.js';
import { markRecommendationsStaleForBacklogMutation, readPlannerTraceSummaries, recordPlannerRecommendationApplied, recordPlannerRecommendationAppliedForSourceFingerprint } from './recommendation-status.js';
import { upsertPromotedSessionPlan } from './trace-store.js';
import { findPlanningTaskWorkflowEntry, readPlanningTaskWorkflowIndex, isRecommendationRefreshWorkflowEntry } from './planning-task-workflow-store.js';
import {
  PLANNING_DEPTHS,
  PLANNING_PROFILES,
  PLANNING_TYPES,
  type ApplyPlannerResultInput,
  type BacklogRecommendationModel,
  type PlannerContextInput,
  type PlannerHandoffDraft,
} from './schema.js';
import type {
  ApplyPlanningAgentTaskCreationDraftSelection,
  ApplyPlanningAgentTaskResultInput,
  ApplyPlanningAgentTaskResultOutput,
  AppliedSessionPlanCreationDraft,
} from './planning-agent-task-schemas.js';

export async function preparePlannerContext(cwd: string, input: PlannerContextInput = {}) {
  const includeRoadmap = input.includeRoadmap ?? true;
  const selected = await resolvePlannerSelection(cwd, input);
  const recommendationModel = await readRecommendations(cwd);
  const recommendations = recommendationModel ?? createEmptyRecommendationModel();
  const sourceRefs = orderedSourceReferenceSummaries(selected.items, selected.epics);
  return {
    schemaVersion: 1 as const,
    selection: {
      kind: selectionKind(input),
      itemIds: selected.items.map((item) => item.id),
      epicIds: selected.epics.map((epic) => epic.id),
      ...(input.recommendationRef !== undefined && { recommendationRef: input.recommendationRef }),
    },
    items: selected.items.map((item, index) => projectItem(item, sourceRefs[index])),
    epics: selected.epics.map((epic) => projectEpic(epic)),
    recommendations: { exists: recommendationModel !== null, model: recommendations, summary: summarizeRecommendations(recommendations) },
    recommendationRationale: recommendations.rationaleAndAssumptions,
    dependencies: dependencyContext(selected.items),
    roadmapEvidence: includeRoadmap ? await readRoadmapEvidence(cwd) : { path: 'docs/roadmap.md', exists: false, headings: [], excerpts: [] },
    traceSummaries: await readPlannerTraceSummaries(cwd, selected.items.map((item) => item.id)),
  };
}

export async function applyPlannerResult(cwd: string, input: ApplyPlannerResultInput, options: { recommendationSourceFingerprint?: string; lastRefreshedBy?: string } = {}) {
  if (input.recommendations === undefined && input.handoffDraft === undefined) {
    throw new Error('Planner result must include recommendations, handoffDraft, or both.');
  }
  const result: Record<string, unknown> = { schemaVersion: 1 };
  if (input.recommendations !== undefined) {
    const recommendations = await writeRecommendations(cwd, input.recommendations);
    const status = options.recommendationSourceFingerprint !== undefined
      ? await recordPlannerRecommendationAppliedForSourceFingerprint(cwd, options.recommendationSourceFingerprint, options.lastRefreshedBy ?? 'apply-planner-result')
      : await recordPlannerRecommendationApplied(cwd, options.lastRefreshedBy ?? 'apply-planner-result');
    result.recommendations = {
      recommendations,
      recommendationSummary: summarizeRecommendations(recommendations),
      path: resolveRecommendationsPathForCwd(cwd),
      status,
    };
  }
  if (input.handoffDraft !== undefined) {
    const handoff = await promoteBacklogSelection({
      cwd,
      ...input.handoffDraft.selection,
      session: input.handoffDraft.session ?? input.handoffDraft.selection.session,
      title: input.handoffDraft.title ?? input.handoffDraft.selection.title,
      profile: input.handoffDraft.profile ?? input.handoffDraft.selection.profile,
    });
    const staleStatus = await markRecommendationsStaleForBacklogMutation(cwd, 'planner-result-handoff', handoff.itemIds);
    if (staleStatus !== null && isRecord(result.recommendations)) result.recommendations = { ...result.recommendations, status: staleStatus };
    result.handoff = handoff;
  }
  return result;
}

interface PlanningAgentTaskRecordLike {
  taskId: string;
  kind: string;
  status: string;
  result?: unknown;
}

export async function applyCompletedPlanningAgentTaskResult(
  cwd: string,
  task: PlanningAgentTaskRecordLike,
  input: ApplyPlanningAgentTaskResultInput,
): Promise<ApplyPlanningAgentTaskResultOutput> {
  assertCompletedPlanningDraftTask(task);
  const rawResult = task.result as Record<string, unknown> | undefined;
  if (rawResult === undefined || Object.keys(rawResult).length === 0) throw new Error(`Planning task ${task.taskId} completed without a result.`);
  const output: ApplyPlanningAgentTaskResultOutput = {
    schemaVersion: 1,
    taskId: task.taskId,
    applied: { recommendations: false, handoffDrafts: 0, sessionPlanSections: 0 },
  };
  const recommendations = input.applyRecommendations ? rawResult.recommendations : undefined;
  if (input.applyRecommendations && !isRecord(recommendations)) throw new Error(`Planning task ${task.taskId} result does not include generated recommendations.`);
  const handoffDrafts = input.applyHandoffDrafts?.map((selection) => mergeHandoffSelection(resolveHandoffDraft(rawResult, selection.index), selection));
  const sessionPlanDrafts = input.applySessionPlanDrafts !== undefined ? resolveSelectedSessionPlanSections(rawResult, input.applySessionPlanDrafts) : undefined;
  const creationDraft = input.applySessionPlanCreationDraft !== undefined ? resolveSessionPlanCreationDraft(rawResult, input.applySessionPlanCreationDraft) : undefined;
  const creationDraftLinkage = creationDraft !== undefined ? await resolveCreationDraftSourceLinkage(cwd, task.taskId) : undefined;
  await validatePlanningAgentTaskApplyTargets(cwd, handoffDrafts, sessionPlanDrafts, creationDraft);

  if (input.applyRecommendations) {
    const recommendationSourceFingerprint = await resolveRecommendationApplySourceFingerprint(cwd, task.taskId);
    const applied = await applyPlannerResult(cwd, { recommendations: recommendations as BacklogRecommendationModel }, { recommendationSourceFingerprint, lastRefreshedBy: 'apply-planning-agent-task-result' });
    output.recommendations = applied.recommendations as ApplyPlanningAgentTaskResultOutput['recommendations'];
    output.applied.recommendations = true;
  }
  if (handoffDrafts !== undefined) {
    const handoffs: NonNullable<ApplyPlanningAgentTaskResultOutput['handoffs']> = [];
    for (const handoffDraft of handoffDrafts) {
      const applied = await applyPlannerResult(cwd, { handoffDraft });
      if (applied.handoff !== undefined) handoffs.push(applied.handoff as NonNullable<ApplyPlanningAgentTaskResultOutput['handoffs']>[number]);
    }
    output.handoffs = handoffs;
    output.applied.handoffDrafts = handoffs.length;
  }
  if (sessionPlanDrafts !== undefined) {
    output.sessionPlanDrafts = await applySelectedSessionPlanSections(cwd, sessionPlanDrafts);
    output.applied.sessionPlanSections = output.sessionPlanDrafts.reduce((count, entry) => count + entry.sections.length, 0);
  }
  if (creationDraft !== undefined) {
    output.sessionPlanCreationDraft = await applySessionPlanCreationDraft(cwd, creationDraft, creationDraftLinkage);
  }
  return output;
}

interface SessionPlanCreationDraftShape {
  session: string;
  topic: string;
  planningType: string;
  planningDepth: string;
  profile?: (typeof PLANNING_PROFILES)[number];
  agentProfile?: string;
  sections: Array<{ dimension: string; content: string }>;
  skippedDimensions?: Array<{ dimension: string; reason: string }>;
}

interface ResolvedSessionPlanCreationDraft {
  draft: SessionPlanCreationDraftShape;
  session: string;
  selection: ApplyPlanningAgentTaskCreationDraftSelection;
  openQuestions?: string[];
}

function resolveSessionPlanCreationDraft(result: Record<string, unknown>, selection: ApplyPlanningAgentTaskCreationDraftSelection): ResolvedSessionPlanCreationDraft {
  const draft = result.sessionPlanCreationDraft;
  if (!isSessionPlanCreationDraft(draft)) throw new Error('Planning task result does not include a session-plan creation draft.');
  if (!(PLANNING_TYPES as readonly string[]).includes(draft.planningType)) throw new Error(`Session-plan creation draft has an unsupported planning type "${draft.planningType}"; expected one of ${PLANNING_TYPES.join(', ')}.`);
  if (!(PLANNING_DEPTHS as readonly string[]).includes(draft.planningDepth)) throw new Error(`Session-plan creation draft has an unsupported planning depth "${draft.planningDepth}"; expected one of ${PLANNING_DEPTHS.join(', ')}.`);
  const session = (selection.session ?? draft.session).trim();
  if (session.length === 0) throw new Error('Session-plan creation draft requires a non-empty target session id.');
  const openQuestions = selection.openQuestions ?? (Array.isArray(result.assumptionsOpenQuestions) ? result.assumptionsOpenQuestions.filter((value): value is string => typeof value === 'string') : undefined);
  return { draft, session, selection, ...(openQuestions !== undefined && { openQuestions }) };
}

async function applySessionPlanCreationDraft(cwd: string, resolved: ResolvedSessionPlanCreationDraft, linkage: CreationDraftSourceLinkage | undefined): Promise<AppliedSessionPlanCreationDraft> {
  const planning = createSessionPlanningWorkflowAdapter();
  const { draft, session, selection } = resolved;
  const planningType = draft.planningType as PlanningType;
  const planningDepth = draft.planningDepth as PlanningDepth;
  await planning.flat.create({ cwd, session, topic: draft.topic, planningType, planningDepth });
  await planning.flat.selectDimensions({ cwd, session, planningType, planningDepth });
  for (const section of draft.sections) {
    await planning.flat.setSection({ cwd, session, dimension: section.dimension, content: section.content });
  }
  for (const skipped of draft.skippedDimensions ?? []) {
    await planning.flat.skipDimension({ cwd, session, dimension: skipped.dimension, reason: skipped.reason });
  }
  await updateSessionPlanMetadata({
    cwd,
    session,
    ...(selection.profile !== undefined && { profile: selection.profile }),
    ...(selection.agentProfile !== undefined && { agentProfile: selection.agentProfile }),
    ...(resolved.openQuestions !== undefined && { openQuestions: resolved.openQuestions }),
  });
  const sourceRefs = linkage !== undefined ? await applyCreationDraftSourceLinkage(cwd, session, linkage) : undefined;
  const readiness = await planning.flat.readiness({ cwd, session });
  const relativePath = relative(cwd, planning.flat.resolvePath({ cwd, session })).replace(/\\/g, '/');
  return {
    session,
    relativePath,
    readiness,
    ...(sourceRefs !== undefined && linkage !== undefined && { sourceRefs, traceItemIds: linkage.sourceItemIds }),
  } as AppliedSessionPlanCreationDraft;
}

function isSessionPlanCreationDraft(value: unknown): value is SessionPlanCreationDraftShape {
  if (!isRecord(value)) return false;
  if (typeof value.session !== 'string' || typeof value.topic !== 'string') return false;
  if (typeof value.planningType !== 'string' || typeof value.planningDepth !== 'string') return false;
  if (value.profile !== undefined && !(PLANNING_PROFILES as readonly string[]).includes(value.profile as string)) return false;
  if (value.agentProfile !== undefined && typeof value.agentProfile !== 'string') return false;
  if (!Array.isArray(value.sections) || value.sections.length === 0) return false;
  return value.sections.every((entry) => isRecord(entry) && typeof entry.dimension === 'string' && typeof entry.content === 'string');
}

function assertCompletedPlanningDraftTask(task: PlanningAgentTaskRecordLike): asserts task is PlanningAgentTaskRecordLike & { status: 'completed'; result: unknown } {
  if (task.kind !== EXTENSION_AGENT_TASK_KIND_EFORGE_PLAN_PLANNING_DRAFT) throw new Error(`Task ${task.taskId} is not an eforge-plan planning-draft task.`);
  if (task.status !== 'completed') throw new Error(`Planning task ${task.taskId} is ${task.status}; only completed tasks can be applied.`);
  if (!('result' in task)) throw new Error(`Planning task ${task.taskId} completed without a result.`);
}

function resolveHandoffDraft(result: Record<string, unknown>, index: number | undefined): Partial<PlannerHandoffDraft> {
  const drafts = Array.isArray(result.handoffDrafts) ? result.handoffDrafts : result.handoffDraft !== undefined ? [result.handoffDraft] : [];
  const draft = drafts[index ?? 0];
  if (!isRecord(draft)) throw new Error('Selected planning task handoff draft is missing.');
  return draft as Partial<PlannerHandoffDraft>;
}

function mergeHandoffSelection(draft: Partial<PlannerHandoffDraft>, selection: NonNullable<ApplyPlanningAgentTaskResultInput['applyHandoffDrafts']>[number]): PlannerHandoffDraft {
  const selected = selection.selection ?? draft.selection;
  if (selected === undefined) throw new Error('Applying a handoff draft requires a selected backlog item, epic, or recommendation ref.');
  return {
    selection: selected,
    session: selection.session ?? draft.session,
    title: selection.title ?? draft.title,
    profile: selection.profile ?? draft.profile,
  };
}

function resolveSelectedSessionPlanSections(
  result: Record<string, unknown>,
  selections: NonNullable<ApplyPlanningAgentTaskResultInput['applySessionPlanDrafts']>,
): Array<{ session: string; sections: Array<{ dimension: string; content: string }> }> {
  const patch = resolveSessionPlanPatch(result);
  return selections.map((selection) => {
    const requested = new Set(selection.sections);
    const sections = patch.sections.filter((section) => requested.has(section.dimension));
    const resolved = new Set(sections.map((section) => section.dimension));
    const missing = selection.sections.filter((dimension) => !resolved.has(dimension));
    if (missing.length > 0) throw new Error(`Planning task result is missing selected session-plan sections for ${selection.session}: ${missing.join(', ')}.`);
    return { session: selection.session, sections };
  });
}

// --- eforge:region plan-01-trusted-creation-linkage ---
interface CreationDraftSourceLinkage {
  sourceItemIds: string[];
  sourceEpicIds: string[];
  sourceRecommendationRef?: string;
  items: BacklogItem[];
}

async function resolveCreationDraftSourceLinkage(cwd: string, taskId: string): Promise<CreationDraftSourceLinkage | undefined> {
  const entry = findPlanningTaskWorkflowEntry(await readPlanningTaskWorkflowIndex(cwd), taskId);
  if (entry === undefined) return undefined;
  const selection = workflowSelectionInput(entry.selection);
  if (selection === undefined) return undefined;
  const resolved = await resolvePromotionSelection({ cwd, ...selection });
  return {
    sourceItemIds: resolved.itemIds,
    sourceEpicIds: resolved.epicIds,
    ...(resolved.recommendationRef !== undefined && { sourceRecommendationRef: resolved.recommendationRef }),
    items: resolved.items,
  };
}

async function applyCreationDraftSourceLinkage(cwd: string, session: string, linkage: CreationDraftSourceLinkage): Promise<SessionPlanSourceMetadata> {
  const planning = createSessionPlanningWorkflowAdapter();
  const promotedAt = new Date().toISOString();
  const metadata = await updateSessionPlanSourceMetadata({
    cwd,
    session,
    sourceItemIds: linkage.sourceItemIds,
    sourceEpicIds: linkage.sourceEpicIds,
    ...(linkage.sourceRecommendationRef !== undefined && { sourceRecommendationRef: linkage.sourceRecommendationRef }),
    promotedAt,
  });
  const loaded = await planning.flat.load({ cwd, session });
  const path = planning.flat.resolvePath({ cwd, session });
  const status = loaded.plan.status ?? metadata.status ?? 'planning';
  for (const item of linkage.items) {
    await upsertPromotedSessionPlan(cwd, item.id, { session, path, status, promotedAt }, item.epic);
  }
  return {
    sourceItemIds: linkage.sourceItemIds,
    sourceEpicIds: linkage.sourceEpicIds,
    ...(linkage.sourceRecommendationRef !== undefined && { sourceRecommendationRef: linkage.sourceRecommendationRef }),
    promotedAt,
  };
}

function workflowSelectionInput(selection: { itemIds?: string[]; epicId?: string; recommendationRef?: string }): { itemIds?: string[]; epicId?: string; recommendationRef?: string } | undefined {
  if (selection.itemIds !== undefined || selection.epicId !== undefined || selection.recommendationRef !== undefined) {
    return {
      ...(selection.itemIds !== undefined && { itemIds: selection.itemIds }),
      ...(selection.epicId !== undefined && { epicId: selection.epicId }),
      ...(selection.recommendationRef !== undefined && { recommendationRef: selection.recommendationRef }),
    };
  }
  return undefined;
}
// --- eforge:endregion plan-01-trusted-creation-linkage ---

async function validatePlanningAgentTaskApplyTargets(
  cwd: string,
  handoffDrafts: PlannerHandoffDraft[] | undefined,
  sessionPlanDrafts: Array<{ session: string; sections: Array<{ dimension: string; content: string }> }> | undefined,
  creationDraft: ResolvedSessionPlanCreationDraft | undefined,
): Promise<void> {
  if (creationDraft !== undefined) {
    const path = createSessionPlanningWorkflowAdapter().flat.resolvePath({ cwd, session: creationDraft.session });
    if (existsSync(path)) throw new Error(`Session plan "${creationDraft.session}" already exists; choose a different target session id before applying a creation draft.`);
  }
  await Promise.all([
    ...(handoffDrafts ?? []).map((draft) => resolvePromotionSelection({
      cwd,
      ...draft.selection,
      session: draft.session ?? draft.selection.session,
      title: draft.title ?? draft.selection.title,
      profile: draft.profile ?? draft.selection.profile,
    })),
    ...sessionPlanSessions(sessionPlanDrafts).map((session) => createSessionPlanningWorkflowAdapter().flat.load({ cwd, session })),
  ]);
}

function sessionPlanSessions(selections: Array<{ session: string }> | undefined): string[] {
  return [...new Set((selections ?? []).map((selection) => selection.session))];
}

async function applySelectedSessionPlanSections(
  cwd: string,
  selections: Array<{ session: string; sections: Array<{ dimension: string; content: string }> }>,
): Promise<NonNullable<ApplyPlanningAgentTaskResultOutput['sessionPlanDrafts']>> {
  const planning = createSessionPlanningWorkflowAdapter();
  const applied = [];
  for (const selection of selections) {
    for (const section of selection.sections) {
      await planning.flat.setSection({ cwd, session: selection.session, dimension: section.dimension, content: section.content });
    }
    applied.push({ session: selection.session, sections: selection.sections.map((section) => section.dimension) });
  }
  return applied;
}

function resolveSessionPlanPatch(result: Record<string, unknown>): { sections: Array<{ dimension: string; content: string }> } {
  if (isSessionPlanPatch(result.sessionPlanPatch)) return result.sessionPlanPatch;
  if (Array.isArray(result.sessionPlanDrafts)) {
    const patch = result.sessionPlanDrafts.find(isSessionPlanPatch);
    if (patch !== undefined) return patch;
  }
  throw new Error('Planning task result does not include session-plan draft sections.');
}

function isSessionPlanPatch(value: unknown): value is { sections: Array<{ dimension: string; content: string }> } {
  return isRecord(value) && Array.isArray(value.sections) && value.sections.every((entry) => isRecord(entry) && typeof entry.dimension === 'string' && typeof entry.content === 'string');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

async function resolveRecommendationApplySourceFingerprint(cwd: string, taskId: string): Promise<string | undefined> {
  const entry = findPlanningTaskWorkflowEntry(await readPlanningTaskWorkflowIndex(cwd), taskId);
  if (entry === undefined || !isRecommendationRefreshWorkflowEntry(entry)) return undefined;
  return entry.sourceFingerprint;
}

async function resolvePlannerSelection(cwd: string, input: PlannerContextInput): Promise<{ items: BacklogItem[]; epics: BacklogEpic[] }> {
  if (input.itemIds !== undefined || input.epicId !== undefined || input.recommendationRef !== undefined) {
    const selection = await resolvePromotionSelection({ cwd, itemIds: input.itemIds, epicId: input.epicId, recommendationRef: input.recommendationRef });
    return { items: selection.items, epics: selection.epics };
  }
  const [items, epics] = await Promise.all([listBacklogItems(cwd), listBacklogEpics(cwd)]);
  return { items: items.filter((item) => isOpenStatus(item.status)), epics };
}

function selectionKind(input: PlannerContextInput): string {
  if (input.itemIds !== undefined) return 'itemIds';
  if (input.epicId !== undefined) return 'epicId';
  if (input.recommendationRef !== undefined) return 'recommendationRef';
  return 'open-backlog';
}

function projectItem(item: BacklogItem, sourceReference: string | undefined) {
  return {
    id: item.id,
    title: item.title,
    status: item.status,
    ...(item.epic !== undefined && { epic: item.epic }),
    tags: item.tags,
    dependencies: item.depends_on,
    sections: Object.fromEntries(extractMarkdownSections(item.body)),
    sourceReferences: sourceReference ? [sourceReference] : [],
  };
}

function projectEpic(epic: BacklogEpic) {
  return {
    id: epic.id,
    title: epic.title,
    status: epic.status,
    tags: epic.tags,
    sections: Object.fromEntries(extractMarkdownSections(epic.body)),
  };
}

function dependencyContext(items: readonly BacklogItem[]) {
  const risks = new Map(blockerRiskProjection(items).map((entry) => [entry.itemId, entry]));
  return dependencyProjection(items).map((entry) => ({
    ...entry,
    blockers: risks.get(entry.itemId)?.blockers ?? [],
    risks: risks.get(entry.itemId)?.risks ?? [],
  }));
}

async function readRoadmapEvidence(cwd: string) {
  const path = 'docs/roadmap.md';
  const absolute = join(cwd, path);
  if (!existsSync(absolute)) return { path, exists: false, headings: [], excerpts: [] };
  const markdown = await readFile(absolute, 'utf-8');
  const headings = markdown.split(/\r?\n/).map((line) => /^#{1,6}\s+(.+)$/.exec(line)?.[1]?.trim()).filter((line): line is string => Boolean(line));
  const excerpts = markdown.split(/\n\s*\n/).map((block) => block.trim()).filter(Boolean).slice(0, 5);
  return { path, exists: true, headings, excerpts };
}
