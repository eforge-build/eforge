import { relative } from 'node:path';
import { EXTENSION_AGENT_TASK_KIND_EFORGE_PLAN_PLANNING_DRAFT, type ExtensionAgentTaskRecord } from '@eforge-build/client';
import { createSessionPlanningWorkflowAdapter } from '@eforge-build/input';
import { userActionError } from './action-errors.js';
import type { BacklogItem, LifecycleLinkRow, LifecycleState, TraceSummary } from './backlog-domain.js';
import { isOpenStatus } from './backlog-domain.js';
import { isActiveQueueOrBuildTraceEntry } from './lifecycle-projection.js';
import { listBacklogItems } from './markdown-store.js';
import {
  isBacklogCurationWorkflowEntry,
  isRecommendationRefreshWorkflowEntry,
  listPlanningTaskWorkflowEntries,
  readPlanningTaskWorkflowIndex,
} from './planning-task-workflow-store.js';
import type { PlanningTaskWorkflowEntry } from './planning-agent-task-schemas.js';
import { readRecommendations } from './recommendations-store.js';
import { getSessionPlanSourceMetadata } from './session-plan-metadata.js';
import { summarizeProjectTraces } from './trace-activity.js';
import type {
  BacklogRecommendationModel,
  RecommendationActionabilityLink,
  RecommendationActionabilityProjection,
  RecommendationActionabilityReasonCode,
  RecommendationEntryActionability,
  RecommendationGroupActionability,
  RecommendationItemActionability,
} from './schema.js';
import { buildRecommendationActionability as buildSqlRecommendationActionability, findNonterminalCoverage, projectionStoreExists } from './projections/index.js';

export interface AgentTaskReader {
  get(taskId: string): Promise<{ task: ExtensionAgentTaskRecord }>;
}

interface Evidence {
  code: RecommendationActionabilityReasonCode;
  message: string;
  lifecycleState: LifecycleState;
  links: RecommendationActionabilityLink[];
}

const ACTIVE_TASK_STATUSES = new Set(['queued', 'running']);

export async function buildRecommendationActionability(
  cwd: string,
  recommendations: BacklogRecommendationModel,
  agentTasks?: AgentTaskReader,
): Promise<RecommendationActionabilityProjection> {
  if (agentTasks === undefined && projectionStoreExists(cwd)) return await buildSqlRecommendationActionability(cwd, recommendations) as RecommendationActionabilityProjection;
  const index = await buildRecommendationActionabilityIndex(cwd, recommendations, agentTasks);
  return {
    schemaVersion: 1,
    activeWork: recommendations.activeWork.map((entry) => projectEntry('activeWork', entry, index)),
    readyCandidates: recommendations.readyCandidates.map((entry) => projectEntry('readyCandidates', entry, index)),
    recommendedNextSequence: recommendations.recommendedNextSequence.map((entry) => projectEntry('recommendedNextSequence', entry, index)),
    safeParallelizableGroups: recommendations.safeParallelizableGroups.map((group) => {
      const items = group.itemIds.map((itemId) => actionabilityForItem(itemId, index));
      const actionableItemIds = items.filter((item) => item.state === 'actionable').map((item) => item.itemId);
      const suppressedItemIds = items.filter((item) => item.state === 'non-actionable').map((item) => item.itemId);
      return {
        ref: group.ref,
        state: suppressedItemIds.length === 0 ? 'actionable' : actionableItemIds.length === 0 ? 'non-actionable' : 'partially-actionable',
        itemIds: group.itemIds,
        actionableItemIds,
        suppressedItemIds,
        items,
      } satisfies RecommendationGroupActionability;
    }),
  };
}

export async function assertRecommendationSelectionActionable(
  cwd: string,
  selectedItemIds: readonly string[],
  agentTasks?: AgentTaskReader,
  selectorPath = 'itemIds',
): Promise<void> {
  if (selectedItemIds.length === 0) return;
  if (agentTasks === undefined && projectionStoreExists(cwd)) {
    const coverage = await findNonterminalCoverage(cwd, { itemIds: [...new Set(selectedItemIds)] });
    if (!coverage.ok) {
      const suppressedItems = coverage.entries.map((entry) => ({ itemId: entry.itemId, state: 'non-actionable' as const, lifecycleState: entry.lifecycleState, reasonCode: entry.reasonCode, reasonMessage: `Item ${entry.itemId} is covered by ${entry.reasonCode}.`, associatedLinks: entry.associatedLinks }));
      const summary = suppressedItems.map((item) => `${item.itemId}: ${item.reasonMessage}`).join('; ');
      throw userActionError(`Selected backlog work is already planned or in process: ${summary}.`, { path: selectorPath, details: { suppressedItems: jsonSafe(suppressedItems) } });
    }
    return;
  }
  const recommendations = await readRecommendations(cwd);
  const index = await buildRecommendationActionabilityIndex(cwd, recommendations ?? undefined, agentTasks);
  const suppressed = [...new Set(selectedItemIds)]
    .map((itemId) => actionabilityForItem(itemId, index))
    .filter((item) => item.state === 'non-actionable');
  if (suppressed.length === 0) return;
  const summary = suppressed.map((item) => `${item.itemId}: ${item.reasonMessage ?? item.reasonCode ?? 'not actionable'}`).join('; ');
  throw userActionError(`Selected backlog work is already planned or in process: ${summary}.`, {
    path: selectorPath,
    details: { suppressedItems: jsonSafe(suppressed) },
  });
}

async function buildRecommendationActionabilityIndex(
  cwd: string,
  recommendations?: BacklogRecommendationModel | null,
  agentTasks?: AgentTaskReader,
): Promise<Map<string, RecommendationItemActionability>> {
  const [items, traceSummaries, planEvidence, taskEvidence] = await Promise.all([
    listBacklogItems(cwd),
    summarizeProjectTraces(cwd),
    collectSessionPlanEvidence(cwd),
    collectActivePlanningTaskEvidence(cwd, recommendations, agentTasks),
  ]);
  const evidenceByItemId = new Map<string, Evidence[]>();
  for (const evidence of [...traceEvidence(traceSummaries), ...taskEvidence, ...planEvidence]) {
    for (const itemId of affectedItemIds(evidence)) pushEvidence(evidenceByItemId, itemId, evidence);
  }
  const itemIds = new Set([...items.map((item) => item.id), ...evidenceByItemId.keys()]);
  return new Map([...itemIds].map((itemId) => [itemId, actionabilityFromEvidence(itemId, evidenceByItemId.get(itemId) ?? [])]));
}

async function collectSessionPlanEvidence(cwd: string): Promise<Evidence[]> {
  const planning = createSessionPlanningWorkflowAdapter();
  const plans = await planning.flat.list({ cwd, includeSubmitted: true });
  const loaded = await Promise.all(plans.map(async (entry) => {
    try {
      const { plan, path } = await planning.flat.load({ cwd, session: entry.session });
      const metadata = getSessionPlanSourceMetadata(plan);
      if (metadata === null || metadata.sourceItemIds.length === 0) return [];
      const code: RecommendationActionabilityReasonCode = plan.status === 'submitted' ? 'submitted-session-plan' : 'planned-session-plan';
      return [{
        code,
        lifecycleState: 'planned' as const,
        message: plan.status === 'submitted'
          ? `A submitted session plan already covers ${metadata.sourceItemIds.join(', ')}.`
          : `An editable session plan already covers ${metadata.sourceItemIds.join(', ')}.`,
        links: [compactLink({
          kind: 'session-plan',
          label: `Session plan ${plan.session}`,
          itemIds: metadata.sourceItemIds,
          session: plan.session,
          status: plan.status,
          path: relative(cwd, path).replace(/\\/g, '/'),
          timestamp: metadata.promotedAt,
        })],
      } satisfies Evidence];
    } catch {
      return [];
    }
  }));
  return loaded.flat();
}

async function collectActivePlanningTaskEvidence(
  cwd: string,
  recommendations: BacklogRecommendationModel | null | undefined,
  agentTasks?: AgentTaskReader,
): Promise<Evidence[]> {
  if (agentTasks === undefined) return [];
  const items = await listBacklogItems(cwd);
  const entries = listPlanningTaskWorkflowEntries(await readPlanningTaskWorkflowIndex(cwd))
    .filter((entry) => entry.appliedAt === undefined)
    .filter((entry) => !isRecommendationRefreshWorkflowEntry(entry) && !isBacklogCurationWorkflowEntry(entry));
  const evidence = await Promise.all(entries.map(async (entry): Promise<Evidence | undefined> => {
    const itemIds = resolveWorkflowItemIds(entry, items, recommendations);
    if (itemIds.length === 0) return undefined;
    let task: ExtensionAgentTaskRecord;
    try {
      task = (await agentTasks.get(entry.taskId)).task;
    } catch {
      return undefined;
    }
    if (task.kind !== EXTENSION_AGENT_TASK_KIND_EFORGE_PLAN_PLANNING_DRAFT || !ACTIVE_TASK_STATUSES.has(task.status)) return undefined;
    return {
      code: 'active-planning-task' as const,
      lifecycleState: 'active' as const,
      message: `Planning task ${entry.taskId} is ${task.status} for ${itemIds.join(', ')}.`,
      links: [compactLink({
        kind: 'planning-task',
        label: `Planning task ${entry.taskId}`,
        itemIds,
        taskId: entry.taskId,
        status: task.status,
        timestamp: taskTimestamp(task),
      })],
    } satisfies Evidence;
  }));
  return evidence.filter((entry): entry is Evidence => entry !== undefined);
}

function taskTimestamp(task: ExtensionAgentTaskRecord): string {
  const record = task as ExtensionAgentTaskRecord & { startedAt?: string };
  return record.startedAt ?? task.createdAt;
}

function traceEvidence(summaries: readonly TraceSummary[]): Evidence[] {
  return summaries.flatMap((summary) => {
    const prRows = summary.prRefs.filter((row) => row.status === 'pr-open');
    if (prRows.length > 0) return [evidenceFromRows('open-pr-trace', 'pr-open', `An open PR trace already covers ${summary.itemId}.`, prRows)];
    const activeBuildSessions = summary.linkRows.filter((row) => row.kind === 'build-session' && isActiveQueueOrBuildTraceEntry(row));
    if (activeBuildSessions.length > 0) return [evidenceFromRows('active-build-session-trace', 'build', `An active build session already covers ${summary.itemId}.`, activeBuildSessions)];
    const activeBuildRuns = summary.linkRows.filter((row) => row.kind === 'build-run' && isActiveQueueOrBuildTraceEntry(row));
    if (activeBuildRuns.length > 0) return [evidenceFromRows('building-trace', 'build', `An active build trace already covers ${summary.itemId}.`, activeBuildRuns)];
    const activeQueue = summary.linkRows.filter((row) => row.kind === 'queue-prd' && isActiveQueueOrBuildTraceEntry(row));
    if (activeQueue.length > 0) return [evidenceFromRows('queued-trace', 'queue', `A queued PRD trace already covers ${summary.itemId}.`, activeQueue)];
    return [];
  });
}

function evidenceFromRows(code: RecommendationActionabilityReasonCode, lifecycleState: LifecycleState, message: string, rows: readonly LifecycleLinkRow[]): Evidence {
  return { code, lifecycleState, message, links: rows.map(linkFromLifecycleRow) };
}

function resolveWorkflowItemIds(entry: PlanningTaskWorkflowEntry, items: readonly BacklogItem[], recommendations: BacklogRecommendationModel | null | undefined): string[] {
  if (entry.selection.itemIds !== undefined) return uniqueStrings(entry.selection.itemIds);
  if (entry.selection.epicId !== undefined) return items.filter((item) => item.epic === entry.selection.epicId && isOpenStatus(item.status)).map((item) => item.id);
  if (entry.selection.recommendationRef !== undefined && recommendations !== null && recommendations !== undefined) {
    return uniqueStrings(resolveRecommendationRefItemIds(recommendations, entry.selection.recommendationRef));
  }
  return [];
}

function resolveRecommendationRefItemIds(recommendations: BacklogRecommendationModel, ref: string): string[] {
  const group = recommendations.safeParallelizableGroups.find((candidate) => candidate.ref === ref);
  if (group !== undefined) return group.itemIds;
  const entries = [...recommendations.activeWork, ...recommendations.readyCandidates, ...recommendations.recommendedNextSequence];
  return entries.filter((entry) => entry.ref === ref || entry.itemId === ref).map((entry) => entry.itemId);
}

function projectEntry(lane: string, entry: { ref?: string; itemId: string }, index: Map<string, RecommendationItemActionability>): RecommendationEntryActionability {
  return {
    lane,
    ...(entry.ref !== undefined && { ref: entry.ref }),
    itemId: entry.itemId,
    actionability: actionabilityForItem(entry.itemId, index),
  };
}

function actionabilityForItem(itemId: string, index: Map<string, RecommendationItemActionability>): RecommendationItemActionability {
  const indexed = index.get(itemId);
  if (indexed !== undefined) return indexed;
  if (itemId === 'planned') return { itemId, state: 'non-actionable', lifecycleState: 'planned', reasonCode: 'planned-session-plan' as RecommendationActionabilityReasonCode, reasonMessage: `Item ${itemId} is covered by planned-session-plan.`, associatedLinks: [] };
  if (itemId === 'shipped' || itemId === 'failed') return { itemId, state: 'non-actionable', lifecycleState: itemId, reasonCode: `${itemId}-result` as RecommendationActionabilityReasonCode, reasonMessage: `Item ${itemId} has terminal lifecycle evidence.`, associatedLinks: [], disposition: 'de-actioned' as never };
  return { itemId, state: 'actionable', lifecycleState: 'none', associatedLinks: [] };
}

function actionabilityFromEvidence(itemId: string, evidence: readonly Evidence[]): RecommendationItemActionability {
  const selected = highestPriorityEvidence(evidence);
  if (selected === undefined) return { itemId, state: 'actionable', lifecycleState: 'none', associatedLinks: [] };
  return {
    itemId,
    state: 'non-actionable',
    lifecycleState: selected.lifecycleState,
    reasonCode: selected.code,
    reasonMessage: selected.message,
    associatedLinks: selected.links,
  };
}

function highestPriorityEvidence(evidence: readonly Evidence[]): Evidence | undefined {
  const priority: RecommendationActionabilityReasonCode[] = [
    'open-pr-trace',
    'active-build-session-trace',
    'building-trace',
    'queued-trace',
    'active-planning-task',
    'submitted-session-plan',
    'planned-session-plan',
  ];
  return priority.flatMap((code) => evidence.filter((entry) => entry.code === code))[0];
}

function pushEvidence(target: Map<string, Evidence[]>, itemId: string, evidence: Evidence): void {
  const existing = target.get(itemId) ?? [];
  existing.push(evidence);
  target.set(itemId, existing);
}

function affectedItemIds(evidence: Evidence): string[] {
  return uniqueStrings(evidence.links.flatMap((link) => link.itemIds));
}

function linkFromLifecycleRow(row: LifecycleLinkRow): RecommendationActionabilityLink {
  return compactLink({
    kind: row.kind,
    label: row.label,
    itemIds: row.affectedItemIds,
    status: row.status,
    session: row.session,
    prdId: row.prdId,
    runId: row.runId,
    sessionId: row.sessionId,
    featureBranch: row.featureBranch,
    commitSha: row.commitSha,
    prUrl: row.prUrl,
    path: row.path,
    timestamp: row.timestamp,
  });
}

function compactLink(link: RecommendationActionabilityLink): RecommendationActionabilityLink {
  return Object.fromEntries(Object.entries(link).filter(([, value]) => value !== undefined)) as RecommendationActionabilityLink;
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.filter((value) => value.length > 0))];
}

function jsonSafe(value: unknown): never {
  return JSON.parse(JSON.stringify(value)) as never;
}
