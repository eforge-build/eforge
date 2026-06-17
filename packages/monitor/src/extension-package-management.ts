// --- eforge:region extension-package-operations ---
/**
 * Extension package management operations for the daemon.
 *
 * Handles install, update, remove, promote, and demote operations for
 * extension packages. Extension factories are never imported or executed here;
 * all operations are purely filesystem-level.
 */
import { cp, lstat, mkdir, mkdtemp, rename, rm, readFile, readdir, realpath } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { homedir } from 'node:os';
import { tmpdir } from 'node:os';
import type {
  ExtensionInstallRequest,
  ExtensionUpdateRequest,
  ExtensionRemoveRequest,
  ExtensionPromoteRequest,
  ExtensionDemoteRequest,
} from '@eforge-build/client';
import {
  readInstallSidecar,
  writeInstallSidecar,
  upsertTrustRecord,
  removeTrustRecord,
  hashExtensionDirectory,
  hashExtensionFile,
  parsePackageManifest,
  type InstallTargetScope,
} from '@eforge-build/engine/extensions/index';
import { isRegistryNpmPackageSpec, updateNpmSpecVersion } from './npm-spec-version.js';
const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Public error class
// ---------------------------------------------------------------------------

export class ExtensionPackageError extends Error {
  public readonly statusCode: number;

  constructor(message: string, statusCode: number) {
    super(message);
    this.name = 'ExtensionPackageError';
    this.statusCode = statusCode;
  }
}

// ---------------------------------------------------------------------------
// Source classification
// ---------------------------------------------------------------------------

export type InstallSourceKind = 'path-dir' | 'path-tgz' | 'npm' | 'git';

/**
 * Classify an install source string.
 *
 * Returns 'git' for git URL-like sources (must be rejected by callers),
 * 'path-dir' / 'path-tgz' for local filesystem paths, or 'npm' for npm
 * package specifiers (including `file:` protocol paths).
 */
export function classifyInstallSource(source: string): InstallSourceKind {
  // Local filesystem paths (must start with /, ./, ../, or ~) — check before
  // git detection so that relative paths like ./my-ext-pkg are not matched by
  // the GitHub shorthand regex.
  if (
    source.startsWith('/') ||
    source.startsWith('./') ||
    source.startsWith('../') ||
    source.startsWith('~')
  ) {
    if (source.endsWith('.tgz') || source.endsWith('.tar.gz')) {
      return 'path-tgz';
    }
    return 'path-dir';
  }

  // Absolute path (e.g. on Windows)
  if (isAbsolute(source)) {
    if (source.endsWith('.tgz') || source.endsWith('.tar.gz')) {
      return 'path-tgz';
    }
    return 'path-dir';
  }

  // Git URL patterns — reject these before passing user input to npm.
  if (isGitLikeInstallSource(source)) {
    return 'git';
  }

  // Everything else (npm package names, @scope/pkg, file:./path, etc.)
  return 'npm';
}

function isGitLikeInstallSource(source: string): boolean {
  return source.startsWith('git+') ||
    source.startsWith('git://') ||
    source.startsWith('git@') ||
    source.startsWith('ssh://') ||
    /^(github|gitlab|bitbucket):/i.test(source) ||
    /^https?:\/\/(?:[^/\s@]+@)?(?:github\.com|gitlab\.com|bitbucket\.org)[:/]/i.test(source) ||
    /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:#.*)?$/.test(source);
}

// ---------------------------------------------------------------------------
// User config directory
// ---------------------------------------------------------------------------

function userEforgeConfigDir(): string {
  const base = process.env.XDG_CONFIG_HOME ?? resolve(homedir(), '.config');
  return resolve(base, 'eforge');
}

function resolveSourcePath(source: string, cwd: string): string {
  if (source === '~') return homedir();
  if (source.startsWith(`~${sep}`) || source.startsWith('~/')) {
    return resolve(homedir(), source.slice(2));
  }
  return isAbsolute(source) ? source : resolve(cwd, source);
}

// ---------------------------------------------------------------------------
// Scope directory helpers
// ---------------------------------------------------------------------------

function getExtensionsDir(
  scope: 'local' | 'project' | 'user',
  cwd: string,
  configDir: string,
): string {
  switch (scope) {
    case 'local': return resolve(cwd, '.eforge', 'extensions');
    case 'project': return resolve(configDir, 'extensions');
    case 'user': return resolve(userEforgeConfigDir(), 'extensions');
  }
}

function scopeToTargetScope(scope: 'local' | 'project' | 'user'): InstallTargetScope {
  switch (scope) {
    case 'local': return 'project-local';
    case 'project': return 'project-team';
    case 'user': return 'user';
  }
}

function determineScopeFromPath(
  filePath: string,
  cwd: string,
  configDir: string,
): 'local' | 'project' | 'user' | undefined {
  const localDir = resolve(cwd, '.eforge', 'extensions');
  const teamDir = resolve(configDir, 'extensions');
  const userDir = resolve(userEforgeConfigDir(), 'extensions');

  if (isPathStrictlyInside(filePath, localDir)) return 'local';
  if (isPathStrictlyInside(filePath, teamDir)) return 'project';
  if (isPathStrictlyInside(filePath, userDir)) return 'user';
  return undefined;
}

function isPathInside(childPath: string, parentPath: string): boolean {
  const rel = relative(resolve(parentPath), resolve(childPath));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function isPathStrictlyInside(childPath: string, parentPath: string): boolean {
  const rel = relative(resolve(parentPath), resolve(childPath));
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel);
}

async function resolveManagedExtensionPath(
  rawPath: string,
  cwd: string,
  configDir: string,
): Promise<{ path: string; scope: 'local' | 'project' | 'user' }> {
  if (typeof rawPath !== 'string' || rawPath.length === 0 || rawPath.includes('\0')) {
    throw new ExtensionPackageError('Invalid extension path', 400);
  }
  const resolvedPath = isAbsolute(rawPath) ? resolve(rawPath) : resolve(cwd, rawPath);
  const scope = determineScopeFromPath(resolvedPath, cwd, configDir);
  if (!scope) {
    throw new ExtensionPackageError('Extension path must be inside a known extensions directory', 400);
  }

  try {
    const info = await lstat(resolvedPath);
    if (info.isSymbolicLink()) {
      throw new ExtensionPackageError('Extension path must not be a symbolic link', 400);
    }
    const scopeDir = getExtensionsDir(scope, cwd, configDir);
    const [realScopeDir, realResolvedPath] = await Promise.all([realpath(scopeDir), realpath(resolvedPath)]);
    if (!isPathStrictlyInside(realResolvedPath, realScopeDir)) {
      throw new ExtensionPackageError('Extension path must not escape its extensions directory', 400);
    }
  } catch (err) {
    if (err instanceof ExtensionPackageError) throw err;
    throw new ExtensionPackageError(`Extension not found at ${resolvedPath}`, 404);
  }

  return { path: resolvedPath, scope };
}

// ---------------------------------------------------------------------------
// Copy extension directory (excludes node_modules/, .git/)
// ---------------------------------------------------------------------------

const EXCLUDED_DIR_NAMES = new Set(['node_modules', '.git']);

function shouldCopyExtensionPath(root: string, candidatePath: string): boolean {
  if (candidatePath === root) return true;
  const rel = relative(root, candidatePath);
  if (!rel) return true;
  const parts = rel.split(sep);
  return !parts.some((p) => EXCLUDED_DIR_NAMES.has(p));
}

async function copyExtensionDirectory(src: string, dst: string): Promise<void> {
  await cp(src, dst, {
    recursive: true,
    filter: (srcPath: string): boolean => shouldCopyExtensionPath(src, srcPath),
  });
}

// ---------------------------------------------------------------------------
// Tarball extraction
// ---------------------------------------------------------------------------

async function extractTarball(tarballPath: string, destDir: string): Promise<void> {
  await validateTarballEntries(tarballPath);
  await execFileAsync('tar', ['-xzf', tarballPath, '-C', destDir], { timeout: 30_000 });
  await validateExtractedTree(destDir);
}

async function validateTarballEntries(tarballPath: string): Promise<void> {
  let stdout: string;
  try {
    const result = await execFileAsync('tar', ['-tzf', tarballPath], { timeout: 30_000 });
    stdout = result.stdout;
  } catch (err) {
    throw new ExtensionPackageError(
      `Failed to inspect tarball: ${err instanceof Error ? err.message : String(err)}`,
      400,
    );
  }
  for (const entry of stdout.split(/\r?\n/)) {
    if (!entry) continue;
    const normalized = entry.replace(/\\/g, '/');
    const parts = normalized.split('/').filter(Boolean);
    if (normalized.startsWith('/') || parts.includes('..')) {
      throw new ExtensionPackageError(`Tarball contains unsafe entry path: ${entry}`, 400);
    }
  }
}

async function validateExtractedTree(
  root: string,
  dir = root,
  label = 'Tarball',
  shouldValidatePath: (root: string, candidatePath: string) => boolean = () => true,
): Promise<void> {
  const [realRoot, realDir] = await Promise.all([realpath(root), realpath(dir)]);
  if (!isPathInside(realDir, realRoot)) {
    throw new ExtensionPackageError(`${label} extraction escaped the destination directory`, 400);
  }
  const entries = await readdir(dir);
  for (const entry of entries) {
    const fullPath = resolve(dir, entry);
    if (!shouldValidatePath(root, fullPath)) continue;
    const info = await lstat(fullPath);
    if (info.isSymbolicLink()) {
      throw new ExtensionPackageError(`${label} contains unsupported symbolic link: ${relative(root, fullPath)}`, 400);
    }
    if (info.isFile() && info.nlink > 1) {
      throw new ExtensionPackageError(`${label} contains unsupported hard link: ${relative(root, fullPath)}`, 400);
    }
    if (!info.isFile() && !info.isDirectory()) {
      throw new ExtensionPackageError(`${label} contains unsupported special file: ${relative(root, fullPath)}`, 400);
    }
    if (info.isDirectory()) {
      await validateExtractedTree(root, fullPath, label, shouldValidatePath);
    }
  }
}

// ---------------------------------------------------------------------------
// npm pack acquisition
// ---------------------------------------------------------------------------

interface NpmPackAcquisition {
  pkgDir: string;
  tmpRoot: string;
  resolvedVersion?: string;
  integrity?: { algorithm: string; value: string };
}

async function acquireFromNpm(spec: string, cwd: string): Promise<NpmPackAcquisition> {
  if (isGitLikeInstallSource(spec)) {
    throw new ExtensionPackageError(
      'Git URL sources are not yet supported. Provide a local directory path, a .tgz tarball, or an npm package specifier. Git install support is planned for a future release.',
      400,
    );
  }

  const tmpRoot = await mkdtemp(resolve(tmpdir(), 'eforge-extpkg-'));

  try {
    const packDest = resolve(tmpRoot, 'tarballs');
    await mkdir(packDest, { recursive: true });

    let stdout: string;
    try {
      const result = await execFileAsync(
        'npm',
        ['pack', '--ignore-scripts', '--json', `--pack-destination=${packDest}`, '--', spec],
        { cwd, timeout: 120_000 },
      );
      stdout = result.stdout;
    } catch (err) {
      throw new ExtensionPackageError(
        `npm pack failed for "${spec}": ${err instanceof Error ? err.message : String(err)}`,
        400,
      );
    }

    let packResults: Array<{ name?: string; version?: string; filename?: string; integrity?: string }>;
    try {
      packResults = JSON.parse(stdout) as typeof packResults;
      if (!Array.isArray(packResults) || packResults.length === 0) throw new Error('empty');
    } catch {
      throw new ExtensionPackageError(
        `npm pack returned unexpected output for "${spec}"`,
        500,
      );
    }

    const info = packResults[0]!;
    if (!info.filename) {
      throw new ExtensionPackageError(
        `npm pack returned no filename for "${spec}"`,
        500,
      );
    }

    const tarballPath = resolve(packDest, info.filename);
    const extractDir = resolve(tmpRoot, 'extracted');
    await mkdir(extractDir, { recursive: true });
    await extractTarball(tarballPath, extractDir);

    // npm tarballs contain files under a 'package/' subdirectory
    const pkgDir = resolve(extractDir, 'package');

    let integrity: { algorithm: string; value: string } | undefined;
    if (typeof info.integrity === 'string') {
      const m = info.integrity.match(/^([^-]+)-(.+)$/);
      if (m) integrity = { algorithm: m[1]!, value: m[2]! };
    }

    return { pkgDir, tmpRoot, resolvedVersion: info.version, integrity };
  } catch (err) {
    await rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Tarball path acquisition
// ---------------------------------------------------------------------------

interface PathAcquisition {
  pkgDir: string;
  tmpRoot: string;
}

async function acquireFromTarball(source: string, cwd: string): Promise<PathAcquisition> {
  const absSource = resolveSourcePath(source, cwd);
  const tmpRoot = await mkdtemp(resolve(tmpdir(), 'eforge-extpkg-'));

  try {
    await extractTarball(absSource, tmpRoot);
    // npm-style tarballs have files under 'package/' subdir; fall back to root
    const npmPkgDir = resolve(tmpRoot, 'package');
    let pkgDir = tmpRoot;
    try {
      const info = await lstat(npmPkgDir);
      if (info.isDirectory()) pkgDir = npmPkgDir;
    } catch { /* use tmpRoot */ }
    return { pkgDir, tmpRoot };
  } catch (err) {
    await rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Local directory acquisition
// ---------------------------------------------------------------------------

async function acquireFromLocalDir(source: string, cwd: string): Promise<PathAcquisition> {
  const absSource = resolveSourcePath(source, cwd);

  try {
    const info = await lstat(absSource);
    if (!info.isDirectory()) {
      throw new ExtensionPackageError(`Source path is not a directory: ${source}`, 400);
    }
  } catch (err) {
    if (err instanceof ExtensionPackageError) throw err;
    throw new ExtensionPackageError(`Cannot access source path: ${source}`, 400);
  }

  await validateExtractedTree(absSource, absSource, 'Local directory', shouldCopyExtensionPath);

  const tmpRoot = await mkdtemp(resolve(tmpdir(), 'eforge-extpkg-'));
  try {
    const pkgDir = resolve(tmpRoot, 'package');
    await copyExtensionDirectory(absSource, pkgDir);
    await validateExtractedTree(pkgDir, pkgDir, 'Local directory');
    return { pkgDir, tmpRoot };
  } catch (err) {
    await rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Extension name resolution
// ---------------------------------------------------------------------------

const VALID_EXT_NAME_RE = /^[A-Za-z0-9._-]+$/;

function assertValidExtensionName(name: unknown): asserts name is string {
  if (
    typeof name !== 'string' ||
    !VALID_EXT_NAME_RE.test(name) ||
    name === '.' ||
    name === '..'
  ) {
    throw new ExtensionPackageError(`Extension name "${String(name)}" is invalid`, 400);
  }
}

async function resolveExtensionName(
  pkgDir: string,
  requestedName: string | undefined,
  fallbackName?: string,
): Promise<string> {
  if (requestedName !== undefined) {
    return requestedName;
  }

  // Try eforge.extension.name from package.json
  try {
    const raw = await readFile(resolve(pkgDir, 'package.json'), 'utf-8');
    const pkg = JSON.parse(raw) as Record<string, unknown>;
    const eforgeBlock = pkg.eforge;
    if (eforgeBlock && typeof eforgeBlock === 'object' && !Array.isArray(eforgeBlock)) {
      const extBlock = (eforgeBlock as Record<string, unknown>).extension;
      if (extBlock && typeof extBlock === 'object' && !Array.isArray(extBlock)) {
        const extName = (extBlock as Record<string, unknown>).name;
        if (typeof extName === 'string' && extName.length > 0) {
          return extName;
        }
      }
    }

    // 2. npm package name — strip any @scope/ prefix, use just the local package name
    if (typeof pkg.name === 'string' && pkg.name.length > 0) {
      const pkgName = pkg.name;
      // Scoped: @scope/name → use just 'name'
      const localName = pkgName.startsWith('@') ? pkgName.split('/').slice(1).join('/') : pkgName;
      if (localName.length > 0) return localName;
    }
  } catch { /* No package.json or parse error — fall back to directory basename */ }

  return fallbackName && fallbackName.length > 0 ? fallbackName : basename(pkgDir);
}

// ---------------------------------------------------------------------------
// Find extension path by name in a scope directory
// ---------------------------------------------------------------------------

const SUPPORTED_EXT_EXTS = ['.ts', '.mts', '.js', '.mjs'];

async function findExtensionPathByName(
  name: string,
  extensionsDir: string,
): Promise<string | undefined> {
  // Check directory layout first
  const dirPath = resolve(extensionsDir, name);
  try {
    const info = await lstat(dirPath);
    if (info.isDirectory()) return dirPath;
  } catch { /* not found */ }

  // Check file layouts
  for (const ext of SUPPORTED_EXT_EXTS) {
    const filePath = resolve(extensionsDir, name + ext);
    try {
      const info = await lstat(filePath);
      if (info.isFile()) return filePath;
    } catch { /* not found */ }
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Find extension across scopes (project-local > project-team > user)
// ---------------------------------------------------------------------------

async function findExtensionAcrossScopes(
  name: string,
  cwd: string,
  configDir: string,
): Promise<{ path: string; scope: 'local' | 'project' | 'user' } | undefined> {
  const localExtDir = resolve(cwd, '.eforge', 'extensions');
  const localPath = await findExtensionPathByName(name, localExtDir);
  if (localPath) return { path: localPath, scope: 'local' };

  const teamExtDir = resolve(configDir, 'extensions');
  const teamPath = await findExtensionPathByName(name, teamExtDir);
  if (teamPath) return { path: teamPath, scope: 'project' };

  const userExtDir = resolve(userEforgeConfigDir(), 'extensions');
  const userPath = await findExtensionPathByName(name, userExtDir);
  if (userPath) return { path: userPath, scope: 'user' };

  return undefined;
}

// ---------------------------------------------------------------------------
// Trust management after install/update/promote
// ---------------------------------------------------------------------------

async function handleTrustAfterInstall(
  extensionPath: string,
  name: string,
  scope: 'local' | 'project' | 'user',
  trust: boolean,
  trustedBy: string | undefined,
  eforgeDir: string,
): Promise<void> {
  if (scope !== 'project') return;

  if (trust) {
    let hash: string;
    try {
      const info = await lstat(extensionPath);
      if (info.isDirectory()) {
        const manifest = await parsePackageManifest(extensionPath);
        const entrypoint = manifest.ok && manifest.metadata?.eforgeExtension?.entrypoint
          ? resolve(extensionPath, manifest.metadata.eforgeExtension.entrypoint)
          : undefined;
        hash = await hashExtensionDirectory(extensionPath, entrypoint);
      } else {
        hash = await hashExtensionFile(extensionPath);
      }
    } catch (err) {
      throw new ExtensionPackageError(
        `Failed to hash extension for trust: ${err instanceof Error ? err.message : String(err)}`,
        500,
      );
    }
    await upsertTrustRecord(eforgeDir, name, hash, trustedBy);
  } else {
    // Clear any existing trust record to leave project-team extension untrusted
    await removeTrustRecord(eforgeDir, name);
  }
}

// ---------------------------------------------------------------------------
// Move file/directory (with EXDEV fallback)
// ---------------------------------------------------------------------------

async function moveExtension(sourcePath: string, targetPath: string): Promise<void> {
  try {
    await rename(sourcePath, targetPath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err;
    // Cross-device: copy then delete
    const info = await lstat(sourcePath);
    if (info.isDirectory()) {
      await cp(sourcePath, targetPath, { recursive: true });
    } else {
      await cp(sourcePath, targetPath);
    }
    await rm(sourcePath, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Get extension name from path
// ---------------------------------------------------------------------------

function getExtensionName(filePath: string): string {
  const b = basename(filePath);
  const ext = extname(b);
  return SUPPORTED_EXT_EXTS.includes(ext) ? b.slice(0, -ext.length) : b;
}

// ---------------------------------------------------------------------------
// Atomic package replacement
// ---------------------------------------------------------------------------

type InstallSidecarInput = Parameters<typeof writeInstallSidecar>[1];

async function replaceWithPackagedDirectory(
  pkgDir: string,
  targetPath: string,
  sidecar: InstallSidecarInput,
): Promise<void> {
  const parentDir = dirname(targetPath);
  const base = basename(targetPath);
  const unique = `${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const stagingPath = resolve(parentDir, `.${base}.eforge-staging-${unique}`);
  const backupPath = resolve(parentDir, `.${base}.eforge-backup-${unique}`);
  let backedUpExisting = false;

  try {
    await copyExtensionDirectory(pkgDir, stagingPath);
    await writeInstallSidecar(stagingPath, sidecar);

    try {
      await rename(targetPath, backupPath);
      backedUpExisting = true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }

    try {
      await rename(stagingPath, targetPath);
    } catch (err) {
      if (backedUpExisting) {
        await rename(backupPath, targetPath).catch(() => {});
      }
      throw err;
    }

    if (backedUpExisting) {
      await rm(backupPath, { recursive: true, force: true });
    }
  } catch (err) {
    await rm(stagingPath, { recursive: true, force: true }).catch(() => {});
    if (backedUpExisting) {
      await rm(backupPath, { recursive: true, force: true }).catch(() => {});
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// npm spec version validation
// ---------------------------------------------------------------------------

function assertRegistryNpmPackageSpecForVersionOverride(spec: string): void {
  if (!isRegistryNpmPackageSpec(spec)) {
    throw new ExtensionPackageError(
      `Version overrides are supported only for registry npm package specs. The recorded source "${spec}" cannot be safely rewritten; reinstall from the desired source instead.`,
      400,
    );
  }
}

function assertRegistryNpmVersionSpecifierForOverride(version: string): void {
  if (
    version.length === 0 ||
    version.includes('\0') ||
    version.includes(':') ||
    version.includes('/') ||
    version.includes('\\') ||
    version.endsWith('.tgz') ||
    version.endsWith('.tar.gz') ||
    isGitLikeInstallSource(version)
  ) {
    throw new ExtensionPackageError(
      'Version overrides must be registry npm versions, ranges, or dist-tags; file, path, URL, tarball, alias, and git specifiers are not supported.',
      400,
    );
  }
}

// ---------------------------------------------------------------------------
// Git add (best-effort)
// ---------------------------------------------------------------------------

async function gitAdd(filePath: string, cwd: string): Promise<void> {
  try {
    await execFileAsync('git', ['add', filePath], { cwd, timeout: 10_000 });
  } catch { /* best-effort; git may not be available */ }
}

// ---------------------------------------------------------------------------
// Request validation
// ---------------------------------------------------------------------------

function assertString(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new ExtensionPackageError(`Missing or invalid required field: ${field}`, 400);
  }
}

function assertOptionalString(value: unknown, field: string): asserts value is string | undefined {
  if (value !== undefined && typeof value !== 'string') {
    throw new ExtensionPackageError(`Invalid field: ${field}`, 400);
  }
}

function assertOptionalBoolean(value: unknown, field: string): asserts value is boolean | undefined {
  if (value !== undefined && typeof value !== 'boolean') {
    throw new ExtensionPackageError(`Invalid field: ${field}`, 400);
  }
}

function validateSelector(body: { name?: unknown; path?: unknown }): asserts body is { name?: string; path?: string } {
  assertOptionalString(body.name, 'name');
  assertOptionalString(body.path, 'path');
  if (body.name === undefined && body.path === undefined) {
    throw new ExtensionPackageError('Missing required field: name or path', 400);
  }
  if (body.name !== undefined && body.path !== undefined) {
    throw new ExtensionPackageError('Specify only one of name or path', 400);
  }
  if (body.name !== undefined) {
    assertValidExtensionName(body.name);
  }
}

// ---------------------------------------------------------------------------
// Public export: install
// ---------------------------------------------------------------------------

export interface InstallExtensionResult {
  name: string;
  targetPath: string;
  scope: 'local' | 'project' | 'user';
}

/**
 * Install an extension package from a local directory, tarball, or npm spec.
 * Git URL sources are rejected with a 400 error.
 */
export async function installExtensionPackage(
  body: ExtensionInstallRequest,
  cwd: string,
  configDir: string,
): Promise<InstallExtensionResult> {
  assertString(body.source, 'source');
  assertOptionalString(body.name, 'name');
  assertOptionalBoolean(body.force, 'force');
  assertOptionalBoolean(body.trust, 'trust');
  assertOptionalString(body.trustedBy, 'trustedBy');
  if (body.scope !== undefined && body.scope !== 'local' && body.scope !== 'project' && body.scope !== 'user') {
    throw new ExtensionPackageError('Invalid scope. Supported: local, project, user', 400);
  }

  const {
    source,
    scope = 'local',
    name: requestedName,
    force = false,
    trust = false,
    trustedBy,
  } = body;

  const eforgeDir = resolve(cwd, '.eforge');
  const sourceKind = classifyInstallSource(source);

  if (sourceKind === 'git') {
    throw new ExtensionPackageError(
      'Git URL sources are not yet supported. Provide a local directory path, a .tgz tarball, or an npm package specifier. Git install support is planned for a future release.',
      400,
    );
  }

  let tmpRoot: string | undefined;
  try {
    let pkgDir: string;
    let resolvedVersion: string | undefined;
    let integrity: { algorithm: string; value: string } | undefined;
    let sidecarSourceKind: 'npm' | 'path' | 'url';
    let sidecarSourceSpec: string;
    let fallbackName: string | undefined;

    if (sourceKind === 'npm') {
      const acquired = await acquireFromNpm(source, cwd);
      tmpRoot = acquired.tmpRoot;
      pkgDir = acquired.pkgDir;
      resolvedVersion = acquired.resolvedVersion;
      integrity = acquired.integrity;
      sidecarSourceKind = 'npm';
      sidecarSourceSpec = source;
    } else if (sourceKind === 'path-tgz') {
      const acquired = await acquireFromTarball(source, cwd);
      tmpRoot = acquired.tmpRoot;
      pkgDir = acquired.pkgDir;
      sidecarSourceKind = 'url';
      sidecarSourceSpec = resolveSourcePath(source, cwd);
      fallbackName = basename(sidecarSourceSpec).replace(/(?:\.tar\.gz|\.tgz)$/u, '');
    } else {
      const acquired = await acquireFromLocalDir(source, cwd);
      tmpRoot = acquired.tmpRoot;
      pkgDir = acquired.pkgDir;
      sidecarSourceKind = 'path';
      sidecarSourceSpec = resolveSourcePath(source, cwd);
      fallbackName = basename(sidecarSourceSpec);
    }

    const name = await resolveExtensionName(pkgDir, requestedName, fallbackName);
    assertValidExtensionName(name);

    const extensionsDir = getExtensionsDir(scope, cwd, configDir);
    await mkdir(extensionsDir, { recursive: true });
    const targetPath = resolve(extensionsDir, name);
    if (!isPathStrictlyInside(targetPath, extensionsDir)) {
      throw new ExtensionPackageError(`Resolved extension path for "${name}" is invalid`, 400);
    }

    // Collision check — a directory install also collides with existing file-layout extensions of the same name.
    const existingPath = await findExtensionPathByName(name, extensionsDir);
    if (existingPath && !force) {
      throw new ExtensionPackageError(
        `Extension "${name}" already exists at ${existingPath}. Use force: true to overwrite.`,
        409,
      );
    }

    if (existingPath && existingPath !== targetPath) {
      await rm(existingPath, { recursive: true, force: true });
    }

    // Copy the package directory (dist/ preserved, node_modules/.git excluded) and write the sidecar before replacing an existing install.
    await replaceWithPackagedDirectory(pkgDir, targetPath, {
      sourceKind: sidecarSourceKind,
      sourceSpec: sidecarSourceSpec,
      ...(resolvedVersion !== undefined && { resolvedVersion }),
      ...(integrity !== undefined && { integrity }),
      targetScope: scopeToTargetScope(scope),
    });

    // Handle trust (clear or write record for project-team scope)
    await handleTrustAfterInstall(targetPath, name, scope, trust, trustedBy, eforgeDir);

    return { name, targetPath, scope };
  } finally {
    if (tmpRoot !== undefined) {
      await rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
    }
  }
}

export interface UpdateExtensionResult {
  name: string;
  targetPath: string;
  scope: 'local' | 'project' | 'user';
  previousVersion?: string;
}

/**
 * Update an eforge-managed extension by reinstalling from its recorded sidecar source.
 * Returns a 409 error when the target has no eforge install sidecar.
 */
export async function updateExtensionPackage(
  body: ExtensionUpdateRequest,
  cwd: string,
  configDir: string,
): Promise<UpdateExtensionResult> {
  validateSelector(body);
  assertOptionalString(body.version, 'version');
  assertOptionalBoolean(body.trust, 'trust');
  assertOptionalString(body.trustedBy, 'trustedBy');
  if (body.name !== undefined) assertValidExtensionName(body.name);

  const { trust = false, trustedBy } = body;
  const eforgeDir = resolve(cwd, '.eforge');

  let targetPath: string;
  let scope: 'local' | 'project' | 'user';

  if (body.path !== undefined) {
    const resolved = await resolveManagedExtensionPath(body.path, cwd, configDir);
    targetPath = resolved.path;
    scope = resolved.scope;
  } else {
    const found = await findExtensionAcrossScopes(body.name!, cwd, configDir);
    if (!found) {
      throw new ExtensionPackageError(`Extension "${body.name}" not found`, 404);
    }
    targetPath = found.path;
    scope = found.scope;
  }

  // Read install sidecar
  const sidecarResult = await readInstallSidecar(targetPath);
  if (!sidecarResult.ok || !sidecarResult.data) {
    throw new ExtensionPackageError(
      `Extension at ${targetPath} has no eforge install sidecar. Only eforge-managed installs can be updated.`,
      409,
    );
  }

  const sidecar = sidecarResult.data;
  const previousVersion = sidecar.resolvedVersion;
  const name = getExtensionName(targetPath);

  // Determine effective source spec (apply version override for registry npm sources)
  let effectiveSpec = sidecar.sourceSpec;
  if (body.version !== undefined) {
    if (sidecar.sourceKind !== 'npm') {
      throw new ExtensionPackageError(
        'Version overrides are supported only for registry npm package specs. Reinstall path, tarball, URL, or git extensions from the desired source instead.',
        400,
      );
    }
    assertRegistryNpmPackageSpecForVersionOverride(sidecar.sourceSpec);
    assertRegistryNpmVersionSpecifierForOverride(body.version);
    effectiveSpec = updateNpmSpecVersion(sidecar.sourceSpec, body.version);
    assertRegistryNpmPackageSpecForVersionOverride(effectiveSpec);
  }

  let tmpRoot: string | undefined;
  try {
    let pkgDir: string;
    let resolvedVersion: string | undefined;
    let integrity: { algorithm: string; value: string } | undefined;

    if (sidecar.sourceKind === 'npm') {
      const acquired = await acquireFromNpm(effectiveSpec, cwd);
      tmpRoot = acquired.tmpRoot;
      pkgDir = acquired.pkgDir;
      resolvedVersion = acquired.resolvedVersion;
      integrity = acquired.integrity;
    } else if (sidecar.sourceKind === 'url') {
      const acquired = await acquireFromTarball(sidecar.sourceSpec, cwd);
      tmpRoot = acquired.tmpRoot;
      pkgDir = acquired.pkgDir;
    } else {
      // 'path' or 'git' (git should never appear since we reject git installs)
      const acquired = await acquireFromLocalDir(sidecar.sourceSpec, cwd);
      tmpRoot = acquired.tmpRoot;
      pkgDir = acquired.pkgDir;
    }

    await replaceWithPackagedDirectory(pkgDir, targetPath, {
      sourceKind: sidecar.sourceKind === 'npm' ? 'npm'
        : sidecar.sourceKind === 'url' ? 'url' : 'path',
      sourceSpec: effectiveSpec,
      ...(resolvedVersion !== undefined && { resolvedVersion }),
      ...(integrity !== undefined && { integrity }),
      targetScope: sidecar.targetScope,
    });

    // Handle trust
    await handleTrustAfterInstall(targetPath, name, scope, trust, trustedBy, eforgeDir);

    return { name, targetPath, scope, previousVersion };
  } finally {
    if (tmpRoot !== undefined) {
      await rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
    }
  }
}

export interface RemoveExtensionResult {
  name: string;
  removedPath: string;
}

/**
 * Remove an extension. Requires a sidecar unless force is set.
 * Clears the trust record for project-team extensions.
 */
export async function removeExtensionPackage(
  body: ExtensionRemoveRequest,
  cwd: string,
  configDir: string,
): Promise<RemoveExtensionResult> {
  validateSelector(body);
  assertOptionalBoolean(body.force, 'force');
  if (body.name !== undefined) assertValidExtensionName(body.name);

  const eforgeDir = resolve(cwd, '.eforge');
  let targetPath: string;
  let scope: 'local' | 'project' | 'user';

  if (body.path !== undefined) {
    const resolved = await resolveManagedExtensionPath(body.path, cwd, configDir);
    targetPath = resolved.path;
    scope = resolved.scope;
  } else {
    const found = await findExtensionAcrossScopes(body.name!, cwd, configDir);
    if (!found) {
      throw new ExtensionPackageError(`Extension "${body.name}" not found`, 404);
    }
    targetPath = found.path;
    scope = found.scope;
  }

  // Verify it exists
  try {
    await lstat(targetPath);
  } catch {
    throw new ExtensionPackageError(`Extension not found at ${targetPath}`, 404);
  }

  const name = getExtensionName(targetPath);

  // Require sidecar unless force is set
  if (!body.force) {
    const sidecarResult = await readInstallSidecar(targetPath);
    if (!sidecarResult.ok) {
      throw new ExtensionPackageError(
        `Extension at ${targetPath} was not installed by eforge (no install sidecar). Use force: true to remove anyway.`,
        409,
      );
    }
  }

  // Remove extension
  await rm(targetPath, { recursive: true, force: true });

  // Clear trust record for project-team extensions
  if (scope === 'project') {
    await removeTrustRecord(eforgeDir, name);
  }

  return { name, removedPath: targetPath };
}

export interface PromoteExtensionResult {
  name: string;
  targetPath: string;
}

/**
 * Move a project-local extension to project-team scope.
 * Clears any existing trust record unless trust:true is supplied.
 * Stages the project-team path with git add when git is available.
 */
export async function promoteExtensionPackage(
  body: ExtensionPromoteRequest,
  cwd: string,
  configDir: string,
): Promise<PromoteExtensionResult> {
  validateSelector(body);
  assertOptionalBoolean(body.force, 'force');
  assertOptionalBoolean(body.trust, 'trust');
  assertOptionalString(body.trustedBy, 'trustedBy');
  if (body.name !== undefined) assertValidExtensionName(body.name);

  const eforgeDir = resolve(cwd, '.eforge');
  const localExtDir = resolve(cwd, '.eforge', 'extensions');
  const teamExtDir = resolve(configDir, 'extensions');

  let sourcePath: string;
  let name: string;

  if (body.path !== undefined) {
    const resolved = await resolveManagedExtensionPath(body.path, cwd, configDir);
    if (resolved.scope !== 'local') {
      throw new ExtensionPackageError(
        'Path must be within the project-local extensions directory (.eforge/extensions/)',
        400,
      );
    }
    sourcePath = resolved.path;
    name = getExtensionName(sourcePath);
  } else {
    const found = await findExtensionPathByName(body.name!, localExtDir);
    if (!found) {
      throw new ExtensionPackageError(
        `Extension "${body.name}" not found in project-local scope`,
        404,
      );
    }
    sourcePath = found;
    name = body.name!;
  }

  // Verify source exists
  try {
    await lstat(sourcePath);
  } catch {
    throw new ExtensionPackageError(`Extension not found at ${sourcePath}`, 404);
  }

  // Ensure target directory exists
  await mkdir(teamExtDir, { recursive: true });
  const targetPath = resolve(teamExtDir, basename(sourcePath));
  if (!isPathStrictlyInside(targetPath, teamExtDir)) {
    throw new ExtensionPackageError(`Resolved extension path for "${name}" is invalid`, 400);
  }

  // Collision check — directory and file layouts with the same logical filesystem name collide.
  const existingTargetPath = await findExtensionPathByName(name, teamExtDir);

  if (existingTargetPath && !body.force) {
    throw new ExtensionPackageError(
      `Extension "${name}" already exists in project-team scope at ${existingTargetPath}. Use force: true to overwrite.`,
      409,
    );
  }

  if (existingTargetPath) {
    await rm(existingTargetPath, { recursive: true, force: true });
  }

  // Move extension from local to team
  await moveExtension(sourcePath, targetPath);

  // Handle trust
  await handleTrustAfterInstall(
    targetPath,
    name,
    'project',
    body.trust ?? false,
    body.trustedBy,
    eforgeDir,
  );

  // Stage with git add (best-effort)
  await gitAdd(targetPath, cwd);

  return { name, targetPath };
}

export interface DemoteExtensionResult {
  name: string;
  targetPath: string;
}

/**
 * Move a project-team extension to project-local scope.
 * Removes any trust record for the demoted extension.
 */
export async function demoteExtensionPackage(
  body: ExtensionDemoteRequest,
  cwd: string,
  configDir: string,
): Promise<DemoteExtensionResult> {
  validateSelector(body);
  assertOptionalBoolean(body.force, 'force');
  if (body.name !== undefined) assertValidExtensionName(body.name);

  const eforgeDir = resolve(cwd, '.eforge');
  const localExtDir = resolve(cwd, '.eforge', 'extensions');
  const teamExtDir = resolve(configDir, 'extensions');

  let sourcePath: string;
  let name: string;

  if (body.path !== undefined) {
    const resolved = await resolveManagedExtensionPath(body.path, cwd, configDir);
    if (resolved.scope !== 'project') {
      throw new ExtensionPackageError(
        'Path must be within the project-team extensions directory (eforge/extensions/)',
        400,
      );
    }
    sourcePath = resolved.path;
    name = getExtensionName(sourcePath);
  } else {
    const found = await findExtensionPathByName(body.name!, teamExtDir);
    if (!found) {
      throw new ExtensionPackageError(
        `Extension "${body.name}" not found in project-team scope`,
        404,
      );
    }
    sourcePath = found;
    name = body.name!;
  }

  // Verify source exists
  try {
    await lstat(sourcePath);
  } catch {
    throw new ExtensionPackageError(`Extension not found at ${sourcePath}`, 404);
  }

  // Ensure target directory exists
  await mkdir(localExtDir, { recursive: true });
  const targetPath = resolve(localExtDir, basename(sourcePath));
  if (!isPathStrictlyInside(targetPath, localExtDir)) {
    throw new ExtensionPackageError(`Resolved extension path for "${name}" is invalid`, 400);
  }

  // Collision check — directory and file layouts with the same logical filesystem name collide.
  const existingTargetPath = await findExtensionPathByName(name, localExtDir);

  if (existingTargetPath && !body.force) {
    throw new ExtensionPackageError(
      `Extension "${name}" already exists in project-local scope at ${existingTargetPath}. Use force: true to overwrite.`,
      409,
    );
  }

  if (existingTargetPath) {
    await rm(existingTargetPath, { recursive: true, force: true });
  }

  // Move extension from team to local
  await moveExtension(sourcePath, targetPath);

  // Remove trust record (project-local extensions never require trust)
  await removeTrustRecord(eforgeDir, name);

  return { name, targetPath };
}
// --- eforge:endregion extension-package-operations ---
