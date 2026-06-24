import type { EforgePlanStore } from './types.js';
import { EforgePlanStoreError } from './errors.js';
import { getDatabase } from './store-internal.js';

export function assertFts5Available(store: EforgePlanStore): void {
  const db = getDatabase(store);
  db.exec('DROP TABLE IF EXISTS temp.eforge_plan_fts5_probe');
  try {
    db.exec('CREATE VIRTUAL TABLE temp.eforge_plan_fts5_probe USING fts5(content)');
  } catch (cause) {
    throw new EforgePlanStoreError('missing-fts5', 'SQLite FTS5 is not available. Use a Node.js build whose node:sqlite module includes FTS5 support.', { cause });
  } finally {
    try { db.exec('DROP TABLE IF EXISTS temp.eforge_plan_fts5_probe'); } catch {}
  }
}

export function assertSearchFtsObjectsExist(store: EforgePlanStore): void {
  const row = getDatabase(store).prepare("SELECT sql FROM sqlite_master WHERE name = 'search_documents_fts'").get() as { sql?: string } | undefined;
  if (!row?.sql?.toLowerCase().includes('fts5')) {
    throw new EforgePlanStoreError('missing-fts5', 'search_documents_fts FTS5 table is missing from the eforge-plan store schema');
  }
}
