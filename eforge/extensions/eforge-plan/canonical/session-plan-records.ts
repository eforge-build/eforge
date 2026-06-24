import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { relative } from 'node:path';
import { parse as parseYaml } from 'yaml';
import type { EforgePlanStore, JsonObject, JsonValue, SessionPlanRow, SessionPlanUpsert } from '../sqlite/index.js';
import { getBacklogItem, getEpic, getSessionPlan, recordLifecycleEvidence, replaceAllSessionPlanEpics, replaceAllSessionPlanItems, upsertQueuePrd, upsertSessionPlan } from '../sqlite/index.js';
import { markCanonicalSearchDirty } from './search-dirty.js';
import { canonicalNowIso, canonicalSha256, withCanonicalTransaction } from './store.js';

export interface CanonicalSessionPlanSyncInput {
  session: string;
  path?: string;
  content?: string;
  topic?: string;
  status?: string;
  planningType?: string;
  planningDepth?: string;
  profile?: string | null;
  agentProfile?: string | null;
  eforgeSessionId?: string;
  submittedAt?: string;
  createdAt?: string;
  updatedAt?: string;
  sourceItemIds?: string[];
  sourceEpicIds?: string[];
  sourceRecommendationRef?: string;
  sourceTaskId?: string;
  provenance?: string;
  readinessSummary?: JsonValue;
  frontmatter?: JsonObject;
  summaryText?: string;
}

export function syncSessionPlanArtifact(cwd: string, input: CanonicalSessionPlanSyncInput): SessionPlanRow {
  return withCanonicalTransaction(cwd, (store) => syncSessionPlanArtifactRecord(store, cwd, input));
}

export function syncSessionPlanArtifactRecord(store: EforgePlanStore, cwd: string, input: CanonicalSessionPlanSyncInput): SessionPlanRow {
  const existing = getSessionPlan(store, input.session);
  const content = input.content ?? readContentIfAvailable(input.path);
  const parsed = content ? parseSessionPlanFrontmatter(content) : { frontmatter: existing?.frontmatter ?? input.frontmatter ?? {}, body: '' };
  const fm = { ...(existing?.frontmatter ?? {}), ...parsed.frontmatter, ...(input.frontmatter ?? {}) } as JsonObject;
  const source = sourceRefs(fm, input);
  const now = canonicalNowIso();
  const row = upsertSessionPlan(store, {
    session: input.session,
    path: input.path ? relative(cwd, input.path) : existing?.path,
    topic: input.topic ?? stringValue(fm.topic) ?? existing?.topic,
    status: input.status ?? stringValue(fm.status) ?? existing?.status ?? 'draft',
    planningType: input.planningType ?? stringValue(fm.planning_type) ?? existing?.planningType,
    planningDepth: input.planningDepth ?? stringValue(fm.planning_depth) ?? existing?.planningDepth,
    profile: input.profile ?? stringValue(fm.profile) ?? existing?.profile,
    agentProfile: input.agentProfile ?? stringValue(fm.agent_profile) ?? existing?.agentProfile,
    eforgeSessionId: input.eforgeSessionId ?? existing?.eforgeSessionId,
    submittedAt: input.submittedAt ?? existing?.submittedAt,
    createdAt: input.createdAt ?? existing?.createdAt ?? now,
    updatedAt: input.updatedAt ?? now,
    summaryText: input.summaryText ?? existing?.summaryText,
    artifactBodyHash: content ? canonicalSha256(parsed.body) : existing?.artifactBodyHash,
    readinessSummary: input.readinessSummary ?? existing?.readinessSummary,
    frontmatter: fm,
  } satisfies SessionPlanUpsert);
  replaceSessionPlanLinks(store, { session: input.session, itemIds: source.itemIds, epicIds: source.epicIds, sourceRecommendationRef: source.recommendationRef, sourceTaskId: input.sourceTaskId, provenance: input.provenance ?? 'canonical-sync' });
  for (const itemId of source.itemIds) {
    recordLifecycleEvidence(store, { evidenceKey: `planned:${input.session}:${itemId}`, itemRef: itemId, itemId: getBacklogItem(store, itemId)?.id, session: input.session, lifecycleState: 'planned', reasonCode: 'planned-session-plan', evidenceKind: 'session-plan', isCurrent: true, isTerminal: false, occurredAt: input.updatedAt ?? now, links: jsonValue({ session: input.session, path: row.path }) });
  }
  markCanonicalSearchDirty(store, [
    { documentType: 'session_plan', documentId: input.session, reason: 'canonical-session-plan-sync' },
    ...source.itemIds.map((documentId) => ({ documentType: 'backlog_item' as const, documentId, reason: 'canonical-session-plan-sync' })),
    ...source.epicIds.map((documentId) => ({ documentType: 'epic' as const, documentId, reason: 'canonical-session-plan-sync' })),
  ]);
  return row;
}

export async function syncSessionPlanFile(cwd: string, session: string, path: string, overrides: Partial<CanonicalSessionPlanSyncInput> = {}): Promise<SessionPlanRow> {
  const content = await readFile(path, 'utf-8');
  return syncSessionPlanArtifact(cwd, { ...overrides, session, path, content });
}

export function replaceSessionPlanLinks(store: EforgePlanStore, input: { session: string; itemIds?: string[]; epicIds?: string[]; sourceRecommendationRef?: string; sourceTaskId?: string; provenance?: string }): void {
  const now = canonicalNowIso();
  replaceAllSessionPlanItems(store, { session: input.session, items: (input.itemIds ?? []).map((itemRef, sequence) => ({ itemRef, itemId: getBacklogItem(store, itemRef)?.id, role: 'source', provenance: input.provenance ?? 'canonical-sync', sourceTaskId: input.sourceTaskId, sourceRecommendationRef: input.sourceRecommendationRef, promotedAt: now, sequence })) });
  replaceAllSessionPlanEpics(store, { session: input.session, epics: (input.epicIds ?? []).map((epicRef, sequence) => ({ epicRef, epicId: getEpic(store, epicRef)?.id, role: 'source', provenance: input.provenance ?? 'canonical-sync', sourceTaskId: input.sourceTaskId, sourceRecommendationRef: input.sourceRecommendationRef, promotedAt: now, sequence })) });
}

export function recordSessionPlanSubmitted(store: EforgePlanStore, input: { session: string; queuePrdId: string; path?: string; itemIds?: string[]; timestamp?: string; status?: string }): void {
  const at = input.timestamp ?? canonicalNowIso();
  upsertQueuePrd(store, { prdId: input.queuePrdId, session: input.session, sourcePath: input.path, status: input.status ?? 'queued', submittedAt: at, updatedAt: at });
  for (const itemId of input.itemIds ?? []) recordLifecycleEvidence(store, { evidenceKey: `submitted:${input.queuePrdId}:${itemId}`, itemRef: itemId, itemId: getBacklogItem(store, itemId)?.id, session: input.session, queuePrdId: input.queuePrdId, lifecycleState: 'submitted', reasonCode: 'submitted-session-plan', evidenceKind: 'handoff', occurredAt: at, links: jsonValue({ session: input.session, queuePrdId: input.queuePrdId, path: input.path }) });
  markCanonicalSearchDirty(store, [
    { documentType: 'session_plan', documentId: input.session, reason: 'session-plan-submitted' },
    ...(input.itemIds ?? []).map((documentId) => ({ documentType: 'backlog_item' as const, documentId, reason: 'session-plan-submitted' })),
  ]);
}

function readContentIfAvailable(path: string | undefined): string | undefined {
  if (path === undefined) return undefined;
  try {
    return readFileSync(path, 'utf-8');
  } catch {
    return undefined;
  }
}

function parseSessionPlanFrontmatter(content: string): { frontmatter: JsonObject; body: string } {
  if (!content.startsWith('---\n')) return { frontmatter: {}, body: content };
  const end = content.indexOf('\n---', 4);
  if (end < 0) return { frontmatter: {}, body: content };
  const raw = content.slice(4, end);
  const parsed = parseYaml(raw);
  return { frontmatter: parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? JSON.parse(JSON.stringify(parsed)) as JsonObject : {}, body: content.slice(end + 5) };
}

function sourceRefs(fm: JsonObject, input: CanonicalSessionPlanSyncInput): { itemIds: string[]; epicIds: string[]; recommendationRef?: string } {
  const eforgePlan = fm.eforge_plan && typeof fm.eforge_plan === 'object' && !Array.isArray(fm.eforge_plan) ? fm.eforge_plan as Record<string, unknown> : {};
  return {
    itemIds: input.sourceItemIds ?? stringArray(eforgePlan.source_item_ids, eforgePlan.source_item_id),
    epicIds: input.sourceEpicIds ?? stringArray(eforgePlan.source_epic_ids, eforgePlan.source_epic_id),
    recommendationRef: input.sourceRecommendationRef ?? stringValue(eforgePlan.source_recommendation_ref),
  };
}

function stringArray(value: unknown, single?: unknown): string[] {
  const values = Array.isArray(value) ? value : single ? [single] : [];
  return [...new Set(values.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0))];
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function jsonValue(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value ?? {}, (_key, entry) => entry === undefined ? undefined : entry)) as JsonValue;
}
