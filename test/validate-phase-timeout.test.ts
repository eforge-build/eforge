import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { validate } from '@eforge-build/engine/orchestrator/phases';
import type { PhaseContext } from '@eforge-build/engine/orchestrator/phases';
import type { WorktreeManager } from '@eforge-build/engine/worktree-manager';
import type { EforgeEvent, EforgeState, OrchestrationConfig } from '@eforge-build/engine/events';
import type { ExecWithTimeoutResult } from '@eforge-build/engine/exec-with-timeout';
import { ModelTracker } from '@eforge-build/engine/model-tracker';
import { useTempDir } from './test-tmpdir.js';

// Mock execWithTimeout so phase-logic tests run instantly without real subprocess spawning.
// The exec-with-timeout unit tests (exec-with-timeout.test.ts) cover the real kill behavior.
vi.mock('@eforge-build/engine/exec-with-timeout');
import { execWithTimeout } from '@eforge-build/engine/exec-with-timeout';
const mockExecWithTimeout = vi.mocked(execWithTimeout);

const TEST_PIPELINE = {
  planner: { enabled: true },
  reviewer: { enabled: true },
  defaultBuild: ['implement', 'review-cycle'],
  defaultReview: { strategy: 'auto' as const, perspectives: ['code'], maxRounds: 1, evaluatorStrictness: 'standard' as const },
  rationale: 'test pipeline',
};

function makeState(): EforgeState {
  return {
    setName: 'test-set',
    status: 'running',
    startedAt: '2026-01-01T00:00:00Z',
    baseBranch: 'main',
    featureBranch: 'eforge/test-set',
    worktreeBase: '/tmp/worktrees',
    // No plans — every() on empty collection returns true → allMerged = true
    plans: {},
    completedPlans: [],
  };
}

function initGitRepo(dir: string): void {
  execFileSync('git', ['init'], { cwd: dir, stdio: 'ignore' });
  execFileSync('git', ['config', 'user.email', 'test@example.invalid'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: dir });
  writeFileSync(join(dir, 'tracked.txt'), 'initial\n');
  execFileSync('git', ['add', 'tracked.txt'], { cwd: dir });
  execFileSync('git', ['commit', '-m', 'initial'], { cwd: dir, stdio: 'ignore' });
}

function makeConfig(): OrchestrationConfig {
  return {
    name: 'test-set',
    description: 'test',
    created: '2026-01-01T00:00:00Z',
    mode: 'excursion',
    baseBranch: 'main',
    pipeline: TEST_PIPELINE,
    plans: [],
  };
}

function makeCtx(
  stateDir: string,
  mergeWorktreePath: string,
  overrides: Partial<PhaseContext>,
): PhaseContext {
  const stubWorktreeManager = {
    acquireForPlan: async () => '/tmp/fake-worktree',
    releaseForPlan: async () => {},
    mergePlan: async () => 'abc123',
    reconcile: async () => ({ valid: [], recovered: [], orphaned: [] }),
  } as unknown as WorktreeManager;

  const state = makeState();
  return {
    state,
    config: makeConfig(),
    stateDir,
    repoRoot: '/tmp/repo',
    planRunner: async function* () {},
    parallelism: 1,
    postMergeCommands: [],
    validateCommands: [],
    maxValidationRetries: 0,
    minCompletionPercent: 0,
    gapClosePerformed: false,
    mergeWorktreePath,
    featureBranch: state.featureBranch,
    worktreeManager: stubWorktreeManager,
    failedMerges: new Set(),
    recentlyMergedIds: [],
    landingSucceeded: false, landingAction: 'merge' as const,
    resumed: false,
    modelTracker: new ModelTracker(),
    ...overrides,
  };
}

// A successful exec result (command exited 0).
function successResult(): ExecWithTimeoutResult {
  return { stdout: '', stderr: '', exitCode: 0, timedOut: false, pid: 0 };
}

// A timed-out exec result.
function timeoutResult(pid = 99999): ExecWithTimeoutResult {
  return { stdout: '', stderr: '', exitCode: 1, timedOut: true, pid };
}

describe('validate phase — timeout behavior', () => {
  const makeTempDir = useTempDir();

  beforeEach(() => {
    vi.clearAllMocks();
    // Default behaviour: commands succeed instantly.
    mockExecWithTimeout.mockResolvedValue(successResult());
  });

  it('emits validation:command:timeout then validation:command:complete with exitCode 124 and invokes fixer', async () => {
    const stateDir = makeTempDir();
    const mergeWorktreePath = makeTempDir();

    // All calls time out (covers both the initial attempt and the retry).
    mockExecWithTimeout.mockResolvedValue(timeoutResult(99999));

    const fixerEvents: EforgeEvent[] = [];
    const fixerInvocations: Array<{ attempt: number }> = [];

    const validationFixer: PhaseContext['validationFixer'] = async function* (
      _cwd,
      _failures,
      attempt,
    ) {
      fixerInvocations.push({ attempt });
      yield {
        timestamp: new Date().toISOString(),
        type: 'validation:fix:start',
        attempt,
        maxAttempts: 1,
      } as EforgeEvent;
      fixerEvents.push({
        timestamp: new Date().toISOString(),
        type: 'validation:fix:complete',
        attempt,
      } as EforgeEvent);
      yield fixerEvents[fixerEvents.length - 1];
    };

    // Use 15_000 (above the 10_000ms floor) so no clamping occurs and the emitted
    // timeoutMs matches exactly what we configure here.
    const ctx = makeCtx(stateDir, mergeWorktreePath, {
      validateCommands: ["sh -c 'sleep 60'"],
      postMergeCommandTimeoutMs: 15_000,
      maxValidationRetries: 1,
      validationFixer,
    });

    const events: EforgeEvent[] = [];
    for await (const event of validate(ctx)) {
      events.push(event);
    }

    const types = events.map((e) => e.type);

    // Must include the timeout event
    expect(types).toContain('validation:command:timeout');

    // validation:command:timeout should come before validation:command:complete
    const timeoutIdx = types.indexOf('validation:command:timeout');
    const completeIdx = types.indexOf('validation:command:complete');
    expect(timeoutIdx).toBeLessThan(completeIdx);

    // The complete event should have exitCode 124 (coreutils timeout convention)
    const completeEvent = events.find(
      (e) => e.type === 'validation:command:complete',
    ) as Extract<EforgeEvent, { type: 'validation:command:complete' }>;
    expect(completeEvent).toBeDefined();
    expect(completeEvent.exitCode).toBe(124);
    expect(completeEvent.output).toContain('timed out');

    // The timeout event should carry the right payload
    const timeoutEvent = events.find(
      (e) => e.type === 'validation:command:timeout',
    ) as Extract<EforgeEvent, { type: 'validation:command:timeout' }>;
    expect(timeoutEvent).toBeDefined();
    // timeoutMs reflects the effective (unclamped) configured value
    expect(timeoutEvent.timeoutMs).toBe(15_000);
    expect(timeoutEvent.pid).toBe(99999);
    expect(timeoutEvent.command).toBe("sh -c 'sleep 60'");

    // validation:complete should be emitted with passed: false
    const validationComplete = events.find((e) => e.type === 'validation:complete') as
      | Extract<EforgeEvent, { type: 'validation:complete' }>
      | undefined;
    expect(validationComplete).toBeDefined();
    expect(validationComplete!.passed).toBe(false);

    // The fixer should have been invoked (maxValidationRetries: 1)
    expect(fixerInvocations).toHaveLength(1);
  });

  it('fails validation when a successful command leaves the merge worktree dirty', async () => {
    const stateDir = makeTempDir();
    const mergeWorktreePath = makeTempDir();
    initGitRepo(mergeWorktreePath);

    mockExecWithTimeout.mockImplementation(async () => {
      writeFileSync(join(mergeWorktreePath, 'generated.js'), 'generated\n');
      return { stdout: 'build ok', stderr: '', exitCode: 0, timedOut: false, pid: 123 };
    });

    const fixerInvocations: Array<{ failures: Array<{ command: string; output: string }> }> = [];
    const validationFixer: PhaseContext['validationFixer'] = async function* (_cwd, failures) {
      fixerInvocations.push({ failures });
    };

    const ctx = makeCtx(stateDir, mergeWorktreePath, {
      validateCommands: ['pnpm build', 'pnpm test'],
      maxValidationRetries: 1,
      validationFixer,
    });

    const events: EforgeEvent[] = [];
    for await (const event of validate(ctx)) events.push(event);

    expect(mockExecWithTimeout).toHaveBeenCalledTimes(1);
    expect(mockExecWithTimeout).toHaveBeenNthCalledWith(1, 'pnpm build', expect.anything());
    expect(mockExecWithTimeout).not.toHaveBeenCalledWith('pnpm test', expect.anything());

    const commandComplete = events.find((event) => event.type === 'validation:command:complete') as
      | Extract<EforgeEvent, { type: 'validation:command:complete' }>
      | undefined;
    expect(commandComplete).toMatchObject({ command: 'pnpm build', exitCode: 1 });
    expect(commandComplete?.output).toContain('build ok');
    expect(commandComplete?.output).toContain('Validation detected a dirty merge worktree after validation command exited 0');
    expect(commandComplete?.output).toContain('?? generated.js');
    expect(events).toContainEqual(expect.objectContaining({ type: 'validation:complete', passed: false }));
    expect(fixerInvocations).toHaveLength(1);
    expect(fixerInvocations[0]?.failures[0]?.command).toBe('pnpm build');
  });

  it('fails validation before commands when the merge worktree starts dirty', async () => {
    const stateDir = makeTempDir();
    const mergeWorktreePath = makeTempDir();
    initGitRepo(mergeWorktreePath);
    writeFileSync(join(mergeWorktreePath, 'tracked.txt'), 'dirty\n');

    const ctx = makeCtx(stateDir, mergeWorktreePath, {
      validateCommands: ['pnpm build'],
      maxValidationRetries: 0,
    });

    const events: EforgeEvent[] = [];
    for await (const event of validate(ctx)) events.push(event);

    expect(mockExecWithTimeout).not.toHaveBeenCalled();
    const commandComplete = events.find((event) => event.type === 'validation:command:complete') as
      | Extract<EforgeEvent, { type: 'validation:command:complete' }>
      | undefined;
    expect(commandComplete).toMatchObject({ command: 'pre-validation worktree cleanliness check', exitCode: 1 });
    expect(commandComplete?.output).toContain('before validation commands ran');
    expect(commandComplete?.output).toContain('M tracked.txt');
    expect(events).toContainEqual(expect.objectContaining({ type: 'validation:complete', passed: false }));
  });

  it('emits config:warning before commands when postMergeCommandTimeoutMs is below the floor', async () => {
    const stateDir = makeTempDir();
    const mergeWorktreePath = makeTempDir();

    // exit 0 — mock returns success
    mockExecWithTimeout.mockResolvedValue(successResult());

    const ctx = makeCtx(stateDir, mergeWorktreePath, {
      validateCommands: ['exit 0'],
      postMergeCommandTimeoutMs: 50, // below 10_000 floor
      maxValidationRetries: 0,
    });

    const events: EforgeEvent[] = [];
    for await (const event of validate(ctx)) {
      events.push(event);
    }

    const types = events.map((e) => e.type);

    // config:warning should appear before validation:start
    expect(types).toContain('config:warning');
    const warningIdx = types.indexOf('config:warning');
    const startIdx = types.indexOf('validation:start');
    expect(warningIdx).toBeLessThan(startIdx);

    // The warning message should mention the clamp
    const warningEvent = events.find((e) => e.type === 'config:warning') as
      | Extract<EforgeEvent, { type: 'config:warning' }>
      | undefined;
    expect(warningEvent).toBeDefined();
    expect(warningEvent!.source).toBe('validate');
    expect(warningEvent!.message).toContain('10000');
  });

  it('does not emit config:warning when timeout is at or above the floor', async () => {
    const stateDir = makeTempDir();
    const mergeWorktreePath = makeTempDir();

    mockExecWithTimeout.mockResolvedValue(successResult());

    const ctx = makeCtx(stateDir, mergeWorktreePath, {
      validateCommands: ['exit 0'],
      postMergeCommandTimeoutMs: 10_000, // exactly at floor
      maxValidationRetries: 0,
    });

    const events: EforgeEvent[] = [];
    for await (const event of validate(ctx)) {
      events.push(event);
    }

    expect(events.find((e) => e.type === 'config:warning')).toBeUndefined();
  });

  it('uses default timeout of 300_000ms when postMergeCommandTimeoutMs is not set', async () => {
    const stateDir = makeTempDir();
    const mergeWorktreePath = makeTempDir();

    mockExecWithTimeout.mockResolvedValue(successResult());

    const ctx = makeCtx(stateDir, mergeWorktreePath, {
      validateCommands: ['exit 0'],
      // postMergeCommandTimeoutMs not set → default 300_000
      maxValidationRetries: 0,
    });

    const events: EforgeEvent[] = [];
    for await (const event of validate(ctx)) {
      events.push(event);
    }

    // Should complete successfully with no timeout or warning events
    expect(events.find((e) => e.type === 'config:warning')).toBeUndefined();
    expect(events.find((e) => e.type === 'validation:command:timeout')).toBeUndefined();

    const completeEvent = events.find((e) => e.type === 'validation:complete') as
      | Extract<EforgeEvent, { type: 'validation:complete' }>
      | undefined;
    expect(completeEvent).toBeDefined();
    expect(completeEvent!.passed).toBe(true);
  });

  it('passes the effective timeout to execWithTimeout', async () => {
    const stateDir = makeTempDir();
    const mergeWorktreePath = makeTempDir();

    mockExecWithTimeout.mockResolvedValue(successResult());

    const ctx = makeCtx(stateDir, mergeWorktreePath, {
      validateCommands: ['pnpm type-check'],
      postMergeCommandTimeoutMs: 20_000,
      maxValidationRetries: 0,
    });

    for await (const _ of validate(ctx)) { /* drain */ }

    expect(mockExecWithTimeout).toHaveBeenCalledWith(
      'pnpm type-check',
      expect.objectContaining({ timeoutMs: 20_000, cwd: mergeWorktreePath }),
    );
  });

  it('clamps sub-floor timeout to 10_000ms when calling execWithTimeout', async () => {
    const stateDir = makeTempDir();
    const mergeWorktreePath = makeTempDir();

    mockExecWithTimeout.mockResolvedValue(successResult());

    const ctx = makeCtx(stateDir, mergeWorktreePath, {
      validateCommands: ['exit 0'],
      postMergeCommandTimeoutMs: 500, // below floor
      maxValidationRetries: 0,
    });

    for await (const _ of validate(ctx)) { /* drain */ }

    // The clamped value (10_000) is passed to execWithTimeout, not the raw 500.
    expect(mockExecWithTimeout).toHaveBeenCalledWith(
      'exit 0',
      expect.objectContaining({ timeoutMs: 10_000 }),
    );
  });
});
