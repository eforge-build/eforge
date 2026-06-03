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
