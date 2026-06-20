import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { QueueCascadeRunningOwnership, RunInfo } from '@eforge-build/client';
import { readPrdLockStatus } from '../prd-queue.js';
import { QueueControlError } from './control.js';
import { assertSafePrdId } from './snapshot.js';

export interface RunningOwnershipOptions {
  cwd: string;
  prdId: string;
  runs?: RunInfo[];
  sessionIdsByPrdId?: Map<string, string> | Array<{ prdId: string; sessionId: string; runId?: string }>;
  workerSessions?: Set<string>;
}

export interface QueuePrdCancellationMarker {
  prdId: string;
  reason?: string;
  sessionId?: string;
  runId?: string;
  pid?: number;
  requestedAt: string;
}

function sessionEvidence(options: RunningOwnershipOptions): { sessionId?: string; runId?: string } {
  const evidence = options.sessionIdsByPrdId;
  if (evidence instanceof Map) return { sessionId: evidence.get(options.prdId) };
  const found = evidence?.find((item) => item.prdId === options.prdId);
  return found ? { sessionId: found.sessionId, runId: found.runId } : {};
}

function runMatchesPrd(run: RunInfo, prdId: string): boolean {
  const candidate = run as unknown as Record<string, unknown>;
  return candidate.prdId === prdId || candidate.planSet === prdId || candidate.planSetName === prdId || candidate.name === prdId;
}

function isRunningRun(run: RunInfo): boolean {
  const status = (run as unknown as Record<string, unknown>).status;
  return status === 'running' || status === 'active';
}

export async function resolveRunningPrdOwnership(options: RunningOwnershipOptions): Promise<QueueCascadeRunningOwnership> {
  assertSafePrdId(options.prdId);
  const lock = await readPrdLockStatus(options.prdId, options.cwd);
  if (lock.state === 'absent') return { owned: false, reason: `Queue item '${options.prdId}' has no live lock.` };
  if (lock.state === 'stale') return { owned: false, reason: `Queue item '${options.prdId}' lock is stale.` };
  if (lock.state === 'corrupt') return { owned: false, reason: `Queue item '${options.prdId}' lock is corrupt.` };

  const run = options.runs?.find((r) => runMatchesPrd(r, options.prdId) && isRunningRun(r));
  if (!run) return { owned: false, reason: `Queue item '${options.prdId}' has no matching running run.` };
  const runRecord = run as unknown as Record<string, unknown>;
  const runId = typeof runRecord.id === 'string' ? runRecord.id : undefined;
  const runPid = typeof runRecord.pid === 'number' ? runRecord.pid : undefined;
  if (runPid !== lock.pid) return { owned: false, runId, reason: `Queue item '${options.prdId}' lock PID is not bound to the daemon worker.` };
  const sessionFromRun = typeof runRecord.sessionId === 'string' ? runRecord.sessionId : undefined;
  const sessionFromEvidence = sessionEvidence(options).sessionId;
  const sessionId = sessionFromRun ?? sessionFromEvidence;
  if (!sessionId) return { owned: false, runId, reason: `Queue item '${options.prdId}' has no daemon session id.` };
  if (!options.workerSessions?.has(sessionId)) {
    return { owned: false, sessionId, runId, reason: `Queue item '${options.prdId}' session is not daemon-owned.` };
  }
  return { owned: true, sessionId, runId, pid: lock.pid };
}

function markerPath(cwd: string, prdId: string): string {
  assertSafePrdId(prdId);
  return resolve(cwd, '.eforge', 'queue-cancellations', `${prdId}.json`);
}

export async function requestQueuePrdCancellation(options: { cwd: string; prdId: string; reason?: string; sessionId?: string; runId?: string; pid?: number; now?: () => string }): Promise<QueuePrdCancellationMarker> {
  const dir = resolve(options.cwd, '.eforge', 'queue-cancellations');
  await mkdir(dir, { recursive: true });
  const marker: QueuePrdCancellationMarker = {
    prdId: options.prdId,
    ...(options.reason !== undefined ? { reason: options.reason } : {}),
    ...(options.sessionId !== undefined ? { sessionId: options.sessionId } : {}),
    ...(options.runId !== undefined ? { runId: options.runId } : {}),
    ...(options.pid !== undefined ? { pid: options.pid } : {}),
    requestedAt: options.now?.() ?? new Date().toISOString(),
  };
  await writeFile(markerPath(options.cwd, options.prdId), `${JSON.stringify(marker, null, 2)}\n`, { encoding: 'utf-8', flag: 'wx' });
  return marker;
}

function markerMatchesExpected(marker: QueuePrdCancellationMarker, options: { expectedSessionId?: string; expectedRunId?: string; expectedPid?: number }): boolean {
  if (options.expectedSessionId !== undefined && marker.sessionId !== options.expectedSessionId) return false;
  if (options.expectedRunId !== undefined && marker.runId !== options.expectedRunId) return false;
  if (options.expectedPid !== undefined && marker.pid !== options.expectedPid) return false;
  return options.expectedSessionId !== undefined || options.expectedRunId !== undefined || options.expectedPid !== undefined;
}

export async function removeQueuePrdCancellation(options: { cwd: string; prdId: string }): Promise<void> {
  await rm(markerPath(options.cwd, options.prdId), { force: true });
}

export async function consumeQueuePrdCancellation(options: { cwd: string; prdId: string; expectedSessionId?: string; expectedRunId?: string; expectedPid?: number; now?: () => Date; maxAgeMs?: number }): Promise<QueuePrdCancellationMarker | null> {
  const path = markerPath(options.cwd, options.prdId);
  let raw: string;
  try {
    raw = await readFile(path, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return null;
    throw err;
  }
  await rm(path, { force: true });
  try {
    const parsed = JSON.parse(raw) as QueuePrdCancellationMarker;
    const requestedAtMs = Date.parse(parsed.requestedAt);
    const ageMs = (options.now?.() ?? new Date()).getTime() - requestedAtMs;
    const maxAgeMs = options.maxAgeMs ?? 5 * 60 * 1000;
    if (parsed?.prdId === options.prdId && typeof parsed.requestedAt === 'string' && Number.isFinite(requestedAtMs) && ageMs >= 0 && ageMs <= maxAgeMs && markerMatchesExpected(parsed, options)) return parsed;
  } catch { /* malformed marker is consumed as absent */ }
  return null;
}

export function classifyQueueChildExit(options: { exitCode: number | null; signal: NodeJS.Signals | null; schedulerAborted: boolean; operatorCancellation: QueuePrdCancellationMarker | null }): { status: 'completed' | 'failed' | 'skipped' | 'already-claimed'; moveTo: 'failed' | 'skipped' | null; shouldCleanupCompleted: boolean } {
  if (options.signal !== null && options.schedulerAborted) return { status: 'skipped', moveTo: null, shouldCleanupCompleted: false };
  if (options.signal !== null && options.operatorCancellation) return { status: 'skipped', moveTo: 'skipped', shouldCleanupCompleted: false };
  if (options.signal !== null) return { status: 'failed', moveTo: 'failed', shouldCleanupCompleted: false };
  switch (options.exitCode) {
    case 0: return { status: 'completed', moveTo: null, shouldCleanupCompleted: true };
    case 2: return { status: 'skipped', moveTo: 'skipped', shouldCleanupCompleted: false };
    case 10: return { status: 'already-claimed', moveTo: null, shouldCleanupCompleted: false };
    case 11: return { status: 'skipped', moveTo: null, shouldCleanupCompleted: false };
    default: return { status: 'failed', moveTo: 'failed', shouldCleanupCompleted: false };
  }
}

export { QueueControlError };
