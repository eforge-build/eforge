import type { ExtensionAgentTaskKind, ExtensionAgentTaskSanitizedMetadata, ExtensionAgentTaskStatus } from '@eforge-build/client';
import type { MonitorContext } from '../../context.js';
import { writeDaemonEvent } from '../../daemon-events.js';

export interface AgentTaskEventBase {
  taskId: string;
  taskKind: ExtensionAgentTaskKind;
  extensionName: string;
  status: ExtensionAgentTaskStatus;
  metadata?: ExtensionAgentTaskSanitizedMetadata;
}

export function emitAgentTaskStart(context: MonitorContext, base: AgentTaskEventBase): void {
  writeDaemonEvent(context.db, { type: 'extension:agent-task:start', ...withMetadata(base) }, context.daemonSessionId);
}

export function emitAgentTaskProgress(context: MonitorContext, base: AgentTaskEventBase, message: string): void {
  writeDaemonEvent(context.db, { type: 'extension:agent-task:progress', ...withMetadata(base), message: sanitizeEventMessage(message) }, context.daemonSessionId);
}

export function emitAgentTaskComplete(context: MonitorContext, base: AgentTaskEventBase, durationMs: number): void {
  writeDaemonEvent(context.db, { type: 'extension:agent-task:complete', ...withMetadata(base), durationMs: Math.max(0, Math.trunc(durationMs)) }, context.daemonSessionId);
}

export function emitAgentTaskFailed(context: MonitorContext, base: AgentTaskEventBase, options: { durationMs?: number; errorCode: string; message: string }): void {
  writeDaemonEvent(context.db, {
    type: 'extension:agent-task:failed',
    ...withMetadata(base),
    ...(options.durationMs !== undefined && { durationMs: Math.max(0, Math.trunc(options.durationMs)) }),
    errorCode: sanitizeErrorCode(options.errorCode),
    message: sanitizeEventMessage(options.message),
  }, context.daemonSessionId);
}

export function emitAgentTaskCancelled(context: MonitorContext, base: AgentTaskEventBase, reason?: string): void {
  writeDaemonEvent(context.db, {
    type: 'extension:agent-task:cancelled',
    ...withMetadata(base),
    ...(reason !== undefined && reason.trim().length > 0 && { reason: sanitizeEventMessage(reason) }),
  }, context.daemonSessionId);
}

export function sanitizeMetadata(metadata: ExtensionAgentTaskSanitizedMetadata | undefined): ExtensionAgentTaskSanitizedMetadata | undefined {
  if (!metadata) return undefined;
  const result: ExtensionAgentTaskSanitizedMetadata = {};
  if (metadata.label !== undefined) result.label = sanitizeEventMessage(metadata.label);
  if (metadata.summary !== undefined) result.summary = sanitizeEventMessage(metadata.summary);
  if (metadata.progressMessage !== undefined) result.progressMessage = sanitizeEventMessage(metadata.progressMessage);
  if (metadata.outputSectionCount !== undefined) result.outputSectionCount = Math.max(0, Math.trunc(metadata.outputSectionCount));
  if (metadata.warningCount !== undefined) result.warningCount = Math.max(0, Math.trunc(metadata.warningCount));
  const sectionProgress = sanitizeSectionProgress(metadata.sectionProgress);
  if (sectionProgress !== undefined) result.sectionProgress = sectionProgress;
  return Object.keys(result).length > 0 ? result : undefined;
}

const MAX_SECTION_PROGRESS_ITEMS = 50;

function sanitizeSectionProgress(sectionProgress: ExtensionAgentTaskSanitizedMetadata['sectionProgress']): ExtensionAgentTaskSanitizedMetadata['sectionProgress'] {
  if (!sectionProgress) return undefined;
  const result: NonNullable<ExtensionAgentTaskSanitizedMetadata['sectionProgress']> = {};
  if (sectionProgress.currentSection !== undefined) {
    const current = sanitizeEventMessage(sectionProgress.currentSection);
    if (current.length > 0) result.currentSection = current;
  }
  if (sectionProgress.coveredSections !== undefined) {
    result.coveredSections = sanitizeSectionList(sectionProgress.coveredSections);
  }
  if (sectionProgress.remainingSections !== undefined) {
    result.remainingSections = sanitizeSectionList(sectionProgress.remainingSections);
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function sanitizeSectionList(values: string[]): string[] {
  return values.slice(0, MAX_SECTION_PROGRESS_ITEMS).map(sanitizeEventMessage).filter((entry) => entry.length > 0);
}

function withMetadata(base: AgentTaskEventBase): AgentTaskEventBase {
  const metadata = sanitizeMetadata(base.metadata);
  const eventBase = { taskId: base.taskId, taskKind: base.taskKind, extensionName: base.extensionName, status: base.status };
  return metadata === undefined ? eventBase : { ...eventBase, metadata };
}

function sanitizeEventMessage(message: string): string {
  const trimmed = message.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  return trimmed.length > 500 ? `${trimmed.slice(0, 497)}...` : trimmed;
}

function sanitizeErrorCode(code: string): string {
  const cleaned = code.replace(/[^A-Za-z0-9._-]/g, '-');
  return cleaned.length > 0 ? cleaned.slice(0, 80) : 'error';
}
