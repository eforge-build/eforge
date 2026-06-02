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

const ts = () => new Date().toISOString();

function makeAttemptInfo<Input>(
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
function makeThrowingAgent(
  events: EforgeEvent[],
  terminal: AgentTerminalError | Error,
): (input: unknown) => AsyncGenerator<EforgeEvent, undefined> {
  return async function* () {
    for (const ev of events) yield ev;
    throw terminal;
  };
}

/** Script a single "attempt" that yields events then returns normally. */
function makeSuccessfulAgent(
  events: EforgeEvent[],
): (input: unknown) => AsyncGenerator<EforgeEvent, undefined> {
  return async function* () {
    for (const ev of events) yield ev;
    return;
  };
}

/** Glue together multiple per-attempt generators into a single `runAgent`. */
function makeMultiAttemptAgent(
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

describe('DEFAULT_RETRY_POLICIES — planner policy', () => {
  const planner = DEFAULT_RETRY_POLICIES.planner!;

  it('has retryableSubtypes including error_max_turns', () => {
    expect(planner.retryableSubtypes.has('error_max_turns')).toBe(true);
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
    expect(planner.retryableSubtypes).toEqual(new Set(['error_max_turns']));
  });

  it('retryableSubtypes does NOT include error_pi_tool_infrastructure — pi infra planner retry is governed by shouldRetry', () => {
    expect(planner.retryableSubtypes.has('error_pi_tool_infrastructure')).toBe(false);
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

describe('buildBuilderContinuationInput — clean worktree returns discovery-only retry', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'eforge-builder-retry-'));
    await execAsync('git', ['init'], { cwd: tmpDir });
    await execAsync('git', ['config', 'user.email', 'test@eforge.test'], { cwd: tmpDir });
    await execAsync('git', ['config', 'user.name', 'Eforge Test'], { cwd: tmpDir });
    await writeFile(join(tmpDir, 'README.md'), '# Test\n');
    await execAsync('git', ['add', 'README.md'], { cwd: tmpDir });
    await execAsync('git', ['commit', '-m', 'initial'], { cwd: tmpDir });
    // Ensure the initial branch is named 'main' regardless of system default.
    await execAsync('git', ['branch', '-M', 'main'], { cwd: tmpDir });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('returns discovery-only retry when worktree has no changes', async () => {
    // Record HEAD before the call to verify no checkpoint commit is created.
    const { stdout: headBefore } = await execAsync('git', ['rev-parse', 'HEAD'], { cwd: tmpDir });

    const events: EforgeEvent[] = [
      {
        timestamp: ts(), type: 'agent:tool_use', agentId: 'b1', agent: 'builder',
        tool: 'Read', toolUseId: 'tu-1', input: { file_path: 'src/foo.ts' },
      },
      {
        timestamp: ts(), type: 'agent:tool_result', agentId: 'b1', agent: 'builder',
        tool: 'Read', toolUseId: 'tu-1', output: 'export const x = 1;',
      },
      {
        timestamp: ts(), type: 'agent:message', agentId: 'b1', agent: 'builder',
        content: 'Inspected the file.',
      },
    ];

    const info = makeAttemptInfo<BuilderContinuationInput>({
      prevInput: {
        worktreePath: tmpDir,
        baseBranch: 'main',
        planId: 'plan-01',
        builderOptions: {},
      },
      events,
    });

    const decision = await buildBuilderContinuationInput(info);
    expect(decision.kind).toBe('retry');
    if (decision.kind === 'retry') {
      const ctx = decision.input.builderOptions.continuationContext;
      expect(ctx).toBeDefined();
      expect(ctx?.handoffMode).toBe('discovery-only');
      if (ctx?.handoffMode === 'discovery-only') {
        expect(ctx.filesInspected).toContain('src/foo.ts');
        expect(ctx.recentMessages).toContain('Inspected the file.');
        expect(ctx.toolResultSnippets.some((s) => s.includes('export const x = 1;'))).toBe(true);
      }
    }

    // No checkpoint commit was created — HEAD must be unchanged.
    const { stdout: headAfter } = await execAsync('git', ['rev-parse', 'HEAD'], { cwd: tmpDir });
    expect(headAfter.trim()).toBe(headBefore.trim());

    // Working tree must still be clean.
    const { stdout: statusAfter } = await execAsync('git', ['status', '--porcelain'], { cwd: tmpDir });
    expect(statusAfter.trim()).toBe('');
  });

  it('returns checkpointed-diff retry when worktree has changes, and commits', async () => {
    // Checkout a feature branch so that git diff main...HEAD shows changes after the checkpoint commit.
    await execAsync('git', ['checkout', '-b', 'plan-02-branch'], { cwd: tmpDir });
    // Create a new file in the worktree (unstaged)
    await writeFile(join(tmpDir, 'new-file.ts'), 'export const y = 2;\n');

    const info = makeAttemptInfo<BuilderContinuationInput>({
      prevInput: {
        worktreePath: tmpDir,
        baseBranch: 'main',
        planId: 'plan-02',
        builderOptions: {},
      },
    });

    const decision = await buildBuilderContinuationInput(info);
    expect(decision.kind).toBe('retry');
    if (decision.kind === 'retry') {
      const ctx = decision.input.builderOptions.continuationContext;
      expect(ctx?.handoffMode).toBe('checkpointed-diff');
      if (ctx?.handoffMode === 'checkpointed-diff') {
        expect(ctx.completedDiff).not.toBe('[Unable to generate diff]');
        expect(ctx.completedDiff).toContain('new-file.ts');
        expect(ctx.completedDiff).toContain('export const y = 2;');
      }
    }

    // A checkpoint commit was created with the expected subject and eforge attribution trailer
    const { stdout: fullMsg } = await execAsync('git', ['log', '-1', '--format=%B'], { cwd: tmpDir });
    expect(fullMsg).toContain('wip(plan-02): continuation checkpoint');
    expect(fullMsg).toContain('Co-Authored-By: forged-by-eforge');

    // Working tree must be clean after the checkpoint commit
    const { stdout: statusAfterCheckpoint } = await execAsync('git', ['status', '--porcelain'], { cwd: tmpDir });
    expect(statusAfterCheckpoint.trim()).toBe('');
  });
});

// ---------------------------------------------------------------------------
// extractBuilderDiscoveryContext — unit tests
// ---------------------------------------------------------------------------

describe('extractBuilderDiscoveryContext', () => {
  it('extracts file paths from Read tool_use events filtered to builder agent', () => {
    const events: EforgeEvent[] = [
      {
        timestamp: ts(), type: 'agent:tool_use', agentId: 'b1', agent: 'builder',
        tool: 'Read', toolUseId: 'tu-1', input: { file_path: 'src/engine.ts' },
      },
      {
        // Different agent — should be excluded
        timestamp: ts(), type: 'agent:tool_use', agentId: 'r1', agent: 'reviewer',
        tool: 'Read', toolUseId: 'tu-2', input: { file_path: 'src/other.ts' },
      },
    ];
    const ctx = extractBuilderDiscoveryContext(events);
    expect(ctx.filesInspected).toContain('src/engine.ts');
    expect(ctx.filesInspected).not.toContain('src/other.ts');
  });

  it('extracts searches and commands from builder events', () => {
    const events: EforgeEvent[] = [
      {
        timestamp: ts(), type: 'agent:tool_use', agentId: 'b1', agent: 'builder',
        tool: 'Grep', toolUseId: 'tu-1', input: { pattern: 'withRetry', path: 'packages' },
      },
      {
        timestamp: ts(), type: 'agent:tool_use', agentId: 'b1', agent: 'builder',
        tool: 'Bash', toolUseId: 'tu-2', input: { command: 'pnpm type-check' },
      },
    ];
    const ctx = extractBuilderDiscoveryContext(events);
    expect(ctx.searches.some((s) => s.includes('withRetry'))).toBe(true);
    expect(ctx.commands).toContain('pnpm type-check');
  });

  it('caps files, searches, commands, messages, and tool-result snippets at their configured maximums', () => {
    const events: EforgeEvent[] = [];

    // 25 Read events (> MAX_FILES_INSPECTED=20)
    for (let i = 0; i < 25; i++) {
      events.push({
        timestamp: ts(), type: 'agent:tool_use', agentId: 'b1', agent: 'builder',
        tool: 'Read', toolUseId: `tu-r-${i}`, input: { file_path: `src/file-${i}.ts` },
      });
    }

    // 25 Grep events with distinct patterns (> MAX_SEARCHES=20)
    for (let i = 0; i < 25; i++) {
      events.push({
        timestamp: ts(), type: 'agent:tool_use', agentId: 'b1', agent: 'builder',
        tool: 'Grep', toolUseId: `tu-g-${i}`, input: { pattern: `unique-pattern-${i}` },
      });
    }

    // 20 Bash events with distinct commands (> MAX_COMMANDS=15)
    for (let i = 0; i < 20; i++) {
      events.push({
        timestamp: ts(), type: 'agent:tool_use', agentId: 'b1', agent: 'builder',
        tool: 'Bash', toolUseId: `tu-b-${i}`, input: { command: `pnpm cmd-${i}` },
      });
    }

    // 10 agent:message events (> MAX_RECENT_MESSAGES=5)
    for (let i = 0; i < 10; i++) {
      events.push({
        timestamp: ts(), type: 'agent:message', agentId: 'b1', agent: 'builder',
        content: `Message number ${i}`,
      });
    }

    // 12 Read+result pairs to exceed MAX_TOOL_RESULT_SNIPPETS=8
    for (let i = 0; i < 12; i++) {
      const toolUseId = `tu-snap-${i}`;
      events.push({
        timestamp: ts(), type: 'agent:tool_use', agentId: 'b1', agent: 'builder',
        tool: 'Read', toolUseId, input: { file_path: `src/snap-${i}.ts` },
      });
      events.push({
        timestamp: ts(), type: 'agent:tool_result', agentId: 'b1', agent: 'builder',
        tool: 'Read', toolUseId, output: `export const snap${i} = ${i};`,
      });
    }

    const ctx = extractBuilderDiscoveryContext(events);
    expect(ctx.filesInspected.length).toBeLessThanOrEqual(20);
    expect(ctx.searches.length).toBeLessThanOrEqual(20);
    expect(ctx.commands.length).toBeLessThanOrEqual(15);
    expect(ctx.recentMessages.length).toBeLessThanOrEqual(5);
    expect(ctx.toolResultSnippets.length).toBeLessThanOrEqual(8);
  });

  it('truncates long search summaries, messages, and tool-result snippets', () => {
    const longPattern = 'a'.repeat(400); // > MAX_SEARCH_SUMMARY_LENGTH=300
    const longMessage = 'b'.repeat(2500); // > MAX_RECENT_MESSAGE_LENGTH=2000
    const longOutput = 'c'.repeat(600);   // > TOOL_RESULT_SNIPPET_LENGTH=500

    const events: EforgeEvent[] = [
      {
        timestamp: ts(), type: 'agent:tool_use', agentId: 'b1', agent: 'builder',
        tool: 'Grep', toolUseId: 'tu-long-1', input: { pattern: longPattern },
      },
      {
        timestamp: ts(), type: 'agent:tool_result', agentId: 'b1', agent: 'builder',
        tool: 'Grep', toolUseId: 'tu-long-1', output: longOutput,
      },
      {
        timestamp: ts(), type: 'agent:message', agentId: 'b1', agent: 'builder',
        content: longMessage,
      },
    ];

    const ctx = extractBuilderDiscoveryContext(events);

    // Search summary truncated at 300 chars + '...'
    expect(ctx.searches.length).toBeGreaterThan(0);
    expect(ctx.searches[0].length).toBeLessThanOrEqual(303 + 'grep: '.length);
    expect(ctx.searches[0]).toContain('...');

    // Message truncated at 2000 chars + '...'
    expect(ctx.recentMessages.length).toBeGreaterThan(0);
    expect(ctx.recentMessages[0].length).toBeLessThanOrEqual(2003);
    expect(ctx.recentMessages[0]).toContain('...');

    // Tool result snippet truncated at 500 chars + '...' + '[Grep] ' prefix
    expect(ctx.toolResultSnippets.length).toBeGreaterThan(0);
    const snippet = ctx.toolResultSnippets[0];
    expect(snippet.length).toBeLessThanOrEqual('[Grep] '.length + 500 + 3);
    expect(snippet).toContain('...');
  });
});

// ---------------------------------------------------------------------------
// withRetry + builder policy — discovery-only continuation integration
// ---------------------------------------------------------------------------

describe('withRetry + builder policy — clean-worktree discovery-only continuation', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), 'eforge-builder-withr-'));
    await execAsync('git', ['init'], { cwd: tmpDir });
    await execAsync('git', ['config', 'user.email', 'test@eforge.test'], { cwd: tmpDir });
    await execAsync('git', ['config', 'user.name', 'Eforge Test'], { cwd: tmpDir });
    await writeFile(join(tmpDir, 'README.md'), '# Test\n');
    await execAsync('git', ['add', 'README.md'], { cwd: tmpDir });
    await execAsync('git', ['commit', '-m', 'initial'], { cwd: tmpDir });
    // Ensure the initial branch is named 'main' regardless of system default.
    await execAsync('git', ['branch', '-M', 'main'], { cwd: tmpDir });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it('emits agent:retry and plan:build:implement:continuation for clean-worktree retry, second input has discovery-only context', async () => {
    const toolEvents: EforgeEvent[] = [
      {
        timestamp: ts(), type: 'agent:tool_use', agentId: 'b1', agent: 'builder',
        tool: 'Read', toolUseId: 'tu-1', input: { file_path: 'src/foo.ts' },
      },
      {
        timestamp: ts(), type: 'agent:tool_result', agentId: 'b1', agent: 'builder',
        tool: 'Read', toolUseId: 'tu-1', output: 'export const foo = 1;',
      },
      {
        timestamp: ts(), type: 'agent:tool_use', agentId: 'b1', agent: 'builder',
        tool: 'Grep', toolUseId: 'tu-2', input: { pattern: 'fooSearch', path: 'src' },
      },
      {
        timestamp: ts(), type: 'agent:tool_use', agentId: 'b1', agent: 'builder',
        tool: 'Bash', toolUseId: 'tu-3', input: { command: 'pnpm type-check' },
      },
      {
        timestamp: ts(), type: 'agent:message', agentId: 'b1', agent: 'builder',
        content: 'Checking the implementation.',
      },
    ];

    let secondInput: BuilderContinuationInput | undefined;

    const builderPolicy: RetryPolicy<BuilderContinuationInput> = {
      ...(DEFAULT_RETRY_POLICIES.builder as RetryPolicy<BuilderContinuationInput>),
      maxAttempts: 2,
    };

    const attempts = [
      async function* (_input: BuilderContinuationInput): AsyncGenerator<EforgeEvent, undefined> {
        for (const ev of toolEvents) yield ev;
        yield {
          timestamp: ts(), type: 'plan:build:failed', planId: 'plan-01',
          error: 'Reached maximum number of turns', terminalSubtype: 'error_max_turns',
        };
      },
      async function* (input: BuilderContinuationInput): AsyncGenerator<EforgeEvent, undefined> {
        secondInput = input;
        // Emit a distinct event first so we can assert ordering relative to retry/continuation events.
        yield { timestamp: ts(), type: 'plan:build:implement:complete', planId: 'plan-01' };
      },
    ];
    let attemptIdx = 0;
    const runBuilder = (input: BuilderContinuationInput) => attempts[attemptIdx++](input);

    const initial: BuilderContinuationInput = {
      worktreePath: tmpDir,
      baseBranch: 'main',
      planId: 'plan-01',
      builderOptions: {},
    };

    const out: EforgeEvent[] = [];
    for await (const ev of withRetry(runBuilder, builderPolicy, initial)) {
      out.push(ev);
    }

    // Exactly one agent:retry emitted before the second attempt
    const retries = out.filter((e) => e.type === 'agent:retry') as Array<Extract<EforgeEvent, { type: 'agent:retry' }>>;
    expect(retries).toHaveLength(1);
    expect(retries[0].agent).toBe('builder');
    expect(retries[0].attempt).toBe(1);
    expect(retries[0].subtype).toBe('error_max_turns');

    // plan:build:implement:continuation emitted
    const continuations = out.filter((e) => e.type === 'plan:build:implement:continuation');
    expect(continuations).toHaveLength(1);

    // agent:retry and plan:build:implement:continuation must appear BEFORE the first
    // event of the second attempt (plan:build:implement:complete).
    const retryIdx = out.findIndex((e) => e.type === 'agent:retry');
    const continuationIdx = out.findIndex((e) => e.type === 'plan:build:implement:continuation');
    const secondAttemptEventIdx = out.findIndex((e) => e.type === 'plan:build:implement:complete');
    expect(retryIdx).toBeGreaterThanOrEqual(0);
    expect(continuationIdx).toBeGreaterThanOrEqual(0);
    expect(secondAttemptEventIdx).toBeGreaterThanOrEqual(0);
    expect(retryIdx).toBeLessThan(secondAttemptEventIdx);
    expect(continuationIdx).toBeLessThan(secondAttemptEventIdx);

    // Second input has discovery-only context with searches and commands populated.
    expect(secondInput).toBeDefined();
    const ctx = secondInput?.builderOptions.continuationContext;
    expect(ctx?.handoffMode).toBe('discovery-only');
    if (ctx?.handoffMode === 'discovery-only') {
      expect(ctx.filesInspected).toContain('src/foo.ts');
      expect(ctx.recentMessages).toContain('Checking the implementation.');
      expect(ctx.toolResultSnippets.some((s) => s.includes('foo = 1'))).toBe(true);
      expect(ctx.searches.some((s) => s.includes('fooSearch'))).toBe(true);
      expect(ctx.commands).toContain('pnpm type-check');
    }
  });

  it('when all single-builder attempts fail with error_max_turns, final plan:build:failed has terminalSubtype === error_max_turns', async () => {
    const builderPolicy: RetryPolicy<BuilderContinuationInput> = {
      ...(DEFAULT_RETRY_POLICIES.builder as RetryPolicy<BuilderContinuationInput>),
      maxAttempts: 2,
    };

    let callCount = 0;
    const runBuilder = async function* (_input: BuilderContinuationInput): AsyncGenerator<EforgeEvent, undefined> {
      callCount++;
      yield {
        timestamp: ts(), type: 'plan:build:failed', planId: 'plan-01',
        error: 'Reached maximum number of turns', terminalSubtype: 'error_max_turns',
      };
    };

    const initial: BuilderContinuationInput = {
      worktreePath: tmpDir,
      baseBranch: 'main',
      planId: 'plan-01',
      builderOptions: {},
    };

    const out: EforgeEvent[] = [];
    for await (const ev of withRetry(runBuilder, builderPolicy, initial)) {
      out.push(ev);
    }

    // Both attempts ran (initial + one retry)
    expect(callCount).toBe(2);

    // Exactly one agent:retry and one plan:build:implement:continuation were emitted before the final failure
    const retryEvents = out.filter((e) => e.type === 'agent:retry');
    expect(retryEvents).toHaveLength(1);
    const continuationEvents = out.filter((e) => e.type === 'plan:build:implement:continuation');
    expect(continuationEvents).toHaveLength(1);

    // The retry and continuation events appear before the final plan:build:failed
    const finalFailureIdx = out.findIndex((e) => e.type === 'plan:build:failed');
    expect(finalFailureIdx).toBeGreaterThan(-1);
    const retryIdx = out.findIndex((e) => e.type === 'agent:retry');
    const continuationIdx = out.findIndex((e) => e.type === 'plan:build:implement:continuation');
    expect(retryIdx).toBeLessThan(finalFailureIdx);
    expect(continuationIdx).toBeLessThan(finalFailureIdx);

    // Final held-back plan:build:failed surfaces after all attempts exhausted
    const failures = out.filter(
      (e) => e.type === 'plan:build:failed',
    ) as Array<Extract<EforgeEvent, { type: 'plan:build:failed' }>>;
    expect(failures).toHaveLength(1);
    expect(failures[0].terminalSubtype).toBe('error_max_turns');
  });
});

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

describe('DEFAULT_RETRY_POLICIES — pipeline-composer policy', () => {
  const composer = DEFAULT_RETRY_POLICIES['pipeline-composer']!;

  it('has maxAttempts = 2', () => {
    expect(composer.maxAttempts).toBe(2);
  });

  it('retryableSubtypes contains error_transient_transport and error_pi_tool_infrastructure', () => {
    expect(composer.retryableSubtypes).toEqual(new Set(['error_transient_transport', 'error_pi_tool_infrastructure']));
  });

  it('does not include error_max_turns (composer uses its own internal retry for parse failures)', () => {
    expect(composer.retryableSubtypes.has('error_max_turns')).toBe(false);
  });

  it('has a terminalSuccessWhen hook', () => {
    expect(composer.terminalSuccessWhen).toBeDefined();
  });

  it('terminalSuccessWhen returns true when planning:pipeline was emitted + retryable subtype', () => {
    const events: EforgeEvent[] = [
      { timestamp: ts(), type: 'planning:pipeline', scope: 'errand', compile: ['planner'], defaultBuild: ['implement'], defaultReview: { strategy: 'single', perspectives: ['code'], maxRounds: 1, evaluatorStrictness: 'lenient' }, rationale: 'test' },
    ];
    const info = makeAttemptInfo({
      prevInput: {} as unknown,
      subtype: 'error_pi_tool_infrastructure',
      events,
      error: new Error('Pi tool-call infrastructure failure: something'),
    });
    expect(composer.terminalSuccessWhen!(info as RetryAttemptInfo<unknown>)).toBe(true);
  });

  it('terminalSuccessWhen returns false when planning:pipeline was NOT emitted', () => {
    const info = makeAttemptInfo({
      prevInput: {} as unknown,
      subtype: 'error_transient_transport',
      events: [],
      error: new Error('Backend error: WebSocket closed 1000'),
    });
    expect(composer.terminalSuccessWhen!(info as RetryAttemptInfo<unknown>)).toBe(false);
  });

  it('label is "pipeline-composer-infrastructure-retry"', () => {
    expect(composer.label).toBe('pipeline-composer-infrastructure-retry');
  });
});

describe('getPolicy — unregistered roles default to no-retry', () => {
  // Unregistered roles default to maxAttempts: 1 (no retries) because they lack
  // safe continuation/checkpoint contracts. A retry policy is only safe when the
  // agent can resume meaningful work from a well-defined intermediate state. Roles
  // like 'reviewer' and 'merge-conflict-resolver' have no such checkpointing
  // semantics, so a retry would duplicate side effects or produce inconsistent
  // state. They must be explicitly registered in DEFAULT_RETRY_POLICIES before
  // any retry behavior is allowed.
  // Note: 'pipeline-composer' has an explicit policy registered (infrastructure retry).
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
function makeEvaluatorPolicy(override?: Partial<RetryPolicy<EvaluatorContinuationInput>>): RetryPolicy<EvaluatorContinuationInput> {
  const base = DEFAULT_RETRY_POLICIES.evaluator as RetryPolicy<EvaluatorContinuationInput>;
  return {
    ...base,
    maxAttempts: 2,
    ...override,
  };
}

describe('withRetry — retry-then-success', () => {
  it('yields all first-attempt events, emits agent:retry, yields all second-attempt events, and returns the final result', async () => {
    const firstEvents: EforgeEvent[] = [
      { timestamp: ts(), type: 'plan:build:evaluate:start', planId: 'p1' },
    ];
    const secondEvents: EforgeEvent[] = [
      { timestamp: ts(), type: 'plan:build:evaluate:complete', planId: 'p1', accepted: 1, rejected: 0 },
    ];

    const agent = makeMultiAttemptAgent([
      makeThrowingAgent(firstEvents, new AgentTerminalError('error_max_turns', 'turns exhausted')),
      makeSuccessfulAgent(secondEvents),
    ]);

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
    for await (const ev of withRetry(agent, policy, initial)) {
      out.push(ev);
    }

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
    // agent:retry fired with the stream-detected subtype.
    const retry = out.find((e) => e.type === 'agent:retry');
    expect(retry).toBeDefined();
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

const makePlanFile = (id = 'plan-01') => ({
  id,
  name: 'Test Plan',
  dependsOn: [],
  branch: 'test/main',
  body: '# Test\n\nImplement something.',
  filePath: '/tmp/test-plan.md',
});

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

const makePlanEvaluateInput = (backend: StubHarness, input: EvaluatorContinuationInput) => ({
  harness: backend,
  planSetName: 'test-set',
  sourceContent: '# Source\n\nSome PRD.',
  cwd: input.worktreePath,
  continuationContext: input.evaluatorOptions.evaluatorContinuationContext,
});

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

describe('buildEvaluatorContinuationInput', () => {
  it('preserves evaluation snapshot and evaluator options across continuation attempts', async () => {
    const snapshot = { cwd: '/tmp/repo', capturedAt: 'now', baseHead: 'base', stagedPatch: '', candidatePatch: '', files: [] } as EvaluationSnapshot;
    const decision = await buildEvaluatorContinuationInput(makeAttemptInfo<EvaluatorContinuationInput>({
      prevInput: {
        worktreePath: '/tmp/wt',
        planId: 'plan-01',
        evaluationSnapshot: snapshot,
        evaluatorOptions: { extra: 'keep-me', allowedPathPrefix: 'eforge/plans/demo' },
        checkHasUnstagedChanges: async () => true,
      },
    }));

    expect(decision.kind).toBe('retry');
    if (decision.kind === 'retry') {
      expect(decision.input.evaluationSnapshot).toBe(snapshot);
      expect(decision.input.evaluatorOptions.extra).toBe('keep-me');
      expect(decision.input.evaluatorOptions.allowedPathPrefix).toBe('eforge/plans/demo');
      expect(decision.input.evaluatorOptions.evaluatorContinuationContext).toEqual({ attempt: 1, maxContinuations: 1 });
    }
  });
});

// ---------------------------------------------------------------------------
// Type-surface smoke tests (ensures continuation input shapes compile)
// ---------------------------------------------------------------------------

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

describe('buildReviewFixerContinuationInput — enriched context preserved through withRetry policy', () => {
  it('review-fixer policy preserves discovery fields in continuationContext after buildContinuationInput', async () => {
    const policy = DEFAULT_RETRY_POLICIES['review-fixer'];
    expect(policy).toBeDefined();

    const events: EforgeEvent[] = [
      {
        timestamp: ts(), type: 'agent:tool_use', agentId: 'a1', agent: 'review-fixer' as const,
        tool: 'Read', toolUseId: 'tu-1', input: { file_path: 'src/component.ts' },
      },
      {
        timestamp: ts(), type: 'agent:tool_result', agentId: 'a1', agent: 'review-fixer' as const,
        tool: 'Read', toolUseId: 'tu-1', output: 'export const Component = () => null;',
      },
      {
        timestamp: ts(), type: 'agent:message', agentId: 'a1', agent: 'review-fixer' as const,
        content: 'Found the component.',
      },
    ];

    const info = makeAttemptInfo<ReviewFixerContinuationInput>({
      attempt: 1,
      maxAttempts: 3,
      subtype: 'error_max_turns',
      events,
      prevInput: {
        cwd: '/tmp/nonexistent-for-test',
        planId: 'plan-enriched',
        reviewFixerOptions: {},
      }
    });

    const decision = await buildReviewFixerContinuationInput(info);
    expect(decision.kind).toBe('retry');
    if (decision.kind === 'retry') {
      const ctx = decision.input.reviewFixerOptions.continuationContext;
      expect(ctx).toBeDefined();
      expect(ctx!.attempt).toBe(1);
      expect(ctx!.maxContinuations).toBe(2);
      // Discovery context is populated from events
      expect(ctx!.filesInspected).toContain('src/component.ts');
      expect(ctx!.recentMessages).toContain('Found the component.');
      expect(ctx!.toolResultSnippets?.some((s) => s.includes('Component'))).toBe(true);
    }
  });
});
