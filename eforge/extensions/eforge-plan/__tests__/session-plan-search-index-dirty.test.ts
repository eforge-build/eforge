import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dispatchExtensionAction } from '@eforge-build/engine/extensions/action-runtime.js';
import { createExtensionRecorder } from '@eforge-build/engine/extensions/recorder.js';
import type { NativeExtensionRecorderState, NativeExtensionRegistry } from '@eforge-build/engine/extensions/types.js';
import { describe, expect, it } from 'vitest';
import { captureCanonicalBacklogItem, updateCanonicalBacklogItem, upsertCanonicalEpic } from '../canonical/backlog-records.js';
import { syncSessionPlanArtifact } from '../canonical/session-plan-records.js';
import eforgePlanExtension from '../index.js';
import { rebuildSearchIndex } from '../search/index.js';
import { openEforgePlanStore, type EforgePlanStore } from '../sqlite/index.js';
import { getDatabase } from '../sqlite/store-internal.js';

async function withTempProject<T>(fn: (cwd: string) => Promise<T> | T): Promise<T> {
  const cwd = await mkdtemp(join(tmpdir(), 'eforge-plan-session-search-dirty-'));
  try {
    return await fn(cwd);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

function withStore<T>(cwd: string, fn: (store: EforgePlanStore) => T): T {
  const store = openEforgePlanStore(cwd);
  try {
    return fn(store);
  } finally {
    store.close();
  }
}

function registry(): NativeExtensionRegistry {
  const { api, state } = createExtensionRecorder('eforge-plan', '/project/eforge/extensions/eforge-plan/index.ts');
  eforgePlanExtension(api as never);
  expect(state.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')).toEqual([]);
  return { ...(state as NativeExtensionRecorderState), extensions: [], candidates: [] };
}

async function dispatch(cwd: string, actionId: string, input: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const result = await dispatchExtensionAction(registry(), { actionId: `eforge-plan:${actionId}`, input, requestedBy: { host: 'pi' }, cwd, timeoutMs: 1000 });
  expect(result).toMatchObject({ kind: 'success' });
  if (result.kind !== 'success') throw new Error(result.message);
  return result.output as Record<string, unknown>;
}

function sessionPath(cwd: string): string {
  return join(cwd, '.eforge/session-plans/session-alpha.md');
}

function sessionContent(input: { topic?: string; itemIds?: string[]; epicIds?: string[]; recommendationRef?: string } = {}): string {
  const itemIds = input.itemIds ?? ['item-a'];
  const epicIds = input.epicIds ?? ['epic-a'];
  return `---\nsession: session-alpha\ntopic: ${input.topic ?? 'Alpha session'}\nstatus: ready\nplanning_type: feature\nplanning_depth: focused\nprofile: default\neforge_plan:\n  source_item_ids: [${itemIds.join(', ')}]\n  source_epic_ids: [${epicIds.join(', ')}]\n  source_recommendation_ref: ${input.recommendationRef ?? 'rec-alpha'}\n---\n# Session body\n\nStable markdown body.\n`;
}

async function seedLinkedPlanningData(cwd: string): Promise<void> {
  captureCanonicalBacklogItem(cwd, { id: 'item-a', title: 'Item A' });
  captureCanonicalBacklogItem(cwd, { id: 'item-b', title: 'Item B' });
  upsertCanonicalEpic(cwd, { id: 'epic-a', title: 'Epic A' });
  upsertCanonicalEpic(cwd, { id: 'epic-b', title: 'Epic B' });
  await mkdir(join(cwd, '.eforge/session-plans'), { recursive: true });
  await writeFile(sessionPath(cwd), sessionContent());
  syncSessionPlanArtifact(cwd, { session: 'session-alpha', path: sessionPath(cwd), content: sessionContent(), summaryText: 'Initial summary', readinessSummary: { ready: true } });
}

function rebuildAndDirtyRows(cwd: string): Array<{ document_type: string; document_id: string; reason: string | null }> {
  return withStore(cwd, (store) => {
    rebuildSearchIndex(store);
    return dirtyRows(store);
  });
}

function dirtyRows(store: EforgePlanStore): Array<{ document_type: string; document_id: string; reason: string | null }> {
  return getDatabase(store).prepare('SELECT document_type, document_id, reason FROM search_index_dirty_records ORDER BY document_type, document_id').all() as Array<{ document_type: string; document_id: string; reason: string | null }>;
}

function dirtyKeys(cwd: string): string[] {
  return withStore(cwd, (store) => dirtyRows(store).map((row) => `${row.document_type}:${row.document_id}`));
}

function searchIndexReady(cwd: string): boolean {
  return withStore(cwd, (store) => (getDatabase(store).prepare('SELECT dirty FROM search_index_state WHERE id = 1').get() as { dirty: number }).dirty === 0);
}

describe('session-plan search dirty tracking', () => {
  it('leaves existing dirty state untouched when synchronization observes unchanged canonical data', async () => {
    await withTempProject(async (cwd) => {
      await seedLinkedPlanningData(cwd);
      rebuildAndDirtyRows(cwd);
      withStore(cwd, (store) => {
        getDatabase(store).prepare("INSERT INTO search_index_dirty_records (document_type, document_id, reason, marked_at) VALUES ('backlog_item', 'preexisting', 'test', '2027-01-01T00:00:00.000Z')").run();
        getDatabase(store).prepare('UPDATE search_index_state SET dirty = 1, dirty_reason = ? WHERE id = 1').run('test');
      });
      const before = dirtyKeys(cwd);

      syncSessionPlanArtifact(cwd, { session: 'session-alpha', path: sessionPath(cwd), content: sessionContent(), summaryText: 'Initial summary', readinessSummary: { ready: true } });

      expect(dirtyKeys(cwd)).toEqual(before);
    });
  });

  it('dirties only the session-plan search document when search-relevant session content changes without relationship changes', async () => {
    await withTempProject(async (cwd) => {
      await seedLinkedPlanningData(cwd);
      expect(rebuildAndDirtyRows(cwd)).toEqual([]);

      syncSessionPlanArtifact(cwd, { session: 'session-alpha', path: sessionPath(cwd), content: sessionContent({ topic: 'Retitled alpha session' }), summaryText: 'Initial summary', readinessSummary: { ready: true } });

      expect(dirtyKeys(cwd)).toEqual(['session_plan:session-alpha']);
    });
  });

  it('dirties the session plan plus added and removed linked documents when relationships change', async () => {
    await withTempProject(async (cwd) => {
      await seedLinkedPlanningData(cwd);
      expect(rebuildAndDirtyRows(cwd)).toEqual([]);

      syncSessionPlanArtifact(cwd, { session: 'session-alpha', path: sessionPath(cwd), content: sessionContent({ itemIds: ['item-b'], epicIds: ['epic-b'] }), summaryText: 'Initial summary', readinessSummary: { ready: true } });

      expect(dirtyKeys(cwd)).toEqual(['backlog_item:item-a', 'backlog_item:item-b', 'epic:epic-a', 'epic:epic-b', 'session_plan:session-alpha']);
    });
  });

  it('continues to dirty backlog-item and epic documents through their canonical write paths', async () => {
    await withTempProject(async (cwd) => {
      await seedLinkedPlanningData(cwd);
      expect(rebuildAndDirtyRows(cwd)).toEqual([]);

      updateCanonicalBacklogItem(cwd, 'item-a', { title: 'Updated item A' });
      upsertCanonicalEpic(cwd, { id: 'epic-a', title: 'Updated Epic A' });

      expect(dirtyKeys(cwd)).toEqual(['backlog_item:item-a', 'epic:epic-a']);
    });
  });

  it('keeps a rebuilt ready search index ready after a read-only list-planning-artifacts refresh', async () => {
    await withTempProject(async (cwd) => {
      await seedLinkedPlanningData(cwd);
      expect(rebuildAndDirtyRows(cwd)).toEqual([]);
      expect(searchIndexReady(cwd)).toBe(true);

      await dispatch(cwd, 'list-planning-artifacts', { includeBoard: false });
      syncSessionPlanArtifact(cwd, { session: 'session-alpha', path: sessionPath(cwd), content: sessionContent(), summaryText: 'Initial summary', readinessSummary: { ready: true } });

      expect(dirtyKeys(cwd)).toEqual([]);
      expect(searchIndexReady(cwd)).toBe(true);
    });
  });
});
