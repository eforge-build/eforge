/**
 * Canonical eforge configuration scope definitions.
 *
 * Three configuration tiers exist, ordered from lowest to highest precedence:
 *   user          — `~/.config/eforge/`        (XDG-aware global per-user config)
 *   project-team  — `<configDir>/`             (checked-in shared config, e.g. `eforge/`)
 *   project-local — `<cwd>/.eforge/`           (gitignored project-local overrides)
 */

/**
 * The three eforge configuration tiers.
 *
 * Precedence order (highest to lowest): `project-local > project-team > user`.
 */
export type Scope = 'user' | 'project-team' | 'project-local';

/**
 * Scopes that can be shadowed by a higher-precedence tier.
 * `project-local` cannot itself be shadowed, so it is excluded.
 */
export type ScopeShadow = Exclude<Scope, 'project-local'>;

/**
 * All scope tiers in canonical **merge order** — lowest to highest precedence.
 *
 * Use this ordering when applying layered config merges so that later (higher-
 * precedence) layers override earlier (lower-precedence) ones:
 *
 * ```ts
 * for (const layer of SCOPES) { ... }
 * // processes: user → project-team → project-local
 * ```
 */
export const SCOPES: readonly Scope[] = ['user', 'project-team', 'project-local'];

/**
 * Options shared by all scope-aware resolver functions.
 */
export interface ScopeResolverOpts {
  /** Project root (used to resolve `.eforge/` project-local paths). */
  cwd: string;
  /** Absolute path to the project-team eforge config directory (typically `eforge/`). */
  configDir: string;
}
