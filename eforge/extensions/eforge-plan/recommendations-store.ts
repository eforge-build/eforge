import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { parseWithSchema } from '@eforge-build/client';
import { createEforgeProjectPaths, type EforgeProjectPaths } from '../../../packages/extension-sdk/src/index.js';
import {
  BacklogRecommendationModelSchema,
  type BacklogRecommendationModel,
  type RecommendationSummary,
} from './schema.js';
import { validateRecommendationReferences } from './recommendation-status.js';

export const RECOMMENDATIONS_SCHEMA_VERSION = 1;

export function resolveRecommendationsPath(paths: EforgeProjectPaths): string {
  return paths.extensionStoragePath('project-local', ['recommendations', 'current.json']);
}

export function resolveRecommendationsPathForCwd(cwd: string): string {
  return resolveRecommendationsPath(createEforgeProjectPaths({ cwd, extensionName: 'eforge-plan' }));
}

export function createEmptyRecommendationModel(): BacklogRecommendationModel {
  return {
    schemaVersion: RECOMMENDATIONS_SCHEMA_VERSION,
    activeWork: [],
    readyCandidates: [],
    recommendedNextSequence: [],
    safeParallelizableGroups: [],
    blockedChains: [],
    rationaleAndAssumptions: [],
  };
}

export async function readRecommendationsFromPath(filePath: string): Promise<BacklogRecommendationModel | null> {
  if (!existsSync(filePath)) return null;
  return validateRecommendationModel(JSON.parse(await readFile(filePath, 'utf-8')) as unknown);
}

export async function readRecommendations(cwd: string): Promise<BacklogRecommendationModel | null> {
  return readRecommendationsFromPath(resolveRecommendationsPathForCwd(cwd));
}

export async function writeRecommendationsToPath(filePath: string, value: unknown): Promise<BacklogRecommendationModel> {
  const model = validateRecommendationModel(value);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(model, null, 2)}\n`);
  return model;
}

export async function writeRecommendations(cwd: string, value: unknown): Promise<BacklogRecommendationModel> {
  const model = parseRecommendationModel(value);
  await validateRecommendationReferences(cwd, model);
  return writeRecommendationsToPath(resolveRecommendationsPathForCwd(cwd), model);
}

export function parseRecommendationModel(value: unknown): BacklogRecommendationModel {
  assertRecommendationGroupsHaveItems(value);
  return parseWithSchema(BacklogRecommendationModelSchema, value);
}

export function validateRecommendationModel(value: unknown): BacklogRecommendationModel {
  return parseRecommendationModel(value);
}

function assertRecommendationGroupsHaveItems(value: unknown): void {
  if (!value || typeof value !== 'object') return;
  const groups = (value as { safeParallelizableGroups?: unknown }).safeParallelizableGroups;
  if (!Array.isArray(groups)) return;
  for (const group of groups) {
    if (!group || typeof group !== 'object') continue;
    const ref = typeof (group as { ref?: unknown }).ref === 'string' ? (group as { ref: string }).ref : '<unknown>';
    const itemIds = (group as { itemIds?: unknown }).itemIds;
    if (Array.isArray(itemIds) && itemIds.length === 0) throw new Error(`Recommendation group ${ref} must include at least one item id.`);
  }
}

export function summarizeRecommendations(model: BacklogRecommendationModel | null | undefined): RecommendationSummary | undefined {
  if (!model) return undefined;
  return {
    recommendedNextItemIds: model.recommendedNextSequence.map((entry) => entry.itemId),
    safeParallelizableGroups: model.safeParallelizableGroups.map((group) => ({
      ref: group.ref,
      ...(group.title !== undefined && { title: group.title }),
      itemIds: group.itemIds,
      ...(group.epicIds !== undefined && { epicIds: group.epicIds }),
      ...(group.safeToPlanTogether !== undefined && { safeToPlanTogether: group.safeToPlanTogether }),
      ...(group.rationale !== undefined && { rationale: group.rationale }),
      ...(group.recommendedProfile !== undefined && { recommendedProfile: group.recommendedProfile }),
    })),
    blockedChainCount: model.blockedChains.length,
    rationaleAndAssumptions: model.rationaleAndAssumptions,
  };
}
