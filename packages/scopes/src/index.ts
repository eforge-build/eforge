/**
 * @eforge-build/scopes — canonical scope names, directory helpers, named-set
 * resolution, and layered-singleton lookup for the three eforge configuration tiers.
 *
 * ## Scope tiers (highest to lowest precedence)
 *
 * | Tier             | Directory                      |
 * |------------------|-------------------------------|
 * | `project-local`  | `<cwd>/.eforge/`               |
 * | `project-team`   | `<configDir>/` (e.g. `eforge/`) |
 * | `user`           | `~/.config/eforge/` (XDG-aware) |
 *
 * ## Primitives
 *
 * - **Named-set resolution** (`resolveNamedSet`, `listNamedSet`): for artifact
 *   directories like `profiles/` and `playbooks/` where the same name can exist
 *   in multiple tiers. The highest-precedence tier wins; lower tiers are recorded
 *   as shadows.
 *
 * - **Layered-singleton lookup** (`resolveLayeredSingletons`): for singleton files
 *   like `config.yaml` that can exist at any tier and are meant to be merged.
 *   Returns all existing copies in merge order (`user → project-team → project-local`)
 *   so the caller can apply higher-precedence layers over lower-precedence defaults.
 */

// Canonical scope types and constants
export type { Scope, ScopeShadow, ScopeResolverOpts } from './scope.js';
export { SCOPES } from './scope.js';

// Directory helpers
export { getScopeDirectory, userEforgeConfigDir } from './dirs.js';

// Named-set resolution
export type { NamedSetEntry, NamedSetListEntry, NamedSetOpts } from './named-set.js';
export { resolveNamedSet, listNamedSet } from './named-set.js';

// Layered-singleton lookup
export type { LayeredSingletonEntry } from './layered-singleton.js';
export { resolveLayeredSingletons } from './layered-singleton.js';
