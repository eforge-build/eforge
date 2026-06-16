import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';

export const RECOMMENDATION_STALE_REASON_LIMIT = 20;
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { parseWithSchema } from '@eforge-build/client';
import { ExtensionActionInputValidationError, createEforgeProjectPaths, type EforgeProjectPaths } from '@eforge-build/extension-sdk';
import {
  blockerRiskProjection,
  dependencyProjection,
  extractMarkdownSections,
  isClosedStatus,
  isOpenStatus,
  type BacklogEpic,
  type BacklogItem,
  type BacklogStatus,
  type LifecycleLinkRow,
} from './backlog-domain.js';
import { listBacklogEpics, listBacklogItems } from './markdown-store.js';
import { listTraceSidecars, summarizeTrace } from './trace-store.js';
import type { RecommendationReferenceValidationIssue, RecommendationReferenceValidationResult } from './backlog-curation-schemas.js';
import { compactLifecycleRowsForFingerprint } from './lifecycle-projection.js';
import type { BacklogRecommendationModel } from './schema.js';
import {
  RecommendationStatusSidecarSchema,
  type RecommendationDerivedStatus,
  type RecommendationStaleReason,
  type RecommendationStatusSidecar,
} from './recommendation-status-schemas.js';

export function resolveRecommendationStatusPath(paths: EforgeProjectPaths): string {
  return paths.extensionStoragePath('project-local', ['recommendations', 'status.json']);
}

export function resolveRecommendationStatusPathForCwd(cwd: string): string {
  return resolveRecommendationStatusPath(createEforgeProjectPaths({ cwd, extensionName: 'eforge-plan' }));
}

export async function readDerivedRecommendationStatus(cwd: string, currentPath = resolveCurrentPath(cwd)): Promise<RecommendationDerivedStatus> {
  const statusPath = resolveRecommendationStatusPathForCwd(cwd);
  let sidecar: RecommendationStatusSidecar | null;
  try {
    sidecar = await readRecommendationStatusSidecar(statusPath);
  } catch (err) {
    const sourceFingerprint = await computeRecommendationSourceFingerprint(cwd);
    return staleStatus(currentPath, statusPath, sourceFingerprint, undefined, [invalidStatusSidecarReason(err)]);
  }
  if (!existsSync(currentPath) && sidecar === null) return missingStatus(currentPath, statusPath);

  const sourceFingerprint = await computeRecommendationSourceFingerprint(cwd);
  if (sidecar === null) return staleStatus(currentPath, statusPath, sourceFingerprint, undefined, [missingStatusSidecarReason()]);

  const semanticInvalidReason = invalidFreshnessSidecarReason(sidecar);
  if (semanticInvalidReason !== null) {
    return staleStatus(currentPath, statusPath, sourceFingerprint, sidecar.lastAppliedSourceFingerprint, [semanticInvalidReason]);
  }

  const persistedReasons = sidecarReasons(sidecar).filter((reason) => reason.code !== 'source-fingerprint-drift');
  const staleReasons = [...persistedReasons];
  if (sidecar.lastAppliedSourceFingerprint !== undefined && sidecar.lastAppliedSourceFingerprint !== sourceFingerprint) {
    staleReasons.push(sourceDriftReason(sourceFingerprint, sidecar.lastAppliedSourceFingerprint));
  }
  return statusFromParts({
    state: staleReasons.length > 0 || !existsSync(currentPath) ? 'stale' : 'fresh',
    currentPath,
    statusPath,
    sourceFingerprint,
    lastAppliedSourceFingerprint: sidecar.lastAppliedSourceFingerprint,
    freshAt: sidecar.freshAt ?? sidecar.lastAppliedAt,
    staleSince: staleReasons.length > 0 || !existsSync(currentPath) ? sidecar.staleSince ?? sidecar.lastAppliedAt : undefined,
    lastRefreshedBy: sidecar.lastRefreshedBy,
    reasons: staleReasons,
  });
}

export async function recordRecommendationPutApplied(cwd: string): Promise<RecommendationDerivedStatus> {
  return recordPlannerRecommendationAppliedForSourceFingerprint(cwd, await computeRecommendationSourceFingerprint(cwd), 'put-recommendations');
}

export async function recordPlannerRecommendationApplied(cwd: string, lastRefreshedBy = 'apply-planner-result'): Promise<RecommendationDerivedStatus> {
  return recordPlannerRecommendationAppliedForSourceFingerprint(cwd, await computeRecommendationSourceFingerprint(cwd), lastRefreshedBy);
}

export async function recordPlannerRecommendationAppliedForSourceFingerprint(cwd: string, appliedSourceFingerprint: string, lastRefreshedBy = 'apply-planner-result'): Promise<RecommendationDerivedStatus> {
  const sourceFingerprint = await computeRecommendationSourceFingerprint(cwd);
  const now = new Date().toISOString();
  const reasons = appliedSourceFingerprint === sourceFingerprint ? [] : [sourceDriftReason(sourceFingerprint, appliedSourceFingerprint)];
  await writeRecommendationStatusSidecar(resolveRecommendationStatusPathForCwd(cwd), {
    schemaVersion: 1,
    lastAppliedAt: now,
    freshAt: now,
    ...(reasons.length > 0 && { staleSince: now }),
    lastRefreshedBy,
    lastAppliedSourceFingerprint: appliedSourceFingerprint,
    sourceFingerprint,
    reasons,
    staleReasons: reasons,
  });
  return readDerivedRecommendationStatus(cwd);
}

export async function markRecommendationsStale(cwd: string, reason: RecommendationStaleReason): Promise<RecommendationDerivedStatus | null> {
  const currentPath = resolveCurrentPath(cwd);
  const statusPath = resolveRecommendationStatusPathForCwd(cwd);
  const sourceFingerprint = await computeRecommendationSourceFingerprint(cwd);
  const previous = await readRecommendationStatusSidecarIfValid(statusPath);
  const now = new Date().toISOString();
  const lastAppliedAt = previous?.lastAppliedAt ?? previous?.freshAt ?? now;
  const lastAppliedSourceFingerprint = previous?.lastAppliedSourceFingerprint ?? sourceFingerprint;
  const reasons = appendStaleReason(sidecarReasons(previous), reason);
  await writeRecommendationStatusSidecar(statusPath, {
    schemaVersion: 1,
    lastAppliedAt,
    freshAt: previous?.freshAt ?? previous?.lastAppliedAt,
    staleSince: previous?.staleSince ?? now,
    lastRefreshedBy: previous?.lastRefreshedBy,
    lastAppliedSourceFingerprint,
    sourceFingerprint,
    reasons,
    staleReasons: reasons,
  });
  return readDerivedRecommendationStatus(cwd, currentPath);
}

export async function markRecommendationsStaleForBacklogMutation(cwd: string, actionId: string, refs: readonly string[]): Promise<RecommendationDerivedStatus | null> {
  const currentPath = resolveCurrentPath(cwd);
  const statusPath = resolveRecommendationStatusPathForCwd(cwd);
  if (!existsSync(currentPath) && !existsSync(statusPath)) return null;

  const suffix = refs.length > 0 ? ` for ${refs.join(', ')}` : '';
  return markRecommendationsStale(cwd, {
    code: `backlog-mutation:${actionId}`,
    message: `Recommendations are stale after eforge-plan backlog mutation ${actionId}${suffix}.`,
  });
}

export async function markRecommendationsStaleForLifecycleUpdate(cwd: string, input: { eventType: string; itemIds: readonly string[]; correlationKind: 'single' | 'multi' | 'bootstrapped'; timestamp: string; summary: string; refs?: readonly string[] }): Promise<RecommendationDerivedStatus | null> {
  return markRecommendationsStale(cwd, {
    eventType: input.eventType,
    itemIds: [...input.itemIds],
    correlationKind: input.correlationKind,
    timestamp: input.timestamp,
    summary: input.summary,
    code: `lifecycle:${input.eventType}`,
    message: input.summary,
    ...(input.refs !== undefined && { refs: [...input.refs] }),
  });
}

export async function computeRecommendationSourceFingerprint(cwd: string): Promise<string> {
  return sha256(canonicalJson(await buildRecommendationSourceProjection(cwd)));
}

export async function buildRecommendationSourceProjection(cwd: string): Promise<Record<string, unknown>> {
  const [allItems, allEpics, traceSidecars] = await Promise.all([listBacklogItems(cwd), listBacklogEpics(cwd), listTraceSidecars(cwd)]);
  const items = allItems.filter((item) => isOpenStatus(item.status)).sort(byId);
  const epics = allEpics.filter((epic) => isOpenStatus(epic.status)).sort(byId);
  const openItemIds = new Set(items.map((item) => item.id));
  const traceSummaries = compactTraceSummaries(traceSidecars.flatMap((trace) => summarizeTrace(trace) ?? []).filter((summary) => openItemIds.has(summary.itemId)));
  return {
    schemaVersion: 1,
    items: items.map(projectSourceItem),
    epics: epics.map(projectSourceEpic),
    dependencies: dependencyProjection(items).sort(byItemId),
    blockers: blockerRiskProjection(items).sort(byItemId),
    roadmapEvidence: await readRoadmapFingerprintEvidence(cwd),
    traceSummaries,
  };
}

export async function readPlannerTraceSummaries(cwd: string, itemIds?: readonly string[]): Promise<Array<Record<string, unknown>>> {
  const traces = await listTraceSidecars(cwd);
  const relevantItemIds = itemIds === undefined ? undefined : new Set(itemIds);
  const summaries = traces.flatMap((trace) => summarizeTrace(trace) ?? []).filter((summary) => relevantItemIds === undefined || relevantItemIds.has(summary.itemId));
  return compactTraceSummaries(summaries);
}

// --- eforge:region recommendation-validation ---
export interface RecommendationReferenceRecord {
  id: string;
  status?: BacklogStatus;
  title?: string;
}

export async function validateRecommendationReferences(cwd: string, model: BacklogRecommendationModel): Promise<void> {
  const [items, epics] = await Promise.all([listBacklogItems(cwd), listBacklogEpics(cwd)]);
  validateRecommendationReferencesAgainstRecords(model, items, epics);
}

export function validateRecommendationReferencesAgainstIds(model: BacklogRecommendationModel, itemIds: ReadonlySet<string>, epicIds: ReadonlySet<string>): void {
  validateRecommendationReferencesAgainstRecords(
    model,
    [...itemIds].map((id) => ({ id, status: 'candidate' as const })),
    [...epicIds].map((id) => ({ id, status: 'candidate' as const })),
  );
}

export function validateRecommendationReferencesAgainstRecords(model: BacklogRecommendationModel, items: readonly RecommendationReferenceRecord[], epics: readonly RecommendationReferenceRecord[]): void {
  const result = collectRecommendationReferenceValidationIssues(model, items, epics);
  if (!result.valid) throwRecommendationReferenceValidationError(result.issues);
}

export function collectRecommendationReferenceValidationIssues(model: BacklogRecommendationModel, items: readonly RecommendationReferenceRecord[], epics: readonly RecommendationReferenceRecord[]): RecommendationReferenceValidationResult {
  const itemCatalog = new Map(items.map((item) => [item.id, item]));
  const epicCatalog = new Map(epics.map((epic) => [epic.id, epic]));
  const issues: RecommendationReferenceValidationIssue[] = [];
  for (const [field, refs] of [
    ['activeWork', model.activeWork],
    ['readyCandidates', model.readyCandidates],
    ['recommendedNextSequence', model.recommendedNextSequence],
  ] as const) {
    refs.forEach((ref, index) => collectKnownOpenRefIssue(`${field}[${index}].itemId`, ref.itemId, itemCatalog, 'item', issues));
  }
  for (const group of model.safeParallelizableGroups) {
    if (group.itemIds.length === 0) issues.push(buildRecommendationReferenceIssue(`safeParallelizableGroups.${group.ref}.itemIds`, '', 'item', 'empty', undefined));
    for (const itemId of group.itemIds) collectKnownOpenRefIssue(`safeParallelizableGroups.${group.ref}.itemIds`, itemId, itemCatalog, 'item', issues);
    for (const epicId of group.epicIds ?? []) collectKnownOpenRefIssue(`safeParallelizableGroups.${group.ref}.epicIds`, epicId, epicCatalog, 'epic', issues);
  }
  for (const chain of model.blockedChains) {
    const ref = chain.ref ?? '<unreferenced>';
    for (const itemId of chain.itemIds) collectKnownOpenRefIssue(`blockedChains.${ref}.itemIds`, itemId, itemCatalog, 'item', issues);
    for (const blockerId of chain.blockedBy) collectKnownOpenRefIssue(`blockedChains.${ref}.blockedBy`, blockerId, itemCatalog, 'item', issues);
  }
  return { valid: issues.length === 0, issues };
}

export function throwRecommendationReferenceValidationError(issues: readonly RecommendationReferenceValidationIssue[]): never {
  const first = issues[0];
  const message = first?.message ?? 'Recommendation references are invalid.';
  throw new ExtensionActionInputValidationError(message, issues.map((issue) => ({ ...issue })) as Array<{ path: string; message: string }>);
}
// --- eforge:endregion recommendation-validation ---

async function readRecommendationStatusSidecar(statusPath: string): Promise<RecommendationStatusSidecar | null> {
  if (!existsSync(statusPath)) return null;
  return parseWithSchema(RecommendationStatusSidecarSchema, JSON.parse(await readFile(statusPath, 'utf-8')) as unknown);
}

async function writeRecommendationStatusSidecar(statusPath: string, sidecar: RecommendationStatusSidecar): Promise<void> {
  const normalized = parseWithSchema(RecommendationStatusSidecarSchema, sidecar);
  await mkdir(dirname(statusPath), { recursive: true });
  await writeFile(statusPath, `${JSON.stringify(normalized, null, 2)}\n`);
}

function staleStatus(currentPath: string, statusPath: string, sourceFingerprint: string, lastAppliedSourceFingerprint: string | undefined, staleReasons: RecommendationStaleReason[]): RecommendationDerivedStatus {
  return statusFromParts({
    state: 'stale',
    currentPath,
    statusPath,
    sourceFingerprint,
    lastAppliedSourceFingerprint,
    staleSince: new Date().toISOString(),
    reasons: staleReasons,
  });
}

function missingStatus(currentPath: string, statusPath: string): RecommendationDerivedStatus {
  return statusFromParts({ state: 'missing', currentPath, statusPath, reasons: [] });
}

function statusFromParts(input: Omit<RecommendationDerivedStatus, 'staleReasons'> & { reasons: RecommendationStaleReason[] }): RecommendationDerivedStatus {
  return Object.fromEntries(Object.entries({
    ...input,
    reasons: input.reasons,
    staleReasons: input.reasons,
  }).filter(([, value]) => value !== undefined)) as RecommendationDerivedStatus;
}

function missingStatusSidecarReason(): RecommendationStaleReason {
  return { code: 'missing-status-sidecar', message: 'Recommendation status metadata sidecar is missing.' };
}

async function readRecommendationStatusSidecarIfValid(statusPath: string): Promise<RecommendationStatusSidecar | null> {
  try {
    return await readRecommendationStatusSidecar(statusPath);
  } catch {
    return null;
  }
}

function invalidStatusSidecarReason(err: unknown): RecommendationStaleReason {
  const detail = err instanceof Error ? err.message : String(err);
  return { code: 'invalid-status-sidecar', message: `Recommendation status metadata sidecar is invalid: ${detail}` };
}

function invalidFreshnessSidecarReason(sidecar: RecommendationStatusSidecar): RecommendationStaleReason | null {
  if (sidecar.lastAppliedAt !== undefined && sidecar.lastAppliedSourceFingerprint !== undefined) return null;
  return {
    code: 'invalid-status-sidecar',
    message: 'Recommendation status metadata sidecar is invalid: freshness metadata requires lastAppliedAt and lastAppliedSourceFingerprint.',
  };
}

function sourceDriftReason(sourceFingerprint: string, lastAppliedSourceFingerprint: string): RecommendationStaleReason {
  const message = 'Recommendation source fingerprint drifted since the model was last applied.';
  return {
    code: 'source-fingerprint-drift',
    message,
    summary: message,
    sourceFingerprint,
    lastAppliedSourceFingerprint,
  };
}

function sidecarReasons(sidecar: RecommendationStatusSidecar | null | undefined): RecommendationStaleReason[] {
  return sidecar?.reasons ?? sidecar?.staleReasons ?? [];
}

function appendStaleReason(existing: RecommendationStaleReason[], reason: RecommendationStaleReason): RecommendationStaleReason[] {
  const key = stableReasonKey(reason);
  return [...existing.filter((candidate) => stableReasonKey(candidate) !== key), reason].slice(-RECOMMENDATION_STALE_REASON_LIMIT);
}

function stableReasonKey(reason: RecommendationStaleReason): string {
  return canonicalJson(reason);
}

function resolveCurrentPath(cwd: string): string {
  return createEforgeProjectPaths({ cwd, extensionName: 'eforge-plan' }).extensionStoragePath('project-local', ['recommendations', 'current.json']);
}

function projectSourceItem(item: BacklogItem): Record<string, unknown> {
  return {
    id: item.id,
    title: item.title,
    status: item.status,
    ...(item.epic !== undefined && { epic: item.epic }),
    tags: [...item.tags].sort(),
    dependsOn: [...item.depends_on].sort(),
    sections: Object.fromEntries([...extractMarkdownSections(item.body).entries()].sort(([left], [right]) => left.localeCompare(right))),
  };
}

function projectSourceEpic(epic: BacklogEpic): Record<string, unknown> {
  return {
    id: epic.id,
    title: epic.title,
    status: epic.status,
    tags: [...epic.tags].sort(),
    sections: Object.fromEntries([...extractMarkdownSections(epic.body).entries()].sort(([left], [right]) => left.localeCompare(right))),
  };
}

async function readRoadmapFingerprintEvidence(cwd: string): Promise<Record<string, unknown>> {
  const path = 'docs/roadmap.md';
  const absolute = join(cwd, path);
  if (!existsSync(absolute)) return { path, exists: false, headings: [], excerpts: [] };
  const markdown = await readFile(absolute, 'utf-8');
  const headings = markdown.split(/\r?\n/).map((line) => /^#{1,6}\s+(.+)$/.exec(line)?.[1]?.trim()).filter((line): line is string => Boolean(line));
  const excerpts = markdown.split(/\n\s*\n/).map((block) => block.trim()).filter(Boolean).slice(0, 5);
  return { path, exists: true, headings, excerpts };
}

function compactTraceSummaries(summaries: Array<{ itemId: string; epicId?: string; hasActiveSessionPlan: boolean; hasActiveQueuePrd: boolean; hasActiveBuildRun: boolean; hasActiveBuildSession: boolean; hasActiveTrace: boolean; activeReasons: string[]; lastEvent?: Record<string, unknown>; lifecycleState?: string; linkRows?: LifecycleLinkRow[] }>): Array<Record<string, unknown>> {
  return summaries.sort(byItemId).map((summary) => ({
    itemId: summary.itemId,
    ...(summary.epicId !== undefined && { epicId: summary.epicId }),
    hasActiveSessionPlan: summary.hasActiveSessionPlan,
    hasActiveQueuePrd: summary.hasActiveQueuePrd,
    hasActiveBuildRun: summary.hasActiveBuildRun,
    hasActiveBuildSession: summary.hasActiveBuildSession,
    hasActiveTrace: summary.hasActiveTrace,
    activeReasons: summary.activeReasons,
    ...(summary.lastEvent !== undefined && { lastEvent: pickLastEvent(summary.lastEvent) }),
    ...(summary.lifecycleState !== undefined ? { lifecycleState: summary.lifecycleState } : {}),
    ...((summary.linkRows ?? []).length > 0 ? { lifecycleLinks: compactLifecycleRowsForFingerprint(summary.linkRows ?? []) } : {}),
  }));
}

function pickLastEvent(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(['type', 'timestamp', 'sessionId', 'runId', 'cursor'].flatMap((key) => (value[key] === undefined ? [] : [[key, value[key]]])));
}

// --- eforge:region recommendation-validation ---
function collectKnownOpenRefIssue(path: string, id: string, catalog: ReadonlyMap<string, RecommendationReferenceRecord>, kind: 'item' | 'epic', issues: RecommendationReferenceValidationIssue[]): void {
  const record = catalog.get(id);
  if (record === undefined) {
    issues.push(buildRecommendationReferenceIssue(path, id, kind, 'unknown', undefined));
    return;
  }
  if (record.status !== undefined && isClosedStatus(record.status)) {
    issues.push(buildRecommendationReferenceIssue(path, id, kind, 'closed', record));
  }
}

function buildRecommendationReferenceIssue(path: string, id: string, kind: 'item' | 'epic', reason: RecommendationReferenceValidationIssue['reason'], record: RecommendationReferenceRecord | undefined): RecommendationReferenceValidationIssue {
  const status = record?.status;
  const title = record?.title;
  const target = id.length > 0 ? `${kind} id "${id}"` : `${kind} id`;
  const reasonText = reason === 'empty'
    ? 'must include at least one open item id'
    : reason === 'closed'
      ? `references closed ${target}${status !== undefined ? ` with status "${status}"` : ''}`
      : `references unknown ${target}`;
  return {
    path,
    id,
    kind,
    reason,
    ...(status !== undefined && { status }),
    ...(title !== undefined && { title }),
    message: `Recommendation ${path} ${reasonText}. Recommendation target fields may reference only open ${kind} ids.`,
  };
}
// --- eforge:endregion recommendation-validation ---

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalize(entry)]));
  }
  return value;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function byId(left: { id: string }, right: { id: string }): number {
  return left.id.localeCompare(right.id);
}

function byItemId(left: { itemId: string }, right: { itemId: string }): number {
  return left.itemId.localeCompare(right.itemId);
}
