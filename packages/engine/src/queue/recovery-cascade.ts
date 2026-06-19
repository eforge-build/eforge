/** Queue recovery cascade analysis and guarded filesystem apply. */

import { access, lstat, mkdir, realpath, rename, rm } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import {
  QUEUE_RECOVERY_STRATEGY_RETRY_AND_REACTIVATE,
  isQueueRecoveryStrategy,
  type QueueRecoveryAnalyzeResponse,
  type QueueRecoveryApplyResponse,
  type QueueRecoveryEdge,
  type QueueRecoveryLocation,
  type QueueRecoveryNode,
  type QueueRecoveryNotice,
  type QueueRecoveryOperation,
  type QueueRecoveryOperationResult,
  type QueueRecoveryRepairResult,
  type QueueRecoveryStrategy,
} from '@eforge-build/client';
import { deleteQueuedPrdFrontmatterFieldsExistingOnly, loadQueue, setQueuedPrdFrontmatterFieldsExistingOnly, type QueuedPrd } from '../prd-queue.js';
import { loadArtifactRegistry, hasUsableArtifact } from '../artifacts/registry.js';
import { loadCompletionRegistry, lookupCompletion } from '../artifacts/completions.js';
import { buildRecoveryPreflight } from './recovery-preflight.js';

interface RecoveryOptions {
  cwd: string;
  selectedPrdId: string;
  strategy?: QueueRecoveryStrategy | string;
  queueDir?: string;
  stackingEnabled?: boolean;
}

export interface ApplyQueueRecoveryOptions extends RecoveryOptions {
  expectedOperations: QueueRecoveryOperation[];
  repairActions?: unknown;
  confirmDependencyRemoval?: boolean;
}

interface QueueRecord {
  id: string;
  title: string;
  location: QueueRecoveryLocation;
  dependsOn: string[];
  stackParent?: string;
  filePath: string;
  prd: QueuedPrd;
}

interface QueueSnapshot {
  queueDir: string;
  records: QueueRecord[];
  byId: Map<string, QueueRecord>;
}

const LOCATIONS: QueueRecoveryLocation[] = ['queue', 'waiting', 'failed', 'skipped'];

export async function analyzeQueueRecovery(options: RecoveryOptions): Promise<QueueRecoveryAnalyzeResponse> {
  const strategy = options.strategy ?? QUEUE_RECOVERY_STRATEGY_RETRY_AND_REACTIVATE;
  const blockers: QueueRecoveryNotice[] = [];
  const warnings: QueueRecoveryNotice[] = [];

  if (!isQueueRecoveryStrategy(strategy)) {
    blockers.push(blocker('unsupported-strategy', `Unsupported queue recovery strategy: ${String(strategy)}`));
    return emptyAnalyze(options.selectedPrdId, strategy, warnings, blockers);
  }
  if (!isSafePrdId(options.selectedPrdId)) {
    blockers.push(blocker('unsafe-prd-id', 'Selected PRD id is not a safe queue filename', options.selectedPrdId));
    return emptyAnalyze(options.selectedPrdId, strategy, warnings, blockers);
  }

  const snapshot = await loadQueueSnapshot(options.cwd, options.queueDir);
  const selected = snapshot.byId.get(options.selectedPrdId);
  if (!selected) {
    blockers.push(blocker('unknown-selected-prd', `Selected PRD is not present in the queue: ${options.selectedPrdId}`, options.selectedPrdId));
    return emptyAnalyze(options.selectedPrdId, strategy, warnings, blockers);
  }
  if (selected.location !== 'failed') {
    blockers.push(blocker('selected-not-failed', `Selected PRD must be in failed/, found ${selected.location}`, selected.id));
    return emptyAnalyze(options.selectedPrdId, strategy, warnings, blockers);
  }

  warnings.push(...await readSidecarWarnings(snapshot.queueDir, selected.id));

  const cascadeIds = findSkippedDescendants(selected.id, snapshot.records);
  const analyzedIds = new Set<string>([selected.id, ...cascadeIds]);
  await addDependencyBlockers(options.cwd, snapshot, analyzedIds, blockers);

  const nodes = buildNodes(snapshot, selected.id, analyzedIds);
  const edges = buildEdges(snapshot, analyzedIds);
  const operations = await buildOperations(options.cwd, snapshot, selected.id, cascadeIds);
  const targetIds = operations.filter((op) => op.kind === 'move-prd').map((op) => op.prdId);
  const [artifactRegistry, completionRegistry] = await Promise.all([
    loadArtifactRegistry(options.cwd),
    loadCompletionRegistry(options.cwd),
  ]);
  const preflight = buildRecoveryPreflight({
    records: snapshot.records.map((record) => ({ id: record.id, title: record.title, location: record.location, dependsOn: record.dependsOn, ...(record.stackParent !== undefined && { stackParent: record.stackParent }), prd: record.prd })),
    targetIds,
    artifactRegistry,
    completionRegistry,
    stackingEnabled: options.stackingEnabled ?? true,
  });
  warnings.push(...preflight.dispatchPreflight.warnings);
  blockers.push(...preflight.dispatchPreflight.blockers);

  return {
    selectedPrdId: options.selectedPrdId,
    strategy,
    eligible: blockers.length === 0,
    nodes,
    edges,
    operations,
    warnings,
    blockers,
    dependencyClassifications: preflight.dependencyClassifications,
    dispatchPreflight: preflight.dispatchPreflight,
    availableRepairActions: preflight.availableRepairActions,
  };
}

export async function applyQueueRecovery(options: ApplyQueueRecoveryOptions): Promise<QueueRecoveryApplyResponse> {
  const analysis = await analyzeQueueRecovery(options);
  const baseResults = (options.expectedOperations.length > 0 ? options.expectedOperations : analysis.operations)
    .map((operation): QueueRecoveryOperationResult => ({ operation, status: 'blocked' }));

  if (!isQueueRecoveryStrategy(analysis.strategy)) {
    return blockedApply(analysis, baseResults, 'Unsupported recovery strategy');
  }
  const repairActions = options.repairActions;
  const hasRepairActions = Array.isArray(repairActions) ? repairActions.length > 0 : repairActions !== undefined;
  const nonRepairableAnalysisBlockers = hasRepairActions
    ? analysis.blockers.filter((notice) => notice.code !== 'dispatch-preflight-blocked')
    : analysis.blockers;
  if (nonRepairableAnalysisBlockers.length > 0) {
    return blockedApply({ ...analysis, blockers: nonRepairableAnalysisBlockers }, baseResults, firstBlockerMessage(nonRepairableAnalysisBlockers));
  }

  const driftBlocker = await preflightApply(options, analysis.operations);
  if (driftBlocker) {
    return {
      selectedPrdId: analysis.selectedPrdId,
      strategy: analysis.strategy,
      applied: false,
      operationResults: baseResults.map((r) => ({ ...r, message: driftBlocker.message })),
      warnings: analysis.warnings,
      blockers: [driftBlocker],
      dispatchPreflight: analysis.dispatchPreflight,
      repairResults: [],
    };
  }

  const snapshot = await loadQueueSnapshot(options.cwd, options.queueDir);
  const targetIds = analysis.operations.filter((op) => op.kind === 'move-prd').map((op) => op.prdId);
  const [artifactRegistry, completionRegistry] = await Promise.all([loadArtifactRegistry(options.cwd), loadCompletionRegistry(options.cwd)]);
  const preflight = buildRecoveryPreflight({
    records: snapshot.records.map((record) => ({ id: record.id, title: record.title, location: record.location, dependsOn: record.dependsOn, ...(record.stackParent !== undefined && { stackParent: record.stackParent }), prd: record.prd })),
    targetIds,
    artifactRegistry,
    completionRegistry,
    stackingEnabled: options.stackingEnabled ?? true,
    repairActions,
    confirmDependencyRemoval: options.confirmDependencyRemoval === true,
  });
  const applyWarnings = replaceDispatchWarnings(analysis.warnings, analysis.dispatchPreflight?.warnings ?? [], preflight.dispatchPreflight.warnings);
  const repairBlocker = preflight.repairResults.find((result) => result.status !== 'applied');
  if (repairBlocker) {
    const notice = blocker('repair-action-blocked', repairBlocker.message ?? 'Repair action blocked', repairBlocker.action.targetPrdId);
    return { selectedPrdId: analysis.selectedPrdId, strategy: analysis.strategy, applied: false, operationResults: baseResults.map((r) => ({ ...r, message: notice.message })), warnings: applyWarnings, blockers: [notice], dispatchPreflight: preflight.dispatchPreflight, repairResults: simulatedRepairsBlocked(preflight.repairResults, notice.message) };
  }
  if (!preflight.dispatchPreflight.canApply) {
    const message = firstBlockerMessage(preflight.dispatchPreflight.blockers);
    return { selectedPrdId: analysis.selectedPrdId, strategy: analysis.strategy, applied: false, operationResults: baseResults.map((r) => ({ ...r, message })), warnings: applyWarnings, blockers: preflight.dispatchPreflight.blockers, dispatchPreflight: preflight.dispatchPreflight, repairResults: simulatedRepairsBlocked(preflight.repairResults, message) };
  }

  const metadataWrite = await writeRepairMetadata(snapshot, preflight.repairResults);
  if (metadataWrite.blocker) {
    const { blocker: metadataBlocker } = metadataWrite;
    return { selectedPrdId: analysis.selectedPrdId, strategy: analysis.strategy, applied: false, operationResults: baseResults.map((r) => ({ ...r, message: metadataBlocker.message })), warnings: applyWarnings, blockers: [metadataBlocker], dispatchPreflight: preflight.dispatchPreflight, repairResults: repairResultsAfterMetadataFailure(preflight.repairResults, metadataWrite.appliedActionKeys, metadataBlocker) };
  }

  const queueDir = resolve(options.cwd, options.queueDir ?? '.eforge/queue');
  const results: QueueRecoveryOperationResult[] = [];
  for (const operation of analysis.operations) {
    try {
      if (operation.kind === 'move-prd') {
        await ensureLocationDir(queueDir, operation.targetLocation!);
        await rename(locationPath(queueDir, operation.expectedSourceLocation, operation.prdId), locationPath(queueDir, operation.targetLocation!, operation.prdId));
      } else {
        await rm(resolve(queueDir, 'failed', `${operation.prdId}.recovery.md`), { force: true });
        await rm(resolve(queueDir, 'failed', `${operation.prdId}.recovery.json`), { force: true });
      }
      results.push({ operation, status: 'applied' });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      results.push({ operation, status: 'failed', message });
      for (const skipped of analysis.operations.slice(results.length)) {
        results.push({ operation: skipped, status: 'skipped', message: `Skipped because a prior operation failed: ${message}` });
      }
      break;
    }
  }

  const failedResult = results.find((r) => r.status === 'failed');
  const allApplied = analysis.operations.length > 0
    && results.length === analysis.operations.length
    && results.every((r) => r.status === 'applied');

  return {
    selectedPrdId: analysis.selectedPrdId,
    strategy: analysis.strategy,
    applied: allApplied,
    operationResults: results,
    warnings: applyWarnings,
    blockers: failedResult
      ? [blocker('operation-failed', failedResult.message ?? 'Queue recovery operation failed', failedResult.operation.prdId)]
      : [],
    dispatchPreflight: preflight.dispatchPreflight,
    repairResults: preflight.repairResults,
  };
}

async function loadQueueSnapshot(cwd: string, queueDirOpt: string | undefined): Promise<QueueSnapshot> {
  const queueDir = resolve(cwd, queueDirOpt ?? '.eforge/queue');
  const loaded = await Promise.all(LOCATIONS.map(async (location) => {
    const dir = location === 'queue' ? queueDir : resolve(queueDir, location);
    const prds = await loadQueue(dir, cwd);
    return prds.map((prd) => toRecord(prd, location));
  }));
  const records = loaded.flat();
  return { queueDir, records, byId: new Map(records.map((record) => [record.id, record])) };
}

function toRecord(prd: QueuedPrd, location: QueueRecoveryLocation): QueueRecord {
  return {
    id: prd.id,
    title: prd.frontmatter.title,
    location,
    dependsOn: prd.frontmatter.depends_on ?? [],
    ...(prd.frontmatter.stack_parent !== undefined && { stackParent: prd.frontmatter.stack_parent }),
    filePath: prd.filePath,
    prd,
  };
}

function findSkippedDescendants(selectedId: string, records: QueueRecord[]): string[] {
  const skipped = records.filter((r) => r.location === 'skipped');
  const found: string[] = [];
  const seen = new Set<string>([selectedId]);
  const queue = [selectedId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const record of skipped) {
      if (seen.has(record.id) || !record.dependsOn.includes(current)) continue;
      seen.add(record.id);
      found.push(record.id);
      queue.push(record.id);
    }
  }
  return found;
}

async function addDependencyBlockers(cwd: string, snapshot: QueueSnapshot, analyzedIds: Set<string>, blockers: QueueRecoveryNotice[]): Promise<void> {
  const [artifactRegistry, completionRegistry] = await Promise.all([
    loadArtifactRegistry(cwd),
    loadCompletionRegistry(cwd),
  ]);
  for (const record of snapshot.records) {
    if (!analyzedIds.has(record.id) || record.location !== 'skipped') continue;
    for (const dep of record.dependsOn) {
      if (analyzedIds.has(dep)) continue;
      const depRecord = snapshot.byId.get(dep);
      if (depRecord?.location === 'failed' || depRecord?.location === 'skipped') {
        blockers.push(blocker('outside-terminal-dependency', `Skipped descendant ${record.id} depends on terminal PRD ${dep}`, record.id));
      } else if (!depRecord) {
        const completion = lookupCompletion(completionRegistry, dep);
        const completedWithoutArtifact = completion?.status === 'completed' && !completion.artifactAvailable;
        if (completedWithoutArtifact || !hasUsableArtifact(artifactRegistry, dep)) {
          blockers.push(blocker('missing-or-unusable-dependency', `Skipped descendant ${record.id} depends on ${dep}, which has no usable artifact`, record.id));
        }
      }
    }
  }
}

async function buildOperations(cwd: string, snapshot: QueueSnapshot, selectedId: string, cascadeIds: string[]): Promise<QueueRecoveryOperation[]> {
  const artifactRegistry = await loadArtifactRegistry(cwd);
  const completionRegistry = await loadCompletionRegistry(cwd);
  const operations: QueueRecoveryOperation[] = [
    {
      id: `move:${selectedId}:failed-to-queue`,
      kind: 'move-prd',
      prdId: selectedId,
      expectedSourceLocation: 'failed',
      targetLocation: 'queue',
      reason: 'Retry the selected failed upstream PRD.',
    },
    {
      id: `remove-sidecars:${selectedId}`,
      kind: 'remove-recovery-sidecars',
      prdId: selectedId,
      expectedSourceLocation: 'failed',
      reason: 'Discard stale recovery sidecars after requeueing the selected PRD.',
    },
  ];

  for (const id of cascadeIds) {
    const targetLocation = shouldMoveSkippedToQueueRoot(snapshot, artifactRegistry, completionRegistry, id) ? 'queue' : 'waiting';
    operations.push({
      id: `move:${id}:skipped-to-${targetLocation}`,
      kind: 'move-prd',
      prdId: id,
      expectedSourceLocation: 'skipped',
      targetLocation,
      reason: targetLocation === 'queue'
        ? 'All dependencies have inactive usable artifacts; reactivate immediately.'
        : 'At least one dependency remains active or lacks a usable artifact; reactivate as waiting.',
    });
  }
  return operations;
}

function shouldMoveSkippedToQueueRoot(snapshot: QueueSnapshot, artifactRegistry: Awaited<ReturnType<typeof loadArtifactRegistry>>, completionRegistry: Awaited<ReturnType<typeof loadCompletionRegistry>>, id: string): boolean {
  const record = snapshot.byId.get(id);
  if (!record) return false;
  return record.dependsOn.every((dep) => {
    const depRecord = snapshot.byId.get(dep);
    if (depRecord) return false;
    const completion = lookupCompletion(completionRegistry, dep);
    if (completion?.status === 'completed' && !completion.artifactAvailable) return false;
    return hasUsableArtifact(artifactRegistry, dep);
  });
}

function buildNodes(snapshot: QueueSnapshot, selectedId: string, analyzedIds: Set<string>): QueueRecoveryNode[] {
  const nodes: QueueRecoveryNode[] = [];
  const pushed = new Set<string>();
  const push = (record: QueueRecord, role: QueueRecoveryNode['role']) => {
    if (pushed.has(record.id)) return;
    pushed.add(record.id);
    nodes.push({ id: record.id, title: record.title, location: record.location, status: record.location, dependsOn: record.dependsOn, role });
  };
  for (const id of analyzedIds) {
    const record = snapshot.byId.get(id);
    if (!record) continue;
    push(record, id === selectedId ? 'selected-failed-upstream' : 'skipped-descendant');
    for (const dep of record.dependsOn) {
      const depRecord = snapshot.byId.get(dep);
      if (!depRecord || analyzedIds.has(dep)) continue;
      if (depRecord.location === 'failed' || depRecord.location === 'skipped') push(depRecord, 'related-terminal');
      else push(depRecord, 'active-dependency');
    }
  }
  return nodes;
}

function buildEdges(snapshot: QueueSnapshot, analyzedIds: Set<string>): QueueRecoveryEdge[] {
  const terminalIds = new Set(snapshot.records.filter((r) => r.location === 'failed' || r.location === 'skipped').map((r) => r.id));
  const edges: QueueRecoveryEdge[] = [];
  for (const record of snapshot.records) {
    if (!analyzedIds.has(record.id)) continue;
    for (const dep of record.dependsOn) {
      if (analyzedIds.has(dep) || terminalIds.has(dep)) edges.push({ dependentId: record.id, dependencyId: dep });
    }
  }
  return edges;
}

async function preflightApply(options: ApplyQueueRecoveryOptions, currentOperations: QueueRecoveryOperation[]): Promise<QueueRecoveryNotice | null> {
  const expected = options.expectedOperations;
  if (!sameOperations(expected, currentOperations)) {
    return blocker('operation-drift', 'Queue recovery operations no longer match the latest analysis; refresh and retry.', options.selectedPrdId);
  }
  const queueDir = resolve(options.cwd, options.queueDir ?? '.eforge/queue');
  const queueGuard = await buildQueuePathGuard(queueDir);
  if ('message' in queueGuard) return queueGuard;
  for (const operation of expected) {
    if (!isSafePrdId(operation.prdId)) return blocker('unsafe-operation-prd-id', `Unsafe PRD id in operation ${operation.id}`, operation.prdId);
    const source = locationPath(queueDir, operation.expectedSourceLocation, operation.prdId);
    if (!isWithinQueue(queueDir, source)) return blocker('unsafe-source-path', `Operation ${operation.id} source escapes queue directory`, operation.prdId);
    if (!await exists(source)) return blocker('source-missing', `Operation ${operation.id} source is missing`, operation.prdId);
    if (!await realPathWithinQueue(queueGuard.realQueueDir, source)) return blocker('unsafe-source-path', `Operation ${operation.id} source escapes queue directory`, operation.prdId);
    if (operation.kind === 'move-prd') {
      const target = locationPath(queueDir, operation.targetLocation!, operation.prdId);
      if (!isWithinQueue(queueDir, target)) return blocker('unsafe-target-path', `Operation ${operation.id} target escapes queue directory`, operation.prdId);
      if (!await realParentWithinQueue(queueGuard.realQueueDir, target)) return blocker('unsafe-target-path', `Operation ${operation.id} target escapes queue directory`, operation.prdId);
      if (await exists(target)) return blocker('target-exists', `Operation ${operation.id} target already exists`, operation.prdId);
    } else {
      for (const sidecar of [resolve(queueDir, 'failed', `${operation.prdId}.recovery.md`), resolve(queueDir, 'failed', `${operation.prdId}.recovery.json`)]) {
        if (!isWithinQueue(queueDir, sidecar)) return blocker('unsafe-sidecar-path', `Operation ${operation.id} sidecar escapes queue directory`, operation.prdId);
        if (await exists(sidecar) && !await realPathWithinQueue(queueGuard.realQueueDir, sidecar)) return blocker('unsafe-sidecar-path', `Operation ${operation.id} sidecar escapes queue directory`, operation.prdId);
      }
    }
  }
  return null;
}

async function writeRepairMetadata(snapshot: QueueSnapshot, repairResults: QueueRecoveryRepairResult[]): Promise<{ blocker: QueueRecoveryNotice | null; appliedActionKeys: Set<string> }> {
  const appliedActionKeys = new Set<string>();
  for (const result of repairResults) {
    if (result.status !== 'applied' || !result.after) continue;
    const record = snapshot.byId.get(result.action.targetPrdId);
    if (!record) return { blocker: blocker('repair-target-missing', `Repair target ${result.action.targetPrdId} is missing`, result.action.targetPrdId), appliedActionKeys };
    try {
      const fields: Record<string, string | string[]> = {};
      if (result.after.dependsOn !== undefined) fields.depends_on = result.after.dependsOn;
      if (result.after.stackParent !== undefined) fields.stack_parent = result.after.stackParent;
      let updatedPrd = record.prd;
      if (Object.keys(fields).length > 0) updatedPrd = await setQueuedPrdFrontmatterFieldsExistingOnly(updatedPrd, fields);
      if (result.before?.stackParent !== undefined && result.after.stackParent === undefined) {
        await deleteQueuedPrdFrontmatterFieldsExistingOnly(updatedPrd, ['stack_parent']);
      }
      appliedActionKeys.add(repairActionKey(result));
    } catch (err) {
      return { blocker: blocker('repair-metadata-write-failed', err instanceof Error ? err.message : String(err), result.action.targetPrdId), appliedActionKeys };
    }
  }
  return { blocker: null, appliedActionKeys };
}

function simulatedRepairsBlocked(repairResults: QueueRecoveryRepairResult[], reason: string): QueueRecoveryRepairResult[] {
  return repairResults.map((result) => result.status === 'applied'
    ? { ...result, status: 'blocked', message: `Repair was only simulated; metadata was not written because apply is blocked: ${reason}` }
    : result);
}

function repairResultsAfterMetadataFailure(repairResults: QueueRecoveryRepairResult[], appliedActionKeys: Set<string>, failure: QueueRecoveryNotice): QueueRecoveryRepairResult[] {
  let failedRecorded = false;
  return repairResults.map((result) => {
    if (result.status !== 'applied' || appliedActionKeys.has(repairActionKey(result))) return result;
    if (!failedRecorded && result.action.targetPrdId === failure.prdId) {
      failedRecorded = true;
      return { ...result, status: 'failed', message: failure.message };
    }
    return { ...result, status: 'skipped', message: `Skipped because repair metadata was not durably written: ${failure.message}` };
  });
}

function repairActionKey(result: QueueRecoveryRepairResult): string {
  return JSON.stringify(result.action);
}

function sameOperations(a: QueueRecoveryOperation[], b: QueueRecoveryOperation[]): boolean {
  const sig = (op: QueueRecoveryOperation) => [op.id, op.kind, op.prdId, op.expectedSourceLocation, op.targetLocation ?? ''].join('|');
  return JSON.stringify(a.map(sig).sort()) === JSON.stringify(b.map(sig).sort());
}

function locationPath(queueDir: string, location: QueueRecoveryLocation, prdId: string): string {
  return location === 'queue' ? resolve(queueDir, `${prdId}.md`) : resolve(queueDir, location, `${prdId}.md`);
}

async function ensureLocationDir(queueDir: string, location: QueueRecoveryLocation): Promise<void> {
  await mkdir(location === 'queue' ? queueDir : resolve(queueDir, location), { recursive: true });
}

async function exists(path: string): Promise<boolean> {
  try { await access(path, constants.F_OK); return true; } catch { return false; }
}

function isSafePrdId(id: string): boolean {
  return id.length > 0 && !id.includes('/') && !id.includes('\\') && !id.includes('..') && !id.includes('\0');
}

function isWithinQueue(queueDir: string, candidate: string): boolean {
  const rel = relative(resolve(queueDir), resolve(candidate));
  return rel === '' || (!!rel && !rel.startsWith('..') && !isAbsolute(rel));
}

async function buildQueuePathGuard(queueDir: string): Promise<{ realQueueDir: string } | QueueRecoveryNotice> {
  for (const location of LOCATIONS) {
    const dir = location === 'queue' ? queueDir : resolve(queueDir, location);
    if (!await exists(dir)) continue;
    const stat = await lstat(dir);
    if (stat.isSymbolicLink()) return blocker('unsafe-queue-directory', `Queue recovery location ${location} must not be a symlink`);
  }
  const realQueueDir = await realpath(queueDir);
  for (const location of LOCATIONS) {
    const dir = location === 'queue' ? queueDir : resolve(queueDir, location);
    if (await exists(dir) && !isRealPathWithinQueue(realQueueDir, await realpath(dir))) {
      return blocker('unsafe-queue-directory', `Queue recovery location ${location} escapes queue directory`);
    }
  }
  return { realQueueDir };
}

async function realPathWithinQueue(realQueueDir: string, candidate: string): Promise<boolean> {
  return isRealPathWithinQueue(realQueueDir, await realpath(candidate));
}

async function realParentWithinQueue(realQueueDir: string, candidate: string): Promise<boolean> {
  let parent = dirname(candidate);
  while (!await exists(parent)) {
    const next = dirname(parent);
    if (next === parent) return false;
    parent = next;
  }
  return isRealPathWithinQueue(realQueueDir, await realpath(parent));
}

function isRealPathWithinQueue(realQueueDir: string, candidate: string): boolean {
  const rel = relative(realQueueDir, candidate);
  return rel === '' || (!!rel && !rel.startsWith('..') && !isAbsolute(rel));
}

async function readSidecarWarnings(queueDir: string, prdId: string): Promise<QueueRecoveryNotice[]> {
  try {
    const raw = await readFile(resolve(queueDir, 'failed', `${prdId}.recovery.json`), 'utf-8');
    const parsed = JSON.parse(raw) as { verdict?: { verdict?: unknown; confidence?: unknown } };
    const verdict = parsed.verdict;
    const warnings: QueueRecoveryNotice[] = [];
    if (verdict?.verdict === 'manual') warnings.push(warning('manual-sidecar', 'Recovery sidecar recommended manual handling; user-directed cascade repair can still proceed.', prdId));
    if (verdict?.confidence === 'low') warnings.push(warning('low-confidence-sidecar', 'Recovery sidecar confidence is low; user-directed cascade repair can still proceed.', prdId));
    return warnings;
  } catch {
    return [];
  }
}

function replaceDispatchWarnings(base: QueueRecoveryNotice[], previous: QueueRecoveryNotice[], next: QueueRecoveryNotice[]): QueueRecoveryNotice[] {
  const previousKeys = new Set(previous.map(noticeKey));
  return [...base.filter((notice) => !previousKeys.has(noticeKey(notice))), ...next];
}

function noticeKey(notice: QueueRecoveryNotice): string {
  return `${notice.code}\0${notice.prdId ?? ''}\0${notice.message}`;
}

function blockedApply(analysis: QueueRecoveryAnalyzeResponse, results: QueueRecoveryOperationResult[], message: string): QueueRecoveryApplyResponse {
  return {
    selectedPrdId: analysis.selectedPrdId,
    strategy: analysis.strategy,
    applied: false,
    operationResults: results.map((r) => ({ ...r, message })),
    warnings: analysis.warnings,
    blockers: analysis.blockers,
    dispatchPreflight: analysis.dispatchPreflight,
    repairResults: [],
  };
}

function emptyAnalyze(selectedPrdId: string, strategy: string, warnings: QueueRecoveryNotice[], blockers: QueueRecoveryNotice[]): QueueRecoveryAnalyzeResponse {
  return {
    selectedPrdId,
    strategy,
    eligible: false,
    nodes: [],
    edges: [],
    operations: [],
    warnings,
    blockers,
    dependencyClassifications: [],
    dispatchPreflight: emptyDispatchPreflight(blockers),
    availableRepairActions: [],
  };
}

function emptyDispatchPreflight(blockers: QueueRecoveryNotice[]) {
  return { canApply: false, blockers, warnings: [], items: [] };
}

function blocker(code: string, message: string, prdId?: string): QueueRecoveryNotice {
  return { code, message, ...(prdId !== undefined ? { prdId } : {}), severity: 'blocker' };
}

function warning(code: string, message: string, prdId?: string): QueueRecoveryNotice {
  return { code, message, ...(prdId !== undefined ? { prdId } : {}), severity: 'warning' };
}

function firstBlockerMessage(blockers: QueueRecoveryNotice[]): string {
  return blockers[0]?.message ?? 'Queue recovery is blocked';
}
