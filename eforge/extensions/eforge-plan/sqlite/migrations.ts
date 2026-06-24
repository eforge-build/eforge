import { createHash } from 'node:crypto';
import type { EforgePlanStore } from './types.js';
import { INITIAL_MIGRATION_DESCRIPTION, INITIAL_MIGRATION_ID, INITIAL_MIGRATION_NAME, LATEST_EFORGE_PLAN_SCHEMA_VERSION } from './constants.js';
import { EforgePlanStoreError } from './errors.js';
import { INITIAL_SCHEMA_SQL } from './schema.js';
import { getDatabase } from './store-internal.js';

interface Migration { id: string; name: string; description: string; version: number; sql: string }
export const MIGRATIONS: readonly Migration[] = [{ id: INITIAL_MIGRATION_ID, name: INITIAL_MIGRATION_NAME, description: INITIAL_MIGRATION_DESCRIPTION, version: 1, sql: INITIAL_SCHEMA_SQL }];
export function migrationChecksum(sql: string): string { return createHash('sha256').update(sql).digest('hex'); }

export function ensureMigrationTable(store: EforgePlanStore): void {
  getDatabase(store).exec(`CREATE TABLE IF NOT EXISTS schema_migrations (id TEXT PRIMARY KEY, name TEXT NOT NULL, checksum TEXT NOT NULL, applied_at TEXT NOT NULL, description TEXT NOT NULL)`);
}

export function applyMigrations(store: EforgePlanStore): void {
  const db = getDatabase(store);
  ensureMigrationTable(store);
  for (const migration of MIGRATIONS) {
    const checksum = migrationChecksum(migration.sql);
    const existing = db.prepare('SELECT checksum FROM schema_migrations WHERE id = ?').get(migration.id) as { checksum: string } | undefined;
    if (existing) {
      if (existing.checksum !== checksum) throw new EforgePlanStoreError('migration-checksum-mismatch', `Migration ${migration.id} checksum mismatch`);
      continue;
    }
    db.exec(migration.sql);
    db.prepare('INSERT INTO schema_migrations (id, name, checksum, applied_at, description) VALUES (?, ?, ?, ?, ?)').run(migration.id, migration.name, checksum, new Date().toISOString(), migration.description);
    db.exec(`PRAGMA user_version = ${migration.version}`);
  }
  verifyMigrations(store);
}

export function verifyMigrations(store: EforgePlanStore): void {
  const db = getDatabase(store);
  const table = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'").get() as { name: string } | undefined;
  if (!table) throw new EforgePlanStoreError('schema-mismatch', 'Missing schema_migrations metadata');
  for (const migration of MIGRATIONS) {
    const row = db.prepare('SELECT checksum FROM schema_migrations WHERE id = ?').get(migration.id) as { checksum: string } | undefined;
    if (!row) throw new EforgePlanStoreError('schema-mismatch', `Missing migration ${migration.id}`);
    const checksum = migrationChecksum(migration.sql);
    if (row.checksum !== checksum) throw new EforgePlanStoreError('migration-checksum-mismatch', `Migration ${migration.id} checksum mismatch`);
  }
  const version = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version;
  if (version !== LATEST_EFORGE_PLAN_SCHEMA_VERSION) throw new EforgePlanStoreError('schema-mismatch', `Expected schema version ${LATEST_EFORGE_PLAN_SCHEMA_VERSION}, found ${version}`);
}
