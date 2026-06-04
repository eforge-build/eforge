/**
 * Safe path resolution for read-only session plan sets.
 *
 * Plan-set ids and child/anchor files use dedicated resolvers here. These do not
 * relax the flat session-plan path handling in `session-plan.ts`. Every resolver
 * rejects traversal and path-injection inputs and verifies the resolved path
 * remains inside the selected plan-set directory.
 */
import { resolve, isAbsolute, sep } from 'node:path';
import { resolveProjectLocalStoragePath } from '@eforge-build/extension-sdk/project-storage';
import { SESSION_PLAN_SET_MANIFEST_FILENAME } from './schema.js';

/** Lower-case slug identifier pattern for plan-set ids. */
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Resolve the `.eforge/session-plans` root for a project. */
export function resolveSessionPlanSetsRoot(cwd: string): string {
  return resolveProjectLocalStoragePath({ cwd, segments: ['session-plans'] });
}

/**
 * Whether a directory name is a loadable plan-set id under the same rules
 * `resolveSessionPlanSetDir` enforces (non-empty lower-case slug, no separators
 * or traversal segments). Callers that discover directories on disk use this to
 * avoid listing entries that the loader would later reject with an error.
 */
export function isLoadablePlanSetId(planSetId: string): boolean {
  return (
    planSetId.length > 0 &&
    planSetId !== '.' &&
    planSetId !== '..' &&
    !planSetId.includes('/') &&
    !planSetId.includes('\\') &&
    SLUG_RE.test(planSetId)
  );
}

/** Throw when a plan-set id is empty, a traversal segment, contains separators, or is not a slug. */
function assertValidPlanSetId(planSetId: string): void {
  if (!isLoadablePlanSetId(planSetId)) {
    throw new Error(
      `Invalid session plan-set id "${planSetId}": must be a lower-case slug without path separators`,
    );
  }
}

/** Build a separator-terminated prefix so prefix guards do not match sibling dirs. */
function guardPrefixOf(dir: string): string {
  return dir.endsWith(sep) ? dir : dir + sep;
}

export interface ResolveSessionPlanSetDirOpts {
  cwd: string;
  planSetId: string;
}

/** Resolve the absolute directory for a plan-set id, guarding against escape. */
export function resolveSessionPlanSetDir(opts: ResolveSessionPlanSetDirOpts): string {
  assertValidPlanSetId(opts.planSetId);
  const root = resolveSessionPlanSetsRoot(opts.cwd);
  const dir = resolve(root, opts.planSetId);
  if (!dir.startsWith(guardPrefixOf(root))) {
    throw new Error(`Session plan-set id "${opts.planSetId}" would escape .eforge/session-plans/`);
  }
  return dir;
}

/** Resolve the absolute manifest path for a plan-set id. */
export function resolveSessionPlanSetManifestPath(opts: ResolveSessionPlanSetDirOpts): string {
  return resolve(resolveSessionPlanSetDir(opts), SESSION_PLAN_SET_MANIFEST_FILENAME);
}

/**
 * Validate a relative markdown file path declared in a manifest.
 * Rejects absolute paths, backslash separators, `.`/`..` segments, empty
 * segments (from `//` or trailing `/`), and non-markdown final segments.
 */
function assertValidRelativeMarkdownPath(relPath: string, label: string): void {
  if (relPath.length === 0) {
    throw new Error(`Invalid ${label} "${relPath}": must not be empty`);
  }
  if (isAbsolute(relPath) || relPath.startsWith('/')) {
    throw new Error(`Invalid ${label} "${relPath}": must be a relative path`);
  }
  if (relPath.includes('\\')) {
    throw new Error(`Invalid ${label} "${relPath}": must not contain backslash separators`);
  }
  const segments = relPath.split('/');
  for (const segment of segments) {
    if (segment === '') {
      throw new Error(`Invalid ${label} "${relPath}": must not contain empty path segments`);
    }
    if (segment === '.' || segment === '..') {
      throw new Error(`Invalid ${label} "${relPath}": must not contain "." or ".." segments`);
    }
  }
  const last = segments[segments.length - 1];
  if (!last.toLowerCase().endsWith('.md')) {
    throw new Error(`Invalid ${label} "${relPath}": must be a markdown (.md) file`);
  }
}

/** Resolve a relative file under a plan-set dir, guarding against escape. */
function resolveWithinPlanSetDir(dir: string, relPath: string, label: string): string {
  assertValidRelativeMarkdownPath(relPath, label);
  const resolved = resolve(dir, relPath);
  if (!resolved.startsWith(guardPrefixOf(dir))) {
    throw new Error(`Invalid ${label} "${relPath}": would escape the plan-set directory`);
  }
  return resolved;
}

export interface ResolveSessionPlanSetAnchorPathOpts {
  cwd: string;
  planSetId: string;
  anchor: string;
}

/** Resolve the absolute path to a plan-set umbrella anchor file. */
export function resolveSessionPlanSetAnchorPath(opts: ResolveSessionPlanSetAnchorPathOpts): string {
  const dir = resolveSessionPlanSetDir(opts);
  return resolveWithinPlanSetDir(dir, opts.anchor, 'session plan-set anchor');
}

export interface ResolveSessionPlanSetChildPathOpts {
  cwd: string;
  planSetId: string;
  childFile: string;
}

/** Resolve the absolute path to a plan-set child markdown file. */
export function resolveSessionPlanSetChildPath(opts: ResolveSessionPlanSetChildPathOpts): string {
  const dir = resolveSessionPlanSetDir(opts);
  return resolveWithinPlanSetDir(dir, opts.childFile, 'session plan-set child file');
}
