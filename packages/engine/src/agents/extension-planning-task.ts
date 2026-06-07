import { Type } from '@sinclair/typebox';
import {
  EforgePlanPlanningDraftResultSchema,
  getSchemaYaml,
  parseEforgePlanPlanningDraftResult,
  type EforgePlanPlanningDraftInput,
  type EforgePlanPlanningDraftResult,
} from '@eforge-build/client';
import type { AgentHarness, CustomTool, SdkPassthroughConfig } from '../harness.js';
import { pickSdkOptions } from '../harness.js';
import { isAlwaysYieldedAgentEvent, type EforgeEvent } from '../events.js';
import { DEFAULT_TIER_MAX_TURNS } from '../config.js';
import { loadPrompt } from '../prompts.js';

export interface ExtensionPlanningTaskOptions extends SdkPassthroughConfig {
  harness: AgentHarness;
  cwd: string;
  input: EforgePlanPlanningDraftInput;
  verbose?: boolean;
  abortController?: AbortController;
  maxTurns?: number;
  taskId?: string;
}

const planningDraftSubmissionToolSchema = Type.Object({
  summary: Type.String(),
  assumptionsOpenQuestions: Type.Array(Type.String()),
  nextSteps: Type.Optional(Type.Array(Type.String())),
  planDrafts: Type.Optional(Type.Array(Type.Object({
    title: Type.String(),
    body: Type.String(),
  }, { additionalProperties: false }), { minItems: 1 })),
  playbookDraft: Type.Optional(Type.Object({
    name: Type.String(),
    body: Type.String(),
  }, { additionalProperties: false })),
  sessionPlanPatch: Type.Optional(Type.Object({
    sections: Type.Array(Type.Object({
      dimension: Type.String(),
      content: Type.String(),
    }, { additionalProperties: false }), { minItems: 1 }),
    skippedDimensions: Type.Optional(Type.Array(Type.Object({
      dimension: Type.String(),
      reason: Type.String(),
    }, { additionalProperties: false }))),
  }, { additionalProperties: false })),
}, { additionalProperties: false });

export async function* runEforgePlanPlanningDraftTask(
  options: ExtensionPlanningTaskOptions,
): AsyncGenerator<EforgeEvent, EforgePlanPlanningDraftResult> {
  let submitted: EforgePlanPlanningDraftResult | undefined;
  const submitToolName = 'submit_eforge_plan_planning_result';
  const submitTool: CustomTool = {
    name: submitToolName,
    description: 'Submit the final eforge-plan planning draft result. This is the only accepted output channel for this task.',
    inputSchema: planningDraftSubmissionToolSchema,
    handler: async (input: unknown) => {
      try {
        const parsed = parseEforgePlanPlanningDraftResult(input);
        if (submitted !== undefined) {
          return 'Error: a planning result was already submitted. Submit exactly one final result.';
        }
        submitted = parsed;
        return 'Planning draft result submitted successfully.';
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return `Submission rejected: ${message}\nFix the payload and call ${submitToolName} again.`;
      }
    },
  };

  const prompt = await loadPrompt('eforge-plan-planning-draft', {
    topic: options.input.topic,
    session: options.input.session ?? '(none)',
    planningType: options.input.planningType ?? '(unspecified)',
    planningDepth: options.input.planningDepth ?? '(unspecified)',
    sourceText: options.input.sourceText ?? '(none)',
    existingSessionPlan: options.input.existingSessionPlan ?? '(none)',
    requestedOutputSections: options.input.requestedOutputSections?.join(', ') ?? '(agent should choose applicable sections)',
    submitTool: options.harness.effectiveCustomToolName(submitToolName),
    resultSchema: getSchemaYaml('eforge-plan-planning-draft-result', EforgePlanPlanningDraftResultSchema),
  }, options.promptAppend);

  const effectiveSubmitToolName = options.harness.effectiveCustomToolName(submitToolName);
  const allowedTools = options.allowedTools === undefined
    ? undefined
    : [...new Set([...options.allowedTools, effectiveSubmitToolName])];
  const sdkOptions = pickSdkOptions({
    model: options.model,
    thinking: options.thinking,
    effort: options.effort,
    maxBudgetUsd: options.maxBudgetUsd,
    fallbackModel: options.fallbackModel,
    allowedTools,
    disallowedTools: options.disallowedTools,
    phase: options.phase,
    stage: options.stage,
  });

  for await (const event of options.harness.run(
    {
      prompt,
      cwd: options.cwd,
      maxTurns: options.maxTurns ?? DEFAULT_TIER_MAX_TURNS.planning,
      tools: 'read-only',
      customTools: [submitTool],
      abortSignal: options.abortController?.signal,
      ...sdkOptions,
    },
    'planner',
    options.taskId,
  )) {
    if (isAlwaysYieldedAgentEvent(event) || options.verbose) {
      yield event;
    }
  }

  if (submitted === undefined) {
    throw new Error(`eforge-plan planning draft task did not call ${options.harness.effectiveCustomToolName(submitToolName)}.`);
  }

  return submitted;
}

export const runExtensionPlanningTask = runEforgePlanPlanningDraftTask;
