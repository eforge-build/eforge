import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { EforgeEvent, AgentRole } from '@eforge-build/engine/events';
import { AgentTerminalError, PlannerSubmissionError } from '@eforge-build/engine/harness';
import {
  withRetry,
  DEFAULT_RETRY_POLICIES,
  getPolicy,
  isDroppedSubmission,
  hasAuthoritativePlannerCheckpoint,
  isBeforePlannerSubmissionBoundary,
  isRetryableInfrastructureSubtype,
  buildEvaluatorContinuationInput,
  buildBuilderContinuationInput,
  buildReviewFixerContinuationInput,
  extractBuilderDiscoveryContext,
  type RetryPolicy,
  type RetryAttemptInfo,
  type EvaluatorContinuationInput,
  type PlannerContinuationInput,
  type BuilderContinuationInput,
  type ReviewFixerContinuationInput,
} from '@eforge-build/engine/retry';

const execAsync = promisify(execFile);
import { builderEvaluate } from '@eforge-build/engine/agents/builder';
import { runPlanEvaluate } from '@eforge-build/engine/agents/plan-evaluator';
import type { EvaluationSnapshot } from '@eforge-build/engine/evaluation';
import { StubHarness } from './stub-harness.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export const ts = () => new Date().toISOString();

export function makeAttemptInfo<Input>(
  partial: Partial<RetryAttemptInfo<Input>> & { prevInput: Input },
): RetryAttemptInfo<Input> {
  return {
    attempt: 1,
    maxAttempts: 2,
    subtype: 'error_max_turns',
    events: [],
    ...partial,
  } as RetryAttemptInfo<Input>;
}

/** Script a single "attempt" that yields some events then throws a terminal error. */
export function makeThrowingAgent(
  events: EforgeEvent[],
  terminal: AgentTerminalError | Error,
): (input: unknown) => AsyncGenerator<EforgeEvent, undefined> {
  return async function* () {
    for (const ev of events) yield ev;
    throw terminal;
  };
}

/** Script a single "attempt" that yields events then returns normally. */
export function makeSuccessfulAgent(
  events: EforgeEvent[],
): (input: unknown) => AsyncGenerator<EforgeEvent, undefined> {
  return async function* () {
    for (const ev of events) yield ev;
    return;
  };
}

/** Glue together multiple per-attempt generators into a single `runAgent`. */
export function makeMultiAttemptAgent(
  perAttempt: Array<(input: unknown) => AsyncGenerator<EforgeEvent, undefined>>,
): (input: unknown) => AsyncGenerator<EforgeEvent, undefined> {
  let idx = 0;
  return async function* (input: unknown) {
    const fn = perAttempt[idx++];
    if (!fn) throw new Error(`makeMultiAttemptAgent: no scripted response at attempt index ${idx - 1}`);
    yield* fn(input);
  };
}

// ---------------------------------------------------------------------------
// Policy.shouldRetry / retryableSubtypes predicates
// ---------------------------------------------------------------------------

export function makeEvaluatorPolicy(override?: Partial<RetryPolicy<EvaluatorContinuationInput>>): RetryPolicy<EvaluatorContinuationInput> {
  const base = DEFAULT_RETRY_POLICIES.evaluator as RetryPolicy<EvaluatorContinuationInput>;
  return {
    ...base,
    maxAttempts: 2,
    ...override,
  };
}

export const makePlanFile = (id = 'plan-01') => ({
  id,
  name: 'Test Plan',
  dependsOn: [],
  branch: 'test/main',
  body: '# Test\n\nImplement something.',
  filePath: '/tmp/test-plan.md',
});

export const makePlanEvaluateInput = (backend: StubHarness, input: EvaluatorContinuationInput) => ({
  harness: backend,
  planSetName: 'test-set',
  sourceContent: '# Source\n\nSome PRD.',
  cwd: input.worktreePath,
  continuationContext: input.evaluatorOptions.evaluatorContinuationContext,
});
