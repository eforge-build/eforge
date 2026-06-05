import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { parseWithSchema, type QueueItem } from '@eforge-build/client';
import { recoveryVerdictSchema } from '@eforge-build/engine/schemas';
import { parseRecoveryAppliedMetadata, parseAcceptSuccessAppliedMetadata } from '@eforge-build/engine/recovery/applied-sidecar';

export function parseQueueFrontmatter(content: string): Record<string, unknown> | null {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  const result: Record<string, unknown> = {};
  for (const line of match[1].split('\n')) {
    const kvMatch = line.match(/^(\w[\w_]*)\s*:\s*(.*)/);
    if (!kvMatch) continue;
    const [, key, rawValue] = kvMatch;
    const value = rawValue.trim();
    if (value.startsWith('[') && value.endsWith(']')) {
      const inner = value.slice(1, -1).trim();
      result[key] = inner ? inner.split(',').map((s) => s.trim().replace(/^["']|["']$/g, '')) : [];
    } else if (/^-?\d+$/.test(value)) {
      result[key] = parseInt(value, 10);
    } else if (value === 'true' || value === 'false') {
      result[key] = value === 'true';
    } else if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      result[key] = value.slice(1, -1);
    } else {
      result[key] = value;
    }
  }
  return result;
}

interface RecoverySidecarProjection {
  recoveryVerdict?: QueueItem['recoveryVerdict'];
  recoveryApplied?: QueueItem['recoveryApplied'];
}

function resolvedStatus(status: string, recovery: RecoverySidecarProjection): string {
  const applied = recovery.recoveryApplied;
  if (status === 'failed' && applied?.action === 'accepted-success' && applied.landing.status === 'complete') return 'completed';
  return status;
}

function buildQueueItem(id: string, fm: Record<string, unknown>, status: string, recovery: RecoverySidecarProjection = {}): QueueItem {
  const item: QueueItem = { id, title: fm.title as string, status: resolvedStatus(status, recovery) };
  if (typeof fm.priority === 'number') item.priority = fm.priority;
  if (typeof fm.created === 'string') item.created = fm.created;
  if (Array.isArray(fm.depends_on)) item.dependsOn = fm.depends_on as string[];
  if (recovery.recoveryVerdict !== undefined) item.recoveryVerdict = recovery.recoveryVerdict;
  if (recovery.recoveryApplied !== undefined) item.recoveryApplied = recovery.recoveryApplied;
  return item;
}

function postProcessQueueDependsOn(items: QueueItem[]): void {
  const liveIds = new Set(items.filter((i) => i.status === 'pending' || i.status === 'running' || i.status === 'waiting').map((i) => i.id));
  for (const item of items) {
    if (item.status === 'failed' || item.status === 'skipped') {
      delete item.dependsOn;
    } else if (item.dependsOn) {
      const filtered = item.dependsOn.filter((dep) => liveIds.has(dep));
      if (filtered.length === 0) delete item.dependsOn;
      else item.dependsOn = filtered;
    }
  }
}

function parseRecoverySidecarProjection(raw: string): RecoverySidecarProjection {
  const sidecarData = JSON.parse(raw) as Record<string, unknown>;
  const projection: RecoverySidecarProjection = {};
  if (sidecarData && typeof sidecarData.verdict === 'object' && sidecarData.verdict !== null) {
    const parsed = parseWithSchema(recoveryVerdictSchema, sidecarData.verdict);
    projection.recoveryVerdict = { verdict: parsed.verdict, confidence: parsed.confidence };
  }
  // Prefer the rich accepted-success marker (keyed by `acceptedAt`); fall back to
  // the base `appliedAt`-keyed retry/split/abandon marker.
  const applied = parseAcceptSuccessAppliedMetadata(sidecarData?.applied)
    ?? parseRecoveryAppliedMetadata(sidecarData?.applied);
  if (applied !== undefined) projection.recoveryApplied = applied;
  return projection;
}

function readRecoverySidecarProjectionSync(dir: string, id: string): RecoverySidecarProjection {
  try { return parseRecoverySidecarProjection(readFileSync(resolve(dir, `${id}.recovery.json`), 'utf-8')); } catch { return {}; }
}

async function readRecoverySidecarProjection(dir: string, id: string): Promise<RecoverySidecarProjection> {
  try { return parseRecoverySidecarProjection(await readFile(resolve(dir, `${id}.recovery.json`), 'utf-8')); } catch { return {}; }
}

export function loadQueueItemsSync(queueDir: string, lockDir: string): QueueItem[] {
  const items: QueueItem[] = [];
  const loadDirSync = (dir: string, derivedStatus: string): void => {
    let entries: string[];
    try { entries = readdirSync(dir); } catch { return; }
    for (const file of entries.filter((f) => f.endsWith('.md')).sort()) {
      try {
        const fm = parseQueueFrontmatter(readFileSync(resolve(dir, file), 'utf-8'));
        if (!fm || typeof fm.title !== 'string') continue;
        const id = basename(file, '.md');
        const status = derivedStatus === 'pending' && existsSync(resolve(lockDir, `${id}.lock`)) ? 'running' : derivedStatus;
        items.push(buildQueueItem(id, fm, status, derivedStatus === 'failed' ? readRecoverySidecarProjectionSync(dir, id) : {}));
      } catch { /* skip unreadable */ }
    }
  };
  loadDirSync(queueDir, 'pending');
  loadDirSync(resolve(queueDir, 'failed'), 'failed');
  loadDirSync(resolve(queueDir, 'skipped'), 'skipped');
  loadDirSync(resolve(queueDir, 'waiting'), 'waiting');
  postProcessQueueDependsOn(items);
  return items;
}

export async function loadQueueItems(queueDir: string, lockDir: string): Promise<QueueItem[]> {
  const items: QueueItem[] = [];
  const loadFromDir = async (dir: string, derivedStatus: string): Promise<void> => {
    let entries: string[];
    try { entries = await readdir(dir); } catch { return; }
    for (const file of entries.filter((f) => f.endsWith('.md')).sort()) {
      try {
        const fm = parseQueueFrontmatter(await readFile(resolve(dir, file), 'utf-8'));
        if (!fm || typeof fm.title !== 'string') continue;
        const id = basename(file, '.md');
        let status = derivedStatus;
        if (derivedStatus === 'pending') {
          try { await readFile(resolve(lockDir, `${id}.lock`)); status = 'running'; } catch { /* pending */ }
        }
        items.push(buildQueueItem(id, fm, status, derivedStatus === 'failed' ? await readRecoverySidecarProjection(dir, id) : {}));
      } catch { /* skip unreadable */ }
    }
  };
  await loadFromDir(queueDir, 'pending');
  await loadFromDir(resolve(queueDir, 'failed'), 'failed');
  await loadFromDir(resolve(queueDir, 'skipped'), 'skipped');
  await loadFromDir(resolve(queueDir, 'waiting'), 'waiting');
  postProcessQueueDependsOn(items);
  return items;
}

export function loadQueueItemsForCwdSync(cwd: string, queueDirOption = '.eforge/queue'): QueueItem[] {
  return loadQueueItemsSync(resolve(cwd, queueDirOption), resolve(cwd, '.eforge', 'queue-locks'));
}

export function loadQueueItemsForCwd(cwd: string, queueDirOption = '.eforge/queue'): Promise<QueueItem[]> {
  return loadQueueItems(resolve(cwd, queueDirOption), resolve(cwd, '.eforge', 'queue-locks'));
}

export function countPendingQueueDepth(cwd: string, queueDirOption = '.eforge/queue'): number {
  try { return readdirSync(resolve(cwd, queueDirOption)).filter((f) => f.endsWith('.md')).length; } catch { return 0; }
}
