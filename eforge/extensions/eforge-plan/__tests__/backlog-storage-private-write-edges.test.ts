import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  importLegacyBacklog,
  listBacklogEpics,
  listBacklogItems,
  loadBacklogEpics,
  loadBacklogItems,
  readBacklogEpic,
  readBacklogItem,
  resolveBacklogEpicPath,
  resolveBacklogItemPath,
  resolveLegacyBacklogEpicPath,
  resolveLegacyBacklogItemPath,
  writeBacklogEpic,
  writeBacklogItem,
} from '../markdown-store.js';

async function withTempProject<T>(fn: (cwd: string) => Promise<T>): Promise<T> {
  const cwd = await mkdtemp(join(tmpdir(), 'eforge-plan-storage-edges-'));
  try {
    return await fn(cwd);
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

async function writeLegacyRecord(filePath: string, raw: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, raw);
}

describe('eforge-plan private backlog storage edge cases', () => {
  it('write helpers promote legacy-only records to private storage while preserving visible markdown bodies', async () => {
    await withTempProject(async (cwd) => {
      const itemLegacyPath = resolveLegacyBacklogItemPath(cwd, 'legacy-item');
      const epicLegacyPath = resolveLegacyBacklogEpicPath(cwd, 'legacy-epic');
      const itemLegacyRaw = '---\nid: legacy-item\nstatus: candidate\npriority: low\ntags:\n  - legacy\n---\n# Legacy Item\n\n## Evidence\n\nKeep item evidence.\n';
      const epicLegacyRaw = '---\nid: legacy-epic\nstatus: candidate\npriority: low\ntags:\n  - legacy\n---\n# Legacy Epic\n\nKeep epic body.\n';
      await writeLegacyRecord(itemLegacyPath, itemLegacyRaw);
      await writeLegacyRecord(epicLegacyPath, epicLegacyRaw);

      const item = await writeBacklogItem(cwd, { id: 'legacy-item', status: 'active', tags: ['private'] });
      const epic = await writeBacklogEpic(cwd, { id: 'legacy-epic', status: 'planned', tags: ['private'] });

      expect(item).toMatchObject({ id: 'legacy-item', status: 'active', tags: ['private'], title: 'Legacy Item' });
      expect(item.body).toBe('# Legacy Item\n\n## Evidence\n\nKeep item evidence.\n');
      expect(epic).toMatchObject({ id: 'legacy-epic', status: 'planned', tags: ['private'], title: 'Legacy Epic' });
      expect(epic.body).toBe('# Legacy Epic\n\nKeep epic body.\n');
      expect(existsSync(resolveBacklogItemPath(cwd, 'legacy-item'))).toBe(true);
      expect(existsSync(resolveBacklogEpicPath(cwd, 'legacy-epic'))).toBe(true);
      expect(await readFile(itemLegacyPath, 'utf-8')).toBe(itemLegacyRaw);
      expect(await readFile(epicLegacyPath, 'utf-8')).toBe(epicLegacyRaw);
    });
  });

  it('rejects private files whose frontmatter IDs do not match their filenames', async () => {
    await withTempProject(async (cwd) => {
      const privatePath = resolveBacklogItemPath(cwd, 'private-mismatch');
      await writeLegacyRecord(privatePath, '---\nid: other-private\nstatus: candidate\n---\n# Private Mismatch\n');

      await expect(readBacklogItem(cwd, 'private-mismatch')).rejects.toThrow(/frontmatter id "other-private" does not match filename id "private-mismatch"/);
      await expect(listBacklogItems(cwd)).rejects.toThrow(/frontmatter id "other-private" does not match filename id "private-mismatch"/);
    });
  });

  it('validates all selected legacy records before importing any private copies', async () => {
    await withTempProject(async (cwd) => {
      await writeLegacyRecord(resolveLegacyBacklogItemPath(cwd, 'copy-first'), '---\nid: copy-first\nstatus: candidate\n---\n# Copy First\n');
      await writeLegacyRecord(resolveLegacyBacklogItemPath(cwd, 'bad-selected'), '---\nid: nested/bad\nstatus: candidate\n---\n# Bad Selected\n');

      await expect(importLegacyBacklog(cwd, { kind: 'items', ids: ['copy-first', 'bad-selected'] })).rejects.toThrow(/Unsafe/);

      expect(existsSync(resolveBacklogItemPath(cwd, 'copy-first'))).toBe(false);
      expect(existsSync(resolveBacklogItemPath(cwd, 'bad-selected'))).toBe(false);
      expect(existsSync(resolveLegacyBacklogItemPath(cwd, 'copy-first'))).toBe(true);
      expect(existsSync(resolveLegacyBacklogItemPath(cwd, 'bad-selected'))).toBe(true);
    });
  });

  it('validates legacy epics before copying legacy items for all-kind imports', async () => {
    await withTempProject(async (cwd) => {
      await writeLegacyRecord(resolveLegacyBacklogItemPath(cwd, 'copy-first'), '---\nid: copy-first\nstatus: candidate\n---\n# Copy First\n');
      await writeLegacyRecord(resolveLegacyBacklogEpicPath(cwd, 'bad-epic'), '---\nid: nested/bad\nstatus: candidate\n---\n# Bad Epic\n');

      await expect(importLegacyBacklog(cwd, { kind: 'all' })).rejects.toThrow(/Unsafe/);

      expect(existsSync(resolveBacklogItemPath(cwd, 'copy-first'))).toBe(false);
      expect(existsSync(resolveBacklogEpicPath(cwd, 'bad-epic'))).toBe(false);
    });
  });

  it('skips malformed legacy duplicates without parsing when private records exist', async () => {
    await withTempProject(async (cwd) => {
      await writeBacklogItem(cwd, { id: 'dup-item', status: 'active', body: '# Private Duplicate\n' });
      await writeLegacyRecord(resolveLegacyBacklogItemPath(cwd, 'dup-item'), '---\nid: nested/bad\nstatus: candidate\n---\n# Bad Duplicate\n');

      expect((await listBacklogItems(cwd)).map((item) => item.id)).toEqual(['dup-item']);
      const result = await importLegacyBacklog(cwd, { kind: 'items', ids: ['dup-item'] });
      expect(result.items).toEqual({ copied: [], skipped: [{ id: 'dup-item', reason: 'private-exists' }] });
    });
  });

  it('deduplicates selected legacy ids before importing', async () => {
    await withTempProject(async (cwd) => {
      await writeLegacyRecord(resolveLegacyBacklogItemPath(cwd, 'selected-item'), '---\nid: selected-item\nstatus: candidate\n---\n# Selected Item\n');

      const result = await importLegacyBacklog(cwd, { kind: 'items', ids: ['selected-item', 'selected-item'] });

      expect(result.items).toEqual({ copied: [{ id: 'selected-item', path: '.eforge/storage/extensions/eforge-plan/backlog/items/selected-item.md' }], skipped: [] });
    });
  });

  it('keeps private duplicate records authoritative after a legacy import skips them', async () => {
    await withTempProject(async (cwd) => {
      await writeLegacyRecord(resolveLegacyBacklogItemPath(cwd, 'dup-item'), '---\nid: dup-item\nstatus: candidate\n---\n# Legacy Duplicate\n');
      await writeBacklogItem(cwd, { id: 'dup-item', status: 'active', body: '# Private Duplicate\n' });
      const privateBefore = await readFile(resolveBacklogItemPath(cwd, 'dup-item'), 'utf-8');

      const result = await importLegacyBacklog(cwd, { kind: 'items', ids: ['dup-item'] });

      expect(result.items).toEqual({ copied: [], skipped: [{ id: 'dup-item', reason: 'private-exists' }] });
      expect(result.epics).toEqual({ copied: [], skipped: [] });
      expect(await readFile(resolveBacklogItemPath(cwd, 'dup-item'), 'utf-8')).toBe(privateBefore);
      expect(await readBacklogItem(cwd, 'dup-item')).toMatchObject({ status: 'active', title: 'Private Duplicate' });
      expect((await listBacklogItems(cwd)).map((item) => item.id)).toEqual(['dup-item']);
    });
  });

  it('keeps load aliases wired to merged private and legacy item and epic listings', async () => {
    await withTempProject(async (cwd) => {
      await writeLegacyRecord(resolveLegacyBacklogItemPath(cwd, 'legacy-item'), '---\nid: legacy-item\nstatus: candidate\n---\n# Legacy Item\n');
      await writeLegacyRecord(resolveLegacyBacklogEpicPath(cwd, 'legacy-epic'), '---\nid: legacy-epic\nstatus: candidate\n---\n# Legacy Epic\n');
      await writeBacklogItem(cwd, { id: 'private-item', status: 'active', body: '# Private Item\n' });
      await writeBacklogEpic(cwd, { id: 'private-epic', status: 'planned', body: '# Private Epic\n' });

      expect((await loadBacklogItems(cwd)).map((item) => `${item.id}:${item.title}`)).toEqual(['legacy-item:Legacy Item', 'private-item:Private Item']);
      expect((await loadBacklogEpics(cwd)).map((epic) => `${epic.id}:${epic.title}`)).toEqual(['legacy-epic:Legacy Epic', 'private-epic:Private Epic']);
      expect(await loadBacklogItems(cwd)).toEqual(await listBacklogItems(cwd));
      expect(await loadBacklogEpics(cwd)).toEqual(await listBacklogEpics(cwd));
    });
  });

  it('imports only selected legacy epics and preserves unrelated legacy epics in place', async () => {
    await withTempProject(async (cwd) => {
      await writeLegacyRecord(resolveLegacyBacklogEpicPath(cwd, 'selected-epic'), '---\nid: selected-epic\nstatus: candidate\n---\n# Selected Epic\n');
      await writeLegacyRecord(resolveLegacyBacklogEpicPath(cwd, 'unselected-epic'), '---\nid: unselected-epic\nstatus: candidate\n---\n# Unselected Epic\n');

      const result = await importLegacyBacklog(cwd, { kind: 'epics', ids: ['selected-epic'] });

      expect(result.items).toEqual({ copied: [], skipped: [] });
      expect(result.epics).toEqual({ copied: [{ id: 'selected-epic', path: '.eforge/storage/extensions/eforge-plan/backlog/epics/selected-epic.md' }], skipped: [] });
      expect(existsSync(resolveBacklogEpicPath(cwd, 'selected-epic'))).toBe(true);
      expect(existsSync(resolveBacklogEpicPath(cwd, 'unselected-epic'))).toBe(false);
      expect(existsSync(resolveLegacyBacklogEpicPath(cwd, 'selected-epic'))).toBe(true);
      expect(existsSync(resolveLegacyBacklogEpicPath(cwd, 'unselected-epic'))).toBe(true);
      expect(await readBacklogEpic(cwd, 'unselected-epic')).toMatchObject({ id: 'unselected-epic', title: 'Unselected Epic' });
    });
  });
});
