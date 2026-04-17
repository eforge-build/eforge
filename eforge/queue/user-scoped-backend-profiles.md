---
title: User-Scoped Backend Profiles
created: 2026-04-17
---

# User-Scoped Backend Profiles

## Problem / Motivation

Backend profiles (added recently in plan-02) are currently **project-only**: they live in `eforge/backends/*.yaml` and the active profile is tracked by `eforge/.active-backend`. The initial design discussion contemplated also supporting **user-level** profiles at `~/.config/eforge/backends/` so the same backend definition could be reused across projects — but that path was never implemented.

User-scoped profiles are actually the more common case: most users want one or two "my favorite" backend definitions (e.g. `pi-anthropic` with their preferred models) available in every project, and only occasionally want a project-specific override.

## Goal

Add user-scope backend profiles alongside the existing project scope, with a scope selector in the plugin and Pi skills, so the same backend definition can be reused across projects while still allowing project-specific overrides.

## Approach

### Design decisions (confirmed)

1. **User-level `.active-backend` marker** at `~/.config/eforge/.active-backend`, symmetrical with the project marker. (Chosen over config-field-only fallback.)
2. **Project shadows user on name collision.** Lookup order for any profile name: project `eforge/backends/` first, then `~/.config/eforge/backends/`.

### Resolution precedence (new)

When `loadConfig()` resolves the active backend profile, it walks these sources in order and stops on the first hit whose referenced profile actually exists:

1. `eforge/.active-backend` (project marker)
2. project `eforge/config.yaml` `backend:` field
3. `~/.config/eforge/.active-backend` (user marker) — **new**
4. `~/.config/eforge/config.yaml` `backend:` field — **new** (currently the global config's `backend:` field is loaded but then ignored by profile resolution)
5. none

Profile *file* lookup (for every source above) tries project first, then user — so a user marker can still be shadowed by a same-named project profile.

### Files to modify

#### Core engine: `packages/engine/src/config.ts`

The existing project-only helpers are at lines ~684–1055. Extend them rather than duplicate:

- **Path helpers** (alongside existing `profilePath`/`backendsDir`/`markerPath`): add `userBackendsDir()`, `userProfilePath(name)`, `userMarkerPath()` that reuse the same XDG-aware resolution already used by `getUserConfigPath()` (lines ~595–603).
- **`loadBackendProfile(configDir, name)`** (called from line 655): switch to project-first, user-fallback lookup. Return `{ profile, scope }` so callers can report where it came from.
- **`listBackendProfiles(configDir)`** (lines 821–853): return entries from both scopes with a `scope: 'project' | 'user'` field. Mark entries where a user profile is shadowed by a project profile of the same name (`shadowedBy: 'project'`).
- **`resolveActiveProfileName(configDir, projectConfig, userConfig)`** (lines 732–785): add `userConfig` parameter; walk the 5-source precedence above; return `source: 'local' | 'team' | 'user-local' | 'user-team' | 'missing' | 'none'`.
- **`setActiveBackend(configDir, name, { scope })`** (lines 860–906): `scope` defaults to `'project'`. When `'user'`, writes `~/.config/eforge/.active-backend` instead of the project marker. Both writes still validate that the referenced profile exists in at least one scope.
- **`createBackendProfile(configDir, name, opts)`** (lines 913–1005): add `scope: 'project' | 'user'` (required from callers; skills prompt). User scope writes to `~/.config/eforge/backends/<name>.yaml`.
- **`deleteBackendProfile(configDir, name, { scope, force })`** (lines 1012–1055): `scope` optional; infer automatically when the name is unique across scopes, error with a clear message when ambiguous and `scope` is not given.
- **`loadConfig()`** (lines 629–665): thread the loaded global config into `resolveActiveProfileName` so precedence steps 3–4 work.

#### Daemon HTTP: `packages/monitor/src/server.ts` (lines 885–1053)

All changes are additive — no breaking changes to existing query params/body shapes:

- `GET /api/backend/list` — optional `?scope=project|user|all` (default `all`). Response entries each gain `scope`.
- `GET /api/backend/show` — response gains `source` values `'user-local'` / `'user-team'` and `resolved.scope`.
- `POST /api/backend/use` — optional `scope` in body (default `'project'`).
- `POST /api/backend/create` — optional `scope` in body (default `'project'`).
- `DELETE /api/backend/:name` — optional `?scope=` query.

#### MCP tool: `packages/eforge/src/cli/mcp-proxy.ts` (lines 551–621)

Extend the `eforge_backend` Zod input schema:
- Add `scope: z.enum(['project', 'user']).optional()` for `use`/`create`/`delete`.
- Add `scope: z.enum(['project', 'user', 'all']).optional()` for `list`.
- Thread `scope` into the existing daemon dispatch code.

#### Pi extension: `packages/pi-eforge/extensions/eforge/index.ts` (lines 334–501)

Mirror the MCP tool schema changes and daemon dispatches. The wiring test already enforces parity.

#### Skills (plugin + Pi)

- **`eforge-plugin/skills/backend/backend.md`** — list output gets a Scope column; document the 5-step precedence.
- **`eforge-plugin/skills/backend-new/backend-new.md`** — add a **Step 0: Ask Scope** that prompts "project (eforge/backends/) or user (~/.config/eforge/backends/)?" before collecting backend kind and models. Default: project.
- **`packages/pi-eforge/skills/eforge-backend/SKILL.md`** — mirror.
- **`packages/pi-eforge/skills/eforge-backend-new/SKILL.md`** — mirror.
- **`eforge-plugin/skills/init/init.md`** + **`packages/pi-eforge/skills/eforge-init/SKILL.md`** — add a one-liner pointing at `~/.config/eforge/backends/` as an alternative to project-scoped profiles.

#### Tests

- **`test/config-backend-profile.test.ts`** — add cases for:
  - User-scope profile loads when no project profile exists.
  - Project shadows user on same-name collision.
  - User marker wins over user config's `backend:` field.
  - Project marker beats all user-level sources.
  - `createBackendProfile({ scope: 'user' })` writes to the user dir.
  - `deleteBackendProfile` errors on ambiguous name without `scope`.
- **`test/backend-profile-wiring.test.ts`** — extend the MCP proxy and Pi extension assertions to verify the new `scope` schema enums and that both codepaths accept `scope` in the daemon request.

#### Plugin version

- Bump `eforge-plugin/.claude-plugin/plugin.json` version (per AGENTS.md convention). Do **not** pin the version in a test (we just deleted that pin).

#### Docs

- **`docs/config.md`** — add a short subsection under the existing backend-profiles section explaining user scope, the 5-step precedence, and the `scope` parameter on create/use.

## Scope

### In scope

- Core engine changes to `packages/engine/src/config.ts` for user-scope path helpers, load/list/resolve/set/create/delete profile functions, and threading user config into `loadConfig()`.
- Additive daemon HTTP changes in `packages/monitor/src/server.ts`.
- MCP tool schema extensions in `packages/eforge/src/cli/mcp-proxy.ts`.
- Pi extension parity in `packages/pi-eforge/extensions/eforge/index.ts`.
- Skill updates (plugin + Pi) for `backend`, `backend-new`, and `init`.
- Unit tests for precedence, collisions, and scope params; wiring tests for MCP + Pi parity.
- Plugin version bump.
- Docs update to `docs/config.md`.

### Out of scope (Non-goals)

- No changes to the `backend:` field schema in `config.yaml`.
- No migration of existing project-scoped profiles (users move them manually if desired).
- No auto-gitignore for user-scope paths (they live outside the project).
- No UI for listing cross-scope collisions beyond the `shadowedBy` field in the list response.

## Acceptance Criteria

1. **Unit tests**: `pnpm test` — all existing tests pass; new tests cover the 5-step precedence, collision shadowing, and scope params.
2. **Type check**: `pnpm type-check` clean across all packages.
3. **Live daemon smoke test**:
   - Restart daemon (skill: `eforge-daemon-restart`).
   - `mcp__eforge__eforge_backend action=create scope=user name=my-default backend=pi` — verify `~/.config/eforge/backends/my-default.yaml` is written.
   - `mcp__eforge__eforge_backend action=list` — verify both scopes appear with `scope` field.
   - `mcp__eforge__eforge_backend action=use scope=user name=my-default` — verify `~/.config/eforge/.active-backend` is written.
   - In a different project with no `eforge/.active-backend`: `mcp__eforge__eforge_backend action=show` — should resolve `source: 'user-local'` and the user profile.
   - Create a project-scope profile with the same name `my-default` — verify list shows `shadowedBy: 'project'` on the user entry and `show` resolves to the project profile.
4. **Skill flow**: run `/eforge:backend:new` from Claude Code — verify the scope prompt is the first question and the profile lands in the chosen directory.
