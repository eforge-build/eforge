import type {
  ExtensionActionInvokeErrorCode,
  ExtensionActionInvokeRequest,
  ExtensionActionInvokeResponse,
  ExtensionActionManifestEntry,
  ExtensionAgentTaskStartRequest,
  ExtensionContributionManifestResponse,
} from '@eforge-build/client';
import type { MonitorContext } from '../../context.js';
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
    result = await dispatchExtensionAction(runtime.registry as never, {
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
          start: (taskRequest: Omit<ExtensionAgentTaskStartRequest, 'requestedBy'>) => agentTaskService.start({ ...taskRequest, requestedBy: request.requestedBy }, { owner: extension, requestedBy: request.requestedBy }),
          get: (taskId: string) => agentTaskService.get(taskId, extension),
          cancel: (taskId: string, reason?: string) => agentTaskService.cancel(taskId, reason, extension),
        }),
      }),
      // --- eforge:endregion extension-agent-task-context ---
    });
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

  emitExtensionActionFailed(context, provenance, {
    durationMs: result.durationMs,
    errorCode: result.kind,
    message: result.message,
    ...(result.validationErrors !== undefined && { validationErrors: result.validationErrors }),
  });
  return {
    status: statusForFailure(result.kind),
    body: failureBody(invocationId, result.kind, result.message, result.validationErrors),
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

function getActionTimeoutMs(config: { extensions: unknown }): number {
  const extensions = config.extensions as { eventHookTimeoutMs?: unknown };
  return typeof extensions.eventHookTimeoutMs === 'number' ? extensions.eventHookTimeoutMs : 5000;
}

function sanitizeUnexpectedActionError(err: unknown): string {
  return err instanceof Error && err.message.trim().length > 0 ? err.message : 'Extension action handler failed';
}

function statusForFailure(kind: Exclude<ExtensionActionInvokeErrorCode, 'unknown-action' | 'invalid-request' | 'timeout'>): number {
  if (kind === 'invalid-input') return 400;
  return 500;
}
