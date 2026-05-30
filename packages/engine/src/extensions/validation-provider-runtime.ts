/**
 * Validation provider runtime — provider execution, result normalization,
 * and diagnostic event helpers for extension validation providers.
 */

import { execFile as nodeExecFile, type ChildProcess } from 'node:child_process';

import type { EforgeEvent } from '../events.js';
import type { ValidationProviderRegistration } from './types.js';
import { runExec } from './event-runtime.js';

interface ExecFileResult { stdout: string; stderr: string }
interface ExecFileError extends Error { code?: number; killed?: boolean; signal?: string; stdout?: string; stderr?: string }

/**
 * Spawn `executable` with `args` in `cwd` and return the captured output.
 * Returns the child process so the caller can `.kill()` it on timeout, plus
 * the settle promise.
 */
function execFileWithChild(
  executable: string,
  args: string[],
  cwd: string,
): { child: ChildProcess; result: Promise<ExecFileResult> } {
  let child!: ChildProcess;
  const result = new Promise<ExecFileResult>((resolve, reject) => {
    child = nodeExecFile(executable, args, { cwd }, (err, rawStdout, rawStderr) => {
      const stdout = String(rawStdout ?? '');
      const stderr = String(rawStderr ?? '');
      if (err) {
        const e = err as ExecFileError;
        e.stdout = stdout;
        e.stderr = stderr;
        reject(e);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
  return { child, result };
}

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export type NormalizedValidationFailureKind = 'result' | 'command' | 'timeout' | 'exception' | 'unexpected-return';

export interface NormalizedValidationAnnotation {
  severity: 'error' | 'warning' | 'info';
  message: string;
  file?: string;
  line?: number;
  details?: string;
}

export interface NormalizedValidationResult {
  status: 'passed' | 'failed' | 'skipped';
  message?: string;
  details?: string;
  annotations?: NormalizedValidationAnnotation[];
  command?: string;
  exitCode?: number;
  failureKind?: NormalizedValidationFailureKind;
}

// ---------------------------------------------------------------------------
// Context passed to validate functions
// ---------------------------------------------------------------------------

export interface ValidationProviderRuntimeContext {
  planId: string;
  planOutputDir: string;
  worktreePath: string;
  signal?: AbortSignal;
  changedFiles?: string[];
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface RunValidationProviderOptions {
  timeoutMs: number;
}

// ---------------------------------------------------------------------------
// Result normalization
// ---------------------------------------------------------------------------

/**
 * Normalize the raw return value of a `validate` function into a structured
 * `NormalizedValidationResult`.
 *
 * - `null` / `undefined` → `{ status: 'passed' }`
 * - non-empty `string` → `{ status: 'failed', message }`
 * - `ValidationProviderResult` object → passed through (status-keyed)
 */
export function normalizeValidationResult(raw: unknown): NormalizedValidationResult {
  if (raw === null || raw === undefined) {
    return { status: 'passed' };
  }
  if (typeof raw === 'string') {
    if (raw.trim().length === 0) {
      return { status: 'passed' };
    }
    return { status: 'failed', message: raw, failureKind: 'result' };
  }
  if (typeof raw === 'object' && raw !== null && 'status' in raw) {
    const obj = raw as { status: unknown; message?: unknown; details?: unknown; annotations?: unknown };
    const status = obj.status;
    if (status === 'passed' || status === 'failed' || status === 'skipped') {
      const message = typeof obj.message === 'string' ? obj.message : undefined;
      const details = typeof obj.details === 'string' ? obj.details : undefined;
      const annotations = normalizeValidationAnnotations(obj.annotations);
      return {
        status,
        ...(message !== undefined ? { message } : {}),
        ...(details !== undefined ? { details } : {}),
        ...(annotations !== undefined ? { annotations } : {}),
        ...(status === 'failed' ? { failureKind: 'result' as const } : {}),
      };
    }
  }
  // Unknown shape — treat as failure
  return { status: 'failed', message: `Validation provider returned unexpected value: ${safeStringify(raw)}`, failureKind: 'unexpected-return' };
}

// ---------------------------------------------------------------------------
// Run a single validation provider
// ---------------------------------------------------------------------------

export interface RunValidationProviderResult {
  outcome: NormalizedValidationResult;
  events: EforgeEvent[];
}

/**
 * Run a single validation provider registration with a timeout and return the
 * normalized outcome plus lifecycle events.
 *
 * This function is fail-closed for outcomes (errors/timeouts become `failed`)
 * but daemon-safe (never throws upward).
 */
export async function runValidationProvider(
  registration: ValidationProviderRegistration,
  ctx: ValidationProviderRuntimeContext,
  options: RunValidationProviderOptions,
): Promise<RunValidationProviderResult> {
  const { timeoutMs } = options;
  const { planId, planOutputDir, worktreePath, signal, changedFiles } = ctx;
  const { extensionName, extensionPath, name: providerName } = registration;
  const spec = registration.value;
  const timestamp = new Date().toISOString();

  const events: EforgeEvent[] = [];

  const kind: 'validate' | 'commands' = spec.commands ? 'commands' : 'validate';
  const commandCount = spec.commands?.length;

  events.push({
    type: 'extension:validation-provider:start',
    timestamp,
    planId,
    providerName,
    extensionName,
    extensionPath,
    kind,
    ...(commandCount !== undefined ? { commandCount } : {}),
  });

  if (kind === 'commands') {
    // Command form: run each command in sequence
    for (const cmd of spec.commands!) {
      const parts = cmd.trim().split(/\s+/);
      const executable = parts[0];
      const args = parts.slice(1);

      let exitCode: number;
      let stderr: string;
      let stdout: string;

      const { child, result: execResult } = execFileWithChild(executable, args, worktreePath);
      const result = await withTimeout(execResult, timeoutMs);
      if (result.kind === 'timeout') {
        // Kill the child process so we don't leak processes when a command hangs.
        if (!child.killed) {
          try { child.kill('SIGTERM'); } catch { /* best-effort */ }
        }
        const errorTs = new Date().toISOString();
        events.push({
          type: 'extension:validation-provider:timeout',
          timestamp: errorTs,
          planId,
          providerName,
          extensionName,
          extensionPath,
          timeoutMs,
          command: cmd,
        });
        return {
          outcome: { status: 'failed', message: `Validation provider "${providerName}" timed out after ${timeoutMs}ms running: ${cmd}`, command: cmd, failureKind: 'timeout' },
          events,
        };
      }
      if (result.kind === 'error') {
        const errObj = result.error as ExecFileError;
        exitCode = typeof errObj.code === 'number' ? errObj.code : 1;
        stderr = errObj.stderr ?? String(result.error);
        stdout = errObj.stdout ?? '';
      } else {
        exitCode = 0;
        stderr = result.value.stderr;
        stdout = result.value.stdout;
      }

      if (exitCode !== 0) {
        const errorTs = new Date().toISOString();
        const message = stderr.trim() || stdout.trim() || `Command exited with code ${exitCode}`;
        events.push({
          type: 'extension:validation-provider:error',
          timestamp: errorTs,
          planId,
          providerName,
          extensionName,
          extensionPath,
          status: 'failed',
          message,
          command: cmd,
          exitCode,
        });
        return {
          outcome: { status: 'failed', message, command: cmd, exitCode, failureKind: 'command' },
          events,
        };
      }
    }

    // All commands passed
    const completeTs = new Date().toISOString();
    events.push({
      type: 'extension:validation-provider:complete',
      timestamp: completeTs,
      planId,
      providerName,
      extensionName,
      extensionPath,
      status: 'passed',
    });
    return { outcome: { status: 'passed' }, events };
  }

  // Function form
  const validateFn = spec.validate!;

  // Build a minimal logger and exec API for the context passed to validate
  const noopLogger = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
  };
  // Local AbortController scoped to this validate call. It aborts when either
  // the parent build's `ctx.signal` aborts OR the local `withTimeout` fires —
  // so any subprocess spawned via `ctx.exec.run` is killed when the validate
  // function's wall-clock budget is exhausted (matching the command-form path,
  // which explicitly kills its child on timeout).
  const execAbort = new AbortController();
  const onParentAbort = (): void => execAbort.abort();
  if (signal) {
    if (signal.aborted) execAbort.abort();
    else signal.addEventListener('abort', onParentAbort, { once: true });
  }

  const exec = {
    run: (command: string, args: string[] = [], opts: { cwd?: string; env?: Record<string, string> } = {}) =>
      runExec(command, args, {
        cwd: opts.cwd ?? worktreePath,
        env: opts.env ? { ...process.env, ...opts.env } : process.env,
        signal: execAbort.signal,
      }),
  };

  const providerCtx = {
    planId,
    planOutputDir,
    worktreePath,
    logger: noopLogger,
    exec,
    signal,
    changedFiles,
  };

  const callPromise = Promise.resolve().then(() =>
    (validateFn as (a: unknown, b?: unknown) => unknown)(planOutputDir, providerCtx),
  );

  const result = await withTimeout(callPromise, timeoutMs);

  // Detach the parent-signal listener; abort the local controller so any
  // subprocesses still in flight are killed before we return.
  if (signal) signal.removeEventListener('abort', onParentAbort);
  if (!execAbort.signal.aborted) execAbort.abort();

  if (result.kind === 'timeout') {
    const errorTs = new Date().toISOString();
    events.push({
      type: 'extension:validation-provider:timeout',
      timestamp: errorTs,
      planId,
      providerName,
      extensionName,
      extensionPath,
      timeoutMs,
    });
    return {
      outcome: { status: 'failed', message: `Validation provider "${providerName}" timed out after ${timeoutMs}ms`, failureKind: 'timeout' },
      events,
    };
  }

  if (result.kind === 'error') {
    const errorTs = new Date().toISOString();
    const message = result.error instanceof Error ? result.error.message : String(result.error);
    events.push({
      type: 'extension:validation-provider:error',
      timestamp: errorTs,
      planId,
      providerName,
      extensionName,
      extensionPath,
      status: 'failed',
      message,
    });
    return {
      outcome: { status: 'failed', message, failureKind: 'exception' },
      events,
    };
  }

  const normalized = normalizeValidationResult(result.value);

  const outcomeTs = new Date().toISOString();
  if (normalized.status === 'passed' || normalized.status === 'skipped') {
    events.push({
      type: 'extension:validation-provider:complete',
      timestamp: outcomeTs,
      planId,
      providerName,
      extensionName,
      extensionPath,
      status: normalized.status,
      ...(normalized.message ? { message: normalized.message } : {}),
    });
  } else {
    // failed
    events.push({
      type: 'extension:validation-provider:error',
      timestamp: outcomeTs,
      planId,
      providerName,
      extensionName,
      extensionPath,
      status: 'failed',
      message: normalized.message ?? 'Validation failed',
      ...(normalized.details ? { details: normalized.details } : {}),
    });
  }

  return { outcome: normalized, events };
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function normalizeValidationAnnotations(raw: unknown): NormalizedValidationAnnotation[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const annotations = raw.flatMap((entry): NormalizedValidationAnnotation[] => {
    if (typeof entry !== 'object' || entry === null) return [];
    const obj = entry as Record<string, unknown>;
    if (obj.severity !== 'error' && obj.severity !== 'warning' && obj.severity !== 'info') return [];
    if (typeof obj.message !== 'string') return [];
    return [{
      severity: obj.severity,
      message: obj.message,
      ...(typeof obj.file === 'string' ? { file: obj.file } : {}),
      ...(typeof obj.line === 'number' ? { line: obj.line } : {}),
      ...(typeof obj.details === 'string' ? { details: obj.details } : {}),
    }];
  });
  return annotations.length > 0 ? annotations : undefined;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    try {
      return String(value);
    } catch {
      return '[unstringifiable value]';
    }
  }
}

type TimeoutResult<T> = { kind: 'value'; value: T } | { kind: 'timeout' } | { kind: 'error'; error: unknown };

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<TimeoutResult<T>> {
  return new Promise<TimeoutResult<T>>((resolve) => {
    const timer = setTimeout(() => resolve({ kind: 'timeout' }), timeoutMs);
    promise.then(
      (val) => { clearTimeout(timer); resolve({ kind: 'value', value: val }); },
      (err) => { clearTimeout(timer); resolve({ kind: 'error', error: err }); },
    );
  });
}
