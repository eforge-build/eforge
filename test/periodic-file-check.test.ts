import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { EforgeEvent } from '@eforge-build/engine/events';
import type { BuildStageContext } from '@eforge-build/engine/pipeline';
import { withPeriodicFileCheck } from '@eforge-build/engine/pipeline';

// Create mock inside vi.hoisted so it's available when vi.mock factory runs (hoisted above imports).
const { execFileMock, mockedExecFilePromisified } = vi.hoisted(() => {
  const customSym = Symbol.for('nodejs.util.promisify.custom');
  const mock: any = vi.fn();
  mock[customSym] = vi.fn();
  return { execFileMock: mock, mockedExecFilePromisified: mock[customSym] as ReturnType<typeof vi.fn> };
});

vi.mock('node:child_process', () => ({
  execFile: execFileMock,
}));

const TEST_INTERVAL_MS = 50;

/** Create a minimal BuildStageContext for testing. */
function makeCtx(overrides: Partial<BuildStageContext> = {}): BuildStageContext {
  return {
    planId: 'test-plan',
    worktreePath: '/tmp/test-worktree',
    orchConfig: { baseBranch: 'main', plans: [], validate: [] },
    ...overrides,
  } as unknown as BuildStageContext;
}

/** Create an async generator that yields the given events immediately. */
async function* asyncIterableFrom(events: EforgeEvent[]): AsyncGenerator<EforgeEvent> {
  for (const event of events) yield event;
}

function deferred<T = void>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((innerResolve) => {
    resolve = innerResolve;
  });
  return { promise, resolve };
}

async function expectNextEvent(iterator: AsyncIterator<EforgeEvent>): Promise<EforgeEvent> {
  const result = await iterator.next();
  expect(result.done).toBe(false);
  return result.value;
}

async function expectDone(iterator: AsyncIterator<EforgeEvent>): Promise<void> {
  const result = await iterator.next();
  expect(result.done).toBe(true);
}

/** Set up the promisified execFile mock to resolve with the given stdout. */
function mockGitDiff(stdout: string): void {
  mockedExecFilePromisified.mockResolvedValue({ stdout, stderr: '' });
}

/**
 * Set up the promisified execFile mock to handle both --name-only and full diff calls.
 * The first call pattern (with --name-only) returns file names.
 * The second call pattern (without --name-only) returns full diff output.
 */
function mockGitDiffWithContent(nameOnlyStdout: string, fullDiffStdout: string): void {
  mockedExecFilePromisified.mockImplementation((...args: any[]) => {
    const gitArgs = args[1] as string[];
    if (gitArgs.includes('--name-only')) {
      return Promise.resolve({ stdout: nameOnlyStdout, stderr: '' });
    }
    return Promise.resolve({ stdout: fullDiffStdout, stderr: '' });
  });
}

/** Set up the promisified execFile mock to reject with an error. */
function mockGitDiffError(): void {
  mockedExecFilePromisified.mockRejectedValue(new Error('git failed'));
}

function gitNameOnlyCallCount(): number {
  return mockedExecFilePromisified.mock.calls.filter((args) => (args[1] as string[]).includes('--name-only')).length;
}

function controlledInner(release: Promise<void>): AsyncGenerator<EforgeEvent> {
  return (async function* (): AsyncGenerator<EforgeEvent> {
    yield { type: 'plan:build:implement:start', planId: 'test-plan' } as EforgeEvent;
    await release;
    yield { type: 'plan:build:implement:complete', planId: 'test-plan' } as EforgeEvent;
  })();
}

describe('withPeriodicFileCheck', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockedExecFilePromisified.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('passes through inner events unchanged', async () => {
    const innerEvents: EforgeEvent[] = [
      { type: 'plan:build:implement:start', planId: 'test-plan' } as EforgeEvent,
      { type: 'plan:build:implement:progress', planId: 'test-plan', message: 'working' } as EforgeEvent,
      { type: 'plan:build:implement:complete', planId: 'test-plan' } as EforgeEvent,
    ];

    const ctx = makeCtx();
    const wrapped = withPeriodicFileCheck(asyncIterableFrom(innerEvents), ctx, TEST_INTERVAL_MS);

    const collected: EforgeEvent[] = [];
    for await (const event of wrapped) {
      collected.push(event);
    }

    expect(collected.map((e) => e.type)).toEqual([
      'plan:build:implement:start',
      'plan:build:implement:progress',
      'plan:build:implement:complete',
    ]);
  });

  it('emits file change events when the interval elapses and file list differs', async () => {
    mockGitDiff('src/foo.ts\nsrc/bar.ts\n');

    const gate = deferred();
    const ctx = makeCtx();
    const iterator = withPeriodicFileCheck(controlledInner(gate.promise), ctx, TEST_INTERVAL_MS)[Symbol.asyncIterator]();

    expect((await expectNextEvent(iterator)).type).toBe('plan:build:implement:start');

    const fileEventPromise = iterator.next();
    await vi.advanceTimersByTimeAsync(TEST_INTERVAL_MS);
    const fileResult = await fileEventPromise;

    expect(fileResult.done).toBe(false);
    const fileEvent = fileResult.value;
    expect(fileEvent.type).toBe('plan:build:files_changed');
    if (fileEvent.type === 'plan:build:files_changed') {
      expect(fileEvent.files).toEqual(['src/bar.ts', 'src/foo.ts']);
      expect(fileEvent.planId).toBe('test-plan');
    }

    gate.resolve();
    expect((await expectNextEvent(iterator)).type).toBe('plan:build:implement:complete');
    await expectDone(iterator);
  });

  it('includes diffs and baseBranch in emitted file change events', async () => {
    const fullDiff = [
      'diff --git a/src/bar.ts b/src/bar.ts\n--- a/src/bar.ts\n+++ b/src/bar.ts\n+new line in bar',
      'diff --git a/src/foo.ts b/src/foo.ts\n--- a/src/foo.ts\n+++ b/src/foo.ts\n+new line in foo',
    ].join('\n');

    mockGitDiffWithContent('src/foo.ts\nsrc/bar.ts\n', fullDiff);

    const gate = deferred();
    const ctx = makeCtx();
    const iterator = withPeriodicFileCheck(controlledInner(gate.promise), ctx, TEST_INTERVAL_MS)[Symbol.asyncIterator]();

    expect((await expectNextEvent(iterator)).type).toBe('plan:build:implement:start');

    const fileEventPromise = iterator.next();
    await vi.advanceTimersByTimeAsync(TEST_INTERVAL_MS);
    const fileResult = await fileEventPromise;

    expect(fileResult.done).toBe(false);
    const fileEvent = fileResult.value;
    expect(fileEvent.type).toBe('plan:build:files_changed');
    if (fileEvent.type === 'plan:build:files_changed') {
      expect(fileEvent.baseBranch).toBe('main');
      expect(fileEvent.diffs).toBeDefined();
      expect(fileEvent.diffs!.length).toBeGreaterThan(0);
      for (const d of fileEvent.diffs!) {
        expect(d.path).toBeTruthy();
        expect(d.diff).toContain('diff --git');
      }
    }

    gate.resolve();
    expect((await expectNextEvent(iterator)).type).toBe('plan:build:implement:complete');
    await expectDone(iterator);
  });

  it('does not re-emit when file list is unchanged (deduplication)', async () => {
    mockGitDiff('src/foo.ts\n');

    const gate = deferred();
    const ctx = makeCtx();
    const iterator = withPeriodicFileCheck(controlledInner(gate.promise), ctx, TEST_INTERVAL_MS)[Symbol.asyncIterator]();

    expect((await expectNextEvent(iterator)).type).toBe('plan:build:implement:start');

    const fileEventPromise = iterator.next();
    await vi.advanceTimersByTimeAsync(TEST_INTERVAL_MS);
    const fileResult = await fileEventPromise;
    expect(fileResult.done).toBe(false);
    expect(fileResult.value.type).toBe('plan:build:files_changed');

    const completionPromise = iterator.next();
    await vi.advanceTimersByTimeAsync(TEST_INTERVAL_MS * 3);
    expect(gitNameOnlyCallCount()).toBeGreaterThanOrEqual(2);
    gate.resolve();
    const completionResult = await completionPromise;

    expect(completionResult.done).toBe(false);
    expect(completionResult.value.type).toBe('plan:build:implement:complete');
    await expectDone(iterator);
  });

  it('is silent on git failure', async () => {
    mockGitDiffError();

    const gate = deferred();
    const ctx = makeCtx();
    const iterator = withPeriodicFileCheck(controlledInner(gate.promise), ctx, TEST_INTERVAL_MS)[Symbol.asyncIterator]();

    expect((await expectNextEvent(iterator)).type).toBe('plan:build:implement:start');

    const completionPromise = iterator.next();
    await vi.advanceTimersByTimeAsync(TEST_INTERVAL_MS);
    expect(gitNameOnlyCallCount()).toBeGreaterThanOrEqual(1);
    gate.resolve();
    const completionResult = await completionPromise;

    expect(completionResult.done).toBe(false);
    expect(completionResult.value.type).toBe('plan:build:implement:complete');
    await expectDone(iterator);
  });

  it('calls iterator.return() on early termination via break', async () => {
    const returnSpy = vi.fn().mockResolvedValue({ done: true, value: undefined });

    async function* neverEnding(): AsyncGenerator<EforgeEvent> {
      let i = 0;
      while (true) {
        yield { type: 'plan:build:implement:progress', planId: 'test-plan', message: `step ${i++}` } as EforgeEvent;
      }
    }

    const inner = neverEnding();
    const origReturn = inner.return.bind(inner);
    inner.return = async (value: any) => {
      returnSpy(value);
      return origReturn(value);
    };

    const ctx = makeCtx();
    const wrapped = withPeriodicFileCheck(inner, ctx, TEST_INTERVAL_MS);

    for await (const _event of wrapped) {
      break;
    }

    expect(returnSpy).toHaveBeenCalled();
  });
});
