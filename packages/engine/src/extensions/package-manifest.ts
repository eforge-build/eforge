/**
 * Parse and validate `package.json` package metadata and optional `eforge.extension`
 * fields without importing extension code.
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

/** Parsed eforge-specific metadata from `package.json#eforge.extension`. */
export interface EforgeExtensionManifest {
  /** Logical name to use for this extension instead of the directory basename. */
  name?: string;
  /** Relative path (from the package directory) to the extension entrypoint. */
  entrypoint?: string;
}

/**
 * Parsed metadata from a `package.json` file for an eforge extension.
 * All fields are optional; absent when the field was not present in the file.
 */
export interface ExtensionPackageMetadata {
  /** npm package name. */
  packageName?: string;
  /** npm package version. */
  version?: string;
  /** npm package description. */
  description?: string;
  /** Repository URL or object (normalized to a string). */
  repository?: string;
  /** Homepage URL. */
  homepage?: string;
  /** Parsed eforge-specific extension metadata, if present. */
  eforgeExtension?: EforgeExtensionManifest;
}

/** Result of parsing a `package.json` file. */
export interface PackageManifestParseResult {
  /** True when the file was read and parsed as valid JSON. */
  ok: boolean;
  /** Populated when `ok` is true. */
  metadata?: ExtensionPackageMetadata;
  /**
   * Populated when `ok` is false or when `eforge.extension` fields are invalid.
   * May be populated alongside partial metadata.
   */
  errors: PackageManifestError[];
}

export type PackageManifestErrorCode =
  | 'package-json-not-found'
  | 'package-json-invalid-json'
  | 'package-json-invalid-shape'
  | 'eforge-extension-invalid-name'
  | 'eforge-extension-invalid-entrypoint';

export interface PackageManifestError {
  code: PackageManifestErrorCode;
  message: string;
}

/**
 * Read and parse the `package.json` at `dir/package.json`.
 *
 * Returns a result with `ok: true` when the file exists and is valid JSON with
 * an object shape. Invalid `eforge.extension` fields are reported as errors in
 * the `errors` array even when `ok` is true — callers must check `errors` for
 * eforge-specific validation issues.
 */
export async function parsePackageManifest(dir: string): Promise<PackageManifestParseResult> {
  const packagePath = resolve(dir, 'package.json');
  let raw: string;
  try {
    raw = await readFile(packagePath, 'utf-8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return { ok: false, errors: [{ code: 'package-json-not-found', message: `package.json not found at ${packagePath}` }] };
    }
    return { ok: false, errors: [{ code: 'package-json-invalid-json', message: `Failed to read package.json at ${packagePath}: ${err instanceof Error ? err.message : String(err)}` }] };
  }

  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { ok: false, errors: [{ code: 'package-json-invalid-json', message: `Invalid JSON in package.json at ${packagePath}` }] };
  }

  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, errors: [{ code: 'package-json-invalid-shape', message: `package.json at ${packagePath} must be a JSON object` }] };
  }

  const pkg = data as Record<string, unknown>;
  const errors: PackageManifestError[] = [];

  const metadata: ExtensionPackageMetadata = {};

  if (typeof pkg.name === 'string' && pkg.name.length > 0) {
    metadata.packageName = pkg.name;
  }
  if (typeof pkg.version === 'string' && pkg.version.length > 0) {
    metadata.version = pkg.version;
  }
  if (typeof pkg.description === 'string' && pkg.description.length > 0) {
    metadata.description = pkg.description;
  }
  if (typeof pkg.homepage === 'string' && pkg.homepage.length > 0) {
    metadata.homepage = pkg.homepage;
  }
  if (pkg.repository !== undefined) {
    metadata.repository = normalizeRepository(pkg.repository);
  }

  // Parse optional eforge.extension block.
  if (pkg.eforge !== undefined) {
    const eforgeBlock = pkg.eforge;
    if (eforgeBlock && typeof eforgeBlock === 'object' && !Array.isArray(eforgeBlock)) {
      const eforgeObj = eforgeBlock as Record<string, unknown>;
      if (eforgeObj.extension !== undefined) {
        const ext = eforgeObj.extension;
        if (ext && typeof ext === 'object' && !Array.isArray(ext)) {
          const extObj = ext as Record<string, unknown>;
          const eforgeExtension: EforgeExtensionManifest = {};

          if (extObj.name !== undefined) {
            const { valid, error } = validateExtensionName(extObj.name);
            if (!valid) {
              errors.push({ code: 'eforge-extension-invalid-name', message: error! });
            } else {
              eforgeExtension.name = extObj.name as string;
            }
          }

          if (extObj.entrypoint !== undefined) {
            const { valid, error } = validateEntrypoint(extObj.entrypoint);
            if (!valid) {
              errors.push({ code: 'eforge-extension-invalid-entrypoint', message: error! });
            } else {
              eforgeExtension.entrypoint = extObj.entrypoint as string;
            }
          }

          metadata.eforgeExtension = eforgeExtension;
        }
      }
    }
  }

  return { ok: true, metadata, errors };
}

function normalizeRepository(repo: unknown): string | undefined {
  if (typeof repo === 'string') return repo;
  if (repo && typeof repo === 'object' && !Array.isArray(repo)) {
    const repoObj = repo as Record<string, unknown>;
    if (typeof repoObj.url === 'string') return repoObj.url;
  }
  return undefined;
}

function validateExtensionName(value: unknown): { valid: boolean; error?: string } {
  if (typeof value !== 'string') {
    return { valid: false, error: `eforge.extension.name must be a string, got ${typeof value}` };
  }
  if (value.trim().length === 0) {
    return { valid: false, error: 'eforge.extension.name must not be empty' };
  }
  if (/[/\\]/.test(value)) {
    return { valid: false, error: `eforge.extension.name must not contain path separators, got "${value}"` };
  }
  if (value === '.' || value === '..') {
    return { valid: false, error: `eforge.extension.name must not be "." or "..", got "${value}"` };
  }
  return { valid: true };
}

function validateEntrypoint(value: unknown): { valid: boolean; error?: string } {
  if (typeof value !== 'string') {
    return { valid: false, error: `eforge.extension.entrypoint must be a string, got ${typeof value}` };
  }
  if (value.trim().length === 0) {
    return { valid: false, error: 'eforge.extension.entrypoint must not be empty' };
  }
  return { valid: true };
}
