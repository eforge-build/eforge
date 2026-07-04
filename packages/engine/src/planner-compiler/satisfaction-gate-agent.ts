import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import type { EforgeEvent } from '../events.js';
import type { AgentHarness, SdkPassthroughConfig } from '../harness.js';
import { pickSdkOptions, type CustomTool } from '../harness.js';
import { safeParseWithSchema } from '@eforge-build/client';
import { composeAbortSignal, isAbortError } from './abort-utils.js';
import type { PlannerCompilerEventSink } from './event-sink.js';
import {
  decidePlanningSatisfactionSkip,
  SatisfactionGateSubmissionSchema,
  type PlanningSatisfactionSkipDecision,
  type SatisfactionGateSubmission,
} from './satisfaction-gate-contracts.js';
import type { SourceInventory } from './source-inventory.js';

export const SATISFACTION_GATE_PLAN_ID = 'satisfaction-gate';
const SUBMIT_SATISFACTION_TOOL = 'submit_satisfaction_assessment';
const MAX_PROMPT_CRITERION_TEXT = 300;
const DEFAULT_SATISFACTION_GATE_MAX_TURNS = 12;

export interface RunPlanningSatisfactionGateInput {
  cwd: string;
  harness: AgentHarness;
  agentOptions?: SdkPassthroughConfig & { maxTurns?: number };
  inventory: SourceInventory;
  maxToolUses: number;
  abortSignal?: AbortSignal;
  onEvent?: PlannerCompilerEventSink;
}

export interface PlanningSatisfactionGateResult {
  decision: PlanningSatisfactionSkipDecision;
  toolUses: number;
  events: EforgeEvent[];
}

/**
 * Bounded read-only PRD-satisfaction gate: decides whether every acceptance
 * criterion is already implemented in the repository so the compile can skip
 * instead of planning no-op work. Fail-open by construction - any error,
 * abort-by-budget, or missing/ungrounded submission resolves to a
 * skip=false decision and the compile proceeds normally.
 */
export async function runPlanningSatisfactionGate(input: RunPlanningSatisfactionGateInput): Promise<PlanningSatisfactionGateResult> {
  const submitToolName = input.harness.effectiveCustomToolName(SUBMIT_SATISFACTION_TOOL);
  const prompt = formatSatisfactionGatePrompt(input.inventory, input.maxToolUses, submitToolName);
  const events: EforgeEvent[] = [];
  const budgetController = new AbortController();
  const maxTurns = input.agentOptions?.maxTurns ?? DEFAULT_SATISFACTION_GATE_MAX_TURNS;
  let submission: SatisfactionGateSubmission | undefined;
  let toolUses = 0;
  let failureReason: string | undefined;
  const onSubmit = (value: SatisfactionGateSubmission): boolean => {
    if (submission) return false;
    submission = value;
    return true;
  };

  try {
    for await (const event of input.harness.run({
      ...pickSdkOptions(input.agentOptions ?? {}),
      prompt,
      cwd: input.cwd,
      maxTurns,
      tools: 'read-only',
      customTools: [createSatisfactionSubmissionTool(submitToolName, onSubmit)],
      abortSignal: composeAbortSignal(input.abortSignal, budgetController.signal),
      phase: 'compile',
      stage: 'planner',
    }, 'planner', SATISFACTION_GATE_PLAN_ID)) {
      input.onEvent?.(event);
      events.push(event);
      if (event.type === 'agent:tool_use' && event.tool !== submitToolName && event.tool !== SUBMIT_SATISFACTION_TOOL) {
        toolUses += 1;
        if (toolUses >= input.maxToolUses && !budgetController.signal.aborted && !submission) budgetController.abort();
      }
    }
  } catch (err) {
    if (isAbortError(err) && input.abortSignal?.aborted) throw err;
    if (!budgetController.signal.aborted || !isAbortError(err)) failureReason = err instanceof Error ? err.message : String(err);
  }

  if (!submission && budgetController.signal.aborted && !failureReason) {
    const graceFailure = await runSatisfactionSubmitGrace(input, submitToolName, onSubmit, events, toolUses, maxTurns);
    if (!submission) failureReason = `budget exhausted after ${toolUses} read-only tool uses${graceFailure ? `; submit-only grace failed: ${graceFailure}` : ''}`;
  }
  if (!submission && !failureReason) {
    failureReason = `satisfaction gate agent did not call ${submitToolName}`;
  }
  if (!submission) return { decision: { skip: false, reason: `gate unavailable: ${failureReason}` }, toolUses, events };
  const decision = decidePlanningSatisfactionSkip(input.inventory, submission, (path) => existsSync(resolve(input.cwd, path)));
  return { decision, toolUses, events };
}

async function runSatisfactionSubmitGrace(input: RunPlanningSatisfactionGateInput, submitToolName: string, onSubmit: (submission: SatisfactionGateSubmission) => boolean, events: EforgeEvent[], toolUses: number, maxTurns: number): Promise<string | undefined> {
  try {
    for await (const event of input.harness.run({
      ...pickSdkOptions(input.agentOptions ?? {}),
      prompt: `${formatSatisfactionGatePrompt(input.inventory, input.maxToolUses, submitToolName)}\n\nTool budget is exhausted after ${toolUses} read-only tool uses. Do not call repository tools. You are now in submit-only grace mode: call ${submitToolName} with alreadySatisfied false unless every criterion has already been fully verified.`,
      cwd: input.cwd,
      maxTurns: Math.max(1, Math.min(2, maxTurns)),
      tools: 'none',
      customTools: [createSatisfactionSubmissionTool(submitToolName, onSubmit)],
      abortSignal: input.abortSignal,
      phase: 'compile',
      stage: 'planner',
    }, 'planner', SATISFACTION_GATE_PLAN_ID)) {
      input.onEvent?.(event);
      events.push(event);
    }
  } catch (err) {
    if (isAbortError(err) && input.abortSignal?.aborted) throw err;
    return err instanceof Error ? err.message : String(err);
  }
  return undefined;
}

function createSatisfactionSubmissionTool(submitToolName: string, onSubmit: (submission: SatisfactionGateSubmission) => boolean): CustomTool {
  return {
    name: SUBMIT_SATISFACTION_TOOL,
    description: 'Submit the structured PRD-satisfaction assessment. This is the only way to complete a satisfaction-gate turn.',
    inputSchema: SatisfactionGateSubmissionSchema,
    handler: async (value: unknown) => {
      const parsed = safeParseWithSchema(SatisfactionGateSubmissionSchema, value);
      if (!parsed.success) return `Submission rejected: ${parsed.error.message}\nCall ${submitToolName} again with a schema-valid payload.`;
      if (!onSubmit(parsed.data as SatisfactionGateSubmission)) return `Error: ${submitToolName} was already called. Only one assessment is allowed.`;
      return 'Satisfaction assessment submitted successfully.';
    },
  };
}

export function formatSatisfactionGatePrompt(inventory: SourceInventory, maxToolUses: number, submitToolName = SUBMIT_SATISFACTION_TOOL): string {
  return `You are a bounded PRD-satisfaction gate for eforge's planner compiler.

Determine whether EVERY acceptance criterion below is already fully implemented in this repository in its current state. Inspect the repository read-only, then complete this turn by calling ${submitToolName} exactly once. Do not return JSON in text and do not plan any work.

You may use the available repository inspection tools at most ${maxToolUses} times.

Decision rules:
- The moment you confirm one criterion is not fully satisfied, stop investigating and submit immediately with "alreadySatisfied": false and a verdict for that criterion; verdicts for the remaining criteria may be omitted.
- Submit "alreadySatisfied": true ONLY when you verified each criterion against the actual current code, and every verdict cites repository-relative file paths you confirmed exist.
- "Mostly satisfied", "trivially completable", or "satisfied except details" count as NOT satisfied. When in doubt, submit false: a wrong "true" silently drops requested work, a wrong "false" only costs one planning pass.

## Acceptance criteria

${JSON.stringify(inventory.criteria.map((criterion) => ({
    id: criterion.id,
    text: truncate(criterion.text, MAX_PROMPT_CRITERION_TEXT),
    evidencePaths: criterion.evidencePaths,
  })), null, 2)}

## Structured submission rules

Call ${submitToolName} with an object matching its schema: { "alreadySatisfied": boolean, "reason": "...", "verdicts": [...] }.

- Each verdict: { "criterionId", "satisfied", "evidencePaths", "explanation" }.
- When "alreadySatisfied" is true, include a verdict for every criterion id listed above, each with "satisfied": true and at least one existing evidence path.
- "reason" is shown to the user as the skip/build explanation - make it a concrete one-sentence summary.
`;
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 3)}...` : value;
}
