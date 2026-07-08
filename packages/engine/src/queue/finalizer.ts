import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { basename, relative, resolve, sep } from 'node:path';

import { cleanupCompletedPrd, loadQueue, movePrdToSubdir, propagateSkip, releasePrd, unblockWaiting, type QueuedPrd } from '../prd-queue.js';
import { loadArtifactRegistry } from '../artifacts/registry.js';
import { loadCompletionRegistry, lookupCompletion, upsertCompletion } from '../artifacts/completions.js';
import { writeRecoverySidecar } from '../recovery/sidecar.js';
import { resolveTrunkBranch } from '../branch-policy.js';
import type { BuildFailureSummary, RecoveryVerdict } from '../events.js';

export type QueueFinalizerStatus = 'completed' | 'failed' | 'skipped';

export interface FinalizeQueuedPrdOptions {
  cwd: string;
  queueDir: string;
  prdId: string;
  status: QueueFinalizerStatus;
  filePath?: string;
  releaseLock?: boolean;
  requireArtifacts?: boolean;
  writeFailedEvidence?: (filePath: string) => Promise<void>;
  propagateDependents?: boolean;
  baseBranch?: string;
}

export interface FinalizeQueuedPrdResult {
  finalized: boolean;
  lockReleased: boolean;
  terminalTransition: 'completed-cleanup' | 'failed' | 'skipped' | 'already-terminal' | 'missing';
}

const inFlightFinalizations = new Map<string, Promise<FinalizeQueuedPrdResult>>();

export async function finalizeQueuedPrd(options: FinalizeQueuedPrdOptions): Promise<FinalizeQueuedPrdResult> {
  validatePrdId(options.prdId);
  const key = `${resolve(options.cwd)}\0${options.queueDir}\0${options.prdId}`;
  const existing = inFlightFinalizations.get(key);
  if (existing !== undefined) return existing;

  const finalization = finalizeQueuedPrdOnce(options);
  inFlightFinalizations.set(key, finalization);
  try {
    return await finalization;
  } finally {
    inFlightFinalizations.delete(key);
  }
}

async function finalizeQueuedPrdOnce(options: FinalizeQueuedPrdOptions): Promise<FinalizeQueuedPrdResult> {
  const filePath = options.filePath ?? await resolveCurrentPrdPath(options.cwd, options.queueDir, options.prdId);
  let lockReleased = false;
  const existingCompletion = await getTerminalCompletion(options.cwd, options.prdId);
  if (existingCompletion !== undefined) {
    const releaseAlreadyTerminalLock = async (): Promise<FinalizeQueuedPrdResult> => {
      await propagateExistingTerminalDependents(options, existingCompletion.status, existingCompletion.artifactAvailable);
      if (options.releaseLock !== false) {
        await releasePrd(options.prdId, options.cwd);
        lockReleased = true;
      }
      return { finalized: false, lockReleased, terminalTransition: 'already-terminal' };
    };
    if (filePath === undefined) {
      return releaseAlreadyTerminalLock();
    }
    const location = classifyQueuePath(options, filePath);
    if (options.status === 'completed' && existingCompletion.status === 'completed' && location === 'root') {
      return finalizeAdoptedCompletedPrd(options, filePath);
    }
    if (location === 'skipped' || (location === 'failed' && await hasRecoveryEvidence(options.cwd, options.queueDir, options.prdId))) {
      return releaseAlreadyTerminalLock();
    }
  }

  let terminalTransition: FinalizeQueuedPrdResult['terminalTransition'] = 'missing';
  let primaryError: unknown;
  let dependentPropagation: (() => Promise<void>) | undefined;

  try {
    if (options.status === 'completed') {
      if (filePath !== undefined) await cleanupCompletedPrd(filePath, options.queueDir, options.cwd);
      dependentPropagation = async () => { await unblockWaiting(options.queueDir, options.cwd, options.prdId, { requireArtifacts: options.requireArtifacts ?? true }); };
      terminalTransition = 'completed-cleanup';
    } else if (options.status === 'failed') {
      if (filePath !== undefined) await finalizeFailedFile(options, filePath);
      else await writeDegradedRecoveryEvidence(options, 'failed completion replay without PRD file');
      if (options.propagateDependents !== false) dependentPropagation = () => propagateSkip(options.queueDir, options.cwd, options.prdId, 'failed');
      terminalTransition = filePath === undefined ? 'missing' : 'failed';
    } else {
      if (filePath !== undefined) await moveTerminalAware(options, filePath, 'skipped');
      if (options.propagateDependents !== false) dependentPropagation = () => propagateSkip(options.queueDir, options.cwd, options.prdId, 'cancelled');
      terminalTransition = filePath === undefined ? 'missing' : 'skipped';
    }

    await recordCompletion(options);
    try { await dependentPropagation?.(); } catch { /* best-effort dependent propagation */ }
  } catch (err) {
    primaryError = err;
  } finally {
    if (options.releaseLock !== false) {
      try {
        await releasePrd(options.prdId, options.cwd);
        lockReleased = true;
      } catch (releaseErr) {
        if (primaryError === undefined) primaryError = releaseErr;
      }
    }
  }

  if (primaryError !== undefined) throw primaryError;
  return { finalized: true, lockReleased, terminalTransition };
}

async function finalizeFailedFile(options: FinalizeQueuedPrdOptions, filePath: string): Promise<void> {
  const location = classifyQueuePath(options, filePath);
  if (location === 'failed') {
    await writeDegradedRecoveryEvidence(options, 'failed PRD was already terminal without recovery evidence');
    return;
  }

  if (options.writeFailedEvidence !== undefined) {
    try {
      await options.writeFailedEvidence(filePath);
      if (!await hasRecoveryEvidence(options.cwd, options.queueDir, options.prdId)) {
        await writeDegradedRecoveryEvidence(options, 'failed evidence writer completed without recovery evidence');
      }
    } catch {
      await moveTerminalAware(options, filePath, 'failed');
      await writeDegradedRecoveryEvidence(options, 'failed evidence writer threw');
    }
    return;
  }
  await moveTerminalAware(options, filePath, 'failed');
  await writeDegradedRecoveryEvidence(options, 'shared finalizer replay without build evidence');
}

async function propagateExistingTerminalDependents(options: FinalizeQueuedPrdOptions, status: QueueFinalizerStatus, artifactAvailable: boolean): Promise<void> {
  try {
    if (status === 'completed') {
      if (artifactAvailable || options.requireArtifacts === false) {
        await unblockWaiting(options.queueDir, options.cwd, options.prdId, { requireArtifacts: options.requireArtifacts ?? true });
      }
    } else if (options.propagateDependents !== false) {
      await propagateSkip(options.queueDir, options.cwd, options.prdId, status === 'failed' ? 'failed' : 'cancelled');
    }
  } catch {
    // Best-effort dependent propagation mirrors first-time finalization.
  }
}

async function recordCompletion(options: FinalizeQueuedPrdOptions): Promise<void> {
  const now = new Date().toISOString();
  let artifactAvailable = false;
  let artifactBranch: string | undefined;
  if (options.status === 'completed') {
    const registry = await loadArtifactRegistry(options.cwd).catch(() => undefined);
    const record = registry?.builds.find((build) => build.prdId === options.prdId);
    artifactAvailable = record?.status === 'built';
    artifactBranch = record?.artifactBranch;
  }
  await upsertCompletion(options.cwd, {
    prdId: options.prdId,
    status: options.status,
    artifactAvailable,
    ...(artifactBranch !== undefined ? { artifactBranch } : {}),
    completedAt: now,
    updatedAt: now,
  });
}

async function getTerminalCompletion(cwd: string, prdId: string): Promise<ReturnType<typeof lookupCompletion> | undefined> {
  const registry = await loadCompletionRegistry(cwd).catch(() => undefined);
  return registry === undefined ? undefined : lookupCompletion(registry, prdId);
}

async function finalizeAdoptedCompletedPrd(options: FinalizeQueuedPrdOptions, filePath: string): Promise<FinalizeQueuedPrdResult> {
  let lockReleased = false;
  let primaryError: unknown;
  try {
    await cleanupCompletedPrd(filePath, options.queueDir, options.cwd);
    try {
      await unblockWaiting(options.queueDir, options.cwd, options.prdId, { requireArtifacts: options.requireArtifacts ?? true });
    } catch { /* best-effort dependent propagation */ }
  } catch (err) {
    primaryError = err;
  } finally {
    if (options.releaseLock !== false) {
      try {
        await releasePrd(options.prdId, options.cwd);
        lockReleased = true;
      } catch (releaseErr) {
        if (primaryError === undefined) primaryError = releaseErr;
      }
    }
  }
  if (primaryError !== undefined) throw primaryError;
  return { finalized: true, lockReleased, terminalTransition: 'completed-cleanup' };
}

async function resolveCurrentPrdPath(cwd: string, queueDir: string, prdId: string): Promise<string | undefined> {
  const candidates = [
    resolve(cwd, queueDir, `${prdId}.md`),
    resolve(cwd, queueDir, 'failed', `${prdId}.md`),
    resolve(cwd, queueDir, 'skipped', `${prdId}.md`),
  ];
  for (const candidate of candidates) {
    if (await exists(candidate)) return candidate;
  }
  const waiting = await loadQueue(`${queueDir}/waiting`, cwd).catch((): QueuedPrd[] => []);
  return waiting.find((prd) => prd.id === prdId)?.filePath;
}

async function hasRecoveryEvidence(cwd: string, queueDir: string, prdId: string): Promise<boolean> {
  const failedDir = resolve(cwd, queueDir, 'failed');
  return await exists(resolve(failedDir, `${prdId}.recovery.json`)) || await exists(resolve(failedDir, `${prdId}.recovery.md`));
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function validatePrdId(prdId: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(prdId) || prdId === '.' || prdId === '..') {
    throw new Error(`Invalid queued PRD id: ${prdId}`);
  }
}

function classifyQueuePath(options: FinalizeQueuedPrdOptions, filePath: string): 'root' | 'failed' | 'skipped' | 'other' {
  const rel = relative(resolve(options.cwd, options.queueDir), resolve(filePath));
  if (rel === `${options.prdId}.md`) return 'root';
  if (rel === `failed${sep}${options.prdId}.md`) return 'failed';
  if (rel === `skipped${sep}${options.prdId}.md`) return 'skipped';
  return 'other';
}

async function moveTerminalAware(options: FinalizeQueuedPrdOptions, filePath: string, target: 'failed' | 'skipped'): Promise<void> {
  const location = classifyQueuePath(options, filePath);
  if (location === target) return;
  if (location !== 'root') return;
  try {
    await movePrdToSubdir(filePath, target, options.cwd);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT' && await exists(resolve(options.cwd, options.queueDir, target, `${options.prdId}.md`))) return;
    throw err;
  }
}

async function writeDegradedRecoveryEvidence(options: FinalizeQueuedPrdOptions, reason: string): Promise<void> {
  const failedDir = resolve(options.cwd, options.queueDir, 'failed');
  const existingJson = resolve(failedDir, `${options.prdId}.recovery.json`);
  if (await exists(existingJson)) return;
  const now = new Date().toISOString();
  const baseBranch = await degradedEvidenceBaseBranch(options);
  const summary: BuildFailureSummary = {
    prdId: options.prdId,
    setName: options.prdId,
    featureBranch: `eforge/${options.prdId}`,
    baseBranch,
    plans: [],
    failingPlan: { planId: 'unknown' },
    landedCommits: [],
    diffStat: '',
    modelsUsed: [],
    failedAt: now,
    partial: true,
  };
  const verdict: RecoveryVerdict = {
    verdict: 'manual',
    confidence: 'low',
    rationale: reason,
    recommendationSource: 'manual-fallback',
    recommendationRationale: reason,
    completedWork: [],
    remainingWork: ['Inspect persisted queue completion and build logs.'],
    risks: ['Recovery evidence was reconstructed after the worker exited.'],
  };
  await writeRecoverySidecar({ failedPrdDir: failedDir, prdId: basename(options.prdId), summary, verdict });
}

async function degradedEvidenceBaseBranch(options: Pick<FinalizeQueuedPrdOptions, 'baseBranch' | 'cwd'>): Promise<string> {
  const configured = options.baseBranch?.trim();
  if (configured) return configured;
  // resolveTrunkBranch never throws: it falls back to 'main' internally.
  return resolveTrunkBranch(undefined, options.cwd);
}
