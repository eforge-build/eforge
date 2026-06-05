import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import eforgePlanExtension from '../index.js';
import {
  assertSafeBacklogId,
  listBacklogEpics,
  listBacklogItems,
  readBacklogEpic,
  readBacklogItem,
  resolveBacklogItemPath,
  updateBacklogItemFrontmatter,
  writeBacklogEpic,
  writeBacklogItem,
} from '../markdown-store.js';
import {
  createTraceSidecar,
  readTraceSidecar,
  resolveTracePath,
  upsertBuildRun,
  upsertBuildSession,
  upsertLandingResult,
  upsertPromotedSessionPlan,
  upsertQueuePrd,
  updateLastEventMetadata,
} from '../trace-store.js';

async function withTempProject<T>(fn: (cwd: string) => Promise<T>): Promise<T> {
  const cwd = await mkdtemp(join(tmpdir(), 'eforge-plan-'));
  try {
    return await fn(cwd);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

describe('eforge-plan markdown storage', () => {
  it('exports a side-effect-free native extension factory', async () => {
    await withTempProject(async (cwd) => {
      const before = await listBacklogItems(cwd);
      expect(typeof eforgePlanExtension).toBe('function');
      expect(eforgePlanExtension({} as never)).toBeUndefined();
      expect(await listBacklogItems(cwd)).toEqual(before);
    });
  });

  it('reads and writes item frontmatter fields in stable order', async () => {
    await withTempProject(async (cwd) => {
      await writeBacklogItem(cwd, {
        id: 'item-1',
        status: 'planned',
        priority: 'high',
        source: 'roadmap',
        created: '2026-01-01',
        updated: '2026-01-02',
        last_checked: '2026-01-03',
        stale_after: '2026-02-01',
        tags: ['ui', 'planning'],
        depends_on: ['item-0'],
        epic: 'epic-1',
        body: '# Item One\n\nBody',
      });

      const item = await readBacklogItem(cwd, 'item-1');
      expect(item).toMatchObject({
        id: 'item-1',
        status: 'planned',
        priority: 'high',
        source: 'roadmap',
        created: '2026-01-01',
        updated: '2026-01-02',
        last_checked: '2026-01-03',
        stale_after: '2026-02-01',
        tags: ['ui', 'planning'],
        depends_on: ['item-0'],
        epic: 'epic-1',
        title: 'Item One',
      });
      const raw = await readFile(resolveBacklogItemPath(cwd, 'item-1'), 'utf-8');
      expect(raw.indexOf('id: item-1')).toBeLessThan(raw.indexOf('status: planned'));
      expect(raw.indexOf('status: planned')).toBeLessThan(raw.indexOf('priority: high'));
      expect(await listBacklogItems(cwd)).toHaveLength(1);
    });
  });

  it('reads and writes epic frontmatter fields', async () => {
    await withTempProject(async (cwd) => {
      await writeBacklogEpic(cwd, {
        id: 'epic-1',
        status: 'candidate',
        priority: 'medium',
        source: 'strategy',
        created: '2026-01-01',
        updated: '2026-01-02',
        last_checked: '2026-01-03',
        stale_after: '2026-02-01',
        tags: ['foundation'],
        body: '# Epic One\n\nEpic body',
      });

      expect(await readBacklogEpic(cwd, 'epic-1')).toMatchObject({
        id: 'epic-1',
        status: 'candidate',
        priority: 'medium',
        source: 'strategy',
        created: '2026-01-01',
        updated: '2026-01-02',
        last_checked: '2026-01-03',
        stale_after: '2026-02-01',
        tags: ['foundation'],
        title: 'Epic One',
      });
      expect(await listBacklogEpics(cwd)).toHaveLength(1);
    });
  });

  it('updates frontmatter while preserving markdown title and body', async () => {
    await withTempProject(async (cwd) => {
      await writeFile(join(cwd, '.backlog-missing'), 'ignored');
      await writeBacklogItem(cwd, {
        id: 'item-2',
        status: 'candidate',
        tags: ['old'],
        body: '# Original Title\n\n## Details\n\nKeep this body.\n',
      });
      await updateBacklogItemFrontmatter(cwd, 'item-2', { status: 'active', tags: ['new'] });

      const item = await readBacklogItem(cwd, 'item-2');
      expect(item?.status).toBe('active');
      expect(item?.title).toBe('Original Title');
      expect(item?.body).toBe('# Original Title\n\n## Details\n\nKeep this body.\n');
    });
  });

  it('rejects unsafe ids before producing write paths', () => {
    for (const unsafe of ['.', '..', 'nested/item', 'nested\\item', 'bad\0id']) {
      expect(() => assertSafeBacklogId(unsafe)).toThrow(/Unsafe|empty|not/);
      expect(() => resolveBacklogItemPath('/tmp/project', unsafe)).toThrow(/Unsafe|empty|not/);
    }
  });

  it('treats missing storage directories as empty collections', async () => {
    await withTempProject(async (cwd) => {
      expect(await listBacklogItems(cwd)).toEqual([]);
      expect(await listBacklogEpics(cwd)).toEqual([]);
      expect(await readBacklogItem(cwd, 'missing')).toBeNull();
    });
  });
});

describe('eforge-plan trace storage', () => {
  it('places trace paths under project-local extension data', async () => {
    await withTempProject(async (cwd) => {
      const tracePath = resolveTracePath(cwd, 'item-1');
      expect(tracePath).toContain(`${sep}.eforge${sep}extension-data${sep}eforge-plan${sep}traces${sep}item-1.json`);
      expect(tracePath).not.toContain(`${sep}.eforge${sep}extensions${sep}eforge-plan${sep}`);
      expect(relative(cwd, tracePath).startsWith(`.eforge${sep}extension-data${sep}eforge-plan${sep}traces`)).toBe(true);
      expect(await readTraceSidecar(cwd, 'item-1')).toBeNull();
    });
  });

  it('creates trace sidecars with schema and evidence fields', () => {
    const trace = createTraceSidecar('item-1', 'epic-1');
    expect(trace).toMatchObject({
      schemaVersion: 1,
      itemId: 'item-1',
      epicId: 'epic-1',
      promotedSessionPlans: [],
      queuePrds: [],
      buildRuns: [],
      buildRunIds: [],
      buildSessions: [],
      buildSessionIds: [],
      landingResults: [],
    });
    expect('lastEvent' in trace).toBe(false);
  });

  it('upserts trace entries idempotently by durable keys', async () => {
    await withTempProject(async (cwd) => {
      await upsertPromotedSessionPlan(cwd, 'item-1', { session: 'session-plan-1', status: 'pending' }, 'epic-1');
      await upsertPromotedSessionPlan(cwd, 'item-1', { session: 'session-plan-1', status: 'completed' });
      await upsertQueuePrd(cwd, 'item-1', { prdId: 'prd-1', status: 'queued' });
      await upsertQueuePrd(cwd, 'item-1', { prdId: 'prd-1', status: 'completed' });
      await upsertBuildRun(cwd, 'item-1', { runId: 'run-1', sessionId: 'build-session-1', status: 'running' });
      await upsertBuildRun(cwd, 'item-1', { runId: 'run-2', sessionId: 'build-session-1', status: 'completed' });
      await upsertBuildSession(cwd, 'item-1', { sessionId: 'build-session-1', status: 'running' });
      await upsertBuildSession(cwd, 'item-1', { sessionId: 'build-session-1', status: 'completed' });
      await upsertLandingResult(cwd, 'item-1', { featureBranch: 'feature/a', status: 'merged' });
      await upsertLandingResult(cwd, 'item-1', { featureBranch: 'feature/a', commitSha: 'abc', status: 'landed' });
      await upsertLandingResult(cwd, 'item-1', { commitSha: 'def', status: 'landed' });
      await upsertLandingResult(cwd, 'item-1', { commitSha: 'def', status: 'verified' });
      await updateLastEventMetadata(cwd, 'item-1', { type: 'plan:build:completed', timestamp: '2026-01-01', sessionId: 's', runId: 'r', cursor: 7 });

      const trace = await readTraceSidecar(cwd, 'item-1');
      expect(trace?.promotedSessionPlans).toEqual([{ session: 'session-plan-1', status: 'completed' }]);
      expect(trace?.queuePrds).toEqual([{ prdId: 'prd-1', status: 'completed' }]);
      expect(trace?.buildRuns).toEqual([{ runId: 'run-2', sessionId: 'build-session-1', status: 'completed' }]);
      expect(trace?.buildRunIds).toEqual(['run-2']);
      expect(trace?.buildSessions).toEqual([{ sessionId: 'build-session-1', status: 'completed' }]);
      expect(trace?.buildSessionIds).toEqual(['build-session-1']);
      expect(trace?.landingResults).toEqual([
        { featureBranch: 'feature/a', commitSha: 'abc', status: 'landed' },
        { commitSha: 'def', status: 'verified' },
      ]);
      expect(trace?.lastEvent).toEqual({ type: 'plan:build:completed', timestamp: '2026-01-01', sessionId: 's', runId: 'r', cursor: 7 });
    });
  });
});
