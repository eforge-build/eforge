import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { parseWithSchema } from '@eforge-build/client';
import { ExtensionActionInputValidationError, createEforgeProjectPaths, type EforgeProjectPaths } from '../../../packages/extension-sdk/src/index.js';
import {
  blockerRiskProjection,
  dependencyProjection,
  extractMarkdownSections,
  isOpenStatus,
  type BacklogEpic,
  type BacklogItem,
} from './backlog-domain.js';
import { listBacklogEpics, listBacklogItems } from './markdown-store.js';
import { listTraceSidecars, summarizeTrace } from './trace-store.js';
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
  if (!existsSync(currentPath)) return { state: 'missing', currentPath, statusPath, staleReasons: [] };
  const sourceFingerprint = await computeRecommendationSourceFingerprint(cwd);
  let sidecar: RecommendationStatusSidecar | null;
  try {
    sidecar = await readRecommendationStatusSidecar(statusPath);
  } catch (err) {
    return staleStatus(currentPath, statusPath, sourceFingerprint, undefined, [invalidStatusSidecarReason(err)]);
  }
  if (sidecar === null) {
    return staleStatus(currentPath, statusPath, sourceFingerprint, undefined, [missingStatusSidecarReason()]);
  }
  const staleReasons = sidecar.staleReasons.filter((reason) => reason.code !== 'source-fingerprint-drift');
  if (sidecar.lastAppliedSourceFingerprint !== sourceFingerprint) {
    staleReasons.push(sourceDriftReason(sourceFingerprint, sidecar.lastAppliedSourceFingerprint));
  }
  return {
    state: staleReasons.length > 0 ? 'stale' : 'fresh',
    currentPath,
    statusPath,
    sourceFingerprint,
    lastAppliedSourceFingerprint: sidecar.lastAppliedSourceFingerprint,
    staleReasons,
  };
}

export async function recordRecommendationPutApplied(cwd: string): Promise<RecommendationDerivedStatus> {
  const sourceFingerprint = await computeRecommendationSourceFingerprint(cwd);
  await writeRecommendationStatusSidecar(resolveRecommendationStatusPathForCwd(cwd), {
    schemaVersion: 1,
    lastAppliedAt: new Date().toISOString(),
    lastAppliedSourceFingerprint: sourceFingerprint,
    sourceFingerprint,
    staleReasons: [],
  });
  return readDerivedRecommendationStatus(cwd);
}

export async function recordPlannerRecommendationApplied(cwd: string): Promise<RecommendationDerivedStatus> {
  return recordPlannerRecommendationAppliedForSourceFingerprint(cwd, await computeRecommendationSourceFingerprint(cwd));
}

// --- eforge:region plan-02-refresh-invalidation ---
export async function recordPlannerRecommendationAppliedForSourceFingerprint(cwd: string, appliedSourceFingerprint: string): Promise<RecommendationDerivedStatus> {
  const sourceFingerprint = await computeRecommendationSourceFingerprint(cwd);
  await writeRecommendationStatusSidecar(resolveRecommendationStatusPathForCwd(cwd), {
    schemaVersion: 1,
    lastAppliedAt: new Date().toISOString(),
    lastAppliedSourceFingerprint: appliedSourceFingerprint,
    sourceFingerprint,
    staleReasons: appliedSourceFingerprint === sourceFingerprint ? [] : [sourceDriftReason(sourceFingerprint, appliedSourceFingerprint)],
  });
  return readDerivedRecommendationStatus(cwd);
}

export async function markRecommendationsStale(cwd: string, reason: RecommendationStaleReason): Promise<RecommendationDerivedStatus | null> {
  const currentPath = resolveCurrentPath(cwd);
  if (!existsSync(currentPath)) return null;
  const statusPath = resolveRecommendationStatusPathForCwd(cwd);
  const sourceFingerprint = await computeRecommendationSourceFingerprint(cwd);
  const previous = await readRecommendationStatusSidecarIfValid(statusPath);
  const lastAppliedAt = previous?.lastAppliedAt ?? new Date().toISOString();
  const lastAppliedSourceFingerprint = previous?.lastAppliedSourceFingerprint ?? sourceFingerprint;
  await writeRecommendationStatusSidecar(statusPath, {
    schemaVersion: 1,
    lastAppliedAt,
    lastAppliedSourceFingerprint,
    sourceFingerprint,
    staleReasons: appendStaleReason(previous?.staleReasons ?? [], reason),
  });
  return readDerivedRecommendationStatus(cwd);
}

export async function markRecommendationsStaleForBacklogMutation(cwd: string, actionId: string, refs: readonly string[]): Promise<RecommendationDerivedStatus | null> {
  const suffix = refs.length > 0 ? ` for ${refs.join(', ')}` : '';
  return markRecommendationsStale(cwd, {
    code: `backlog-mutation:${actionId}`,
    message: `Recommendations are stale after eforge-plan backlog mutation ${actionId}${suffix}.`,
  });
}

export async function markRecommendationsStaleForLifecycleUpdate(cwd: string, eventType: string, itemIds: readonly string[], refs: readonly string[]): Promise<RecommendationDerivedStatus | null> {
  const itemSuffix = itemIds.length > 0 ? ` for ${itemIds.join(', ')}` : '';
  const refSuffix = refs.length > 0 ? ` (${refs.join(', ')})` : '';
  return markRecommendationsStale(cwd, {
    code: `lifecycle:${eventType}`,
    message: `Recommendations are stale after correlated lifecycle update ${eventType}${itemSuffix}${refSuffix}.`,
  });
}
// --- eforge:endregion plan-02-refresh-invalidation ---

export async function computeRecommendationSourceFingerprint(cwd: string): Promise<string> {
  return sha256(canonicalJson(await buildRecommendationSourceProjection(cwd)));
}

export async function buildRecommendationSourceProjection(cwd: string): Promise<Record<string, unknown>> {
  const [allItems, allEpics, traceSidecars] = await Promise.all([listBacklogItems(cwd), listBacklogEpics(cwd), listTraceSidecars(cwd)]);
  const items = allItems.filter((item) => isOpenStatus(item.status)).sort(byId);
  const epics = allEpics.filter((epic) => isOpenStatus(epic.status)).sort(byId);
  const traceSummaries = compactTraceSummaries(traceSidecars.flatMap((trace) => summarizeTrace(trace) ?? []));
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

export async function readPlannerTraceSummaries(cwd: string): Promise<Array<Record<string, unknown>>> {
  const traces = await listTraceSidecars(cwd);
  return compactTraceSummaries(traces.flatMap((trace) => summarizeTrace(trace) ?? []));
}

export async function validateRecommendationReferences(cwd: string, model: BacklogRecommendationModel): Promise<void> {
  const [items, epics] = await Promise.all([listBacklogItems(cwd), listBacklogEpics(cwd)]);
  const itemIds = new Set(items.map((item) => item.id));
  const epicIds = new Set(epics.map((epic) => epic.id));
  for (const [field, refs] of [
    ['activeWork', model.activeWork],
    ['readyCandidates', model.readyCandidates],
    ['recommendedNextSequence', model.recommendedNextSequence],
  ] as const) {
    for (const ref of refs) assertKnownRef(field, ref.itemId, itemIds, 'item');
  }
  for (const group of model.safeParallelizableGroups) {
    if (group.itemIds.length === 0) throw recommendationReferenceValidationError(`safeParallelizableGroups.${group.ref}.itemIds`, '', 'item', `Recommendation group ${group.ref} must include at least one item id.`);
    for (const itemId of group.itemIds) assertKnownRef(`safeParallelizableGroups.${group.ref}.itemIds`, itemId, itemIds, 'item');
    for (const epicId of group.epicIds ?? []) assertKnownRef(`safeParallelizableGroups.${group.ref}.epicIds`, epicId, epicIds, 'epic');
  }
  for (const chain of model.blockedChains) {
    const ref = chain.ref ?? '<unreferenced>';
    for (const itemId of chain.itemIds) assertKnownRef(`blockedChains.${ref}.itemIds`, itemId, itemIds, 'item');
    for (const blockerId of chain.blockedBy) assertKnownRef(`blockedChains.${ref}.blockedBy`, blockerId, itemIds, 'item');
  }
}

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
  return {
    state: 'stale',
    currentPath,
    statusPath,
    sourceFingerprint,
    ...(lastAppliedSourceFingerprint !== undefined && { lastAppliedSourceFingerprint }),
    staleReasons,
  };
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

function sourceDriftReason(sourceFingerprint: string, lastAppliedSourceFingerprint: string): RecommendationStaleReason {
  return {
    code: 'source-fingerprint-drift',
    message: 'Recommendation source fingerprint drifted since the model was last applied.',
    sourceFingerprint,
    lastAppliedSourceFingerprint,
  };
}

// --- eforge:region plan-02-refresh-invalidation ---
function appendStaleReason(existing: RecommendationStaleReason[], reason: RecommendationStaleReason): RecommendationStaleReason[] {
  return [...existing.filter((candidate) => candidate.code !== reason.code || candidate.message !== reason.message), reason];
}
// --- eforge:endregion plan-02-refresh-invalidation ---

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

function compactTraceSummaries(summaries: Array<{ itemId: string; epicId?: string; hasActiveSessionPlan: boolean; hasActiveQueuePrd: boolean; hasActiveBuildRun: boolean; hasActiveBuildSession: boolean; hasActiveTrace: boolean; activeReasons: string[]; lastEvent?: Record<string, unknown> }>): Array<Record<string, unknown>> {
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
  }));
}

function pickLastEvent(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(['type', 'timestamp', 'sessionId', 'runId', 'cursor'].flatMap((key) => (value[key] === undefined ? [] : [[key, value[key]]])));
}

function assertKnownRef(field: string, id: string, knownIds: Set<string>, kind: 'item' | 'epic'): void {
  if (!knownIds.has(id)) throw recommendationReferenceValidationError(field, id, kind, `Recommendation ${field} references unknown ${kind} id "${id}".`);
}

function recommendationReferenceValidationError(field: string, id: string, kind: 'item' | 'epic', message: string): ExtensionActionInputValidationError {
  return new ExtensionActionInputValidationError(message, [{
    path: field,
    message: `${message} Expected an existing ${kind} id${id.length > 0 ? `; missing id: ${id}` : ''}.`,
  }]);
}

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
