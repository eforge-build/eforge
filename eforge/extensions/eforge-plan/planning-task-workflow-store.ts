import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createEforgeProjectPaths } from '../../../packages/extension-sdk/src/index.js';
import { safeParseWithSchema } from '../../../packages/client/src/index.js';
import { PlanningTaskWorkflowIndexSchema, type PlanningTaskWorkflowEntry, type PlanningTaskWorkflowIndex } from './planning-agent-task-schemas.js';

const EXTENSION_NAME = 'eforge-plan';
const INDEX_SEGMENTS = ['planning-tasks', 'index.json'] as const;

// Per-index-path serialization: chain read-modify-write operations so concurrent
// starts/retries in the same daemon process never race the shared index file.
const indexWriteChains = new Map<string, Promise<unknown>>();
// Monotonic counter so each in-process write gets a unique temp filename even when
// two writes for the same index are in flight.
let tempWriteSequence = 0;

function runExclusive<T>(key: string, task: () => Promise<T>): Promise<T> {
  const prior = indexWriteChains.get(key) ?? Promise.resolve();
  const result = prior.then(task, task);
  indexWriteChains.set(key, result.then(() => undefined, () => undefined));
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

/**
 * Read the durable workflow index. Missing or malformed storage yields an empty
 * index so callers never crash on first run or partial writes.
 */
export async function readPlanningTaskWorkflowIndex(cwd: string): Promise<PlanningTaskWorkflowIndex> {
  let raw: string;
  try {
    raw = await readFile(resolvePlanningTaskWorkflowIndexPath(cwd), 'utf-8');
  } catch {
    return emptyIndex();
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
    // Re-read and merge under the lock so concurrent entries are never lost.
    const index = await readPlanningTaskWorkflowIndex(cwd);
    const entries = index.entries.filter((existing) => existing.taskId !== entry.taskId);
    entries.push(entry);
    await writePlanningTaskWorkflowIndex(cwd, { schemaVersion: 1, entries });
    return entry;
  });
}

export function findPlanningTaskWorkflowEntry(index: PlanningTaskWorkflowIndex, taskId: string): PlanningTaskWorkflowEntry | undefined {
  return index.entries.find((entry) => entry.taskId === taskId);
}

export function listPlanningTaskWorkflowEntries(index: PlanningTaskWorkflowIndex): PlanningTaskWorkflowEntry[] {
  return orderIndex(index).entries;
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
