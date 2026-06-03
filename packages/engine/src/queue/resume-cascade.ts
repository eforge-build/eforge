/** Queue transitions for compiled-build resume reactivation/finalization. */

import { access, link, mkdir, rm, unlink, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { loadArtifactRegistry, lookupArtifactByPrdId } from '../artifacts/registry.js';
import { upsertCompletion } from '../artifacts/completions.js';
import { claimPrd, getCompiledResumeFrontmatter, loadQueue, releasePrd, setQueuedPrdFrontmatterFields, unblockWaiting, type QueuedPrd } from '../prd-queue.js';

export interface QueuedResumeOptions {
  cwd: string;
  prdId: string;
  queueDir?: string;
}

export type ResumeQueueTransitionResult =
  | { status: 'noop'; prdId: string; reason: string }
  | { status: 'started'; prdId: string; movedDescendantIds: string[] }
  | { status: 'completed'; prdId: string; unblockedIds: string[] }
  | { status: 'rolled-back'; prdId: string; skippedIds: string[] }
  | { status: 'blocked'; prdId: string; reason: string };

export interface RequeueCompiledResumeOptions extends QueuedResumeOptions {
  setName: string;
  featureBranch: string;
  baseBranch: string;
  profileOverride?: string;
}

export type RequeueCompiledResumeResult =
  | { status: 'queued'; prdId: string; setName: string; featureBranch: string; baseBranch: string; movedDescendantIds: string[] }
  | { status: 'already-queued'; prdId: string; setName: string; featureBranch: string; baseBranch: string; movedDescendantIds: [] }
  | { status: 'blocked'; prdId: string; setName: string; featureBranch: string; baseBranch: string; reason: string };

interface ResumeQueueSnapshot {
  queueDir: string;
  queue: QueuedPrd[];
  waiting: QueuedPrd[];
  failed: QueuedPrd[];
  skipped: QueuedPrd[];
}

export async function requeueFailedPrdForCompiledResume(options: RequeueCompiledResumeOptions): Promise<RequeueCompiledResumeResult> {
  const unsafe = unsafePrdIdReason(options.prdId);
  if (unsafe) return blockedRequeue(options, unsafe);

  const snapshot = await loadResumeQueueSnapshot(options);
  const root = snapshot.queue.find((prd) => prd.id === options.prdId);
  if (root) {
    if (compiledResumeMatches(root, options)) {
      if (options.profileOverride !== undefined && root.frontmatter.profile !== options.profileOverride) {
        await setQueuedPrdFrontmatterFields(root, { profile: options.profileOverride });
      }
      return { status: 'already-queued', prdId: options.prdId, setName: options.setName, featureBranch: options.featureBranch, baseBranch: options.baseBranch, movedDescendantIds: [] };
    }
    return blockedRequeue(options, `Queue root already contains ${options.prdId}.md without matching compiled-resume metadata.`);
  }

  const parent = snapshot.failed.find((prd) => prd.id === options.prdId);
  if (!parent) return blockedRequeue(options, 'No failed queue PRD found for compiled-build resume requeue.');

  const descendantIds = findDescendantIds(options.prdId, snapshot.skipped);
  const moves = [
    { source: parent.filePath, target: queuePath(snapshot.queueDir, options.prdId) },
    ...descendantIds.map((id) => {
      const prd = snapshot.skipped.find((candidate) => candidate.id === id)!;
      return { source: prd.filePath, target: locationPath(snapshot.queueDir, 'waiting', id) };
    }),
  ];
  const preflightBlocker = await preflightMoves(moves);
  if (preflightBlocker) return blockedRequeue(options, preflightBlocker);

  const patch: Record<string, string> = {
    resume_mode: 'compiled',
    resume_from: options.prdId,
    resume_set_name: options.setName,
    resume_feature_branch: options.featureBranch,
    resume_base_branch: options.baseBranch,
  };
  if (options.profileOverride !== undefined) patch.profile = options.profileOverride;
  const originalParentContent = parent.content;
  await setQueuedPrdFrontmatterFields(parent, patch);

  const appliedMoves: Array<{ source: string; target: string }> = [];
  try {
    await mkdir(snapshot.queueDir, { recursive: true });
    for (const move of moves) {
      await moveNoOverwrite(move.source, move.target);
      appliedMoves.push(move);
    }
  } catch (err) {
    try {
      await rollbackAppliedMoves(appliedMoves);
    } catch {
      // Return the original blocker below; rollback failure leaves the queue blocked.
    }
    const parentMove = moves[0];
    const parentMoveApplied = parentMove !== undefined && appliedMoves.some((move) => move.target === parentMove.target);
    if (await exists(parent.filePath)) {
      await writeFile(parent.filePath, originalParentContent, 'utf-8');
    } else if (parentMove !== undefined && parentMoveApplied && await exists(parentMove.target)) {
      await writeFile(parentMove.target, originalParentContent, 'utf-8');
    }
    return blockedRequeue(options, `Compiled resume requeue blocked: ${(err as Error).message}`);
  }

  await releasePrd(options.prdId, options.cwd);
  return { status: 'queued', prdId: options.prdId, setName: options.setName, featureBranch: options.featureBranch, baseBranch: options.baseBranch, movedDescendantIds: descendantIds };
}

export async function beginQueuedResume(options: QueuedResumeOptions): Promise<ResumeQueueTransitionResult> {
  const unsafe = unsafePrdIdReason(options.prdId);
  if (unsafe) return blocked(options.prdId, unsafe);

  const snapshot = await loadResumeQueueSnapshot(options);
  const parent = snapshot.failed.find((prd) => prd.id === options.prdId);
  if (!parent) return { status: 'noop', prdId: options.prdId, reason: 'No failed queue PRD found for compiled-build resume.' };

  const descendantIds = findDescendantIds(options.prdId, snapshot.skipped);
  const moves = [
    { source: parent.filePath, target: queuePath(snapshot.queueDir, options.prdId) },
    ...descendantIds.map((id) => {
      const prd = snapshot.skipped.find((candidate) => candidate.id === id)!;
      return { source: prd.filePath, target: locationPath(snapshot.queueDir, 'waiting', id) };
    }),
  ];
  const preflightBlocker = await preflightMoves(moves);
  if (preflightBlocker) return blocked(options.prdId, preflightBlocker);

  const claimed = await claimPrd(options.prdId, options.cwd);
  if (!claimed) return blocked(options.prdId, `PRD ${options.prdId} is already locked by another worker.`);

  const appliedMoves: Array<{ source: string; target: string }> = [];
  try {
    await mkdir(snapshot.queueDir, { recursive: true });
    for (const move of moves) {
      await moveNoOverwrite(move.source, move.target);
      appliedMoves.push(move);
    }
  } catch (err) {
    try {
      await rollbackAppliedMoves(appliedMoves);
    } finally {
      await releasePrd(options.prdId, options.cwd);
    }
    return blocked(options.prdId, `Queued resume start blocked: ${(err as Error).message}`);
  }

  return { status: 'started', prdId: options.prdId, movedDescendantIds: descendantIds };
}

export async function finalizeQueuedResumeSuccess(options: QueuedResumeOptions): Promise<ResumeQueueTransitionResult> {
  const unsafe = unsafePrdIdReason(options.prdId);
  if (unsafe) return blocked(options.prdId, unsafe);

  const queueDir = resolve(options.cwd, options.queueDir ?? '.eforge/queue');
  const registry = await loadArtifactRegistry(options.cwd);
  const artifact = lookupArtifactByPrdId(registry, options.prdId);
  if (artifact?.status !== 'built') {
    return blocked(options.prdId, `Cannot finalize queued resume for ${options.prdId}: no usable built artifact exists.`);
  }

  const now = new Date().toISOString();
  await upsertCompletion(options.cwd, {
    prdId: options.prdId,
    status: 'completed',
    artifactAvailable: true,
    artifactBranch: artifact.artifactBranch,
    completedAt: now,
    updatedAt: now,
  });

  await rm(queuePath(queueDir, options.prdId), { force: true });
  await rm(locationPath(queueDir, 'failed', options.prdId), { force: true });
  await rm(resolve(queueDir, 'failed', `${options.prdId}.recovery.md`), { force: true });
  await rm(resolve(queueDir, 'failed', `${options.prdId}.recovery.json`), { force: true });
  await releasePrd(options.prdId, options.cwd);
  const unblockedIds = await unblockWaiting(queueDir, options.cwd, options.prdId, { requireArtifacts: true });

  return { status: 'completed', prdId: options.prdId, unblockedIds };
}

export async function rollbackQueuedResume(options: QueuedResumeOptions): Promise<ResumeQueueTransitionResult> {
  const unsafe = unsafePrdIdReason(options.prdId);
  if (unsafe) return blocked(options.prdId, unsafe);

  const snapshot = await loadResumeQueueSnapshot(options);
  const rootPath = queuePath(snapshot.queueDir, options.prdId);
  const failedPath = locationPath(snapshot.queueDir, 'failed', options.prdId);
  const rootExists = await exists(rootPath);
  if (rootExists && await exists(failedPath)) {
    await releasePrd(options.prdId, options.cwd);
    return blocked(options.prdId, `Cannot roll back queued resume for ${options.prdId}: failed target already exists.`);
  }

  const descendantIds = findDescendantIds(options.prdId, snapshot.waiting);
  const descendantMoves = descendantIds.map((id) => {
    const prd = snapshot.waiting.find((candidate) => candidate.id === id)!;
    return { source: prd.filePath, target: locationPath(snapshot.queueDir, 'skipped', id) };
  });
  const preflightBlocker = await preflightMoves(descendantMoves);
  if (preflightBlocker) {
    if (rootExists) {
      await mkdir(resolve(snapshot.queueDir, 'failed'), { recursive: true });
      await moveNoOverwrite(rootPath, failedPath);
    }
    await releasePrd(options.prdId, options.cwd);
    return blocked(options.prdId, preflightBlocker);
  }

  if (rootExists) {
    await mkdir(resolve(snapshot.queueDir, 'failed'), { recursive: true });
    await moveNoOverwrite(rootPath, failedPath);
  }
  await mkdir(resolve(snapshot.queueDir, 'skipped'), { recursive: true });
  for (const move of descendantMoves) {
    await moveNoOverwrite(move.source, move.target);
  }
  await releasePrd(options.prdId, options.cwd);

  return { status: 'rolled-back', prdId: options.prdId, skippedIds: descendantIds };
}

async function loadResumeQueueSnapshot(options: QueuedResumeOptions): Promise<ResumeQueueSnapshot> {
  const queueDir = resolve(options.cwd, options.queueDir ?? '.eforge/queue');
  const [queue, waiting, failed, skipped] = await Promise.all([
    loadQueue(queueDir, options.cwd),
    loadQueue(resolve(queueDir, 'waiting'), options.cwd),
    loadQueue(resolve(queueDir, 'failed'), options.cwd),
    loadQueue(resolve(queueDir, 'skipped'), options.cwd),
  ]);
  return { queueDir, queue, waiting, failed, skipped };
}

function findDescendantIds(rootId: string, candidates: QueuedPrd[]): string[] {
  const result: string[] = [];
  const seen = new Set<string>([rootId]);
  const pending = [rootId];
  while (pending.length > 0) {
    const current = pending.shift()!;
    for (const prd of candidates) {
      if (seen.has(prd.id) || !(prd.frontmatter.depends_on ?? []).includes(current)) continue;
      seen.add(prd.id);
      result.push(prd.id);
      pending.push(prd.id);
    }
  }
  return result;
}

async function preflightMoves(moves: Array<{ source: string; target: string }>): Promise<string | undefined> {
  for (const move of moves) {
    if (!await exists(move.source)) return `Queue resume source is missing: ${basename(move.source)}`;
    if (await exists(move.target)) return `Queue resume target already exists: ${basename(move.target)}`;
  }
  return undefined;
}

async function moveNoOverwrite(source: string, target: string): Promise<void> {
  await mkdir(dirname(target), { recursive: true });
  await link(source, target);
  try {
    await unlink(source);
  } catch (err) {
    await rm(target, { force: true });
    throw err;
  }
}

async function rollbackAppliedMoves(appliedMoves: Array<{ source: string; target: string }>): Promise<void> {
  for (const move of [...appliedMoves].reverse()) {
    if (!await exists(move.target)) continue;
    if (await exists(move.source)) throw new Error(`Cannot roll back queued resume move: ${basename(move.source)} already exists.`);
    await moveNoOverwrite(move.target, move.source);
  }
}

function queuePath(queueDir: string, prdId: string): string {
  return resolve(queueDir, `${prdId}.md`);
}

function locationPath(queueDir: string, location: 'failed' | 'skipped' | 'waiting', prdId: string): string {
  return resolve(queueDir, location, `${prdId}.md`);
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function unsafePrdIdReason(prdId: string): string | undefined {
  if (!prdId || prdId === '.' || prdId === '..') return 'PRD id must be a non-empty queue filename segment.';
  if (prdId.includes('/') || prdId.includes('\\') || prdId.includes('..') || prdId.includes('\0')) {
    return 'PRD id must not contain path separators, traversal, or NUL bytes.';
  }
  return undefined;
}

function compiledResumeMatches(prd: QueuedPrd, options: RequeueCompiledResumeOptions): boolean {
  try {
    const metadata = getCompiledResumeFrontmatter(prd.frontmatter);
    return metadata?.sourcePrdId === options.prdId &&
      metadata.setName === options.setName &&
      metadata.featureBranch === options.featureBranch &&
      metadata.baseBranch === options.baseBranch;
  } catch {
    return false;
  }
}

function blockedRequeue(options: RequeueCompiledResumeOptions, reason: string): RequeueCompiledResumeResult {
  return {
    status: 'blocked',
    prdId: options.prdId,
    setName: options.setName,
    featureBranch: options.featureBranch,
    baseBranch: options.baseBranch,
    reason,
  };
}

function blocked(prdId: string, reason: string): ResumeQueueTransitionResult {
  return { status: 'blocked', prdId, reason };
}
