import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
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
import type { ApplyPlannerResultInput, PlannerContextInput } from './schema.js';

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
  };
}

export async function applyPlannerResult(cwd: string, input: ApplyPlannerResultInput) {
  if (input.recommendations === undefined && input.handoffDraft === undefined) {
    throw new Error('Planner result must include recommendations, handoffDraft, or both.');
  }
  const result: Record<string, unknown> = { schemaVersion: 1 };
  if (input.recommendations !== undefined) {
    const recommendations = await writeRecommendations(cwd, input.recommendations);
    result.recommendations = {
      recommendations,
      recommendationSummary: summarizeRecommendations(recommendations),
      path: resolveRecommendationsPathForCwd(cwd),
    };
  }
  if (input.handoffDraft !== undefined) {
    result.handoff = await promoteBacklogSelection({
      cwd,
      ...input.handoffDraft.selection,
      session: input.handoffDraft.session ?? input.handoffDraft.selection.session,
      title: input.handoffDraft.title ?? input.handoffDraft.selection.title,
      profile: input.handoffDraft.profile ?? input.handoffDraft.selection.profile,
    });
  }
  return result;
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
