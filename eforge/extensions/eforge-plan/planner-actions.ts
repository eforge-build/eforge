import { defineExtensionAction, type ExtensionAction } from '@eforge-build/extension-sdk';
import { toJsonSafeObject } from './json-safe.js';
import { planningAgentTaskActions } from './agent-task-actions.js';
import { applyPlannerResult, preparePlannerContext } from './planner-orchestration.js';
import {
  ApplyPlannerResultInputSchema,
  ApplyPlannerResultOutputSchema,
  PreparePlannerContextInputSchema,
  PreparePlannerContextOutputSchema,
} from './schema.js';

export const preparePlannerContextAction = defineExtensionAction({
  id: 'prepare-planner-context',
  title: 'Prepare eforge-plan planner context',
  description: 'Return JSON-safe backlog, recommendation, dependency, blocker, epic, and roadmap evidence for AI planning.',
  inputSchema: PreparePlannerContextInputSchema,
  outputSchema: PreparePlannerContextOutputSchema,
  sideEffects: ['local-read'],
  async handler(input, ctx) {
    return toJsonSafeObject(await preparePlannerContext(ctx.cwd, input));
  },
});

export const applyPlannerResultAction = defineExtensionAction({
  id: 'apply-planner-result',
  title: 'Apply eforge-plan planner result',
  description: 'Apply structured planner recommendations and/or handoff drafts through extension-owned storage and promotion helpers.',
  inputSchema: ApplyPlannerResultInputSchema,
  outputSchema: ApplyPlannerResultOutputSchema,
  sideEffects: ['local-write'],
  async handler(input, ctx) {
    return toJsonSafeObject(await applyPlannerResult(ctx.cwd, input));
  },
});

export const plannerActions: readonly ExtensionAction<any, any>[] = [preparePlannerContextAction, applyPlannerResultAction, ...planningAgentTaskActions];
