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
  extractReviewFixerDiscoveryContext,
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

  it('second attempt prompt includes discovery context from first attempt tool events', async () => {
    const makeTempDir2 = useTempDir('eforge-rfx-discovery-');
    const dir = makeTempDir2();
    await createGitRepo(dir);

    const maxTurnsError = new AgentTerminalError('error_max_turns', 'Turn limit reached');
    const backend = new StubHarness([{ text: 'All fixed.' }]);

    // Simulate a custom first attempt that emits tool events then throws max-turns.
    // withRetry collects those events and passes them to buildReviewFixerContinuationInput.
    let firstAttemptDone = false;
    const runAgent = async function* (input: ReviewFixerContinuationInput): AsyncGenerator<EforgeEvent> {
      if (!firstAttemptDone) {
        firstAttemptDone = true;
        // Emit tool events that withRetry should collect in attemptEvents
        yield {
          timestamp: new Date().toISOString(), type: 'agent:tool_use', agentId: 'a1',
          agent: 'review-fixer', tool: 'Read', toolUseId: 'tu-1',
          input: { file_path: 'src/component.ts' },
        };
        yield {
          timestamp: new Date().toISOString(), type: 'agent:tool_result', agentId: 'a1',
          agent: 'review-fixer', tool: 'Read', toolUseId: 'tu-1', output: 'export const x = 1;',
        };
        yield {
          timestamp: new Date().toISOString(), type: 'agent:tool_use', agentId: 'a1',
          agent: 'review-fixer', tool: 'Grep', toolUseId: 'tu-2',
          input: { pattern: 'useEffect', path: 'src' },
        };
        yield {
          timestamp: new Date().toISOString(), type: 'agent:tool_result', agentId: 'a1',
          agent: 'review-fixer', tool: 'Grep', toolUseId: 'tu-2',
          output: 'src/app.ts:10:  useEffect(() => {',
        };
        yield {
          timestamp: new Date().toISOString(), type: 'agent:message', agentId: 'a1',
          agent: 'review-fixer', content: 'Analyzing issues...',
        };
        throw maxTurnsError;
      }
      // Second attempt: use real runReviewFixer with backend
      yield* runReviewFixer({
        harness: backend,
        planId: input.planId,
        cwd: input.cwd,
        issues: SAMPLE_ISSUES,
        ...(input.reviewFixerOptions.continuationContext !== undefined
          ? { continuationContext: input.reviewFixerOptions.continuationContext }
          : {}),
      });
    };

    const policy = DEFAULT_RETRY_POLICIES['review-fixer'] as RetryPolicy<ReviewFixerContinuationInput>;
    const initialInput: ReviewFixerContinuationInput = {
      cwd: dir,
      planId: 'plan-discovery',
      reviewFixerOptions: {},
    };

    await collectEvents(withRetry(runAgent, policy, initialInput));

    // Second prompt should include discovery context sections
    expect(backend.prompts[0]).toContain('Files inspected');
    expect(backend.prompts[0]).toContain('src/component.ts');
    expect(backend.prompts[0]).toContain('Searches and globs run');
    expect(backend.prompts[0]).toContain('grep: useEffect');
    // Message from first attempt should appear in recent messages
    expect(backend.prompts[0]).toContain('Recent agent messages');
    expect(backend.prompts[0]).toContain('Analyzing issues...');
    // Discovery context guidance
    expect(backend.prompts[0]).toContain('do not restart cold');
  });

  it('second attempt prompt includes discovery context even when partialDiff is empty', async () => {
    const makeTempDir3 = useTempDir('eforge-rfx-nodiff-');
    const dir = makeTempDir3();
    await createGitRepo(dir);

    // Clean worktree — no diff — but tool events still present
    const maxTurnsError = new AgentTerminalError('error_max_turns', 'Turn limit reached');
    const backend = new StubHarness([{ text: 'Completed.' }]);

    let firstAttemptDone2 = false;
    const runAgent2 = async function* (input: ReviewFixerContinuationInput): AsyncGenerator<EforgeEvent> {
      if (!firstAttemptDone2) {
        firstAttemptDone2 = true;
        yield {
          timestamp: new Date().toISOString(), type: 'agent:tool_use', agentId: 'a1',
          agent: 'review-fixer', tool: 'Glob', toolUseId: 'tu-glob-1',
          input: { pattern: '**/*.ts' },
        };
        yield {
          timestamp: new Date().toISOString(), type: 'agent:tool_result', agentId: 'a1',
          agent: 'review-fixer', tool: 'Glob', toolUseId: 'tu-glob-1', output: 'src/a.ts\nsrc/b.ts',
        };
        yield {
          timestamp: new Date().toISOString(), type: 'agent:tool_use', agentId: 'a1',
          agent: 'review-fixer', tool: 'Bash', toolUseId: 'tu-bash-1',
          input: { command: 'npx tsc --noEmit' },
        };
        yield {
          timestamp: new Date().toISOString(), type: 'agent:tool_result', agentId: 'a1',
          agent: 'review-fixer', tool: 'Bash', toolUseId: 'tu-bash-1', output: 'No errors found',
        };
        throw maxTurnsError;
      }
      yield* runReviewFixer({
        harness: backend,
        planId: input.planId,
        cwd: input.cwd,
        issues: SAMPLE_ISSUES,
        ...(input.reviewFixerOptions.continuationContext !== undefined
          ? { continuationContext: input.reviewFixerOptions.continuationContext }
          : {}),
      });
    };

    const policy = DEFAULT_RETRY_POLICIES['review-fixer'] as RetryPolicy<ReviewFixerContinuationInput>;
    const initialInput: ReviewFixerContinuationInput = {
      cwd: dir,
      planId: 'plan-nodiff',
      reviewFixerOptions: {},
    };

    await collectEvents(withRetry(runAgent2, policy, initialInput));

    // Should still include discovery context
    expect(backend.prompts[0]).toContain('Searches and globs run');
    expect(backend.prompts[0]).toContain('glob: **/*.ts');
    expect(backend.prompts[0]).toContain('Shell commands run');
    expect(backend.prompts[0]).toContain('npx tsc --noEmit');
    // No-diff message still present
    expect(backend.prompts[0]).toContain('no changes were made in the previous attempt');
    // Guidance to use discovery context
    expect(backend.prompts[0]).toContain('do not restart cold');
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

// ---------------------------------------------------------------------------
// extractReviewFixerDiscoveryContext — unit tests
// ---------------------------------------------------------------------------

describe('extractReviewFixerDiscoveryContext', () => {
  const ts = () => new Date().toISOString();

  it('extracts file paths from Read tool_use events filtered to review-fixer agent', () => {
    const events: EforgeEvent[] = [
      {
        timestamp: ts(), type: 'agent:tool_use', agentId: 'a1', agent: 'review-fixer',
        tool: 'Read', toolUseId: 'tu-1', input: { file_path: 'src/foo.ts' },
      },
      {
        timestamp: ts(), type: 'agent:tool_use', agentId: 'a2', agent: 'reviewer',
        tool: 'Read', toolUseId: 'tu-2', input: { file_path: 'src/bar.ts' },
      },
    ];
    const ctx = extractReviewFixerDiscoveryContext(events);
    expect(ctx.filesInspected).toContain('src/foo.ts');
    // Reviewer event should be excluded
    expect(ctx.filesInspected).not.toContain('src/bar.ts');
  });

  it('extracts grep searches from Grep tool_use events', () => {
    const events: EforgeEvent[] = [
      {
        timestamp: ts(), type: 'agent:tool_use', agentId: 'a1', agent: 'review-fixer',
        tool: 'Grep', toolUseId: 'tu-1', input: { pattern: 'useState', path: 'src' },
      },
    ];
    const ctx = extractReviewFixerDiscoveryContext(events);
    expect(ctx.searches.some((s) => s.includes('useState'))).toBe(true);
    expect(ctx.searches.some((s) => s.includes('src'))).toBe(true);
  });

  it('extracts glob patterns from Glob tool_use events', () => {
    const events: EforgeEvent[] = [
      {
        timestamp: ts(), type: 'agent:tool_use', agentId: 'a1', agent: 'review-fixer',
        tool: 'Glob', toolUseId: 'tu-1', input: { pattern: '**/*.test.ts' },
      },
    ];
    const ctx = extractReviewFixerDiscoveryContext(events);
    expect(ctx.searches.some((s) => s.includes('**/*.test.ts'))).toBe(true);
  });

  it('extracts bash commands from Bash tool_use events', () => {
    const events: EforgeEvent[] = [
      {
        timestamp: ts(), type: 'agent:tool_use', agentId: 'a1', agent: 'review-fixer',
        tool: 'Bash', toolUseId: 'tu-1', input: { command: 'npm run lint' },
      },
    ];
    const ctx = extractReviewFixerDiscoveryContext(events);
    expect(ctx.commands).toContain('npm run lint');
  });

  it('pairs tool_result with tool_use via toolUseId for snippets', () => {
    const events: EforgeEvent[] = [
      {
        timestamp: ts(), type: 'agent:tool_use', agentId: 'a1', agent: 'review-fixer',
        tool: 'Read', toolUseId: 'tu-read-1', input: { file_path: 'src/foo.ts' },
      },
      {
        timestamp: ts(), type: 'agent:tool_result', agentId: 'a1', agent: 'review-fixer',
        tool: 'Read', toolUseId: 'tu-read-1', output: 'export const x = 1;',
      },
    ];
    const ctx = extractReviewFixerDiscoveryContext(events);
    expect(ctx.toolResultSnippets.some((s) => s.includes('export const x = 1;'))).toBe(true);
    expect(ctx.toolResultSnippets.some((s) => s.includes('[Read]'))).toBe(true);
  });

  it('collects agent:message content as recentMessages', () => {
    const events: EforgeEvent[] = [
      {
        timestamp: ts(), type: 'agent:message', agentId: 'a1', agent: 'review-fixer',
        content: 'Found the issue in the hook.',
      },
      {
        timestamp: ts(), type: 'agent:message', agentId: 'a1', agent: 'review-fixer',
        content: 'Applying fix now.',
      },
    ];
    const ctx = extractReviewFixerDiscoveryContext(events);
    expect(ctx.recentMessages).toContain('Found the issue in the hook.');
    expect(ctx.recentMessages).toContain('Applying fix now.');
  });

  it('deduplicates file paths', () => {
    const events: EforgeEvent[] = [
      {
        timestamp: ts(), type: 'agent:tool_use', agentId: 'a1', agent: 'review-fixer',
        tool: 'Read', toolUseId: 'tu-1', input: { file_path: 'src/foo.ts' },
      },
      {
        timestamp: ts(), type: 'agent:tool_use', agentId: 'a1', agent: 'review-fixer',
        tool: 'Read', toolUseId: 'tu-2', input: { file_path: 'src/foo.ts' },
      },
    ];
    const ctx = extractReviewFixerDiscoveryContext(events);
    expect(ctx.filesInspected.filter((f) => f === 'src/foo.ts')).toHaveLength(1);
  });

  it('returns empty arrays for an empty event list', () => {
    const ctx = extractReviewFixerDiscoveryContext([]);
    expect(ctx.filesInspected).toHaveLength(0);
    expect(ctx.searches).toHaveLength(0);
    expect(ctx.commands).toHaveLength(0);
    expect(ctx.recentMessages).toHaveLength(0);
    expect(ctx.toolResultSnippets).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// buildReviewFixerContinuationInput — discovery context inclusion
// ---------------------------------------------------------------------------

describe('buildReviewFixerContinuationInput — discovery context', () => {
  const makeTempDir4 = useTempDir('eforge-rfx-disc-ctx-');
  const ts = () => new Date().toISOString();

  it('includes discovery context derived from events in continuationContext', async () => {
    const dir = makeTempDir4();
    await createGitRepo(dir);

    const events: EforgeEvent[] = [
      {
        timestamp: ts(), type: 'agent:tool_use', agentId: 'a1', agent: 'review-fixer',
        tool: 'Read', toolUseId: 'tu-1', input: { file_path: 'src/types.ts' },
      },
      {
        timestamp: ts(), type: 'agent:tool_result', agentId: 'a1', agent: 'review-fixer',
        tool: 'Read', toolUseId: 'tu-1', output: 'interface Foo { bar: string }',
      },
      {
        timestamp: ts(), type: 'agent:tool_use', agentId: 'a1', agent: 'review-fixer',
        tool: 'Grep', toolUseId: 'tu-2', input: { pattern: 'Foo', path: 'src' },
      },
      {
        timestamp: ts(), type: 'agent:tool_result', agentId: 'a1', agent: 'review-fixer',
        tool: 'Grep', toolUseId: 'tu-2', output: 'src/types.ts:1:interface Foo',
      },
      {
        timestamp: ts(), type: 'agent:message', agentId: 'a1', agent: 'review-fixer',
        content: 'The Foo interface needs updating.',
      },
    ];

    const info: RetryAttemptInfo<ReviewFixerContinuationInput> = {
      attempt: 1,
      maxAttempts: 3,
      subtype: 'error_max_turns',
      events,
      prevInput: { cwd: dir, planId: 'plan-disc', reviewFixerOptions: {} },
    };

    const decision = await buildReviewFixerContinuationInput(info);
    expect(decision.kind).toBe('retry');
    if (decision.kind === 'retry') {
      const ctx = decision.input.reviewFixerOptions.continuationContext;
      expect(ctx).toBeDefined();
      expect(ctx!.filesInspected).toContain('src/types.ts');
      expect(ctx!.searches?.some((s) => s.includes('Foo'))).toBe(true);
      expect(ctx!.recentMessages).toContain('The Foo interface needs updating.');
      expect(ctx!.toolResultSnippets?.some((s) => s.includes('interface Foo'))).toBe(true);
    }
  });

  it('includes discovery context even when partialDiff is empty (no git changes)', async () => {
    const dir = makeTempDir4();
    await createGitRepo(dir);

    const events: EforgeEvent[] = [
      {
        timestamp: ts(), type: 'agent:tool_use', agentId: 'a1', agent: 'review-fixer',
        tool: 'Bash', toolUseId: 'tu-1', input: { command: 'ls src/' },
      },
      {
        timestamp: ts(), type: 'agent:tool_result', agentId: 'a1', agent: 'review-fixer',
        tool: 'Bash', toolUseId: 'tu-1', output: 'index.ts\ntypes.ts',
      },
    ];

    const info: RetryAttemptInfo<ReviewFixerContinuationInput> = {
      attempt: 1,
      maxAttempts: 3,
      subtype: 'error_max_turns',
      events,
      prevInput: { cwd: dir, planId: 'plan-nodiff-disc', reviewFixerOptions: {} },
    };

    const decision = await buildReviewFixerContinuationInput(info);
    expect(decision.kind).toBe('retry');
    if (decision.kind === 'retry') {
      const ctx = decision.input.reviewFixerOptions.continuationContext;
      expect(ctx).toBeDefined();
      // No diff (clean worktree)
      expect(ctx!.partialDiff).toBe('');
      // But discovery context is still present
      expect(ctx!.commands).toContain('ls src/');
      expect(ctx!.toolResultSnippets?.some((s) => s.includes('index.ts'))).toBe(true);
    }
  });
});
