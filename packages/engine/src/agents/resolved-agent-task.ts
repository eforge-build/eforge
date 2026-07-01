import type { AgentRole, EforgeEvent } from '../events.js';
import { isAlwaysYieldedAgentEvent } from '../events.js';
import type { AgentHarness, CustomTool, SdkPassthroughConfig, ToolPreset } from '../harness.js';
import { classifyAgentTerminalSubtype, pickSdkOptions } from '../harness.js';
import { DEFAULT_TIER_MAX_TURNS } from '../config.js';
import { renderPromptTemplate } from '../prompts.js';
import { isRetryableInfrastructureSubtype } from '../retry.js';

export interface ResolvedAgentTaskOptions<TResult> extends SdkPassthroughConfig {
  harness: AgentHarness;
  cwd: string;
  promptTemplate: string;
  variables?: Record<string, string>;
  promptLabel: string;
  role?: AgentRole;
  tools?: ToolPreset;
  customTools?: CustomTool[];
  verbose?: boolean;
  abortController?: AbortController;
  maxTurns?: number;
  taskId?: string;
  getResult: () => TResult | undefined;
  missingResultMessage: string;
}

export async function* runResolvedAgentTask<TResult>(
  options: ResolvedAgentTaskOptions<TResult>,
): AsyncGenerator<EforgeEvent, TResult> {
  const role = options.role ?? 'planner';
  const prompt = renderPromptTemplate(options.promptTemplate, options.variables, options.promptAppend, options.promptLabel);
  const effectiveCustomToolNames = (options.customTools ?? []).map((tool) => options.harness.effectiveCustomToolName(tool.name));
  const allowedTools = options.allowedTools === undefined
    ? undefined
    : [...new Set([...options.allowedTools, ...effectiveCustomToolNames])];
  const sdkOptions = pickSdkOptions({
    model: options.model,
    thinking: options.thinking,
    effort: options.effort,
    maxBudgetUsd: options.maxBudgetUsd,
    fallbackModel: options.fallbackModel,
    allowedTools,
    disallowedTools: options.disallowedTools,
    runtimeChoice: options.runtimeChoice,
    runtimeChoiceQualified: options.runtimeChoiceQualified,
    runtimeChoiceSource: options.runtimeChoiceSource,
    runtimeChoiceRule: options.runtimeChoiceRule,
    runtimeChoiceRouter: options.runtimeChoiceRouter,
    runtimeChoiceFallbackReason: options.runtimeChoiceFallbackReason,
    phase: options.phase,
    stage: options.stage,
  });

  try {
    for await (const event of options.harness.run(
      {
        prompt,
        cwd: options.cwd,
        maxTurns: options.maxTurns ?? DEFAULT_TIER_MAX_TURNS.planning,
        tools: options.tools ?? 'read-only',
        customTools: options.customTools,
        abortSignal: options.abortController?.signal,
        ...sdkOptions,
      },
      role,
      options.taskId,
    )) {
      if (isAlwaysYieldedAgentEvent(event) || options.verbose) yield event;
    }
  } catch (err) {
    const submitted = options.getResult();
    const terminalSubtype = classifyAgentTerminalSubtype(err);
    const message = err instanceof Error ? err.message : String(err);
    if (submitted !== undefined && terminalSubtype !== undefined && isRetryableInfrastructureSubtype(terminalSubtype)) {
      yield {
        timestamp: new Date().toISOString(),
        type: 'agent:warning',
        agentId: options.taskId ?? 'resolved-agent-task',
        agent: role,
        code: 'late-infrastructure-error-after-resolved-task-submit',
        message: `Retryable infrastructure error after resolved task submission was downgraded: ${message}`,
        ...(options.taskId !== undefined && { planId: options.taskId }),
      } as EforgeEvent;
      return submitted;
    }
    throw err;
  }

  const submitted = options.getResult();
  if (submitted === undefined) throw new Error(options.missingResultMessage);
  return submitted;
}
