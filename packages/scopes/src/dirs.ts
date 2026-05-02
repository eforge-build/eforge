/**
 * Directory helpers for the three eforge configuration tiers.
 */
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import type { Scope, ScopeResolverOpts } from './scope.js';

/** Project-local tier subdirectory name within the project root. */
const LOCAL_SUBDIR = '.eforge';

/**
 * Return the user-scope eforge config base directory.
 *
 * Respects the `XDG_CONFIG_HOME` environment variable when set;
 * falls back to `~/.config/eforge/`.
 */
export function userEforgeConfigDir(): string {
  const base = process.env.XDG_CONFIG_HOME || resolve(homedir(), '.config');
  return resolve(base, 'eforge');
}

/**
 * Return the root directory for a given scope tier.
 *
 * | Scope            | Directory                      |
 * |------------------|-------------------------------|
 * | `'user'`         | `~/.config/eforge/` (XDG-aware) |
 * | `'project-team'` | `opts.configDir`               |
 * | `'project-local'`| `<opts.cwd>/.eforge/`          |
 *
 * The returned path is absolute. The directory is not guaranteed to exist.
 */
export function getScopeDirectory(scope: Scope, opts: ScopeResolverOpts): string {
  switch (scope) {
    case 'user':
      return userEforgeConfigDir();
    case 'project-team':
      return opts.configDir;
    case 'project-local':
      return resolve(opts.cwd, LOCAL_SUBDIR);
  }
}
