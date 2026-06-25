import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { dispatchExtensionAction } from '@eforge-build/engine/extensions/action-runtime.js';
import { createExtensionRecorder } from '@eforge-build/engine/extensions/recorder.js';
import eforgePlanExtension from '../index.js';
import {
  listBacklogEpicSnapshots,
  listBacklogEpics,
  listBacklogItemSnapshots,
  listBacklogItems,
  loadBacklogEpics,
  loadBacklogItems,
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

  it('keeps loadBacklog aliases wired to merged private plus legacy listings', async () => {
    await withTempProject(async (cwd) => {
      await writeLegacy(cwd, 'items', 'legacy-alias', 'candidate', 'Legacy Alias Item');
      await writeLegacy(cwd, 'epics', 'legacy-alias-epic', 'candidate', 'Legacy Alias Epic');
      await writeBacklogItem(cwd, { id: 'private-alias', status: 'planned', body: '# Private Alias Item\n' });
      await writeBacklogEpic(cwd, { id: 'private-alias-epic', status: 'planned', body: '# Private Alias Epic\n' });

      expect((await loadBacklogItems(cwd)).map((item) => item.id)).toEqual(['legacy-alias', 'private-alias']);
      expect((await loadBacklogEpics(cwd)).map((epic) => epic.id)).toEqual(['legacy-alias-epic', 'private-alias-epic']);
    });
  });

  it('ignores malformed legacy duplicates shadowed by private records', async () => {
    await withTempProject(async (cwd) => {
      await writeBacklogItem(cwd, { id: 'shadowed', status: 'active', body: '# Private Shadowed\n' });
      await mkdir(join(cwd, '.backlog', 'items'), { recursive: true });
      await writeFile(join(cwd, '.backlog', 'items', 'shadowed.md'), '---\nid: other\nstatus: candidate\n---\n# Bad Shadow\n');

      expect(await listBacklogItems(cwd)).toMatchObject([{ id: 'shadowed', status: 'active' }]);
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

  it('rejects malformed private item and epic frontmatter ids during read and list', async () => {
    await withTempProject(async (cwd) => {
      await mkdir(join(cwd, '.eforge', 'storage', 'extensions', 'eforge-plan', 'backlog', 'items'), { recursive: true });
      await mkdir(join(cwd, '.eforge', 'storage', 'extensions', 'eforge-plan', 'backlog', 'epics'), { recursive: true });
      await writeFile(resolveBacklogItemPath(cwd, 'private-bad'), '---\nid: other-item\nstatus: candidate\n---\n# Bad Item\n');
      await writeFile(resolveBacklogEpicPath(cwd, 'private-bad-epic'), '---\nid: nested/epic\nstatus: candidate\n---\n# Bad Epic\n');

      await expect(readBacklogItem(cwd, 'private-bad')).rejects.toThrow(/id mismatch/);
      await expect(listBacklogItems(cwd)).rejects.toThrow(/id mismatch/);
      await expect(readBacklogEpic(cwd, 'private-bad-epic')).rejects.toThrow(/Unsafe/);
      await expect(listBacklogEpics(cwd)).rejects.toThrow(/Unsafe/);
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

  it('write helpers copy legacy-only visible records into private storage and preserve legacy bytes', async () => {
    await withTempProject(async (cwd) => {
      const itemRaw = await writeLegacy(cwd, 'items', 'legacy-write', 'candidate', 'Legacy Write Item');
      const epicRaw = await writeLegacy(cwd, 'epics', 'legacy-epic-write', 'candidate', 'Legacy Write Epic');

      await writeBacklogItem(cwd, { id: 'legacy-write', status: 'planned', priority: 'high' });
      await writeBacklogEpic(cwd, { id: 'legacy-epic-write', status: 'planned', priority: 'high' });

      expect(await readFile(resolveLegacyBacklogItemPath(cwd, 'legacy-write'), 'utf-8')).toBe(itemRaw);
      expect(await readFile(resolveLegacyBacklogEpicPath(cwd, 'legacy-epic-write'), 'utf-8')).toBe(epicRaw);
      expect(await readFile(resolveBacklogItemPath(cwd, 'legacy-write'), 'utf-8')).toContain('Legacy body for legacy-write.');
      expect(await readFile(resolveBacklogEpicPath(cwd, 'legacy-epic-write'), 'utf-8')).toContain('Legacy body for legacy-epic-write.');
      expect(await readBacklogItem(cwd, 'legacy-write')).toMatchObject({ status: 'planned', priority: 'high', title: 'Legacy Write Item' });
      expect(await readBacklogEpic(cwd, 'legacy-epic-write')).toMatchObject({ status: 'planned', priority: 'high', title: 'Legacy Write Epic' });
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

  it('dispatches capture and epic actions with private paths', async () => {
    await withTempProject(async (cwd) => {
      const registry = loadRegistry(cwd);
      const capture = await dispatchExtensionAction(registry, { actionId: 'eforge-plan:capture-item', input: { title: 'Add captured item flow', claim: 'Add a captured backlog item flow for migration smoke coverage.', acceptanceCriteria: 'Captured item is written to private storage and reports the private path.' }, requestedBy: { host: 'pi' }, cwd, timeoutMs: 1000 });
      expect(capture).toMatchObject({ kind: 'success' });
      if (capture.kind !== 'success') throw new Error(capture.message);
      expect((capture.output as { path: string }).path).toMatch(/^\.eforge\/storage\/extensions\/eforge-plan\/backlog\/items\//);

      const epic = await dispatchExtensionAction(registry, { actionId: 'eforge-plan:upsert-epic', input: { title: 'Captured Epic' }, requestedBy: { host: 'pi' }, cwd, timeoutMs: 1000 });
      expect(epic).toMatchObject({ kind: 'success' });
      if (epic.kind !== 'success') throw new Error(epic.message);
      expect((epic.output as { path: string }).path).toMatch(/^\.eforge\/storage\/extensions\/eforge-plan\/backlog\/epics\//);
    });
  });
});
