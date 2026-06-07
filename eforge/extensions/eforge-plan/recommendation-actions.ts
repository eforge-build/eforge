import { defineExtensionAction } from '../../../packages/extension-sdk/src/index.js';
import { toJsonSafeObject } from './json-safe.js';
import {
  GetRecommendationsInputSchema,
  GetRecommendationsOutputSchema,
  PutRecommendationsInputSchema,
  PutRecommendationsOutputSchema,
} from './schema.js';
import {
  readRecommendationsFromPath,
  resolveRecommendationsPath,
  summarizeRecommendations,
  writeRecommendationsToPath,
} from './recommendations-store.js';

export const getRecommendations = defineExtensionAction({
  id: 'get-recommendations',
  title: 'Get eforge-plan recommendations',
  description: 'Read the project-local private recommendation model for eforge-plan.',
  inputSchema: GetRecommendationsInputSchema,
  outputSchema: GetRecommendationsOutputSchema,
  sideEffects: ['local-read'],
  async handler(_input, ctx) {
    const path = resolveRecommendationsPath(ctx.paths);
    const recommendations = await readRecommendationsFromPath(path);
    return toJsonSafeObject({
      recommendations,
      recommendationSummary: summarizeRecommendations(recommendations),
      path,
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
    const recommendations = await writeRecommendationsToPath(path, input);
    return toJsonSafeObject({
      recommendations,
      recommendationSummary: summarizeRecommendations(recommendations),
      path,
    });
  },
});

export const recommendationActions = [getRecommendations, putRecommendations] as const;
