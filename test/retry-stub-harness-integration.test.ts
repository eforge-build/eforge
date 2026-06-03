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

describe('withRetry + StubHarness + builderEvaluate', () => {
  it('scripts error_max_turns on attempt 1, success on attempt 2, and returns second-attempt events', async () => {
    const backend = new StubHarness([
      { error: new AgentTerminalError('error_max_turns', 'Reached maximum number of turns (30).') },
      { text: '<evaluation></evaluation>' },
    ]);
    const plan = makePlanFile();

    const runEvaluator = async function* (input: EvaluatorContinuationInput): AsyncGenerator<EforgeEvent> {
      yield* builderEvaluate(plan, {
        harness: backend,
        cwd: input.worktreePath,
      });
    };

    const policy = DEFAULT_RETRY_POLICIES.evaluator as RetryPolicy<EvaluatorContinuationInput>;
    const initial: EvaluatorContinuationInput = {
      worktreePath: '/tmp',
      planId: plan.id,
      evaluatorOptions: {},
      checkHasUnstagedChanges: async () => true, // force retry
    };

    const out: EforgeEvent[] = [];
    for await (const ev of withRetry(runEvaluator, policy, initial)) {
      out.push(ev);
    }

    expect(out.find((e) => e.type === 'plan:build:failed')).toBeUndefined();
    const retryEvt = out.find((e) => e.type === 'agent:retry') as
      | Extract<EforgeEvent, { type: 'agent:retry' }>
      | undefined;
    expect(retryEvt).toBeDefined();
    expect(retryEvt!.agent).toBe('evaluator');
    expect(retryEvt!.subtype).toBe('error_max_turns');
    expect(retryEvt!.attempt).toBe(1);
    expect(retryEvt!.maxAttempts).toBe(2);

    const starts = out.filter((e) => e.type === 'plan:build:evaluate:start');
    expect(starts.length).toBeGreaterThanOrEqual(2);
    const completes = out.filter((e) => e.type === 'plan:build:evaluate:complete');
    expect(completes.length).toBe(0);

    expect(backend.prompts).toHaveLength(2);
  });

  it('does not retry late transport after structured evaluator verdicts', async () => {
    const snapshot = { cwd: '/tmp', capturedAt: 'now', baseHead: 'base', stagedPatch: '', candidatePatch: 'diff --git a/a.ts b/a.ts\n@@ -1 +1 @@\n-old\n+new\n', files: [{ path: 'a.ts', status: 'modified', statusCode: 'M', diff: 'diff --git a/a.ts b/a.ts\n@@ -1 +1 @@\n-old\n+new\n', diffHeader: 'diff --git a/a.ts b/a.ts\n', hunks: [{ index: 1, header: '@@ -1 +1 @@', oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, diff: '@@ -1 +1 @@\n-old\n+new\n' }], isBinary: false, isUntracked: false, isRenameOnly: false, requiresFileVerdict: false }] } as EvaluationSnapshot;
    const backend = new StubHarness([{ toolCalls: [{ tool: 'submit_evaluation_verdicts', toolUseId: 'eval-1', input: { verdicts: [{ file: 'a.ts', hunk: 1, action: 'accept', reason: 'Correct' }] }, output: '' }], lateError: new Error('Backend error: WebSocket error') }]);
    const plan = makePlanFile();
    const runEvaluator = async function* (input: EvaluatorContinuationInput): AsyncGenerator<EforgeEvent> {
      yield* builderEvaluate(plan, { harness: backend, cwd: input.worktreePath, ...(input.evaluationSnapshot && { evaluatorSnapshot: input.evaluationSnapshot }), ...input.evaluatorOptions });
    };
    const out: EforgeEvent[] = [];
    for await (const ev of withRetry(runEvaluator, DEFAULT_RETRY_POLICIES.evaluator as RetryPolicy<EvaluatorContinuationInput>, { worktreePath: '/tmp', planId: plan.id, evaluationSnapshot: snapshot, evaluatorOptions: {}, checkHasUnstagedChanges: async () => true })) out.push(ev);
    expect(backend.prompts).toHaveLength(1);
    expect(out.filter((e) => e.type === 'agent:retry')).toHaveLength(0);
    expect(out.filter((e) => e.type === 'plan:build:evaluate:continuation')).toHaveLength(0);
    expect(out.filter((e) => e.type === 'plan:build:failed')).toHaveLength(0);
  });

  it('retries transient transport evaluator failure when unstaged changes remain', async () => {
    const backend = new StubHarness([
      { error: new Error('Backend error: WebSocket error') },
      { text: '<evaluation></evaluation>' },
    ]);
    const plan = makePlanFile();

    const runEvaluator = async function* (input: EvaluatorContinuationInput): AsyncGenerator<EforgeEvent> {
      yield* builderEvaluate(plan, {
        harness: backend,
        cwd: input.worktreePath,
        ...input.evaluatorOptions,
      });
    };

    const policy = DEFAULT_RETRY_POLICIES.evaluator as RetryPolicy<EvaluatorContinuationInput>;
    const initial: EvaluatorContinuationInput = {
      worktreePath: '/tmp',
      planId: plan.id,
      evaluatorOptions: {},
      checkHasUnstagedChanges: async () => true,
    };

    const out: EforgeEvent[] = [];
    for await (const ev of withRetry(runEvaluator, policy, initial)) {
      out.push(ev);
    }

    expect(backend.prompts).toHaveLength(2);
    expect(backend.prompts[0]).not.toContain('Continuation Context');
    expect(backend.prompts[1]).toContain('Continuation Context');
    expect(backend.prompts[1]).toContain('attempt 1 of 1');
    expect(backend.prompts[1]).toContain('reusing the same immutable evaluation snapshot');
    expect(backend.prompts[1]).toContain('must not mutate files or run shell commands');
    const retries = out.filter((e) => e.type === 'agent:retry') as Array<Extract<EforgeEvent, { type: 'agent:retry' }>>;
    expect(retries).toHaveLength(1);
    expect(retries[0]).toMatchObject({
      agent: 'evaluator',
      subtype: 'error_transient_transport',
      attempt: 1,
      maxAttempts: 2,
      label: 'evaluator-continuation',
      planId: plan.id,
    });
    expect(out.filter((e) => e.type === 'plan:build:evaluate:continuation')).toHaveLength(1);
    expect(out.filter((e) => e.type === 'plan:build:failed')).toHaveLength(0);
  });

  it('evaluator abort-success: first attempt throws transient transport but worktree is clean — no retry', async () => {
    const backend = new StubHarness([
      { error: new Error('Backend error: WebSocket error') },
    ]);
    const plan = makePlanFile();

    const runEvaluator = async function* (input: EvaluatorContinuationInput): AsyncGenerator<EforgeEvent> {
      yield* builderEvaluate(plan, {
        harness: backend,
        cwd: input.worktreePath,
        ...input.evaluatorOptions,
      });
    };

    const policy = DEFAULT_RETRY_POLICIES.evaluator as RetryPolicy<EvaluatorContinuationInput>;
    const initial: EvaluatorContinuationInput = {
      worktreePath: '/tmp',
      planId: plan.id,
      evaluatorOptions: {},
      checkHasUnstagedChanges: async () => false,
    };

    const out: EforgeEvent[] = [];
    for await (const ev of withRetry(runEvaluator, policy, initial)) {
      out.push(ev);
    }

    expect(backend.prompts).toHaveLength(1);
    expect(out.filter((e) => e.type === 'agent:retry')).toHaveLength(0);
    expect(out.filter((e) => e.type === 'plan:build:failed')).toHaveLength(0);
  });

  it('does not retry non-transient backend evaluator failure', async () => {
    const backend = new StubHarness([
      { error: new Error('Backend error: HTTP 500') },
    ]);
    const plan = makePlanFile();

    const runEvaluator = async function* (input: EvaluatorContinuationInput): AsyncGenerator<EforgeEvent> {
      yield* builderEvaluate(plan, {
        harness: backend,
        cwd: input.worktreePath,
        ...input.evaluatorOptions,
      });
    };

    const policy = DEFAULT_RETRY_POLICIES.evaluator as RetryPolicy<EvaluatorContinuationInput>;
    const initial: EvaluatorContinuationInput = {
      worktreePath: '/tmp',
      planId: plan.id,
      evaluatorOptions: {},
      checkHasUnstagedChanges: async () => true,
    };

    const out: EforgeEvent[] = [];
    for await (const ev of withRetry(runEvaluator, policy, initial)) {
      out.push(ev);
    }

    expect(backend.prompts).toHaveLength(1);
    expect(out.filter((e) => e.type === 'agent:retry')).toHaveLength(0);
    expect(out.filter((e) => e.type === 'plan:build:failed')).toHaveLength(0);
    const warnings = out.filter((e) => e.type === 'agent:warning') as Array<Extract<EforgeEvent, { type: 'agent:warning' }>>;
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({
      agent: 'evaluator',
      code: 'evaluation-judgment-failed',
      message: 'Backend error: HTTP 500',
    });
  });

  it('exhausts retries and surfaces the final build:failed when both attempts throw error_max_turns', async () => {
    const backend = new StubHarness([
      { error: new AgentTerminalError('error_max_turns', 'first attempt max turns') },
      { error: new AgentTerminalError('error_max_turns', 'second attempt max turns') },
    ]);
    const plan = makePlanFile();

    const runEvaluator = async function* (input: EvaluatorContinuationInput): AsyncGenerator<EforgeEvent> {
      yield* builderEvaluate(plan, {
        harness: backend,
        cwd: input.worktreePath,
      });
    };

    const policy = DEFAULT_RETRY_POLICIES.evaluator as RetryPolicy<EvaluatorContinuationInput>;
    const initial: EvaluatorContinuationInput = {
      worktreePath: '/tmp',
      planId: plan.id,
      evaluatorOptions: {},
      checkHasUnstagedChanges: async () => true,
    };

    const out: EforgeEvent[] = [];
    for await (const ev of withRetry(runEvaluator, policy, initial)) {
      out.push(ev);
    }

    // Only the held-back build:failed from the LAST attempt is yielded.
    const failures = out.filter(
      (e) => e.type === 'plan:build:failed',
    ) as Array<Extract<EforgeEvent, { type: 'plan:build:failed' }>>;
    expect(failures).toHaveLength(1);
    expect(failures[0].error).toContain('second attempt max turns');
    expect(failures[0].terminalSubtype).toBe('error_max_turns');

    // No third attempt was made.
    expect(backend.prompts).toHaveLength(2);
  });

  it('evaluator abort-success: first attempt throws error_max_turns but worktree is clean — no retry', async () => {
    const backend = new StubHarness([
      { error: new AgentTerminalError('error_max_turns', 'turns exhausted') },
    ]);
    const plan = makePlanFile();

    const runEvaluator = async function* (input: EvaluatorContinuationInput): AsyncGenerator<EforgeEvent> {
      yield* builderEvaluate(plan, {
        harness: backend,
        cwd: input.worktreePath,
      });
    };

    const policy = DEFAULT_RETRY_POLICIES.evaluator as RetryPolicy<EvaluatorContinuationInput>;
    const initial: EvaluatorContinuationInput = {
      worktreePath: '/tmp',
      planId: plan.id,
      evaluatorOptions: {},
      // Clean worktree => evaluator policy short-circuits to abort-success.
      checkHasUnstagedChanges: async () => false,
    };

    const out: EforgeEvent[] = [];
    for await (const ev of withRetry(runEvaluator, policy, initial)) {
      out.push(ev);
    }

    // Only one backend call — no retry ran.
    expect(backend.prompts).toHaveLength(1);
    // No agent:retry event emitted.
    expect(out.find((e) => e.type === 'agent:retry')).toBeUndefined();
    // Held-back terminal build:failed was dropped (abort-success treats the
    // state as success).
    expect(out.find((e) => e.type === 'plan:build:failed')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// withRetry + StubHarness + runPlanEvaluate — compile evaluator integration
// ---------------------------------------------------------------------------


describe('withRetry + StubHarness + runPlanEvaluate', () => {
  it('retries transient transport plan-evaluator failure with evaluator continuation input', async () => {
    const backend = new StubHarness([
      { error: new Error('Backend error: WebSocket error') },
      { text: '<evaluation></evaluation>' },
    ]);

    const runEvaluator = async function* (input: EvaluatorContinuationInput): AsyncGenerator<EforgeEvent> {
      yield* runPlanEvaluate(makePlanEvaluateInput(backend, input));
    };

    const policy = DEFAULT_RETRY_POLICIES['plan-evaluator'] as RetryPolicy<EvaluatorContinuationInput>;
    const initial: EvaluatorContinuationInput = {
      worktreePath: '/tmp',
      evaluatorOptions: {},
      checkHasUnstagedChanges: async () => true,
    };

    const out: EforgeEvent[] = [];
    for await (const ev of withRetry(runEvaluator, policy, initial)) {
      out.push(ev);
    }

    expect(backend.prompts).toHaveLength(2);
    expect(backend.prompts[0]).not.toContain('Continuation Context');
    expect(backend.prompts[1]).toContain('Continuation Context');
    expect(backend.prompts[1]).toContain('attempt 1 of 1');

    const retries = out.filter((e) => e.type === 'agent:retry') as Array<Extract<EforgeEvent, { type: 'agent:retry' }>>;
    expect(retries).toHaveLength(1);
    expect(retries[0]).toMatchObject({
      agent: 'plan-evaluator',
      subtype: 'error_transient_transport',
      attempt: 1,
      maxAttempts: 2,
      label: 'plan-evaluator-continuation',
    });

    const continuations = out.filter((e) => e.type === 'planning:evaluate:continuation') as Array<Extract<EforgeEvent, { type: 'planning:evaluate:continuation' }>>;
    expect(continuations).toHaveLength(1);
    expect(continuations[0]).toMatchObject({
      attempt: 1,
      maxContinuations: 1,
    });
  });
});

// ---------------------------------------------------------------------------
// Type-surface smoke tests (ensures continuation input shapes compile)
// ---------------------------------------------------------------------------
