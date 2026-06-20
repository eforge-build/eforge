import { defineExtensionAction } from '@eforge-build/extension-sdk';
import { toJsonSafeObject } from './json-safe.js';
import { userActionError } from './action-errors.js';
import { readBacklogItem } from './markdown-store.js';
import { promoteBacklogSelection } from './promote.js';
import { readRecommendationsFromPath, resolveRecommendationsPath } from './recommendations-store.js';
import { markRecommendationsStaleForBacklogMutation } from './recommendation-status.js';
import {
  CreateDraftUnitInputSchema,
  DeleteDraftUnitOutputSchema,
  DraftUnitIdInputSchema,
  DraftUnitOutputSchema,
  ForkRecommendationToDraftUnitInputSchema,
  ListDraftUnitsInputSchema,
  ListDraftUnitsOutputSchema,
  PromoteDraftUnitInputSchema,
  PromoteDraftUnitOutputSchema,
  UpdateDraftUnitInputSchema,
  type DraftPlanUnitItem,
} from './draft-plan-unit-schemas.js';
import {
  createDraftPlanUnit,
  deleteDraftPlanUnit,
  findDraftPlanUnit,
  listDraftPlanUnits,
  markDraftPlanUnitPromoted,
  readDraftPlanUnitIndex,
  updateDraftPlanUnit,
} from './draft-plan-unit-store.js';

async function assertItemsExist(cwd: string, itemIds: readonly string[]): Promise<void> {
  const missing: string[] = [];
  for (const id of itemIds) {
    if ((await readBacklogItem(cwd, id)) === null) missing.push(id);
  }
  if (missing.length > 0) throw userActionError(`Backlog item(s) not found: ${missing.join(', ')}.`, { path: 'itemIds', details: { missing } });
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

export const draftPlanUnitActions = [
  forkRecommendationToDraftUnit,
  createDraftUnit,
  listDraftUnits,
  getDraftUnit,
  updateDraftUnit,
  deleteDraftUnit,
  promoteDraftUnit,
] as const;
