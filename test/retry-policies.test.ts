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


describe('DEFAULT_RETRY_POLICIES — planner policy', () => {
  const planner = DEFAULT_RETRY_POLICIES.planner!;

  it('does not include error_max_turns in retryableSubtypes — max-turns planner retry is governed by shouldRetry', () => {
    expect(planner.retryableSubtypes.has('error_max_turns')).toBe(false);
  });

  it('has label "planner-continuation"', () => {
    expect(planner.label).toBe('planner-continuation');
  });

  it('has maxAttempts = 3', () => {
    expect(planner.maxAttempts).toBe(3);
  });

  it('shouldRetry returns true for PlannerSubmissionError with dropped-submission events', () => {
    const events: EforgeEvent[] = [
      { timestamp: ts(), type: 'agent:message', agentId: 'a1', agent: 'planner', content: 'done' },
    ];
    const info = makeAttemptInfo({
      prevInput: {} as unknown,
      subtype: 'error_during_execution',
      events,
      error: new PlannerSubmissionError('no submission tool called'),
    });
    expect(planner.shouldRetry!(info as RetryAttemptInfo<unknown>)).toBe(true);
  });

  it('shouldRetry returns false for dropped submission after compact inspection continuation', () => {
    const events: EforgeEvent[] = [
      { timestamp: ts(), type: 'planning:inspection-summary' } as EforgeEvent,
      { timestamp: ts(), type: 'agent:message', agentId: 'a1', agent: 'planner', content: 'synthesis ended without submitting' },
    ];
    const info = makeAttemptInfo({
      prevInput: {} as unknown,
      subtype: 'error_during_execution',
      events,
      error: new PlannerSubmissionError('compact synthesis did not submit'),
    });
    expect(planner.shouldRetry!(info as RetryAttemptInfo<unknown>)).toBe(false);
  });

  it('shouldRetry returns false when submit_plan_set tool was used', () => {
    const events: EforgeEvent[] = [
      {
        timestamp: ts(),
        type: 'agent:tool_use',
        agentId: 'a1',
        agent: 'planner',
        tool: 'submit_plan_set',
        toolUseId: 'tu-1',
        input: {},
      },
    ];
    const info = makeAttemptInfo({
      prevInput: {} as unknown,
      subtype: 'error_during_execution',
      events,
      error: new PlannerSubmissionError('submitted but still treated as error'),
    });
    expect(planner.shouldRetry!(info as RetryAttemptInfo<unknown>)).toBe(false);
  });

  it('shouldRetry returns false when plan:skip was emitted', () => {
    const events: EforgeEvent[] = [
      { timestamp: ts(), type: 'planning:skip', reason: 'already implemented' },
    ];
    const info = makeAttemptInfo({
      prevInput: {} as unknown,
      subtype: 'error_during_execution',
      events,
      error: new PlannerSubmissionError('skip path'),
    });
    expect(planner.shouldRetry!(info as RetryAttemptInfo<unknown>)).toBe(false);
  });

  it('shouldRetry returns false for non-PlannerSubmissionError even when events look like a dropped submission', () => {
    // An unrelated AgentTerminalError (e.g. error_during_execution) that never
    // called a submission tool must NOT be retried — the prior ad-hoc loop
    // only retried PlannerSubmissionError / isMaxTurnsError.
    const events: EforgeEvent[] = [
      { timestamp: ts(), type: 'agent:message', agentId: 'a1', agent: 'planner', content: 'crashed' },
    ];
    const info = makeAttemptInfo({
      prevInput: {} as unknown,
      subtype: 'error_during_execution',
      events,
      error: new AgentTerminalError('error_during_execution', 'boom'),
    });
    expect(planner.shouldRetry!(info as RetryAttemptInfo<unknown>)).toBe(false);
  });

  it('retryableSubtypes does NOT include error_transient_transport — transient transport planner retry is governed by shouldRetry', () => {
    // Planner transport retry is safety-gated by the pre-submission boundary in
    // shouldRetry. Adding error_transient_transport to retryableSubtypes would
    // bypass that guard and allow retries after planning:submission.
    expect(planner.retryableSubtypes.has('error_transient_transport')).toBe(false);
    expect(planner.retryableSubtypes).toEqual(new Set());
  });

  it('retryableSubtypes does NOT include error_pi_tool_infrastructure — pi infra planner retry is governed by shouldRetry', () => {
    expect(planner.retryableSubtypes.has('error_pi_tool_infrastructure')).toBe(false);
  });

  it('shouldRetry returns true for error_max_turns when no compact inspection continuation was emitted', () => {
    const events: EforgeEvent[] = [
      { timestamp: ts(), type: 'agent:message', agentId: 'a1', agent: 'planner', content: 'thinking...' },
    ];
    const info = makeAttemptInfo({
      prevInput: {} as unknown,
      subtype: 'error_max_turns',
      events,
      error: new AgentTerminalError('error_max_turns', 'turns exhausted'),
    });
    expect(planner.shouldRetry!(info as RetryAttemptInfo<unknown>)).toBe(true);
  });

  it('shouldRetry returns false for error_max_turns after compact inspection continuation', () => {
    const events: EforgeEvent[] = [
      { timestamp: ts(), type: 'planning:inspection-summary' } as EforgeEvent,
      { timestamp: ts(), type: 'agent:message', agentId: 'a1', agent: 'planner', content: 'compact synthesis ran out of turns' },
    ];
    const info = makeAttemptInfo({
      prevInput: {} as unknown,
      subtype: 'error_max_turns',
      events,
      error: new AgentTerminalError('error_max_turns', 'turns exhausted'),
    });
    expect(planner.shouldRetry!(info as RetryAttemptInfo<unknown>)).toBe(false);
  });

  it('shouldRetry returns true for error_transient_transport when no submission or skip events have been emitted', () => {
    const events: EforgeEvent[] = [
      { timestamp: ts(), type: 'agent:message', agentId: 'a1', agent: 'planner', content: 'thinking...' },
    ];
    const info = makeAttemptInfo({
      prevInput: {} as unknown,
      subtype: 'error_transient_transport',
      events,
      error: new Error('Backend error: WebSocket closed 1000'),
    });
    expect(planner.shouldRetry!(info as RetryAttemptInfo<unknown>)).toBe(true);
  });

  it('shouldRetry returns true for error_pi_tool_infrastructure when no boundary events have been emitted', () => {
    const events: EforgeEvent[] = [
      { timestamp: ts(), type: 'agent:message', agentId: 'a1', agent: 'planner', content: 'thinking...' },
    ];
    const info = makeAttemptInfo({
      prevInput: {} as unknown,
      subtype: 'error_pi_tool_infrastructure',
      events,
      error: new Error('Theme not initialized. Call initTheme() first.'),
    });
    expect(planner.shouldRetry!(info as RetryAttemptInfo<unknown>)).toBe(true);
  });

  it('shouldRetry returns false for retryable infrastructure after compact inspection continuation', () => {
    const events: EforgeEvent[] = [
      { timestamp: ts(), type: 'planning:inspection-summary' } as EforgeEvent,
      { timestamp: ts(), type: 'agent:message', agentId: 'a1', agent: 'planner', content: 'compact synthesis stream dropped' },
    ];
    const info = makeAttemptInfo({
      prevInput: {} as unknown,
      subtype: 'error_transient_transport',
      events,
      error: new Error('Backend error: WebSocket closed 1000'),
    });
    expect(planner.shouldRetry!(info as RetryAttemptInfo<unknown>)).toBe(false);
  });

  it('shouldRetry returns false for error_transient_transport when planning:submission was already emitted', () => {
    const events: EforgeEvent[] = [
      { timestamp: ts(), type: 'planning:submission', planCount: 1, totalBodySize: 100, hasMigrations: false },
    ];
    const info = makeAttemptInfo({
      prevInput: {} as unknown,
      subtype: 'error_transient_transport',
      events,
      error: new Error('Backend error: WebSocket closed 1000'),
    });
    expect(planner.shouldRetry!(info as RetryAttemptInfo<unknown>)).toBe(false);
  });

  it('shouldRetry returns false for error_pi_tool_infrastructure when planning:submission was already emitted', () => {
    const events: EforgeEvent[] = [
      { timestamp: ts(), type: 'planning:submission', planCount: 1, totalBodySize: 100, hasMigrations: false },
    ];
    const info = makeAttemptInfo({
      prevInput: {} as unknown,
      subtype: 'error_pi_tool_infrastructure',
      events,
      error: new Error('Theme not initialized. Call initTheme() first.'),
    });
    expect(planner.shouldRetry!(info as RetryAttemptInfo<unknown>)).toBe(false);
  });

  it('shouldRetry returns false for error_transient_transport when planning:skip was already emitted', () => {
    const events: EforgeEvent[] = [
      { timestamp: ts(), type: 'planning:skip', reason: 'already implemented' },
    ];
    const info = makeAttemptInfo({
      prevInput: {} as unknown,
      subtype: 'error_transient_transport',
      events,
      error: new Error('Backend error: WebSocket closed 1000'),
    });
    expect(planner.shouldRetry!(info as RetryAttemptInfo<unknown>)).toBe(false);
  });

  it('shouldRetry returns false for error_transient_transport when planning:complete was already emitted', () => {
    const events: EforgeEvent[] = [
      { timestamp: ts(), type: 'planning:complete', plans: [] },
    ];
    const info = makeAttemptInfo({
      prevInput: {} as unknown,
      subtype: 'error_transient_transport',
      events,
      error: new Error('Backend error: WebSocket closed 1000'),
    });
    // planning:complete is an authoritative checkpoint — terminalSuccessWhen handles it,
    // so shouldRetry returns false (isBeforePlannerSubmissionBoundary is false)
    expect(planner.shouldRetry!(info as RetryAttemptInfo<unknown>)).toBe(false);
  });

  it('terminalSuccessWhen returns true after planning:complete + retryable error', () => {
    const events: EforgeEvent[] = [
      { timestamp: ts(), type: 'planning:complete', plans: [] },
    ];
    const info = makeAttemptInfo({
      prevInput: {} as unknown,
      subtype: 'error_transient_transport',
      events,
      error: new Error('Backend error: WebSocket closed 1000'),
    });
    expect(planner.terminalSuccessWhen!(info as RetryAttemptInfo<unknown>)).toBe(true);
  });

  it('terminalSuccessWhen returns true after planning:skip + retryable error', () => {
    const events: EforgeEvent[] = [
      { timestamp: ts(), type: 'planning:skip', reason: 'already implemented' },
    ];
    const info = makeAttemptInfo({
      prevInput: {} as unknown,
      subtype: 'error_pi_tool_infrastructure',
      events,
      error: new Error('Pi tool-call infrastructure failure: connection reset'),
    });
    expect(planner.terminalSuccessWhen!(info as RetryAttemptInfo<unknown>)).toBe(true);
  });

  it('terminalSuccessWhen returns false after planning:submission only (ambiguous boundary)', () => {
    const events: EforgeEvent[] = [
      { timestamp: ts(), type: 'planning:submission', planCount: 1, totalBodySize: 100, hasMigrations: false },
    ];
    const info = makeAttemptInfo({
      prevInput: {} as unknown,
      subtype: 'error_transient_transport',
      events,
      error: new Error('Backend error: WebSocket closed 1000'),
    });
    expect(planner.terminalSuccessWhen!(info as RetryAttemptInfo<unknown>)).toBe(false);
  });

  it('terminalSuccessWhen returns false for non-retryable subtypes even after checkpoint', () => {
    const events: EforgeEvent[] = [
      { timestamp: ts(), type: 'planning:complete', plans: [] },
    ];
    const info = makeAttemptInfo({
      prevInput: {} as unknown,
      subtype: 'error_max_budget_usd',
      events,
      error: new AgentTerminalError('error_max_budget_usd', 'budget exceeded'),
    });
    expect(planner.terminalSuccessWhen!(info as RetryAttemptInfo<unknown>)).toBe(false);
  });
});

describe('DEFAULT_RETRY_POLICIES — builder policy', () => {
  const builder = DEFAULT_RETRY_POLICIES.builder!;

  it('retryableSubtypes includes error_max_turns', () => {
    expect(builder.retryableSubtypes.has('error_max_turns')).toBe(true);
  });

  it('retryableSubtypes includes error_transient_transport', () => {
    expect(builder.retryableSubtypes.has('error_transient_transport')).toBe(true);
  });

  it('retryableSubtypes includes error_pi_tool_infrastructure', () => {
    expect(builder.retryableSubtypes.has('error_pi_tool_infrastructure')).toBe(true);
  });

  it('retryableSubtypes does not include error_during_execution', () => {
    expect(builder.retryableSubtypes.has('error_during_execution')).toBe(false);
  });

  it('has no `shouldRetry` that would match dropped-submission', () => {
    // Builder's policy only uses retryableSubtypes; no custom shouldRetry.
    expect(builder.shouldRetry).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// buildBuilderContinuationInput — discovery-only and checkpointed-diff paths
// ---------------------------------------------------------------------------


describe('DEFAULT_RETRY_POLICIES — evaluator policy', () => {
  const evaluator = DEFAULT_RETRY_POLICIES.evaluator!;

  it('retryableSubtypes contains error_max_turns, error_transient_transport, and error_pi_tool_infrastructure', () => {
    expect(evaluator.retryableSubtypes).toEqual(new Set(['error_max_turns', 'error_transient_transport', 'error_pi_tool_infrastructure']));
  });

  it('has maxAttempts = 2 (matches prior maxContinuations: 1 + initial attempt)', () => {
    expect(evaluator.maxAttempts).toBe(2);
  });

  it('retryableSubtypes does not include error_during_execution', () => {
    expect(evaluator.retryableSubtypes.has('error_during_execution')).toBe(false);
  });
  it('evaluator continuation events carry round when present and omit it when absent', () => {
    const eventFor = (input: EvaluatorContinuationInput) => evaluator.onRetry!(makeAttemptInfo<EvaluatorContinuationInput>({ prevInput: input }) as RetryAttemptInfo<unknown>)[0] as Extract<EforgeEvent, { type: 'plan:build:evaluate:continuation' }>;
    expect(eventFor({ worktreePath: '/tmp/wt', planId: 'plan-42', round: 1, evaluatorOptions: {} }).round).toBe(1); expect('round' in eventFor({ worktreePath: '/tmp/wt', planId: 'plan-42', evaluatorOptions: {} })).toBe(false);
  });
});

describe('DEFAULT_RETRY_POLICIES — plan-evaluator / cohesion-evaluator / architecture-evaluator', () => {
  for (const role of ['plan-evaluator', 'cohesion-evaluator', 'architecture-evaluator'] as const) {
    it(`${role} policy retries on error_max_turns, error_transient_transport, and error_pi_tool_infrastructure`, () => {
      const policy = DEFAULT_RETRY_POLICIES[role]!;
      expect(policy.retryableSubtypes).toEqual(new Set(['error_max_turns', 'error_transient_transport', 'error_pi_tool_infrastructure']));
      expect(policy.maxAttempts).toBe(2);
    });
  }
});


describe('getPolicy — unregistered roles default to no-retry', () => {
  // Unregistered roles default to maxAttempts: 1 (no retries) because they lack
  // safe continuation/checkpoint contracts. A retry policy is only safe when the
  // agent can resume meaningful work from a well-defined intermediate state. Roles
  // like 'reviewer' and 'merge-conflict-resolver' have no such checkpointing
  // semantics, so a retry would duplicate side effects or produce inconsistent
  // state. They must be explicitly registered in DEFAULT_RETRY_POLICIES before
  // any retry behavior is allowed.
  const unregisteredRoles: AgentRole[] = [
    'reviewer',
    'module-planner',
    'formatter',
    'doc-author',
    'doc-syncer',
    'test-writer',
    'tester',
    'validation-fixer',
    'merge-conflict-resolver',
    'staleness-assessor',
    'prd-validator',
    'recovery-analyst',
    'dependency-detector',
    'gap-closer',
  ];

  for (const role of unregisteredRoles) {
    it(`${role} has a no-retry default policy`, () => {
      const policy = getPolicy(role);
      expect(policy.maxAttempts).toBe(1);
      expect(policy.retryableSubtypes.size).toBe(0);
    });
  }

  it('registered roles come back from getPolicy', () => {
    const planner = getPolicy('planner');
    expect(planner.label).toBe('planner-continuation');
    expect(planner.maxAttempts).toBe(3);

    const reviewFixer = getPolicy('review-fixer');
    expect(reviewFixer.label).toBe('review-fixer-continuation');
    expect(reviewFixer.maxAttempts).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// DEFAULT_RETRY_POLICIES — review-fixer policy
// ---------------------------------------------------------------------------

describe('DEFAULT_RETRY_POLICIES — review-fixer policy', () => {
  it('is registered with maxAttempts 3 and label review-fixer-continuation', () => {
    const policy = getPolicy('review-fixer');
    expect(policy.maxAttempts).toBe(3);
    expect(policy.label).toBe('review-fixer-continuation');
  });

  it('retryableSubtypes includes only error_max_turns', () => {
    const policy = getPolicy('review-fixer');
    expect(policy.retryableSubtypes.has('error_max_turns')).toBe(true);
    expect(policy.retryableSubtypes.has('error_transient_transport')).toBe(false);
    expect(policy.retryableSubtypes.size).toBe(1);
  });

  it('buildReviewFixerContinuationInput splices continuationContext with partial diff', async () => {
    const info = makeAttemptInfo<ReviewFixerContinuationInput>({
      attempt: 1,
      maxAttempts: 3,
      subtype: 'error_max_turns',
      prevInput: {
        cwd: '/tmp/nonexistent-for-test',
        planId: 'plan-01',
        reviewFixerOptions: {},
      },
    });

    // The git command will fail on a non-existent dir — expect a graceful fallback
    const decision = await buildReviewFixerContinuationInput(info);
    expect(decision.kind).toBe('retry');
    if (decision.kind === 'retry') {
      const ctx = decision.input.reviewFixerOptions.continuationContext;
      expect(ctx).toBeDefined();
      expect(ctx!.attempt).toBe(1);
      expect(ctx!.maxContinuations).toBe(2);
      // On error, partialDiff is a fallback string
      expect(ctx!.partialDiff).toBeDefined();
    }
  });

  it('onRetry emits plan:build:review:fix:continuation event', () => {
    const policy = DEFAULT_RETRY_POLICIES['review-fixer'];
    expect(policy).toBeDefined();
    if (!policy?.onRetry) throw new Error('onRetry not defined');

    const info = makeAttemptInfo<ReviewFixerContinuationInput>({
      attempt: 1,
      maxAttempts: 3,
      subtype: 'error_max_turns',
      prevInput: {
        cwd: '/tmp/wt',
        planId: 'plan-42',
        reviewFixerOptions: {},
      },
    });

    const events = policy.onRetry(info as RetryAttemptInfo<unknown>);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('plan:build:review:fix:continuation');
    const evt = events[0] as Extract<EforgeEvent, { type: 'plan:build:review:fix:continuation' }>;
    expect(evt.planId).toBe('plan-42');
    expect('round' in evt).toBe(false);
    expect((policy.onRetry(makeAttemptInfo<ReviewFixerContinuationInput>({ prevInput: { cwd: '/tmp/wt', planId: 'plan-42', round: 1, reviewFixerOptions: {} } }) as RetryAttemptInfo<unknown>)[0] as Extract<EforgeEvent, { type: 'plan:build:review:fix:continuation' }>).round).toBe(1);
    expect(evt.attempt).toBe(1);
    expect(evt.maxContinuations).toBe(2);
  });

  it('planIdFromInput extracts planId from ReviewFixerContinuationInput', () => {
    const policy = DEFAULT_RETRY_POLICIES['review-fixer'];
    expect(policy?.planIdFromInput).toBeDefined();
    const input: ReviewFixerContinuationInput = { cwd: '/tmp/wt', planId: 'plan-99', reviewFixerOptions: {} };
    expect(policy!.planIdFromInput!(input as unknown)).toBe('plan-99');
  });

});

// ---------------------------------------------------------------------------
// isDroppedSubmission
// ---------------------------------------------------------------------------

describe('isDroppedSubmission', () => {
  it('returns true when no submission tool was called and no skip was emitted', () => {
    const events: EforgeEvent[] = [
      { timestamp: ts(), type: 'agent:message', agentId: 'a1', agent: 'planner', content: 'hmm' },
    ];
    expect(isDroppedSubmission(events)).toBe(true);
  });

  it('returns false when submit_plan_set was called', () => {
    const events: EforgeEvent[] = [
      {
        timestamp: ts(),
        type: 'agent:tool_use',
        agentId: 'a1',
        agent: 'planner',
        tool: 'submit_plan_set',
        toolUseId: 'tu-1',
        input: {},
      },
    ];
    expect(isDroppedSubmission(events)).toBe(false);
  });

  it('returns false when submit_architecture was called', () => {
    const events: EforgeEvent[] = [
      {
        timestamp: ts(),
        type: 'agent:tool_use',
        agentId: 'a1',
        agent: 'planner',
        tool: 'submit_architecture',
        toolUseId: 'tu-1',
        input: {},
      },
    ];
    expect(isDroppedSubmission(events)).toBe(false);
  });

  it('returns false when plan:skip was emitted', () => {
    const events: EforgeEvent[] = [
      { timestamp: ts(), type: 'planning:skip', reason: 'already done' },
    ];
    expect(isDroppedSubmission(events)).toBe(false);
  });

  it('returns true for empty event list', () => {
    expect(isDroppedSubmission([])).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// hasAuthoritativePlannerCheckpoint
// ---------------------------------------------------------------------------

describe('hasAuthoritativePlannerCheckpoint', () => {
  it('returns true when planning:complete is present', () => {
    const events: EforgeEvent[] = [{ timestamp: ts(), type: 'planning:complete', plans: [] }];
    expect(hasAuthoritativePlannerCheckpoint(events)).toBe(true);
  });

  it('returns true when planning:skip is present', () => {
    const events: EforgeEvent[] = [{ timestamp: ts(), type: 'planning:skip', reason: 'done' }];
    expect(hasAuthoritativePlannerCheckpoint(events)).toBe(true);
  });

  it('returns true when expedition:architecture:complete is present', () => {
    const events: EforgeEvent[] = [{ timestamp: ts(), type: 'expedition:architecture:complete', modules: [] }];
    expect(hasAuthoritativePlannerCheckpoint(events)).toBe(true);
  });

  it('returns false for empty events', () => {
    expect(hasAuthoritativePlannerCheckpoint([])).toBe(false);
  });

  it('returns false when only planning:submission is present', () => {
    const events: EforgeEvent[] = [{ timestamp: ts(), type: 'planning:submission', planCount: 1, totalBodySize: 100, hasMigrations: false }];
    expect(hasAuthoritativePlannerCheckpoint(events)).toBe(false);
  });

  it('returns false for unrelated events', () => {
    const events: EforgeEvent[] = [
      { timestamp: ts(), type: 'agent:message', agentId: 'a1', agent: 'planner', content: 'thinking' },
    ];
    expect(hasAuthoritativePlannerCheckpoint(events)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isBeforePlannerSubmissionBoundary
// ---------------------------------------------------------------------------

describe('isBeforePlannerSubmissionBoundary', () => {
  it('returns true for empty events', () => {
    expect(isBeforePlannerSubmissionBoundary([])).toBe(true);
  });

  it('returns true when only unrelated events are present', () => {
    const events: EforgeEvent[] = [
      { timestamp: ts(), type: 'agent:message', agentId: 'a1', agent: 'planner', content: 'thinking' },
    ];
    expect(isBeforePlannerSubmissionBoundary(events)).toBe(true);
  });

  it('returns false when planning:submission is present', () => {
    const events: EforgeEvent[] = [
      { timestamp: ts(), type: 'planning:submission', planCount: 1, totalBodySize: 10, hasMigrations: false },
    ];
    expect(isBeforePlannerSubmissionBoundary(events)).toBe(false);
  });

  it('returns false when planning:skip is present', () => {
    const events: EforgeEvent[] = [{ timestamp: ts(), type: 'planning:skip', reason: 'done' }];
    expect(isBeforePlannerSubmissionBoundary(events)).toBe(false);
  });

  it('returns false when planning:complete is present', () => {
    const events: EforgeEvent[] = [{ timestamp: ts(), type: 'planning:complete', plans: [] }];
    expect(isBeforePlannerSubmissionBoundary(events)).toBe(false);
  });

  it('returns false when expedition:architecture:complete is present', () => {
    const events: EforgeEvent[] = [{ timestamp: ts(), type: 'expedition:architecture:complete', modules: [] }];
    expect(isBeforePlannerSubmissionBoundary(events)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isRetryableInfrastructureSubtype
// ---------------------------------------------------------------------------

describe('isRetryableInfrastructureSubtype', () => {
  it('returns true for error_transient_transport', () => {
    expect(isRetryableInfrastructureSubtype('error_transient_transport')).toBe(true);
  });

  it('returns true for error_pi_tool_infrastructure', () => {
    expect(isRetryableInfrastructureSubtype('error_pi_tool_infrastructure')).toBe(true);
  });

  it('returns false for error_max_turns', () => {
    expect(isRetryableInfrastructureSubtype('error_max_turns')).toBe(false);
  });

  it('returns false for error_during_execution', () => {
    expect(isRetryableInfrastructureSubtype('error_during_execution')).toBe(false);
  });

  it('returns false for error_max_budget_usd', () => {
    expect(isRetryableInfrastructureSubtype('error_max_budget_usd')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// withRetry integration
// ---------------------------------------------------------------------------

/**
 * A minimal evaluator-shaped policy that retries on error_max_turns.
 * Uses the `checkHasUnstagedChanges` hook on the Input to control the
 * abort-success short-circuit behavior in tests.
 */

describe('RetryPolicy type surface', () => {
  it('planner continuation input type accepts expected fields', () => {
    const input: PlannerContinuationInput = {
      sideEffects: {
        cwd: '/tmp/cwd',
        planSetName: 'test',
        outputDir: 'eforge/plans',
      },
      plannerOptions: {
        continuationContext: {
          attempt: 1,
          maxContinuations: 1,
          existingPlans: '',
          reason: 'max_turns',
        },
      },
    };
    expect(input.plannerOptions.continuationContext?.reason).toBe('max_turns');
  });

  it('builder continuation input type accepts checkpointed-diff fields', () => {
    const input: BuilderContinuationInput = {
      worktreePath: '/tmp/wt',
      baseBranch: 'main',
      planId: 'plan-01',
      builderOptions: {
        continuationContext: {
          attempt: 1,
          maxContinuations: 3,
          handoffMode: 'checkpointed-diff',
          completedDiff: '',
        },
      },
    };
    expect(input.planId).toBe('plan-01');
    expect(input.builderOptions.continuationContext?.handoffMode).toBe('checkpointed-diff');
  });

  it('builder continuation input type accepts discovery-only fields', () => {
    const input: BuilderContinuationInput = {
      worktreePath: '/tmp/wt',
      baseBranch: 'main',
      planId: 'plan-01',
      builderOptions: {
        continuationContext: {
          attempt: 1,
          maxContinuations: 3,
          handoffMode: 'discovery-only',
          filesInspected: ['src/foo.ts'],
          searches: ['grep: useState in src'],
          commands: ['pnpm type-check'],
          recentMessages: ['Inspected the file'],
          toolResultSnippets: ['[Read] export const x = 1;'],
        },
      },
    };
    const ctx = input.builderOptions.continuationContext;
    expect(ctx?.handoffMode).toBe('discovery-only');
    if (ctx?.handoffMode === 'discovery-only') {
      expect(ctx.filesInspected).toContain('src/foo.ts');
    }
  });

  it('evaluator continuation input type accepts expected fields', () => {
    const input: EvaluatorContinuationInput = {
      worktreePath: '/tmp/wt',
      planId: 'plan-01',
      evaluationSnapshot: undefined,
      evaluatorOptions: {
        evaluatorContinuationContext: {
          attempt: 1,
          maxContinuations: 1,
        },
      },
    };
    expect(input.evaluatorOptions.evaluatorContinuationContext?.attempt).toBe(1);
  });

  it('review-fixer continuation input type accepts expected fields', () => {
    const input: ReviewFixerContinuationInput = {
      cwd: '/tmp/wt',
      planId: 'plan-01',
      reviewFixerOptions: {
        continuationContext: {
          attempt: 1,
          maxContinuations: 2,
          partialDiff: 'diff --git a/foo.ts b/foo.ts\n--- a/foo.ts\n+++ b/foo.ts',
        },
      },
    };
    expect(input.reviewFixerOptions.continuationContext?.attempt).toBe(1);
    expect(input.reviewFixerOptions.continuationContext?.partialDiff).toContain('foo.ts');
  });

  it('review-fixer continuation input type accepts enriched discovery context fields', () => {
    const input: ReviewFixerContinuationInput = {
      cwd: '/tmp/wt',
      planId: 'plan-01',
      reviewFixerOptions: {
        continuationContext: {
          attempt: 1,
          maxContinuations: 2,
          partialDiff: '',
          filesInspected: ['src/foo.ts', 'src/bar.ts'],
          searches: ['grep: useState in src'],
          commands: ['npm run lint'],
          recentMessages: ['Checking the hook'],
          toolResultSnippets: ['[Read] export const x = 1;'],
        },
      },
    };
    const ctx = input.reviewFixerOptions.continuationContext;
    expect(ctx?.filesInspected).toEqual(['src/foo.ts', 'src/bar.ts']);
    expect(ctx?.searches).toEqual(['grep: useState in src']);
    expect(ctx?.commands).toEqual(['npm run lint']);
    expect(ctx?.recentMessages).toEqual(['Checking the hook']);
    expect(ctx?.toolResultSnippets).toEqual(['[Read] export const x = 1;']);
  });
});

// ---------------------------------------------------------------------------
// buildReviewFixerContinuationInput — enriched continuation context in withRetry
// ---------------------------------------------------------------------------
