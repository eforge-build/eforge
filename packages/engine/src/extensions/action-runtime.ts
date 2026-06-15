import { randomUUID } from 'node:crypto';

import { createEforgeProjectPaths } from '@eforge-build/extension-sdk/project-paths';
import { safeParseWithSchema, type ExtensionActionRequestedBy, type ExtensionJsonValue, type ValueError } from '@eforge-build/client';
import type { TSchema } from '@sinclair/typebox';

import { validateJsonSafeValue, jsonSafeClone } from './contribution-validation.js';
import { buildExtensionLookupContext, isContributionAvailable } from './dependency-resolution.js';
import type { ActionRegistration, ExtensionAgentTasksApiShape, ExtensionBuildQueueApiShape, NativeExtensionRegistry } from './types.js';

type ExtensionActionValidationError = ValueError & Record<string, ExtensionJsonValue>;

export interface DispatchExtensionActionOptions {
  actionId: string;
  input: Record<string, unknown>;
  requestedBy: ExtensionActionRequestedBy;
  cwd: string;
  configDir?: string;
  timeoutMs: number;
  invocationId?: string;
  // --- eforge:region extension-agent-task-context ---
  agentTasks?: (extension: { extensionName: string; extensionPath: string }) => ExtensionAgentTasksApiShape;
  // --- eforge:endregion extension-agent-task-context ---
  // --- eforge:region extension-build-queue-context ---
  buildQueue?: (extension: { extensionName: string; extensionPath: string }) => ExtensionBuildQueueApiShape;
  // --- eforge:endregion extension-build-queue-context ---
}

export type DispatchExtensionActionResult =
  | { kind: 'success'; invocationId: string; actionId: string; extensionName: string; extensionPath: string; requestedBy: ExtensionActionRequestedBy; durationMs: number; output: ExtensionJsonValue }
  | { kind: 'unknown-action'; invocationId: string; actionId: string; requestedBy: ExtensionActionRequestedBy; message: string }
  | { kind: 'unavailable'; invocationId: string; actionId: string; extensionName: string; extensionPath: string; requestedBy: ExtensionActionRequestedBy; durationMs: number; message: string }
  | { kind: 'invalid-input' | 'handler-error' | 'timeout' | 'invalid-output' | 'output-schema-failed'; invocationId: string; actionId: string; extensionName: string; extensionPath: string; requestedBy: ExtensionActionRequestedBy; durationMs: number; message: string; validationErrors?: ExtensionActionValidationError[]; timeoutMs?: number };

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
  if (!isContributionAvailable(action)) {
    return failure('unavailable', action, options, invocationId, started, action.availability?.message ?? `Extension action "${options.actionId}" is unavailable`);
  }
  let parsedInput: ReturnType<typeof safeParseWithSchema>;
  try {
    parsedInput = safeParseWithSchema(action.value.inputSchema as TSchema, options.input);
  } catch {
    return failure('invalid-input', action, options, invocationId, started, 'Action input schema is malformed');
  }
  if (!parsedInput.success) {
    return failure('invalid-input', action, options, invocationId, started, 'Action input failed schema validation', parsedInput.error.errors);
  }

  let rawOutput: unknown;
  const controller = new AbortController();
  try {
    rawOutput = await runWithTimeout(
      Promise.resolve().then(() => action.value.handler(parsedInput.data as Record<string, unknown>, buildActionContext(registry, action, options, invocationId, controller.signal))),
      options.timeoutMs,
      controller,
    );
  } catch (err) {
    if (err instanceof TimeoutError) {
      return failure('timeout', action, options, invocationId, started, `Action handler timed out after ${options.timeoutMs}ms`, undefined, options.timeoutMs);
    }
    if (isExtensionActionInputValidationError(err) || isExtensionActionUserError(err)) {
      return failure('invalid-input', action, options, invocationId, started, err.message, err.details);
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
    let parsedOutput: ReturnType<typeof safeParseWithSchema>;
    try {
      parsedOutput = safeParseWithSchema(action.value.outputSchema as TSchema, output);
    } catch {
      return failure('output-schema-failed', action, options, invocationId, started, 'Action output schema is malformed');
    }
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

function buildActionContext(registry: NativeExtensionRegistry, action: ActionRegistration, options: DispatchExtensionActionOptions, invocationId: string, signal: AbortSignal) {
  return {
    invocationId,
    actionId: action.id,
    requestedBy: options.requestedBy,
    cwd: options.cwd,
    signal,
    logger: buildLogger(action),
    paths: createEforgeProjectPaths({ cwd: options.cwd, configDir: options.configDir, extensionName: action.extensionName }),
    ...buildExtensionLookupContext(registry, { extensionName: action.extensionName, extensionPath: action.extensionPath }),
    // --- eforge:region extension-agent-task-context ---
    agentTasks: options.agentTasks?.({ extensionName: action.extensionName, extensionPath: action.extensionPath }) ?? unavailableAgentTasks(),
    // --- eforge:endregion extension-agent-task-context ---
    // --- eforge:region extension-build-queue-context ---
    buildQueue: options.buildQueue?.({ extensionName: action.extensionName, extensionPath: action.extensionPath }) ?? unavailableBuildQueue(),
    // --- eforge:endregion extension-build-queue-context ---
  };
}

// --- eforge:region extension-agent-task-context ---
function unavailableAgentTasks(): ExtensionAgentTasksApiShape {
  const fail = async (): Promise<never> => {
    throw new Error('Extension agent tasks are unavailable in this runtime');
  };
  return {
    start: fail,
    get: fail,
    cancel: fail,
  };
}
// --- eforge:endregion extension-agent-task-context ---

// --- eforge:region extension-build-queue-context ---
function unavailableBuildQueue(): ExtensionBuildQueueApiShape {
  return {
    enqueue: async (): Promise<never> => {
      throw new Error('Extension build queue is unavailable in this runtime');
    },
  };
}
// --- eforge:endregion extension-build-queue-context ---

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

function runWithTimeout<T>(promise: Promise<T>, timeoutMs: number, controller: AbortController): Promise<T> {
  let timeout: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<T>((_, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      reject(new TimeoutError());
    }, Math.max(0, timeoutMs));
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
  validationErrors?: Array<ValueError | ExtensionActionValidationError>,
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
    ...(validationErrors !== undefined && { validationErrors: validationErrors.map(serializeValidationError) }),
    ...(timeoutMs !== undefined && { timeoutMs }),
  };
}

function serializeValidationError(error: ValueError | ExtensionActionValidationError): ExtensionActionValidationError {
  const serialized: Record<string, ExtensionJsonValue> = { path: error.path, message: error.message };
  for (const [key, value] of Object.entries(error)) {
    if (key === 'path' || key === 'message') continue;
    const jsonSafe = validateJsonSafeValue(value, { requireObjectRoot: false, rejectSymbolKeys: true });
    if (jsonSafe.ok) serialized[key] = jsonSafeClone(value) as ExtensionJsonValue;
  }
  return serialized as ExtensionActionValidationError;
}

function logHandlerError(action: ActionRegistration, err: unknown): void {
  const name = err instanceof Error ? err.name : typeof err;
  process.stderr.write(`[eforge extension ${action.extensionName} action ${action.id}] handler-error: ${name}\n`);
}

function isExtensionActionInputValidationError(err: unknown): err is Error & { details: ExtensionActionValidationError[] } {
  return isNamedActionError(err, 'ExtensionActionInputValidationError');
}

function isExtensionActionUserError(err: unknown): err is Error & { details: ExtensionActionValidationError[] } {
  return isNamedActionError(err, 'ExtensionActionUserError');
}

function isNamedActionError(err: unknown, name: string): err is Error & { details: ExtensionActionValidationError[] } {
  if (!(err instanceof Error) || err.name !== name) return false;
  const details = (err as unknown as { details?: unknown }).details;
  return Array.isArray(details) && details.every((detail) => isValueError(detail));
}

function isValueError(value: unknown): value is ExtensionActionValidationError {
  return typeof value === 'object'
    && value !== null
    && typeof (value as { path?: unknown }).path === 'string'
    && typeof (value as { message?: unknown }).message === 'string';
}

class TimeoutError extends Error {}
