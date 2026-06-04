import type { ExtensionActionInvokeErrorCode, ExtensionActionManifestEntry, ExtensionActionRequestedBy } from '@eforge-build/client';
import type { MonitorContext } from '../../context.js';
import { writeDaemonEvent } from '../../daemon-events.js';

export interface ExtensionActionEventProvenance {
  invocationId: string;
  action: Pick<ExtensionActionManifestEntry, 'id' | 'extensionName' | 'extensionPath'>;
  requestedBy: ExtensionActionRequestedBy;
}

function baseEvent(provenance: ExtensionActionEventProvenance): Record<string, unknown> {
  return {
    invocationId: provenance.invocationId,
    actionId: provenance.action.id,
    extensionName: provenance.action.extensionName,
    extensionPath: provenance.action.extensionPath,
    requestedBy: provenance.requestedBy,
  };
}

export function emitExtensionActionStart(context: MonitorContext, provenance: ExtensionActionEventProvenance): void {
  writeDaemonEvent(context.db, { type: 'extension:action:start', ...baseEvent(provenance) }, context.daemonSessionId);
}

export function emitExtensionActionComplete(context: MonitorContext, provenance: ExtensionActionEventProvenance, durationMs: number): void {
  writeDaemonEvent(context.db, { type: 'extension:action:complete', ...baseEvent(provenance), durationMs }, context.daemonSessionId);
}

export function emitExtensionActionFailed(
  context: MonitorContext,
  provenance: ExtensionActionEventProvenance,
  options: {
    durationMs: number;
    errorCode: Exclude<ExtensionActionInvokeErrorCode, 'unknown-action' | 'invalid-request' | 'timeout'>;
    message: string;
    validationErrors?: Array<{ path: string; message: string }>;
  },
): void {
  writeDaemonEvent(context.db, {
    type: 'extension:action:failed',
    ...baseEvent(provenance),
    durationMs: options.durationMs,
    errorCode: options.errorCode,
    message: options.message,
    ...(options.validationErrors !== undefined && { validationErrors: options.validationErrors }),
  }, context.daemonSessionId);
}

export function emitExtensionActionTimeout(
  context: MonitorContext,
  provenance: ExtensionActionEventProvenance,
  options: { durationMs: number; timeoutMs: number; message: string },
): void {
  writeDaemonEvent(context.db, {
    type: 'extension:action:timeout',
    ...baseEvent(provenance),
    durationMs: options.durationMs,
    timeoutMs: options.timeoutMs,
    message: options.message,
  }, context.daemonSessionId);
}
