import { ExtensionActionUserError } from '@eforge-build/extension-sdk';
import type { ExtensionJsonValue } from '@eforge-build/client';

interface UserActionErrorOptions {
  path?: string;
  details?: Record<string, ExtensionJsonValue>;
}

export function userActionError(message: string, options: UserActionErrorOptions = {}): ExtensionActionUserError {
  return new ExtensionActionUserError(message, [{ ...(options.details ?? {}), path: options.path ?? '', message }]);
}
