import type {
  EforgePlanPlanningDraftInput,
  EforgePlanPlanningDraftResult,
} from '@eforge-build/client';
import type { AgentHarness, SdkPassthroughConfig } from '../harness.js';
import { classifyAgentTerminalSubtype, pickSdkOptions } from '../harness.js';
import { isRetryableInfrastructureSubtype } from '../retry.js';
import { isAlwaysYieldedAgentEvent, type EforgeEvent } from '../events.js';
import { DEFAULT_TIER_MAX_TURNS } from '../config.js';
import { loadPrompt } from '../prompts.js';
import {
  createPlanningDraftSubmitTool,
  createPlanningProgressTool,
  planningDraftResultSchemaYaml,
  PLANNING_DRAFT_SUBMIT_TOOL_NAME,
  PLANNING_PROGRESS_TOOL_NAME,
  type EforgePlanPlanningProgressCallback,
  type EforgePlanPlanningProgressUpdate,
} from './extension-planning-submit-tools.js';

export type { EforgePlanPlanningProgressCallback, EforgePlanPlanningProgressUpdate };

export interface ExtensionPlanningTaskOptions extends SdkPassthroughConfig {
  harness: AgentHarness;
  cwd: string;
  input: EforgePlanPlanningDraftInput;
  verbose?: boolean;
  abortController?: AbortController;
  maxTurns?: number;
  taskId?: string;
  /** Optional telemetry-only callback invoked with sanitized section progress reported by the agent. */
  onProgress?: EforgePlanPlanningProgressCallback;
}

export async function* runEforgePlanPlanningDraftTask(
  options: ExtensionPlanningTaskOptions,
): AsyncGenerator<EforgeEvent, EforgePlanPlanningDraftResult> {
  const submitState = createPlanningDraftSubmitTool({ input: options.input });
  const progressTool = createPlanningProgressTool(options.onProgress);

  const prompt = await loadPrompt('eforge-plan-planning-draft', {
    topic: options.input.topic,
    session: options.input.session ?? '(none)',
    planningType: options.input.planningType ?? '(unspecified)',
    planningDepth: options.input.planningDepth ?? '(unspecified)',
    sourceText: options.input.sourceText ?? '(none)',
    existingSessionPlan: options.input.existingSessionPlan ?? '(none)',
    requestedOutputSections: options.input.requestedOutputSections?.join(', ') ?? '(agent should choose applicable sections)',
    submitTool: options.harness.effectiveCustomToolName(PLANNING_DRAFT_SUBMIT_TOOL_NAME),
    progressTool: options.harness.effectiveCustomToolName(PLANNING_PROGRESS_TOOL_NAME),
    resultSchema: planningDraftResultSchemaYaml(),
    sessionPlanCreationReadiness: JSON.stringify(options.input.sessionPlanCreationReadiness ?? {}, null, 2),
  }, options.promptAppend);

  const effectiveSubmitToolName = options.harness.effectiveCustomToolName(PLANNING_DRAFT_SUBMIT_TOOL_NAME);
  const effectiveProgressToolName = options.harness.effectiveCustomToolName(PLANNING_PROGRESS_TOOL_NAME);
  const allowedTools = options.allowedTools === undefined
    ? undefined
    : [...new Set([...options.allowedTools, effectiveSubmitToolName, effectiveProgressToolName])];
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

  try {
    for await (const event of options.harness.run(
      {
        prompt,
        cwd: options.cwd,
        maxTurns: options.maxTurns ?? DEFAULT_TIER_MAX_TURNS.planning,
        tools: 'read-only',
        customTools: [submitState.tool, progressTool],
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
  } catch (err) {
    const submitted = submitState.getSubmitted();
    const terminalSubtype = classifyAgentTerminalSubtype(err);
    const message = err instanceof Error ? err.message : String(err);
    if (submitted !== undefined && terminalSubtype !== undefined && isRetryableInfrastructureSubtype(terminalSubtype)) {
      yield {
        timestamp: new Date().toISOString(),
        type: 'agent:warning',
        agentId: options.taskId ?? 'extension-planning-task',
        agent: 'planner',
        code: 'late-infrastructure-error-after-planning-submit',
        message: `Retryable infrastructure error after planning result submission was downgraded: ${message}`,
        ...(options.taskId !== undefined && { planId: options.taskId }),
      } as EforgeEvent;
      return submitted;
    }
    throw err;
  }

  const submitted = submitState.getSubmitted();
  if (submitted === undefined) {
    throw new Error(`eforge-plan planning draft task did not call ${options.harness.effectiveCustomToolName(PLANNING_DRAFT_SUBMIT_TOOL_NAME)}.`);
  }

  return submitted;
}

export const runExtensionPlanningTask = runEforgePlanPlanningDraftTask;
