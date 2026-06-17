import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createEforgeProjectPaths } from '@eforge-build/extension-sdk';
import { safeParseWithSchema } from '@eforge-build/client';
import { MAX_PLAN_REVISION_ANNOTATIONS_PER_SESSION, PlanRevisionIndexSchema, type PlanRevisionAnnotation, type PlanRevisionAnnotationTarget, type PlanRevisionIndex, type PlanRevisionSessionEntry, type PlanRevisionTurnEntry } from './planning-agent-task-schemas.js';
import { referencedAnnotationIds } from './plan-revision-annotations.js';
import { userActionError } from './action-errors.js';

const EXTENSION_NAME = 'eforge-plan';
const INDEX_SEGMENTS = ['plan-revisions', 'index.json'] as const;
const indexWriteChains = new Map<string, Promise<unknown>>();
let tempWriteSequence = 0;

function runExclusive<T>(key: string, task: () => Promise<T>): Promise<T> {
  const prior = indexWriteChains.get(key) ?? Promise.resolve();
  const result = prior.then(task, task);
  let chain: Promise<unknown>;
  chain = result.then(() => undefined, () => undefined).finally(() => {
    if (indexWriteChains.get(key) === chain) indexWriteChains.delete(key);
  });
  indexWriteChains.set(key, chain);
  return result;
}

export function resolvePlanRevisionIndexPath(cwd: string): string {
  return createEforgeProjectPaths({ cwd, extensionName: EXTENSION_NAME }).extensionStoragePath('project-local', [...INDEX_SEGMENTS]);
}

function emptyIndex(): PlanRevisionIndex {
  return { schemaVersion: 1, sessions: [] };
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

export async function readPlanRevisionIndex(cwd: string): Promise<PlanRevisionIndex> {
  let raw: string;
  try {
    raw = await readFile(resolvePlanRevisionIndexPath(cwd), 'utf-8');
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return emptyIndex();
    throw error;
  }
  try {
    const normalized = normalizeIndexForRead(JSON.parse(raw));
    const result = safeParseWithSchema(PlanRevisionIndexSchema, normalized);
    return result.success ? orderIndex(result.data) : emptyIndex();
  } catch {
    return emptyIndex();
  }
}

export async function ensurePlanRevisionSession(cwd: string, targetSession: string, now = new Date().toISOString()): Promise<PlanRevisionSessionEntry> {
  const path = resolvePlanRevisionIndexPath(cwd);
  return runExclusive(path, async () => {
    const index = await readPlanRevisionIndex(cwd);
    const existing = index.sessions.find((session) => session.targetSession === targetSession);
    if (existing !== undefined) return existing;
    const created: PlanRevisionSessionEntry = { threadId: randomUUID(), targetSession, turns: [], annotations: [], createdAt: now, updatedAt: now };
    await writePlanRevisionIndex(cwd, { schemaVersion: 1, sessions: [...index.sessions, created] });
    return created;
  });
}

export async function recordPlanRevisionTurn(cwd: string, targetSession: string, turn: PlanRevisionTurnEntry): Promise<PlanRevisionTurnEntry> {
  const path = resolvePlanRevisionIndexPath(cwd);
  return runExclusive(path, async () => {
    const index = await readPlanRevisionIndex(cwd);
    const session = index.sessions.find((candidate) => candidate.targetSession === targetSession);
    if (session === undefined) throw new Error(`No plan revision session found for ${targetSession}.`);
    const turns = session.turns.filter((existing) => existing.turnId !== turn.turnId && existing.taskId !== turn.taskId);
    turns.push(turn);
    const updated = { ...session, turns: orderTurns(turns), updatedAt: turn.createdAt };
    await writePlanRevisionIndex(cwd, { schemaVersion: 1, sessions: index.sessions.map((candidate) => candidate.threadId === session.threadId ? updated : candidate) });
    return turn;
  });
}

export async function markPlanRevisionTurnApplied(cwd: string, targetSession: string, turnRef: { turnId?: string; taskId?: string }, appliedAt: string, appliedSections: string[], options: { resolveReferencedAnnotations?: boolean } = {}): Promise<PlanRevisionTurnEntry> {
  const path = resolvePlanRevisionIndexPath(cwd);
  return runExclusive(path, async () => {
    const index = await readPlanRevisionIndex(cwd);
    const session = index.sessions.find((candidate) => candidate.targetSession === targetSession);
    if (session === undefined) throw new Error(`No plan revision session found for ${targetSession}.`);
    const turn = findPlanRevisionTurn(session, turnRef);
    if (turn === undefined) throw new Error(`No plan revision turn found for ${targetSession}.`);
    const updatedTurn = { ...turn, appliedAt, appliedSections: uniqueSorted([...(turn.appliedSections ?? []), ...appliedSections]) };
    const resolveIds = options.resolveReferencedAnnotations === true ? new Set(referencedAnnotationIds(turn.annotationSnapshot)) : new Set<string>();
    const annotations = orderAnnotations(session.annotations.map((annotation) => {
      if (!resolveIds.has(annotation.annotationId) || annotation.resolvedAt !== undefined || annotation.dismissedAt !== undefined) return annotation;
      return { ...annotation, resolvedAt: appliedAt, resolvedByTurnId: turn.turnId, updatedAt: appliedAt };
    }));
    const updated = { ...session, turns: orderTurns(session.turns.map((candidate) => candidate.turnId === turn.turnId ? updatedTurn : candidate)), annotations, updatedAt: appliedAt };
    await writePlanRevisionIndex(cwd, { schemaVersion: 1, sessions: index.sessions.map((candidate) => candidate.threadId === session.threadId ? updated : candidate) });
    return updatedTurn;
  });
}

export async function createPlanRevisionAnnotation(cwd: string, targetSession: string, input: { body?: string; target: PlanRevisionAnnotationTarget }, now = new Date().toISOString()): Promise<PlanRevisionAnnotation> {
  const path = resolvePlanRevisionIndexPath(cwd);
  return runExclusive(path, async () => {
    const index = await readPlanRevisionIndex(cwd);
    const session = index.sessions.find((candidate) => candidate.targetSession === targetSession);
    if (session === undefined) throw new Error(`No plan revision session found for ${targetSession}.`);
    if (session.annotations.length >= MAX_PLAN_REVISION_ANNOTATIONS_PER_SESSION) throw userActionError(`Plan revision session ${targetSession} already has the maximum ${MAX_PLAN_REVISION_ANNOTATIONS_PER_SESSION} annotations.`, { path: 'session', details: { session: targetSession, max: MAX_PLAN_REVISION_ANNOTATIONS_PER_SESSION } });
    const annotation: PlanRevisionAnnotation = { annotationId: randomUUID(), targetSession, ...(input.body !== undefined && { body: input.body }), target: input.target, createdAt: now, updatedAt: now };
    const updated = { ...session, annotations: orderAnnotations([...session.annotations, annotation]), updatedAt: now };
    await writePlanRevisionIndex(cwd, { schemaVersion: 1, sessions: index.sessions.map((candidate) => candidate.threadId === session.threadId ? updated : candidate) });
    return annotation;
  });
}

export async function updatePlanRevisionAnnotation(cwd: string, targetSession: string, annotationId: string, patch: { body?: string; target?: PlanRevisionAnnotationTarget }, now = new Date().toISOString()): Promise<PlanRevisionAnnotation> {
  return mutateAnnotation(cwd, targetSession, annotationId, now, (annotation) => ({ ...annotation, ...(patch.body !== undefined && { body: patch.body }), ...(patch.target !== undefined && { target: patch.target }), updatedAt: now }));
}

export async function deletePlanRevisionAnnotation(cwd: string, targetSession: string, annotationId: string): Promise<void> {
  const path = resolvePlanRevisionIndexPath(cwd);
  await runExclusive(path, async () => {
    const index = await readPlanRevisionIndex(cwd);
    const session = index.sessions.find((candidate) => candidate.targetSession === targetSession);
    if (session === undefined) throw new Error(`No plan revision session found for ${targetSession}.`);
    if (!session.annotations.some((annotation) => annotation.annotationId === annotationId)) throw new Error(`No plan revision annotation found for ${targetSession}.`);
    const updated = { ...session, annotations: session.annotations.filter((annotation) => annotation.annotationId !== annotationId), updatedAt: new Date().toISOString() };
    await writePlanRevisionIndex(cwd, { schemaVersion: 1, sessions: index.sessions.map((candidate) => candidate.threadId === session.threadId ? updated : candidate) });
  });
}

export async function resolvePlanRevisionAnnotation(cwd: string, targetSession: string, annotationId: string, now = new Date().toISOString()): Promise<PlanRevisionAnnotation> {
  return mutateAnnotation(cwd, targetSession, annotationId, now, (annotation) => annotation.resolvedAt === undefined ? { ...annotation, resolvedAt: now, updatedAt: now } : annotation);
}

export async function dismissPlanRevisionAnnotation(cwd: string, targetSession: string, annotationId: string, now = new Date().toISOString()): Promise<PlanRevisionAnnotation> {
  return mutateAnnotation(cwd, targetSession, annotationId, now, (annotation) => annotation.dismissedAt === undefined ? { ...annotation, dismissedAt: now, updatedAt: now } : annotation);
}

export function findPlanRevisionSession(index: PlanRevisionIndex, ref: { session?: string; threadId?: string }): PlanRevisionSessionEntry | undefined {
  return index.sessions.find((entry) => (ref.session !== undefined && entry.targetSession === ref.session) || (ref.threadId !== undefined && entry.threadId === ref.threadId));
}

export function findPlanRevisionTurn(session: PlanRevisionSessionEntry, ref: { turnId?: string; taskId?: string }): PlanRevisionTurnEntry | undefined {
  return session.turns.find((entry) => (ref.turnId !== undefined && entry.turnId === ref.turnId) || (ref.taskId !== undefined && entry.taskId === ref.taskId));
}

export function listPlanRevisionSessions(index: PlanRevisionIndex, options: { includeDismissed?: boolean } = {}): PlanRevisionSessionEntry[] {
  const sessions = orderIndex(index).sessions;
  return options.includeDismissed === true ? sessions : sessions.filter((session) => session.dismissedAt === undefined);
}

async function writePlanRevisionIndex(cwd: string, index: PlanRevisionIndex): Promise<void> {
  const path = resolvePlanRevisionIndexPath(cwd);
  await mkdir(dirname(path), { recursive: true });
  const tempPath = `${path}.${process.pid}.${tempWriteSequence++}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(orderIndex(index), null, 2)}\n`, 'utf-8');
  await rename(tempPath, path);
}

function orderIndex(index: PlanRevisionIndex): PlanRevisionIndex {
  return { schemaVersion: 1, sessions: [...index.sessions].sort(compareSessions).map((session) => ({ ...session, turns: orderTurns(session.turns), annotations: orderAnnotations(session.annotations) })) };
}

function orderTurns(turns: PlanRevisionTurnEntry[]): PlanRevisionTurnEntry[] {
  return [...turns].sort((a, b) => {
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
    return a.turnId.localeCompare(b.turnId);
  });
}

function compareSessions(a: PlanRevisionSessionEntry, b: PlanRevisionSessionEntry): number {
  if (a.updatedAt !== b.updatedAt) return a.updatedAt < b.updatedAt ? 1 : -1;
  return a.threadId.localeCompare(b.threadId);
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}


function normalizeIndexForRead(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return emptyIndex();
  const record = value as { schemaVersion?: unknown; sessions?: unknown };
  if (record.schemaVersion !== 1 || !Array.isArray(record.sessions)) return emptyIndex();
  return { ...record, sessions: record.sessions.map((session) => session !== null && typeof session === 'object' && !Array.isArray(session) ? { annotations: [], ...session } : session) };
}

function orderAnnotations(annotations: PlanRevisionAnnotation[]): PlanRevisionAnnotation[] {
  return [...annotations].sort((a, b) => {
    if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
    return a.annotationId.localeCompare(b.annotationId);
  });
}

async function mutateAnnotation(cwd: string, targetSession: string, annotationId: string, now: string, mutate: (annotation: PlanRevisionAnnotation) => PlanRevisionAnnotation): Promise<PlanRevisionAnnotation> {
  const path = resolvePlanRevisionIndexPath(cwd);
  return runExclusive(path, async () => {
    const index = await readPlanRevisionIndex(cwd);
    const session = index.sessions.find((candidate) => candidate.targetSession === targetSession);
    if (session === undefined) throw new Error(`No plan revision session found for ${targetSession}.`);
    let updatedAnnotation: PlanRevisionAnnotation | undefined;
    const annotations = orderAnnotations(session.annotations.map((annotation) => {
      if (annotation.annotationId !== annotationId) return annotation;
      updatedAnnotation = mutate(annotation);
      return updatedAnnotation;
    }));
    if (updatedAnnotation === undefined) throw new Error(`No plan revision annotation found for ${targetSession}.`);
    const updated = { ...session, annotations, updatedAt: now };
    await writePlanRevisionIndex(cwd, { schemaVersion: 1, sessions: index.sessions.map((candidate) => candidate.threadId === session.threadId ? updated : candidate) });
    return updatedAnnotation;
  });
}
