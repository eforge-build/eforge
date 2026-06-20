import { createHash } from 'node:crypto';
import { access, lstat, readdir, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { basename, relative, resolve, sep } from 'node:path';
import type { QueueControlLocation, QueueControlStatus } from '@eforge-build/client';
import { loadQueue, readPrdLockStatus, releasePrd, type PrdFrontmatter, type PrdLockStatus, type QueuedPrd } from '../prd-queue.js';
import { QueueControlError } from './control.js';

export type QueueControlLockClassification =
  | { state: 'absent' }
  | { state: 'live'; pid: number }
  | { state: 'stale'; pid: number }
  | { state: 'corrupt' };

export interface QueueControlRecord {
  id: string;
  title: string;
  location: QueueControlLocation;
  status: QueueControlStatus;
  dependsOn: string[];
  filePath: string;
  frontmatter: PrdFrontmatter;
  content: string;
  prd: QueuedPrd;
  lock?: QueueControlLockClassification;
  hold?: { held: boolean; reason?: string; heldAt?: string };
}

export interface QueueControlSnapshot {
  queueDir: string;
  records: QueueControlRecord[];
  byId: Map<string, QueueControlRecord>;
  duplicates: Map<string, QueueControlRecord[]>;
  orderedIds: string[];
}

export interface CascadeDependent {
  record: QueueControlRecord;
  depth: number;
}

export function assertSafePrdId(id: string): void {
  const safe = id.length > 0 && !id.includes('/') && !id.includes('\\') && !id.includes('..') && !id.includes('\0');
  if (!safe) throw new QueueControlError('validation', `Unsafe PRD id: ${JSON.stringify(id)}`);
}

export function locationDirectory(absQueueDir: string, location: QueueControlLocation): string {
  return location === 'queue' ? absQueueDir : resolve(absQueueDir, location);
}

export function assertPathUnderQueue(absQueueDir: string, path: string): void {
  const root = resolve(absQueueDir);
  const abs = resolve(path);
  const rel = relative(root, abs);
  if (rel === '' || rel.startsWith('..') || rel.includes(`..${sep}`) || resolve(root, rel) !== abs) {
    throw new QueueControlError('validation', `Queue path escapes queue root: ${path}`);
  }
}

function assertRealPathUnderQueue(realQueueDir: string, realTarget: string): void {
  const rel = relative(realQueueDir, realTarget);
  if (rel === '' || rel.startsWith('..') || rel.includes(`..${sep}`) || resolve(realQueueDir, rel) !== realTarget) {
    throw new QueueControlError('validation', `Queue path escapes queue root: ${realTarget}`);
  }
}

export async function assertQueueRecordStillAtExpectedPath(record: QueueControlRecord, absQueueDir?: string): Promise<void> {
  try {
    const entry = await lstat(record.filePath);
    if (entry.isSymbolicLink()) throw new QueueControlError('validation', `Queue item '${record.id}' is a symlink and cannot be mutated: ${record.filePath}`);
    await access(record.filePath, constants.F_OK);
    if (absQueueDir !== undefined) {
      const [realQueueDir, realTarget] = await Promise.all([realpath(absQueueDir), realpath(record.filePath)]);
      assertRealPathUnderQueue(realQueueDir, realTarget);
    }
  } catch (err) {
    if (err instanceof QueueControlError) throw err;
    throw new QueueControlError('conflict', `Queue item '${record.id}' changed location or disappeared before mutation; expected '${record.filePath}'.`);
  }
}

function statusFor(location: QueueControlLocation, lock?: PrdLockStatus): QueueControlStatus {
  if (location === 'queue' && lock?.state === 'live') return 'running';
  if (location === 'queue') return 'pending';
  return location;
}

async function loadLocation(cwd: string, absQueueDir: string, location: QueueControlLocation, classifyRootLocks: 'read-only' | 'mutation'): Promise<QueueControlRecord[]> {
  const absDir = locationDirectory(absQueueDir, location);
  let prds: QueuedPrd[];
  try {
    await readdir(absDir);
    prds = await loadQueue(absDir, cwd);
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') return [];
    throw new QueueControlError('conflict', `Queue directory '${absDir}' could not be read: ${err instanceof Error ? err.message : String(err)}`);
  }
  const records: QueueControlRecord[] = [];
  for (const prd of prds) {
    assertSafePrdId(prd.id);
    assertPathUnderQueue(absQueueDir, prd.filePath);
    if (classifyRootLocks === 'mutation') await assertQueueRecordStillAtExpectedPath({ id: prd.id, filePath: prd.filePath } as QueueControlRecord, absQueueDir);
    let lock: PrdLockStatus | undefined;
    if (location === 'queue') {
      lock = await readPrdLockStatus(prd.id, cwd);
      if (classifyRootLocks === 'mutation' && (lock.state === 'stale' || lock.state === 'corrupt')) {
        await releasePrd(prd.id, cwd);
        lock = await readPrdLockStatus(prd.id, cwd);
      }
    }
    const held = prd.frontmatter.held === true;
    records.push({
      id: prd.id,
      title: prd.frontmatter.title ?? prd.id,
      location,
      status: statusFor(location, lock),
      dependsOn: prd.frontmatter.depends_on ?? [],
      filePath: prd.filePath,
      frontmatter: prd.frontmatter,
      content: prd.content,
      prd,
      ...(lock ? { lock } : {}),
      ...(held ? { hold: { held: true, ...(prd.frontmatter.hold_reason ? { reason: prd.frontmatter.hold_reason } : {}), ...(prd.frontmatter.held_at ? { heldAt: prd.frontmatter.held_at } : {}) } } : {}),
    });
  }
  return records;
}

export async function loadQueueControlSnapshot(options: { cwd: string; queueDir: string; classifyRootLocks: 'read-only' | 'mutation' }): Promise<QueueControlSnapshot> {
  const absQueueDir = resolve(options.cwd, options.queueDir);
  const locations: QueueControlLocation[] = ['queue', 'waiting', 'failed', 'skipped'];
  const records = (await Promise.all(locations.map((loc) => loadLocation(options.cwd, absQueueDir, loc, options.classifyRootLocks)))).flat();
  records.sort((a, b) => a.location.localeCompare(b.location) || a.filePath.localeCompare(b.filePath) || a.id.localeCompare(b.id));
  const grouped = new Map<string, QueueControlRecord[]>();
  for (const record of records) grouped.set(record.id, [...(grouped.get(record.id) ?? []), record]);
  const byId = new Map<string, QueueControlRecord>();
  const duplicates = new Map<string, QueueControlRecord[]>();
  for (const [id, group] of grouped) {
    if (group.length === 1) byId.set(id, group[0]!);
    else duplicates.set(id, group);
  }
  return { queueDir: absQueueDir, records, byId, duplicates, orderedIds: records.map((r) => r.id).sort() };
}

export function findCascadeDependents(targetId: string, records: QueueControlRecord[]): CascadeDependent[] {
  const byUpstream = new Map<string, QueueControlRecord[]>();
  for (const record of records) {
    for (const dep of record.dependsOn) byUpstream.set(dep, [...(byUpstream.get(dep) ?? []), record]);
  }
  const result: CascadeDependent[] = [];
  const seen = new Set<string>();
  const queue: CascadeDependent[] = (byUpstream.get(targetId) ?? []).map((record) => ({ record, depth: 1 }));
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (seen.has(current.record.id)) continue;
    seen.add(current.record.id);
    result.push(current);
    for (const child of byUpstream.get(current.record.id) ?? []) queue.push({ record: child, depth: current.depth + 1 });
  }
  return result.sort((a, b) => a.depth - b.depth || a.record.id.localeCompare(b.record.id));
}

export function buildCascadeExpectedAffected(target: QueueControlRecord, dependents: CascadeDependent[], operation: 'remove' | 'cancel'): { token: string; prdIds: string[] } {
  const affected = [target, ...dependents.map((d) => d.record)];
  const prdIds = affected.map((r) => r.id);
  const payload = {
    operation,
    affected: affected.map((r) => ({
      id: r.id,
      location: r.location,
      status: r.status,
      dependsOn: [...r.dependsOn].sort(),
      basename: basename(r.filePath),
      held: r.frontmatter.held === true,
      lock: r.lock?.state ?? 'none',
    })),
  };
  const token = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  return { token, prdIds };
}
