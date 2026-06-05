/**
 * Unit tests for the validation provider runtime helper.
 *
 * Covers: passed-via-null, passed-via-undefined, passed-via-structured,
 * failed-via-string, failed-via-structured, skipped, throws-error,
 * exceeds-timeout, command-non-zero-exit, command-timeout.
 */

import { describe, it, expect, vi, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { runValidationProvider, normalizeValidationResult } from '../packages/engine/src/extensions/validation-provider-runtime.js';
import type { ValidationProviderRegistration } from '../packages/engine/src/extensions/types.js';
import type { RunValidationProviderOptions, ValidationProviderRuntimeContext } from '../packages/engine/src/extensions/validation-provider-runtime.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRegistration(spec: {
  name?: string;
  validate?: (...args: unknown[]) => unknown;
  commands?: string[];
}): ValidationProviderRegistration {
  return {
    kind: 'validationProvider',
    extensionName: 'test-ext',
    extensionPath: '/ext/path',
    name: spec.name ?? 'test-validator',
    value: {
      name: spec.name ?? 'test-validator',
      description: 'Test validator',
      ...(spec.validate ? { validate: spec.validate as never } : {}),
      ...(spec.commands ? { commands: spec.commands } : {}),
    },
  };
}

const defaultCtx: ValidationProviderRuntimeContext = {
  planId: 'plan-01',
  planOutputDir: tmpdir(),
  worktreePath: tmpdir(),
};

const defaultOptions: RunValidationProviderOptions = {
  timeoutMs: 5000,
};

// ---------------------------------------------------------------------------
// normalizeValidationResult
// ---------------------------------------------------------------------------

describe('normalizeValidationResult', () => {
  it('null → passed', () => {
    expect(normalizeValidationResult(null)).toEqual({ status: 'passed' });
  });

  it('undefined → passed', () => {
    expect(normalizeValidationResult(undefined)).toEqual({ status: 'passed' });
  });

  it('empty string → passed', () => {
    expect(normalizeValidationResult('')).toEqual({ status: 'passed' });
  });

  it('whitespace-only string → passed', () => {
    expect(normalizeValidationResult('   ')).toEqual({ status: 'passed' });
  });

  it('non-empty string → failed with unexpected-return runtimeFailureKind', () => {
    const result = normalizeValidationResult('lint error');
    expect(result.status).toBe('failed');
    expect(result.message).toContain('unexpected value');
    expect(result.runtimeFailureKind).toBe('unexpected-return');
  });

  it('structured passed → passed', () => {
    expect(normalizeValidationResult({ status: 'passed', message: 'ok' })).toEqual({ status: 'passed', message: 'ok' });
  });

  it('structured failed → failed with result runtimeFailureKind', () => {
    expect(normalizeValidationResult({ status: 'failed', message: 'bad', details: 'output' })).toEqual({
      status: 'failed',
      message: 'bad',
      details: 'output',
      runtimeFailureKind: 'result',
    });
  });

  it('structured failed preserves annotation guidance and valid metadata', () => {
    const annotations = [{
      severity: 'error' as const,
      message: 'bad line',
      file: 'src/a.ts',
      line: 7,
      details: 'TS2345',
      fix: 'Fix the type mismatch',
      retryGuidance: 'Retry narrowly in src/a.ts',
      failureKind: 'typescript-diagnostic',
      repairClass: 'structural' as const,
      metadata: { code: 'TS2345', nested: { safe: true }, lines: [7] },
    }];
    expect(normalizeValidationResult({ status: 'failed', message: 'bad', annotations })).toEqual({
      status: 'failed',
      message: 'bad',
      annotations,
      runtimeFailureKind: 'result',
    });
  });

  it('structured failed omits invalid metadata and adds a deterministic rejection detail', () => {
    const result = normalizeValidationResult({
      status: 'failed',
      message: 'bad',
      annotations: [{ severity: 'error', message: 'bad line', metadata: { fn: () => undefined } }],
    });

    expect(result.status).toBe('failed');
    expect(result.annotations?.[0].metadata).toBeUndefined();
    expect(result.annotations?.[0].details).toContain('Metadata rejected:');
    expect(result.annotations?.[0].metadataRejectionReason).toContain('metadata.fn');
    expect(result.runtimeFailureKind).toBe('result');
  });

  it('structured failed rejects metadata traversal errors without throwing', () => {
    const metadata = new Proxy({ ok: true }, {
      ownKeys() {
        throw new Error('metadata trap');
      },
    });

    const result = normalizeValidationResult({
      status: 'failed',
      message: 'bad',
      annotations: [{ severity: 'error', message: 'bad line', metadata }],
    });

    expect(result.status).toBe('failed');
    expect(result.annotations?.[0].metadata).toBeUndefined();
    expect(result.annotations?.[0].metadataRejectionReason).toContain('metadata traversal failed: metadata trap');
    expect(result.runtimeFailureKind).toBe('result');
  });

  it('structured passed preserves annotations without runtimeFailureKind', () => {
    const annotations = [{ severity: 'info' as const, message: 'note', file: 'src/a.ts', line: 7 }];
    expect(normalizeValidationResult({ status: 'passed', message: 'ok', annotations })).toEqual({
      status: 'passed',
      message: 'ok',
      annotations,
    });
  });

  it('structured skipped preserves annotations without runtimeFailureKind', () => {
    const annotations = [{ severity: 'warning' as const, message: 'not checked', file: 'src/a.ts', line: 7 }];
    expect(normalizeValidationResult({ status: 'skipped', message: 'not applicable', annotations })).toEqual({
      status: 'skipped',
      message: 'not applicable',
      annotations,
    });
  });

  it('structured skipped → skipped', () => {
    expect(normalizeValidationResult({ status: 'skipped', message: 'not applicable' })).toEqual({
      status: 'skipped',
      message: 'not applicable',
    });
  });

  it('unknown object → failed', () => {
    const result = normalizeValidationResult({ foo: 'bar' });
    expect(result.status).toBe('failed');
    expect(result.message).toContain('unexpected value');
    expect(result.runtimeFailureKind).toBe('unexpected-return');
  });
});

// ---------------------------------------------------------------------------
// runValidationProvider — function form
// ---------------------------------------------------------------------------

describe('runValidationProvider (function form)', () => {
  afterEach(() => {
    // Guard against a test that fails mid-flight after vi.useFakeTimers() leaving
    // fake timers in place for subsequent tests in this describe block.
    vi.useRealTimers();
  });

  it('passed-via-null emits start+complete(passed) and returns passed', async () => {
    const reg = makeRegistration({ validate: () => null });
    const result = await runValidationProvider(reg, defaultCtx, defaultOptions);

    expect(result.outcome.status).toBe('passed');
    const types = result.events.map((e) => e.type);
    expect(types).toContain('extension:validation-provider:start');
    expect(types).toContain('extension:validation-provider:complete');
    expect(result.events.find((e) => e.type === 'extension:validation-provider:complete')).toMatchObject({
      status: 'passed',
    });
  });

  it('passed-via-undefined emits start+complete(passed) and returns passed', async () => {
    const reg = makeRegistration({ validate: () => undefined });
    const result = await runValidationProvider(reg, defaultCtx, defaultOptions);

    expect(result.outcome.status).toBe('passed');
    expect(result.events.some((e) => e.type === 'extension:validation-provider:complete')).toBe(true);
  });

  it('passed-via-structured emits start+complete(passed)', async () => {
    const reg = makeRegistration({ validate: () => ({ status: 'passed' as const, message: 'all good' }) });
    const result = await runValidationProvider(reg, defaultCtx, defaultOptions);

    expect(result.outcome.status).toBe('passed');
    expect(result.outcome.message).toBe('all good');
    expect(result.events.find((e) => e.type === 'extension:validation-provider:complete')).toMatchObject({
      status: 'passed',
      message: 'all good',
    });
  });

  it('failed-via-string emits start+error(failed) and returns unexpected-return failure', async () => {
    const reg = makeRegistration({ validate: () => 'lint errors found' });
    const result = await runValidationProvider(reg, defaultCtx, defaultOptions);

    expect(result.outcome.status).toBe('failed');
    expect(result.outcome.message).toContain('unexpected value');
    expect(result.outcome.runtimeFailureKind).toBe('unexpected-return');
    expect(result.events.find((e) => e.type === 'extension:validation-provider:error')).toMatchObject({
      status: 'failed',
      message: expect.stringContaining('unexpected value'),
    });
  });

  it('failed-via-structured emits start+error(failed) and returns failed', async () => {
    const reg = makeRegistration({ validate: () => ({ status: 'failed' as const, message: 'type errors', details: 'TS2345' }) });
    const result = await runValidationProvider(reg, defaultCtx, defaultOptions);

    expect(result.outcome.status).toBe('failed');
    expect(result.outcome.message).toBe('type errors');
    expect(result.outcome.details).toBe('TS2345');
    expect(result.outcome.runtimeFailureKind).toBe('result');
    const errorEvt = result.events.find((e) => e.type === 'extension:validation-provider:error') as Record<string, unknown> | undefined;
    expect(errorEvt).toMatchObject({ status: 'failed', message: 'type errors', details: 'TS2345' });
  });

  it('failed-via-structured preserves normalized annotations', async () => {
    const annotations = [{ severity: 'error' as const, message: 'bad line', file: 'src/a.ts', line: 7, details: 'TS2345' }];
    const reg = makeRegistration({ validate: () => ({ status: 'failed' as const, message: 'type errors', annotations }) });
    const result = await runValidationProvider(reg, defaultCtx, defaultOptions);

    expect(result.outcome.status).toBe('failed');
    expect(result.outcome.runtimeFailureKind).toBe('result');
    expect(result.outcome.annotations).toEqual(annotations);
  });

  it('skipped emits start+complete(skipped) and returns skipped', async () => {
    const reg = makeRegistration({ validate: () => ({ status: 'skipped' as const, message: 'not applicable' }) });
    const result = await runValidationProvider(reg, defaultCtx, defaultOptions);

    expect(result.outcome.status).toBe('skipped');
    expect(result.events.find((e) => e.type === 'extension:validation-provider:complete')).toMatchObject({
      status: 'skipped',
      message: 'not applicable',
    });
  });

  it('throws-error emits start+error event and returns failed', async () => {
    const reg = makeRegistration({ validate: () => { throw new Error('unexpected crash'); } });
    const result = await runValidationProvider(reg, defaultCtx, defaultOptions);

    expect(result.outcome.status).toBe('failed');
    expect(result.outcome.message).toContain('unexpected crash');
    expect(result.outcome.runtimeFailureKind).toBe('exception');
    expect(result.events.find((e) => e.type === 'extension:validation-provider:error')).toMatchObject({
      status: 'failed',
      message: expect.stringContaining('unexpected crash'),
    });
  });

  it('exceeds-timeout emits start+timeout event and returns failed', async () => {
    vi.useFakeTimers();
    const reg = makeRegistration({ validate: () => new Promise(() => { /* never resolves */ }) });
    const runPromise = runValidationProvider(reg, defaultCtx, { timeoutMs: 100 });
    vi.advanceTimersByTime(200);
    const result = await runPromise;
    vi.useRealTimers();

    expect(result.outcome.status).toBe('failed');
    expect(result.outcome.message).toContain('timed out');
    expect(result.outcome.runtimeFailureKind).toBe('timeout');
    expect(result.events.find((e) => e.type === 'extension:validation-provider:timeout')).toMatchObject({
      timeoutMs: 100,
    });
  });

  it('passes planOutputDir as first arg (backward-compat with legacy string form)', async () => {
    let receivedArg: unknown;
    const reg = makeRegistration({ validate: (dir) => { receivedArg = dir; return null; } });
    await runValidationProvider(reg, defaultCtx, defaultOptions);

    expect(receivedArg).toBe(defaultCtx.planOutputDir);
  });

  it('passes a populated ValidationProviderContext as the second arg', async () => {
    let receivedCtx: Record<string, unknown> | undefined;
    const reg = makeRegistration({
      validate: (_dir, ctx) => { receivedCtx = ctx as Record<string, unknown>; return null; },
    });
    const ctx: ValidationProviderRuntimeContext = {
      ...defaultCtx,
      changedFiles: ['src/foo.ts'],
    };
    await runValidationProvider(reg, ctx, defaultOptions);

    expect(receivedCtx).toBeDefined();
    expect(receivedCtx?.planId).toBe(ctx.planId);
    expect(receivedCtx?.planOutputDir).toBe(ctx.planOutputDir);
    expect(receivedCtx?.worktreePath).toBe(ctx.worktreePath);
    expect(receivedCtx?.changedFiles).toEqual(['src/foo.ts']);
    expect(typeof receivedCtx?.logger).toBe('object');
    expect(typeof receivedCtx?.exec).toBe('object');
  });

  it('passes ctx.paths using provider extension name and worktree cwd by default', async () => {
    let storagePath: string | undefined;
    const reg = makeRegistration({
      validate: (_dir, ctx) => {
        const c = ctx as { paths: { extensionStoragePath(scope: 'project-local', segments: string[]): string } };
        storagePath = c.paths.extensionStoragePath('project-local', ['validate.json']);
        return null;
      },
    });
    await runValidationProvider(reg, defaultCtx, defaultOptions);

    expect(storagePath).toBe(`${defaultCtx.worktreePath}/.eforge/storage/extensions/test-ext/validate.json`);
  });

  it('ctx.exec.run actually spawns a subprocess and returns its output', async () => {
    let execResult: { stdout: string; stderr: string; exitCode: number } | undefined;
    const reg = makeRegistration({
      validate: async (_dir, ctx) => {
        const c = ctx as { exec: { run: (cmd: string, args?: string[], opts?: unknown) => Promise<{ stdout: string; stderr: string; exitCode: number }> } };
        execResult = await c.exec.run('node', ['-e', "process.stdout.write('hello'); process.exit(0)"]);
        return null;
      },
    });
    await runValidationProvider(reg, defaultCtx, defaultOptions);

    expect(execResult).toBeDefined();
    expect(execResult?.exitCode).toBe(0);
    expect(execResult?.stdout).toContain('hello');
  });

  it('ctx.exec.run returns the actual exit code for a failing command', async () => {
    let execResult: { stdout: string; stderr: string; exitCode: number } | undefined;
    const reg = makeRegistration({
      validate: async (_dir, ctx) => {
        const c = ctx as { exec: { run: (cmd: string, args?: string[], opts?: unknown) => Promise<{ stdout: string; stderr: string; exitCode: number }> } };
        execResult = await c.exec.run('node', ['-e', 'process.exit(7)']);
        return null;
      },
    });
    await runValidationProvider(reg, defaultCtx, defaultOptions);

    expect(execResult).toBeDefined();
    expect(execResult?.exitCode).toBe(7);
  });

  it('structured failed without message uses a default error message', async () => {
    const reg = makeRegistration({ validate: () => ({ status: 'failed' as const }) });
    const result = await runValidationProvider(reg, defaultCtx, defaultOptions);

    expect(result.outcome.status).toBe('failed');
    const errorEvt = result.events.find((e) => e.type === 'extension:validation-provider:error') as Record<string, unknown> | undefined;
    expect(errorEvt).toBeDefined();
    expect(typeof errorEvt?.message).toBe('string');
    expect((errorEvt?.message as string).length).toBeGreaterThan(0);
  });

  it('emits start event with kind=validate', async () => {
    const reg = makeRegistration({ validate: () => null });
    const result = await runValidationProvider(reg, defaultCtx, defaultOptions);

    const startEvt = result.events.find((e) => e.type === 'extension:validation-provider:start') as Record<string, unknown> | undefined;
    expect(startEvt).toBeDefined();
    expect(startEvt?.kind).toBe('validate');
    expect(startEvt?.providerName).toBe('test-validator');
    expect(startEvt?.extensionName).toBe('test-ext');
  });
});

// ---------------------------------------------------------------------------
// runValidationProvider — command form
// ---------------------------------------------------------------------------

describe('runValidationProvider (command form)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('command-non-zero-exit emits start+error and returns failed', async () => {
    // Use a command that reliably fails (no shell quoting — execFile passes args directly)
    const reg = makeRegistration({ commands: ['node -e process.exit(1)'] });
    const result = await runValidationProvider(reg, defaultCtx, defaultOptions);

    expect(result.outcome.status).toBe('failed');
    expect(result.outcome.exitCode).toBe(1);
    expect(result.outcome.runtimeFailureKind).toBe('command');
    const errorEvt = result.events.find((e) => e.type === 'extension:validation-provider:error') as Record<string, unknown> | undefined;
    expect(errorEvt).toBeDefined();
    expect(errorEvt?.command).toBe('node -e process.exit(1)');
    expect(errorEvt?.exitCode).toBe(1);
    expect(errorEvt?.status).toBe('failed');
  });

  it('stops at first failing command and does not run subsequent commands', async () => {
    const reg = makeRegistration({
      commands: ['node -e process.exit(1)', 'node -e process.exit(0)'],
    });
    const result = await runValidationProvider(reg, defaultCtx, defaultOptions);

    expect(result.outcome.status).toBe('failed');
    expect(result.outcome.runtimeFailureKind).toBe('command');
    // Only one error event (from the first command); no complete event since we returned early.
    const errorEvts = result.events.filter((e) => e.type === 'extension:validation-provider:error');
    expect(errorEvts).toHaveLength(1);
    expect((errorEvts[0] as Record<string, unknown>).command).toBe('node -e process.exit(1)');
    expect(result.events.find((e) => e.type === 'extension:validation-provider:complete')).toBeUndefined();
  });

  it('command-passes emits start+complete(passed) when exit code is 0', async () => {
    const reg = makeRegistration({ commands: ['node -e process.exit(0)'] });
    const result = await runValidationProvider(reg, defaultCtx, defaultOptions);

    expect(result.outcome.status).toBe('passed');
    expect(result.events.find((e) => e.type === 'extension:validation-provider:complete')).toMatchObject({
      status: 'passed',
    });
  });

  it('emits start event with kind=commands and commandCount', async () => {
    const reg = makeRegistration({ commands: ['node -e process.exit(0)', 'node -e process.exit(0)'] });
    const result = await runValidationProvider(reg, defaultCtx, defaultOptions);

    const startEvt = result.events.find((e) => e.type === 'extension:validation-provider:start') as Record<string, unknown> | undefined;
    expect(startEvt).toBeDefined();
    expect(startEvt?.kind).toBe('commands');
    expect(startEvt?.commandCount).toBe(2);
  });

  it('command-timeout emits start+timeout and returns failed', async () => {
    vi.useFakeTimers();
    // Use a command that would never complete (we fake-advance timers to trigger the timeout)
    const reg = makeRegistration({ commands: ['node -e process.stdin.resume()'] });
    const runPromise = runValidationProvider(reg, defaultCtx, { timeoutMs: 50 });
    vi.advanceTimersByTime(200);
    const result = await runPromise;
    vi.useRealTimers();

    expect(result.outcome.status).toBe('failed');
    expect(result.outcome.runtimeFailureKind).toBe('timeout');
    const timeoutEvt = result.events.find((e) => e.type === 'extension:validation-provider:timeout') as Record<string, unknown> | undefined;
    expect(timeoutEvt).toBeDefined();
    expect(timeoutEvt?.timeoutMs).toBe(50);
  });
});
