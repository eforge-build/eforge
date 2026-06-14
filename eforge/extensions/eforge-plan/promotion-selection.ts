import {
  itemsForEpic,
  selectedEpicSummaries,
  selectedSourceSummaries,
  sortItemsDependencyBeforeDependent,
  type BacklogEpic,
  type BacklogItem,
} from './backlog-domain.js';
import { listBacklogItems, readBacklogEpic, readBacklogItem } from './markdown-store.js';
import { readRecommendations } from './recommendations-store.js';
import { userActionError } from './action-errors.js';
import type { BacklogRecommendationModel, PlanningProfileInput, RecommendationGroup, RecommendationItemRef } from './schema.js';

export interface PromotionSelectionInput {
  cwd: string;
  itemIds?: string[];
  epicId?: string;
  recommendationRef?: string;
  session?: string;
  status?: 'active' | 'planned';
  profile?: PlanningProfileInput | null;
  title?: string;
}

export interface PromotionSelection {
  items: BacklogItem[];
  epics: BacklogEpic[];
  itemIds: string[];
  epicIds: string[];
  title: string;
  session?: string;
  status: 'active' | 'planned';
  profile: PlanningProfileInput | null;
  recommendationRef?: string;
  recommendationGroup?: RecommendationGroup;
  recommendationItem?: RecommendationItemRef;
  recommendationModel?: BacklogRecommendationModel;
  sources: ReturnType<typeof selectedSourceSummaries>;
  epicSources: ReturnType<typeof selectedEpicSummaries>;
}

export async function resolvePromotionSelection(input: PromotionSelectionInput): Promise<PromotionSelection> {
  validateSelectorFamilies(input);
  const selected = input.itemIds !== undefined
    ? await resolveExplicitItems(input.cwd, input.itemIds)
    : input.epicId !== undefined
      ? await resolveEpicItems(input.cwd, input.epicId)
      : await resolveRecommendationItems(input.cwd, input.recommendationRef!);
  const epicIds = relatedEpicIds(selected.items, selected.extraEpicIds);
  const epics = await resolveRelatedEpics(input.cwd, epicIds);
  const itemIds = selected.items.map((item) => item.id);
  const profile = resolveProfile(input, selected.recommendationGroup, itemIds.length);
  return {
    items: selected.items,
    epics,
    itemIds,
    epicIds,
    title: input.title ?? selected.title ?? defaultSelectionTitle(selected.items),
    session: input.session,
    status: input.status ?? 'active',
    profile,
    ...(input.recommendationRef !== undefined && { recommendationRef: input.recommendationRef }),
    ...(selected.recommendationGroup !== undefined && { recommendationGroup: selected.recommendationGroup }),
    ...(selected.recommendationItem !== undefined && { recommendationItem: selected.recommendationItem }),
    ...(selected.recommendationModel !== undefined && { recommendationModel: selected.recommendationModel }),
    sources: selectedSourceSummaries(selected.items),
    epicSources: selectedEpicSummaries(epics),
  };
}

function validateSelectorFamilies(input: PromotionSelectionInput): void {
  const selectors = [input.itemIds !== undefined, input.epicId !== undefined, input.recommendationRef !== undefined].filter(Boolean).length;
  if (selectors !== 1) {
    throw userActionError('Promotion selection must include exactly one selector: itemIds, epicId, or recommendationRef.', { path: 'selection', details: { selectorCount: selectors } });
  }
  if (input.itemIds !== undefined) {
    if (input.itemIds.length === 0) throw userActionError('Promotion selection itemIds must include at least one item id.', { path: 'itemIds' });
    const seen = new Set<string>();
    for (const id of input.itemIds) {
      if (seen.has(id)) throw userActionError(`Duplicate backlog item id in promotion selection: ${id}`, { path: 'itemIds', details: { itemId: id } });
      seen.add(id);
    }
  }
}

async function resolveExplicitItems(cwd: string, itemIds: string[]): Promise<ResolvedSelection> {
  return { items: await readRequiredItems(cwd, itemIds) };
}

async function resolveEpicItems(cwd: string, epicId: string): Promise<ResolvedSelection> {
  const epic = await readBacklogEpic(cwd, epicId);
  if (!epic) throw userActionError(`Backlog epic not found: ${epicId}`, { path: 'epicId', details: { epicId } });
  const items = sortItemsDependencyBeforeDependent(itemsForEpic(await listBacklogItems(cwd), epicId));
  if (items.length === 0) throw userActionError(`No open backlog items found for epic: ${epicId}`, { path: 'epicId', details: { epicId } });
  return { items, extraEpicIds: [epicId], title: epic.title };
}

async function resolveRecommendationItems(cwd: string, recommendationRef: string): Promise<ResolvedSelection> {
  const recommendations = await readRecommendations(cwd);
  if (!recommendations) throw userActionError(`Recommendation ref not found: ${recommendationRef}`, { path: 'recommendationRef', details: { recommendationRef } });
  const group = recommendations.safeParallelizableGroups.find((entry) => entry.ref === recommendationRef);
  if (group) {
    if (group.itemIds.length === 0) throw userActionError(`Recommendation group ${recommendationRef} must include at least one item id.`, { path: 'recommendationRef', details: { recommendationRef } });
    return {
      items: await readRequiredItems(cwd, group.itemIds),
      extraEpicIds: group.epicIds,
      title: group.title,
      recommendationGroup: group,
      recommendationModel: recommendations,
    };
  }
  const item = recommendations.recommendedNextSequence.find((entry) => entry.ref === recommendationRef);
  if (item) {
    return {
      items: await readRequiredItems(cwd, [item.itemId]),
      recommendationItem: item,
      recommendationModel: recommendations,
    };
  }
  throw userActionError(`Recommendation ref not found: ${recommendationRef}`, { path: 'recommendationRef', details: { recommendationRef } });
}

async function readRequiredItems(cwd: string, itemIds: string[]): Promise<BacklogItem[]> {
  const items: BacklogItem[] = [];
  for (const itemId of itemIds) {
    const item = await readBacklogItem(cwd, itemId);
    if (!item) throw userActionError(`Backlog item not found: ${itemId}`, { path: 'itemIds', details: { itemId } });
    items.push(item);
  }
  return items;
}

function relatedEpicIds(items: readonly BacklogItem[], extraEpicIds: readonly string[] = []): string[] {
  return [...new Set([...items.flatMap((item) => item.epic ? [item.epic] : []), ...extraEpicIds])];
}

async function resolveRelatedEpics(cwd: string, epicIds: readonly string[]): Promise<BacklogEpic[]> {
  const epics: BacklogEpic[] = [];
  for (const epicId of epicIds) {
    const epic = await readBacklogEpic(cwd, epicId);
    if (epic) epics.push(epic);
  }
  return epics;
}

function resolveProfile(input: PromotionSelectionInput, group: RecommendationGroup | undefined, itemCount: number): PlanningProfileInput | null {
  if (input.profile !== undefined) return input.profile;
  if (group?.recommendedProfile !== undefined) return group.recommendedProfile;
  if (itemCount > 1 || input.epicId !== undefined) return 'excursion';
  return null;
}

function defaultSelectionTitle(items: readonly BacklogItem[]): string {
  if (items.length === 1) return items[0]!.title;
  return `Promote ${items.length} backlog items`;
}

interface ResolvedSelection {
  items: BacklogItem[];
  extraEpicIds?: string[];
  title?: string;
  recommendationGroup?: RecommendationGroup;
  recommendationItem?: RecommendationItemRef;
  recommendationModel?: BacklogRecommendationModel;
}
