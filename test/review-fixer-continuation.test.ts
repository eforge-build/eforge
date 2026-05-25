/**
 * Focused integration and unit tests for review-fixer retry behavior.
 *
 * Covers:
 * - runReviewFixer rethrows error_max_turns; swallows generic errors.
 * - maxTurns defaults to 80; custom values pass through to harness.
 * - Continuation context is rendered in the prompt.
 * - buildReviewFixerContinuationInput reads git diff without mutating git state.
 * - withRetry emits agent:retry and plan:build:review:fix:continuation between attempts.
 * - No plan:build:review:fix:complete is emitted when all retries are exhausted on max-turns.
 */

import { describe, it, expect } from 'vitest';
import { execFile } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { AgentTerminalError } from '@eforge-build/engine/harness';
import { runReviewFixer } from '@eforge-build/engine/agents/review-fixer';
import {
  withRetry,
  DEFAULT_RETRY_POLICIES,
  buildReviewFixerContinuationInput,
  type RetryPolicy,
  type ReviewFixerContinuationInput,
  type RetryAttemptInfo,
} from '@eforge-build/engine/retry';
import type { EforgeEvent, ReviewIssue } from '@eforge-build/engine/events';
import { StubHarness } from './stub-harness.js';
import { collectEvents, findEvent, filterEvents } from './test-events.js';
import { useTempDir } from './test-tmpdir.js';

const exec = promisify(execFile);

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/** Create a real git repo with an initial commit in `dir`. */
async function createGitRepo(dir: string): Promise<void> {
  await exec('git', ['init'], { cwd: dir });
  await exec('git', ['config', 'user.email', 'test@eforge.test'], { cwd: dir });
  await exec('git', ['config', 'user.name', 'Eforge Test'], { cwd: dir });
  await writeFile(join(dir, 'README.md'), '# Test\n');
  await exec('git', ['add', '.'], { cwd: dir });
  await exec('git', ['commit', '-m', 'initial'], { cwd: dir });
}

/** Capture a snapshot of the git state at `dir` for before/after comparison. */
async function captureGitState(dir: string): Promise<{ status: string; log: string }> {
  const [status, log] = await Promise.all([
    exec('git', ['status', '--porcelain'], { cwd: dir }).then((r) => r.stdout).catch(() => ''),
    exec('git', ['log', '--oneline'], { cwd: dir }).then((r) => r.stdout).catch(() => ''),
  ]);
  return { status, log };
}

const SAMPLE_ISSUES: ReviewIssue[] = [
  { severity: 'warning', category: 'types', file: 'src/foo.ts', description: 'Unsafe cast' },
];

// ---------------------------------------------------------------------------
// runReviewFixer — error classification
// ---------------------------------------------------------------------------

describe('runReviewFixer — error_max_turns rethrow', () => {
  it('rethrows AgentTerminalError with subtype error_max_turns', async () => {
    const maxTurnsError = new AgentTerminalError('error_max_turns', 'Turn limit reached');
    const backend = new StubHarness([{ error: maxTurnsError }]);

    let thrown: unknown;
    const events: EforgeEvent[] = [];
    try {
      for await (const event of runReviewFixer({
        harness: backend,
        planId: 'plan-01',
        cwd: '/tmp',
        issues: SAMPLE_ISSUES,
      })) {
        events.push(event);
      }
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(AgentTerminalError);
    expect((thrown as AgentTerminalError).subtype).toBe('error_max_turns');
    // Start emitted; complete NOT emitted (threw before reaching it)
    expect(findEvent(events, 'plan:build:review:fix:start')).toBeDefined();
    expect(findEvent(events, 'plan:build:review:fix:complete')).toBeUndefined();
  });

  it('swallows generic errors and still emits complete', async () => {
    const backend = new StubHarness([{ error: new Error('Backend failed') }]);

    const events = await collectEvents(
      runReviewFixer({ harness: backend, planId: 'plan-01', cwd: '/tmp', issues: SAMPLE_ISSUES }),
    );

    expect(findEvent(events, 'plan:build:review:fix:start')).toBeDefined();
    expect(findEvent(events, 'plan:build:review:fix:complete')).toBeDefined();
  });

  it('rethrows AbortError immediately', async () => {
    const abortError = new Error('The operation was aborted');
    abortError.name = 'AbortError';
    const backend = new StubHarness([{ error: abortError }]);

    let thrown: Error | undefined;
    const events: EforgeEvent[] = [];
    try {
      for await (const event of runReviewFixer({
        harness: backend,
        planId: 'plan-01',
        cwd: '/tmp',
        issues: SAMPLE_ISSUES,
      })) {
        events.push(event);
      }
    } catch (err) {
      thrown = err as Error;
    }

    expect(thrown).toBeDefined();
    expect(thrown!.name).toBe('AbortError');
    expect(findEvent(events, 'plan:build:review:fix:complete')).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// runReviewFixer — maxTurns defaults
// ---------------------------------------------------------------------------

describe('runReviewFixer — maxTurns budget', () => {
  it('defaults to 80 turns when maxTurns is not specified', async () => {
    const backend = new StubHarness([{ text: 'Fixed.' }]);

    await collectEvents(
      runReviewFixer({ harness: backend, planId: 'plan-01', cwd: '/tmp', issues: SAMPLE_ISSUES }),
    );

    expect(backend.calls[0].maxTurns).toBe(80);
  });

  it('passes custom maxTurns to harness', async () => {
    const backend = new StubHarness([{ text: 'Fixed.' }]);

    await collectEvents(
      runReviewFixer({ harness: backend, planId: 'plan-01', cwd: '/tmp', issues: SAMPLE_ISSUES, maxTurns: 42 }),
    );

    expect(backend.calls[0].maxTurns).toBe(42);
  });
});

// ---------------------------------------------------------------------------
// runReviewFixer — continuation context in prompt
// ---------------------------------------------------------------------------

describe('runReviewFixer — continuation context rendering', () => {
  it('includes continuation header when continuationContext is provided', async () => {
    const backend = new StubHarness([{ text: 'Fixed.' }]);

    await collectEvents(
      runReviewFixer({
        harness: backend,
        planId: 'plan-01',
        cwd: '/tmp',
        issues: SAMPLE_ISSUES,
        continuationContext: {
          attempt: 2,
          maxContinuations: 2,
          partialDiff: '--- a/src/foo.ts\n+++ b/src/foo.ts\n@@ -1 +1 @@\n-old\n+new',
        },
      }),
    );

    expect(backend.prompts[0]).toContain('Continuation (attempt 2 of 2)');
    expect(backend.prompts[0]).toContain('previous attempt ran out of turns');
    expect(backend.prompts[0]).toContain('--- a/src/foo.ts');
  });

  it('shows no-changes message when partialDiff is empty', async () => {
    const backend = new StubHarness([{ text: 'Done.' }]);

    await collectEvents(
      runReviewFixer({
        harness: backend,
        planId: 'plan-01',
        cwd: '/tmp',
        issues: SAMPLE_ISSUES,
        continuationContext: {
          attempt: 2,
          maxContinuations: 2,
          partialDiff: '',
        },
      }),
    );

    expect(backend.prompts[0]).toContain('no changes were made in the previous attempt');
  });

  it('prompt contains no continuation section when continuationContext is absent', async () => {
    const backend = new StubHarness([{ text: 'Done.' }]);

    await collectEvents(
      runReviewFixer({ harness: backend, planId: 'plan-01', cwd: '/tmp', issues: SAMPLE_ISSUES }),
    );

    expect(backend.prompts[0]).not.toContain('Continuation (attempt');
  });
});

// ---------------------------------------------------------------------------
// buildReviewFixerContinuationInput — git safety
// ---------------------------------------------------------------------------

describe('buildReviewFixerContinuationInput — git state safety', () => {
  const makeTempDir = useTempDir('eforge-rfx-git-');

  it('does NOT stage, commit, reset, or stash when the working tree has unstaged changes', async () => {
    const dir = makeTempDir();
    await createGitRepo(dir);

    // Write a new untracked file — represents partial review-fixer work
    await writeFile(join(dir, 'new-fix.ts'), 'export const fixed = true;\n');

    const before = await captureGitState(dir);

    const info: RetryAttemptInfo<ReviewFixerContinuationInput> = {
      attempt: 1,
      maxAttempts: 3,
      subtype: 'error_max_turns',
      events: [],
      prevInput: { cwd: dir, planId: 'plan-01', reviewFixerOptions: {} },
    };

    await buildReviewFixerContinuationInput(info);

    const after = await captureGitState(dir);

    // Status unchanged — the untracked file is still untracked, not staged
    expect(after.status).toBe(before.status);
    // No new commits
    expect(after.log).toBe(before.log);
  });

  it('does NOT mutate git state when the working tree is clean', async () => {
    const dir = makeTempDir();
    await createGitRepo(dir);

    const before = await captureGitState(dir);

    const info: RetryAttemptInfo<ReviewFixerContinuationInput> = {
      attempt: 1,
      maxAttempts: 3,
      subtype: 'error_max_turns',
      events: [],
      prevInput: { cwd: dir, planId: 'plan-01', reviewFixerOptions: {} },
    };

    const decision = await buildReviewFixerContinuationInput(info);

    const after = await captureGitState(dir);

    expect(after.status).toBe(before.status);
    expect(after.log).toBe(before.log);
    // Still returns a retry decision — no changes is not a hard failure
    expect(decision.kind).toBe('retry');
  });

  it('returns retry with empty partialDiff when working tree is clean', async () => {
    const dir = makeTempDir();
    await createGitRepo(dir);

    const info: RetryAttemptInfo<ReviewFixerContinuationInput> = {
      attempt: 1,
      maxAttempts: 3,
      subtype: 'error_max_turns',
      events: [],
      prevInput: { cwd: dir, planId: 'plan-01', reviewFixerOptions: {} },
    };

    const decision = await buildReviewFixerContinuationInput(info);
    expect(decision.kind).toBe('retry');
    if (decision.kind === 'retry') {
      const ctx = decision.input.reviewFixerOptions.continuationContext;
      expect(ctx).toBeDefined();
      expect(ctx!.partialDiff).toBe('');
    }
  });

  it('captures partial diff of unstaged working-tree changes', async () => {
    const dir = makeTempDir();
    await createGitRepo(dir);

    // Commit an initial file, then modify it without staging
    await writeFile(join(dir, 'component.ts'), 'export const original = 1;\n');
    await exec('git', ['add', 'component.ts'], { cwd: dir });
    await exec('git', ['commit', '-m', 'add component'], { cwd: dir });
    await writeFile(join(dir, 'component.ts'), 'export const modified = 2;\n');

    const info: RetryAttemptInfo<ReviewFixerContinuationInput> = {
      attempt: 1,
      maxAttempts: 3,
      subtype: 'error_max_turns',
      events: [],
      prevInput: { cwd: dir, planId: 'plan-01', reviewFixerOptions: {} },
    };

    const decision = await buildReviewFixerContinuationInput(info);
    expect(decision.kind).toBe('retry');
    if (decision.kind === 'retry') {
      const ctx = decision.input.reviewFixerOptions.continuationContext;
      expect(ctx).toBeDefined();
      expect(ctx!.partialDiff).toContain('modified');
      expect(ctx!.attempt).toBe(1);
      expect(ctx!.maxContinuations).toBe(2); // maxAttempts(3) - 1
    }
  });

  it('splices continuationContext into next reviewFixerOptions preserving existing options', async () => {
    const dir = makeTempDir();
    await createGitRepo(dir);

    const info: RetryAttemptInfo<ReviewFixerContinuationInput> = {
      attempt: 1,
      maxAttempts: 3,
      subtype: 'error_max_turns',
      events: [],
      prevInput: {
        cwd: dir,
        planId: 'plan-01',
        reviewFixerOptions: { someExistingOption: 'value' },
      },
    };

    const decision = await buildReviewFixerContinuationInput(info);
    expect(decision.kind).toBe('retry');
    if (decision.kind === 'retry') {
      expect(decision.input.cwd).toBe(dir);
      expect(decision.input.planId).toBe('plan-01');
      expect((decision.input.reviewFixerOptions as Record<string, unknown>).someExistingOption).toBe('value');
      expect(decision.input.reviewFixerOptions.continuationContext).toBeDefined();
    }
  });
});

// ---------------------------------------------------------------------------
// withRetry — review-fixer policy integration
// ---------------------------------------------------------------------------

describe('withRetry — review-fixer policy integration', () => {
  it('emits agent:retry and plan:build:review:fix:continuation between attempts', async () => {
    const maxTurnsError = new AgentTerminalError('error_max_turns', 'Exceeded turn limit');
    // First attempt fails with max-turns; second attempt succeeds
    const backend = new StubHarness([{ error: maxTurnsError }, { text: 'Fixed.' }]);

    const policy = DEFAULT_RETRY_POLICIES['review-fixer'] as RetryPolicy<ReviewFixerContinuationInput>;
    const initialInput: ReviewFixerContinuationInput = {
      cwd: '/tmp',
      planId: 'plan-42',
      reviewFixerOptions: {},
    };

    const events = await collectEvents(
      withRetry(
        (input) =>
          runReviewFixer({
            harness: backend,
            planId: input.planId,
            cwd: input.cwd,
            issues: SAMPLE_ISSUES,
            ...(input.reviewFixerOptions.continuationContext !== undefined
              ? { continuationContext: input.reviewFixerOptions.continuationContext }
              : {}),
          }),
        policy,
        initialInput,
      ),
    );

    const retryEvent = findEvent(events, 'agent:retry');
    expect(retryEvent).toBeDefined();
    expect(retryEvent!.agent).toBe('review-fixer');
    expect(retryEvent!.attempt).toBe(1);
    expect(retryEvent!.label).toBe('review-fixer-continuation');
    expect(retryEvent!.planId).toBe('plan-42');

    const continuationEvent = findEvent(events, 'plan:build:review:fix:continuation');
    expect(continuationEvent).toBeDefined();
    expect(continuationEvent!.planId).toBe('plan-42');
    expect(continuationEvent!.attempt).toBe(1);
    expect(continuationEvent!.maxContinuations).toBe(2); // maxAttempts(3) - 1
  });

  it('second attempt prompt contains continuation context from first failure', async () => {
    const makeTempDir = useTempDir('eforge-rfx-prompt-');
    const dir = makeTempDir();
    await createGitRepo(dir);

    // Make an unstaged change so the partial diff is non-empty
    await writeFile(join(dir, 'source.ts'), 'export const a = 1;\n');
    await exec('git', ['add', 'source.ts'], { cwd: dir });
    await exec('git', ['commit', '-m', 'add source'], { cwd: dir });
    await writeFile(join(dir, 'source.ts'), 'export const a = 2; // fixed\n');

    const maxTurnsError = new AgentTerminalError('error_max_turns', 'Turn limit reached');
    const backend = new StubHarness([{ error: maxTurnsError }, { text: 'Completed.' }]);

    const policy = DEFAULT_RETRY_POLICIES['review-fixer'] as RetryPolicy<ReviewFixerContinuationInput>;
    const initialInput: ReviewFixerContinuationInput = {
      cwd: dir,
      planId: 'plan-prompt-test',
      reviewFixerOptions: {},
    };

    await collectEvents(
      withRetry(
        (input) =>
          runReviewFixer({
            harness: backend,
            planId: input.planId,
            cwd: input.cwd,
            issues: SAMPLE_ISSUES,
            ...(input.reviewFixerOptions.continuationContext !== undefined
              ? { continuationContext: input.reviewFixerOptions.continuationContext }
              : {}),
          }),
        policy,
        initialInput,
      ),
    );

    // First call: no continuation context
    expect(backend.prompts[0]).not.toContain('Continuation (attempt');
    // Second call: continuation context injected
    expect(backend.prompts[1]).toContain('Continuation (attempt');
    expect(backend.prompts[1]).toContain('previous attempt ran out of turns');
  });

  it('does not emit plan:build:review:fix:complete when all retries are exhausted on max-turns', async () => {
    const maxTurnsError = new AgentTerminalError('error_max_turns', 'Exceeded turn limit');
    // All 3 attempts fail
    const backend = new StubHarness([
      { error: maxTurnsError },
      { error: maxTurnsError },
      { error: maxTurnsError },
    ]);

    const policy = DEFAULT_RETRY_POLICIES['review-fixer'] as RetryPolicy<ReviewFixerContinuationInput>;
    const initialInput: ReviewFixerContinuationInput = {
      cwd: '/tmp',
      planId: 'plan-42',
      reviewFixerOptions: {},
    };

    const events: EforgeEvent[] = [];
    let thrown: unknown;
    try {
      for await (const event of withRetry(
        (input) =>
          runReviewFixer({
            harness: backend,
            planId: input.planId,
            cwd: input.cwd,
            issues: SAMPLE_ISSUES,
          }),
        policy,
        initialInput,
      )) {
        events.push(event);
      }
    } catch (err) {
      thrown = err;
    }

    // complete must NOT be emitted for terminal max-turns exhaustion
    expect(filterEvents(events, 'plan:build:review:fix:complete')).toHaveLength(0);
    // Each attempt emits a start event
    expect(filterEvents(events, 'plan:build:review:fix:start')).toHaveLength(3);
    // withRetry rethrows the terminal error after exhaustion
    expect(thrown).toBeInstanceOf(AgentTerminalError);
    expect((thrown as AgentTerminalError).subtype).toBe('error_max_turns');
  });

  it('emits two agent:retry events and two plan:build:review:fix:continuation events for three attempts', async () => {
    const maxTurnsError = new AgentTerminalError('error_max_turns', 'Exceeded turn limit');
    // Attempts 1 and 2 fail; attempt 3 succeeds
    const backend = new StubHarness([
      { error: maxTurnsError },
      { error: maxTurnsError },
      { text: 'All issues resolved.' },
    ]);

    const policy = DEFAULT_RETRY_POLICIES['review-fixer'] as RetryPolicy<ReviewFixerContinuationInput>;
    const initialInput: ReviewFixerContinuationInput = {
      cwd: '/tmp',
      planId: 'plan-multi',
      reviewFixerOptions: {},
    };

    const events = await collectEvents(
      withRetry(
        (input) =>
          runReviewFixer({
            harness: backend,
            planId: input.planId,
            cwd: input.cwd,
            issues: SAMPLE_ISSUES,
          }),
        policy,
        initialInput,
      ),
    );

    expect(filterEvents(events, 'agent:retry')).toHaveLength(2);
    expect(filterEvents(events, 'plan:build:review:fix:continuation')).toHaveLength(2);
    // Final attempt succeeds — complete event is present
    expect(filterEvents(events, 'plan:build:review:fix:complete')).toHaveLength(1);
  });
});
