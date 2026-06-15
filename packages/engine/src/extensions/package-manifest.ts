/**
 * Parse and validate `package.json` package metadata and optional `eforge.extension`
 * fields without importing extension code.
 */

import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type {
  ExtensionCapabilityDeclaration,
  ExtensionDependencyDeclaration,
  ExtensionDependencyManifest,
} from '@eforge-build/extension-sdk';

/** Parsed eforge-specific metadata from `package.json#eforge.extension`. */
export interface EforgeExtensionManifest {
  /** Logical name to use for this extension instead of the directory basename. */
  name?: string;
  /** Relative path (from the package directory) to the extension entrypoint. */
  entrypoint?: string;
  /** Capabilities provided by this extension. */
  capabilities?: ExtensionCapabilityDeclaration[];
  /** Required and optional dependencies declared by this extension. */
  dependencies?: ExtensionDependencyManifest;
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
  | 'eforge-extension-invalid-entrypoint'
  | 'eforge-extension-invalid-capability'
  | 'eforge-extension-invalid-dependency';

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

          if (extObj.capabilities !== undefined) {
            const result = parseCapabilities(extObj.capabilities);
            errors.push(...result.errors);
            if (result.value.length > 0) eforgeExtension.capabilities = result.value;
          }

          if (extObj.dependencies !== undefined) {
            const result = parseDependencies(extObj.dependencies);
            errors.push(...result.errors);
            if (result.value !== undefined) eforgeExtension.dependencies = result.value;
          }

          metadata.eforgeExtension = eforgeExtension;
        }
      }
    }
  }

  return { ok: true, metadata, errors };
}

function parseCapabilities(value: unknown): { value: ExtensionCapabilityDeclaration[]; errors: PackageManifestError[] } {
  if (!Array.isArray(value)) {
    return { value: [], errors: [{ code: 'eforge-extension-invalid-capability', message: 'eforge.extension.capabilities must be an array' }] };
  }
  const capabilities: ExtensionCapabilityDeclaration[] = [];
  const errors: PackageManifestError[] = [];
  value.forEach((entry, index) => {
    const parsed = parseCapability(entry, `eforge.extension.capabilities[${index}]`);
    if (parsed.error) errors.push(parsed.error);
    else if (parsed.value) capabilities.push(parsed.value);
  });
  return { value: capabilities, errors };
}

function parseCapability(value: unknown, path: string): { value?: ExtensionCapabilityDeclaration; error?: PackageManifestError } {
  if (!isObject(value)) return manifestShapeError('eforge-extension-invalid-capability', `${path} must be an object`);
  if (!isSafeManifestName(value.name)) return manifestShapeError('eforge-extension-invalid-capability', `${path}.name must be a non-empty string without control characters`);
  if (value.version !== undefined) {
    if (typeof value.version !== 'string' || !isSemanticVersion(value.version)) {
      return manifestShapeError('eforge-extension-invalid-capability', `${path}.version must be an exact semantic version`);
    }
    return { value: { name: value.name, version: value.version } };
  }
  return { value: { name: value.name } };
}

function parseDependencies(value: unknown): { value?: ExtensionDependencyManifest; errors: PackageManifestError[] } {
  if (!isObject(value)) {
    return { errors: [{ code: 'eforge-extension-invalid-dependency', message: 'eforge.extension.dependencies must be an object' }] };
  }
  const result: ExtensionDependencyManifest = {};
  const errors: PackageManifestError[] = [];
  for (const kind of ['required', 'optional'] as const) {
    if (value[kind] === undefined) continue;
    const parsed = parseDependencyArray(value[kind], `eforge.extension.dependencies.${kind}`);
    errors.push(...parsed.errors);
    if (parsed.value.length > 0) result[kind] = parsed.value;
  }
  return { value: Object.keys(result).length > 0 ? result : undefined, errors };
}

function parseDependencyArray(value: unknown, path: string): { value: ExtensionDependencyDeclaration[]; errors: PackageManifestError[] } {
  if (!Array.isArray(value)) {
    return { value: [], errors: [{ code: 'eforge-extension-invalid-dependency', message: `${path} must be an array` }] };
  }
  const dependencies: ExtensionDependencyDeclaration[] = [];
  const errors: PackageManifestError[] = [];
  value.forEach((entry, index) => {
    const parsed = parseDependency(entry, `${path}[${index}]`);
    if (parsed.error) errors.push(parsed.error);
    else if (parsed.value) dependencies.push(parsed.value);
  });
  return { value: dependencies, errors };
}

function parseDependency(value: unknown, path: string): { value?: ExtensionDependencyDeclaration; error?: PackageManifestError } {
  if (typeof value === 'string' && isSafeManifestName(value)) return { value: { name: value } };
  if (typeof value === 'string') return manifestShapeError('eforge-extension-invalid-dependency', `${path} must be a non-empty provider name string without control characters`);
  if (!isObject(value)) return manifestShapeError('eforge-extension-invalid-dependency', `${path} must be an object or non-empty provider name string`);
  const name = value.name ?? value.provider;
  if (name !== undefined && !isSafeManifestName(name)) {
    return manifestShapeError('eforge-extension-invalid-dependency', `${path}.name must be a non-empty string without control characters when present`);
  }
  const version = value.version ?? value.providerVersion;
  if (version !== undefined && (typeof version !== 'string' || !isVersionConstraint(version))) {
    return manifestShapeError('eforge-extension-invalid-dependency', `${path}.version must be an exact semantic version or supported comparator constraint`);
  }
  let capabilities: ExtensionDependencyDeclaration['capabilities'];
  if (value.capabilities !== undefined) {
    const parsed = parseCapabilityRequirements(value.capabilities, `${path}.capabilities`);
    if (parsed.errors[0]) return { error: parsed.errors[0] };
    capabilities = parsed.value;
  }
  if (name === undefined && (capabilities === undefined || capabilities.length === 0)) {
    return manifestShapeError('eforge-extension-invalid-dependency', `${path} must declare a provider name or at least one capability requirement`);
  }
  return {
    value: {
      ...(typeof name === 'string' && { name }),
      ...(typeof version === 'string' && { version }),
      ...(capabilities !== undefined && capabilities.length > 0 && { capabilities }),
    },
  };
}

function parseCapabilityRequirements(value: unknown, path: string): { value: ExtensionDependencyDeclaration['capabilities']; errors: PackageManifestError[] } {
  if (!Array.isArray(value)) return { value: [], errors: [{ code: 'eforge-extension-invalid-dependency', message: `${path} must be an array` }] };
  const capabilities: NonNullable<ExtensionDependencyDeclaration['capabilities']> = [];
  const errors: PackageManifestError[] = [];
  value.forEach((entry, index) => {
    if (!isObject(entry) || !isSafeManifestName(entry.name)) {
      errors.push({ code: 'eforge-extension-invalid-dependency', message: `${path}[${index}].name must be a non-empty string without control characters` });
      return;
    }
    if (entry.version !== undefined && (typeof entry.version !== 'string' || !isVersionConstraint(entry.version))) {
      errors.push({ code: 'eforge-extension-invalid-dependency', message: `${path}[${index}].version must be an exact semantic version or supported comparator constraint` });
      return;
    }
    capabilities.push({ name: entry.name, ...(typeof entry.version === 'string' && { version: entry.version }) });
  });
  return { value: capabilities, errors };
}

function manifestShapeError(code: PackageManifestErrorCode, message: string): { error: PackageManifestError } {
  return { error: { code, message } };
}

function isVersionConstraint(value: string): boolean {
  return value.split(',').map((part) => part.trim()).every((part) => /^(?:[<>]=?|=)?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(part));
}

function isSemanticVersion(value: string): boolean {
  return /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(value);
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isSafeManifestName(value: unknown): value is string {
  return isNonEmptyString(value) && value.length <= 200 && !/[\u0000-\u001f\u007f-\u009f]/.test(value);
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
