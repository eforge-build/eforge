import {
  EforgePlanPlanningDraftInputSchema,
  EforgePlanPlanningDraftResultSchema,
  type EforgePlanPlanningDraftInput,
  type EforgePlanPlanningDraftResult,
} from '@eforge-build/client';
import { defineExtensionAgentTaskContribution, type ExtensionAgentTaskContribution, type ExtensionAgentTaskResolverContext } from '@eforge-build/extension-sdk';
import {
  createPlanningDraftSubmitTool,
  createPlanningProgressTool,
  planningDraftResultSchemaYaml,
  PLANNING_DRAFT_SUBMIT_TOOL_NAME,
  PLANNING_PROGRESS_TOOL_NAME,
} from './planning-agent-tools.js';
import { backlogCurationAgentTasks } from './backlog-curation-agent-tasks.js';

export const PLANNING_DRAFT_TASK_ID = 'planning-draft' as const;
export const SESSION_PLAN_CREATION_TASK_ID = 'session-plan-creation' as const;
export const PLAN_REVISION_TASK_ID = 'plan-revision' as const;
export const RECOMMENDATION_REFRESH_TASK_ID = 'recommendation-refresh' as const;

const PLANNING_PROMPT_ASSET = 'prompts/eforge-plan-planning-draft.md' as const;

type PlanningTaskContribution = ExtensionAgentTaskContribution<typeof EforgePlanPlanningDraftInputSchema, typeof EforgePlanPlanningDraftResultSchema>;

interface PlanningResolverContext extends ExtensionAgentTaskResolverContext<EforgePlanPlanningDraftInput> {}

export interface ResolvedPlanningAgentTask {
  prompt: string;
  variables: Record<string, string>;
  run: {
    role: 'planner';
    tools: ReturnType<typeof createPlanningProgressTool>[];
  };
  getResult: () => EforgePlanPlanningDraftResult | undefined;
  missingResultMessage: string;
}

export function resolvePlanningAgentTask(ctx: PlanningResolverContext): ResolvedPlanningAgentTask {
  const submitState = createPlanningDraftSubmitTool({ input: ctx.input });
  const progressTool = createPlanningProgressTool(ctx.onProgress);
  const effectiveToolName = ctx.effectiveCustomToolName ?? ((name: string) => name);
  return {
    prompt: '',
    variables: buildPlanningPromptVariables(ctx.input, effectiveToolName),
    run: { role: 'planner', tools: [submitState.tool, progressTool] },
    getResult: submitState.getSubmitted,
    missingResultMessage: `eforge-plan planning draft task did not call ${effectiveToolName(PLANNING_DRAFT_SUBMIT_TOOL_NAME)}.`,
  };
}

export function buildPlanningPromptVariables(input: EforgePlanPlanningDraftInput, effectiveToolName: (name: string) => string): Record<string, string> {
  return {
    topic: input.topic,
    session: input.session ?? '(none)',
    planningType: input.planningType ?? '(unspecified)',
    planningDepth: input.planningDepth ?? '(unspecified)',
    sourceText: input.sourceText ?? '(none)',
    existingSessionPlan: input.existingSessionPlan ?? '(none)',
    requestedOutputSections: input.requestedOutputSections?.join(', ') ?? '(agent should choose applicable sections)',
    submitTool: effectiveToolName(PLANNING_DRAFT_SUBMIT_TOOL_NAME),
    progressTool: effectiveToolName(PLANNING_PROGRESS_TOOL_NAME),
    resultSchema: planningDraftResultSchemaYaml(),
    sessionPlanCreationReadiness: JSON.stringify(input.sessionPlanCreationReadiness ?? {}, null, 2),
  };
}

function planningContribution(id: string, title: string, description: string): PlanningTaskContribution {
  return defineExtensionAgentTaskContribution({
    id,
    title,
    description,
    inputSchema: EforgePlanPlanningDraftInputSchema,
    outputSchema: EforgePlanPlanningDraftResultSchema,
    prompt: { kind: 'asset', asset: PLANNING_PROMPT_ASSET },
    resolvePrompt: resolvePlanningAgentTask,
  }) as PlanningTaskContribution;
}

export const eforgePlanPlanningAgentTasks = [
  planningContribution(PLANNING_DRAFT_TASK_ID, 'Draft eforge-plan planning content', 'Draft recommendation, handoff, plan, patch, or creation content for eforge-plan.'),
  planningContribution(SESSION_PLAN_CREATION_TASK_ID, 'Create an eforge-plan session-plan draft', 'Draft a ready session-plan creation payload using eforge-plan readiness contracts.'),
  planningContribution(PLAN_REVISION_TASK_ID, 'Draft an eforge-plan plan revision turn', 'Draft a bounded revision turn for an existing flat session plan.'),
  planningContribution(RECOMMENDATION_REFRESH_TASK_ID, 'Refresh eforge-plan recommendations', 'Refresh recommendation-only planning output for the current eforge-plan recommendation source.'),
] as const;

export const eforgePlanAgentTasks = [
  ...eforgePlanPlanningAgentTasks,
  ...backlogCurationAgentTasks,
] as const;
