import { defineExtensionAction, type ExtensionActionContext } from '@eforge-build/extension-sdk';
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
  readRecommendationFreshnessView,
  recordRecommendationPutApplied,
} from './recommendation-status.js';
import { findActiveRecommendationRefreshTask, refreshRecommendationsAction } from './recommendation-refresh.js';
// --- eforge:region plan-04-recommendation-actionability-server ---
import { buildRecommendationActionability } from './recommendation-actionability.js';
// --- eforge:endregion plan-04-recommendation-actionability-server ---
import {
  readRecommendationsFromPath,
  resolveRecommendationsPath,
  summarizeRecommendations,
  writeRecommendations,
} from './recommendations-store.js';

export const getRecommendations = defineExtensionAction({
  id: 'get-recommendations',
  title: 'Get eforge-plan recommendations',
  description: 'Read the project-local private recommendation model, derived freshness status, and any active refresh task for eforge-plan.',
  inputSchema: GetRecommendationsInputSchema,
  outputSchema: GetRecommendationsWithStatusOutputSchema,
  sideEffects: ['local-read'],
  async handler(_input, ctx) {
    const path = resolveRecommendationsPath(ctx.paths);
    const recommendations = await readRecommendationsFromPath(path);
    const status = await readDerivedRecommendationStatus(ctx.cwd, path);
    const activeRefresh = await readActiveRefreshTaskIfAvailable(ctx, status.sourceFingerprint);
    const recommendationFreshness = await readRecommendationFreshnessView(ctx.cwd, status.sourceFingerprint);
    // --- eforge:region plan-04-recommendation-actionability-server ---
    const recommendationActionability = recommendations === null ? undefined : await buildRecommendationActionability(ctx.cwd, recommendations, ctx.agentTasks);
    // --- eforge:endregion plan-04-recommendation-actionability-server ---
    return toJsonSafeObject({
      recommendations,
      recommendationSummary: summarizeRecommendations(recommendations),
      // --- eforge:region plan-04-recommendation-actionability-server ---
      ...(recommendationActionability !== undefined && { recommendationActionability }),
      // --- eforge:endregion plan-04-recommendation-actionability-server ---
      path,
      status,
      recommendationFreshness,
      ...(activeRefresh !== undefined && { activeRefreshTask: activeRefresh.task }),
    });
  },
});

export const putRecommendations = defineExtensionAction({
  id: 'put-recommendations',
  title: 'Put eforge-plan recommendations',
  description: 'Validate and write the project-local private recommendation model for eforge-plan, then mark the status sidecar fresh for put-recommendations.',
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

async function readActiveRefreshTaskIfAvailable(ctx: Pick<ExtensionActionContext, 'cwd' | 'agentTasks'>, statusSourceFingerprint?: string) {
  try {
    const sourceFingerprint = statusSourceFingerprint ?? await computeRecommendationSourceFingerprint(ctx.cwd);
    return await findActiveRecommendationRefreshTask(ctx, sourceFingerprint);
  } catch {
    return undefined;
  }
}

export const recommendationActions = [getRecommendations, putRecommendations, refreshRecommendationsAction] as const;
