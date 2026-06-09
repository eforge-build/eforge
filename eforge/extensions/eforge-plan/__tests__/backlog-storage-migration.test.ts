import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { dispatchExtensionAction } from '../../../../packages/engine/src/extensions/action-runtime.js';
import { createExtensionRecorder } from '../../../../packages/engine/src/extensions/recorder.js';
import type { NativeExtensionRecorderState, NativeExtensionRegistry } from '../../../../packages/engine/src/extensions/types.js';
import eforgePlanExtension from '../index.js';
import {
  importLegacyBacklog,
  listBacklogEpicSnapshots,
  listBacklogEpics,
  listBacklogItemSnapshots,
  listBacklogItems,
  readBacklogEpic,
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

function registryFromRecorderState(state: NativeExtensionRecorderState): NativeExtensionRegistry {
  return { ...state, extensions: [], candidates: [] };
}

function loadRegistry(): NativeExtensionRegistry {
  const { api, state } = createExtensionRecorder('eforge-plan', '/project/eforge/extensions/eforge-plan/index.ts');
  eforgePlanExtension(api as never);
  expect(state.diagnostics).toEqual([]);
  return registryFromRecorderState(state);
}

async function writeLegacyItem(cwd: string, id: string, status: string, body = `# ${id}\n`): Promise<string> {
  const filePath = resolveLegacyBacklogItemPath(cwd, id);
  await mkdir(join(cwd, '.backlog', 'items'), { recursive: true });
  await writeFile(filePath, `---\nid: ${id}\nstatus: ${status}\n---\n${body}`);
  return filePath;
}

async function writeLegacyEpic(cwd: string, id: string, status: string, body = `# ${id}\n`): Promise<string> {
  const filePath = resolveLegacyBacklogEpicPath(cwd, id);
  await mkdir(join(cwd, '.backlog', 'epics'), { recursive: true });
  await writeFile(filePath, `---\nid: ${id}\nstatus: ${status}\n---\n${body}`);
  return filePath;
}

describe('eforge-plan backlog storage migration', () => {
  it('resolves canonical private paths and explicit legacy paths', async () => {
    await withTempProject(async (cwd) => {
      expect(resolveBacklogItemPath(cwd, 'item-one')).toContain(`${sep}.eforge${sep}storage${sep}extensions${sep}eforge-plan${sep}backlog${sep}items${sep}item-one.md`);
      expect(resolveBacklogEpicPath(cwd, 'epic-one')).toContain(`${sep}.eforge${sep}storage${sep}extensions${sep}eforge-plan${sep}backlog${sep}epics${sep}epic-one.md`);
      expect(resolveBacklogItemPath(cwd, 'item-one')).not.toContain(`${sep}.backlog${sep}items${sep}`);
      expect(resolveBacklogEpicPath(cwd, 'epic-one')).not.toContain(`${sep}.backlog${sep}epics${sep}`);
      expect(resolveLegacyBacklogItemPath(cwd, 'item-one')).toContain(`${sep}.backlog${sep}items${sep}item-one.md`);
      expect(resolveLegacyBacklogEpicPath(cwd, 'epic-one')).toContain(`${sep}.backlog${sep}epics${sep}epic-one.md`);
      for (const unsafe of ['', '.', '..', 'a/b', 'a\\b']) {
        expect(() => resolveBacklogItemPath(cwd, unsafe)).toThrow();
        expect(() => resolveBacklogEpicPath(cwd, unsafe)).toThrow();
        expect(() => resolveLegacyBacklogItemPath(cwd, unsafe)).toThrow();
        expect(() => resolveLegacyBacklogEpicPath(cwd, unsafe)).toThrow();
      }
    });
  });

  it('reads and lists mixed private and legacy records with private precedence and sorted IDs', async () => {
    await withTempProject(async (cwd) => {
      await writeLegacyItem(cwd, 'b-legacy', 'candidate', '# Legacy B\n');
      await writeLegacyItem(cwd, 'dup', 'candidate', '# Legacy Dup\n');
      await writeBacklogItem(cwd, { id: 'a-private', status: 'active', body: '# Private A\n' });
      await writeBacklogItem(cwd, { id: 'dup', status: 'planned', body: '# Private Dup\n' });
      await writeLegacyEpic(cwd, 'legacy-epic', 'candidate', '# Legacy Epic\n');
      await writeLegacyEpic(cwd, 'dup-epic', 'candidate', '# Legacy Dup Epic\n');
      await writeBacklogEpic(cwd, { id: 'dup-epic', status: 'active', body: '# Private Dup Epic\n' });

      expect(await readBacklogItem(cwd, 'b-legacy')).toMatchObject({ id: 'b-legacy', title: 'Legacy B' });
      expect(await readBacklogEpic(cwd, 'legacy-epic')).toMatchObject({ id: 'legacy-epic', title: 'Legacy Epic' });
      expect(await readBacklogItem(cwd, 'dup')).toMatchObject({ status: 'planned', title: 'Private Dup' });
      expect((await listBacklogItems(cwd)).map((item) => `${item.id}:${item.status}`)).toEqual(['a-private:active', 'b-legacy:candidate', 'dup:planned']);
      expect((await listBacklogEpics(cwd)).map((epic) => `${epic.id}:${epic.status}`)).toEqual(['dup-epic:active', 'legacy-epic:candidate']);
    });
  });

  it('rejects malformed IDs from filenames and frontmatter while reading and listing', async () => {
    await withTempProject(async (cwd) => {
      await mkdir(join(cwd, '.backlog', 'items'), { recursive: true });
      await writeFile(resolveLegacyBacklogItemPath(cwd, 'mismatch'), '---\nid: other\nstatus: candidate\n---\n# Mismatch\n');
      await expect(readBacklogItem(cwd, 'mismatch')).rejects.toThrow(/mismatch/);
      await expect(listBacklogItems(cwd)).rejects.toThrow(/mismatch/);
      await rm(resolveLegacyBacklogItemPath(cwd, 'mismatch'));
      await writeFile(resolveLegacyBacklogItemPath(cwd, 'bad-frontmatter'), '---\nid: nested/item\nstatus: candidate\n---\n# Bad\n');
      await expect(listBacklogItems(cwd)).rejects.toThrow(/Unsafe/);
    });
  });

  it('updates legacy-only records by creating private files while preserving legacy bytes', async () => {
    await withTempProject(async (cwd) => {
      const itemLegacy = await writeLegacyItem(cwd, 'legacy-item', 'candidate', '# Legacy Item\n\nKeep body.\n');
      const epicLegacy = await writeLegacyEpic(cwd, 'legacy-epic', 'candidate', '# Legacy Epic\n\nKeep epic body.\n');
      const itemBytes = await readFile(itemLegacy, 'utf-8');
      const epicBytes = await readFile(epicLegacy, 'utf-8');

      await updateBacklogItemFrontmatter(cwd, 'legacy-item', { status: 'active', tags: ['new'] });
      await updateBacklogEpicFrontmatter(cwd, 'legacy-epic', { status: 'planned', tags: ['epic'] });

      expect(existsSync(resolveBacklogItemPath(cwd, 'legacy-item'))).toBe(true);
      expect(existsSync(resolveBacklogEpicPath(cwd, 'legacy-epic'))).toBe(true);
      expect(await readFile(itemLegacy, 'utf-8')).toBe(itemBytes);
      expect(await readFile(epicLegacy, 'utf-8')).toBe(epicBytes);
      expect(await readBacklogItem(cwd, 'legacy-item')).toMatchObject({ status: 'active', body: '# Legacy Item\n\nKeep body.\n' });
      expect(await readBacklogEpic(cwd, 'legacy-epic')).toMatchObject({ status: 'planned', body: '# Legacy Epic\n\nKeep epic body.\n' });
    });
  });

  it('imports legacy records, skips private duplicates, leaves legacy files, and reports private paths', async () => {
    await withTempProject(async (cwd) => {
      await writeLegacyItem(cwd, 'copy-item', 'candidate');
      await writeLegacyItem(cwd, 'skip-item', 'candidate', '# Legacy Skip\n');
      await writeBacklogItem(cwd, { id: 'skip-item', status: 'active', body: '# Private Skip\n' });
      await writeLegacyEpic(cwd, 'copy-epic', 'candidate');
      await writeLegacyEpic(cwd, 'skip-epic', 'candidate', '# Legacy Skip Epic\n');
      await writeBacklogEpic(cwd, { id: 'skip-epic', status: 'active', body: '# Private Skip Epic\n' });
      const privateBefore = await readFile(resolveBacklogItemPath(cwd, 'skip-item'), 'utf-8');

      const result = await importLegacyBacklog(cwd, { kind: 'all' });

      expect(result.items.copied).toEqual([{ id: 'copy-item', path: '.eforge/storage/extensions/eforge-plan/backlog/items/copy-item.md' }]);
      expect(result.epics.copied).toEqual([{ id: 'copy-epic', path: '.eforge/storage/extensions/eforge-plan/backlog/epics/copy-epic.md' }]);
      expect(result.items.skipped).toEqual([{ id: 'skip-item', reason: 'private-exists' }]);
      expect(result.epics.skipped).toEqual([{ id: 'skip-epic', reason: 'private-exists' }]);
      expect(existsSync(resolveLegacyBacklogItemPath(cwd, 'copy-item'))).toBe(true);
      expect(existsSync(resolveLegacyBacklogEpicPath(cwd, 'copy-epic'))).toBe(true);
      expect(await readFile(resolveBacklogItemPath(cwd, 'skip-item'), 'utf-8')).toBe(privateBefore);
    });
  });

  it('reports snapshots for visible records', async () => {
    await withTempProject(async (cwd) => {
      await writeLegacyItem(cwd, 'legacy-item', 'candidate', '# Legacy\n');
      await writeBacklogItem(cwd, { id: 'private-item', status: 'active', updated: '2026-01-01', body: '# Private\n' });
      await writeBacklogEpic(cwd, { id: 'private-epic', status: 'active', body: '# Private Epic\n' });

      const snapshots = await listBacklogItemSnapshots(cwd);
      expect(snapshots.map((snapshot) => [snapshot.id, snapshot.origin])).toEqual([['legacy-item', 'legacy'], ['private-item', 'private']]);
      const privateSnapshot = await readBacklogItemSnapshot(cwd, 'private-item');
      expect(privateSnapshot).toMatchObject({ kind: 'item', origin: 'private', relativePath: '.eforge/storage/extensions/eforge-plan/backlog/items/private-item.md', updated: '2026-01-01' });
      expect(privateSnapshot?.bodySha256).toMatch(/^[a-f0-9]{64}$/);
      expect(privateSnapshot?.recordSha256).toMatch(/^[a-f0-9]{64}$/);
      expect((await listBacklogEpicSnapshots(cwd))[0]).toMatchObject({ kind: 'epic', origin: 'private' });
    });
  });

  it('actions write private paths, import legacy records, and list visible legacy records', async () => {
    await withTempProject(async (cwd) => {
      await writeLegacyItem(cwd, 'legacy-action', 'candidate', '# Legacy Action\n');
      await writeLegacyItem(cwd, 'duplicate-action', 'candidate', '# Legacy Duplicate\n');
      await writeBacklogItem(cwd, { id: 'duplicate-action', status: 'active', body: '# Private Duplicate\n' });
      const registry = loadRegistry();

      const capture = await dispatchExtensionAction(registry, { actionId: 'eforge-plan:capture-item', input: { title: 'Action Item', claim: 'Captured.' }, requestedBy: { host: 'pi' }, cwd, timeoutMs: 1000 });
      expect(capture).toMatchObject({ kind: 'success' });
      if (capture.kind !== 'success') throw new Error(capture.message);
      expect((capture.output as { path: string }).path).toMatch(/^\.eforge\/storage\/extensions\/eforge-plan\/backlog\/items\//);

      const upsert = await dispatchExtensionAction(registry, { actionId: 'eforge-plan:upsert-epic', input: { title: 'Action Epic' }, requestedBy: { host: 'pi' }, cwd, timeoutMs: 1000 });
      expect(upsert).toMatchObject({ kind: 'success' });
      if (upsert.kind !== 'success') throw new Error(upsert.message);
      expect((upsert.output as { path: string }).path).toMatch(/^\.eforge\/storage\/extensions\/eforge-plan\/backlog\/epics\//);

      const malformedImport = await dispatchExtensionAction(registry, { actionId: 'eforge-plan:import-legacy-backlog', input: { kind: 'items', ids: ['nested/item'] }, requestedBy: { host: 'pi' }, cwd, timeoutMs: 1000 });
      expect(malformedImport).toMatchObject({ kind: 'invalid-input', validationErrors: [expect.objectContaining({ path: '/ids/0' })] });

      const imported = await dispatchExtensionAction(registry, { actionId: 'eforge-plan:import-legacy-backlog', input: { kind: 'items', ids: ['legacy-action'] }, requestedBy: { host: 'pi' }, cwd, timeoutMs: 1000 });
      expect(imported).toMatchObject({ kind: 'success' });
      expect(existsSync(resolveLegacyBacklogItemPath(cwd, 'legacy-action'))).toBe(true);
      expect(existsSync(resolveBacklogItemPath(cwd, 'legacy-action'))).toBe(true);

      const board = await dispatchExtensionAction(registry, { actionId: 'eforge-plan:list-board', input: { includeArchive: false }, requestedBy: { host: 'pi' }, cwd, timeoutMs: 1000 });
      expect(board).toMatchObject({ kind: 'success' });
      if (board.kind !== 'success') throw new Error(board.message);
      const items = (board.output as { items: Array<{ id: string; title: string; status: string }> }).items;
      expect(items.find((item) => item.id === 'legacy-action')).toMatchObject({ title: 'Legacy Action' });
      expect(items.find((item) => item.id === 'duplicate-action')).toMatchObject({ title: 'Private Duplicate', status: 'active' });
    });
  });

  it('update-item action writes private storage for legacy-only items and leaves legacy bytes unchanged', async () => {
    await withTempProject(async (cwd) => {
      const legacyPath = await writeLegacyItem(cwd, 'legacy-update-action', 'candidate', '# Legacy Update Action\n\nPreserve body.\n');
      const legacyBytes = await readFile(legacyPath, 'utf-8');
      const registry = loadRegistry();

      const updated = await dispatchExtensionAction(registry, {
        actionId: 'eforge-plan:update-item',
        input: { id: 'legacy-update-action', status: 'active', tags: ['from-action'] },
        requestedBy: { host: 'pi' },
        cwd,
        timeoutMs: 1000,
      });

      expect(updated).toMatchObject({ kind: 'success' });
      expect(existsSync(resolveBacklogItemPath(cwd, 'legacy-update-action'))).toBe(true);
      expect(await readFile(legacyPath, 'utf-8')).toBe(legacyBytes);
      expect(await readBacklogItem(cwd, 'legacy-update-action')).toMatchObject({
        status: 'active',
        tags: ['from-action'],
        body: '# Legacy Update Action\n\nPreserve body.\n',
      });
    });
  });

  it('promote-item action writes private storage for legacy-only items and leaves legacy bytes unchanged', async () => {
    await withTempProject(async (cwd) => {
      const legacyPath = await writeLegacyItem(cwd, 'legacy-promote-action', 'candidate', '# Legacy Promote Action\n\n## Claim\n\nPromote legacy item.\n');
      const legacyBytes = await readFile(legacyPath, 'utf-8');
      const registry = loadRegistry();

      const promoted = await dispatchExtensionAction(registry, {
        actionId: 'eforge-plan:promote-item',
        input: { itemId: 'legacy-promote-action', status: 'planned', session: 'legacy-promote-session' },
        requestedBy: { host: 'pi' },
        cwd,
        timeoutMs: 1000,
      });

      expect(promoted).toMatchObject({ kind: 'success' });
      expect(existsSync(resolveBacklogItemPath(cwd, 'legacy-promote-action'))).toBe(true);
      expect(await readFile(legacyPath, 'utf-8')).toBe(legacyBytes);
      expect(await readBacklogItem(cwd, 'legacy-promote-action')).toMatchObject({ status: 'planned' });
    });
  });
});
