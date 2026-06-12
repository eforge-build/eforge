import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { dispatchExtensionAction } from '../../../../packages/engine/src/extensions/action-runtime.js';
import { createExtensionRecorder } from '../../../../packages/engine/src/extensions/recorder.js';
import type { NativeExtensionRecorderState, NativeExtensionRegistry } from '../../../../packages/engine/src/extensions/types.js';
import eforgePlanExtension from '../index.js';
import { writeBacklogEpic, writeBacklogItem } from '../markdown-store.js';

async function withTempProject<T>(fn: (cwd: string) => Promise<T>): Promise<T> {
  const cwd = await mkdtemp(join(tmpdir(), 'eforge-plan-query-actions-'));
  try { return await fn(cwd); } finally { await rm(cwd, { recursive: true, force: true }); }
}

function registry(): NativeExtensionRegistry {
  const { api, state } = createExtensionRecorder('eforge-plan', '/project/eforge/extensions/eforge-plan/index.ts');
  eforgePlanExtension(api as never);
  expect(state.diagnostics).toEqual([]);
  return { ...(state as NativeExtensionRecorderState), extensions: [], candidates: [] };
}

async function invoke(cwd: string, actionId: string, input: Record<string, unknown>) {
  const result = await dispatchExtensionAction(registry(), { actionId: `eforge-plan:${actionId}`, input, requestedBy: { host: 'pi' }, cwd, timeoutMs: 1000 });
  expect(result).toMatchObject({ kind: 'success' });
  if (result.kind !== 'success') throw new Error(result.message);
  return result.output as Record<string, unknown>;
}

describe('eforge-plan compact backlog query actions', () => {
  it('reads one item detail without board-wide payloads', async () => {
    await withTempProject(async (cwd) => {
      await seedBacklog(cwd);

      const output = await invoke(cwd, 'get-item', { id: 'child' });

      expect(output.schemaVersion).toBe(1);
      expect(output.item).toMatchObject({ id: 'child', title: 'Child Item', lane: 'blocked', dependsOn: ['dep'], unresolvedDependsOn: ['dep'] });
      expect(output.epic).toMatchObject({ id: 'epic-one', itemCount: 3, openItemCount: 2 });
      expect(output.dependencies).toEqual([expect.objectContaining({ id: 'dep', title: 'Dependency Item' })]);
      expect(output.dependents).toEqual([]);
      expect(JSON.stringify(output)).toContain('Child claim.');
      expect(JSON.stringify(output)).not.toContain('Dependency claim.');
    });
  });

  it('searches and pages compact item summaries', async () => {
    await withTempProject(async (cwd) => {
      await seedBacklog(cwd);

      const output = await invoke(cwd, 'search-items', { query: 'child', limit: 1 });

      expect(output).toMatchObject({ total: 1, limit: 1, offset: 0 });
      expect(output.items).toEqual([expect.objectContaining({ id: 'child', title: 'Child Item' })]);
    });
  });

  it('lists a compact board page with lane counts and compact epic counts', async () => {
    await withTempProject(async (cwd) => {
      await seedBacklog(cwd);

      const output = await invoke(cwd, 'list-board-compact', { epic: 'epic-one', includeArchive: false, limit: 2 });

      expect(output).toMatchObject({ total: 3, limit: 2, offset: 0 });
      expect(output.items).toEqual([
        expect.objectContaining({ id: 'child' }),
        expect.objectContaining({ id: 'dep' }),
      ]);
      expect(output.lanes).toEqual(expect.arrayContaining([
        expect.objectContaining({ lane: 'blocked', count: 1 }),
        expect.objectContaining({ lane: 'ready', count: 1 }),
        expect.objectContaining({ lane: 'done', count: 1 }),
      ]));
      expect(output.epics).toEqual([expect.objectContaining({ id: 'epic-one', itemCount: 3, openItemCount: 2 })]);
      expect(JSON.stringify(output)).not.toContain('Child claim.');
    });
  });

  it('reads an epic detail with paged compact item summaries', async () => {
    await withTempProject(async (cwd) => {
      await seedBacklog(cwd);

      const output = await invoke(cwd, 'get-epic', { id: 'epic-one', limit: 1, offset: 1 });

      expect(output.epic).toMatchObject({ id: 'epic-one', title: 'Epic One', itemCount: 3, openItemCount: 2 });
      expect(output).toMatchObject({ totalItems: 3, limit: 1, offset: 1 });
      expect(output.items).toEqual([expect.objectContaining({ id: 'dep' })]);
    });
  });
});

async function seedBacklog(cwd: string): Promise<void> {
  await writeBacklogEpic(cwd, { id: 'epic-one', status: 'planned', body: '# Epic One\n\n## Goal\n\nDeliver compact reads.\n' });
  await writeBacklogItem(cwd, { id: 'child', status: 'planned', epic: 'epic-one', depends_on: ['dep'], body: '# Child Item\n\n## Claim\n\nChild claim.\n' });
  await writeBacklogItem(cwd, { id: 'dep', status: 'planned', epic: 'epic-one', body: '# Dependency Item\n\n## Claim\n\nDependency claim.\n' });
  await writeBacklogItem(cwd, { id: 'done', status: 'shipped', epic: 'epic-one', body: '# Done Item\n\n## Claim\n\nDone claim.\n' });
}
