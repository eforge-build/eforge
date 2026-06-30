import type { EforgeEvent } from '../events.js';
import { classifyAgentTerminalSubtype, type AgentTerminalSubtype } from '../harness.js';

export const PLANNER_COMPILER_AGENT_MAX_ATTEMPTS = 2;

export function retryablePlannerCompilerSubtype(err: unknown): AgentTerminalSubtype | undefined {
  const subtype = classifyAgentTerminalSubtype(err);
  return subtype === 'error_transient_transport' || subtype === 'error_pi_tool_infrastructure' ? subtype : undefined;
}

export function emitPlannerCompilerRetry(options: { events: EforgeEvent[]; onEvent?: (event: EforgeEvent) => void; attempt: number; subtype: AgentTerminalSubtype; label: string; planId: string }): void {
  const event: EforgeEvent = {
    timestamp: new Date().toISOString(),
    type: 'agent:retry',
    agent: 'planner',
    attempt: options.attempt,
    maxAttempts: PLANNER_COMPILER_AGENT_MAX_ATTEMPTS,
    subtype: options.subtype,
    label: options.label,
    planId: options.planId,
  };
  options.events.push(event);
  options.onEvent?.(event);
}

export function emitPlannerCompilerCheckpointWarning(options: { events: EforgeEvent[]; onEvent?: (event: EforgeEvent) => void; attemptEvents: EforgeEvent[]; subtype: AgentTerminalSubtype; label: string; planId: string; err: unknown }): void {
  const message = options.err instanceof Error ? options.err.message : String(options.err);
  const event: EforgeEvent = {
    timestamp: new Date().toISOString(),
    type: 'agent:warning',
    agent: 'planner',
    agentId: agentIdFromEvents(options.attemptEvents, `planner-${options.planId}`),
    planId: options.planId,
    code: `${options.label}-post-submission-downgraded`,
    message: `Retryable ${options.subtype} after planner-compiler submission was downgraded: ${message}`,
  };
  options.events.push(event);
  options.onEvent?.(event);
}

function agentIdFromEvents(events: readonly EforgeEvent[], fallback: string): string {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index] as EforgeEvent & { agentId?: unknown };
    if (typeof event.agentId === 'string' && event.agentId.length > 0) return event.agentId;
  }
  return fallback;
}
