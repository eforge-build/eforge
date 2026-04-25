---
id: plan-03-profile-loader-mcp
name: Profile Directory and Loader Rename + MCP Tool Rename
depends_on:
  - plan-02-monitor-ui-session-rename
branch: complete-per-agent-runtime-configuration/profile-loader-mcp
agents:
  builder:
    effort: xhigh
    rationale: Directory rename + loader function renames + auto-migration logic +
      two MCP tool registrations. Tightly coupled - loader consumers are the MCP
      tools. Deep reasoning needed to design the auto-migration path correctly
      (idempotent, safe under git, handles both-directories-exist case).
  reviewer:
    effort: high
    rationale: Auto-migration logic has edge cases (git-tracked directory,
      both-exist warning, marker file rename). Must verify all callers of the
      renamed loader functions updated.
---

# Profile Directory and Loader Rename + MCP Tool Rename

## Architecture Context

The term "backend" is being fully retired in favor of "profile" for the on-disk configuration profile system. The loader lives at `packages/engine/src/config.ts` (L748-1073) and is consumed by the MCP tools in `packages/pi-eforge/extensions/eforge/index.ts` (L598) and `packages/eforge/src/cli/mcp-proxy.ts` (L415).

Auto-migration is important: existing users have `eforge/backends/*.yaml` files and an `.active-backend` marker. On first load after upgrade, the engine will `git mv` the directory to `eforge/profiles/` and rename the marker to `.active-profile`, logging the action.

## Implementation

### Overview

1. Rename the profile-system directory on disk when upgrading: `eforge/backends/` -> `eforge/profiles/`, marker `.active-backend` -> `.active-profile`. Auto-migration runs on loader entry.
2. Rename loader functions: `loadBackendProfile` -> `loadProfile`, `setActiveBackend` -> `setActiveProfile`, `listBackendProfiles` -> `listProfiles`.
3. Update all call sites in the engine and engine-adjacent code.
4. Rename the MCP tool `eforge_backend` to `eforge_profile` in both surfaces (Claude Code plugin MCP proxy + Pi extension).

### Key Decisions

1. **Auto-migration is best-effort git mv with clear logging.** If the repo isn't a git repo or `git mv` fails, fall back to `fs.rename` and still log. Both-directories-exist case logs a warning and leaves `eforge/backends/` untouched (human resolves).
2. **Idempotent.** After migration, subsequent loads see only `eforge/profiles/` and do nothing special.
3. **Marker file migration is tied to directory migration.** Both move together or not at all.
4. **No loader-level coexistence.** The loader reads only from `eforge/profiles/` after migration; it does not merge from both directories.
5. **MCP tool rename is a straight rename.** No aliasing. The tool description is also updated to reference profiles.

## Scope

### In Scope

- Directory + marker rename with auto-migration.
- Loader function renames + all call-site updates.
- MCP tool name change in both MCP surfaces.
- Any engine-side log / error string that references `backends/` or `.active-backend`.

### Out of Scope

- Slash command / skill directory rename (plan-04).
- HTTP route rename (plan-05).
- Docs (plan-06).
- Plugin version bump (plan-04).

## Files

### Modify

- `packages/engine/src/config.ts` (L748-1073 and any helpers) - rename functions, add auto-migration logic at loader entry, update internal references from `eforge/backends/` to `eforge/profiles/` and `.active-backend` to `.active-profile`.
- All engine call sites of `loadBackendProfile`, `setActiveBackend`, `listBackendProfiles` - discover via `grep -rn "loadBackendProfile\\|setActiveBackend\\|listBackendProfiles" packages/` and update each to the new name.
- `packages/pi-eforge/extensions/eforge/index.ts` (L598) - rename `eforge_backend` MCP tool to `eforge_profile`; update tool name, description, and any internal `backend`-scoped variable names that leak into handler responses.
- `packages/eforge/src/cli/mcp-proxy.ts` (L415) - same rename in the plugin-side MCP proxy; keep behavior identical.

## Verification

- [ ] `pnpm type-check` exits 0.
- [ ] `pnpm test` exits 0.
- [ ] `grep -rn "loadBackendProfile\\|setActiveBackend\\|listBackendProfiles" packages/` returns zero matches.
- [ ] `grep -rn "eforge_backend" packages/` returns zero matches.
- [ ] `grep -rn "eforge/backends\\|\\.active-backend" packages/engine/src packages/pi-eforge/extensions packages/eforge/src` returns zero matches.
- [ ] With a repo containing `eforge/backends/a.yaml` + `.active-backend`, first loader invocation produces `eforge/profiles/a.yaml` + `.active-profile` and logs the migration (verified via unit test that exercises the auto-migration path against a temp fixture).
- [ ] With both `eforge/backends/` and `eforge/profiles/` present, the loader logs a warning and does not modify `eforge/backends/` (verified via unit test).
