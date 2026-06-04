/**
 * Queue-control filesystem helpers: priority mutation and removal of queued
 * PRDs, with lock classification, stale/corrupt lock cleanup, and dependency
 * safety preflight.
 *
 * Engine-owned and reusable. Route handlers validate HTTP shape, call these
 * helpers, and map the typed {@link QueueControlError} kinds to HTTP status.
 */

import { access, readdir, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve } from 'node:path';
import type {
  QueuePriorityResponse,
  QueueRemoveResponse,
} from '@eforge-build/client';
import {
  loadQueue,
  readPrdLockStatus,
  releasePrd,
  setQueuedPrdFrontmatterFields,
  type QueuedPrd,
} from '../prd-queue.js';

/** Kinds of queue-control failure, used by routes to map HTTP status. */
export type QueueControlErrorKind = 'not-found' | 'validation' | 'conflict';

/** Typed helper error carrying enough data for routes to map status codes. */
export class QueueControlError extends Error {
  readonly kind: QueueControlErrorKind;
  constructor(kind: QueueControlErrorKind, message: string) {
    super(message);
    this.name = 'QueueControlError';
    this.kind = kind;
  }
}

export function isQueueControlError(err: unknown): err is QueueControlError {
  return err instanceof QueueControlError;
}

/** Location of a queued PRD relative to the queue root. */
export type QueueControlLocation = 'queue' | 'waiting' | 'failed' | 'skipped';

/** Status of a located PRD as classified for queue control. */
export type LocatedPrdStatus = 'pending' | 'running' | 'waiting' | 'failed' | 'skipped';

export interface LocatedPrd {
  prd: QueuedPrd;
  location: QueueControlLocation;
  status: LocatedPrdStatus;
}

export interface QueueControlLocateOptions {
  cwd: string;
  queueDir: string;
  prdId: string;
}

export interface UpdateQueuedPrdPriorityOptions extends QueueControlLocateOptions {
  priority: number;
}

export type RemoveQueuedPrdOptions = QueueControlLocateOptions;

const RUNNING_CANCEL_GUIDANCE =
  'running builds must be cancelled by session id through the cancel route, not through queue-control routes';

function assertSafePrdId(id: string): void {
  const safe = id.length > 0 && !id.includes('/') && !id.includes('\\') && !id.includes('..') && !id.includes('\0');
  if (!safe) {
    throw new QueueControlError('validation', `Unsafe PRD id: ${JSON.stringify(id)}`);
  }
}

/**
 * Strict queue loader for queue-control preflight: a missing directory is a
 * legitimate empty queue, but an existing-but-unreadable directory or a
 * read/parse failure must fail closed.
 *
 * `loadQueue()` collapses every `readdir` failure to `[]`, so it cannot itself
 * distinguish "directory absent" from "directory present but unreadable". This
 * wrapper probes readability first (treating only `ENOENT` as empty) and then
 * delegates, surfacing any remaining failure as a `QueueControlError('conflict')`.
 */
async function strictLoadQueue(absDir: string, cwd: string): Promise<QueuedPrd[]> {
  try {
    await readdir(absDir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') {
      return []; // Missing directory — legitimate empty queue.
    }
    throw new QueueControlError(
      'conflict',
      `Queue directory '${absDir}' could not be read: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  try {
    return await loadQueue(absDir, cwd);
  } catch (err) {
    throw new QueueControlError(
      'conflict',
      `Queue directory '${absDir}' could not be parsed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

/**
 * Classify a root-queue PRD via its lock file.
 *
 * - live lock => `running`.
 * - absent lock => `pending`.
 * - stale/corrupt lock => best-effort `releasePrd`; on success classify as
 *   `pending`, on failure throw a conflict to avoid racing ambiguous ownership.
 */
async function classifyRootStatus(prdId: string, cwd: string): Promise<'pending' | 'running'> {
  const lock = await readPrdLockStatus(prdId, cwd);
  if (lock.state === 'live') return 'running';
  if (lock.state === 'absent') return 'pending';
  // Stale or corrupt: clear the lock best-effort before treating as pending.
  try {
    await releasePrd(prdId, cwd);
  } catch {
    throw new QueueControlError(
      'conflict',
      `Queue item '${prdId}' has an ambiguous lock that could not be cleared; retry shortly.`,
    );
  }
  return 'pending';
}

/**
 * Final lock re-check for a root-queue item, run immediately before mutating its
 * PRD file. Closes the race where a scheduler/worker claims the PRD between the
 * initial classification and the priority update or `rm`: re-running the same
 * classification refuses a now-live lock (cancel-by-session guidance) and clears
 * a stale/corrupt lock, or throws a conflict if the lock cannot be safely cleared.
 */
async function assertRootStillMutable(prdId: string, cwd: string): Promise<void> {
  const status = await classifyRootStatus(prdId, cwd);
  if (status === 'running') {
    throw new QueueControlError(
      'conflict',
      `Queue item '${prdId}' became running; ${RUNNING_CANCEL_GUIDANCE}.`,
    );
  }
}

/**
 * Locate a queued PRD across the queue root, `waiting/`, `failed/`, and
 * `skipped/`, classifying its control status. Throws a not-found error when the
 * id is absent from all four locations.
 */
export async function findQueuedPrdForControl(opts: QueueControlLocateOptions): Promise<LocatedPrd> {
  assertSafePrdId(opts.prdId);
  const absQueueDir = resolve(opts.cwd, opts.queueDir);

  const rootPrds = await strictLoadQueue(absQueueDir, opts.cwd);
  const root = rootPrds.find((p) => p.id === opts.prdId);
  if (root) {
    const status = await classifyRootStatus(opts.prdId, opts.cwd);
    return { prd: root, location: 'queue', status };
  }

  const subLocations: Array<'waiting' | 'failed' | 'skipped'> = ['waiting', 'failed', 'skipped'];
  for (const location of subLocations) {
    const prds = await strictLoadQueue(resolve(absQueueDir, location), opts.cwd);
    const found = prds.find((p) => p.id === opts.prdId);
    if (found) {
      return { prd: found, location, status: location };
    }
  }

  throw new QueueControlError('not-found', `Queue item not found: ${opts.prdId}`);
}

/**
 * Set the `priority` frontmatter field on a pending or waiting queued PRD.
 *
 * Rejects running (cancel-by-session guidance), failed, and skipped items with
 * a conflict. Body and unrelated frontmatter are preserved.
 */
export async function updateQueuedPrdPriority(opts: UpdateQueuedPrdPriorityOptions): Promise<QueuePriorityResponse> {
  assertSafePrdId(opts.prdId);
  if (!Number.isFinite(opts.priority) || !Number.isInteger(opts.priority)) {
    throw new QueueControlError('validation', 'priority must be a finite integer');
  }

  const located = await findQueuedPrdForControl(opts);
  if (located.status === 'running') {
    throw new QueueControlError(
      'conflict',
      `Queue item '${opts.prdId}' is currently running; ${RUNNING_CANCEL_GUIDANCE}.`,
    );
  }
  if (located.status !== 'pending' && located.status !== 'waiting') {
    throw new QueueControlError(
      'conflict',
      `Cannot change priority of '${located.status}' queue item '${opts.prdId}'; only pending or waiting items support priority changes.`,
    );
  }

  // Re-check the root lock immediately before mutating to close the race where a
  // scheduler/worker claims the PRD between classification and this write.
  if (located.location === 'queue') {
    await assertRootStillMutable(opts.prdId, opts.cwd);
  }

  await setQueuedPrdFrontmatterFields(located.prd, { priority: opts.priority });

  return {
    id: opts.prdId,
    previousStatus: located.status,
    currentStatus: located.status,
    priority: opts.priority,
  };
}

/**
 * Remove a pending, waiting, failed, or skipped queued PRD.
 *
 * Refuses live running items (cancel-by-session guidance). Fails closed when a
 * live root or waiting dependent lists the target in `depends_on`. For stale or
 * corrupt root locks, the lock is removed before the PRD file is deleted. When
 * removing a failed PRD, matching recovery sidecars are deleted and their
 * queue-relative paths returned.
 */
export async function removeQueuedPrd(opts: RemoveQueuedPrdOptions): Promise<QueueRemoveResponse> {
  assertSafePrdId(opts.prdId);
  const absQueueDir = resolve(opts.cwd, opts.queueDir);

  const located = await findQueuedPrdForControl(opts);
  if (located.status === 'running') {
    throw new QueueControlError(
      'conflict',
      `Queue item '${opts.prdId}' is currently running; ${RUNNING_CANCEL_GUIDANCE}.`,
    );
  }

  const dependents = await findLiveDependents(opts.cwd, absQueueDir, opts.prdId);
  if (dependents.length > 0) {
    throw new QueueControlError(
      'conflict',
      `Cannot remove '${opts.prdId}': live queue items depend on it (${dependents.join(', ')}). ` +
        'Remove the dependents first, or wait for future cascade controls.',
    );
  }

  // Re-check the root lock immediately before deletion to close the race where a
  // scheduler/worker claims the PRD between classification and this `rm`.
  if (located.location === 'queue') {
    await assertRootStillMutable(opts.prdId, opts.cwd);
  }

  await rm(located.prd.filePath, { force: true });

  const removedSidecars: string[] = [];
  if (located.location === 'failed') {
    for (const ext of ['recovery.md', 'recovery.json']) {
      const relative = `failed/${opts.prdId}.${ext}`;
      const absolute = resolve(absQueueDir, 'failed', `${opts.prdId}.${ext}`);
      if (await fileExists(absolute)) {
        await rm(absolute, { force: true });
        removedSidecars.push(relative);
      }
    }
  }

  return {
    id: opts.prdId,
    previousStatus: located.status,
    currentStatus: 'removed',
    removedSidecars,
  };
}

/**
 * Return the ids of live root or waiting queue items that list `prdId` in their
 * `depends_on`. The target itself is excluded.
 */
async function findLiveDependents(cwd: string, absQueueDir: string, prdId: string): Promise<string[]> {
  // Fail closed: `strictLoadQueue` treats only a missing directory as empty;
  // an existing-but-unreadable directory or a parse failure throws a conflict.
  // Refuse removal rather than proceeding as if no dependents exist.
  let root: QueuedPrd[];
  let waiting: QueuedPrd[];
  try {
    [root, waiting] = await Promise.all([
      strictLoadQueue(absQueueDir, cwd),
      strictLoadQueue(resolve(absQueueDir, 'waiting'), cwd),
    ]);
  } catch (err) {
    if (isQueueControlError(err)) {
      throw new QueueControlError(
        'conflict',
        `Cannot remove '${prdId}': the queue could not be read to verify dependents (${err.message}); ` +
          'removal refused until dependents can be reliably inspected.',
      );
    }
    throw err;
  }
  const dependents = [...root, ...waiting]
    .filter((p) => p.id !== prdId)
    .filter((p) => (p.frontmatter.depends_on ?? []).includes(prdId))
    .map((p) => p.id);
  return [...new Set(dependents)];
}
