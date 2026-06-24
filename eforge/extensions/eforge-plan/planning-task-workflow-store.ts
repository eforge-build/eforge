import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createEforgeProjectPaths } from '@eforge-build/extension-sdk';
import { safeParseWithSchema } from '@eforge-build/client';
import { PlanningTaskWorkflowIndexSchema, type PlanningTaskWorkflowEntry, type PlanningTaskWorkflowIndex } from './planning-agent-task-schemas.js';
import { getDatabase } from './sqlite/store-internal.js';
import { withCanonicalTransaction } from './canonical/store.js';
import { markPlanningTaskWorkflowEntryApplied as markCanonicalPlanningTaskWorkflowEntryApplied, markPlanningTaskWorkflowEntryDismissed as markCanonicalPlanningTaskWorkflowEntryDismissed, recordPlanningTaskWorkflowEntry as recordCanonicalPlanningTaskWorkflowEntry } from './canonical/planning-task-records.js';
import { DEFAULT_ITEM_AUDIT_CONCURRENCY, MAX_ITEM_AUDIT_CONCURRENCY } from './backlog-curation-schemas.js';
import { readRecommendations } from './recommendations-store.js';

const EXTENSION_NAME = 'eforge-plan';
const INDEX_SEGMENTS = ['planning-tasks', 'index.json'] as const;
export const RECOMMENDATION_REFRESH_WORKFLOW_PURPOSE = 'recommendation-refresh' as const;
export const BACKLOG_CURATION_WORKFLOW_PURPOSE = 'backlog-curation' as const;

// Per-index-path serialization: chain read-modify-write operations so concurrent
// starts/retries in the same daemon process never race the shared index file.
const indexWriteChains = new Map<string, Promise<unknown>>();
// Monotonic counter so each in-process write gets a unique temp filename even when
// two writes for the same index are in flight.
let tempWriteSequence = 0;

function runExclusive<T>(key: string, task: () => Promise<T>): Promise<T> {
  const prior = indexWriteChains.get(key) ?? Promise.resolve();
  const result = prior.then(task, task);
  let chain: Promise<unknown>;
  chain = result.then(() => undefined, () => undefined).finally(() => {
    if (indexWriteChains.get(key) === chain) indexWriteChains.delete(key);
  });
  indexWriteChains.set(key, chain);
  return result;
}

/**
 * Resolve the project-local workflow index path:
 * `.eforge/storage/extensions/eforge-plan/planning-tasks/index.json`.
 */
export function resolvePlanningTaskWorkflowIndexPath(cwd: string): string {
  return createEforgeProjectPaths({ cwd, extensionName: EXTENSION_NAME }).extensionStoragePath('project-local', [...INDEX_SEGMENTS]);
}

function emptyIndex(): PlanningTaskWorkflowIndex {
  return { schemaVersion: 1, entries: [] };
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

/**
 * Read the durable workflow index. Missing or malformed storage yields an empty
 * index so callers never crash on first run or partial writes; other read
 * failures are surfaced to avoid hiding durable tasks.
 */
export async function readPlanningTaskWorkflowIndex(cwd: string): Promise<PlanningTaskWorkflowIndex> {
  const canonical = readCanonicalWorkflowIndex(cwd);
  if (canonical.hasRows || canonical.index.entries.length > 0) return canonical.index;
  let raw: string;
  try {
    raw = await readFile(resolvePlanningTaskWorkflowIndexPath(cwd), 'utf-8');
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return emptyIndex();
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return emptyIndex();
  }
  const result = safeParseWithSchema(PlanningTaskWorkflowIndexSchema, parsed);
  return result.success ? orderIndex(result.data) : emptyIndex();
}

/**
 * Persist a workflow entry, replacing any existing entry with the same task id.
 * Writes atomically via a temp file + rename so concurrent reads never observe a
 * partial document.
 */
export async function recordPlanningTaskWorkflowEntry(cwd: string, entry: PlanningTaskWorkflowEntry): Promise<PlanningTaskWorkflowEntry> {
  const path = resolvePlanningTaskWorkflowIndexPath(cwd);
  return runExclusive(path, async () => {
    recordCanonicalPlanningTaskWorkflowEntry(cwd, await canonicalPlanningTaskInput(cwd, entry));
    return entry;
  });
}

export async function removePlanningTaskWorkflowEntry(cwd: string, taskId: string): Promise<boolean> {
  const path = resolvePlanningTaskWorkflowIndexPath(cwd);
  return runExclusive(path, async () => {
    const existed = findPlanningTaskWorkflowEntry(await readPlanningTaskWorkflowIndex(cwd), taskId) !== undefined;
    if (existed) markCanonicalPlanningTaskWorkflowEntryDismissed(cwd, taskId);
    return existed;
  });
}

export async function markPlanningTaskWorkflowEntryApplied(cwd: string, taskId: string, appliedAt: string): Promise<PlanningTaskWorkflowEntry> {
  const path = resolvePlanningTaskWorkflowIndexPath(cwd);
  return runExclusive(path, async () => {
    const entry = findPlanningTaskWorkflowEntry(await readPlanningTaskWorkflowIndex(cwd), taskId);
    if (entry === undefined) throw new Error(`No planning task workflow entry found for ${taskId}; cannot mark applied.`);
    markCanonicalPlanningTaskWorkflowEntryApplied(cwd, taskId, appliedAt);
    return { ...entry, appliedAt };
  });
}

export function findPlanningTaskWorkflowEntry(index: PlanningTaskWorkflowIndex, taskId: string): PlanningTaskWorkflowEntry | undefined {
  return index.entries.find((entry) => entry.taskId === taskId);
}

export function listPlanningTaskWorkflowEntries(index: PlanningTaskWorkflowIndex): PlanningTaskWorkflowEntry[] {
  return orderIndex(index).entries;
}

export function isRecommendationRefreshWorkflowEntry(entry: PlanningTaskWorkflowEntry): boolean {
  return entry.purpose === RECOMMENDATION_REFRESH_WORKFLOW_PURPOSE;
}

export function listRecommendationRefreshWorkflowEntries(index: PlanningTaskWorkflowIndex, sourceFingerprint?: string): PlanningTaskWorkflowEntry[] {
  return listPlanningTaskWorkflowEntries(index).filter((entry) => (
    isRecommendationRefreshWorkflowEntry(entry)
    && (sourceFingerprint === undefined || entry.sourceFingerprint === sourceFingerprint)
  ));
}

export function findRecommendationRefreshWorkflowEntry(index: PlanningTaskWorkflowIndex, sourceFingerprint: string): PlanningTaskWorkflowEntry | undefined {
  return listRecommendationRefreshWorkflowEntries(index, sourceFingerprint)[0];
}

export function isBacklogCurationWorkflowEntry(entry: PlanningTaskWorkflowEntry): boolean {
  return entry.purpose === BACKLOG_CURATION_WORKFLOW_PURPOSE;
}

export function listBacklogCurationWorkflowEntries(index: PlanningTaskWorkflowIndex, sourceFingerprint?: string, itemAuditConcurrency?: number): PlanningTaskWorkflowEntry[] {
  return listPlanningTaskWorkflowEntries(index).filter((entry) => isBacklogCurationWorkflowEntry(entry)
    && (sourceFingerprint === undefined || entry.sourceFingerprint === sourceFingerprint)
    && (itemAuditConcurrency === undefined || normalizeStoredItemAuditConcurrency(entry.itemAuditConcurrency) === normalizeStoredItemAuditConcurrency(itemAuditConcurrency)));
}

export function findBacklogCurationWorkflowEntry(index: PlanningTaskWorkflowIndex, sourceFingerprint: string, itemAuditConcurrency?: number): PlanningTaskWorkflowEntry | undefined {
  return listBacklogCurationWorkflowEntries(index, sourceFingerprint, itemAuditConcurrency)[0];
}

function readCanonicalWorkflowIndex(cwd: string): { index: PlanningTaskWorkflowIndex; hasRows: boolean } {
  return withCanonicalTransaction(cwd, (store) => {
    const db = getDatabase(store);
    const hasRows = (db.prepare('SELECT 1 FROM planning_tasks LIMIT 1').get() as unknown) !== undefined;
    const rows = db.prepare("SELECT raw_request_json, task_id, created_at, applied_at FROM planning_tasks WHERE COALESCE(status_snapshot, '') <> 'dismissed' ORDER BY created_at DESC, task_id").all() as Array<Record<string, unknown>>;
    const entries = rows.map((row) => entryFromCanonicalRow(row)).filter((entry): entry is PlanningTaskWorkflowEntry => entry !== undefined);
    return { index: orderIndex({ schemaVersion: 1, entries }), hasRows };
  });
}

function entryFromCanonicalRow(row: Record<string, unknown>): PlanningTaskWorkflowEntry | undefined {
  const raw = typeof row.raw_request_json === 'string' ? JSON.parse(row.raw_request_json) as unknown : undefined;
  const parsed = safeParseWithSchema(PlanningTaskWorkflowIndexSchema.properties.entries.items, raw);
  if (!parsed.success) return undefined;
  return { ...parsed.data, ...(typeof row.applied_at === 'string' ? { appliedAt: row.applied_at } : {}) };
}

async function canonicalPlanningTaskInput(cwd: string, entry: PlanningTaskWorkflowEntry): Promise<Parameters<typeof recordCanonicalPlanningTaskWorkflowEntry>[1]> {
  return {
    taskId: entry.taskId,
    purpose: entry.purpose,
    status: entry.appliedAt !== undefined ? 'applied' : 'active',
    sourceFingerprint: entry.sourceFingerprint,
    requestedSections: entry.requestedOutputSections as never,
    selectionSummary: entry.selection as never,
    rawRequest: entry as never,
    parentTaskId: entry.parentTaskId,
    itemRefs: await resolveWorkflowSelectionItemIds(cwd, entry),
    epicRefs: entry.selection.epicId !== undefined ? [entry.selection.epicId] : undefined,
    recommendationRefs: entry.selection.recommendationRef !== undefined ? [entry.selection.recommendationRef] : undefined,
  };
}

async function resolveWorkflowSelectionItemIds(cwd: string, entry: PlanningTaskWorkflowEntry): Promise<string[] | undefined> {
  const itemIds = new Set(entry.selection.itemIds ?? []);
  withCanonicalTransaction(cwd, (store) => {
    const db = getDatabase(store);
    if (entry.selection.epicId !== undefined) {
      const rows = db.prepare('SELECT id FROM backlog_items WHERE epic_id = ? OR epic_ref = ?').all(entry.selection.epicId, entry.selection.epicId) as Array<{ id?: unknown }>;
      for (const row of rows) if (typeof row.id === 'string') itemIds.add(row.id);
    }
  });
  if (entry.selection.recommendationRef !== undefined) {
    const recommendations = await readRecommendations(cwd);
    const group = recommendations?.safeParallelizableGroups.find((candidate) => candidate.ref === entry.selection.recommendationRef);
    for (const itemId of group?.itemIds ?? []) itemIds.add(itemId);
    const item = recommendations?.recommendedNextSequence.find((candidate) => candidate.ref === entry.selection.recommendationRef);
    if (item !== undefined) itemIds.add(item.itemId);
  }
  return itemIds.size > 0 ? [...itemIds] : undefined;
}

function normalizeStoredItemAuditConcurrency(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? Math.min(value, MAX_ITEM_AUDIT_CONCURRENCY) : DEFAULT_ITEM_AUDIT_CONCURRENCY;
}

async function writePlanningTaskWorkflowIndex(cwd: string, index: PlanningTaskWorkflowIndex): Promise<void> {
  const path = resolvePlanningTaskWorkflowIndexPath(cwd);
  await mkdir(dirname(path), { recursive: true });
  const ordered = orderIndex(index);
  const tempPath = `${path}.${process.pid}.${tempWriteSequence++}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(ordered, null, 2)}\n`, 'utf-8');
  await rename(tempPath, path);
}

// Stable ordering: newest first by creation timestamp, with task id as a
// deterministic tie-breaker so list projections never reorder between reads.
function orderIndex(index: PlanningTaskWorkflowIndex): PlanningTaskWorkflowIndex {
  const entries = [...index.entries].sort((a, b) => {
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
    return a.taskId < b.taskId ? -1 : a.taskId > b.taskId ? 1 : 0;
  });
  return { schemaVersion: 1, entries };
}
