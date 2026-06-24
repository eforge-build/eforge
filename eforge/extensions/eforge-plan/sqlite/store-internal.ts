import type { DatabaseSync } from 'node:sqlite';
import type { EforgePlanStore } from './types.js';
import { EforgePlanStoreError } from './errors.js';

export interface InternalStoreState { db: DatabaseSync; readonly: boolean; closed: boolean; transactionDepth: number }
const states = new WeakMap<EforgePlanStore, InternalStoreState>();

export type SqliteValue = string | number | bigint | null | Uint8Array;
export type SqliteRow = Record<string, unknown>;

export function registerStore(store: EforgePlanStore, state: InternalStoreState): void { states.set(store, state); }
export function getStoreState(store: EforgePlanStore): InternalStoreState {
  const state = states.get(store);
  if (!state || state.closed) throw new EforgePlanStoreError('store-closed', 'eforge-plan SQLite store is closed');
  return state;
}
export function getDatabase(store: EforgePlanStore): DatabaseSync { return getStoreState(store).db; }
export function assertWritable(store: EforgePlanStore): void {
  if (getStoreState(store).readonly) throw new EforgePlanStoreError('readonly-store', 'eforge-plan SQLite store was opened read-only');
}
export function setClosed(store: EforgePlanStore): void { const state = states.get(store); if (state) state.closed = true; }
