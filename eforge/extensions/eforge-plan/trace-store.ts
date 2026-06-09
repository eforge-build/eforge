import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, isAbsolute, relative, sep } from 'node:path';
import { createEforgeProjectPaths } from '../../../packages/extension-sdk/src/index.js';
import { assertSafeBacklogId } from './markdown-store.js';
import type { TraceSummary } from './backlog-domain.js';
// --- eforge:region plan-02-lifecycle-projections ---
import { projectTraceLifecycle } from './lifecycle-projection.js';
// --- eforge:endregion plan-02-lifecycle-projections ---
import type {
  TraceBuildRun,
  TraceBuildSession,
  TraceLandingResult,
  TraceLastEventMetadata,
  TracePromotedSessionPlan,
  TraceQueuePrd,
  TraceSidecar,
} from './schema.js';

export type {
  TraceBuildRun,
  TraceBuildSession,
  TraceLandingResult,
  TraceLastEventMetadata,
  TracePromotedSessionPlan,
  TraceQueuePrd,
  TraceSidecar,
} from './schema.js';

export const TRACE_SCHEMA_VERSION = 1;

// --- eforge:region types-path-helpers ---

export function resolveTracePath(cwd: string, itemId: string): string {
  assertSafeBacklogId(itemId);
  const paths = createEforgeProjectPaths({ cwd, extensionName: 'eforge-plan' });
  const root = paths.extensionStoragePath('project-local', ['traces']);
  const filePath = paths.extensionStoragePath('project-local', ['traces', `${itemId}.json`]);
  assertContained(root, filePath);
  return filePath;
}

export function createTraceSidecar(itemId: string, epicId?: string): TraceSidecar {
  assertSafeBacklogId(itemId);
  return {
    schemaVersion: TRACE_SCHEMA_VERSION,
    itemId,
    epicId,
    promotedSessionPlans: [],
    queuePrds: [],
    buildRuns: [],
    buildRunIds: [],
    buildSessions: [],
    buildSessionIds: [],
    landingResults: [],
  };
}

// --- eforge:endregion types-path-helpers ---

// --- eforge:region read-write-helpers ---

export async function readTraceSidecar(cwd: string, itemId: string): Promise<TraceSidecar | null> {
  const filePath = resolveTracePath(cwd, itemId);
  if (!existsSync(filePath)) {
    return null;
  }
  return normalizeTrace(JSON.parse(await readFile(filePath, 'utf-8')) as unknown, itemId);
}

export async function writeTraceSidecar(cwd: string, trace: TraceSidecar): Promise<TraceSidecar> {
  const normalized = normalizeTrace(trace, trace.itemId);
  const filePath = resolveTracePath(cwd, normalized.itemId);
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(normalized, null, 2)}\n`);
  return normalized;
}

export async function listTraceSidecars(cwd: string): Promise<TraceSidecar[]> {
  const paths = createEforgeProjectPaths({ cwd, extensionName: 'eforge-plan' });
  const root = paths.extensionStoragePath('project-local', ['traces']);
  if (!existsSync(root)) {
    return [];
  }
  const names = (await readdir(root)).filter((name) => name.endsWith('.json')).sort();
  return Promise.all(names.map(async (name) => {
    const filePath = paths.extensionStoragePath('project-local', ['traces', name]);
    assertContained(root, filePath);
    return normalizeTrace(JSON.parse(await readFile(filePath, 'utf-8')) as unknown, name.slice(0, -'.json'.length));
  }));
}

// --- eforge:endregion read-write-helpers ---

// --- eforge:region upsert-helpers ---

export async function upsertPromotedSessionPlan(
  cwd: string,
  itemId: string,
  entry: TracePromotedSessionPlan,
  epicId?: string,
): Promise<TraceSidecar> {
  return updateTrace(cwd, itemId, epicId, (trace) => {
    trace.promotedSessionPlans = upsertBy(trace.promotedSessionPlans, entry, (candidate) => candidate.session === entry.session);
  });
}

export async function upsertQueuePrd(
  cwd: string,
  itemId: string,
  entry: TraceQueuePrd,
  epicId?: string,
): Promise<TraceSidecar> {
  return updateTrace(cwd, itemId, epicId, (trace) => {
    trace.queuePrds = upsertBy(trace.queuePrds, entry, (candidate) => candidate.prdId === entry.prdId);
  });
}

export async function upsertBuildRun(
  cwd: string,
  itemId: string,
  entry: TraceBuildRun,
  epicId?: string,
): Promise<TraceSidecar> {
  return updateTrace(cwd, itemId, epicId, (trace) => {
    trace.buildRuns = upsertBy(trace.buildRuns, entry, (candidate) => candidate.runId === entry.runId || candidate.sessionId === entry.sessionId);
    trace.buildRunIds = uniqueStrings(trace.buildRuns.map((candidate) => candidate.runId));
    trace.buildSessionIds = uniqueStrings([
      ...trace.buildRuns.map((candidate) => candidate.sessionId),
      ...trace.buildSessions.map((candidate) => candidate.sessionId),
    ]);
  });
}

export async function upsertBuildSession(
  cwd: string,
  itemId: string,
  entry: TraceBuildSession,
  epicId?: string,
): Promise<TraceSidecar> {
  return updateTrace(cwd, itemId, epicId, (trace) => {
    trace.buildSessions = upsertBy(trace.buildSessions, entry, (candidate) => candidate.sessionId === entry.sessionId);
    trace.buildSessionIds = uniqueStrings([
      ...trace.buildRuns.map((candidate) => candidate.sessionId),
      ...trace.buildSessions.map((candidate) => candidate.sessionId),
    ]);
  });
}

export async function upsertLandingResult(
  cwd: string,
  itemId: string,
  entry: TraceLandingResult,
  epicId?: string,
): Promise<TraceSidecar> {
  assertLandingResultKey(entry);
  return updateTrace(cwd, itemId, epicId, (trace) => {
    trace.landingResults = upsertBy(trace.landingResults, entry, (candidate) => sameLandingResult(candidate, entry));
  });
}

export async function updateLastEventMetadata(
  cwd: string,
  itemId: string,
  lastEvent: TraceLastEventMetadata,
  epicId?: string,
): Promise<TraceSidecar> {
  return updateTrace(cwd, itemId, epicId, (trace) => {
    trace.lastEvent = lastEvent;
  });
}

// --- eforge:endregion upsert-helpers ---

// --- eforge:region summary-helpers ---

export function summarizeTrace(trace: TraceSidecar | null | undefined): TraceSummary | undefined {
  if (!trace) {
    return undefined;
  }
  const activeReasons = [
    ...trace.promotedSessionPlans.filter(isActiveEntry).map((entry) => `active session-plan trace ${entry.session}`),
    ...trace.queuePrds.filter(isActiveEntry).map((entry) => `active queue trace ${entry.prdId}`),
    ...trace.buildRuns.filter(isActiveEntry).map((entry) => `active build run trace ${entry.runId}`),
    ...trace.buildSessions.filter(isActiveEntry).map((entry) => `active build session trace ${entry.sessionId}`),
  ];
  // --- eforge:region plan-02-lifecycle-projections ---
  const lifecycle = projectTraceLifecycle(trace);
  // --- eforge:endregion plan-02-lifecycle-projections ---
  return {
    itemId: trace.itemId,
    epicId: trace.epicId,
    hasActiveSessionPlan: trace.promotedSessionPlans.some(isActiveEntry),
    hasActiveQueuePrd: trace.queuePrds.some(isActiveEntry),
    hasActiveBuildRun: trace.buildRuns.some(isActiveEntry),
    hasActiveBuildSession: trace.buildSessions.some(isActiveEntry),
    hasActiveTrace: activeReasons.length > 0,
    activeReasons,
    lastEvent: trace.lastEvent,
    // --- eforge:region plan-02-lifecycle-projections ---
    ...lifecycle,
    // --- eforge:endregion plan-02-lifecycle-projections ---
  };
}

// --- eforge:endregion summary-helpers ---

// --- eforge:region normalization-utilities ---

async function updateTrace(
  cwd: string,
  itemId: string,
  epicId: string | undefined,
  update: (trace: TraceSidecar) => void,
): Promise<TraceSidecar> {
  const trace = (await readTraceSidecar(cwd, itemId)) ?? createTraceSidecar(itemId, epicId);
  if (epicId !== undefined) {
    trace.epicId = epicId;
  }
  update(trace);
  return writeTraceSidecar(cwd, trace);
}

function normalizeTrace(value: unknown, expectedItemId: string): TraceSidecar {
  const record = asRecord(value);
  const storedItemId = stringOrUndefined(record.itemId);
  if (storedItemId !== undefined && storedItemId !== expectedItemId) {
    throw new Error(`Trace sidecar itemId mismatch: expected ${expectedItemId}, found ${storedItemId}`);
  }
  assertSafeBacklogId(expectedItemId);
  const promotedSessionPlans = arrayOfRecords(record.promotedSessionPlans).flatMap(normalizePromotedSessionPlan);
  const queuePrds = arrayOfRecords(record.queuePrds).flatMap(normalizeQueuePrd);
  const buildRuns = arrayOfRecords(record.buildRuns).flatMap(normalizeBuildRun);
  const buildSessions = arrayOfRecords(record.buildSessions).flatMap(normalizeBuildSession);
  const landingResults = arrayOfRecords(record.landingResults).flatMap(normalizeLandingResult);
  return {
    schemaVersion: TRACE_SCHEMA_VERSION,
    itemId: expectedItemId,
    epicId: stringOrUndefined(record.epicId),
    promotedSessionPlans,
    queuePrds,
    buildRuns,
    buildRunIds: stringArray(record.buildRunIds, buildRuns.map((entry) => entry.runId)),
    buildSessions,
    buildSessionIds: stringArray(record.buildSessionIds, [
      ...buildRuns.map((entry) => entry.sessionId),
      ...buildSessions.map((entry) => entry.sessionId),
    ]),
    landingResults,
    lastEvent: normalizeLastEventMetadata(record.lastEvent),
  };
}

function normalizePromotedSessionPlan(record: Record<string, unknown>): TracePromotedSessionPlan[] {
  const session = stringOrUndefined(record.session);
  return session ? [{ session, ...optionalTraceFields(record, ['path', 'status', 'promotedAt']) }] : [];
}

function normalizeQueuePrd(record: Record<string, unknown>): TraceQueuePrd[] {
  const prdId = stringOrUndefined(record.prdId);
  return prdId ? [{ prdId, ...optionalTraceFields(record, ['path', 'status', 'queuedAt']) }] : [];
}

function normalizeBuildRun(record: Record<string, unknown>): TraceBuildRun[] {
  const runId = stringOrUndefined(record.runId);
  const sessionId = stringOrUndefined(record.sessionId);
  return runId && sessionId ? [{ runId, sessionId, ...optionalTraceFields(record, ['status', 'startedAt', 'completedAt']) }] : [];
}

function normalizeBuildSession(record: Record<string, unknown>): TraceBuildSession[] {
  const sessionId = stringOrUndefined(record.sessionId);
  return sessionId ? [{ sessionId, ...optionalTraceFields(record, ['runId', 'status', 'startedAt', 'completedAt']) }] : [];
}

function normalizeLandingResult(record: Record<string, unknown>): TraceLandingResult[] {
  const status = stringOrUndefined(record.status);
  const featureBranch = stringOrUndefined(record.featureBranch);
  const commitSha = stringOrUndefined(record.commitSha);
  if (!status || (!featureBranch && !commitSha)) {
    return [];
  }
  const landedAt = stringOrUndefined(record.landedAt);
  const prUrl = stringOrUndefined(record.prUrl);
  if (featureBranch) {
    return [{ status, featureBranch, ...(commitSha ? { commitSha } : {}), ...(landedAt ? { landedAt } : {}), ...(prUrl ? { prUrl } : {}) }];
  }
  return commitSha ? [{ status, commitSha, ...(landedAt ? { landedAt } : {}), ...(prUrl ? { prUrl } : {}) }] : [];
}

function normalizeLastEventMetadata(value: unknown): TraceLastEventMetadata | undefined {
  const record = asRecord(value);
  const lastEvent = {
    ...optionalTraceFields(record, ['type', 'timestamp', 'sessionId', 'runId', 'source', 'filePath', 'path', 'id']),
    ...(typeof record.cursor === 'number' && Number.isFinite(record.cursor) ? { cursor: record.cursor } : {}),
  };
  return Object.keys(lastEvent).length > 0 ? lastEvent : undefined;
}

function optionalTraceFields(record: Record<string, unknown>, keys: string[]): Record<string, string> {
  return Object.fromEntries(keys.flatMap((key) => {
    const value = stringOrUndefined(record[key]);
    return value ? [[key, value]] : [];
  }));
}

function uniqueStrings(entries: string[]): string[] {
  return [...new Set(entries.filter((entry) => entry.length > 0))];
}

function upsertBy<T extends object>(entries: T[], entry: T, match: (candidate: T) => boolean): T[] {
  const index = entries.findIndex(match);
  if (index === -1) {
    return [...entries, entry];
  }
  const copy = [...entries];
  copy[index] = { ...copy[index], ...entry };
  return copy;
}

function assertLandingResultKey(entry: TraceLandingResult): void {
  if (!entry.featureBranch && !entry.commitSha) {
    throw new Error('Trace landing result must include featureBranch or commitSha');
  }
}

function sameLandingResult(candidate: TraceLandingResult, entry: TraceLandingResult): boolean {
  if (entry.featureBranch && candidate.featureBranch === entry.featureBranch) {
    return true;
  }
  return Boolean(entry.commitSha && candidate.commitSha === entry.commitSha);
}

function isActiveEntry(entry: { status?: string; completedAt?: string }): boolean {
  if (entry.completedAt) {
    return false;
  }
  if (!entry.status) {
    return true;
  }
  return !['completed', 'cancelled', 'canceled', 'failed', 'landed', 'shipped', 'skipped', 'superseded', 'stale'].includes(entry.status);
}

function assertContained(root: string, filePath: string): void {
  const rel = relative(root, filePath);
  if (rel === '' || rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) {
    throw new Error(`Resolved trace path "${filePath}" escapes ${root}${sep}`);
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function arrayOfRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(asRecord) : [];
}

function stringArray(value: unknown, fallback: unknown[]): string[] {
  const source = Array.isArray(value) ? value : fallback;
  return uniqueStrings(source.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0));
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

// --- eforge:endregion normalization-utilities ---
