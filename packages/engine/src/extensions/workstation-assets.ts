import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

import {
  API_ROUTES,
  buildPath,
  CONSOLE_WORKSTATION_BROWSER_SDK_VERSION,
  CONSOLE_WORKSTATION_BUNDLE_ASSET_ID_PATTERN,
  type ConsoleWorkstationFrameBundleAssetRef,
  type ConsoleWorkstationFrameBundleManifest,
} from '@eforge-build/client';

import { validateWorkstationFrameBundleSource } from './workstation-bundle-paths.js';
import type { ConsoleWorkstationFrameBundleSpec, ConsoleWorkstationRegistration, NativeExtensionRegistry } from './types.js';

export type ConsoleWorkstationAssetCatalogErrorCode =
  | 'not-frame-bundle'
  | 'invalid-bundle-source'
  | 'extension-root-unavailable'
  | 'bundle-root-missing'
  | 'bundle-root-not-directory'
  | 'bundle-root-realpath-escape'
  | 'asset-missing'
  | 'asset-not-file'
  | 'asset-symlink'
  | 'asset-realpath-escape'
  | 'asset-read-failed';

export class ConsoleWorkstationAssetCatalogError extends Error {
  readonly code: ConsoleWorkstationAssetCatalogErrorCode;

  constructor(code: ConsoleWorkstationAssetCatalogErrorCode, message: string) {
    super(message);
    this.name = 'ConsoleWorkstationAssetCatalogError';
    this.code = code;
  }
}

export interface ConsoleWorkstationCatalogAsset extends ConsoleWorkstationFrameBundleAssetRef {
  /** Normalized path relative to the bundle root; used for deterministic id path hashing. */
  bundleRelativePath: string;
  /** Normalized path relative to the extension root; useful for HTTP serving. */
  extensionRelativePath: string;
  absolutePath: string;
}

export interface ConsoleWorkstationAssetCatalog {
  extensionRoot: string;
  bundleRoot: string;
  bundle: ConsoleWorkstationFrameBundleSpec;
  entrypoint: ConsoleWorkstationCatalogAsset;
  styles: ConsoleWorkstationCatalogAsset[];
  assets: ConsoleWorkstationCatalogAsset[];
  allAssets: ConsoleWorkstationCatalogAsset[];
}

export type ConsoleWorkstationBundleAssetLookupResult =
  | { ok: true; registration: ConsoleWorkstationRegistration; asset: ConsoleWorkstationCatalogAsset; catalog: ConsoleWorkstationAssetCatalog }
  | { ok: false; reason: 'malformed-asset-id' | 'unknown-workstation' | 'not-frame-bundle' | 'unknown-asset-id' | ConsoleWorkstationAssetCatalogErrorCode; message: string };

const assetIdPattern = new RegExp(CONSOLE_WORKSTATION_BUNDLE_ASSET_ID_PATTERN);

export function buildConsoleWorkstationAssetCatalog(registration: ConsoleWorkstationRegistration): ConsoleWorkstationAssetCatalog {
  const rawBundle = registration.value.frameBundle;
  if (rawBundle === undefined) {
    throw new ConsoleWorkstationAssetCatalogError('not-frame-bundle', `Console workstation ${registration.id} is not a frameBundle workstation`);
  }
  const normalizedBundle = validateWorkstationFrameBundleSource(rawBundle);
  if (!normalizedBundle.ok) {
    throw new ConsoleWorkstationAssetCatalogError('invalid-bundle-source', normalizedBundle.message);
  }
  const extensionRoot = resolveExtensionRoot(registration.extensionPath);
  const realExtensionRoot = realpathSync(extensionRoot);
  const bundleRoot = resolve(extensionRoot, normalizedBundle.value.root);
  assertDirectory(bundleRoot);
  const realBundleRoot = realpathSync(bundleRoot);
  if (!isWithinDir(realBundleRoot, realExtensionRoot)) {
    throw new ConsoleWorkstationAssetCatalogError('bundle-root-realpath-escape', `frameBundle root realpath escapes extension root: ${normalizedBundle.value.root}`);
  }
  const entrypoint = buildAsset(registration.id, realExtensionRoot, realBundleRoot, normalizedBundle.value.root, normalizedBundle.value.entrypoint);
  const styles = dedupePaths(normalizedBundle.value.styles ?? [], new Set([entrypoint.bundleRelativePath]))
    .map((path) => buildAsset(registration.id, realExtensionRoot, realBundleRoot, normalizedBundle.value.root, path));
  const seen = new Set([entrypoint.bundleRelativePath, ...styles.map((asset) => asset.bundleRelativePath)]);
  const assets = dedupePaths(normalizedBundle.value.assets ?? [], seen)
    .map((path) => buildAsset(registration.id, realExtensionRoot, realBundleRoot, normalizedBundle.value.root, path));
  return { extensionRoot, bundleRoot: realBundleRoot, bundle: normalizedBundle.value, entrypoint, styles, assets, allAssets: [entrypoint, ...styles, ...assets] };
}

export function buildConsoleWorkstationFrameBundleManifest(registration: ConsoleWorkstationRegistration): ConsoleWorkstationFrameBundleManifest {
  const catalog = buildConsoleWorkstationAssetCatalog(registration);
  return {
    browserSdkVersion: CONSOLE_WORKSTATION_BROWSER_SDK_VERSION,
    frameUrl: buildPath(API_ROUTES.extensionWorkstationFrame, { workstationId: registration.id }),
    entrypoint: projectManifestAsset(catalog.entrypoint),
    styles: catalog.styles.map(projectManifestAsset),
    assets: catalog.assets.map(projectManifestAsset),
  };
}

export function findConsoleWorkstationBundleAsset(registry: NativeExtensionRegistry, workstationId: string, assetId: string): ConsoleWorkstationBundleAssetLookupResult {
  if (!assetIdPattern.test(assetId)) {
    return { ok: false, reason: 'malformed-asset-id', message: 'Malformed extension workstation asset id' };
  }
  const registration = registry.consoleWorkstations.find((entry) => entry.id === workstationId);
  if (registration === undefined) {
    return { ok: false, reason: 'unknown-workstation', message: `Unknown extension workstation: ${workstationId}` };
  }
  if (registration.value.frameBundle === undefined) {
    return { ok: false, reason: 'not-frame-bundle', message: `Extension workstation is not a frameBundle workstation: ${workstationId}` };
  }
  try {
    const catalog = buildConsoleWorkstationAssetCatalog(registration);
    const asset = catalog.allAssets.find((entry) => entry.id === assetId);
    if (asset === undefined) {
      return { ok: false, reason: 'unknown-asset-id', message: `Unknown extension workstation asset id: ${assetId}` };
    }
    return { ok: true, registration, asset, catalog };
  } catch (err) {
    if (err instanceof ConsoleWorkstationAssetCatalogError) return { ok: false, reason: err.code, message: err.message };
    throw err;
  }
}

function projectManifestAsset(asset: ConsoleWorkstationCatalogAsset): ConsoleWorkstationFrameBundleAssetRef {
  return {
    id: asset.id,
    url: asset.url,
    relativePath: asset.extensionRelativePath,
    sha256: asset.sha256,
  };
}

function buildAsset(workstationId: string, realExtensionRoot: string, realBundleRoot: string, root: string, bundleRelativePath: string): ConsoleWorkstationCatalogAsset {
  const absolutePath = resolve(realBundleRoot, bundleRelativePath);
  if (!isWithinDir(absolutePath, realBundleRoot)) {
    throw new ConsoleWorkstationAssetCatalogError('asset-realpath-escape', `frameBundle asset escapes bundle root: ${bundleRelativePath}`);
  }
  let info: ReturnType<typeof lstatSync>;
  try {
    info = lstatSync(absolutePath);
  } catch {
    throw new ConsoleWorkstationAssetCatalogError('asset-missing', `frameBundle asset is missing: ${bundleRelativePath}`);
  }
  if (info.isSymbolicLink()) throw new ConsoleWorkstationAssetCatalogError('asset-symlink', `frameBundle asset is an unsupported symbolic link: ${bundleRelativePath}`);
  if (!info.isFile()) throw new ConsoleWorkstationAssetCatalogError('asset-not-file', `frameBundle asset is not a regular file: ${bundleRelativePath}`);
  const realAssetPath = realpathSync(absolutePath);
  if (!isWithinDir(realAssetPath, realBundleRoot)) {
    throw new ConsoleWorkstationAssetCatalogError('asset-realpath-escape', `frameBundle asset realpath escapes bundle root: ${bundleRelativePath}`);
  }
  if (!isWithinDir(realAssetPath, realExtensionRoot)) {
    throw new ConsoleWorkstationAssetCatalogError('asset-realpath-escape', `frameBundle asset realpath escapes extension root: ${bundleRelativePath}`);
  }
  let content: Buffer;
  try {
    content = readFileSync(realAssetPath);
  } catch {
    throw new ConsoleWorkstationAssetCatalogError('asset-read-failed', `frameBundle asset could not be read: ${bundleRelativePath}`);
  }
  const sha256 = createHash('sha256').update(content).digest('hex');
  const pathSha256 = createHash('sha256').update(bundleRelativePath).digest('hex');
  const id = `sha256-${sha256}-path-${pathSha256}`;
  return {
    id,
    url: buildPath(API_ROUTES.extensionWorkstationAsset, { workstationId, assetId: id }),
    relativePath: root === '' ? bundleRelativePath : `${root}/${bundleRelativePath}`,
    bundleRelativePath,
    extensionRelativePath: `${root}/${bundleRelativePath}`,
    absolutePath: realAssetPath,
    sha256,
  };
}

function dedupePaths(paths: string[], seen: Set<string>): string[] {
  const result: string[] = [];
  for (const path of paths) {
    if (seen.has(path)) continue;
    seen.add(path);
    result.push(path);
  }
  return result;
}

function resolveExtensionRoot(extensionPath: string): string {
  if (extensionPath.includes('\0')) {
    throw new ConsoleWorkstationAssetCatalogError('extension-root-unavailable', 'Extension root path contains a null byte');
  }
  const resolved = resolve(extensionPath);
  let info: ReturnType<typeof lstatSync>;
  try {
    info = lstatSync(resolved);
  } catch {
    throw new ConsoleWorkstationAssetCatalogError('extension-root-unavailable', `Extension root is unavailable: ${extensionPath}`);
  }
  return info.isDirectory() ? resolved : resolve(resolved, '..');
}

function assertDirectory(path: string): void {
  let info: ReturnType<typeof lstatSync>;
  try {
    info = lstatSync(path);
  } catch {
    throw new ConsoleWorkstationAssetCatalogError('bundle-root-missing', `frameBundle root is missing: ${path}`);
  }
  if (!info.isDirectory()) throw new ConsoleWorkstationAssetCatalogError('bundle-root-not-directory', `frameBundle root is not a directory: ${path}`);
}

function isWithinDir(path: string, parent: string): boolean {
  const rel = relative(resolve(parent), resolve(path));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel) && !rel.split(sep).includes('..'));
}
