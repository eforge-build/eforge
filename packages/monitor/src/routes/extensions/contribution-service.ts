import type {
  EnqueueRequest,
  ExtensionActionInvokeErrorCode,
  ExtensionActionInvokeRequest,
  ExtensionActionInvokeResponse,
  ExtensionActionManifestEntry,
  ExtensionAgentTaskStartRequest,
  ExtensionContributionManifestResponse,
} from '@eforge-build/client';
import type { MonitorContext } from '../../context.js';
import { autoBuildStateToWire } from '../../projections/auto-build-state.js';
import {
  emitExtensionActionComplete,
  emitExtensionActionFailed,
  emitExtensionActionStart,
  emitExtensionActionTimeout,
  type ExtensionActionEventProvenance,
} from './action-events.js';
// --- eforge:region extension-agent-task-context ---
import type { ExtensionAgentTaskService } from './agent-task-service.js';
// --- eforge:endregion extension-agent-task-context ---
import { isHttpRouteError } from '../../http/route-errors.js';
import { prepareEnqueueRequest, markSessionPlanSubmittedAfterEnqueue } from '../enqueue-service.js';

type ExtensionAgentTaskStartRequestWithoutRequester = ExtensionAgentTaskStartRequest extends infer T
  ? T extends unknown ? Omit<T, 'requestedBy'> : never
  : never;

export interface LoadedContributionRuntime {
  config: { extensions: unknown };
  configDir: string;
  registry: unknown;
  manifest: ExtensionContributionManifestResponse;
}

export async function loadContributionRuntime(context: MonitorContext): Promise<LoadedContributionRuntime> {
  if (!context.cwd) throw new Error('Working directory not configured');
  const { loadConfig, getConfigDir, getConventionalConfigDir } = await import('@eforge-build/engine/config');
  const { loadNativeExtensions, buildExtensionContributionManifest } = await import('@eforge-build/engine/extensions/index');
  const { config, warnings } = await loadConfig(context.cwd);
  for (const warning of warnings) process.stderr.write(`${warning}\n`);
  const configDir = await getConfigDir(context.cwd) ?? getConventionalConfigDir(context.cwd);
  const loadResult = await loadNativeExtensions({ cwd: context.cwd, configDir, config: config.extensions });
  const manifest = buildExtensionContributionManifest(loadResult.registry);
  return { config, configDir, registry: loadResult.registry, manifest };
}

export async function getContributionManifest(context: MonitorContext): Promise<ExtensionContributionManifestResponse> {
  return (await loadContributionRuntime(context)).manifest;
}

export async function invokeExtensionAction(
  context: MonitorContext,
  request: ExtensionActionInvokeRequest,
  invocationId: string,
  // --- eforge:region extension-agent-task-context ---
  agentTaskService?: ExtensionAgentTaskService,
  // --- eforge:endregion extension-agent-task-context ---
): Promise<{ status: number; body: ExtensionActionInvokeResponse }> {
  if (request.actionId.trim().length === 0) {
    return {
      status: 400,
      body: failureBody(invocationId, 'invalid-request', 'Action id must be a non-empty string'),
    };
  }

  const runtime = await loadContributionRuntime(context);
  const action = findAction(runtime.manifest, request.actionId);
  if (!action) {
    return {
      status: 404,
      body: failureBody(invocationId, 'unknown-action', `Unknown extension action "${request.actionId}"`),
    };
  }

  const provenance: ExtensionActionEventProvenance = { invocationId, action, requestedBy: request.requestedBy };
  const started = Date.now();
  emitExtensionActionStart(context, provenance);

  let result: Awaited<ReturnType<typeof import('@eforge-build/engine/extensions/index').dispatchExtensionAction>>;
  try {
    const { dispatchExtensionAction } = await import('@eforge-build/engine/extensions/index');
    const dispatchOptions = {
      actionId: request.actionId,
      input: request.input,
      requestedBy: request.requestedBy,
      cwd: context.cwd ?? '',
      configDir: runtime.configDir,
      timeoutMs: getActionTimeoutMs(runtime.config),
      invocationId,
      // --- eforge:region extension-agent-task-context ---
      ...(agentTaskService !== undefined && {
        agentTasks: (extension: { extensionName: string; extensionPath: string }) => ({
          start: (taskRequest: ExtensionAgentTaskStartRequestWithoutRequester) => agentTaskService.start({ ...taskRequest, requestedBy: request.requestedBy } as ExtensionAgentTaskStartRequest, { owner: extension, requestedBy: request.requestedBy, registry: runtime.registry as never }),
          get: (taskId: string) => agentTaskService.get(taskId, extension),
          cancel: (taskId: string, reason?: string) => agentTaskService.cancel(taskId, reason, extension),
        }),
      }),
      // --- eforge:endregion extension-agent-task-context ---
      buildQueue: () => ({
        enqueue: (enqueueRequest: EnqueueRequest) => enqueueFromExtensionAction(context, enqueueRequest),
      }),
      profiles: () => ({
        list: async (profileRequest) => {
          const { projectProfileListResponse } = await import('../profiles.js');
          return projectProfileListResponse(context, profileRequest);
        },
      }),
    } satisfies Parameters<typeof dispatchExtensionAction>[1] & {
      buildQueue: () => { enqueue(enqueueRequest: EnqueueRequest): ReturnType<typeof enqueueFromExtensionAction> };
    };
    result = await dispatchExtensionAction(runtime.registry as never, dispatchOptions);
  } catch (err) {
    const message = sanitizeUnexpectedActionError(err);
    emitExtensionActionFailed(context, provenance, {
      durationMs: Date.now() - started,
      errorCode: 'daemon-unavailable',
      message,
    });
    return { status: 503, body: failureBody(invocationId, 'daemon-unavailable', message) };
  }

  if (result.kind === 'success') {
    emitExtensionActionComplete(context, provenance, result.durationMs);
    return { status: 200, body: { ok: true, invocationId, output: result.output } satisfies ExtensionActionInvokeResponse };
  }

  if (result.kind === 'timeout') {
    emitExtensionActionTimeout(context, provenance, {
      durationMs: result.durationMs,
      timeoutMs: result.timeoutMs ?? getActionTimeoutMs(runtime.config),
      message: result.message,
    });
    return { status: 504, body: failureBody(invocationId, 'timeout', result.message) };
  }
  if (result.kind === 'unknown-action') {
    return { status: 404, body: failureBody(invocationId, 'unknown-action', result.message) };
  }

  const validationErrors = 'validationErrors' in result ? result.validationErrors : undefined;
  emitExtensionActionFailed(context, provenance, {
    durationMs: result.durationMs,
    errorCode: result.kind,
    message: result.message,
    ...(validationErrors !== undefined && { validationErrors }),
  });
  return {
    status: statusForFailure(result.kind),
    body: failureBody(invocationId, result.kind, result.message, validationErrors),
  };
}

export function failureBody(
  invocationId: string,
  code: ExtensionActionInvokeErrorCode,
  message: string,
  details?: unknown,
): ExtensionActionInvokeResponse {
  return {
    ok: false,
    invocationId,
    error: {
      code,
      message,
      ...(details !== undefined && { details: details as never }),
    },
  } satisfies ExtensionActionInvokeResponse;
}

function findAction(manifest: ExtensionContributionManifestResponse, actionId: string): ExtensionActionManifestEntry | undefined {
  return manifest.actions.find((entry) => entry.id === actionId);
}

async function enqueueFromExtensionAction(context: MonitorContext, body: EnqueueRequest) {
  const workerTracker = context.options.workerTracker;
  if (!workerTracker) throw new Error('Daemon mode not active');
  if (context.options.config && (!context.options.config.agents?.tiers || Object.keys(context.options.config.agents.tiers).length === 0)) {
    throw new Error('No agent tiers configured. Add agents.tiers entries (each with harness + model + effort) to eforge/config.yaml');
  }
  let prepared: Awaited<ReturnType<typeof prepareEnqueueRequest>>;
  try {
    prepared = await prepareEnqueueRequest(context, body as unknown as Record<string, unknown>);
  } catch (err) {
    if (isHttpRouteError(err) && err.status >= 400 && err.status < 500) {
      throw new ExtensionActionInputValidationError(err.message, [{ path: enqueueValidationPath(err.message), message: err.message, status: err.status }]);
    }
    throw err;
  }
  const result = workerTracker.spawnWorker('enqueue', prepared.args);
  if ((body as EnqueueRequest & { suppressSessionPlanSubmissionMark?: boolean }).suppressSessionPlanSubmissionMark !== true) {
    await markSessionPlanSubmittedAfterEnqueue(context, prepared.source, result.sessionId);
  }
  return { sessionId: result.sessionId, pid: result.pid, autoBuild: autoBuildStateToWire({ state: context.options.daemonState, capacity: { runningCount: context.getRunningBuildCount(), limit: context.getSchedulerLimit() } }).enabled };
}

class ExtensionActionInputValidationError extends Error {
  readonly details: Array<{ path: string; message: string; status: number }>;

  constructor(message: string, details: Array<{ path: string; message: string; status: number }>) {
    super(message);
    this.name = 'ExtensionActionInputValidationError';
    this.details = details;
  }
}

function enqueueValidationPath(message: string): string {
  const match = /^Invalid field: ([A-Za-z0-9.[\]-]+)/.exec(message)
    ?? /^Missing required field: ([A-Za-z0-9.[\]-]+)/.exec(message)
    ?? /^Field "([^"]+)"/.exec(message)
    ?? /^([A-Za-z0-9.[\]-]+):/.exec(message);
  return match?.[1] ?? '';
}

function getActionTimeoutMs(config: { extensions: unknown }): number {
  const extensions = config.extensions as { eventHookTimeoutMs?: unknown };
  return typeof extensions.eventHookTimeoutMs === 'number' ? extensions.eventHookTimeoutMs : 5000;
}

function sanitizeUnexpectedActionError(err: unknown): string {
  return err instanceof Error && err.message.trim().length > 0 ? err.message : 'Extension action handler failed';
}

function statusForFailure(kind: Exclude<ExtensionActionInvokeErrorCode, 'unknown-action' | 'invalid-request' | 'timeout'>): number {
  if (kind === 'invalid-input') return 400;
  if (kind === 'unavailable') return 409;
  return 500;
}
