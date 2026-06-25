import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import {
  EforgePlanStoreError,
  getEforgePlanSchemaVersion,
  openEforgePlanStore,
  resolveEforgePlanStorePath,
  upsertBacklogItem,
} from '../sqlite/index.js';
import { getDatabase } from '../sqlite/store-internal.js';

function tempProject(): string {
  return mkdtempSync(join(tmpdir(), 'eforge-plan-sqlite-'));
}

function openRaw(path: string): DatabaseSync {
  return new DatabaseSync(path, {});
}

function scalar<T>(db: DatabaseSync, sql: string, column: string): T {
  return (db.prepare(sql).get() as Record<string, T>)[column];
}

describe('eforge-plan SQLite storage schema', () => {
  it('resolves the private project-local store path and creates the database on first open', () => {
    const cwd = tempProject();
    const dbPath = resolveEforgePlanStorePath(cwd);

    expect(dbPath).toMatch(new RegExp(`\\${sep}.eforge\\${sep}storage\\${sep}extensions\\${sep}eforge-plan\\${sep}eforge-plan-private\\.sqlite$`));
    expect(existsSync(dbPath)).toBe(false);

    const store = openEforgePlanStore(cwd, { create: true, migrate: true });

    expect(existsSync(dbPath)).toBe(true);
    expect(store.path).toBe(dbPath);
    expect(getEforgePlanSchemaVersion(store)).toBe(2);
    store.close();
  });

  it('records immutable migration metadata and is idempotent when reopened', () => {
    const cwd = tempProject();
    const store = openEforgePlanStore(cwd, { create: true, migrate: true });
    const dbPath = store.path;
    store.close();

    for (let i = 0; i < 2; i += 1) {
      openEforgePlanStore(cwd, { create: true, migrate: true }).close();
    }

    const raw = openRaw(dbPath);
    expect(scalar<number>(raw, 'PRAGMA user_version', 'user_version')).toBe(2);
    expect(raw.prepare('SELECT id, checksum, description FROM schema_migrations ORDER BY id').all()).toEqual([
      expect.objectContaining({
        id: '1',
        description: 'initial eforge-plan SQLite schema',
        checksum: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
      expect.objectContaining({
        id: '2',
        description: 'drop one-time legacy importer SQLite tables',
        checksum: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    ]);
    raw.close();
  });

  it('fails with actionable store errors for missing files, readonly writes, and checksum drift', () => {
    const missingCwd = tempProject();
    expect(() => openEforgePlanStore(missingCwd, { create: false })).toThrow(EforgePlanStoreError);
    expect(() => openEforgePlanStore(missingCwd, { create: false })).toThrow(/does not exist/);

    const cwd = tempProject();
    openEforgePlanStore(cwd).close();

    const readonly = openEforgePlanStore(cwd, { readonly: true });
    expect(readonly.readonly).toBe(true);
    expect(() => upsertBacklogItem(readonly, { id: 'readonly', title: 'Readonly', userStatus: 'candidate' })).toThrow(
      expect.objectContaining({ code: 'readonly-store' }),
    );
    readonly.close();

    const tamper = openRaw(resolveEforgePlanStorePath(cwd));
    tamper.prepare("UPDATE schema_migrations SET checksum = 'tampered' WHERE id = '1'").run();
    tamper.close();

    expect(() => openEforgePlanStore(cwd)).toThrow(expect.objectContaining({ code: 'migration-checksum-mismatch' }));
  });

  it('enables required SQLite pragmas for every open writable store', () => {
    const store = openEforgePlanStore(tempProject());

    const db = getDatabase(store);
    expect(scalar<number>(db, 'PRAGMA foreign_keys', 'foreign_keys')).toBe(1);
    expect(scalar<number>(db, 'PRAGMA busy_timeout', 'timeout')).toBe(5000);
    expect(String(scalar<string>(db, 'PRAGMA journal_mode', 'journal_mode')).toLowerCase()).toBe('wal');
    expect(String(scalar<string>(db, 'PRAGMA synchronous', 'synchronous')).toUpperCase()).toMatch(/^(1|NORMAL)$/);
    store.close();
  });

  it('creates the v1 canonical tables, indexes, and FTS5 virtual table', () => {
    const store = openEforgePlanStore(tempProject());
    const raw = openRaw(store.path);

    const names = new Set(
      raw.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','index')").all().map((row) => (row as { name: string }).name),
    );

    for (const table of [
      'schema_migrations',
      'backlog_items',
      'backlog_item_tags',
      'backlog_item_sections',
      'epics',
      'epic_tags',
      'epic_sections',
      'item_dependencies',
      'recommendation_runs',
      'recommendation_lanes',
      'recommendation_lane_items',
      'planning_tasks',
      'planning_task_items',
      'planning_task_epics',
      'planning_task_recommendation_refs',
      'session_plans',
      'session_plan_items',
      'session_plan_epics',
      'queue_prds',
      'build_runs',
      'build_sessions',
      'landing_links',
      'lifecycle_events',
      'lifecycle_evidence',
      'store_maintenance_runs',
      'search_documents',
      'search_documents_fts',
      'search_index_state',
      'search_index_dirty_records',
    ]) {
      expect(names.has(table), `missing table ${table}`).toBe(true);
    }

    for (const index of [
      'idx_backlog_items_status',
      'idx_backlog_items_updated',
      'idx_backlog_item_tags_tag',
      'idx_item_dependencies_ref',
      'idx_item_dependencies_resolved',
      'idx_epics_status',
      'idx_epic_tags_tag',
      'idx_recommendation_runs_current',
      'idx_recommendation_lanes_run_kind',
      'idx_session_plan_items_item',
      'idx_lifecycle_evidence_current_item',
      'idx_search_dirty_records_marked',
    ]) {
      expect(names.has(index), `missing index ${index}`).toBe(true);
    }

    const ftsSql = raw.prepare("SELECT sql FROM sqlite_master WHERE name = 'search_documents_fts'").get() as { sql: string };
    expect(ftsSql.sql.toLowerCase()).toContain('fts5');
    raw.close();
    store.close();
  });

  it('enforces foreign keys and domain CHECK constraints in canonical tables', () => {
    const store = openEforgePlanStore(tempProject());
    const raw = openRaw(store.path);

    expect(() => raw.prepare("INSERT INTO backlog_items (id,title,user_status) VALUES ('bad','Bad','blocked')").run()).toThrow();
    expect(() => raw.prepare("INSERT INTO backlog_item_tags (item_id,tag) VALUES ('missing','x')").run()).toThrow();
    expect(() => raw.prepare("INSERT INTO recommendation_lanes (lane_id,run_id,lane_kind) VALUES ('l','missing','wrong')").run()).toThrow();
    expect(() => raw.prepare("INSERT INTO lifecycle_evidence (evidence_key,item_ref,lifecycle_state) VALUES ('e','item','invalid')").run()).toThrow();
    expect(() => raw.prepare("INSERT INTO search_documents (document_type,document_id,dirty) VALUES ('backlog_item','doc',2)").run()).toThrow();

    raw.close();
    store.close();
  });

  it('commits successful transactions and rolls back all writes when callbacks throw', () => {
    const store = openEforgePlanStore(tempProject());
    const raw = openRaw(store.path);

    store.transaction(() => {
      upsertBacklogItem(store, { id: 'committed', title: 'Committed', userStatus: 'candidate' });
    });
    expect(raw.prepare("SELECT id FROM backlog_items WHERE id = 'committed'").get()).toMatchObject({ id: 'committed' });

    expect(() =>
      store.transaction(() => {
        upsertBacklogItem(store, { id: 'rollback', title: 'Rollback', userStatus: 'candidate' });
        store.transaction(() => {
          upsertBacklogItem(store, { id: 'nested-rollback', title: 'Nested', userStatus: 'candidate' });
        });
        throw new Error('rollback');
      }),
    ).toThrow('rollback');

    expect(raw.prepare("SELECT id FROM backlog_items WHERE id IN ('rollback','nested-rollback')").all()).toEqual([]);
    raw.close();
    store.close();
  });
});
