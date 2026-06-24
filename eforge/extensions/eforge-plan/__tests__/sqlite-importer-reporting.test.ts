import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { runPlanningStoreImport } from '../importer/index.js';
import { openEforgePlanStore, resolveEforgePlanStorePath } from '../sqlite/index.js';
import { getDatabase } from '../sqlite/store-internal.js';

async function temp<T>(fn: (cwd: string) => Promise<T>) { const cwd = await mkdtemp(join(tmpdir(), 'eforge-plan-importer-')); try { return await fn(cwd); } finally { await rm(cwd, { recursive: true, force: true }); } }
async function item(cwd: string, root: string, id: string, extra = '') { await mkdir(join(cwd, root), { recursive: true }); await writeFile(join(cwd, root, `${id}.md`), `---\nid: ${id}\nstatus: candidate\ntags: [one]\ndepends_on: [missing]\n${extra}---\n# ${id}\n\n## Notes\n\nBody\n`); }

describe('sqlite importer reporting', () => {
  it('dry-runs by default without creating SQLite and reports duplicate/orphan diagnostics', async () => {
    await temp(async (cwd) => { await item(cwd, '.eforge/storage/extensions/eforge-plan/backlog/items', 'one'); await item(cwd, '.backlog/items', 'one'); const report = await runPlanningStoreImport(cwd, {}); expect(report).toMatchObject({ dryRun: true, applied: false }); expect(existsSync(resolveEforgePlanStorePath(cwd))).toBe(false); expect(report.diagnostics.map((d) => d.code)).toEqual(expect.arrayContaining(['duplicate-id', 'orphan-ref'])); });
  });
  it('applies idempotently and preserves unresolved dependency refs', async () => {
    await temp(async (cwd) => { await item(cwd, '.eforge/storage/extensions/eforge-plan/backlog/items', 'one'); await runPlanningStoreImport(cwd, { dryRun: false }); await runPlanningStoreImport(cwd, { dryRun: false }); const store = openEforgePlanStore(cwd, { readonly: true }); try { const db = getDatabase(store); expect((db.prepare('SELECT count(*) AS count FROM backlog_items').get() as { count: number }).count).toBe(1); expect(db.prepare('SELECT dependency_ref, resolved_dependency_item_id FROM item_dependencies').get()).toMatchObject({ dependency_ref: 'missing', resolved_dependency_item_id: null }); expect((db.prepare('SELECT count(*) AS count FROM import_runs').get() as { count: number }).count).toBe(1); } finally { store.close(); } });
  });
  it('dry-run replacement leaves existing store bytes in place', async () => {
    await temp(async (cwd) => { const store = openEforgePlanStore(cwd); store.close(); const before = existsSync(resolveEforgePlanStorePath(cwd)); const report = await runPlanningStoreImport(cwd, { replaceExisting: true }); expect(report.replacedExisting).toBe(false); expect(existsSync(resolveEforgePlanStorePath(cwd))).toBe(before); });
  });
});
