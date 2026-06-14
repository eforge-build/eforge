import { ExtensionActionUserError } from '../../../packages/extension-sdk/src/index.js';
import type { ExtensionJsonValue } from '../../../packages/client/src/index.js';

interface UserActionErrorOptions {
  path?: string;
  details?: Record<string, ExtensionJsonValue>;
}

export function userActionError(message: string, options: UserActionErrorOptions = {}): ExtensionActionUserError {
  return new ExtensionActionUserError(message, [{ ...(options.details ?? {}), path: options.path ?? '', message }]);
}
