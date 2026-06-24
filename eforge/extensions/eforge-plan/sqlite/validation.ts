import { EforgePlanStoreError } from './errors.js';

export function validateDomain<T extends string>(field: string, value: string, allowed: readonly T[]): asserts value is T {
  if ((allowed as readonly string[]).includes(value)) return;
  throw new EforgePlanStoreError('invalid-input', `Invalid ${field}: ${value}. Allowed values: ${allowed.join(', ')}`);
}
