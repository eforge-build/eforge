import type { AgentHarness, SdkPassthroughConfig } from '../harness.js';
import { pickSdkOptions } from '../harness.js';
import { isAlwaysYieldedAgentEvent, type EforgeEvent } from '../events.js';
import { loadPrompt } from '../prompts.js';
import { DEFAULT_TIER_MAX_TURNS } from '../config.js';

export interface ValidationFixerOptions extends SdkPassthroughConfig {
  harness: AgentHarness;
  cwd: string;
  failures: Array<{ command: string; exitCode: number; output: string }>;
  attempt: number;
  maxAttempts: number;
  verbose?: boolean;
  abortController?: AbortController;
  /** Override max conversation turns (default: implementation tier default) */
  maxTurns?: number;
  /** Orchestrator-assigned lane id forwarded as the harness.run planId arg. */
  lane?: string;
}

export interface ValidationRepairFixerOptions extends SdkPassthroughConfig {
  harness: AgentHarness;
  cwd: string;
  planId: string;
  validationRepairContext: string;
  attempt: number;
  maxAttempts: number;
  verbose?: boolean;
  abortController?: AbortController;
  /** Override max conversation turns (default: implementation tier default) */
  maxTurns?: number;
}

/**
 * Validation fixer agent — attempts to fix post-merge validation failures.
 * Receives failed command output, diagnoses the issue, and makes minimal fixes.
 */
export async function* runValidationFixer(
  options: ValidationFixerOptions,
): AsyncGenerator<EforgeEvent> {
  yield { timestamp: new Date().toISOString(), type: 'validation:fix:start', attempt: options.attempt, maxAttempts: options.maxAttempts };

  const failureContext = options.failures
    .map(
      (f) =>
        `Command: ${f.command}\nExit code: ${f.exitCode}\nOutput:\n${f.output}`,
    )
    .join('\n\n---\n\n');

  const prompt = await loadPrompt('validation-fixer', {
    failures: failureContext,
    attempt: String(options.attempt),
    max_attempts: String(options.maxAttempts),
  }, options.promptAppend);

  try {
    for await (const event of options.harness.run(
      {
        prompt,
        cwd: options.cwd,
        maxTurns: options.maxTurns ?? DEFAULT_TIER_MAX_TURNS.implementation,
        tools: 'coding',
        abortSignal: options.abortController?.signal,
        ...pickSdkOptions(options),
      },
      'validation-fixer',
      options.lane,
    )) {
      if (isAlwaysYieldedAgentEvent(event) || options.verbose) {
        yield event;
      }
    }
  } catch (err) {
    // Re-throw abort errors so the orchestrator can respect cancellation
    if (err instanceof Error && err.name === 'AbortError') throw err;
    // Other fixer failures are non-fatal — validation will just fail on re-run
  }

  yield { timestamp: new Date().toISOString(), type: 'validation:fix:complete', attempt: options.attempt };
}

/**
 * In-build validation repair fixer — leaves candidate edits unstaged and
 * uncommitted so the build evaluator can accept or reject the captured diff.
 */
export async function* runValidationRepairFixer(
  options: ValidationRepairFixerOptions,
): AsyncGenerator<EforgeEvent> {
  const prompt = await loadPrompt('validation-repair-fixer', {
    validation_repair_context: options.validationRepairContext,
    attempt: String(options.attempt),
    max_attempts: String(options.maxAttempts),
  }, options.promptAppend);

  try {
    for await (const event of options.harness.run(
      {
        prompt,
        cwd: options.cwd,
        maxTurns: options.maxTurns ?? DEFAULT_TIER_MAX_TURNS.implementation,
        tools: 'coding',
        abortSignal: options.abortController?.signal,
        ...pickSdkOptions(options),
      },
      'validation-fixer',
      options.planId,
    )) {
      if (isAlwaysYieldedAgentEvent(event) || options.verbose) {
        yield event;
      }
    }
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') throw err;
    // Other in-build fixer failures are non-fatal; validation will re-run and
    // the evaluator remains the only path that can land candidate edits.
  }
}
