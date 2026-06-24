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
import { buildRecommendationActionability } from './recommendation-actionability.js';
import {
  readRecommendations,
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
    const recommendations = await readRecommendations(ctx.cwd);
    const status = await readDerivedRecommendationStatus(ctx.cwd, path);
    const activeRefresh = await readActiveRefreshTaskIfAvailable(ctx, status.sourceFingerprint);
    const recommendationFreshness = await readRecommendationFreshnessView(ctx.cwd, status.sourceFingerprint);
    const recommendationActionability = recommendations === null ? undefined : await buildRecommendationActionability(ctx.cwd, recommendations, ctx.agentTasks);
    return toJsonSafeObject({
      recommendations,
      recommendationSummary: summarizeRecommendations(recommendations),
      ...(recommendationActionability !== undefined && { recommendationActionability }),
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
  description: 'Validate and write the project-local private recommendation model for eforge-plan, then mark freshness metadata fresh for put-recommendations.',
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
