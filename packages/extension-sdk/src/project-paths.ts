import { isAbsolute, relative, resolve, sep, win32 } from 'node:path';

import { getScopeDirectory, type Scope } from '@eforge-build/scopes';

export type EforgeStorageScope = Scope;

export interface EforgeProjectPathsOptions {
  cwd: string;
  configDir?: string;
  extensionName?: string;
}

export interface EforgeProjectPaths {
  cwd: string;
  configDir: string;
  scopeRoot(scope: EforgeStorageScope): string;
  storageRoot(scope: EforgeStorageScope): string;
  storagePath(scope: EforgeStorageScope, segments: readonly string[]): string;
  extensionStorageRoot(scope: EforgeStorageScope, extensionName?: string): string;
  extensionStoragePath(scope: EforgeStorageScope, segments: readonly string[], extensionName?: string): string;
}

export interface ResolveScopedStoragePathOptions {
  cwd: string;
  configDir?: string;
  scope: EforgeStorageScope;
  segments: readonly string[];
}

export interface ResolveExtensionStoragePathOptions extends ResolveScopedStoragePathOptions {
  extensionName: string;
}

function resolveConfigDir(cwd: string, configDir?: string): string {
  return resolve(cwd, configDir ?? 'eforge');
}

function assertSafePathPart(value: string, label: string): void {
  if (value.length === 0) {
    throw new Error(`${label} must not be empty`);
  }
  if (value === '.' || value === '..') {
    throw new Error(`Unsafe ${label} "${value}": traversal segments are not allowed`);
  }
  if (value.includes('\0')) {
    throw new Error(`Unsafe ${label}: null bytes are not allowed`);
  }
  if (value.includes('/') || value.includes('\\')) {
    throw new Error(`Unsafe ${label} "${value}": path separators are not allowed`);
  }
  if (isAbsolute(value) || win32.isAbsolute(value)) {
    throw new Error(`Unsafe ${label} "${value}": absolute paths are not allowed`);
  }
}

export function assertSafeStorageSegments(segments: readonly string[], label = 'storage path segments'): void {
  if (segments.length === 0) {
    throw new Error(`${label} require at least one segment`);
  }
  for (const segment of segments) {
    assertSafePathPart(segment, 'storage path segment');
  }
}

export function assertSafeExtensionName(extensionName: string): void {
  assertSafePathPart(extensionName, 'extension name');
}

export function assertContainedPath(root: string, resolvedPath: string): void {
  const rel = relative(root, resolvedPath);
  if (rel === '' || rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) {
    throw new Error(`Resolved storage path "${resolvedPath}" escapes ${root}${sep}`);
  }
}

function resolveUnderRoot(root: string, segments: readonly string[]): string {
  assertSafeStorageSegments(segments);
  const resolvedPath = resolve(root, ...segments);
  assertContainedPath(root, resolvedPath);
  return resolvedPath;
}

export function createEforgeProjectPaths(opts: EforgeProjectPathsOptions): EforgeProjectPaths {
  const cwd = resolve(opts.cwd);
  const configDir = resolveConfigDir(cwd, opts.configDir);
  const scopeOpts = { cwd, configDir };

  const scopeRoot = (scope: EforgeStorageScope): string => getScopeDirectory(scope, scopeOpts);
  const storageRoot = (scope: EforgeStorageScope): string => resolve(scopeRoot(scope), 'storage');
  const extensionStorageRoot = (scope: EforgeStorageScope, extensionName = opts.extensionName): string => {
    if (extensionName === undefined) {
      throw new Error('extensionStorageRoot requires an extension name');
    }
    assertSafeExtensionName(extensionName);
    return resolve(storageRoot(scope), 'extensions', extensionName);
  };

  return {
    cwd,
    configDir,
    scopeRoot,
    storageRoot,
    storagePath(scope, segments) {
      return resolveUnderRoot(storageRoot(scope), segments);
    },
    extensionStorageRoot,
    extensionStoragePath(scope, segments, extensionName) {
      return resolveUnderRoot(extensionStorageRoot(scope, extensionName), segments);
    },
  };
}

export function resolveScopedStoragePath(opts: ResolveScopedStoragePathOptions): string {
  return createEforgeProjectPaths(opts).storagePath(opts.scope, opts.segments);
}

export function resolveExtensionStoragePath(opts: ResolveExtensionStoragePathOptions): string {
  return createEforgeProjectPaths({ ...opts, extensionName: opts.extensionName }).extensionStoragePath(opts.scope, opts.segments);
}
