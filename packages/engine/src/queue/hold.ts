import { resolve } from 'node:path';
import { claimPrd, deleteQueuedPrdFrontmatterFieldsExistingOnly, loadQueue, releasePrd, setQueuedPrdFrontmatterFieldsExistingOnly, type QueuedPrd } from '../prd-queue.js';
import { QueueControlError, type QueueControlLocation, type LocatedPrdStatus } from './control.js';
import { assertQueueRecordStillAtExpectedPath, assertSafePrdId, loadQueueControlSnapshot, type QueueControlRecord } from './snapshot.js';

export interface QueueHoldTestHooks {
  afterLocate?: () => void | Promise<void>;
  afterRootClaim?: () => void | Promise<void>;
  beforeWrite?: () => void | Promise<void>;
}

export interface HoldQueuedPrdOptions {
  cwd: string;
  queueDir: string;
  prdId: string;
  reason?: string;
  now?: () => string;
  __testHooks?: QueueHoldTestHooks;
}

export interface UnholdQueuedPrdOptions {
  cwd: string;
  queueDir: string;
  prdId: string;
  __testHooks?: QueueHoldTestHooks;
}

export interface QueueHoldMutationResult {
  prd: QueuedPrd;
  status: 'held' | 'already-held' | 'unheld' | 'already-unheld';
  location: QueueControlLocation;
  previousStatus: LocatedPrdStatus;
  heldAt?: string;
}

function validateReason(reason: string | undefined): string | undefined {
  if (reason === undefined) return undefined;
  const trimmed = reason.trim();
  if (trimmed.length === 0) return undefined;
  if (trimmed.length > 500 || /[\x00-\x1f\x7f]/.test(trimmed)) {
    throw new QueueControlError('validation', 'Hold reason must be 500 characters or fewer and must not contain control characters or newlines.');
  }
  return trimmed;
}

async function reloadPrd(cwd: string, queueDir: string, location: QueueControlLocation, prdId: string, expectedPath: string): Promise<QueuedPrd> {
  const dir = location === 'queue' ? queueDir : `${queueDir}/${location}`;
  const prds = await loadQueue(dir, cwd);
  const fresh = prds.find((p) => p.id === prdId && p.filePath === expectedPath);
  if (!fresh) throw new QueueControlError('conflict', `Queue item '${prdId}' changed location or disappeared before mutation; expected '${expectedPath}'.`);
  return fresh;
}

async function locateMutable(cwd: string, queueDir: string, prdId: string) {
  const snapshot = await loadQueueControlSnapshot({ cwd, queueDir, classifyRootLocks: 'read-only' });
  const duplicate = snapshot.duplicates.get(prdId);
  if (duplicate) throw new QueueControlError('conflict', `Queue item '${prdId}' appears in multiple queue locations.`);
  const record = snapshot.byId.get(prdId);
  if (!record) throw new QueueControlError('not-found', `Queue item '${prdId}' was not found.`);
  if (record.status !== 'pending' && record.status !== 'waiting') {
    throw new QueueControlError('conflict', `Queue item '${prdId}' is ${record.status}; only pending and waiting items can be held or unheld.`);
  }
  return record;
}

export async function holdQueuedPrd(options: HoldQueuedPrdOptions): Promise<QueueHoldMutationResult> {
  assertSafePrdId(options.prdId);
  const reason = validateReason(options.reason);
  const record = await locateMutable(options.cwd, options.queueDir, options.prdId);
  await options.__testHooks?.afterLocate?.();
  let claimed = false;
  try {
    if (record.location === 'queue') {
      claimed = await claimPrd(options.prdId, options.cwd);
      if (!claimed) throw new QueueControlError('conflict', `Queue item '${options.prdId}' is currently running or claimed.`);
      await options.__testHooks?.afterRootClaim?.();
    }
    const fresh = await reloadPrd(options.cwd, options.queueDir, record.location, options.prdId, record.filePath);
    if (fresh.frontmatter.held === true) {
      return { prd: fresh, status: 'already-held', location: record.location, previousStatus: record.status as 'pending' | 'waiting', heldAt: fresh.frontmatter.held_at };
    }
    const heldAt = options.now?.() ?? new Date().toISOString();
    await options.__testHooks?.beforeWrite?.();
    await assertQueueRecordStillAtExpectedPath({ id: fresh.id, filePath: fresh.filePath } as QueueControlRecord, resolve(options.cwd, options.queueDir));
    const updated = await setQueuedPrdFrontmatterFieldsExistingOnly(fresh, { held: true, held_at: heldAt, ...(reason !== undefined ? { hold_reason: reason } : {}) });
    return { prd: updated, status: 'held', location: record.location, previousStatus: record.status as 'pending' | 'waiting', heldAt };
  } finally {
    if (claimed) await releasePrd(options.prdId, options.cwd);
  }
}

export async function unholdQueuedPrd(options: UnholdQueuedPrdOptions): Promise<QueueHoldMutationResult> {
  assertSafePrdId(options.prdId);
  const record = await locateMutable(options.cwd, options.queueDir, options.prdId);
  await options.__testHooks?.afterLocate?.();
  let claimed = false;
  try {
    if (record.location === 'queue') {
      claimed = await claimPrd(options.prdId, options.cwd);
      if (!claimed) throw new QueueControlError('conflict', `Queue item '${options.prdId}' is currently running or claimed.`);
      await options.__testHooks?.afterRootClaim?.();
    }
    const fresh = await reloadPrd(options.cwd, options.queueDir, record.location, options.prdId, record.filePath);
    if (fresh.frontmatter.held !== true && fresh.frontmatter.hold_reason === undefined && fresh.frontmatter.held_at === undefined) {
      return { prd: fresh, status: 'already-unheld', location: record.location, previousStatus: record.status as 'pending' | 'waiting' };
    }
    await options.__testHooks?.beforeWrite?.();
    await assertQueueRecordStillAtExpectedPath({ id: fresh.id, filePath: fresh.filePath } as QueueControlRecord, resolve(options.cwd, options.queueDir));
    const updated = await deleteQueuedPrdFrontmatterFieldsExistingOnly(fresh, ['held', 'hold_reason', 'held_at']);
    return { prd: updated, status: 'unheld', location: record.location, previousStatus: record.status as 'pending' | 'waiting' };
  } finally {
    if (claimed) await releasePrd(options.prdId, options.cwd);
  }
}
