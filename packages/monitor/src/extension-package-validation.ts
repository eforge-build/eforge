import { ExtensionPackageError } from './extension-package-errors.js';

const VALID_EXT_NAME_RE = /^[A-Za-z0-9._-]+$/;

export function assertValidExtensionName(name: unknown): asserts name is string {
  if (
    typeof name !== 'string' ||
    !VALID_EXT_NAME_RE.test(name) ||
    name === '.' ||
    name === '..'
  ) {
    throw new ExtensionPackageError(`Extension name "${String(name)}" is invalid`, 400);
  }
}

export function assertString(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ExtensionPackageError(`Missing or invalid required field: ${field}`, 400);
  }
}

export function assertOptionalString(value: unknown, field: string): asserts value is string | undefined {
  if (value !== undefined && typeof value !== 'string') {
    throw new ExtensionPackageError(`Invalid field: ${field}`, 400);
  }
}

export function assertOptionalBoolean(value: unknown, field: string): asserts value is boolean | undefined {
  if (value !== undefined && typeof value !== 'boolean') {
    throw new ExtensionPackageError(`Invalid field: ${field}`, 400);
  }
}

export function validateSelector(body: { name?: unknown; path?: unknown }): asserts body is { name?: string; path?: string } {
  assertOptionalString(body.name, 'name');
  assertOptionalString(body.path, 'path');
  if (body.name === undefined && body.path === undefined) {
    throw new ExtensionPackageError('Missing required field: name or path', 400);
  }
  if (body.name !== undefined && body.path !== undefined) {
    throw new ExtensionPackageError('Specify only one of name or path', 400);
  }
  if (body.name !== undefined) {
    assertValidExtensionName(body.name);
  }
}
