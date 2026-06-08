import { defineExtensionAction, type ExtensionActionContext } from '../../../packages/extension-sdk/src/index.js';
import { EXTENSION_AGENT_TASK_KIND_EFORGE_PLAN_PLANNING_DRAFT, type ExtensionAgentTaskRecord } from '../../../packages/client/src/extension-agent-tasks.js';
import { boundedSourceText } from './planner-source-bounds.js';
import { preparePlannerContext } from './planner-orchestration.js';
import { computeRecommendationSourceFingerprint } from './recommendation-status.js';
import { toJsonSafeObject } from './json-safe.js';
import {
  RefreshRecommendationsInputSchema,
  RefreshRecommendationsOutputSchema,
} from './recommendation-status-schemas.js';
import {
  RECOMMENDATION_REFRESH_WORKFLOW_PURPOSE,
  listRecommendationRefreshWorkflowEntries,
  readPlanningTaskWorkflowIndex,
  recordPlanningTaskWorkflowEntry,
} from './planning-task-workflow-store.js';
import type { PlanningTaskWorkflowEntry } from './planning-agent-task-schemas.js';

const REFRESH_TOPIC = 'Refresh eforge-plan recommendations for the current open backlog.';
const REQUESTED_OUTPUT_SECTIONS = ['recommendations'] as const;
const ACTIVE_REFRESH_STATUSES = new Set(['queued', 'running']);
const refreshStartChains = new Map<string, Promise<unknown>>();

type RefreshTaskStartRequest = {
  kind: typeof EXTENSION_AGENT_TASK_KIND_EFORGE_PLAN_PLANNING_DRAFT;
  input: {
    topic: string;
    sourceText: string;
    requestedOutputSections: typeof REQUESTED_OUTPUT_SECTIONS;
    includeRoadmap: true;
  };
};

export interface ActiveRecommendationRefreshTask {
  task: ExtensionAgentTaskRecord;
  entry: PlanningTaskWorkflowEntry;
}

export const refreshRecommendationsAction = defineExtensionAction({
  id: 'refresh-recommendations',
  title: 'Refresh eforge-plan recommendations',
  description: 'Start or reuse a daemon-owned recommendation-only planning task for the current recommendation source fingerprint.',
  inputSchema: RefreshRecommendationsInputSchema,
  outputSchema: RefreshRecommendationsOutputSchema,
  sideEffects: ['local-read', 'local-write', 'daemon-state'],
  async handler(_input, ctx) {
    throwIfAborted(ctx.signal);
    const { sourceFingerprint, sourceText } = await buildRefreshSource(ctx.cwd);
    throwIfAborted(ctx.signal);
    return await runRefreshStartExclusive(ctx.cwd, sourceFingerprint, async () => {
      const active = await findActiveRecommendationRefreshTask(ctx, sourceFingerprint);
      if (active !== undefined) {
        return toJsonSafeObject({ task: active.task, entry: active.entry, sourceFingerprint, reused: true });
      }
      throwIfAborted(ctx.signal);
      const response = await startRefreshTask(ctx, sourceText);
      const entry = await recordEntryOrCancelTask(ctx, response.task.taskId, buildRefreshEntry(response.task.taskId, sourceFingerprint));
      return toJsonSafeObject({ task: response.task, entry, sourceFingerprint });
    });
  },
});

export async function findActiveRecommendationRefreshTask(
  ctx: Pick<ExtensionActionContext, 'cwd' | 'agentTasks'>,
  sourceFingerprint: string,
): Promise<ActiveRecommendationRefreshTask | undefined> {
  const index = await readPlanningTaskWorkflowIndex(ctx.cwd);
  for (const entry of listRecommendationRefreshWorkflowEntries(index, sourceFingerprint)) {
    try {
      const response = await ctx.agentTasks.get(entry.taskId);
      if (ACTIVE_REFRESH_STATUSES.has(response.task.status)) return { task: response.task, entry };
    } catch {
      // Missing or unreadable daemon task records are stale workflow entries and
      // must not dedupe an explicit refresh for the current fingerprint.
    }
  }
  return undefined;
}

async function buildRefreshSource(cwd: string): Promise<{ sourceFingerprint: string; sourceText: string }> {
  const [context, sourceFingerprint] = await Promise.all([
    preparePlannerContext(cwd, { includeRoadmap: true }),
    computeRecommendationSourceFingerprint(cwd),
  ]);
  const sourceText = boundedSourceText(REFRESH_TOPIC, { ...context, sourceFingerprint });
  return { sourceFingerprint, sourceText };
}

async function startRefreshTask(ctx: ExtensionActionContext, sourceText: string): Promise<{ task: ExtensionAgentTaskRecord }> {
  const request: RefreshTaskStartRequest = {
    kind: EXTENSION_AGENT_TASK_KIND_EFORGE_PLAN_PLANNING_DRAFT,
    input: {
      topic: REFRESH_TOPIC,
      sourceText,
      requestedOutputSections: REQUESTED_OUTPUT_SECTIONS,
      includeRoadmap: true,
    },
  };
  return await (ctx.agentTasks.start as unknown as (request: RefreshTaskStartRequest) => Promise<{ task: ExtensionAgentTaskRecord }>)(request);
}

function runRefreshStartExclusive<T>(cwd: string, sourceFingerprint: string, task: () => Promise<T>): Promise<T> {
  const key = `${cwd}\0${sourceFingerprint}`;
  const prior = refreshStartChains.get(key) ?? Promise.resolve();
  const result = prior.then(task, task);
  refreshStartChains.set(key, result.then(() => undefined, () => undefined));
  return result;
}

function buildRefreshEntry(taskId: string, sourceFingerprint: string): PlanningTaskWorkflowEntry {
  return {
    taskId,
    originalRequest: '',
    derivedRequest: REFRESH_TOPIC,
    selection: {},
    requestedOutputSections: [...REQUESTED_OUTPUT_SECTIONS],
    includeRoadmap: true,
    purpose: RECOMMENDATION_REFRESH_WORKFLOW_PURPOSE,
    sourceFingerprint,
    createdAt: new Date().toISOString(),
  };
}

async function recordEntryOrCancelTask(
  ctx: Pick<ExtensionActionContext, 'cwd' | 'agentTasks'>,
  taskId: string,
  entry: PlanningTaskWorkflowEntry,
): Promise<PlanningTaskWorkflowEntry> {
  try {
    return await recordPlanningTaskWorkflowEntry(ctx.cwd, entry);
  } catch (recordError) {
    try {
      await ctx.agentTasks.cancel(taskId, 'eforge-plan failed to record the recommendation refresh workflow entry; cancelling to avoid an unindexed task.');
    } catch {
      // Preserve the original durable-index error.
    }
    throw recordError;
  }
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new Error('Recommendation refresh was aborted before enqueueing the daemon task.');
}
