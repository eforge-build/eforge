import { defineExtensionAction, type ExtensionActionContext } from '@eforge-build/extension-sdk';
import { EXTENSION_AGENT_TASK_KIND_EFORGE_PLAN_PLANNING_DRAFT, type ExtensionAgentTaskRecord } from '@eforge-build/client';
import { toJsonSafeObject } from './json-safe.js';
import { AnalyzeAllBacklogInputSchema, AnalyzeAllBacklogOutputSchema, normalizeBacklogCurationScanMode, type AnalyzeAllBacklogInput, type AnalyzeAllBacklogTaskSummary, type BacklogCurationScanMode } from './backlog-curation-schemas.js';
import {
  BACKLOG_CURATION_WORKFLOW_PURPOSE,
  listBacklogCurationWorkflowEntries,
  readPlanningTaskWorkflowIndex,
  recordPlanningTaskWorkflowEntry,
} from './planning-task-workflow-store.js';
import type { PlanningTaskWorkflowEntry } from './planning-agent-task-schemas.js';

const ANALYZE_ALL_TOPIC = 'Analyze and curate all open eforge-plan backlog records.';
const ANALYZE_ALL_SOURCE_PROVIDER = { module: './dist/backlog-curation-source-provider.js', exportName: 'buildSource' } as const;
export const BACKLOG_CURATION_REQUESTED_OUTPUT_SECTIONS = ['backlogCurationDraft', 'recommendations'] as const;
const analyzeStartChains = new Map<string, Promise<unknown>>();

type AnalyzeAllStartRequest = {
  kind: typeof EXTENSION_AGENT_TASK_KIND_EFORGE_PLAN_PLANNING_DRAFT;
  input: {
    topic: string;
    sourceProvider: typeof ANALYZE_ALL_SOURCE_PROVIDER & { input: { scanMode: BacklogCurationScanMode } };
    requestedOutputSections: typeof BACKLOG_CURATION_REQUESTED_OUTPUT_SECTIONS;
    includeRoadmap: true;
  };
};

export const analyzeAllBacklogAction = defineExtensionAction({
  id: 'analyze-all-backlog',
  title: 'Analyze all backlog',
  description: 'Start or reuse a daemon-owned curation planning task for all visible open eforge-plan backlog records.',
  inputSchema: AnalyzeAllBacklogInputSchema,
  outputSchema: AnalyzeAllBacklogOutputSchema,
  sideEffects: ['local-read', 'local-write', 'network', 'daemon-state'],
  async handler(input: AnalyzeAllBacklogInput, ctx) {
    throwIfAborted(ctx.signal);
    const scanMode = normalizeBacklogCurationScanMode(input.scanMode);
    return await runAnalyzeStartExclusive(ctx.cwd, scanMode, async () => {
      const active = await findActiveBacklogCurationTask(ctx, scanMode);
      if (active !== undefined) return toJsonSafeObject({ task: compactTask(active.task), entry: active.entry, ...(active.entry.sourceFingerprint !== undefined && { sourceFingerprint: active.entry.sourceFingerprint }), reused: true });
      throwIfAborted(ctx.signal);
      const response = await startBacklogCurationTask(ctx, scanMode);
      const entry = await recordEntryOrCancelTask(ctx, response.task.taskId, buildBacklogCurationEntry(response.task.taskId, undefined, undefined, scanMode));
      return toJsonSafeObject({ task: compactTask(response.task), entry });
    });
  },
});

export async function findActiveBacklogCurationTask(
  ctx: Pick<ExtensionActionContext, 'cwd' | 'agentTasks'>,
  scanMode: BacklogCurationScanMode = 'delta',
): Promise<{ task: ExtensionAgentTaskRecord; entry: PlanningTaskWorkflowEntry } | undefined> {
  const index = await readPlanningTaskWorkflowIndex(ctx.cwd);
  for (const entry of listBacklogCurationWorkflowEntries(index, undefined, scanMode)) {
    if (entry.appliedAt !== undefined) continue;
    try {
      const response = await ctx.agentTasks.get(entry.taskId);
      if (response.task.status === 'queued' || response.task.status === 'running') return { task: response.task, entry };
    } catch (error) {
      if (!isMissingOrStaleTaskError(error)) throw error;
      // Missing task records are stale and cannot be reused.
    }
  }
  return undefined;
}

export function buildBacklogCurationEntry(taskId: string, sourceFingerprint?: string, parent?: PlanningTaskWorkflowEntry, scanMode: BacklogCurationScanMode = normalizeBacklogCurationScanMode(parent?.scanMode)): PlanningTaskWorkflowEntry {
  return {
    taskId,
    ...(parent !== undefined && { parentTaskId: parent.taskId }),
    originalRequest: parent?.originalRequest ?? '',
    derivedRequest: analyzeAllTopicForScanMode(scanMode),
    selection: {},
    requestedOutputSections: [...BACKLOG_CURATION_REQUESTED_OUTPUT_SECTIONS],
    includeRoadmap: true,
    purpose: BACKLOG_CURATION_WORKFLOW_PURPOSE,
    scanMode,
    ...(sourceFingerprint !== undefined && { sourceFingerprint }),
    createdAt: new Date().toISOString(),
  };
}

async function startBacklogCurationTask(ctx: ExtensionActionContext, scanMode: BacklogCurationScanMode): Promise<{ task: ExtensionAgentTaskRecord }> {
  const request: AnalyzeAllStartRequest = {
    kind: EXTENSION_AGENT_TASK_KIND_EFORGE_PLAN_PLANNING_DRAFT,
    input: {
      topic: analyzeAllTopicForScanMode(scanMode),
      sourceProvider: { ...ANALYZE_ALL_SOURCE_PROVIDER, input: { scanMode } },
      requestedOutputSections: BACKLOG_CURATION_REQUESTED_OUTPUT_SECTIONS,
      includeRoadmap: true,
    },
  };
  return await (ctx.agentTasks.start as unknown as (request: AnalyzeAllStartRequest) => Promise<{ task: ExtensionAgentTaskRecord }>)(request);
}

function runAnalyzeStartExclusive<T>(cwd: string, scanMode: BacklogCurationScanMode, task: () => Promise<T>): Promise<T> {
  const key = `${cwd}\0analyze-all-backlog\0${scanMode}`;
  const prior = analyzeStartChains.get(key) ?? Promise.resolve();
  const result = prior.then(task, task);
  let chain: Promise<unknown>;
  chain = result.then(() => undefined, () => undefined).finally(() => {
    if (analyzeStartChains.get(key) === chain) analyzeStartChains.delete(key);
  });
  analyzeStartChains.set(key, chain);
  return result;
}

async function recordEntryOrCancelTask(ctx: Pick<ExtensionActionContext, 'cwd' | 'agentTasks'>, taskId: string, entry: PlanningTaskWorkflowEntry): Promise<PlanningTaskWorkflowEntry> {
  try {
    return await recordPlanningTaskWorkflowEntry(ctx.cwd, entry);
  } catch (recordError) {
    try {
      await ctx.agentTasks.cancel(taskId, 'eforge-plan failed to record the backlog curation workflow entry; cancelling to avoid an unindexed task.');
    } catch {
      // Preserve durable-index failure.
    }
    throw recordError;
  }
}

function analyzeAllTopicForScanMode(scanMode: BacklogCurationScanMode): string {
  return scanMode === 'full-implementation-audit'
    ? 'Analyze and curate all open eforge-plan backlog records using full implementation audit mode.'
    : ANALYZE_ALL_TOPIC;
}

function compactTask(task: ExtensionAgentTaskRecord): AnalyzeAllBacklogTaskSummary {
  // These fields exist only on specific status variants of the task union; read
  // them defensively so the projection works across every variant.
  const optional = task as Partial<{
    startedAt: string;
    completedAt: string;
    cancelledAt: string;
    errorCode: string;
    errorMessage: string;
  }>;
  return {
    taskId: task.taskId,
    kind: task.kind,
    status: task.status,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    ...(optional.startedAt !== undefined && { startedAt: optional.startedAt }),
    ...(optional.completedAt !== undefined && { completedAt: optional.completedAt }),
    ...(optional.cancelledAt !== undefined && { cancelledAt: optional.cancelledAt }),
    ...(optional.errorCode !== undefined && { errorCode: optional.errorCode }),
    ...(optional.errorMessage !== undefined && { errorMessage: optional.errorMessage }),
  };
}

function isMissingOrStaleTaskError(error: unknown): boolean {
  if (error === null || typeof error !== 'object') return false;
  const candidate = error as { status?: unknown; code?: unknown; message?: unknown };
  if (candidate.status === 404 || candidate.status === 410) return true;
  if (candidate.code === 'ENOENT' || candidate.code === 'TASK_NOT_FOUND' || candidate.code === 'NOT_FOUND' || candidate.code === 'STALE_TASK') return true;
  if (typeof candidate.message !== 'string') return false;
  return /\b(unknown task id|task not found|not found|stale task)\b/i.test(candidate.message);
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new Error('Backlog curation analysis was aborted before enqueueing the daemon task.');
}

export const backlogCurationActions = [analyzeAllBacklogAction] as const;
