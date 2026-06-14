import { defineExtensionAction, type ExtensionActionContext } from '../../../packages/extension-sdk/src/index.js';
import { EXTENSION_AGENT_TASK_KIND_EFORGE_PLAN_PLANNING_DRAFT, type ExtensionAgentTaskRecord } from '../../../packages/client/src/extension-agent-tasks.js';
import { toJsonSafeObject } from './json-safe.js';
import { AnalyzeAllBacklogInputSchema, AnalyzeAllBacklogOutputSchema } from './backlog-curation-schemas.js';
import {
  BACKLOG_CURATION_WORKFLOW_PURPOSE,
  listBacklogCurationWorkflowEntries,
  readPlanningTaskWorkflowIndex,
  recordPlanningTaskWorkflowEntry,
} from './planning-task-workflow-store.js';
import type { PlanningTaskWorkflowEntry } from './planning-agent-task-schemas.js';

const ANALYZE_ALL_TOPIC = 'Analyze and curate all open eforge-plan backlog records.';
const ANALYZE_ALL_SOURCE_PROVIDER = { module: './backlog-curation-source-provider.ts', exportName: 'buildSource' } as const;
export const BACKLOG_CURATION_REQUESTED_OUTPUT_SECTIONS = ['backlogCurationDraft', 'recommendations'] as const;
const analyzeStartChains = new Map<string, Promise<unknown>>();

type AnalyzeAllStartRequest = {
  kind: typeof EXTENSION_AGENT_TASK_KIND_EFORGE_PLAN_PLANNING_DRAFT;
  input: {
    topic: string;
    sourceProvider: typeof ANALYZE_ALL_SOURCE_PROVIDER;
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
  async handler(_input, ctx) {
    throwIfAborted(ctx.signal);
    return await runAnalyzeStartExclusive(ctx.cwd, async () => {
      const active = await findActiveBacklogCurationTask(ctx);
      if (active !== undefined) return toJsonSafeObject({ task: compactTask(active.task), entry: active.entry, ...(active.entry.sourceFingerprint !== undefined && { sourceFingerprint: active.entry.sourceFingerprint }), reused: true });
      throwIfAborted(ctx.signal);
      const response = await startBacklogCurationTask(ctx);
      const entry = await recordEntryOrCancelTask(ctx, response.task.taskId, buildBacklogCurationEntry(response.task.taskId));
      return toJsonSafeObject({ task: compactTask(response.task), entry });
    });
  },
});

export async function findActiveBacklogCurationTask(
  ctx: Pick<ExtensionActionContext, 'cwd' | 'agentTasks'>,
): Promise<{ task: ExtensionAgentTaskRecord; entry: PlanningTaskWorkflowEntry } | undefined> {
  const index = await readPlanningTaskWorkflowIndex(ctx.cwd);
  for (const entry of listBacklogCurationWorkflowEntries(index)) {
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

export function buildBacklogCurationEntry(taskId: string, sourceFingerprint?: string, parent?: PlanningTaskWorkflowEntry): PlanningTaskWorkflowEntry {
  return {
    taskId,
    ...(parent !== undefined && { parentTaskId: parent.taskId }),
    originalRequest: parent?.originalRequest ?? '',
    derivedRequest: ANALYZE_ALL_TOPIC,
    selection: {},
    requestedOutputSections: [...BACKLOG_CURATION_REQUESTED_OUTPUT_SECTIONS],
    includeRoadmap: true,
    purpose: BACKLOG_CURATION_WORKFLOW_PURPOSE,
    ...(sourceFingerprint !== undefined && { sourceFingerprint }),
    createdAt: new Date().toISOString(),
  };
}

async function startBacklogCurationTask(ctx: ExtensionActionContext): Promise<{ task: ExtensionAgentTaskRecord }> {
  const request: AnalyzeAllStartRequest = {
    kind: EXTENSION_AGENT_TASK_KIND_EFORGE_PLAN_PLANNING_DRAFT,
    input: {
      topic: ANALYZE_ALL_TOPIC,
      sourceProvider: ANALYZE_ALL_SOURCE_PROVIDER,
      requestedOutputSections: BACKLOG_CURATION_REQUESTED_OUTPUT_SECTIONS,
      includeRoadmap: true,
    },
  };
  return await (ctx.agentTasks.start as unknown as (request: AnalyzeAllStartRequest) => Promise<{ task: ExtensionAgentTaskRecord }>)(request);
}

function runAnalyzeStartExclusive<T>(cwd: string, task: () => Promise<T>): Promise<T> {
  const key = `${cwd}\0analyze-all-backlog`;
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

function compactTask(task: ExtensionAgentTaskRecord): Record<string, unknown> {
  return {
    taskId: task.taskId,
    kind: task.kind,
    status: task.status,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
    ...(task.startedAt !== undefined && { startedAt: task.startedAt }),
    ...(task.completedAt !== undefined && { completedAt: task.completedAt }),
    ...(task.cancelledAt !== undefined && { cancelledAt: task.cancelledAt }),
    ...(task.errorCode !== undefined && { errorCode: task.errorCode }),
    ...(task.errorMessage !== undefined && { errorMessage: task.errorMessage }),
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
