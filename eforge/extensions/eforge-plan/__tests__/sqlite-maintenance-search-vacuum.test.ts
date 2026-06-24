import { describe, expect, it } from 'vitest';
import { count, invokeMaintenanceAction, rawDb, seedRetentionMaintenanceStore, withTempMaintenanceProject } from './sqlite-maintenance-fixtures.js';

describe('SQLite maintenance search and vacuum actions', () => {
  it('rebuild-search-index clears requested dirty types while leaving unrelated dirty records', async () => {
    await withTempMaintenanceProject(async (cwd) => {
      seedRetentionMaintenanceStore(cwd);
      const db = rawDb(cwd);
      db.prepare("INSERT OR REPLACE INTO search_index_dirty_records (document_type,document_id,reason,marked_at) VALUES (?,?,?,?)").run('backlog_item', 'item-keep', 'test', '2027-01-01T00:00:00.000Z');
      db.prepare("INSERT OR REPLACE INTO search_index_dirty_records (document_type,document_id,reason,marked_at) VALUES (?,?,?,?)").run('recommendation', 'lane-current', 'test', '2027-01-01T00:00:00.000Z');
      db.close();

      const report = await invokeMaintenanceAction(cwd, 'rebuild-search-index', { types: ['backlog_item'], reason: 'test-maintenance' });

      expect(report).toMatchObject({ schemaVersion: 1, category: 'search-rebuild', status: 'applied', searchRefresh: expect.objectContaining({ clearedDirty: expect.any(Number), refreshed: expect.any(Number) }) });
      const after = rawDb(cwd);
      expect(count(after, "SELECT count(*) AS count FROM search_index_dirty_records WHERE document_type = 'backlog_item'")).toBe(0);
      expect(count(after, "SELECT count(*) AS count FROM search_index_dirty_records WHERE document_type = 'recommendation'")).toBe(1);
      expect(count(after, "SELECT count(*) AS count FROM store_maintenance_runs WHERE categories_json LIKE '%search-rebuild%' AND status = 'applied'")).toBe(1);
      after.close();
    });
  });

  it('optimize-search-index records observable FTS maintenance', async () => {
    await withTempMaintenanceProject(async (cwd) => {
      seedRetentionMaintenanceStore(cwd);

      const report = await invokeMaintenanceAction(cwd, 'optimize-search-index');

      expect(report).toMatchObject({ schemaVersion: 1, category: 'search-optimize', status: 'applied', ok: true, optimizedAt: expect.any(String) });
      const db = rawDb(cwd);
      expect(count(db, "SELECT count(*) AS count FROM store_maintenance_runs WHERE categories_json LIKE '%search-optimize%' AND status = 'applied'")).toBe(1);
      db.close();
    });
  });

  it('vacuum-planning-store reports byte counts, WAL checkpoint metadata, and maintenance recording', async () => {
    await withTempMaintenanceProject(async (cwd) => {
      seedRetentionMaintenanceStore(cwd);

      const report = await invokeMaintenanceAction(cwd, 'vacuum-planning-store', { checkpointWal: true });

      expect(report).toMatchObject({
        schemaVersion: 1,
        status: 'applied',
        beforeBytes: expect.any(Number),
        afterBytes: expect.any(Number),
        walBytesBefore: expect.any(Number),
        walBytesAfter: expect.any(Number),
        shmBytesBefore: expect.any(Number),
        shmBytesAfter: expect.any(Number),
        checkpoint: { requested: true, walBytesBefore: expect.any(Number), walBytesAfter: expect.any(Number) },
      });
      const db = rawDb(cwd);
      expect(count(db, "SELECT count(*) AS count FROM store_maintenance_runs WHERE categories_json LIKE '%vacuum%' AND status = 'applied'")).toBe(1);
      db.close();
    });
  });
});
