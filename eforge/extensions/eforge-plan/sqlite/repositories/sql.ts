import type { EforgePlanStore, JsonValue } from '../types.js';
import { EforgePlanStoreError } from '../errors.js';
import { assertWritable, getDatabase, type SqliteRow, type SqliteValue } from '../store-internal.js';

export function one<T>(store: EforgePlanStore, sql: string, ...params: SqliteValue[]): T | undefined {
  return getDatabase(store).prepare(sql).get(...params) as T | undefined;
}
export function all<T>(store: EforgePlanStore, sql: string, ...params: SqliteValue[]): T[] {
  return getDatabase(store).prepare(sql).all(...params) as T[];
}
export function run(store: EforgePlanStore, sql: string, ...params: SqliteValue[]): void {
  assertWritable(store);
  getDatabase(store).prepare(sql).run(...params);
}
export function execWritable(store: EforgePlanStore, sql: string): void { assertWritable(store); getDatabase(store).exec(sql); }

export function boolToInt(value: boolean | undefined, defaultValue: boolean): number { return (value ?? defaultValue) ? 1 : 0; }
export function intToBool(value: unknown): boolean { return Number(value) === 1; }
export function optionalString(value: unknown): string | undefined { return typeof value === 'string' ? value : undefined; }
export function optionalNumber(value: unknown): number | undefined { return typeof value === 'number' ? value : undefined; }
export function jsonText(value: JsonValue | undefined, defaultValue?: JsonValue): string | null {
  if (value === undefined) return defaultValue === undefined ? null : JSON.stringify(defaultValue);
  return JSON.stringify(value);
}
export function parseJsonColumn<T extends JsonValue>(table: string, column: string, value: unknown, fallback?: T): T {
  if (value === null || value === undefined) {
    if (fallback !== undefined) return fallback;
    return undefined as unknown as T;
  }
  if (typeof value !== 'string') throw new EforgePlanStoreError('invalid-json-column', `${table}.${column} is not text JSON`);
  try { return JSON.parse(value) as T; } catch (cause) { throw new EforgePlanStoreError('invalid-json-column', `Invalid JSON in ${table}.${column}`, { cause }); }
}
export function nowIso(): string { return new Date().toISOString(); }
export function cleanUndefined<T extends Record<string, unknown>>(input: T): T {
  for (const key of Object.keys(input)) if (input[key] === undefined) delete input[key];
  return input;
}
export type { SqliteRow };
