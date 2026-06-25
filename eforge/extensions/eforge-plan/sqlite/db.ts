import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { EFORGE_PLAN_STORE_FILENAME, EFORGE_PLAN_STORE_RELATIVE_DIR, LATEST_EFORGE_PLAN_SCHEMA_VERSION } from './constants.js';
import { EforgePlanStoreError } from './errors.js';
import { assertFts5Available, assertSearchFtsObjectsExist } from './fts.js';
import { applyMigrations, verifyMigrations } from './migrations.js';
import { getDatabase, getStoreState, registerStore, setClosed } from './store-internal.js';
import type { EforgePlanStore, StoreOpenOptions } from './types.js';

export function resolveEforgePlanStorePath(cwd: string): string { return join(cwd, EFORGE_PLAN_STORE_RELATIVE_DIR, EFORGE_PLAN_STORE_FILENAME); }
export function getEforgePlanSchemaVersion(store: EforgePlanStore): number { return (getDatabase(store).prepare('PRAGMA user_version').get() as { user_version: number }).user_version; }

export function openEforgePlanStore(cwd: string, options: StoreOpenOptions = {}): EforgePlanStore {
  const create = options.create ?? true;
  const migrate = options.migrate ?? true;
  const readonly = options.readonly ?? false;
  const dbPath = resolveEforgePlanStorePath(cwd);
  if (!create && !existsSync(dbPath)) throw new EforgePlanStoreError('open-failed', `eforge-plan SQLite store does not exist: ${dbPath}`);
  try {
    if (!readonly) mkdirSync(dirname(dbPath), { recursive: true });
  } catch (cause) {
    if (cause instanceof EforgePlanStoreError) throw cause;
    throw new EforgePlanStoreError('open-failed', `Failed to create eforge-plan SQLite store directory: ${dirname(dbPath)}`, { cause });
  }
  if (readonly && migrate && existsSync(dbPath)) {
    const migrated = openEforgePlanStore(cwd, { create: false, migrate: true, readonly: false });
    migrated.close();
  }
  let store!: EforgePlanStore;
  let db: DatabaseSync;
  try {
    db = readonly ? new DatabaseSync(dbPath, { readOnly: true }) : new DatabaseSync(dbPath);
  } catch (cause) {
    if (cause instanceof EforgePlanStoreError) throw cause;
    throw new EforgePlanStoreError('open-failed', `Failed to open eforge-plan SQLite store: ${dbPath}`, { cause });
  }
  store = {
    path: dbPath,
    readonly,
    transaction<T>(callback: () => T): T {
      const state = getStoreState(store);
      if (state.transactionDepth > 0) {
        state.transactionDepth += 1;
        try { return callback(); } finally { state.transactionDepth -= 1; }
      }
      state.db.exec(readonly ? 'BEGIN' : 'BEGIN IMMEDIATE');
      state.transactionDepth = 1;
      try {
        const result = callback();
        state.db.exec('COMMIT');
        return result;
      } catch (error) {
        try { state.db.exec('ROLLBACK'); } finally { state.transactionDepth = 0; }
        throw error;
      } finally {
        if (state.transactionDepth > 0) state.transactionDepth = 0;
      }
    },
    close(): void {
      const state = getStoreState(store);
      state.db.close();
      setClosed(store);
    },
  };
  registerStore(store, { db, readonly, closed: false, transactionDepth: 0 });
  try {
    db.exec('PRAGMA busy_timeout = 5000');
    db.exec('PRAGMA foreign_keys = ON');
    assertFts5Available(store);
    if (!readonly) {
      db.exec('PRAGMA journal_mode = WAL');
      db.exec('PRAGMA synchronous = NORMAL');
      if (migrate) applyMigrations(store);
      else verifyMigrations(store);
    } else {
      verifyMigrations(store);
    }
    if (getEforgePlanSchemaVersion(store) !== LATEST_EFORGE_PLAN_SCHEMA_VERSION) throw new EforgePlanStoreError('schema-mismatch', 'eforge-plan SQLite schema version mismatch');
    assertSearchFtsObjectsExist(store);
    return store;
  } catch (error) {
    try { db.close(); } finally { setClosed(store); }
    throw error;
  }
}
