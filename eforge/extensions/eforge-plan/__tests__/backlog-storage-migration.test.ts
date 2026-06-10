import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { dispatchExtensionAction } from '../../../../packages/engine/src/extensions/action-runtime.js';
import { createExtensionRecorder } from '../../../../packages/engine/src/extensions/recorder.js';
import eforgePlanExtension from '../index.js';
import {
  importLegacyBacklog,
  listBacklogEpicSnapshots,
  listBacklogEpics,
  listBacklogItemSnapshots,
  listBacklogItems,
  readBacklogEpic,
  readBacklogEpicSnapshot,
  readBacklogItem,
  readBacklogItemSnapshot,
  resolveBacklogEpicPath,
  resolveBacklogItemPath,
  resolveLegacyBacklogEpicPath,
  resolveLegacyBacklogItemPath,
  updateBacklogEpicFrontmatter,
  updateBacklogItemFrontmatter,
  writeBacklogEpic,
  writeBacklogItem,
} from '../markdown-store.js';

async function withTempProject<T>(fn: (cwd: string) => Promise<T>): Promise<T> {
  const cwd = await mkdtemp(join(tmpdir(), 'eforge-plan-storage-migration-'));
  try { return await fn(cwd); } finally { await rm(cwd, { recursive: true, force: true }); }
}

async function writeLegacy(cwd: string, kind: 'items' | 'epics', id: string, status = 'candidate', title = id): Promise<string> {
  const dir = join(cwd, '.backlog', kind);
  await mkdir(dir, { recursive: true });
  const raw = `---\nid: ${id}\nstatus: ${status}\nupdated: 2026-01-01T00:00:00.000Z\n---\n# ${title}\n\nLegacy body for ${id}.\n`;
  await writeFile(join(dir, `${id}.md`), raw);
  return raw;
}

function loadRegistry(cwd: string) {
  const { api, state } = createExtensionRecorder('eforge-plan', join(cwd, 'eforge/extensions/eforge-plan/index.ts'));
  eforgePlanExtension(api as never);
  return { ...state, extensions: [], candidates: [] };
}

describe('eforge-plan backlog storage migration', () => {
  it('resolves canonical private paths and explicit legacy paths safely', async () => {
    await withTempProject(async (cwd) => {
      expect(resolveBacklogItemPath(cwd, 'item-one')).toContain(`${sep}.eforge${sep}storage${sep}extensions${sep}eforge-plan${sep}backlog${sep}items${sep}item-one.md`);
      expect(resolveBacklogEpicPath(cwd, 'epic-one')).toContain(`${sep}.eforge${sep}storage${sep}extensions${sep}eforge-plan${sep}backlog${sep}epics${sep}epic-one.md`);
      expect(resolveBacklogItemPath(cwd, 'item-one')).not.toContain(`${sep}.backlog${sep}items${sep}`);
      expect(resolveBacklogEpicPath(cwd, 'epic-one')).not.toContain(`${sep}.backlog${sep}epics${sep}`);
      expect(resolveLegacyBacklogItemPath(cwd, 'item-one')).toContain(`${sep}.backlog${sep}items${sep}item-one.md`);
      expect(resolveLegacyBacklogEpicPath(cwd, 'epic-one')).toContain(`${sep}.backlog${sep}epics${sep}epic-one.md`);
      for (const unsafe of ['', '.', '..', 'nested/item', 'nested\\item']) {
        expect(() => resolveBacklogItemPath(cwd, unsafe)).toThrow();
        expect(() => resolveBacklogEpicPath(cwd, unsafe)).toThrow();
        expect(() => resolveLegacyBacklogItemPath(cwd, unsafe)).toThrow();
        expect(() => resolveLegacyBacklogEpicPath(cwd, unsafe)).toThrow();
      }
    });
  });

  it('reads and lists merged private plus legacy records with private precedence', async () => {
    await withTempProject(async (cwd) => {
      await writeLegacy(cwd, 'items', 'dup', 'candidate', 'Legacy Dup');
      await writeLegacy(cwd, 'items', 'legacy-only', 'planned', 'Legacy Only');
      await writeLegacy(cwd, 'epics', 'dup-epic', 'candidate', 'Legacy Epic');
      await writeLegacy(cwd, 'epics', 'legacy-epic', 'planned', 'Legacy Epic Only');
      await writeBacklogItem(cwd, { id: 'dup', status: 'active', body: '# Private Dup\n' });
      await writeBacklogEpic(cwd, { id: 'dup-epic', status: 'active', body: '# Private Epic\n' });

      expect(await readBacklogItem(cwd, 'legacy-only')).toMatchObject({ id: 'legacy-only', title: 'Legacy Only' });
      expect(await readBacklogEpic(cwd, 'legacy-epic')).toMatchObject({ id: 'legacy-epic', title: 'Legacy Epic Only' });
      expect(await readBacklogItem(cwd, 'dup')).toMatchObject({ status: 'active', title: 'Private Dup' });
      expect(await readBacklogEpic(cwd, 'dup-epic')).toMatchObject({ status: 'active', title: 'Private Epic' });
      expect((await listBacklogItems(cwd)).map((item) => `${item.id}:${item.status}`)).toEqual(['dup:active', 'legacy-only:planned']);
      expect((await listBacklogEpics(cwd)).map((epic) => `${epic.id}:${epic.status}`)).toEqual(['dup-epic:active', 'legacy-epic:planned']);
    });
  });

  it('rejects malformed filename/frontmatter ids during read and list', async () => {
    await withTempProject(async (cwd) => {
      await mkdir(join(cwd, '.backlog', 'items'), { recursive: true });
      await writeFile(join(cwd, '.backlog', 'items', 'safe.md'), '---\nid: other\nstatus: candidate\n---\n# Bad\n');
      await expect(readBacklogItem(cwd, 'safe')).rejects.toThrow(/id mismatch/);
      await expect(listBacklogItems(cwd)).rejects.toThrow(/id mismatch/);
      await writeFile(join(cwd, '.backlog', 'items', 'safe.md'), '---\nid: nested/item\nstatus: candidate\n---\n# Bad\n');
      await expect(readBacklogItem(cwd, 'safe')).rejects.toThrow(/Unsafe/);
    });
  });

  it('writes and updates private files only while preserving legacy bytes', async () => {
    await withTempProject(async (cwd) => {
      await writeBacklogItem(cwd, { id: 'new-item', status: 'candidate', body: '# New Item\n' });
      await writeBacklogEpic(cwd, { id: 'new-epic', status: 'candidate', body: '# New Epic\n' });
      expect(existsSync(resolveBacklogItemPath(cwd, 'new-item'))).toBe(true);
      expect(existsSync(resolveBacklogEpicPath(cwd, 'new-epic'))).toBe(true);
      expect(existsSync(resolveLegacyBacklogItemPath(cwd, 'new-item'))).toBe(false);
      expect(existsSync(resolveLegacyBacklogEpicPath(cwd, 'new-epic'))).toBe(false);

      const itemRaw = await writeLegacy(cwd, 'items', 'legacy-update', 'candidate', 'Legacy Update');
      const epicRaw = await writeLegacy(cwd, 'epics', 'legacy-epic-update', 'candidate', 'Legacy Epic Update');
      await updateBacklogItemFrontmatter(cwd, 'legacy-update', { status: 'active', tags: ['copied'] });
      await updateBacklogEpicFrontmatter(cwd, 'legacy-epic-update', { status: 'active', tags: ['copied'] });
      expect(await readFile(resolveLegacyBacklogItemPath(cwd, 'legacy-update'), 'utf-8')).toBe(itemRaw);
      expect(await readFile(resolveLegacyBacklogEpicPath(cwd, 'legacy-epic-update'), 'utf-8')).toBe(epicRaw);
      expect(await readBacklogItem(cwd, 'legacy-update')).toMatchObject({ status: 'active', title: 'Legacy Update', body: expect.stringContaining('Legacy body') });
      expect(await readBacklogEpic(cwd, 'legacy-epic-update')).toMatchObject({ status: 'active', title: 'Legacy Epic Update', body: expect.stringContaining('Legacy body') });
    });
  });

  it('imports legacy records, skips existing private records, leaves legacy files, and reports private paths', async () => {
    await withTempProject(async (cwd) => {
      await writeLegacy(cwd, 'items', 'copy-item');
      await writeLegacy(cwd, 'items', 'skip-item');
      await writeLegacy(cwd, 'epics', 'copy-epic');
      await writeLegacy(cwd, 'epics', 'skip-epic');
      await writeBacklogItem(cwd, { id: 'skip-item', status: 'active', body: '# Private Item\n' });
      await writeBacklogEpic(cwd, { id: 'skip-epic', status: 'active', body: '# Private Epic\n' });

      const result = await importLegacyBacklog(cwd, { kind: 'all' });
      expect(result.items.copied).toEqual([{ id: 'copy-item', path: '.eforge/storage/extensions/eforge-plan/backlog/items/copy-item.md' }]);
      expect(result.epics.copied).toEqual([{ id: 'copy-epic', path: '.eforge/storage/extensions/eforge-plan/backlog/epics/copy-epic.md' }]);
      expect(result.items.skipped).toEqual([{ id: 'skip-item', reason: 'private-exists' }]);
      expect(result.epics.skipped).toEqual([{ id: 'skip-epic', reason: 'private-exists' }]);
      expect(existsSync(resolveLegacyBacklogItemPath(cwd, 'copy-item'))).toBe(true);
      expect(await readBacklogItem(cwd, 'skip-item')).toMatchObject({ title: 'Private Item' });
    });
  });

  it('validates all legacy items and epics before importing any private copies', async () => {
    await withTempProject(async (cwd) => {
      await writeLegacy(cwd, 'items', 'copy-before-epic-failure');
      await mkdir(join(cwd, '.backlog', 'epics'), { recursive: true });
      await writeFile(join(cwd, '.backlog', 'epics', 'bad-epic.md'), '---\nid: nested/epic\nstatus: candidate\n---\n# Bad Epic\n');

      await expect(importLegacyBacklog(cwd, { kind: 'all' })).rejects.toThrow(/Unsafe/);
      expect(existsSync(resolveBacklogItemPath(cwd, 'copy-before-epic-failure'))).toBe(false);
      expect(existsSync(resolveLegacyBacklogItemPath(cwd, 'copy-before-epic-failure'))).toBe(true);
    });
  });

  it('rejects ambiguous selected ids for all-kind legacy imports', async () => {
    await withTempProject(async (cwd) => {
      await expect(importLegacyBacklog(cwd, { kind: 'all', ids: ['one'] })).rejects.toThrow(/ids may only be used/);
    });
  });

  it('validates all selected legacy records before importing any private copies', async () => {
    await withTempProject(async (cwd) => {
      await writeLegacy(cwd, 'items', 'copy-before-failure');
      await mkdir(join(cwd, '.backlog', 'items'), { recursive: true });
      await writeFile(join(cwd, '.backlog', 'items', 'bad-selected.md'), '---\nid: other-id\nstatus: candidate\n---\n# Bad Selected\n');

      await expect(importLegacyBacklog(cwd, { kind: 'items', ids: ['copy-before-failure', 'bad-selected'] })).rejects.toThrow(/id mismatch/);
      expect(existsSync(resolveBacklogItemPath(cwd, 'copy-before-failure'))).toBe(false);
      expect(existsSync(resolveBacklogItemPath(cwd, 'bad-selected'))).toBe(false);
      expect(existsSync(resolveLegacyBacklogItemPath(cwd, 'copy-before-failure'))).toBe(true);
    });
  });

  it('validates selected legacy epic records before importing any private epic copies', async () => {
    await withTempProject(async (cwd) => {
      await writeLegacy(cwd, 'epics', 'epic-before-failure');
      await mkdir(join(cwd, '.backlog', 'epics'), { recursive: true });
      await writeFile(join(cwd, '.backlog', 'epics', 'bad-epic.md'), '---\nid: nested/epic\nstatus: candidate\n---\n# Bad Epic\n');

      await expect(importLegacyBacklog(cwd, { kind: 'epics', ids: ['epic-before-failure', 'bad-epic'] })).rejects.toThrow(/Unsafe/);
      expect(existsSync(resolveBacklogEpicPath(cwd, 'epic-before-failure'))).toBe(false);
      expect(existsSync(resolveBacklogEpicPath(cwd, 'bad-epic'))).toBe(false);
      expect(existsSync(resolveLegacyBacklogEpicPath(cwd, 'epic-before-failure'))).toBe(true);
    });
  });

  it('projects merged visible records through list-board with private duplicate precedence', async () => {
    await withTempProject(async (cwd) => {
      await writeLegacy(cwd, 'items', 'board-legacy', 'planned', 'Board Legacy');
      await writeLegacy(cwd, 'items', 'board-dup', 'candidate', 'Board Legacy Duplicate');
      await writeBacklogItem(cwd, { id: 'board-dup', status: 'active', body: '# Board Private Duplicate\n' });

      const listed = await dispatchExtensionAction(loadRegistry(cwd), {
        actionId: 'eforge-plan:list-board',
        input: {},
        requestedBy: { host: 'pi' },
        cwd,
        timeoutMs: 1000,
      });

      expect(listed).toMatchObject({ kind: 'success' });
      if (listed.kind !== 'success') throw new Error(listed.message);
      const output = listed.output as { items: Array<{ id: string; status: string; title: string }> };
      expect(output.items.map((item) => `${item.id}:${item.status}:${item.title}`).sort()).toEqual([
        'board-dup:active:Board Private Duplicate',
        'board-legacy:planned:Board Legacy',
      ]);
    });
  });

  it('reports snapshots for visible records', async () => {
    await withTempProject(async (cwd) => {
      await writeLegacy(cwd, 'items', 'legacy-snap');
      await writeBacklogItem(cwd, { id: 'private-snap', status: 'candidate', updated: '2026-01-02T00:00:00.000Z', body: '# Private Snap\n' });
      const itemSnapshots = await listBacklogItemSnapshots(cwd);
      expect(itemSnapshots.map((snapshot) => [snapshot.id, snapshot.origin])).toEqual([['legacy-snap', 'legacy'], ['private-snap', 'private']]);
      const privateSnapshot = await readBacklogItemSnapshot(cwd, 'private-snap');
      const legacySnapshot = await readBacklogItemSnapshot(cwd, 'legacy-snap');
      expect(privateSnapshot).toMatchObject({ origin: 'private', relativePath: '.eforge/storage/extensions/eforge-plan/backlog/items/private-snap.md', updated: '2026-01-02T00:00:00.000Z' });
      expect(legacySnapshot).toMatchObject({ origin: 'legacy', relativePath: '.backlog/items/legacy-snap.md' });
      expect(privateSnapshot?.bodySha256).toMatch(/^[a-f0-9]{64}$/);
      expect(privateSnapshot?.recordSha256).toMatch(/^[a-f0-9]{64}$/);

      await writeLegacy(cwd, 'epics', 'legacy-epic-snap');
      expect((await listBacklogEpicSnapshots(cwd))[0]).toMatchObject({ id: 'legacy-epic-snap', origin: 'legacy' });
      expect(await readBacklogEpicSnapshot(cwd, 'legacy-epic-snap')).toMatchObject({ origin: 'legacy' });
    });
  });

  it('dispatches update and promote actions against legacy-only items through private storage', async () => {
    await withTempProject(async (cwd) => {
      const registry = loadRegistry(cwd);
      const updateRaw = await writeLegacy(cwd, 'items', 'action-update-legacy', 'candidate', 'Action Update Legacy');
      const promotedRaw = await writeLegacy(cwd, 'items', 'action-promote-legacy', 'candidate', 'Action Promote Legacy');

      const updated = await dispatchExtensionAction(registry, { actionId: 'eforge-plan:update-item', input: { id: 'action-update-legacy', status: 'planned', tags: ['via-action'] }, requestedBy: { host: 'pi' }, cwd, timeoutMs: 1000 });
      expect(updated).toMatchObject({ kind: 'success' });
      if (updated.kind !== 'success') throw new Error(updated.message);
      expect(await readFile(resolveLegacyBacklogItemPath(cwd, 'action-update-legacy'), 'utf-8')).toBe(updateRaw);
      expect(existsSync(resolveBacklogItemPath(cwd, 'action-update-legacy'))).toBe(true);
      expect(await readBacklogItem(cwd, 'action-update-legacy')).toMatchObject({ status: 'planned', tags: ['via-action'], body: expect.stringContaining('Legacy body') });

      const promoted = await dispatchExtensionAction(registry, { actionId: 'eforge-plan:promote-item', input: { itemId: 'action-promote-legacy', status: 'active', session: 'legacy-promoted-session' }, requestedBy: { host: 'pi' }, cwd, timeoutMs: 1000 });
      expect(promoted).toMatchObject({ kind: 'success' });
      if (promoted.kind !== 'success') throw new Error(promoted.message);
      expect(await readFile(resolveLegacyBacklogItemPath(cwd, 'action-promote-legacy'), 'utf-8')).toBe(promotedRaw);
      expect(existsSync(resolveBacklogItemPath(cwd, 'action-promote-legacy'))).toBe(true);
      expect(await readBacklogItem(cwd, 'action-promote-legacy')).toMatchObject({ status: 'active', body: expect.stringContaining('Legacy body') });
    });
  });

  it('dispatches actions with private paths and legacy import side effects', async () => {
    await withTempProject(async (cwd) => {
      const registry = loadRegistry(cwd);
      const capture = await dispatchExtensionAction(registry, { actionId: 'eforge-plan:capture-item', input: { title: 'Captured Item', claim: 'Claim.' }, requestedBy: { host: 'pi' }, cwd, timeoutMs: 1000 });
      expect(capture).toMatchObject({ kind: 'success' });
      if (capture.kind !== 'success') throw new Error(capture.message);
      expect((capture.output as { path: string }).path).toMatch(/^\.eforge\/storage\/extensions\/eforge-plan\/backlog\/items\//);

      const epic = await dispatchExtensionAction(registry, { actionId: 'eforge-plan:upsert-epic', input: { title: 'Captured Epic' }, requestedBy: { host: 'pi' }, cwd, timeoutMs: 1000 });
      expect(epic).toMatchObject({ kind: 'success' });
      if (epic.kind !== 'success') throw new Error(epic.message);
      expect((epic.output as { path: string }).path).toMatch(/^\.eforge\/storage\/extensions\/eforge-plan\/backlog\/epics\//);

      await writeLegacy(cwd, 'items', 'dispatch-import');
      const imported = await dispatchExtensionAction(registry, { actionId: 'eforge-plan:import-legacy-backlog', input: { kind: 'items', ids: ['dispatch-import'] }, requestedBy: { host: 'pi' }, cwd, timeoutMs: 1000 });
      expect(imported).toMatchObject({ kind: 'success' });
      if (imported.kind !== 'success') throw new Error(imported.message);
      expect((imported.output as { items: { copied: unknown[] } }).items.copied).toHaveLength(1);
    });
  });
});
