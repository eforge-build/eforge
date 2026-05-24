/**
 * Provider-neutral artifact registry.
 *
 * Manages `.eforge/artifacts/builds.json`: path helpers, Zod schema validation,
 * atomic load/save, upsert, lookup by PRD id, and corruption fallback.
 *
 * The registry is the source of truth for dependency readiness. Every
 * successful queued PRD build writes a durable artifact record here before
 * the landing step begins. Stack state in `.eforge/stacks/layers.json`
 * remains a projection for stacked topology/provider visibility.
 *
 * The registry file is eforge-owned runtime state (gitignored). It is written
 * atomically via temp-file-then-rename to prevent partial writes.
 */

import { readFile, writeFile, mkdir, rename, rm } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { z } from 'zod/v4';

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

const artifactRecordSchema = z.object({
  /** PRD id this artifact belongs to. */
  prdId: z.string().min(1),
  /** Feature branch (artifact ref) produced by the build. */
  artifactBranch: z.string().min(1),
  /** HEAD commit SHA at the end of the build. */
  commitSha: z.string().min(1),
  /** Base branch / parent artifact ref that was used as the base for this build. */
  resolvedBase: z.string().min(1),
  /** Canonical landing action recorded at build time. */
  landingAction: z.enum(['pr', 'merge', 'leave']),
  /** Only successful builds are recorded. */
  status: z.literal('built'),
  /** ISO-8601 timestamp when this record was first created. Preserved across retries. */
  recordedAt: z.string().min(1),
  /** ISO-8601 timestamp of the last update to this record. */
  updatedAt: z.string().min(1),
  // --- eforge:region plan-01-runtime-artifact-diagnostics ---
  /** Terminal outcome of the post-build landing step, if landing has been attempted. */
  landingStatus: z.enum(['complete', 'failed', 'skipped']).optional(),
  /** PR URL when landingAction is 'pr' and landing completed. */
  prUrl: z.string().optional(),
  /** ISO-8601 timestamp when the landing step finished. */
  landingCompletedAt: z.string().optional(),
  /** Reason string when landingStatus is 'failed' or 'skipped'. */
  landingFailureReason: z.string().optional(),
  // --- eforge:endregion plan-01-runtime-artifact-diagnostics ---
});

export type ArtifactRecord = z.output<typeof artifactRecordSchema>;

export const artifactRegistrySchema = z.object({
  version: z.literal(1),
  builds: z.array(artifactRecordSchema),
});

export type ArtifactRegistry = z.output<typeof artifactRegistrySchema>;

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

/**
 * Returns the absolute path to the artifact registry file for the given project root.
 *
 * `.eforge/artifacts/builds.json` is runtime state — gitignored, eforge-owned.
 */
export function artifactRegistryPath(cwd: string): string {
  return resolve(cwd, '.eforge', 'artifacts', 'builds.json');
}

const ARTIFACT_REGISTRY_LOCK_TIMEOUT_MS = 10_000;
const ARTIFACT_REGISTRY_LOCK_RETRY_MS = 25;

function artifactRegistryLockPath(cwd: string): string {
  return `${artifactRegistryPath(cwd)}.lock`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

async function withArtifactRegistryLock<T>(cwd: string, fn: () => Promise<T>): Promise<T> {
  const lockPath = artifactRegistryLockPath(cwd);
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
      if (Date.now() - startedAt >= ARTIFACT_REGISTRY_LOCK_TIMEOUT_MS) {
        throw new Error(`Timed out waiting for artifact registry lock: ${lockPath}`);
      }
      await sleep(ARTIFACT_REGISTRY_LOCK_RETRY_MS);
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
 * Load the artifact registry from disk.
 *
 * Returns `{ version: 1, builds: [] }` when the file does not exist or
 * contains invalid/malformed content. Schema validation failures also
 * return an empty registry rather than throwing.
 */
export async function loadArtifactRegistry(cwd: string): Promise<ArtifactRegistry> {
  const filePath = artifactRegistryPath(cwd);
  let content: string;
  try {
    content = await readFile(filePath, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return { version: 1, builds: [] };
    }
    throw err;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return { version: 1, builds: [] };
  }

  const result = artifactRegistrySchema.safeParse(parsed);
  if (!result.success) {
    return { version: 1, builds: [] };
  }
  return result.data;
}

/**
 * Atomically write the artifact registry to disk.
 *
 * Writes to a temp file in the same directory, then renames into place to
 * prevent partial writes from corrupting the registry file.
 */
export async function saveArtifactRegistry(cwd: string, registry: ArtifactRegistry): Promise<void> {
  const filePath = artifactRegistryPath(cwd);
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
 * Upsert an artifact record in the registry.
 *
 * If a record with the same `prdId` already exists, it is replaced in-place
 * with the updated fields. The `recordedAt` timestamp from the original entry
 * is preserved (so retries do not reset the creation time). `updatedAt` is
 * always set to the current time. Returns the updated registry after writing.
 */
export async function upsertArtifact(cwd: string, record: ArtifactRecord): Promise<ArtifactRegistry> {
  return withArtifactRegistryLock(cwd, async () => {
    const registry = await loadArtifactRegistry(cwd);
    const idx = registry.builds.findIndex((b) => b.prdId === record.prdId);
    const now = new Date().toISOString();
    const existing = idx !== -1 ? registry.builds[idx] : undefined;

    const updated: ArtifactRecord = {
      ...record,
      // Preserve the original recordedAt so retries don't reset creation time
      recordedAt: existing?.recordedAt ?? record.recordedAt,
      updatedAt: now,
    };

    const builds = idx !== -1
      ? registry.builds.map((b, i) => (i === idx ? updated : b))
      : [...registry.builds, updated];

    const updatedRegistry: ArtifactRegistry = { version: 1, builds };
    await saveArtifactRegistry(cwd, updatedRegistry);
    return updatedRegistry;
  });
}

// ---------------------------------------------------------------------------
// Lookup helpers
// ---------------------------------------------------------------------------

/**
 * Look up an artifact record by PRD id.
 * Returns `undefined` when no record is found.
 */
export function lookupArtifactByPrdId(registry: ArtifactRegistry, prdId: string): ArtifactRecord | undefined {
  return registry.builds.find((b) => b.prdId === prdId);
}

/**
 * Returns true when a usable artifact exists for `prdId`.
 *
 * An artifact is usable only when a record with `status: 'built'` is present.
 */
export function hasUsableArtifact(registry: ArtifactRegistry, prdId: string): boolean {
  const record = lookupArtifactByPrdId(registry, prdId);
  return record?.status === 'built';
}

// --- eforge:region plan-01-runtime-artifact-diagnostics ---

/**
 * Partial fields that can be updated on an existing artifact record.
 * `prdId`, `status`, and `recordedAt` are immutable — they are excluded.
 */
export type ArtifactRecordUpdates = Partial<
  Omit<ArtifactRecord, 'prdId' | 'status' | 'recordedAt' | 'updatedAt'>
>;

/**
 * Perform a locked partial update on an existing artifact record.
 *
 * Merges `updates` into the existing record for `prdId`, preserving `recordedAt`
 * and `status`, and setting `updatedAt` to the current time. If no record exists
 * for `prdId`, this is a no-op (the pre-landing build artifact may not have been
 * written yet — callers must handle this gracefully).
 *
 * Returns the updated registry, or the unchanged registry when no record was found.
 */
export async function updateArtifactRecord(
  cwd: string,
  prdId: string,
  updates: ArtifactRecordUpdates,
): Promise<ArtifactRegistry> {
  return withArtifactRegistryLock(cwd, async () => {
    const registry = await loadArtifactRegistry(cwd);
    const idx = registry.builds.findIndex((b) => b.prdId === prdId);
    if (idx === -1) {
      // No record to update — caller must handle this gracefully.
      return registry;
    }

    const existing = registry.builds[idx];
    const now = new Date().toISOString();
    const updated: ArtifactRecord = {
      ...existing,
      ...updates,
      // Immutable fields preserved
      prdId: existing.prdId,
      status: existing.status,
      recordedAt: existing.recordedAt,
      updatedAt: now,
    };

    const builds = registry.builds.map((b, i) => (i === idx ? updated : b));
    const updatedRegistry: ArtifactRegistry = { version: 1, builds };
    await saveArtifactRegistry(cwd, updatedRegistry);
    return updatedRegistry;
  });
}

// --- eforge:endregion plan-01-runtime-artifact-diagnostics ---
