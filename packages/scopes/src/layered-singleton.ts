/**
 * Layered-singleton lookup across the three scope tiers.
 *
 * A layered singleton is a single file (e.g. `config.yaml`) that can exist at
 * any of the three scope tiers.  Unlike a named set — where each uniquely-named
 * artifact has a single winner — a layered singleton is intended to be **merged**
 * across all tiers: the caller reads each copy and applies them in merge order so
 * that higher-precedence tiers override lower-precedence ones.
 *
 * Merge order (lowest to highest precedence): user → project-team → project-local.
 */
import { access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { SCOPES, type Scope, type ScopeResolverOpts } from './scope.js';
import { getScopeDirectory } from './dirs.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A resolved singleton file path with its scope tier. */
export interface LayeredSingletonEntry {
  /** Which scope tier this copy comes from. */
  scope: Scope;
  /** Absolute path to the file. */
  path: string;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolve a singleton file across all three scope tiers, returning all
 * existing copies in canonical **merge order** (lowest to highest precedence):
 * `user → project-team → project-local`.
 *
 * This ordering is appropriate for config merging: iterate the returned array
 * and apply each layer so that later entries (higher precedence) override
 * earlier ones.
 *
 * Only tiers where the file actually exists are included; missing tiers are
 * silently skipped.
 *
 * @param filename - The file name to look for in each scope's root directory (e.g. `'config.yaml'`).
 * @param opts - Scope resolver options.
 *
 * @example
 * ```ts
 * const layers = await resolveLayeredSingletons('config.yaml', { cwd, configDir });
 * let merged = defaultConfig();
 * for (const { path } of layers) {
 *   const raw = await readFile(path, 'utf-8');
 *   merged = mergeConfigs(merged, parseConfig(raw));
 * }
 * ```
 */
export async function resolveLayeredSingletons(
  filename: string,
  opts: ScopeResolverOpts,
): Promise<LayeredSingletonEntry[]> {
  // SCOPES is already in merge order: ['user', 'project-team', 'project-local']
  const candidates = SCOPES.map((scope) => ({
    scope,
    path: resolve(getScopeDirectory(scope, opts), filename),
  }));

  const results = await Promise.all(
    candidates.map(async ({ scope, path }): Promise<LayeredSingletonEntry | null> => {
      try {
        await access(path);
        return { scope, path };
      } catch {
        return null;
      }
    }),
  );

  return results.filter((e): e is LayeredSingletonEntry => e !== null);
}
