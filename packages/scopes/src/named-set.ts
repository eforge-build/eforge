/**
 * Named-set resolution across the three scope tiers.
 *
 * A named set is a directory of individually-named files (e.g. `profiles/`,
 * `playbooks/`) where the same name can exist in multiple tiers.  The
 * highest-precedence tier wins; lower-precedence tiers with the same name are
 * recorded as shadows.
 *
 * Precedence: project-local > project-team > user.
 */
import { readdir } from 'node:fs/promises';
import { resolve, basename, extname } from 'node:path';
import type { Scope, ScopeShadow, ScopeResolverOpts } from './scope.js';
import { getScopeDirectory } from './dirs.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** An entry in the resolved named set — the winning tier for a given artifact name. */
export interface NamedSetEntry {
  /** Which scope tier this (highest-precedence) copy came from. */
  scope: Scope;
  /** Absolute path to the file. */
  path: string;
  /**
   * Full shadow chain — lower-precedence scope tiers that also have a file
   * with this name. Listed highest-precedence first.
   * Empty when no lower tier has the same name.
   */
  shadows: ScopeShadow[];
}

/** A resolved named-set listing entry with the artifact name included. */
export interface NamedSetListEntry extends NamedSetEntry {
  /** Artifact name (file basename without extension when `extension` is set; otherwise full basename). */
  name: string;
}

/** Options for named-set resolution. */
export type NamedSetOpts = ScopeResolverOpts & {
  /**
   * File extension to filter (without leading dot), e.g. `'yaml'` or `'md'`.
   * When omitted, all files in the directory are included and `name` is the
   * full basename including any extension.
   */
  extension?: string;
};

// ---------------------------------------------------------------------------
// Internal scanner
// ---------------------------------------------------------------------------

type RawEntry = { name: string; path: string };

async function scanDir(dir: string, extension: string | undefined): Promise<RawEntry[]> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }

  const out: RawEntry[] = [];
  for (const entry of entries.sort()) {
    if (extension !== undefined) {
      if (extname(entry) !== `.${extension}`) continue;
      out.push({ name: basename(entry, `.${extension}`), path: resolve(dir, entry) });
    } else {
      out.push({ name: basename(entry), path: resolve(dir, entry) });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolve a named set across all three scope tiers.
 *
 * Returns a `Map<name, NamedSetEntry>` where each name maps to its
 * highest-precedence copy. Lower-precedence tiers with the same name are
 * recorded in `entry.shadows`.
 *
 * @param directory - Sub-directory name within each scope directory (e.g. `'profiles'`, `'playbooks'`).
 * @param opts - Scope resolver options plus optional file extension filter.
 */
export async function resolveNamedSet(
  directory: string,
  opts: NamedSetOpts,
): Promise<Map<string, NamedSetEntry>> {
  const { extension, cwd, configDir } = opts;
  const scopeOpts: ScopeResolverOpts = { cwd, configDir };

  const [localEntries, teamEntries, userEntries] = await Promise.all([
    scanDir(resolve(getScopeDirectory('project-local', scopeOpts), directory), extension),
    scanDir(resolve(getScopeDirectory('project-team', scopeOpts), directory), extension),
    scanDir(resolve(getScopeDirectory('user', scopeOpts), directory), extension),
  ]);

  const localNames = new Set(localEntries.map((e) => e.name));
  const teamNames = new Set(teamEntries.map((e) => e.name));

  const result = new Map<string, NamedSetEntry>();

  // project-local: highest precedence, never shadowed.
  for (const e of localEntries) {
    const shadows: ScopeShadow[] = [];
    if (teamNames.has(e.name)) shadows.push('project-team');
    if (userEntries.some((u) => u.name === e.name)) shadows.push('user');
    result.set(e.name, { scope: 'project-local', path: e.path, shadows });
  }

  // project-team: included only when no project-local copy exists.
  for (const e of teamEntries) {
    if (localNames.has(e.name)) continue;
    const shadows: ScopeShadow[] = [];
    if (userEntries.some((u) => u.name === e.name)) shadows.push('user');
    result.set(e.name, { scope: 'project-team', path: e.path, shadows });
  }

  // user: lowest precedence, included only when neither higher tier has the name.
  for (const e of userEntries) {
    if (localNames.has(e.name) || teamNames.has(e.name)) continue;
    result.set(e.name, { scope: 'user', path: e.path, shadows: [] });
  }

  return result;
}

/**
 * List all unique artifact names in a named set, sorted alphabetically.
 *
 * Each entry includes the artifact name, its winning scope, absolute path, and
 * shadow chain. This is a convenience wrapper around `resolveNamedSet`.
 *
 * @param directory - Sub-directory name within each scope directory (e.g. `'profiles'`, `'playbooks'`).
 * @param opts - Scope resolver options plus optional file extension filter.
 */
export async function listNamedSet(
  directory: string,
  opts: NamedSetOpts,
): Promise<NamedSetListEntry[]> {
  const map = await resolveNamedSet(directory, opts);
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, entry]) => ({ name, ...entry }));
}
