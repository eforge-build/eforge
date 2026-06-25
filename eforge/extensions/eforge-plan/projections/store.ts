import { existsSync } from 'node:fs';
import { openEforgePlanStore, resolveEforgePlanStorePath, type EforgePlanStore } from '../sqlite/index.js';

export function projectionStoreExists(cwd: string): boolean { return existsSync(resolveEforgePlanStorePath(cwd)); }

export async function withProjectionStore<T>(cwd: string, fn: (store: EforgePlanStore) => T | Promise<T>, missing: () => T | Promise<T>): Promise<T> {
  if (!projectionStoreExists(cwd)) return missing();
  const store = openEforgePlanStore(cwd, { create: false, migrate: true, readonly: true });
  try { return await fn(store); } finally { store.close(); }
}
