import { defineExtensionAction } from '@eforge-build/extension-sdk';
import { toJsonSafeObject } from './json-safe.js';
import { userActionError } from './action-errors.js';
import { listBacklogItems, readBacklogItem } from './markdown-store.js';
import { promoteBacklogSelection } from './promote.js';
import { readRecommendationsFromPath, resolveRecommendationsPath } from './recommendations-store.js';
import { markRecommendationsStaleForBacklogMutation } from './recommendation-status.js';
import {
  AdviseMergeDraftUnitsInputSchema,
  AdviseSplitDraftUnitInputSchema,
  AdvisoryOutputSchema,
  CreateDraftUnitInputSchema,
  DeleteDraftUnitOutputSchema,
  DraftUnitIdInputSchema,
  DraftUnitOutputSchema,
  ForkRecommendationToDraftUnitInputSchema,
  ListDraftUnitsInputSchema,
  ListDraftUnitsOutputSchema,
  MergeDraftUnitsInputSchema,
  MergeDraftUnitsOutputSchema,
  PromoteDraftUnitInputSchema,
  PromoteDraftUnitOutputSchema,
  SplitDraftUnitInputSchema,
  SplitDraftUnitOutputSchema,
  UpdateDraftUnitInputSchema,
  type DraftPlanUnit,
  type DraftPlanUnitIndex,
  type DraftPlanUnitItem,
} from './draft-plan-unit-schemas.js';
import {
  createDraftPlanUnit,
  deleteDraftPlanUnit,
  findDraftPlanUnit,
  listDraftPlanUnits,
  markDraftPlanUnitPromoted,
  mergeDraftPlanUnits,
  readDraftPlanUnitIndex,
  splitDraftPlanUnit,
  updateDraftPlanUnit,
} from './draft-plan-unit-store.js';
import { adviseMerge, adviseSplit, buildDependencyContext, type DependencyMap, type LabelMap } from './draft-plan-unit-advisor.js';

async function assertItemsExist(cwd: string, itemIds: readonly string[]): Promise<void> {
  const missing: string[] = [];
  for (const id of itemIds) {
    if ((await readBacklogItem(cwd, id)) === null) missing.push(id);
  }
  if (missing.length > 0) throw userActionError(`Backlog item(s) not found: ${missing.join(', ')}.`, { path: 'itemIds', details: { missing } });
}

// Build the in-scope dependency + label maps the advisor consumes. `depends_on`
// is the only edge source; everything outside `scopeIds` is filtered so the
// advisor reasons only about edges between the items under consideration.
async function loadDependencyContext(cwd: string, scopeIds: ReadonlySet<string>): Promise<{ deps: DependencyMap; labels: LabelMap }> {
  const rows = (await listBacklogItems(cwd)).map((item) => ({ id: item.id, title: item.title, dependsOn: item.depends_on }));
  return buildDependencyContext(rows, scopeIds);
}

// Resolve and validate the units named for a merge (or merge preview): every id
// must exist and none may be promoted. Returns them in the requested order.
function resolveMergeSources(index: DraftPlanUnitIndex, unitIds: readonly string[]): DraftPlanUnit[] {
  return unitIds.map((unitId) => {
    const unit = findDraftPlanUnit(index, unitId);
    if (unit === undefined) throw userActionError(`No draft plan unit found for ${unitId}.`, { path: 'unitIds', details: { unitId } });
    if (unit.status === 'promoted') throw userActionError(`Draft plan unit ${unitId} was already promoted and cannot be merged.`, { path: 'unitIds', details: { unitId } });
    return unit;
  });
}

// Resolve and validate one unit and a peel set for a split (or split preview):
// the unit must exist, be a draft, and the peel set must be a non-empty strict
// subset of its items. Returns the split and remainder item-id lists.
function resolveSplitItemIds(index: DraftPlanUnitIndex, unitId: string, itemIds: readonly string[]): { splitIds: string[]; remainderIds: string[] } {
  const unit = findDraftPlanUnit(index, unitId);
  if (unit === undefined) throw userActionError(`No draft plan unit found for ${unitId}.`, { path: 'unitId', details: { unitId } });
  if (unit.status === 'promoted') throw userActionError(`Draft plan unit ${unitId} was already promoted and cannot be split.`, { path: 'unitId', details: { unitId } });
  const present = new Set(unit.items.map((item) => item.itemId));
  const missing = itemIds.filter((id) => !present.has(id));
  if (missing.length > 0) throw userActionError(`Item(s) not in draft plan unit ${unitId}: ${missing.join(', ')}.`, { path: 'itemIds', details: { missing } });
  const peel = new Set(itemIds);
  const remainderIds = unit.items.filter((item) => !peel.has(item.itemId)).map((item) => item.itemId);
  if (remainderIds.length === 0) throw userActionError(`Splitting off every item would leave draft plan unit ${unitId} empty; keep at least one item in the original.`, { path: 'itemIds', details: { unitId } });
  return { splitIds: [...itemIds], remainderIds };
}

const forkRecommendationToDraftUnit = defineExtensionAction({
  id: 'fork-recommendation-to-draft-unit',
  title: 'Fork recommendation lane to draft plan unit',
  description: 'Create an editable draft plan unit from a recommendation safe-to-parallelize lane, carrying its items as recommendation-grouped and its suggested profile.',
  inputSchema: ForkRecommendationToDraftUnitInputSchema,
  outputSchema: DraftUnitOutputSchema,
  sideEffects: ['local-read', 'local-write'],
  async handler(input, ctx) {
    const recommendations = await readRecommendationsFromPath(resolveRecommendationsPath(ctx.paths));
    const group = recommendations?.safeParallelizableGroups.find((candidate) => candidate.ref === input.recommendationRef);
    if (group === undefined) throw userActionError(`No recommendation lane found for ref "${input.recommendationRef}".`, { path: 'recommendationRef', details: { recommendationRef: input.recommendationRef } });
    await assertItemsExist(ctx.cwd, group.itemIds);
    const items: DraftPlanUnitItem[] = group.itemIds.map((itemId) => ({ itemId, origin: 'recommendation' }));
    const unit = await createDraftPlanUnit(ctx.cwd, {
      title: input.title ?? group.title ?? input.recommendationRef,
      ...(group.rationale !== undefined && { intent: group.rationale }),
      provenance: 'recommendation',
      sourceRecommendationRef: input.recommendationRef,
      ...(group.recommendedProfile !== undefined && { profile: group.recommendedProfile }),
      items,
    });
    return toJsonSafeObject({ unit });
  },
});

const createDraftUnit = defineExtensionAction({
  id: 'create-draft-unit',
  title: 'Create draft plan unit',
  description: 'Create a user-authored draft plan unit from a hand-picked set of backlog items.',
  inputSchema: CreateDraftUnitInputSchema,
  outputSchema: DraftUnitOutputSchema,
  sideEffects: ['local-read', 'local-write'],
  async handler(input, ctx) {
    const itemIds = input.itemIds ?? [];
    await assertItemsExist(ctx.cwd, itemIds);
    const items: DraftPlanUnitItem[] = itemIds.map((itemId) => ({ itemId, origin: 'user' }));
    const unit = await createDraftPlanUnit(ctx.cwd, {
      title: input.title,
      ...(input.intent !== undefined && { intent: input.intent }),
      provenance: 'user',
      ...(input.profile !== undefined && { profile: input.profile }),
      items,
    });
    return toJsonSafeObject({ unit });
  },
});

const listDraftUnits = defineExtensionAction({
  id: 'list-draft-units',
  title: 'List draft plan units',
  description: 'List all draft plan units newest-first, including promoted units.',
  inputSchema: ListDraftUnitsInputSchema,
  outputSchema: ListDraftUnitsOutputSchema,
  sideEffects: ['local-read'],
  async handler(_input, ctx) {
    const units = listDraftPlanUnits(await readDraftPlanUnitIndex(ctx.cwd));
    return toJsonSafeObject({ units });
  },
});

const getDraftUnit = defineExtensionAction({
  id: 'get-draft-unit',
  title: 'Get draft plan unit',
  description: 'Read one draft plan unit by id.',
  inputSchema: DraftUnitIdInputSchema,
  outputSchema: DraftUnitOutputSchema,
  sideEffects: ['local-read'],
  async handler(input, ctx) {
    const unit = findDraftPlanUnit(await readDraftPlanUnitIndex(ctx.cwd), input.unitId);
    if (unit === undefined) throw userActionError(`No draft plan unit found for ${input.unitId}.`, { path: 'unitId', details: { unitId: input.unitId } });
    return toJsonSafeObject({ unit });
  },
});

const updateDraftUnit = defineExtensionAction({
  id: 'update-draft-unit',
  title: 'Update draft plan unit',
  description: 'Edit a draft plan unit: rename, set intent or profile, and add, remove, or reorder its backlog items. Added items are recorded as user-added.',
  inputSchema: UpdateDraftUnitInputSchema,
  outputSchema: DraftUnitOutputSchema,
  sideEffects: ['local-read', 'local-write'],
  async handler(input, ctx) {
    if (input.addItemIds !== undefined && input.addItemIds.length > 0) await assertItemsExist(ctx.cwd, input.addItemIds);
    const unit = await updateDraftPlanUnit(ctx.cwd, input.unitId, {
      ...(input.title !== undefined && { title: input.title }),
      ...(input.intent !== undefined && { intent: input.intent }),
      ...(input.profile !== undefined && { profile: input.profile }),
      ...(input.addItemIds !== undefined && { addItems: input.addItemIds.map((itemId) => ({ itemId, origin: 'user' as const })) }),
      ...(input.removeItemIds !== undefined && { removeItemIds: input.removeItemIds }),
      ...(input.itemOrder !== undefined && { itemOrder: input.itemOrder }),
    });
    return toJsonSafeObject({ unit });
  },
});

const deleteDraftUnit = defineExtensionAction({
  id: 'delete-draft-unit',
  title: 'Delete draft plan unit',
  description: 'Delete a draft plan unit. Does not affect any session plan already promoted from it.',
  inputSchema: DraftUnitIdInputSchema,
  outputSchema: DeleteDraftUnitOutputSchema,
  sideEffects: ['local-write'],
  async handler(input, ctx) {
    const deleted = await deleteDraftPlanUnit(ctx.cwd, input.unitId);
    return toJsonSafeObject({ unitId: input.unitId, deleted });
  },
});

const promoteDraftUnit = defineExtensionAction({
  id: 'promote-draft-unit',
  title: 'Promote draft plan unit',
  description: 'Promote a draft plan unit plan-first into one session plan, reusing the standard selection promotion. The unit is marked promoted with the resulting session.',
  inputSchema: PromoteDraftUnitInputSchema,
  outputSchema: PromoteDraftUnitOutputSchema,
  sideEffects: ['local-read', 'local-write'],
  async handler(input, ctx) {
    const unit = findDraftPlanUnit(await readDraftPlanUnitIndex(ctx.cwd), input.unitId);
    if (unit === undefined) throw userActionError(`No draft plan unit found for ${input.unitId}.`, { path: 'unitId', details: { unitId: input.unitId } });
    if (unit.status === 'promoted') throw userActionError(`Draft plan unit ${input.unitId} was already promoted to ${unit.promotedSession ?? 'a session plan'}.`, { path: 'unitId', details: { unitId: input.unitId } });
    if (unit.items.length === 0) throw userActionError(`Draft plan unit ${input.unitId} has no items to promote.`, { path: 'unitId', details: { unitId: input.unitId } });
    const itemIds = unit.items.map((item) => item.itemId);
    await assertItemsExist(ctx.cwd, itemIds);
    const promotion = await promoteBacklogSelection({
      cwd: ctx.cwd,
      itemIds,
      title: unit.title,
      ...(input.status !== undefined && { status: input.status }),
      ...(input.session !== undefined && { session: input.session }),
      profile: unit.profile ?? null,
    });
    const updated = await markDraftPlanUnitPromoted(ctx.cwd, input.unitId, promotion.session);
    await markRecommendationsStaleForBacklogMutation(ctx.cwd, 'promote-draft-unit', promotion.itemIds);
    return toJsonSafeObject({ unit: updated, promotion });
  },
});

const mergeDraftUnits = defineExtensionAction({
  id: 'merge-draft-units',
  title: 'Merge draft plan units',
  description: 'Combine several draft plan units into one user-authored unit (union of items) and remove the sources. Returns a dependency advisory for the merge.',
  inputSchema: MergeDraftUnitsInputSchema,
  outputSchema: MergeDraftUnitsOutputSchema,
  sideEffects: ['local-read', 'local-write'],
  async handler(input, ctx) {
    const sources = resolveMergeSources(await readDraftPlanUnitIndex(ctx.cwd), input.unitIds);
    const groups = sources.map((unit) => unit.items.map((item) => item.itemId));
    const result = await mergeDraftPlanUnits(ctx.cwd, input.unitIds, {
      ...(input.title !== undefined && { title: input.title }),
      ...(input.intent !== undefined && { intent: input.intent }),
      ...(input.profile !== undefined && { profile: input.profile }),
    });
    const { deps, labels } = await loadDependencyContext(ctx.cwd, new Set(groups.flat()));
    const advisory = adviseMerge(groups, deps, labels);
    return toJsonSafeObject({ unit: result.unit, removedUnitIds: result.removedUnitIds, advisory });
  },
});

const splitDraftUnit = defineExtensionAction({
  id: 'split-draft-unit',
  title: 'Split draft plan unit',
  description: 'Peel a subset of a draft plan unit’s items into a new user-authored unit; the original keeps the rest. Returns a dependency advisory for the split.',
  inputSchema: SplitDraftUnitInputSchema,
  outputSchema: SplitDraftUnitOutputSchema,
  sideEffects: ['local-read', 'local-write'],
  async handler(input, ctx) {
    const { splitIds, remainderIds } = resolveSplitItemIds(await readDraftPlanUnitIndex(ctx.cwd), input.unitId, input.itemIds);
    const result = await splitDraftPlanUnit(ctx.cwd, input.unitId, input.itemIds, {
      title: input.title,
      ...(input.intent !== undefined && { intent: input.intent }),
      ...(input.profile !== undefined && { profile: input.profile }),
    });
    const { deps, labels } = await loadDependencyContext(ctx.cwd, new Set([...splitIds, ...remainderIds]));
    const advisory = adviseSplit(splitIds, remainderIds, deps, labels);
    return toJsonSafeObject({ original: result.original, created: result.created, advisory });
  },
});

const adviseMergeDraftUnits = defineExtensionAction({
  id: 'advise-merge-draft-units',
  title: 'Advise on merging draft plan units',
  description: 'Preview the dependency advisory for merging draft plan units without changing anything. Use before merging to warn when units are independent.',
  inputSchema: AdviseMergeDraftUnitsInputSchema,
  outputSchema: AdvisoryOutputSchema,
  sideEffects: ['local-read'],
  async handler(input, ctx) {
    const sources = resolveMergeSources(await readDraftPlanUnitIndex(ctx.cwd), input.unitIds);
    const groups = sources.map((unit) => unit.items.map((item) => item.itemId));
    const { deps, labels } = await loadDependencyContext(ctx.cwd, new Set(groups.flat()));
    return toJsonSafeObject({ advisory: adviseMerge(groups, deps, labels) });
  },
});

const adviseSplitDraftUnit = defineExtensionAction({
  id: 'advise-split-draft-unit',
  title: 'Advise on splitting a draft plan unit',
  description: 'Preview the dependency advisory for splitting a draft plan unit without changing anything. Use before splitting to warn when a dependency would be separated.',
  inputSchema: AdviseSplitDraftUnitInputSchema,
  outputSchema: AdvisoryOutputSchema,
  sideEffects: ['local-read'],
  async handler(input, ctx) {
    const { splitIds, remainderIds } = resolveSplitItemIds(await readDraftPlanUnitIndex(ctx.cwd), input.unitId, input.itemIds);
    const { deps, labels } = await loadDependencyContext(ctx.cwd, new Set([...splitIds, ...remainderIds]));
    return toJsonSafeObject({ advisory: adviseSplit(splitIds, remainderIds, deps, labels) });
  },
});

export const draftPlanUnitActions = [
  forkRecommendationToDraftUnit,
  createDraftUnit,
  listDraftUnits,
  getDraftUnit,
  updateDraftUnit,
  deleteDraftUnit,
  promoteDraftUnit,
  mergeDraftUnits,
  splitDraftUnit,
  adviseMergeDraftUnits,
  adviseSplitDraftUnit,
] as const;
