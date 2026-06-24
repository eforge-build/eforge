import { createHash } from 'node:crypto';
import { openEforgePlanStore, type EforgePlanStore } from '../sqlite/index.js';

export function withCanonicalStore<T>(cwd: string, fn: (store: EforgePlanStore) => T): T {
  const store = openEforgePlanStore(cwd, { create: true, migrate: true });
  try {
    return fn(store);
  } finally {
    store.close();
  }
}

export function withCanonicalTransaction<T>(cwd: string, fn: (store: EforgePlanStore) => T): T {
  return withCanonicalStore(cwd, (store) => store.transaction(() => fn(store)));
}

export function canonicalNowIso(now = new Date()): string {
  return now.toISOString();
}

export function canonicalSha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function stableCanonicalId(parts: readonly unknown[]): string {
  return canonicalSha256(JSON.stringify(parts)).slice(0, 32);
}
