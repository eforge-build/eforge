import { safeParseWithSchema } from '@eforge-build/client';
import { defineExtensionAction, type ExtensionActionContext } from '../../../packages/extension-sdk/src/index.js';
import { EXTENSION_AGENT_TASK_KIND_EFORGE_PLAN_PLANNING_DRAFT, EforgePlanPlanningBacklogCurationDraftSchema, type ExtensionAgentTaskRecord } from '../../../packages/client/src/extension-agent-tasks.js';
import { toJsonSafeObject } from './json-safe.js';
import { AnalyzeAllBacklogInputSchema, AnalyzeAllBacklogOutputSchema } from './backlog-curation-schemas.js';
import { buildBacklogCurationSource } from './backlog-curation-source.js';
import {
  BACKLOG_CURATION_WORKFLOW_PURPOSE,
  listBacklogCurationWorkflowEntries,
  readPlanningTaskWorkflowIndex,
  recordPlanningTaskWorkflowEntry,
} from './planning-task-workflow-store.js';
import type { PlanningTaskWorkflowEntry } from './planning-agent-task-schemas.js';

const ANALYZE_ALL_TOPIC = 'Analyze and curate all open eforge-plan backlog records.';
export const BACKLOG_CURATION_REQUESTED_OUTPUT_SECTIONS = ['backlogCurationDraft', 'recommendations'] as const;
const analyzeStartChains = new Map<string, Promise<unknown>>();

type AnalyzeAllStartRequest = {
  kind: typeof EXTENSION_AGENT_TASK_KIND_EFORGE_PLAN_PLANNING_DRAFT;
  input: {
    topic: string;
    sourceText: string;
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
  sideEffects: ['local-read', 'local-write', 'daemon-state'],
  async handler(_input, ctx) {
    throwIfAborted(ctx.signal);
    const { sourceFingerprint, sourceText } = await buildBacklogCurationSource(ctx.cwd);
    throwIfAborted(ctx.signal);
    return await runAnalyzeStartExclusive(ctx.cwd, sourceFingerprint, async () => {
      const active = await findReusableBacklogCurationTask(ctx, sourceFingerprint);
      if (active !== undefined) return toJsonSafeObject({ task: active.task, entry: active.entry, sourceFingerprint, reused: true });
      throwIfAborted(ctx.signal);
      const response = await startBacklogCurationTask(ctx, sourceText);
      const entry = await recordEntryOrCancelTask(ctx, response.task.taskId, buildBacklogCurationEntry(response.task.taskId, sourceFingerprint));
      return toJsonSafeObject({ task: response.task, entry, sourceFingerprint });
    });
  },
});

export async function findReusableBacklogCurationTask(
  ctx: Pick<ExtensionActionContext, 'cwd' | 'agentTasks'>,
  sourceFingerprint: string,
): Promise<{ task: ExtensionAgentTaskRecord; entry: PlanningTaskWorkflowEntry } | undefined> {
  const index = await readPlanningTaskWorkflowIndex(ctx.cwd);
  for (const entry of listBacklogCurationWorkflowEntries(index, sourceFingerprint)) {
    if (entry.appliedAt !== undefined) continue;
    try {
      const response = await ctx.agentTasks.get(entry.taskId);
      if (response.task.status === 'queued' || response.task.status === 'running') return { task: response.task, entry };
      if (response.task.status === 'completed' && isReusableCompletedBacklogCurationTask(response.task, sourceFingerprint)) return { task: response.task, entry };
    } catch (error) {
      if (!isMissingOrStaleTaskError(error)) throw error;
      // Missing task records are stale and cannot be reused.
    }
  }
  return undefined;
}

export function buildBacklogCurationEntry(taskId: string, sourceFingerprint: string, parent?: PlanningTaskWorkflowEntry): PlanningTaskWorkflowEntry {
  return {
    taskId,
    ...(parent !== undefined && { parentTaskId: parent.taskId }),
    originalRequest: parent?.originalRequest ?? '',
    derivedRequest: ANALYZE_ALL_TOPIC,
    selection: {},
    requestedOutputSections: [...BACKLOG_CURATION_REQUESTED_OUTPUT_SECTIONS],
    includeRoadmap: true,
    purpose: BACKLOG_CURATION_WORKFLOW_PURPOSE,
    sourceFingerprint,
    createdAt: new Date().toISOString(),
  };
}

async function startBacklogCurationTask(ctx: ExtensionActionContext, sourceText: string): Promise<{ task: ExtensionAgentTaskRecord }> {
  const request: AnalyzeAllStartRequest = {
    kind: EXTENSION_AGENT_TASK_KIND_EFORGE_PLAN_PLANNING_DRAFT,
    input: {
      topic: ANALYZE_ALL_TOPIC,
      sourceText,
      requestedOutputSections: BACKLOG_CURATION_REQUESTED_OUTPUT_SECTIONS,
      includeRoadmap: true,
    },
  };
  return await (ctx.agentTasks.start as unknown as (request: AnalyzeAllStartRequest) => Promise<{ task: ExtensionAgentTaskRecord }>)(request);
}

function runAnalyzeStartExclusive<T>(cwd: string, sourceFingerprint: string, task: () => Promise<T>): Promise<T> {
  const key = `${cwd}\0${sourceFingerprint}`;
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

function isReusableCompletedBacklogCurationTask(task: ExtensionAgentTaskRecord, sourceFingerprint: string): boolean {
  const result = (task as { result?: unknown }).result;
  if (result === null || typeof result !== 'object') return false;
  const output = result as Record<string, unknown>;
  if (output.decision === 'needs-input' && Array.isArray(output.clarificationQuestions) && output.clarificationQuestions.length > 0) return true;
  const draft = safeParseWithSchema(EforgePlanPlanningBacklogCurationDraftSchema, output.backlogCurationDraft);
  return draft.success && draft.data.sourceFingerprint === sourceFingerprint;
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
