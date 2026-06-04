import { isAbsolute, relative, resolve, sep, win32 } from 'node:path';

export interface ProjectLocalStoragePathOptions {
  cwd: string;
  segments: readonly string[];
}

function assertSafeStorageSegment(segment: string): void {
  if (segment.length === 0) {
    throw new Error('Project-local storage path segments must not be empty');
  }
  if (segment === '.' || segment === '..') {
    throw new Error(`Unsafe project-local storage path segment "${segment}": traversal segments are not allowed`);
  }
  if (segment.includes('\0')) {
    throw new Error('Unsafe project-local storage path segment: null bytes are not allowed');
  }
  if (segment.includes('/') || segment.includes('\\')) {
    throw new Error(`Unsafe project-local storage path segment "${segment}": path separators are not allowed`);
  }
  if (isAbsolute(segment) || win32.isAbsolute(segment)) {
    throw new Error(`Unsafe project-local storage path segment "${segment}": absolute paths are not allowed`);
  }
}

/**
 * Resolve safe path segments under the project-local `.eforge/` storage root.
 *
 * This helper is intentionally IO-free: it performs lexical path validation and
 * containment checks only, and never probes the filesystem.
 */
export function resolveProjectLocalStoragePath(opts: ProjectLocalStoragePathOptions): string {
  if (opts.segments.length === 0) {
    throw new Error('Project-local storage path requires at least one segment');
  }

  for (const segment of opts.segments) {
    assertSafeStorageSegment(segment);
  }

  const root = resolve(opts.cwd, '.eforge');
  const resolved = resolve(root, ...opts.segments);
  const rel = relative(root, resolved);
  if (rel === '' || rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) {
    throw new Error(`Resolved project-local storage path "${resolved}" escapes ${root}${sep}`);
  }

  return resolved;
}
