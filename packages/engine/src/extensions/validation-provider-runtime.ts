/**
 * Validation provider runtime — provider execution, result normalization,
 * and diagnostic event helpers for extension validation providers.
 */

import { execFile as nodeExecFile, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';

import { createEforgeProjectPaths, type EforgeProjectPaths } from '@eforge-build/extension-sdk/project-paths';
import type { EforgeEvent } from '../events.js';
import type {
  ValidationProviderMetadata,
  ValidationRepairClass,
} from '@eforge-build/extension-sdk';
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
  fix?: string;
  retryGuidance?: string;
  failureKind?: string;
  repairClass?: ValidationRepairClass;
  metadata?: ValidationProviderMetadata;
  metadataRejectionReason?: string;
}

export interface NormalizedValidationResult {
  status: 'passed' | 'failed' | 'skipped';
  message?: string;
  details?: string;
  annotations?: NormalizedValidationAnnotation[];
  command?: string;
  exitCode?: number;
  runtimeFailureKind?: NormalizedValidationFailureKind;
}

// ---------------------------------------------------------------------------
// Context passed to validate functions
// ---------------------------------------------------------------------------

export interface ValidationProviderRuntimeContext {
  planId: string;
  planOutputDir: string;
  worktreePath: string;
  cwd?: string;
  configDir?: string;
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
 * - non-empty `string` → failed unexpected return shape
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
    return unexpectedReturnResult(raw);
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
        ...(status === 'failed' ? { runtimeFailureKind: 'result' as const } : {}),
      };
    }
  }
  // Unknown shape — treat as failure
  return unexpectedReturnResult(raw);
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
  const pathsCwd = ctx.cwd ?? worktreePath;
  const pathsConfigDir = ctx.configDir ?? resolve(pathsCwd, 'eforge');
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
          outcome: { status: 'failed', message: `Validation provider "${providerName}" timed out after ${timeoutMs}ms running: ${cmd}`, command: cmd, runtimeFailureKind: 'timeout' },
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
          outcome: { status: 'failed', message, command: cmd, exitCode, runtimeFailureKind: 'command' },
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
    paths: createEforgeProjectPaths({ cwd: pathsCwd, configDir: pathsConfigDir, extensionName }) as EforgeProjectPaths,
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
      outcome: { status: 'failed', message: `Validation provider "${providerName}" timed out after ${timeoutMs}ms`, runtimeFailureKind: 'timeout' },
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
      outcome: { status: 'failed', message, runtimeFailureKind: 'exception' },
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

const VALIDATION_REPAIR_CLASSES = new Set<ValidationRepairClass>(['narrow', 'structural', 'manual', 'followup']);
const MAX_METADATA_DEPTH = 8;
const MAX_METADATA_NODES = 200;
const MAX_METADATA_STRING_LENGTH = 4096;

function normalizeValidationAnnotations(raw: unknown): NormalizedValidationAnnotation[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const annotations = raw.flatMap((entry): NormalizedValidationAnnotation[] => {
    if (typeof entry !== 'object' || entry === null) return [];
    const obj = entry as Record<string, unknown>;
    if (obj.severity !== 'error' && obj.severity !== 'warning' && obj.severity !== 'info') return [];
    if (typeof obj.message !== 'string') return [];

    const metadataResult = normalizeMetadataProperty(obj);
    const metadataRejectionReason = metadataResult && !metadataResult.ok ? metadataResult.reason : undefined;
    const repairClassResult = normalizeRepairClassProperty(obj);
    const details = appendMetadataRejectionReason(
      appendRepairClassRejectionReason(
        typeof obj.details === 'string' ? obj.details : undefined,
        repairClassResult && !repairClassResult.ok ? repairClassResult.reason : undefined,
      ),
      metadataRejectionReason,
    );

    return [{
      severity: obj.severity,
      message: obj.message,
      ...(typeof obj.file === 'string' ? { file: obj.file } : {}),
      ...(typeof obj.line === 'number' ? { line: obj.line } : {}),
      ...(details !== undefined ? { details } : {}),
      ...(typeof obj.fix === 'string' ? { fix: obj.fix } : {}),
      ...(typeof obj.retryGuidance === 'string' ? { retryGuidance: obj.retryGuidance } : {}),
      ...(typeof obj.failureKind === 'string' ? { failureKind: obj.failureKind } : {}),
      ...(repairClassResult ? { repairClass: repairClassResult.value } : {}),
      ...(metadataResult?.ok ? { metadata: metadataResult.value } : {}),
      ...(metadataRejectionReason !== undefined ? { metadataRejectionReason } : {}),
    }];
  });
  return annotations.length > 0 ? annotations : undefined;
}

function unexpectedReturnResult(raw: unknown): NormalizedValidationResult {
  return {
    status: 'failed',
    message: `Validation provider returned unexpected value: ${safeStringify(raw)}`,
    runtimeFailureKind: 'unexpected-return',
  };
}

function isValidationRepairClass(value: unknown): value is ValidationRepairClass {
  return typeof value === 'string' && VALIDATION_REPAIR_CLASSES.has(value as ValidationRepairClass);
}

type RepairClassResult = { ok: true; value: ValidationRepairClass } | { ok: false; value: 'manual'; reason: string };

function normalizeRepairClassProperty(obj: Record<string, unknown>): RepairClassResult | undefined {
  if (!Object.prototype.hasOwnProperty.call(obj, 'repairClass')) return undefined;
  if (isValidationRepairClass(obj.repairClass)) return { ok: true, value: obj.repairClass };
  return { ok: false, value: 'manual', reason: `invalid repairClass ${safeStringify(obj.repairClass)}; routed as manual` };
}

function appendRepairClassRejectionReason(details: string | undefined, reason: string | undefined): string | undefined {
  if (!reason) return details;
  const line = `Repair class rejected: ${reason}`;
  return details ? `${details}\n${line}` : line;
}

function appendMetadataRejectionReason(details: string | undefined, reason: string | undefined): string | undefined {
  if (!reason) return details;
  const line = `Metadata rejected: ${reason}`;
  return details ? `${details}\n${line}` : line;
}

type MetadataResult = { ok: true; value: ValidationProviderMetadata } | { ok: false; reason: string };

function normalizeMetadataProperty(obj: Record<string, unknown>): MetadataResult | undefined {
  try {
    return Object.prototype.hasOwnProperty.call(obj, 'metadata')
      ? normalizeMetadata(obj.metadata)
      : undefined;
  } catch (error) {
    return { ok: false, reason: `metadata traversal failed: ${errorMessage(error)}` };
  }
}

function normalizeMetadata(raw: unknown): MetadataResult {
  try {
    const state = { nodes: 0 };
    const result = normalizeJsonValue(raw, 'metadata', 0, state);
    if (!result.ok) return result;
    if (!isPlainRecord(result.value)) {
      return { ok: false, reason: 'metadata must be a JSON object' };
    }
    return { ok: true, value: result.value as ValidationProviderMetadata };
  } catch (error) {
    return { ok: false, reason: `metadata traversal failed: ${errorMessage(error)}` };
  }
}

type JsonValueResult = { ok: true; value: unknown } | { ok: false; reason: string };

function normalizeJsonValue(raw: unknown, path: string, depth: number, state: { nodes: number }): JsonValueResult {
  state.nodes += 1;
  if (state.nodes > MAX_METADATA_NODES) {
    return { ok: false, reason: `metadata exceeds maximum node count of ${MAX_METADATA_NODES}` };
  }
  if (depth > MAX_METADATA_DEPTH) {
    return { ok: false, reason: `metadata exceeds maximum depth of ${MAX_METADATA_DEPTH} at ${path}` };
  }
  if (raw === null || typeof raw === 'boolean') return { ok: true, value: raw };
  if (typeof raw === 'string') {
    if (raw.length > MAX_METADATA_STRING_LENGTH) {
      return { ok: false, reason: `metadata string at ${path} exceeds ${MAX_METADATA_STRING_LENGTH} characters` };
    }
    return { ok: true, value: raw };
  }
  if (typeof raw === 'number') {
    return Number.isFinite(raw)
      ? { ok: true, value: raw }
      : { ok: false, reason: `metadata number at ${path} must be finite` };
  }
  if (Array.isArray(raw)) {
    const values: unknown[] = [];
    for (let i = 0; i < raw.length; i++) {
      const item = normalizeJsonValue(raw[i], `${path}[${i}]`, depth + 1, state);
      if (!item.ok) return item;
      values.push(item.value);
    }
    return { ok: true, value: values };
  }
  if (isPlainRecord(raw)) {
    const record: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(raw)) {
      const item = normalizeJsonValue(value, `${path}.${key}`, depth + 1, state);
      if (!item.ok) return item;
      record[key] = item.value;
    }
    return { ok: true, value: record };
  }
  return { ok: false, reason: `metadata value at ${path} is not JSON-safe (${typeof raw})` };
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : safeStringify(error);
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
