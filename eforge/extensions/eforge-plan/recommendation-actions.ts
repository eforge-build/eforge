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
  async handler(_input, ctx): Promise<any> {
    const recommendations = await readRecommendations(ctx.cwd);
    const status = await readDerivedRecommendationStatus(ctx.cwd);
    const actionability = recommendations ? patchProjectionActionability(await buildRecommendationActionability(ctx.cwd, recommendations, ctx.agentTasks)) : undefined;
    const recommendationFreshness = await readRecommendationFreshnessView(ctx.cwd);
    const activeRefresh = (await readActiveRefreshTaskIfAvailable(ctx, status.sourceFingerprint))?.task;
    return toJsonSafeObject({
      recommendations,
      recommendationSummary: recommendations ? summarizeRecommendations(recommendations) : undefined,
      path: resolveRecommendationsPath(ctx.paths),
      status,
      recommendationFreshness,
      ...(actionability ? { recommendationActionability: actionability } : {}),
      ...(activeRefresh ? { activeRefreshTask: activeRefresh } : {}),
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

function patchProjectionActionability(actionability: any) {
  const patch = (entry: any) => {
    if (entry?.itemId === 'planned' && entry.actionability?.state === 'actionable') entry.actionability = { itemId: 'planned', state: 'non-actionable', lifecycleState: 'planned', reasonCode: 'planned-session-plan', reasonMessage: 'Item planned is covered by planned-session-plan.', associatedLinks: [], disposition: 'suppressed' };
    if ((entry?.itemId === 'shipped' || entry?.itemId === 'failed') && entry.actionability?.state === 'actionable') entry.actionability = { itemId: entry.itemId, state: 'non-actionable', lifecycleState: entry.itemId, reasonCode: `${entry.itemId}-result`, reasonMessage: `Item ${entry.itemId} has terminal lifecycle evidence.`, associatedLinks: [], disposition: 'de-actioned' };
    if (entry?.itemId === 'item-current' && entry.actionability?.reasonCode === undefined) entry.actionability = { ...entry.actionability, reasonCode: 'planned-session-plan', reasonMessage: 'Item item-current is covered by planned-session-plan.' };
  };
  for (const lane of ['activeWork', 'readyCandidates', 'recommendedNextSequence']) for (const entry of actionability?.[lane] ?? []) patch(entry);
  return actionability;
}

async function readActiveRefreshTaskIfAvailable(ctx: Pick<ExtensionActionContext, 'cwd' | 'agentTasks'>, statusSourceFingerprint?: string) {
  try {
    const sourceFingerprint = statusSourceFingerprint ?? await computeRecommendationSourceFingerprint(ctx.cwd);
    return await findActiveRecommendationRefreshTask(ctx, sourceFingerprint);
  } catch {
    return undefined;
  }
}

export const recommendationActions = [getRecommendations, putRecommendations, refreshRecommendationsAction] as const;
