/**
 * Queue-control filesystem helpers: priority mutation and removal of queued
 * PRDs, with lock classification, stale/corrupt lock cleanup, and dependency
 * safety preflight.
 *
 * Engine-owned and reusable. Route handlers validate HTTP shape, call these
 * helpers, and map the typed {@link QueueControlError} kinds to HTTP status.
 */

import { access, readdir, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { basename, resolve } from 'node:path';
import type {
  QueuePriorityResponse,
  QueueRemoveResponse,
} from '@eforge-build/client';
import {
  claimPrd,
  loadQueue,
  readPrdLockStatus,
  releasePrd,
  setQueuedPrdFrontmatterFieldsExistingOnly,
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

interface QueueControlRaceTestHooks {
  afterLocate?: () => void | Promise<void>;
  afterRootClaim?: () => void | Promise<void>;
  beforePriorityWrite?: () => void | Promise<void>;
  beforeMainRemoval?: () => void | Promise<void>;
}

export interface QueueControlLocateOptions {
  cwd: string;
  queueDir: string;
  prdId: string;
  /** Internal deterministic race seam for engine regression tests only. */
  __testHooks?: QueueControlRaceTestHooks;
}

export interface UpdateQueuedPrdPriorityOptions extends QueueControlLocateOptions {
  priority: number;
}

export type RemoveQueuedPrdOptions = QueueControlLocateOptions;

export interface OverrideQueuedPrdDependencyOptions extends QueueControlLocateOptions {
  dependencyId: string;
}

export interface OverrideQueuedPrdDependencyResult {
  id: string;
  title: string;
  previousStatus: 'pending' | 'waiting';
  currentStatus: 'pending' | 'waiting';
  removedDependency: string;
  previousDependsOn: string[];
  currentDependsOn: string[];
  movedToQueueRoot: boolean;
}

interface DependencyOverrideMutation extends OverrideQueuedPrdDependencyResult { clearStackParent: boolean; }

const RUNNING_CANCEL_GUIDANCE =
  'running builds must be cancelled by session id through the cancel route, not through queue-control routes';

function assertSafePrdId(id: string): void {
  const safe = id.length > 0 && !id.includes('/') && !id.includes('\\') && !id.includes('..') && !id.includes('\0');
  if (!safe) {
    throw new QueueControlError('validation', `Unsafe PRD id: ${JSON.stringify(id)}`);
  }
}

function assertSafeDependencyId(id: string): void {
  const safe = id.length > 0 && !id.includes('/') && !id.includes('\\') && !id.includes('..') && !id.includes('\0');
  if (!safe) {
    throw new QueueControlError('validation', `Unsafe dependency id: ${JSON.stringify(id)}`);
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

async function runQueueControlRaceHook(
  opts: QueueControlLocateOptions,
  hookName: keyof QueueControlRaceTestHooks,
): Promise<void> {
  await opts.__testHooks?.[hookName]?.();
}

function isErrno(err: unknown, code: string): boolean {
  return (err as NodeJS.ErrnoException)?.code === code;
}

function locationDirectory(absQueueDir: string, location: QueueControlLocation): string {
  return location === 'queue' ? absQueueDir : resolve(absQueueDir, location);
}

async function reloadExpectedPrd(
  cwd: string,
  absQueueDir: string,
  located: LocatedPrd,
): Promise<QueuedPrd> {
  const prds = await strictLoadQueue(locationDirectory(absQueueDir, located.location), cwd);
  const expected = resolve(located.prd.filePath);
  const fresh = prds.find((prd) => prd.id === located.prd.id && resolve(prd.filePath) === expected);
  if (!fresh) {
    throw new QueueControlError(
      'conflict',
      `Queue item '${located.prd.id}' changed location or disappeared before mutation; expected '${located.prd.filePath}'.`,
    );
  }
  return fresh;
}

async function setPriorityExistingOnly(prd: QueuedPrd, priority: number): Promise<void> {
  try {
    await setQueuedPrdFrontmatterFieldsExistingOnly(prd, { priority });
  } catch (err) {
    if (isErrno(err, 'ENOENT')) {
      throw new QueueControlError(
        'not-found',
        `Queue item '${prd.id}' disappeared before priority update; expected '${prd.filePath}'.`,
      );
    }
    throw err;
  }
}

async function setDependencyOverrideExistingOnly(prd: QueuedPrd, dependsOn: string[], clearStackParent: boolean): Promise<void> {
  try {
    await setQueuedPrdFrontmatterFieldsExistingOnly(prd, { depends_on: dependsOn, ...(clearStackParent && { stack_parent: undefined }) });
  } catch (err) {
    if (isErrno(err, 'ENOENT')) {
      throw new QueueControlError(
        'not-found',
        `Queue item '${prd.id}' disappeared before dependency override; expected '${prd.filePath}'.`,
      );
    }
    throw err;
  }
}

function replaceDependencyOverrideInContent(content: string, dependsOn: string[], clearStackParent: boolean): string {
  const line = `depends_on: [${dependsOn.map((id) => JSON.stringify(id)).join(', ')}]`;
  const withDependsOn = /^depends_on:.*$/m.test(content)
    ? content.replace(/^depends_on:.*$/m, line)
    : content.replace(/^(---\n[\s\S]*?)(\n---)/, `$1\n${line}$2`);
  return clearStackParent ? withDependsOn.replace(/^stack_parent:.*\n?/m, '') : withDependsOn;
}

async function moveWaitingPrdToQueueRoot(prd: QueuedPrd, absQueueDir: string, currentDependsOn: string[], clearStackParent: boolean): Promise<void> {
  const destPath = resolve(absQueueDir, basename(prd.filePath));
  if (await fileExists(destPath)) {
    throw new QueueControlError(
      'conflict',
      `Cannot move waiting queue item '${prd.id}' to queue root: destination already exists at '${destPath}'.`,
    );
  }
  const newContent = replaceDependencyOverrideInContent(prd.content, currentDependsOn, clearStackParent);
  try {
    await writeFile(destPath, newContent, { encoding: 'utf-8', flag: 'wx' });
  } catch (err) {
    if (isErrno(err, 'EEXIST')) {
      throw new QueueControlError(
        'conflict',
        `Cannot move waiting queue item '${prd.id}' to queue root: destination already exists at '${destPath}'.`,
      );
    }
    throw err;
  }
  try {
    await rm(prd.filePath);
  } catch (err) {
    await rm(destPath, { force: true });
    if (isErrno(err, 'ENOENT')) {
      throw new QueueControlError(
        'not-found',
        `Queue item '${prd.id}' disappeared before dependency override; expected '${prd.filePath}'.`,
      );
    }
    throw err;
  }
}

async function removeMainPrdFile(prd: QueuedPrd): Promise<void> {
  try {
    await rm(prd.filePath);
  } catch (err) {
    if (isErrno(err, 'ENOENT')) {
      throw new QueueControlError(
        'not-found',
        `Queue item '${prd.id}' disappeared before removal; expected '${prd.filePath}'.`,
      );
    }
    throw err;
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
  await runQueueControlRaceHook(opts, 'afterLocate');
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

  const absQueueDir = resolve(opts.cwd, opts.queueDir);
  if (located.location === 'queue') {
    const claimed = await claimPrd(opts.prdId, opts.cwd);
    if (!claimed) {
      throw new QueueControlError(
        'conflict',
        `Queue item '${opts.prdId}' was claimed or became running before priority update; ${RUNNING_CANCEL_GUIDANCE}.`,
      );
    }
    try {
      await runQueueControlRaceHook(opts, 'afterRootClaim');
      const fresh = await reloadExpectedPrd(opts.cwd, absQueueDir, located);
      await runQueueControlRaceHook(opts, 'beforePriorityWrite');
      await setPriorityExistingOnly(fresh, opts.priority);
    } finally {
      await releasePrd(opts.prdId, opts.cwd);
    }
  } else {
    const fresh = await reloadExpectedPrd(opts.cwd, absQueueDir, located);
    await runQueueControlRaceHook(opts, 'beforePriorityWrite');
    await setPriorityExistingOnly(fresh, opts.priority);
  }

  return {
    id: opts.prdId,
    previousStatus: located.status,
    currentStatus: located.status,
    priority: opts.priority,
  };
}

/** Remove one dependency id from a pending or waiting queued PRD. */
export async function overrideQueuedPrdDependency(opts: OverrideQueuedPrdDependencyOptions): Promise<OverrideQueuedPrdDependencyResult> {
  assertSafePrdId(opts.prdId);
  assertSafeDependencyId(opts.dependencyId);

  const located = await findQueuedPrdForControl(opts);
  await runQueueControlRaceHook(opts, 'afterLocate');
  if (located.status === 'running') {
    throw new QueueControlError(
      'conflict',
      `Queue item '${opts.prdId}' is currently running; ${RUNNING_CANCEL_GUIDANCE}.`,
    );
  }
  if (located.status !== 'pending' && located.status !== 'waiting') {
    throw new QueueControlError(
      'conflict',
      `Cannot override dependencies of '${located.status}' queue item '${opts.prdId}'; only pending or waiting items support dependency overrides.`,
    );
  }

  const absQueueDir = resolve(opts.cwd, opts.queueDir);
  if (located.location === 'queue') {
    return await overridePendingRootDependency(opts, located, absQueueDir);
  }

  const fresh = await reloadExpectedPrd(opts.cwd, absQueueDir, located);
  const mutation = dependencyOverrideMutation(opts, located, fresh);
  if (mutation.movedToQueueRoot) {
    await moveWaitingPrdToQueueRoot(fresh, absQueueDir, mutation.currentDependsOn, mutation.clearStackParent);
  } else {
    await setDependencyOverrideExistingOnly(fresh, mutation.currentDependsOn, mutation.clearStackParent);
  }
  const { clearStackParent: _clearStackParent, ...result } = mutation;
  return result;
}

function dependencyOverrideMutation(
  opts: OverrideQueuedPrdDependencyOptions,
  located: LocatedPrd,
  fresh: QueuedPrd,
): DependencyOverrideMutation {
  const previousDependsOn = [...(fresh.frontmatter.depends_on ?? [])];
  if (!previousDependsOn.includes(opts.dependencyId)) {
    throw new QueueControlError(
      'conflict',
      `Queue item '${opts.prdId}' does not depend on '${opts.dependencyId}'.`,
    );
  }
  const currentDependsOn = previousDependsOn.filter((id) => id !== opts.dependencyId);
  const clearStackParent = fresh.frontmatter.stack_parent === opts.dependencyId;
  const previousStatus = located.status as 'pending' | 'waiting';
  const movedToQueueRoot = previousStatus === 'waiting' && currentDependsOn.length === 0;
  return {
    id: opts.prdId,
    title: fresh.frontmatter.title,
    previousStatus,
    currentStatus: movedToQueueRoot ? 'pending' : previousStatus,
    removedDependency: opts.dependencyId,
    previousDependsOn,
    currentDependsOn,
    movedToQueueRoot,
    clearStackParent,
  };
}

async function overridePendingRootDependency(
  opts: OverrideQueuedPrdDependencyOptions,
  located: LocatedPrd,
  absQueueDir: string,
): Promise<OverrideQueuedPrdDependencyResult> {
  const claimed = await claimPrd(opts.prdId, opts.cwd);
  if (!claimed) {
    throw new QueueControlError(
      'conflict',
      `Queue item '${opts.prdId}' was claimed or became running before dependency override; ${RUNNING_CANCEL_GUIDANCE}.`,
    );
  }
  try {
    await runQueueControlRaceHook(opts, 'afterRootClaim');
    const fresh = await reloadExpectedPrd(opts.cwd, absQueueDir, located);
    const mutation = dependencyOverrideMutation(opts, located, fresh);
    await setDependencyOverrideExistingOnly(fresh, mutation.currentDependsOn, mutation.clearStackParent);
    const { clearStackParent: _clearStackParent, ...result } = mutation;
    return result;
  } finally {
    await releasePrd(opts.prdId, opts.cwd);
  }
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
  await runQueueControlRaceHook(opts, 'afterLocate');
  if (located.status === 'running') {
    throw new QueueControlError(
      'conflict',
      `Queue item '${opts.prdId}' is currently running; ${RUNNING_CANCEL_GUIDANCE}.`,
    );
  }

  let fresh: QueuedPrd;
  if (located.location === 'queue') {
    const claimed = await claimPrd(opts.prdId, opts.cwd);
    if (!claimed) {
      throw new QueueControlError(
        'conflict',
        `Queue item '${opts.prdId}' was claimed or became running before removal; ${RUNNING_CANCEL_GUIDANCE}.`,
      );
    }
    try {
      await runQueueControlRaceHook(opts, 'afterRootClaim');
      fresh = await reloadExpectedPrd(opts.cwd, absQueueDir, located);
      const dependents = await findLiveDependents(opts.cwd, absQueueDir, opts.prdId);
      if (dependents.length > 0) {
        throw new QueueControlError(
          'conflict',
          `Cannot remove '${opts.prdId}': live queue items depend on it (${dependents.join(', ')}). ` +
            'Remove the dependents first, or wait for future cascade controls.',
        );
      }
      await runQueueControlRaceHook(opts, 'beforeMainRemoval');
      const finalDependents = await findLiveDependents(opts.cwd, absQueueDir, opts.prdId);
      if (finalDependents.length > 0) {
        throw new QueueControlError(
          'conflict',
          `Cannot remove '${opts.prdId}': live queue items depend on it (${finalDependents.join(', ')}). ` +
            'Remove the dependents first, or wait for future cascade controls.',
        );
      }
      await removeMainPrdFile(fresh);
    } finally {
      await releasePrd(opts.prdId, opts.cwd);
    }
  } else {
    fresh = await reloadExpectedPrd(opts.cwd, absQueueDir, located);
    const dependents = await findLiveDependents(opts.cwd, absQueueDir, opts.prdId);
    if (dependents.length > 0) {
      throw new QueueControlError(
        'conflict',
        `Cannot remove '${opts.prdId}': live queue items depend on it (${dependents.join(', ')}). ` +
          'Remove the dependents first, or wait for future cascade controls.',
      );
    }
    await runQueueControlRaceHook(opts, 'beforeMainRemoval');
    const finalDependents = await findLiveDependents(opts.cwd, absQueueDir, opts.prdId);
    if (finalDependents.length > 0) {
      throw new QueueControlError(
        'conflict',
        `Cannot remove '${opts.prdId}': live queue items depend on it (${finalDependents.join(', ')}). ` +
          'Remove the dependents first, or wait for future cascade controls.',
      );
    }
    await removeMainPrdFile(fresh);
  }

  const removedSidecars: string[] = [];
  if (located.location === 'failed') {
    for (const ext of ['recovery.md', 'recovery.json']) {
      const relative = `failed/${opts.prdId}.${ext}`;
      const absolute = resolve(absQueueDir, 'failed', `${opts.prdId}.${ext}`);
      if (await fileExists(absolute)) {
        try {
          await rm(absolute);
          removedSidecars.push(relative);
        } catch (err) {
          if (!isErrno(err, 'ENOENT')) throw err;
        }
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
