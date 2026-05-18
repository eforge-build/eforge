/**
 * Sidecar install provenance for eforge-managed extension packages.
 *
 * When eforge installs an extension package into a scope directory, it writes
 * a `.eforge-install.json` sidecar alongside the package directory. This file
 * records where the package came from, when it was installed, and the target
 * scope — enabling provenance display and future update/remove operations.
 *
 * The sidecar is intentionally outside the content hash computed by
 * `hashExtensionDirectory` (which covers only `package.json` and source files).
 */

import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

/** Filename of the eforge install sidecar placed alongside installed packages. */
export const INSTALL_SIDECAR_FILENAME = '.eforge-install.json';

/** Schema version for the sidecar format. Bump on breaking changes. */
const SIDECAR_SCHEMA_VERSION = 1;

const INSTALL_SOURCE_KINDS = new Set<InstallSourceKind>(['npm', 'git', 'path', 'url']);
const INSTALL_TARGET_SCOPES = new Set<InstallTargetScope>(['user', 'project-team', 'project-local']);

/**
 * Source kind for an installed extension package.
 *
 * - `npm`  — installed from an npm registry (default or configured registry).
 * - `git`  — installed from a git URL (reserved; not yet implemented).
 * - `path` — installed from a local directory path (symlinked or copied).
 * - `url`  — installed from a direct tarball URL.
 */
export type InstallSourceKind = 'npm' | 'git' | 'path' | 'url';

/**
 * Scope into which the extension was installed.
 * Mirrors the engine's `NativeExtensionScope` for the install-time record.
 */
export type InstallTargetScope = 'user' | 'project-team' | 'project-local';

/** Resolved integrity hash for a package at install time (e.g., npm's `integrity` field). */
export interface InstallIntegrity {
  /** Algorithm (e.g., `sha512`). */
  algorithm: string;
  /** Base64-encoded digest value. */
  value: string;
}

/**
 * Provenance data recorded when eforge installs a package.
 * Written to `.eforge-install.json` inside the installed package directory.
 */
export interface InstallSidecarData {
  /** Schema version — always `1` in this implementation. */
  schemaVersion: number;
  /** Source kind. */
  sourceKind: InstallSourceKind;
  /** The source specifier as provided by the caller (npm package name, git URL, path, etc.). */
  sourceSpec: string;
  /** Resolved version string from the package, if available (npm resolved version, git SHA, etc.). */
  resolvedVersion?: string;
  /** Integrity hash, if available. */
  integrity?: InstallIntegrity;
  /** ISO-8601 timestamp of when the package was installed. */
  installedAt: string;
  /** Target scope into which the package was installed. */
  targetScope: InstallTargetScope;
}

/** Result of reading an install sidecar. */
export interface ReadInstallSidecarResult {
  /** True when a valid sidecar was found and parsed. */
  ok: boolean;
  /** Populated when `ok` is true. */
  data?: InstallSidecarData;
  /** Human-readable error message when `ok` is false. */
  error?: string;
}

/**
 * Read and parse the install sidecar at `dir/.eforge-install.json`.
 *
 * This function is tolerant: if the file does not exist or is malformed it
 * returns `{ ok: false }` without throwing. Callers should treat a missing
 * sidecar as a non-installed (hand-placed) extension.
 */
export async function readInstallSidecar(dir: string): Promise<ReadInstallSidecarResult> {
  const sidecarPath = resolve(dir, INSTALL_SIDECAR_FILENAME);
  let raw: string;
  try {
    raw = await readFile(sidecarPath, 'utf-8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      return { ok: false, error: `No install sidecar found at ${sidecarPath}` };
    }
    return { ok: false, error: `Failed to read install sidecar at ${sidecarPath}: ${err instanceof Error ? err.message : String(err)}` };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: `Invalid JSON in install sidecar at ${sidecarPath}` };
  }

  const validated = validateSidecar(parsed, sidecarPath);
  if (!validated.ok) {
    return validated;
  }

  return { ok: true, data: validated.data };
}

/**
 * Write an install sidecar to `dir/.eforge-install.json`.
 *
 * Overwrites any existing sidecar. The `installedAt` field is set to the
 * current ISO-8601 timestamp if not provided in `data`.
 */
export async function writeInstallSidecar(dir: string, data: Omit<InstallSidecarData, 'schemaVersion' | 'installedAt'> & { installedAt?: string }): Promise<void> {
  const sidecarPath = resolve(dir, INSTALL_SIDECAR_FILENAME);
  const sidecar: InstallSidecarData = {
    schemaVersion: SIDECAR_SCHEMA_VERSION,
    sourceKind: data.sourceKind,
    sourceSpec: data.sourceSpec,
    ...(data.resolvedVersion !== undefined && { resolvedVersion: data.resolvedVersion }),
    ...(data.integrity !== undefined && { integrity: data.integrity }),
    installedAt: data.installedAt ?? new Date().toISOString(),
    targetScope: data.targetScope,
  };
  await writeFile(sidecarPath, JSON.stringify(sidecar, null, 2) + '\n', 'utf-8');
}

function validateSidecar(value: unknown, sidecarPath: string): ReadInstallSidecarResult {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { ok: false, error: `Install sidecar at ${sidecarPath} must be a JSON object` };
  }
  const obj = value as Record<string, unknown>;

  if (obj.schemaVersion !== SIDECAR_SCHEMA_VERSION) {
    return { ok: false, error: `Install sidecar at ${sidecarPath} missing or unsupported schemaVersion` };
  }
  if (typeof obj.sourceKind !== 'string' || !INSTALL_SOURCE_KINDS.has(obj.sourceKind as InstallSourceKind)) {
    return { ok: false, error: `Install sidecar at ${sidecarPath} missing or invalid sourceKind` };
  }
  if (typeof obj.sourceSpec !== 'string') {
    return { ok: false, error: `Install sidecar at ${sidecarPath} missing or invalid sourceSpec` };
  }
  if (typeof obj.installedAt !== 'string') {
    return { ok: false, error: `Install sidecar at ${sidecarPath} missing or invalid installedAt` };
  }
  if (typeof obj.targetScope !== 'string' || !INSTALL_TARGET_SCOPES.has(obj.targetScope as InstallTargetScope)) {
    return { ok: false, error: `Install sidecar at ${sidecarPath} missing or invalid targetScope` };
  }

  const data: InstallSidecarData = {
    schemaVersion: obj.schemaVersion,
    sourceKind: obj.sourceKind as InstallSourceKind,
    sourceSpec: obj.sourceSpec,
    installedAt: obj.installedAt,
    targetScope: obj.targetScope as InstallTargetScope,
  };

  if (typeof obj.resolvedVersion === 'string') {
    data.resolvedVersion = obj.resolvedVersion;
  }
  if (obj.integrity && typeof obj.integrity === 'object' && !Array.isArray(obj.integrity)) {
    const intObj = obj.integrity as Record<string, unknown>;
    if (typeof intObj.algorithm === 'string' && typeof intObj.value === 'string') {
      data.integrity = { algorithm: intObj.algorithm, value: intObj.value };
    }
  }

  return { ok: true, data };
}
