/**
 * Completion registry for terminal queue outcomes.
 *
 * Manages `.eforge/artifacts/completions.json`: path helpers, Zod schema
 * validation, atomic load/save, upsert, and lookup helpers. Records known
 * terminal queue outcomes (`completed`, `failed`, `skipped`) keyed by PRD id
 * so dependency validation can identify completed PRDs that were removed from
 * `.eforge/queue/` and have no usable artifact.
 *
 * The completion registry is a diagnostic supplement to the artifact registry.
 * It never makes a dependency ready by itself — only the artifact registry
 * (`builds.json`) confers readiness. Completion entries block stale artifacts
 * and distinguish "completed without artifact" from "never ran".
 *
 * Uses the same temp-file-then-rename and directory-mkdir-as-lock conventions
 * as the artifact registry.
 */

import { readFile, writeFile, mkdir, rename, rm } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { z } from 'zod/v4';

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const completionRecordSchema = z.object({
  /** PRD id this completion record belongs to. */
  prdId: z.string().min(1),
  /** Terminal status of this PRD. */
  status: z.enum(['completed', 'failed', 'skipped']),
  /**
   * Whether a usable built artifact was available at the time of completion.
   * For failed/skipped statuses this is always false.
   * For completed status this reflects whether a `status: 'built'` artifact
   * record existed in the registry at completion time.
   */
  artifactAvailable: z.boolean(),
  /** Feature branch (artifact ref) for this PRD, if known. */
  artifactBranch: z.string().optional(),
  /** ISO-8601 timestamp when the terminal outcome was recorded. */
  completedAt: z.string().min(1),
  /** ISO-8601 timestamp of the last update to this record. */
  updatedAt: z.string().min(1),
});

export type CompletionRecord = z.output<typeof completionRecordSchema>;

const completionRegistrySchema = z.object({
  version: z.literal(1),
  completions: z.record(z.string(), completionRecordSchema),
});

export type CompletionRegistry = z.output<typeof completionRegistrySchema>;

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

/**
 * Returns the absolute path to the completion registry file for the given project root.
 *
 * `.eforge/artifacts/completions.json` is runtime state — gitignored, eforge-owned.
 */
export function completionRegistryPath(cwd: string): string {
  return resolve(cwd, '.eforge', 'artifacts', 'completions.json');
}

const COMPLETION_REGISTRY_LOCK_TIMEOUT_MS = 10_000;
const COMPLETION_REGISTRY_LOCK_RETRY_MS = 25;

function completionRegistryLockPath(cwd: string): string {
  return `${completionRegistryPath(cwd)}.lock`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

async function withCompletionRegistryLock<T>(cwd: string, fn: () => Promise<T>): Promise<T> {
  const lockPath = completionRegistryLockPath(cwd);
  await mkdir(dirname(lockPath), { recursive: true });

  const startedAt = Date.now();
  while (true) {
    try {
      await mkdir(lockPath);
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw err;
      }
      if (Date.now() - startedAt >= COMPLETION_REGISTRY_LOCK_TIMEOUT_MS) {
        throw new Error(`Timed out waiting for completion registry lock: ${lockPath}`);
      }
      await sleep(COMPLETION_REGISTRY_LOCK_RETRY_MS);
    }
  }

  try {
    return await fn();
  } finally {
    await rm(lockPath, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Load / Save
// ---------------------------------------------------------------------------

/**
 * Load the completion registry from disk.
 *
 * Returns `{ version: 1, completions: {} }` when the file does not exist or
 * contains invalid/malformed content. Schema validation failures also
 * return an empty registry rather than throwing.
 */
export async function loadCompletionRegistry(cwd: string): Promise<CompletionRegistry> {
  const filePath = completionRegistryPath(cwd);
  let content: string;
  try {
    content = await readFile(filePath, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { version: 1, completions: {} };
    }
    throw err;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return { version: 1, completions: {} };
  }

  const result = completionRegistrySchema.safeParse(parsed);
  if (!result.success) {
    return { version: 1, completions: {} };
  }
  return result.data;
}

/**
 * Atomically write the completion registry to disk.
 *
 * Writes to a temp file in the same directory, then renames into place to
 * prevent partial writes from corrupting the registry file.
 */
export async function saveCompletionRegistry(cwd: string, registry: CompletionRegistry): Promise<void> {
  const filePath = completionRegistryPath(cwd);
  const dir = dirname(filePath);
  await mkdir(dir, { recursive: true });

  const tmpPath = `${filePath}.${randomBytes(6).toString('hex')}.tmp`;
  await writeFile(tmpPath, JSON.stringify(registry, null, 2), 'utf-8');
  await rename(tmpPath, filePath);
}

// ---------------------------------------------------------------------------
// Upsert
// ---------------------------------------------------------------------------

/**
 * Upsert a completion record in the registry.
 *
 * If a record with the same `prdId` already exists, it is replaced.
 * `updatedAt` is always set to the current time. Returns the updated
 * registry after writing.
 */
export async function upsertCompletion(cwd: string, record: CompletionRecord): Promise<CompletionRegistry> {
  return withCompletionRegistryLock(cwd, async () => {
    const registry = await loadCompletionRegistry(cwd);
    const now = new Date().toISOString();

    const updated: CompletionRecord = {
      ...record,
      updatedAt: now,
    };

    const updatedRegistry: CompletionRegistry = {
      version: 1,
      completions: {
        ...registry.completions,
        [record.prdId]: updated,
      },
    };

    await saveCompletionRegistry(cwd, updatedRegistry);
    return updatedRegistry;
  });
}

// ---------------------------------------------------------------------------
// Lookup helpers
// ---------------------------------------------------------------------------

/**
 * Look up a completion record by PRD id.
 * Returns `undefined` when no record is found.
 */
export function lookupCompletion(registry: CompletionRegistry, prdId: string): CompletionRecord | undefined {
  return registry.completions[prdId];
}
