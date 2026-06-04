import { randomUUID } from 'node:crypto';

import { safeParseWithSchema, type ExtensionActionRequestedBy, type ExtensionJsonValue, type ValueError } from '@eforge-build/client';
import type { TSchema } from '@sinclair/typebox';

import { validateJsonSafeValue, jsonSafeClone } from './contribution-validation.js';
import type { ActionRegistration, NativeExtensionRegistry } from './types.js';

// --- eforge:region plan-02-engine-registry-runtime ---
export interface DispatchExtensionActionOptions {
  actionId: string;
  input: Record<string, unknown>;
  requestedBy: ExtensionActionRequestedBy;
  cwd: string;
  timeoutMs: number;
  invocationId?: string;
}

export type DispatchExtensionActionResult =
  | { kind: 'success'; invocationId: string; actionId: string; extensionName: string; extensionPath: string; requestedBy: ExtensionActionRequestedBy; durationMs: number; output: ExtensionJsonValue }
  | { kind: 'unknown-action'; invocationId: string; actionId: string; requestedBy: ExtensionActionRequestedBy; message: string }
  | { kind: 'invalid-input' | 'handler-error' | 'timeout' | 'invalid-output' | 'output-schema-failed'; invocationId: string; actionId: string; extensionName: string; extensionPath: string; requestedBy: ExtensionActionRequestedBy; durationMs: number; message: string; validationErrors?: Array<{ path: string; message: string }>; timeoutMs?: number };

export async function dispatchExtensionAction(
  registry: NativeExtensionRegistry,
  options: DispatchExtensionActionOptions,
): Promise<DispatchExtensionActionResult> {
  const invocationId = options.invocationId ?? randomUUID();
  const action = registry.actions.find((entry) => entry.id === options.actionId);
  if (!action) {
    return {
      kind: 'unknown-action',
      invocationId,
      actionId: options.actionId,
      requestedBy: options.requestedBy,
      message: `Unknown extension action "${options.actionId}"`,
    };
  }
  const started = Date.now();
  const parsedInput = safeParseWithSchema(action.value.inputSchema as TSchema, options.input);
  if (!parsedInput.success) {
    return failure('invalid-input', action, options, invocationId, started, 'Action input failed schema validation', parsedInput.error.errors);
  }

  let rawOutput: unknown;
  try {
    rawOutput = await runWithTimeout(
      Promise.resolve().then(() => action.value.handler(parsedInput.data as Record<string, unknown>, buildActionContext(action, options, invocationId))),
      options.timeoutMs,
    );
  } catch (err) {
    if (err instanceof TimeoutError) {
      return failure('timeout', action, options, invocationId, started, `Action handler timed out after ${options.timeoutMs}ms`, undefined, options.timeoutMs);
    }
    logHandlerError(action, err);
    return failure('handler-error', action, options, invocationId, started, 'Action handler failed');
  }

  if (rawOutput === undefined) {
    return failure('invalid-output', action, options, invocationId, started, 'Action output must be JSON-safe and must not be undefined');
  }
  const jsonSafe = validateJsonSafeValue(rawOutput, { requireObjectRoot: false, rejectSymbolKeys: true });
  if (!jsonSafe.ok) {
    return failure('invalid-output', action, options, invocationId, started, `Action output is not JSON-safe: ${jsonSafe.message ?? 'invalid value'}`);
  }
  const output = jsonSafeClone(rawOutput) as ExtensionJsonValue;
  if (action.value.outputSchema !== undefined) {
    const parsedOutput = safeParseWithSchema(action.value.outputSchema as TSchema, output);
    if (!parsedOutput.success) {
      return failure('output-schema-failed', action, options, invocationId, started, 'Action output failed schema validation', parsedOutput.error.errors);
    }
  }
  return {
    kind: 'success',
    invocationId,
    actionId: options.actionId,
    extensionName: action.extensionName,
    extensionPath: action.extensionPath,
    requestedBy: options.requestedBy,
    durationMs: Date.now() - started,
    output,
  };
}

function buildActionContext(action: ActionRegistration, options: DispatchExtensionActionOptions, invocationId: string) {
  return {
    invocationId,
    actionId: action.id,
    requestedBy: options.requestedBy,
    cwd: options.cwd,
    logger: buildLogger(action),
  };
}

function buildLogger(action: ActionRegistration) {
  const prefix = `[eforge extension ${action.extensionName} action ${action.id}]`;
  const write = (level: string, message: string): void => {
    process.stderr.write(`${prefix} ${level}: ${message}\n`);
  };
  return {
    debug: (message: string) => write('debug', message),
    info: (message: string) => write('info', message),
    warn: (message: string) => write('warn', message),
    error: (message: string) => write('error', message),
  };
}

function runWithTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timeout = setTimeout(() => reject(new TimeoutError()), Math.max(0, timeoutMs));
  });
  promise.catch(() => undefined);
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeout !== undefined) clearTimeout(timeout);
  });
}

function failure(
  kind: Exclude<DispatchExtensionActionResult['kind'], 'success' | 'unknown-action'>,
  action: ActionRegistration,
  options: DispatchExtensionActionOptions,
  invocationId: string,
  started: number,
  message: string,
  validationErrors?: ValueError[],
  timeoutMs?: number,
): DispatchExtensionActionResult {
  return {
    kind,
    invocationId,
    actionId: options.actionId,
    extensionName: action.extensionName,
    extensionPath: action.extensionPath,
    requestedBy: options.requestedBy,
    durationMs: Date.now() - started,
    message,
    ...(validationErrors !== undefined && { validationErrors: validationErrors.map((error) => ({ path: error.path, message: error.message })) }),
    ...(timeoutMs !== undefined && { timeoutMs }),
  };
}

function logHandlerError(action: ActionRegistration, err: unknown): void {
  const name = err instanceof Error ? err.name : typeof err;
  process.stderr.write(`[eforge extension ${action.extensionName} action ${action.id}] handler-error: ${name}\n`);
}

class TimeoutError extends Error {}
// --- eforge:endregion plan-02-engine-registry-runtime ---
