import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createEforgeProjectPaths } from '@eforge-build/extension-sdk';
import { formatSchemaError, safeParseWithSchema } from '@eforge-build/client';
import {
  DraftPlanUnitIndexSchema,
  type DraftPlanUnit,
  type DraftPlanUnitIndex,
  type DraftPlanUnitItem,
  type DraftPlanUnitProvenance,
} from './draft-plan-unit-schemas.js';
import { userActionError } from './action-errors.js';

const EXTENSION_NAME = 'eforge-plan';
const INDEX_SEGMENTS = ['draft-units', 'index.json'] as const;
const indexWriteChains = new Map<string, Promise<unknown>>();
let tempWriteSequence = 0;

// Serialize writes to a given index path so concurrent mutations interleave
// safely (read-modify-write under one chain per file).
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

export function resolveDraftPlanUnitIndexPath(cwd: string): string {
  return createEforgeProjectPaths({ cwd, extensionName: EXTENSION_NAME }).extensionStoragePath('project-local', [...INDEX_SEGMENTS]);
}

function emptyIndex(): DraftPlanUnitIndex {
  return { schemaVersion: 1, units: [] };
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

export async function readDraftPlanUnitIndex(cwd: string): Promise<DraftPlanUnitIndex> {
  let raw: string;
  try {
    raw = await readFile(resolveDraftPlanUnitIndexPath(cwd), 'utf-8');
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return emptyIndex();
    throw error;
  }
  // The file exists (ENOENT was handled above), so a parse/validation failure is
  // corruption, not absence. Returning emptyIndex() here would make the next
  // read-modify-write clobber the unreadable-but-present units - throw instead so
  // a mutation never silently discards stored data.
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw userActionError(`Draft plan unit index is not valid JSON at ${resolveDraftPlanUnitIndexPath(cwd)}.`, { details: { cause: error instanceof Error ? error.message : String(error) } });
  }
  const result = safeParseWithSchema(DraftPlanUnitIndexSchema, parsed);
  if (!result.success) {
    throw userActionError(`Draft plan unit index failed schema validation at ${resolveDraftPlanUnitIndexPath(cwd)}.`, { details: { validation: formatSchemaError(result.error) } });
  }
  return orderIndex(result.data);
}

export function listDraftPlanUnits(index: DraftPlanUnitIndex): DraftPlanUnit[] {
  return orderIndex(index).units;
}

export function findDraftPlanUnit(index: DraftPlanUnitIndex, unitId: string): DraftPlanUnit | undefined {
  return index.units.find((unit) => unit.unitId === unitId);
}

export interface CreateDraftPlanUnitInput {
  title: string;
  intent?: string;
  provenance: DraftPlanUnitProvenance;
  sourceRecommendationRef?: string;
  profile?: DraftPlanUnit['profile'];
  items: DraftPlanUnitItem[];
}

export async function createDraftPlanUnit(cwd: string, input: CreateDraftPlanUnitInput, now = new Date().toISOString()): Promise<DraftPlanUnit> {
  const path = resolveDraftPlanUnitIndexPath(cwd);
  return runExclusive(path, async () => {
    const index = await readDraftPlanUnitIndex(cwd);
    const unit: DraftPlanUnit = {
      unitId: randomUUID(),
      title: input.title,
      ...(input.intent !== undefined && { intent: input.intent }),
      provenance: input.provenance,
      ...(input.sourceRecommendationRef !== undefined && { sourceRecommendationRef: input.sourceRecommendationRef }),
      ...(input.profile !== undefined && { profile: input.profile }),
      items: dedupeItems(input.items),
      status: 'draft',
      createdAt: now,
      updatedAt: now,
    };
    await writeDraftPlanUnitIndex(cwd, { schemaVersion: 1, units: [...index.units, unit] });
    return unit;
  });
}

export interface UpdateDraftPlanUnitPatch {
  title?: string;
  intent?: string;
  // '' clears the profile.
  profile?: DraftPlanUnit['profile'] | '';
  addItems?: DraftPlanUnitItem[];
  removeItemIds?: string[];
  itemOrder?: string[];
}

export async function updateDraftPlanUnit(cwd: string, unitId: string, patch: UpdateDraftPlanUnitPatch, now = new Date().toISOString()): Promise<DraftPlanUnit> {
  return mutateUnit(cwd, unitId, now, (unit) => {
    let items = unit.items;
    if (patch.removeItemIds !== undefined && patch.removeItemIds.length > 0) {
      const remove = new Set(patch.removeItemIds);
      items = items.filter((item) => !remove.has(item.itemId));
    }
    if (patch.addItems !== undefined && patch.addItems.length > 0) {
      const present = new Set(items.map((item) => item.itemId));
      items = [...items, ...patch.addItems.filter((item) => !present.has(item.itemId))];
    }
    if (patch.itemOrder !== undefined) items = reorderItems(items, patch.itemOrder);
    const next: DraftPlanUnit = {
      ...unit,
      ...(patch.title !== undefined && { title: patch.title }),
      items: dedupeItems(items),
      updatedAt: now,
    };
    if (patch.intent !== undefined) next.intent = patch.intent;
    if (patch.profile !== undefined) {
      if (patch.profile === '') delete next.profile;
      else next.profile = patch.profile;
    }
    return next;
  });
}

export async function markDraftPlanUnitPromoted(cwd: string, unitId: string, session: string, now = new Date().toISOString()): Promise<DraftPlanUnit> {
  return mutateUnit(cwd, unitId, now, (unit) => ({ ...unit, status: 'promoted', promotedSession: session, promotedAt: now, updatedAt: now }));
}

export async function deleteDraftPlanUnit(cwd: string, unitId: string): Promise<boolean> {
  const path = resolveDraftPlanUnitIndexPath(cwd);
  return runExclusive(path, async () => {
    const index = await readDraftPlanUnitIndex(cwd);
    if (!index.units.some((unit) => unit.unitId === unitId)) return false;
    await writeDraftPlanUnitIndex(cwd, { schemaVersion: 1, units: index.units.filter((unit) => unit.unitId !== unitId) });
    return true;
  });
}

async function mutateUnit(cwd: string, unitId: string, now: string, mutate: (unit: DraftPlanUnit) => DraftPlanUnit): Promise<DraftPlanUnit> {
  const path = resolveDraftPlanUnitIndexPath(cwd);
  return runExclusive(path, async () => {
    const index = await readDraftPlanUnitIndex(cwd);
    const existing = findDraftPlanUnit(index, unitId);
    if (existing === undefined) throw userActionError(`No draft plan unit found for ${unitId}.`, { path: 'unitId', details: { unitId } });
    const updated = mutate(existing);
    await writeDraftPlanUnitIndex(cwd, { schemaVersion: 1, units: index.units.map((unit) => unit.unitId === unitId ? updated : unit) });
    return updated;
  });
}

async function writeDraftPlanUnitIndex(cwd: string, index: DraftPlanUnitIndex): Promise<void> {
  const path = resolveDraftPlanUnitIndexPath(cwd);
  await mkdir(dirname(path), { recursive: true });
  const tempPath = `${path}.${process.pid}.${tempWriteSequence++}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(orderIndex(index), null, 2)}\n`, 'utf-8');
  await rename(tempPath, path);
}

function orderIndex(index: DraftPlanUnitIndex): DraftPlanUnitIndex {
  return { schemaVersion: 1, units: [...index.units].sort(compareUnits) };
}

function compareUnits(a: DraftPlanUnit, b: DraftPlanUnit): number {
  if (a.updatedAt !== b.updatedAt) return a.updatedAt < b.updatedAt ? 1 : -1;
  return a.unitId.localeCompare(b.unitId);
}

// Later occurrences of the same id are dropped, preserving the first origin.
function dedupeItems(items: DraftPlanUnitItem[]): DraftPlanUnitItem[] {
  const seen = new Set<string>();
  const result: DraftPlanUnitItem[] = [];
  for (const item of items) {
    if (seen.has(item.itemId)) continue;
    seen.add(item.itemId);
    result.push(item);
  }
  return result;
}

function reorderItems(items: DraftPlanUnitItem[], order: string[]): DraftPlanUnitItem[] {
  const byId = new Map(items.map((item) => [item.itemId, item]));
  const ordered: DraftPlanUnitItem[] = [];
  for (const id of order) {
    const item = byId.get(id);
    if (item !== undefined) { ordered.push(item); byId.delete(id); }
  }
  for (const item of items) if (byId.has(item.itemId)) ordered.push(item);
  return ordered;
}
