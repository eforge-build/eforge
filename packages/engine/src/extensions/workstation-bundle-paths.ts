import { CONSOLE_WORKSTATION_BROWSER_SDK_VERSION } from '@eforge-build/client';

import type { ConsoleWorkstationFrameBundleSpec } from './types.js';

export const WORKSTATION_ASSETS_DIR = 'workstation-assets';

export type WorkstationBundlePathResult = { ok: true; value: string } | { ok: false; message: string };
export type WorkstationFrameBundleSourceResult = { ok: true; value: ConsoleWorkstationFrameBundleSpec } | { ok: false; message: string };

export function normalizeWorkstationBundleRoot(value: unknown): WorkstationBundlePathResult {
  const result = normalizeLexicalRelativePath(value, 'frameBundle.root');
  if (!result.ok) return { ok: false, message: `${result.message}; frameBundle.root must be ${WORKSTATION_ASSETS_DIR} or a child directory under ${WORKSTATION_ASSETS_DIR}/` };
  if (result.value !== WORKSTATION_ASSETS_DIR && !result.value.startsWith(`${WORKSTATION_ASSETS_DIR}/`)) {
    return { ok: false, message: `frameBundle.root must be ${WORKSTATION_ASSETS_DIR} or a child directory under ${WORKSTATION_ASSETS_DIR}/` };
  }
  return result;
}

export function normalizeWorkstationBundleAssetPath(value: unknown, fieldName: string): WorkstationBundlePathResult {
  return normalizeLexicalRelativePath(value, fieldName);
}

export function validateWorkstationFrameBundleSource(value: unknown): WorkstationFrameBundleSourceResult {
  if (!isNonArrayObject(value)) return { ok: false, message: 'frameBundle must be an object' };
  const root = normalizeWorkstationBundleRoot(value.root);
  if (!root.ok) return root;
  const entrypoint = normalizeWorkstationBundleAssetPath(value.entrypoint, 'frameBundle.entrypoint');
  if (!entrypoint.ok) return entrypoint;
  const styles = normalizeOptionalPathArray(value.styles, 'frameBundle.styles');
  if (!styles.ok) return styles;
  const assets = normalizeOptionalPathArray(value.assets, 'frameBundle.assets');
  if (!assets.ok) return assets;
  if (value.browserSdkVersion !== undefined && value.browserSdkVersion !== CONSOLE_WORKSTATION_BROWSER_SDK_VERSION) {
    return { ok: false, message: `frameBundle.browserSdkVersion must be ${CONSOLE_WORKSTATION_BROWSER_SDK_VERSION} when provided` };
  }
  return {
    ok: true,
    value: {
      root: root.value,
      entrypoint: entrypoint.value,
      ...(styles.value === undefined ? {} : { styles: styles.value }),
      ...(assets.value === undefined ? {} : { assets: assets.value }),
      ...(value.browserSdkVersion === undefined ? {} : { browserSdkVersion: CONSOLE_WORKSTATION_BROWSER_SDK_VERSION }),
    },
  };
}

function normalizeOptionalPathArray(value: unknown, fieldName: string): { ok: true; value?: string[] } | { ok: false; message: string } {
  if (value === undefined) return { ok: true };
  if (!Array.isArray(value)) return { ok: false, message: `${fieldName} must be an array of safe relative paths` };
  const normalized: string[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const result = normalizeWorkstationBundleAssetPath(value[index], `${fieldName}[${index}]`);
    if (!result.ok) return result;
    normalized.push(result.value);
  }
  return { ok: true, value: normalized };
}

function normalizeLexicalRelativePath(value: unknown, fieldName: string): WorkstationBundlePathResult {
  if (typeof value !== 'string' || value.length === 0 || value.trim().length === 0) {
    return { ok: false, message: `${fieldName} must be a non-empty safe relative path` };
  }
  if (value.includes('\0')) return { ok: false, message: `${fieldName} must not contain null bytes` };
  if (value.includes('\\')) return { ok: false, message: `${fieldName} must use forward slashes, not backslashes` };
  if (value.startsWith('/')) return { ok: false, message: `${fieldName} must not be an absolute path` };
  if (/^[a-z]:/iu.test(value)) return { ok: false, message: `${fieldName} must not be a drive-absolute path` };
  const segments = value.split('/');
  if (segments.some((segment) => segment.length === 0)) return { ok: false, message: `${fieldName} must not contain empty path segments` };
  if (segments.some((segment) => segment === '.')) return { ok: false, message: `${fieldName} must not contain . path segments` };
  if (segments.some((segment) => segment === '..')) return { ok: false, message: `${fieldName} must not contain .. path segments` };
  return { ok: true, value: segments.join('/') };
}

function isNonArrayObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
