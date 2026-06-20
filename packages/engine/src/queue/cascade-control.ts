import { link, lstat, mkdir, realpath, rm } from 'node:fs/promises';
import { basename, relative, resolve, sep } from 'node:path';
import type {
  QueueCascadeAffectedItem,
  QueueCascadeApplyItemResult,
  QueueCascadeApplyResponse,
  QueueCascadeExpectedAffected,
  QueueCascadeOperation,
  QueueCascadePreviewResponse,
  QueueCascadeRunningOwnership,
  QueueCascadeStrategy,
} from '@eforge-build/client';
import { claimPrd, releasePrd, setQueuedPrdFrontmatterFieldsExistingOnly } from '../prd-queue.js';
import { QueueControlError } from './control.js';
import { removeQueuePrdCancellation, requestQueuePrdCancellation } from './cancellation.js';
import {
  assertPathUnderQueue,
  assertQueueRecordStillAtExpectedPath,
  assertSafePrdId,
  buildCascadeExpectedAffected,
  findCascadeDependents,
  loadQueueControlSnapshot,
  type CascadeDependent,
  type QueueControlRecord,
} from './snapshot.js';

export interface PreviewQueueCascadeOptions {
  cwd: string;
  queueDir: string;
  prdId: string;
  operation: QueueCascadeOperation;
  resolveRunningOwnership?: (record: QueueControlRecord) => Promise<QueueCascadeRunningOwnership> | QueueCascadeRunningOwnership;
}

export interface ApplyQueueCascadeOptions extends PreviewQueueCascadeOptions {
  strategy: QueueCascadeStrategy;
  expectedAffected: QueueCascadeExpectedAffected;
  confirmDependents: boolean;
  reason?: string;
  cancelRunning?: (ownership: QueueCascadeRunningOwnership, record: QueueControlRecord) => Promise<{ cancelled: boolean; reason?: string }> | { cancelled: boolean; reason?: string };
  now?: () => string;
}

const noResolver: QueueCascadeRunningOwnership = { owned: false, reason: 'No running ownership resolver supplied.' };
const defaultRefusal = 'Dependent queue items exist; preview and apply cascade-dependents to mutate them together.';

function validateOperation(operation: QueueCascadeOperation): void {
  if (operation !== 'remove' && operation !== 'cancel') throw new QueueControlError('validation', `Unsupported queue cascade operation: ${operation}`);
}

function validateReason(reason: string | undefined): string | undefined {
  if (reason === undefined) return undefined;
  const trimmed = reason.trim();
  if (trimmed.length === 0) return undefined;
  if (trimmed.length > 500 || /[\x00-\x1f\x7f]/.test(trimmed)) {
    throw new QueueControlError('validation', 'Queue cascade reason must be 500 characters or fewer and must not contain control characters or newlines.');
  }
  return trimmed;
}

async function ownership(record: QueueControlRecord, resolver?: PreviewQueueCascadeOptions['resolveRunningOwnership']): Promise<QueueCascadeRunningOwnership | undefined> {
  if (record.status !== 'running') return undefined;
  return resolver ? await resolver(record) : noResolver;
}

function effectFor(record: QueueControlRecord, operation: QueueCascadeOperation, dependent: boolean): QueueCascadeAffectedItem['effect'] {
  if (operation === 'remove') return dependent ? 'dependent-remove' : 'target-remove';
  if (record.status === 'failed') return 'refused';
  if (record.status === 'skipped' && dependent) return 'none';
  return dependent ? 'dependent-cancel' : 'target-cancel';
}

async function toAffected(record: QueueControlRecord, depth: number, operation: QueueCascadeOperation, dependent: boolean, resolver?: PreviewQueueCascadeOptions['resolveRunningOwnership']): Promise<QueueCascadeAffectedItem> {
  const runningOwnership = await ownership(record, resolver);
  const blockers: string[] = [];
  if (operation === 'remove' && record.status === 'running') blockers.push(`Running queue item '${record.id}' cannot be removed.`);
  if (operation === 'cancel' && record.status === 'failed') blockers.push(`Failed queue item '${record.id}' cannot be cancelled; use remove or recovery.`);
  if (operation === 'cancel' && record.status === 'running' && runningOwnership?.owned !== true) blockers.push(`Running queue item '${record.id}' cannot be cancelled: ${runningOwnership?.reason ?? 'missing ownership evidence'}`);
  return {
    prdId: record.id,
    title: record.title,
    status: record.status,
    location: record.location,
    dependsOn: record.dependsOn,
    depth,
    effect: blockers.length > 0 ? 'refused' : effectFor(record, operation, dependent),
    blockers,
    ...(runningOwnership ? { runningOwnership } : {}),
  };
}

function missingPreview(operation: QueueCascadeOperation, strategy: QueueCascadeStrategy, preview?: QueueCascadePreviewResponse): QueueCascadeApplyResponse {
  const blockers = preview?.blockers.length ? preview.blockers : ['Target queue item was not found.'];
  const reason = blockers.join(' ');
  return {
    applied: false,
    operation,
    strategy,
    target: {
      prdId: preview?.target.prdId ?? '',
      previousStatus: preview?.target.status ?? 'pending',
      status: preview?.target.status ?? 'pending',
      reason,
    },
    dependents: preview?.dependents.map((item) => ({ prdId: item.prdId, previousStatus: item.status, status: item.status, reason: item.blockers.join(' ') || reason })) ?? [],
    warnings: preview?.warnings ?? [],
    blockers,
  };
}

export async function previewQueueCascade(options: PreviewQueueCascadeOptions): Promise<QueueCascadePreviewResponse> {
  assertSafePrdId(options.prdId);
  validateOperation(options.operation);
  const snapshot = await loadQueueControlSnapshot({ cwd: options.cwd, queueDir: options.queueDir, classifyRootLocks: 'read-only' });
  const duplicate = snapshot.duplicates.get(options.prdId);
  if (duplicate) {
    const target = duplicate[0]!;
    return { target: await toAffected(target, 0, options.operation, false, options.resolveRunningOwnership), dependents: [], safeStrategies: [], warnings: [], blockers: [`Queue item '${options.prdId}' appears in multiple queue locations.`], expectedAffected: { token: '', prdIds: [options.prdId] } };
  }
  const target = snapshot.byId.get(options.prdId);
  if (!target) {
    return {
      target: { prdId: options.prdId, title: options.prdId, status: 'pending', location: 'queue', dependsOn: [], depth: 0, effect: 'refused', blockers: [`Queue item '${options.prdId}' was not found.`] },
      dependents: [],
      safeStrategies: [],
      warnings: [],
      blockers: [`Queue item '${options.prdId}' was not found.`],
      expectedAffected: { token: '', prdIds: [options.prdId] },
    };
  }
  const dependentLinks = findCascadeDependents(options.prdId, snapshot.records);
  const affectedTarget = await toAffected(target, 0, options.operation, false, options.resolveRunningOwnership);
  const dependents = await Promise.all(dependentLinks.map((d) => toAffected(d.record, d.depth, options.operation, true, options.resolveRunningOwnership)));
  const blockers = [...affectedTarget.blockers, ...dependents.flatMap((d) => d.blockers)];
  const warnings = dependents.filter((d) => options.operation === 'cancel' && d.status === 'skipped').map((d) => `Skipped dependent '${d.prdId}' is already terminal and will not be changed.`);
  const safeStrategies: QueueCascadeStrategy[] = [];
  if (blockers.length === 0) {
    if (dependents.length === 0) safeStrategies.push('target-only');
    if (dependents.length > 0 && dependents.every((d) => d.blockers.length === 0)) safeStrategies.push('cascade-dependents');
  }
  return {
    target: affectedTarget,
    dependents,
    ...(dependents.length > 0 ? { defaultRefusalReason: defaultRefusal } : {}),
    safeStrategies,
    warnings,
    blockers,
    expectedAffected: buildCascadeExpectedAffected(target, dependentLinks),
  };
}

function expectedMatches(a: QueueCascadeExpectedAffected, b: QueueCascadeExpectedAffected): boolean {
  return a.token === b.token && a.prdIds.length === b.prdIds.length && a.prdIds.every((id, i) => id === b.prdIds[i]);
}

function emptyResult(record: QueueControlRecord, status: QueueCascadeApplyItemResult['status'], reason?: string): QueueCascadeApplyItemResult {
  return { prdId: record.id, previousStatus: record.status, status, currentStatus: status, ...(reason ? { reason } : {}) };
}

async function removeRecord(record: QueueControlRecord, queueDir: string): Promise<QueueCascadeApplyItemResult> {
  await rm(record.filePath);
  const removedSidecars: string[] = [];
  if (record.location === 'failed') {
    for (const suffix of ['.recovery.json', '.recovery.md']) {
      const sidecar = resolve(record.filePath, '..', `${record.id}${suffix}`);
      try { await rm(sidecar); removedSidecars.push(relative(queueDir, sidecar)); } catch (err) { if ((err as NodeJS.ErrnoException)?.code !== 'ENOENT') throw err; }
    }
  }
  return { prdId: record.id, previousStatus: record.status, status: 'removed', currentStatus: 'removed', removedSidecars };
}

async function ensureSkippedDestinationAvailable(record: QueueControlRecord, queueDir: string): Promise<void> {
  const dest = resolve(queueDir, 'skipped', basename(record.filePath));
  try {
    await lstat(dest);
    throw new QueueControlError('conflict', `Skipped destination already exists for queue item '${record.id}': ${dest}`);
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return;
    throw err;
  }
}

function assertRealPathUnderQueue(realQueueDir: string, realTarget: string): void {
  const rel = relative(realQueueDir, realTarget);
  if (rel === '' || rel.startsWith('..') || rel.includes(`..${sep}`) || resolve(realQueueDir, rel) !== realTarget) {
    throw new QueueControlError('validation', `Queue path escapes queue root: ${realTarget}`);
  }
}

async function assertSkippedDirectorySafe(queueDir: string, destDir: string): Promise<void> {
  const stat = await lstat(destDir);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new QueueControlError('validation', `Skipped queue directory is not a real directory: ${destDir}`);
  const [realQueueDir, realDestDir] = await Promise.all([realpath(queueDir), realpath(destDir)]);
  assertRealPathUnderQueue(realQueueDir, realDestDir);
}

async function moveToSkipped(record: QueueControlRecord, queueDir: string, reason: string): Promise<QueueCascadeApplyItemResult> {
  const updated = await setQueuedPrdFrontmatterFieldsExistingOnly(record.prd, { skip_reason: reason });
  const destDir = resolve(queueDir, 'skipped');
  await mkdir(destDir, { recursive: true });
  await assertSkippedDirectorySafe(queueDir, destDir);
  const dest = resolve(destDir, basename(updated.filePath));
  try {
    await link(updated.filePath, dest);
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === 'EEXIST') throw new QueueControlError('conflict', `Skipped destination already exists for queue item '${record.id}': ${dest}`);
    throw err;
  }
  await rm(updated.filePath);
  return { prdId: record.id, previousStatus: record.status, status: 'skipped', currentStatus: 'skipped', reason };
}

async function applyCancelRecord(record: QueueControlRecord, options: ApplyQueueCascadeOptions, dependentOn?: string): Promise<QueueCascadeApplyItemResult> {
  if (record.status === 'failed') return emptyResult(record, 'failed', 'Failed queue items cannot be cancelled; use remove or recovery.');
  if (record.status === 'skipped') return emptyResult(record, 'skipped', 'Queue item is already skipped.');
  const reason = validateReason(options.reason) || (dependentOn ? `cancelled because upstream ${dependentOn} was cancelled` : 'cancelled by operator');
  if (record.status === 'pending' || record.status === 'waiting') return moveToSkipped(record, resolve(options.cwd, options.queueDir), reason);
  const runningOwnership = options.resolveRunningOwnership ? await options.resolveRunningOwnership(record) : noResolver;
  if (runningOwnership.owned !== true) return emptyResult(record, 'running', `Running queue item '${record.id}' cannot be cancelled: ${runningOwnership.reason ?? 'missing ownership evidence'}`);
  await requestQueuePrdCancellation({ cwd: options.cwd, prdId: record.id, reason, sessionId: runningOwnership.sessionId, runId: runningOwnership.runId, pid: runningOwnership.pid, now: options.now });
  let cancelled: { cancelled: boolean; reason?: string };
  try {
    cancelled = options.cancelRunning ? await options.cancelRunning(runningOwnership, record) : { cancelled: true };
  } catch (err) {
    await removeQueuePrdCancellation({ cwd: options.cwd, prdId: record.id });
    throw err;
  }
  if (!cancelled.cancelled) await removeQueuePrdCancellation({ cwd: options.cwd, prdId: record.id });
  return {
    prdId: record.id,
    previousStatus: 'running',
    status: cancelled.cancelled ? 'cancelled' : 'running',
    currentStatus: cancelled.cancelled ? 'cancelled' : 'running',
    reason: cancelled.reason ?? reason,
    ...(runningOwnership.sessionId ? { sessionId: runningOwnership.sessionId } : {}),
    ...(runningOwnership.runId ? { runId: runningOwnership.runId } : {}),
    ...(runningOwnership.pid !== undefined ? { pid: runningOwnership.pid } : {}),
  };
}

async function claimRootRecords(records: QueueControlRecord[], cwd: string): Promise<string[]> {
  const ids = records.filter((r) => r.location === 'queue' && r.status === 'pending').map((r) => r.id).sort();
  const claimed: string[] = [];
  for (const id of ids) {
    if (!(await claimPrd(id, cwd))) throw new QueueControlError('conflict', `Queue item '${id}' is currently running or claimed.`);
    claimed.push(id);
  }
  return claimed;
}

export async function applyQueueCascade(options: ApplyQueueCascadeOptions): Promise<QueueCascadeApplyResponse> {
  assertSafePrdId(options.prdId);
  validateOperation(options.operation);
  const preview = await previewQueueCascade(options);
  const strategy = options.strategy;
  const blocker = (reason: string): QueueCascadeApplyResponse => ({ applied: false, operation: options.operation, strategy, target: { prdId: preview.target.prdId, previousStatus: preview.target.status, status: preview.target.status, reason }, dependents: [], warnings: preview.warnings, blockers: [reason] });
  if (!preview.expectedAffected.token) return missingPreview(options.operation, strategy, preview);
  if (!expectedMatches(options.expectedAffected, preview.expectedAffected)) return blocker('Queue cascade preview drifted; refresh the preview and retry.');
  if (preview.dependents.length > 0 && strategy === 'target-only') return blocker(preview.defaultRefusalReason ?? defaultRefusal);
  if (preview.dependents.length > 0 && (strategy !== 'cascade-dependents' || options.confirmDependents !== true)) return blocker('Cascade dependents confirmation is required.');
  if (preview.blockers.length > 0) return blocker(preview.blockers.join(' '));

  const snapshot = await loadQueueControlSnapshot({ cwd: options.cwd, queueDir: options.queueDir, classifyRootLocks: 'mutation' });
  const target = snapshot.byId.get(options.prdId);
  if (!target) return missingPreview(options.operation, strategy, preview);
  const dependents = findCascadeDependents(options.prdId, snapshot.records);
  const expected = buildCascadeExpectedAffected(target, dependents);
  if (!expectedMatches(options.expectedAffected, expected)) return blocker('Queue cascade preview drifted; refresh the preview and retry.');
  const records = strategy === 'cascade-dependents' ? [target, ...dependents.map((d) => d.record)] : [target];
  for (const record of records) {
    assertPathUnderQueue(snapshot.queueDir, record.filePath);
    await assertQueueRecordStillAtExpectedPath(record, snapshot.queueDir);
  }
  if (options.operation === 'cancel') {
    for (const record of records) {
      if (record.status === 'pending' || record.status === 'waiting') await ensureSkippedDestinationAvailable(record, snapshot.queueDir);
    }
  }
  const claimed = await claimRootRecords(records, options.cwd);
  try {
    let targetResult: QueueCascadeApplyItemResult;
    let dependentResults: QueueCascadeApplyItemResult[] = [];
    if (options.operation === 'remove') {
      const ordered = [...dependents].sort((a: CascadeDependent, b: CascadeDependent) => b.depth - a.depth || a.record.id.localeCompare(b.record.id)).map((d) => d.record);
      dependentResults = strategy === 'cascade-dependents' ? await Promise.all(ordered.map((r) => removeRecord(r, snapshot.queueDir))) : [];
      targetResult = await removeRecord(target, snapshot.queueDir);
    } else {
      targetResult = await applyCancelRecord(target, options);
      dependentResults = strategy === 'cascade-dependents' ? await Promise.all(dependents.map((d) => applyCancelRecord(d.record, options, target.id))) : [];
    }
    return { applied: true, operation: options.operation, strategy, target: targetResult, dependents: dependentResults, warnings: preview.warnings, blockers: [] };
  } finally {
    await Promise.all(claimed.map((id) => releasePrd(id, options.cwd)));
  }
}
