export type JsonSafeValue = null | boolean | number | string | JsonSafeValue[] | { [key: string]: JsonSafeValue };

export function toJsonSafeObject<T extends object>(value: T): T {
  const projected = toJsonSafeValue(value);
  if (!isPlainRecord(projected)) {
    throw new Error('Extension action output must be a JSON object at the root.');
  }
  // The runtime projection strips undefined/non-JSON values but is a structural
  // identity for already-JSON-safe input, so preserve the caller's type. This
  // makes action handlers type-check their constructed payload against the
  // declared outputSchema instead of erasing it to Record<string, JsonSafeValue>.
  return projected as unknown as T;
}

// Erase a precisely-typed value to an opaque JSON record. Use this only at
// boundaries the output schema intentionally models as `Record<string, JsonValue>`
// (e.g. third-party shapes with no TypeBox mirror); prefer toJsonSafeObject
// elsewhere so handler payloads stay type-checked against their schema.
export function toJsonSafeRecord(value: unknown): Record<string, JsonSafeValue> {
  const projected = toJsonSafeValue(value);
  if (!isPlainRecord(projected)) {
    throw new Error('Expected a JSON object at the root.');
  }
  return projected;
}

export function toJsonSafeValue(value: unknown): JsonSafeValue {
  const seen = new WeakSet<object>();
  const projected = projectJsonSafeValue(value, '$', seen);
  if (projected === undefined) {
    throw new Error('Extension action output must not be undefined at the root.');
  }
  return projected;
}

function projectJsonSafeValue(value: unknown, path: string, seen: WeakSet<object>): JsonSafeValue | undefined {
  if (value === undefined) return undefined;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`Extension action output contains a non-finite number at ${path}.`);
    return value;
  }
  if (typeof value === 'bigint' || typeof value === 'symbol' || typeof value === 'function') {
    throw new Error(`Extension action output contains a non-JSON value at ${path}.`);
  }
  if (value instanceof Date) throw new Error(`Extension action output contains a Date at ${path}.`);
  if (value instanceof Map || value instanceof Set) throw new Error(`Extension action output contains a collection at ${path}.`);
  if (Array.isArray(value)) {
    assertNoSymbolKeys(value, path);
    if (seen.has(value)) throw new Error(`Extension action output contains a cycle at ${path}.`);
    seen.add(value);
    const entries = value
      .map((entry, index) => projectJsonSafeValue(entry, `${path}[${index}]`, seen))
      .filter((entry): entry is JsonSafeValue => entry !== undefined);
    seen.delete(value);
    return entries;
  }
  if (!isPlainObject(value)) {
    throw new Error(`Extension action output contains a non-plain object at ${path}.`);
  }
  assertNoSymbolKeys(value, path);
  if (seen.has(value)) throw new Error(`Extension action output contains a cycle at ${path}.`);
  seen.add(value);
  const projected = Object.create(null) as Record<string, JsonSafeValue>;
  for (const [key, entry] of Object.entries(value)) {
    const child = projectJsonSafeValue(entry, `${path}.${key}`, seen);
    if (child !== undefined) projected[key] = child;
  }
  seen.delete(value);
  return projected;
}

function assertNoSymbolKeys(value: object, path: string): void {
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new Error(`Extension action output contains a non-JSON symbol key at ${path}.`);
  }
}

function isPlainObject(value: object): value is Record<string, unknown> {
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isPlainRecord(value: JsonSafeValue): value is Record<string, JsonSafeValue> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
