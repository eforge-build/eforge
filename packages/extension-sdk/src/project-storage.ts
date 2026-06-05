import { resolve } from 'node:path';

import { assertContainedPath, assertSafeStorageSegments } from './project-paths.js';

export interface ProjectLocalStoragePathOptions {
  cwd: string;
  segments: readonly string[];
}

/**
 * Resolve safe path segments under the project-local `.eforge/` storage root.
 *
 * This helper is intentionally IO-free: it performs lexical path validation and
 * containment checks only, and never probes the filesystem.
 */
export function resolveProjectLocalStoragePath(opts: ProjectLocalStoragePathOptions): string {
  assertSafeStorageSegments(opts.segments, 'Project-local storage path');

  const root = resolve(opts.cwd, '.eforge');
  const resolved = resolve(root, ...opts.segments);
  assertContainedPath(root, resolved);

  return resolved;
}
