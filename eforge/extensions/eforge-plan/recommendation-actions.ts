import { defineExtensionAction } from '../../../packages/extension-sdk/src/index.js';
import { toJsonSafeObject } from './json-safe.js';
import {
  GetRecommendationsInputSchema,
  PutRecommendationsInputSchema,
  PutRecommendationsOutputSchema,
} from './schema.js';
import { GetRecommendationsWithStatusOutputSchema } from './recommendation-status-schemas.js';
import {
  computeRecommendationSourceFingerprint,
  readDerivedRecommendationStatus,
  recordRecommendationPutApplied,
} from './recommendation-status.js';
import { findActiveRecommendationRefreshTask, refreshRecommendationsAction } from './recommendation-refresh.js';
import {
  readRecommendationsFromPath,
  resolveRecommendationsPath,
  summarizeRecommendations,
  writeRecommendations,
} from './recommendations-store.js';

export const getRecommendations = defineExtensionAction({
  id: 'get-recommendations',
  title: 'Get eforge-plan recommendations',
  description: 'Read the project-local private recommendation model for eforge-plan.',
  inputSchema: GetRecommendationsInputSchema,
  outputSchema: GetRecommendationsWithStatusOutputSchema,
  sideEffects: ['local-read'],
  async handler(_input, ctx) {
    const path = resolveRecommendationsPath(ctx.paths);
    const recommendations = await readRecommendationsFromPath(path);
    const status = await readDerivedRecommendationStatus(ctx.cwd, path);
    // --- eforge:region plan-02-refresh-invalidation ---
    const activeRefresh = await readActiveRefreshTaskIfAvailable(ctx);
    // --- eforge:endregion plan-02-refresh-invalidation ---
    return toJsonSafeObject({
      recommendations,
      recommendationSummary: summarizeRecommendations(recommendations),
      path,
      status,
      // --- eforge:region plan-02-refresh-invalidation ---
      ...(activeRefresh !== undefined && { activeRefreshTask: activeRefresh.task }),
      // --- eforge:endregion plan-02-refresh-invalidation ---
    });
  },
});

export const putRecommendations = defineExtensionAction({
  id: 'put-recommendations',
  title: 'Put eforge-plan recommendations',
  description: 'Validate and write the project-local private recommendation model for eforge-plan.',
  inputSchema: PutRecommendationsInputSchema,
  outputSchema: PutRecommendationsOutputSchema,
  sideEffects: ['local-write'],
  async handler(input, ctx) {
    const path = resolveRecommendationsPath(ctx.paths);
    const recommendations = await writeRecommendations(ctx.cwd, input);
    const status = await recordRecommendationPutApplied(ctx.cwd);
    return toJsonSafeObject({
      recommendations,
      recommendationSummary: summarizeRecommendations(recommendations),
      path,
      status,
    });
  },
});

// --- eforge:region plan-02-refresh-invalidation ---
async function readActiveRefreshTaskIfAvailable(ctx: Parameters<typeof getRecommendations.handler>[1]) {
  try {
    const sourceFingerprint = await computeRecommendationSourceFingerprint(ctx.cwd);
    return await findActiveRecommendationRefreshTask(ctx, sourceFingerprint);
  } catch {
    return undefined;
  }
}
// --- eforge:endregion plan-02-refresh-invalidation ---

export const recommendationActions = [getRecommendations, putRecommendations, refreshRecommendationsAction] as const;
