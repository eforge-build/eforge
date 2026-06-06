import type {
  ConsoleWorkstationManifestEntry,
  ExtensionActionInvokeRequest,
  ExtensionActionInvokeResponse,
  ExtensionJsonObject,
} from '@eforge-build/client/browser';
import { resolveAllowedWorkstationAction } from './workstation-selectors';

export type WorkstationInvokeActionMessage = {
  type: 'eforge:workstation:invoke-action';
  requestId: string;
  bridgeToken: string;
  actionId: string;
  input: Record<string, unknown>;
};

export type WorkstationActionResultMessage = {
  type: 'eforge:workstation:action-result';
  requestId: string;
  response?: ExtensionActionInvokeResponse;
  error?: { code: 'invalid-request' | 'disallowed-action' | 'bridge-error'; message: string };
};

export type InvokeExtensionActionFn = (
  request: ExtensionActionInvokeRequest,
  init?: RequestInit,
) => Promise<ExtensionActionInvokeResponse>;

export type WorkstationBridgeResult = 'ignored' | 'posted-error' | 'invoked';

interface ValidationResult {
  ok: boolean;
  message?: WorkstationInvokeActionMessage;
  error?: WorkstationActionResultMessage['error'];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

const MAX_JSON_VALIDATION_DEPTH = 100;

function isJsonValue(value: unknown, seen: WeakSet<object> = new WeakSet(), depth = 0): boolean {
  if (value === null) return true;
  if (typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (depth > MAX_JSON_VALIDATION_DEPTH) return false;
  if (Array.isArray(value)) {
    if (seen.has(value)) return false;
    seen.add(value);
    const valid = value.every((item) => isJsonValue(item, seen, depth + 1));
    seen.delete(value);
    return valid;
  }
  if (isRecord(value)) {
    if (seen.has(value)) return false;
    seen.add(value);
    const valid = Object.values(value).every((item) => isJsonValue(item, seen, depth + 1));
    seen.delete(value);
    return valid;
  }
  return false;
}

export function isExtensionJsonObject(value: unknown): value is ExtensionJsonObject {
  return isRecord(value) && Object.values(value).every((item) => isJsonValue(item));
}

export function buildWorkstationRequestedBy(workstation: ConsoleWorkstationManifestEntry): ExtensionActionInvokeRequest['requestedBy'] {
  return {
    host: 'console',
    surface: `workstation:${workstation.id}`,
  };
}

export function validateWorkstationBridgeMessage(data: unknown, expectedBridgeToken: string): ValidationResult {
  if (!isRecord(data) || data.type !== 'eforge:workstation:invoke-action') {
    return { ok: false, error: { code: 'invalid-request', message: 'Unsupported workstation bridge message' } };
  }
  if (typeof data.requestId !== 'string' || data.requestId.trim().length === 0) {
    return { ok: false, error: { code: 'invalid-request', message: 'Workstation bridge requestId must be a non-empty string' } };
  }
  if (typeof data.bridgeToken !== 'string' || data.bridgeToken !== expectedBridgeToken) {
    return { ok: false, error: { code: 'invalid-request', message: 'Invalid workstation bridge token' } };
  }
  if (typeof data.actionId !== 'string' || data.actionId.trim().length === 0) {
    return { ok: false, error: { code: 'invalid-request', message: 'Workstation bridge actionId must be a non-empty string' } };
  }
  if (!isExtensionJsonObject(data.input)) {
    return { ok: false, error: { code: 'invalid-request', message: 'Workstation bridge input must be a JSON object' } };
  }
  return {
    ok: true,
    message: {
      type: 'eforge:workstation:invoke-action',
      requestId: data.requestId,
      bridgeToken: data.bridgeToken,
      actionId: data.actionId,
      input: data.input,
    },
  };
}

export function postWorkstationActionResult(
  target: Window,
  message: WorkstationActionResultMessage,
): void {
  target.postMessage(message, '*');
}

export function buildWorkstationActionResultMessage(
  requestId: string,
  response: ExtensionActionInvokeResponse,
): WorkstationActionResultMessage {
  return { type: 'eforge:workstation:action-result', requestId, response };
}

export function buildWorkstationActionErrorMessage(
  requestId: string,
  error: WorkstationActionResultMessage['error'],
): WorkstationActionResultMessage {
  return { type: 'eforge:workstation:action-result', requestId, error };
}

export async function handleWorkstationBridgeEvent(args: {
  event: MessageEvent;
  sourceWindow: Window | null;
  workstation: ConsoleWorkstationManifestEntry | null;
  bridgeToken: string;
  invokeAction: InvokeExtensionActionFn;
}): Promise<WorkstationBridgeResult> {
  const { event, sourceWindow, workstation, bridgeToken, invokeAction } = args;
  if (!sourceWindow || event.source !== sourceWindow) return 'ignored';

  const validation = validateWorkstationBridgeMessage(event.data, bridgeToken);
  const requestId = validation.message?.requestId
    ?? (isRecord(event.data) && typeof event.data.requestId === 'string' ? event.data.requestId : 'unknown');
  if (!validation.ok || !validation.message) {
    postWorkstationActionResult(sourceWindow, buildWorkstationActionErrorMessage(requestId, validation.error ?? {
      code: 'invalid-request',
      message: 'Invalid workstation bridge request',
    }));
    return 'posted-error';
  }

  if (!workstation) {
    postWorkstationActionResult(sourceWindow, buildWorkstationActionErrorMessage(validation.message.requestId, {
      code: 'invalid-request',
      message: 'No workstation is selected',
    }));
    return 'posted-error';
  }

  const effectiveActionId = resolveAllowedWorkstationAction(workstation, validation.message.actionId);
  if (!effectiveActionId) {
    postWorkstationActionResult(sourceWindow, buildWorkstationActionErrorMessage(validation.message.requestId, {
      code: 'disallowed-action',
      message: `Action is not allowed for workstation ${workstation.id}`,
    }));
    return 'posted-error';
  }

  try {
    const response = await invokeAction({
      actionId: effectiveActionId,
      input: validation.message.input as ExtensionJsonObject,
      requestedBy: buildWorkstationRequestedBy(workstation),
    });
    postWorkstationActionResult(sourceWindow, buildWorkstationActionResultMessage(validation.message.requestId, response));
  } catch (err) {
    postWorkstationActionResult(sourceWindow, buildWorkstationActionErrorMessage(validation.message.requestId, {
      code: 'bridge-error',
      message: err instanceof Error ? err.message : String(err),
    }));
  }
  return 'invoked';
}
