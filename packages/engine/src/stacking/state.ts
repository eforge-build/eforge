/**
 * Stack runtime state file management.
 *
 * Manages `.eforge/stacks/layers.json`: path helpers, schema validation,
 * atomic load/save, upsert, lookup by PRD id, and artifact-availability checks.
 *
 * The state file is eforge-owned runtime state (gitignored). It is written
 * atomically via temp-file-then-rename to prevent partial writes.
 */

import { readFile, writeFile, mkdir, rename, open, rm } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod/v4';
import type { StackLayer, StackState } from './types.js';

// ---------------------------------------------------------------------------
// Zod schemas for runtime validation
// ---------------------------------------------------------------------------

const stackArtifactRefSchema = z.object({
  branch: z.string(),
  commitSha: z.string().optional(),
  prUrl: z.string().optional(),
});

/** Zod schema for a single stack layer record. */
export const stackLayerSchema = z.object({
  prdId: z.string().min(1),
  stackId: z.string().min(1),
  parentPrdId: z.string().optional(),
  provider: z.literal('git-spice'),
  branch: z.string().min(1),
  baseBranch: z.string().optional(),
  artifact: stackArtifactRefSchema.optional(),
  landingAction: z.enum(['pr', 'merge', 'leave']).optional(),
  status: z.enum(['pending', 'building', 'built', 'merged', 'landed', 'failed']),
  recordedAt: z.string().min(1),
  updatedAt: z.string().min(1),
});

/** Zod schema for the stack state file root. */
export const stackStateSchema = z.object({
  version: z.literal(1),
  layers: z.array(stackLayerSchema),
});

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

/**
 * Returns the absolute path to the stack state file for the given project root.
 *
 * `.eforge/stacks/layers.json` is runtime state — gitignored, eforge-owned.
 */
export function stackStatePath(cwd: string): string {
  return resolve(cwd, '.eforge', 'stacks', 'layers.json');
}

// ---------------------------------------------------------------------------
// Load / Save
// ---------------------------------------------------------------------------

/**
 * Load the stack state from disk.
 *
 * Returns `{ version: 1, layers: [] }` when the file does not exist or
 * contains an unknown/invalid schema version. Schema validation failures
 * also return an empty state rather than throwing.
 */
export async function loadStackState(cwd: string): Promise<StackState> {
  const filePath = stackStatePath(cwd);
  let content: string;
  try {
    content = await readFile(filePath, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { version: 1, layers: [] };
    }
    throw err;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return { version: 1, layers: [] };
  }

  const result = stackStateSchema.safeParse(parsed);
  if (!result.success) {
    return { version: 1, layers: [] };
  }
  return result.data;
}

/**
 * Atomically write the stack state to disk.
 *
 * Writes to a temp file in the same directory, then renames into place to
 * prevent partial writes from corrupting the state file.
 */
export async function saveStackState(cwd: string, state: StackState): Promise<void> {
  const filePath = stackStatePath(cwd);
  const dir = dirname(filePath);
  await mkdir(dir, { recursive: true });

  const tmpPath = `${filePath}.${randomBytes(6).toString('hex')}.tmp`;
  await writeFile(tmpPath, JSON.stringify(state, null, 2), 'utf-8');
  await rename(tmpPath, filePath);
}

// ---------------------------------------------------------------------------
// Upsert
// ---------------------------------------------------------------------------

/**
 * Upsert a stack layer in the state file.
 *
 * If a layer with the same `prdId` already exists, it is replaced in-place.
 * Otherwise, the new layer is appended. Returns the updated state after writing.
 */
async function withStackStateLock<T>(cwd: string, fn: () => Promise<T>): Promise<T> {
  const lockPath = resolve(cwd, '.eforge', 'stacks', 'layers.lock');
  await mkdir(dirname(lockPath), { recursive: true });

  for (;;) {
    try {
      const fd = await open(lockPath, 'wx');
      try {
        await fd.writeFile(String(process.pid), 'utf-8');
      } finally {
        await fd.close();
      }
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
      await delay(10);
    }
  }

  try {
    return await fn();
  } finally {
    await rm(lockPath, { force: true });
  }
}

export async function upsertStackLayer(cwd: string, layer: StackLayer): Promise<StackState> {
  return withStackStateLock(cwd, async () => {
    const state = await loadStackState(cwd);
    const idx = state.layers.findIndex((l) => l.prdId === layer.prdId);
    const updatedLayers =
      idx !== -1
        ? state.layers.map((l, i) => (i === idx ? layer : l))
        : [...state.layers, layer];

    const updated: StackState = { version: 1, layers: updatedLayers };
    await saveStackState(cwd, updated);
    return updated;
  });
}

// ---------------------------------------------------------------------------
// Lookup helpers
// ---------------------------------------------------------------------------

/**
 * Look up a stack layer by PRD id.
 * Returns `undefined` when no layer is found.
 */
export function lookupLayerByPrdId(state: StackState, prdId: string): StackLayer | undefined {
  return state.layers.find((l) => l.prdId === prdId);
}

/**
 * Return the artifact branch for the parent of `childPrdId`, if available.
 *
 * Resolves the chain: find child → find parent → return parent's artifact branch
 * (falling back to parent's feature branch when no artifact is recorded yet).
 *
 * Returns `undefined` when:
 * - The child has no parent
 * - The parent is not recorded in the state
 */
export function getParentArtifactBranch(state: StackState, childPrdId: string): string | undefined {
  const child = lookupLayerByPrdId(state, childPrdId);
  if (!child?.parentPrdId) return undefined;
  const parent = lookupLayerByPrdId(state, child.parentPrdId);
  if (!parent) return undefined;
  return parent.artifact?.branch ?? parent.branch;
}

// ---------------------------------------------------------------------------
// Artifact availability
// ---------------------------------------------------------------------------

/**
 * Returns true when the artifact for `prdId` is available for downstream layers.
 *
 * An artifact is available when the layer has been built (i.e. the branch
 * exists and commits are present), which corresponds to status `built`,
 * `merged`, or `landed`, OR when an explicit `artifact` ref is present.
 */
export function isArtifactAvailable(state: StackState, prdId: string): boolean {
  const layer = lookupLayerByPrdId(state, prdId);
  if (!layer) return false;
  if (layer.artifact !== undefined) return true;
  return layer.status === 'built' || layer.status === 'merged' || layer.status === 'landed';
}
