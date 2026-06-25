import {
  EXTENSION_AGENT_TASK_ACTIVITY_LOG_MAX_ENTRIES,
  EXTENSION_AGENT_TASK_ACTIVITY_MESSAGE_MAX_LENGTH,
  type ExtensionAgentTaskKind,
  type ExtensionAgentTaskSanitizedMetadata,
  type ExtensionAgentTaskStatus,
} from '@eforge-build/client';
import type { MonitorContext } from '../../context.js';
import { writeDaemonEvent } from '../../daemon-events.js';

const ACTIVITY_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

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
  const backlogCurationProgress = sanitizeBacklogCurationProgress(metadata.backlogCurationProgress);
  if (backlogCurationProgress !== undefined) result.backlogCurationProgress = backlogCurationProgress;
  // --- eforge:region plan-01-activity-contract-daemon-core ---
  const activityLog = sanitizeActivityLog(metadata.activityLog);
  if (activityLog !== undefined) result.activityLog = activityLog;
  // --- eforge:endregion plan-01-activity-contract-daemon-core ---
  return Object.keys(result).length > 0 ? result : undefined;
}

const MAX_SECTION_PROGRESS_ITEMS = 50;
const MAX_BACKLOG_CURATION_PROGRESS_ITEMS = 1_000;

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

function sanitizeBacklogCurationProgress(progress: ExtensionAgentTaskSanitizedMetadata['backlogCurationProgress']): ExtensionAgentTaskSanitizedMetadata['backlogCurationProgress'] {
  if (!progress) return undefined;
  const items = progress.items.slice(0, MAX_BACKLOG_CURATION_PROGRESS_ITEMS).map((item) => ({
    itemId: sanitizeBoundedEventMessage(item.itemId, 240),
    ...(item.title !== undefined && { title: sanitizeBoundedEventMessage(item.title, 300) }),
    status: item.status,
    ...(item.outcome !== undefined && { outcome: sanitizeBoundedEventMessage(item.outcome, 80) }),
    ...(item.verdict !== undefined && { verdict: sanitizeBoundedEventMessage(item.verdict, 80) }),
    ...(item.summary !== undefined && { summary: sanitizeBoundedEventMessage(item.summary, 500) }),
    ...(item.startedAt !== undefined && { startedAt: sanitizeBoundedEventMessage(item.startedAt, 120) }),
    ...(item.completedAt !== undefined && { completedAt: sanitizeBoundedEventMessage(item.completedAt, 120) }),
  })).filter((item) => item.itemId.length > 0);
  return {
    total: sanitizeNonNegativeInteger(progress.total),
    cacheHits: sanitizeNonNegativeInteger(progress.cacheHits),
    misses: sanitizeNonNegativeInteger(progress.misses),
    running: sanitizeNonNegativeInteger(progress.running),
    completed: sanitizeNonNegativeInteger(progress.completed),
    remaining: sanitizeNonNegativeInteger(progress.remaining),
    items,
  };
}

// --- eforge:region plan-01-activity-contract-daemon-core ---
function sanitizeActivityLog(activityLog: ExtensionAgentTaskSanitizedMetadata['activityLog']): ExtensionAgentTaskSanitizedMetadata['activityLog'] {
  if (!Array.isArray(activityLog)) return undefined;
  const entries = activityLog
    .slice(-EXTENSION_AGENT_TASK_ACTIVITY_LOG_MAX_ENTRIES)
    .map((entry) => {
      const message = sanitizeBoundedEventMessage(entry.message, EXTENSION_AGENT_TASK_ACTIVITY_MESSAGE_MAX_LENGTH);
      const timestamp = normalizeActivityTimestamp(entry.timestamp);
      if (message.length === 0 || timestamp === undefined) return undefined;
      return { timestamp, message };
    })
    .filter((entry): entry is NonNullable<ExtensionAgentTaskSanitizedMetadata['activityLog']>[number] => entry !== undefined);
  return entries.length > 0 ? entries : undefined;
}

function normalizeActivityTimestamp(timestamp: string): string | undefined {
  if (typeof timestamp !== 'string' || !ACTIVITY_TIMESTAMP_PATTERN.test(timestamp)) return undefined;
  const time = Date.parse(timestamp);
  if (!Number.isFinite(time)) return undefined;
  const normalized = new Date(time).toISOString();
  return normalized === timestamp ? normalized : undefined;
}
// --- eforge:endregion plan-01-activity-contract-daemon-core ---

function withMetadata(base: AgentTaskEventBase): AgentTaskEventBase {
  const metadata = sanitizeMetadata(base.metadata);
  const eventBase = { taskId: base.taskId, taskKind: base.taskKind, extensionName: base.extensionName, status: base.status };
  return metadata === undefined ? eventBase : { ...eventBase, metadata };
}

function sanitizeEventMessage(message: string): string {
  return sanitizeBoundedEventMessage(message, EXTENSION_AGENT_TASK_ACTIVITY_MESSAGE_MAX_LENGTH);
}

function sanitizeBoundedEventMessage(message: string, maxLength: number): string {
  const trimmed = message.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  if (trimmed.length <= maxLength) return trimmed;
  if (maxLength <= 3) return trimmed.slice(0, maxLength);
  return `${trimmed.slice(0, maxLength - 3)}...`;
}

function sanitizeNonNegativeInteger(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

function sanitizeErrorCode(code: string): string {
  const cleaned = code.replace(/[^A-Za-z0-9._-]/g, '-');
  return cleaned.length > 0 ? cleaned.slice(0, 80) : 'error';
}
