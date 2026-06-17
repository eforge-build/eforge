import type { ExtensionTestRequest } from '@eforge-build/client';

export const EXTENSION_NAME_RE = /^[A-Za-z0-9._-]+$/;

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function validateBooleanField(body: Record<string, unknown>, field: string): string | undefined {
  return body[field] !== undefined && typeof body[field] !== 'boolean'
    ? `Invalid field: ${field} must be boolean`
    : undefined;
}

export function validateStringField(body: Record<string, unknown>, field: string): string | undefined {
  return body[field] !== undefined && typeof body[field] !== 'string'
    ? `Invalid field: ${field} must be a string`
    : undefined;
}

export function validateExtensionPackageTargetBody(
  body: Record<string, unknown>,
  options: { allowForce?: boolean; allowTrust?: boolean; allowVersion?: boolean } = {},
): string | undefined {
  const hasName = body.name !== undefined;
  const hasPath = body.path !== undefined;
  if (!hasName && !hasPath) return 'Missing required field: name or path';
  if (hasName && hasPath) return 'Specify only one of name or path';
  if (hasName && (typeof body.name !== 'string' || !EXTENSION_NAME_RE.test(body.name))) return 'Invalid extension name';
  if (hasPath && (typeof body.path !== 'string' || body.path.length === 0)) return 'Invalid extension path';
  if (body.force !== undefined && !options.allowForce) return 'Unsupported field: force';
  if (body.trust !== undefined && !options.allowTrust) return 'Unsupported field: trust';
  if (body.trustedBy !== undefined && !options.allowTrust) return 'Unsupported field: trustedBy';
  if (body.version !== undefined && !options.allowVersion) return 'Unsupported field: version';
  if (options.allowForce) {
    const forceError = validateBooleanField(body, 'force');
    if (forceError) return forceError;
  }
  if (options.allowTrust) {
    const trustError = validateBooleanField(body, 'trust');
    if (trustError) return trustError;
    const trustedByError = validateStringField(body, 'trustedBy');
    if (trustedByError) return trustedByError;
  }
  if (options.allowVersion && body.version !== undefined && (typeof body.version !== 'string' || body.version.length === 0)) {
    return 'Invalid field: version must be a non-empty string';
  }
  return undefined;
}

export function validateExtensionTestRequestBody(value: unknown): ExtensionTestRequest | string {
  if (!isPlainObject(value)) return 'Invalid JSON body';
  const body = value as ExtensionTestRequest;
  if (body.name !== undefined && (typeof body.name !== 'string' || !EXTENSION_NAME_RE.test(body.name))) return 'Invalid extension name';
  if (body.path !== undefined && typeof body.path !== 'string') return 'Invalid extension path';
  if (body.name !== undefined && body.path !== undefined) return 'Specify only one of name or path';
  if (body.fixture !== undefined && typeof body.fixture !== 'string') return 'Invalid fixture path';
  if (body.run !== undefined && typeof body.run !== 'string') return 'Invalid run';
  if (body.fixture !== undefined && body.run !== undefined) return 'Specify only one replay source: fixture or run';
  if (body.event !== undefined && (typeof body.event !== 'string' || body.event.trim().length === 0)) return 'Invalid event filter';
  return body;
}
