import { ExtensionActionUserError, type ExtensionActionUserErrorDetail } from '@eforge-build/extension-sdk';

export function userError(message: string, path = '', extra?: Record<string, unknown>): ExtensionActionUserError {
  return new ExtensionActionUserError(message, [{ path, message, ...(extra ?? {}) } as ExtensionActionUserErrorDetail]);
}

export function notFound(name: string, path = '/name'): ExtensionActionUserError {
  return userError(`Playbook "${name}" was not found.`, path);
}

export function invalidField(path: string, message: string): ExtensionActionUserError {
  return userError(message, path);
}

export function wrapUserError(err: unknown, fallback: string, path = ''): never {
  if (err instanceof ExtensionActionUserError) throw err;
  const message = err instanceof Error && err.message ? err.message : fallback;
  throw userError(message, path);
}
