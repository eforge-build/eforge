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
import { ts, makeAttemptInfo, makeThrowingAgent, makeSuccessfulAgent, makeMultiAttemptAgent, makeEvaluatorPolicy, makePlanFile, makePlanEvaluateInput } from './retry-helpers.js';

describe('withRetry — retry-then-success', () => {
  it('yields all first-attempt events, emits agent:retry, yields all second-attempt events, and returns the final result', async () => {
    const firstEvents: EforgeEvent[] = [
      { timestamp: ts(), type: 'plan:build:evaluate:start', planId: 'p1' },
    ];
    const secondEvents: EforgeEvent[] = [
      { timestamp: ts(), type: 'plan:build:evaluate:complete', planId: 'p1', accepted: 1, rejected: 0 },
    ];

    const finalResult = { ok: true };
    let attempt = 0;
    const agent = async function* (): AsyncGenerator<EforgeEvent, typeof finalResult | undefined> {
      attempt += 1;
      if (attempt === 1) {
        for (const ev of firstEvents) yield ev;
        throw new AgentTerminalError('error_max_turns', 'turns exhausted');
      }
      for (const ev of secondEvents) yield ev;
      return finalResult;
    };

    const policy = makeEvaluatorPolicy({
      // Override the default to always "retry" so the abort-success check doesn't trigger.
      buildContinuationInput: (info) => ({
        kind: 'retry',
        input: info.prevInput,
      }),
    });
    const initial: EvaluatorContinuationInput = {
      worktreePath: '/tmp/noop',
      planId: 'p1',
      evaluatorOptions: {},
    };

    const out: EforgeEvent[] = [];
    const gen = withRetry(agent, policy, initial);
    let step = await gen.next();
    while (!step.done) {
      out.push(step.value);
      step = await gen.next();
    }
    expect(step.value).toBe(finalResult);

    // First-attempt events came through.
    expect(out.filter((e) => e.type === 'plan:build:evaluate:start')).toHaveLength(1);
    // agent:retry fired with the expected shape.
    const retryEvt = out.find((e) => e.type === 'agent:retry') as
      | Extract<EforgeEvent, { type: 'agent:retry' }>
      | undefined;
    expect(retryEvt).toBeDefined();
    expect(retryEvt!.agent).toBe('evaluator');
    expect(retryEvt!.attempt).toBe(1);
    expect(retryEvt!.maxAttempts).toBe(2);
    expect(retryEvt!.subtype).toBe('error_max_turns');
    expect(retryEvt!.label).toBe('evaluator-continuation');
    // Policy onRetry emitted the domain continuation event.
    expect(out.filter((e) => e.type === 'plan:build:evaluate:continuation')).toHaveLength(1);
    // Second-attempt events came through.
    expect(out.filter((e) => e.type === 'plan:build:evaluate:complete')).toHaveLength(1);
  });
});

describe('withRetry — exhaustion', () => {
  it('rethrows the terminal error after maxAttempts consecutive retryable failures', async () => {
    const firstErr = new AgentTerminalError('error_max_turns', 'first');
    const secondErr = new AgentTerminalError('error_max_turns', 'second');

    const agent = makeMultiAttemptAgent([
      makeThrowingAgent([], firstErr),
      makeThrowingAgent([], secondErr),
    ]);

    const policy = makeEvaluatorPolicy({
      buildContinuationInput: (info) => ({
        kind: 'retry',
        input: info.prevInput,
      }),
    });
    const initial: EvaluatorContinuationInput = {
      worktreePath: '/tmp/noop',
      evaluatorOptions: {},
    };

    let thrown: unknown;
    try {
      // Drain the generator; final attempt's error should surface.
      for await (const _ev of withRetry(agent, policy, initial)) {
        // collect events but we only care about terminal behavior
      }
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(AgentTerminalError);
    expect((thrown as AgentTerminalError).subtype).toBe('error_max_turns');
    expect((thrown as AgentTerminalError).message).toContain('second');
  });

  it('does not start a third attempt after two consecutive retryable failures', async () => {
    let callCount = 0;
    const makeCountingAgent = (): ((input: unknown) => AsyncGenerator<EforgeEvent, undefined>) => {
      return async function* () {
        callCount++;
        throw new AgentTerminalError('error_max_turns', `attempt ${callCount}`);
      };
    };

    const policy = makeEvaluatorPolicy({
      buildContinuationInput: (info) => ({
        kind: 'retry',
        input: info.prevInput,
      }),
    });
    const initial: EvaluatorContinuationInput = {
      worktreePath: '/tmp/noop',
      evaluatorOptions: {},
    };

    try {
      for await (const _ev of withRetry(makeCountingAgent(), policy, initial)) {
        // noop
      }
    } catch {
      // expected
    }

    expect(callCount).toBe(policy.maxAttempts);
  });
});

describe('withRetry — evaluator abort-success on clean worktree', () => {
  it('returns success without a second attempt when the policy returns abort-success', async () => {
    let callCount = 0;
    const agent = async function* (_input: EvaluatorContinuationInput): AsyncGenerator<EforgeEvent, undefined> {
      callCount++;
      yield { timestamp: ts(), type: 'plan:build:evaluate:start', planId: 'p1' };
      throw new AgentTerminalError('error_max_turns', 'turns exhausted');
    };

    // Policy overrides the default continuation builder to simulate a clean
    // worktree by always returning abort-success.
    const policy = makeEvaluatorPolicy({
      buildContinuationInput: () => ({ kind: 'abort-success' }),
    });
    const initial: EvaluatorContinuationInput = {
      worktreePath: '/tmp/noop',
      planId: 'p1',
      evaluatorOptions: {},
      checkHasUnstagedChanges: async () => false,
    };

    const out: EforgeEvent[] = [];
    // Must not throw.
    for await (const ev of withRetry(agent, policy, initial)) {
      out.push(ev);
    }

    expect(callCount).toBe(1);
    // No agent:retry event when we abort-success.
    expect(out.find((e) => e.type === 'agent:retry')).toBeUndefined();
    // First-attempt events came through.
    expect(out.filter((e) => e.type === 'plan:build:evaluate:start')).toHaveLength(1);
  });
});

describe('withRetry — terminal-success via terminalSuccessWhen', () => {
  it('emits onTerminalSuccess events, drops held-back terminal, and returns success when hook returns true', async () => {
    let callCount = 0;
    const warningCode = 'infra-downgraded-test';

    const agent = async function* (_input: EvaluatorContinuationInput): AsyncGenerator<EforgeEvent, undefined> {
      callCount++;
      yield { timestamp: ts(), type: 'plan:build:evaluate:start', planId: 'p1' };
      yield { timestamp: ts(), type: 'plan:build:failed', planId: 'p1', error: 'Backend error: WebSocket closed 1000', terminalSubtype: 'error_transient_transport' };
    };

    const policy = makeEvaluatorPolicy({
      terminalSuccessWhen: () => true,
      onTerminalSuccess: () => [{
        timestamp: ts(),
        type: 'agent:warning',
        agent: 'evaluator',
        agentId: 'eval-1',
        code: warningCode,
        message: 'downgraded',
      }],
    });
    const initial: EvaluatorContinuationInput = {
      worktreePath: '/tmp/noop',
      planId: 'p1',
      evaluatorOptions: {},
    };

    const out: EforgeEvent[] = [];
    for await (const ev of withRetry(agent, policy, initial)) {
      out.push(ev);
    }

    // Only one attempt ran.
    expect(callCount).toBe(1);
    // onTerminalSuccess warning was emitted.
    const warnings = out.filter((e) => e.type === 'agent:warning') as Array<Extract<EforgeEvent, { type: 'agent:warning' }>>;
    expect(warnings).toHaveLength(1);
    expect(warnings[0].code).toBe(warningCode);
    // No agent:retry was emitted.
    expect(out.find((e) => e.type === 'agent:retry')).toBeUndefined();
    // The stream terminal event was held back and dropped by terminal success.
    expect(out.find((e) => e.type === 'plan:build:failed')).toBeUndefined();
  });

  it('does NOT trigger terminal-success when hook returns false — normal retry path proceeds', async () => {
    let callCount = 0;

    const attempts = [
      makeThrowingAgent([], new AgentTerminalError('error_max_turns', 'turns exhausted')),
      makeSuccessfulAgent([{ timestamp: ts(), type: 'plan:build:evaluate:complete', planId: 'p1', accepted: 1, rejected: 0 }]),
    ];
    const agent = async function* (input: EvaluatorContinuationInput): AsyncGenerator<EforgeEvent, undefined> {
      callCount++;
      yield* attempts[callCount - 1](input);
    };

    const policy = makeEvaluatorPolicy({
      terminalSuccessWhen: () => false,
      buildContinuationInput: (info) => ({ kind: 'retry', input: info.prevInput }),
    });
    const initial: EvaluatorContinuationInput = {
      worktreePath: '/tmp/noop',
      planId: 'p1',
      evaluatorOptions: {},
    };

    const out: EforgeEvent[] = [];
    for await (const ev of withRetry(agent, policy, initial)) {
      out.push(ev);
    }

    // Two attempts ran (normal retry).
    expect(callCount).toBe(2);
    expect(out.find((e) => e.type === 'agent:retry')).toBeDefined();
    expect(out.find((e) => e.type === 'plan:build:evaluate:complete')).toBeDefined();
  });

  it('terminal-success applies even on the last attempt (maxAttempts reached)', async () => {
    let callCount = 0;
    const agent = async function* (_input: EvaluatorContinuationInput): AsyncGenerator<EforgeEvent, undefined> {
      callCount++;
      throw new AgentTerminalError('error_transient_transport', 'ws closed');
    };

    const policy = makeEvaluatorPolicy({
      maxAttempts: 1, // no retries allowed
      terminalSuccessWhen: () => true,
      onTerminalSuccess: () => [],
    });
    const initial: EvaluatorContinuationInput = {
      worktreePath: '/tmp/noop',
      evaluatorOptions: {},
    };

    // Must not throw despite exhausting attempts.
    const out: EforgeEvent[] = [];
    for await (const ev of withRetry(agent, policy, initial)) {
      out.push(ev);
    }

    expect(callCount).toBe(1);
    expect(out.find((e) => e.type === 'agent:retry')).toBeUndefined();
  });
});

describe('withRetry — planner post-checkpoint terminal-success integration', () => {
  it('after planning:complete + transient transport error, emits warning, no second attempt, no error', async () => {
    let callCount = 0;
    const plannerPolicy = DEFAULT_RETRY_POLICIES.planner!;

    const plannerAgent = async function* (_input: PlannerContinuationInput): AsyncGenerator<EforgeEvent, undefined> {
      callCount++;
      yield { timestamp: ts(), type: 'planning:complete', plans: [] };
      throw new AgentTerminalError('error_transient_transport', 'Backend error: WebSocket closed 1000');
    };

    const initial: PlannerContinuationInput = {
      sideEffects: { cwd: '/tmp/noop', planSetName: 'test', outputDir: 'eforge/plans' },
      plannerOptions: {},
    };

    const out: EforgeEvent[] = [];
    for await (const ev of withRetry(plannerAgent, plannerPolicy as RetryPolicy<PlannerContinuationInput>, initial)) {
      out.push(ev);
    }

    expect(callCount).toBe(1);
    // planning:complete was yielded through
    expect(out.find((e) => e.type === 'planning:complete')).toBeDefined();
    // agent:warning was emitted by onTerminalSuccess
    const warnings = out.filter((e) => e.type === 'agent:warning') as Array<Extract<EforgeEvent, { type: 'agent:warning' }>>;
    expect(warnings).toHaveLength(1);
    expect(warnings[0].code).toBe('infrastructure-error-post-checkpoint-downgraded');
    // No retry
    expect(out.find((e) => e.type === 'agent:retry')).toBeUndefined();
  });

  it('after planning:skip + pi-infra error, emits warning, no second attempt, no error', async () => {
    let callCount = 0;
    const plannerPolicy = DEFAULT_RETRY_POLICIES.planner!;

    const plannerAgent = async function* (_input: PlannerContinuationInput): AsyncGenerator<EforgeEvent, undefined> {
      callCount++;
      yield { timestamp: ts(), type: 'planning:skip', reason: 'already implemented' };
      throw new AgentTerminalError('error_pi_tool_infrastructure', 'Pi tool-call infrastructure failure: hook error');
    };

    const initial: PlannerContinuationInput = {
      sideEffects: { cwd: '/tmp/noop', planSetName: 'test', outputDir: 'eforge/plans' },
      plannerOptions: {},
    };

    const out: EforgeEvent[] = [];
    for await (const ev of withRetry(plannerAgent, plannerPolicy as RetryPolicy<PlannerContinuationInput>, initial)) {
      out.push(ev);
    }

    expect(callCount).toBe(1);
    const warnings = out.filter((e) => e.type === 'agent:warning') as Array<Extract<EforgeEvent, { type: 'agent:warning' }>>;
    expect(warnings).toHaveLength(1);
    expect(warnings[0].code).toBe('infrastructure-error-post-checkpoint-downgraded');
    expect(out.find((e) => e.type === 'agent:retry')).toBeUndefined();
  });

  it('after expedition:architecture:complete + pi-infra error, emits warning, no second attempt, no error', async () => {
    let callCount = 0;
    const plannerPolicy = DEFAULT_RETRY_POLICIES.planner!;

    const plannerAgent = async function* (_input: PlannerContinuationInput): AsyncGenerator<EforgeEvent, undefined> {
      callCount++;
      yield { timestamp: ts(), type: 'expedition:architecture:complete', modules: [] };
      throw new AgentTerminalError('error_pi_tool_infrastructure', 'Pi tool-call infrastructure failure: hook error');
    };

    const initial: PlannerContinuationInput = {
      sideEffects: { cwd: '/tmp/noop', planSetName: 'test', outputDir: 'eforge/plans' },
      plannerOptions: {},
    };

    const out: EforgeEvent[] = [];
    for await (const ev of withRetry(plannerAgent, plannerPolicy as RetryPolicy<PlannerContinuationInput>, initial)) {
      out.push(ev);
    }

    expect(callCount).toBe(1);
    expect(out.find((e) => e.type === 'expedition:architecture:complete')).toBeDefined();
    const warnings = out.filter((e) => e.type === 'agent:warning') as Array<Extract<EforgeEvent, { type: 'agent:warning' }>>;
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({
      agent: 'planner',
      code: 'infrastructure-error-post-checkpoint-downgraded',
    });
    expect(out.find((e) => e.type === 'agent:retry')).toBeUndefined();
  });

  it('after planning:submission (no completion) + transient error, propagates error without retry', async () => {
    let callCount = 0;
    const plannerPolicy = DEFAULT_RETRY_POLICIES.planner!;

    const plannerAgent = async function* (_input: PlannerContinuationInput): AsyncGenerator<EforgeEvent, undefined> {
      callCount++;
      yield { timestamp: ts(), type: 'planning:submission', planCount: 1, totalBodySize: 10, hasMigrations: false };
      throw new Error('Backend error: WebSocket closed 1000');
    };

    const initial: PlannerContinuationInput = {
      sideEffects: { cwd: '/tmp/noop', planSetName: 'test', outputDir: 'eforge/plans' },
      plannerOptions: {},
    };

    let thrown: unknown;
    const out: EforgeEvent[] = [];
    try {
      for await (const ev of withRetry(plannerAgent, plannerPolicy as RetryPolicy<PlannerContinuationInput>, initial)) {
        out.push(ev);
      }
    } catch (err) {
      thrown = err;
    }

    expect(callCount).toBe(1);
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toContain('WebSocket closed 1000');
    expect(out.find((e) => e.type === 'agent:retry')).toBeUndefined();
    expect(out.find((e) => e.type === 'agent:warning')).toBeUndefined();
  });
});

describe('withRetry — pipeline-composer post-checkpoint terminal-success integration', () => {
  it('after planning:pipeline + pi-infra error, emits warning, no second attempt, no error', async () => {
    let callCount = 0;
    const composerPolicy = DEFAULT_RETRY_POLICIES['pipeline-composer']!;

    const composerAgent = async function* (_input: unknown): AsyncGenerator<EforgeEvent, undefined> {
      callCount++;
      yield {
        timestamp: ts(),
        type: 'planning:pipeline',
        scope: 'errand',
        compile: ['planner'],
        defaultBuild: ['implement'],
        defaultReview: { strategy: 'single', perspectives: ['code'], maxRounds: 1, evaluatorStrictness: 'lenient' },
        rationale: 'test',
      };
      throw new AgentTerminalError('error_pi_tool_infrastructure', 'Pi tool-call infrastructure failure: hook error');
    };

    const out: EforgeEvent[] = [];
    for await (const ev of withRetry(composerAgent, composerPolicy as RetryPolicy<unknown>, {})) {
      out.push(ev);
    }

    expect(callCount).toBe(1);
    expect(out.find((e) => e.type === 'planning:pipeline')).toBeDefined();
    const warnings = out.filter((e) => e.type === 'agent:warning') as Array<Extract<EforgeEvent, { type: 'agent:warning' }>>;
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({
      agent: 'pipeline-composer',
      code: 'infrastructure-error-post-checkpoint-downgraded',
    });
    expect(out.find((e) => e.type === 'agent:retry')).toBeUndefined();
  });
});

describe('withRetry — non-retryable errors propagate immediately', () => {
  it('rethrows unrelated errors without a retry', async () => {
    let callCount = 0;
    const agent = async function* (_input: unknown): AsyncGenerator<EforgeEvent, undefined> {
      callCount++;
      throw new Error('boom: unrelated');
    };

    const policy = makeEvaluatorPolicy();
    const initial: EvaluatorContinuationInput = {
      worktreePath: '/tmp/noop',
      evaluatorOptions: {},
    };

    let thrown: unknown;
    try {
      for await (const _ev of withRetry(agent, policy, initial)) { /* noop */ }
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe('boom: unrelated');
    expect(callCount).toBe(1);
  });

  it('does not retry a non-retryable AgentTerminalError subtype', async () => {
    let callCount = 0;
    const agent = async function* (_input: unknown): AsyncGenerator<EforgeEvent, undefined> {
      callCount++;
      throw new AgentTerminalError('error_max_budget_usd', 'out of money');
    };

    const policy = makeEvaluatorPolicy();
    const initial: EvaluatorContinuationInput = {
      worktreePath: '/tmp/noop',
      evaluatorOptions: {},
    };

    let thrown: unknown;
    try {
      for await (const _ev of withRetry(agent, policy, initial)) { /* noop */ }
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(AgentTerminalError);
    expect((thrown as AgentTerminalError).subtype).toBe('error_max_budget_usd');
    expect(callCount).toBe(1);
  });
});

describe('withRetry — stream-based terminal via build:failed with terminalSubtype', () => {
  it('treats a yielded build:failed + terminalSubtype as retryable and holds back the event', async () => {
    // First attempt yields build:failed (without throwing); second attempt succeeds.
    const firstAttempt: (input: unknown) => AsyncGenerator<EforgeEvent, undefined> =
      async function* () {
        yield { timestamp: ts(), type: 'plan:build:evaluate:start', planId: 'p1' };
        yield { timestamp: ts(), type: 'plan:build:failed', planId: 'p1', error: 'maxed out', terminalSubtype: 'error_max_turns' };
      };
    const secondAttempt: (input: unknown) => AsyncGenerator<EforgeEvent, undefined> =
      async function* () {
        yield { timestamp: ts(), type: 'plan:build:evaluate:complete', planId: 'p1', accepted: 1, rejected: 0 };
      };

    const agent = makeMultiAttemptAgent([firstAttempt, secondAttempt]);

    const policy = makeEvaluatorPolicy({
      buildContinuationInput: (info) => ({ kind: 'retry', input: info.prevInput }),
    });
    const initial: EvaluatorContinuationInput = {
      worktreePath: '/tmp/noop',
      planId: 'p1',
      evaluatorOptions: {},
    };

    const out: EforgeEvent[] = [];
    for await (const ev of withRetry(agent, policy, initial)) {
      out.push(ev);
    }

    // The held-back build:failed was not propagated because retry succeeded.
    expect(out.find((e) => e.type === 'plan:build:failed')).toBeUndefined();
    // agent:retry fired with the stream-detected subtype from plan:build:failed.
    const retry = out.find((e) => e.type === 'agent:retry') as Extract<EforgeEvent, { type: 'agent:retry' }> | undefined;
    expect(retry).toBeDefined();
    expect(retry).toMatchObject({
      agent: 'evaluator',
      subtype: 'error_max_turns',
      attempt: 1,
      maxAttempts: 2,
      label: 'evaluator-continuation',
      planId: 'p1',
    });
    // Second attempt completed normally.
    expect(out.filter((e) => e.type === 'plan:build:evaluate:complete')).toHaveLength(1);
  });

  it('yields the held-back build:failed when retries are exhausted', async () => {
    const firstAttempt: (input: unknown) => AsyncGenerator<EforgeEvent, undefined> =
      async function* () {
        yield { timestamp: ts(), type: 'plan:build:failed', planId: 'p1', error: 'maxed out 1', terminalSubtype: 'error_max_turns' };
      };
    const secondAttempt: (input: unknown) => AsyncGenerator<EforgeEvent, undefined> =
      async function* () {
        yield { timestamp: ts(), type: 'plan:build:failed', planId: 'p1', error: 'maxed out 2', terminalSubtype: 'error_max_turns' };
      };

    const agent = makeMultiAttemptAgent([firstAttempt, secondAttempt]);

    const policy = makeEvaluatorPolicy({
      buildContinuationInput: (info) => ({ kind: 'retry', input: info.prevInput }),
    });
    const initial: EvaluatorContinuationInput = {
      worktreePath: '/tmp/noop',
      planId: 'p1',
      evaluatorOptions: {},
    };

    const out: EforgeEvent[] = [];
    for await (const ev of withRetry(agent, policy, initial)) {
      out.push(ev);
    }

    // Final held-back build:failed surfaces after exhaustion.
    const failures = out.filter((e) => e.type === 'plan:build:failed') as Array<Extract<EforgeEvent, { type: 'plan:build:failed' }>>;
    expect(failures).toHaveLength(1);
    expect(failures[0].error).toBe('maxed out 2');
  });
});

// ---------------------------------------------------------------------------
// withRetry + StubHarness + builderEvaluate — end-to-end integration
// ---------------------------------------------------------------------------
//
// These tests exercise the retry wrapper through a real agent generator
// (`builderEvaluate`) backed by `StubHarness`, which is the integration
// configuration the plan's verification criteria explicitly call out.
