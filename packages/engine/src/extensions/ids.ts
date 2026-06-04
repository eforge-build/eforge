import type { NativeExtensionDiagnostic } from './types.js';

// --- eforge:region plan-02-engine-registry-runtime ---
export const EXTENSION_LOCAL_CONTRIBUTION_ID_RE = /^[a-z][a-z0-9-]{0,63}$/;

export function isValidExtensionLocalContributionId(value: unknown): value is string {
  return typeof value === 'string' && EXTENSION_LOCAL_CONTRIBUTION_ID_RE.test(value);
}

export function resolveExtensionContributionId(extensionName: string, localId: string): string {
  return `${extensionName}:${localId}`;
}

export function buildDuplicateContributionDiagnostic(
  label: string,
  duplicate: { id: string; extensionName: string; extensionPath: string },
  original: { extensionName: string },
): NativeExtensionDiagnostic {
  return {
    severity: 'error',
    code: 'extension:duplicate-registration',
    message: `Duplicate ${label} id "${duplicate.id}" from extension "${duplicate.extensionName}" conflicts with extension "${original.extensionName}"`,
    name: duplicate.id,
    path: duplicate.extensionPath,
    extensionName: duplicate.extensionName,
  };
}
// --- eforge:endregion plan-02-engine-registry-runtime ---
