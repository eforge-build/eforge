import { CONTRIBUTION_OUTPUT_PROFILES, defineExtensionAction } from '@eforge-build/extension-sdk';
import { toJsonSafeObject } from './json-safe.js';
import { readRoadmapState, updateRoadmapState } from './roadmap-context.js';
import {
  GetRoadmapStateInputSchema,
  RoadmapStateResponseSchema,
  UpdateRoadmapStateInputSchema,
} from './roadmap-schemas.js';

export const getRoadmapStateAction = defineExtensionAction({
  id: 'get-roadmap-state',
  title: 'Get roadmap state',
  description: 'Read private local-focus roadmap state plus shared/discovered roadmap context metadata.',
  inputSchema: GetRoadmapStateInputSchema,
  outputSchema: RoadmapStateResponseSchema,
  outputProfile: CONTRIBUTION_OUTPUT_PROFILES.uiRich,
  sideEffects: ['local-read'],
  async handler(input, ctx) {
    return toJsonSafeObject(await readRoadmapState(ctx.cwd, input));
  },
});

export const updateRoadmapStateAction = defineExtensionAction({
  id: 'update-roadmap-state',
  title: 'Update roadmap state',
  description: 'Update private local-focus roadmap content and configured read-only shared roadmap sources.',
  inputSchema: UpdateRoadmapStateInputSchema,
  outputSchema: RoadmapStateResponseSchema,
  outputProfile: CONTRIBUTION_OUTPUT_PROFILES.uiRich,
  sideEffects: ['local-read', 'local-write'],
  async handler(input, ctx) {
    return toJsonSafeObject(await updateRoadmapState(ctx.cwd, input));
  },
});

export const roadmapActions = [getRoadmapStateAction, updateRoadmapStateAction] as const;
