---
id: plan-01-core-engine
name: Core Engine, Client Types, and Daemon HTTP
depends_on: []
branch: user-scoped-backend-profiles/core-engine
---

# Core Engine, Client Types, and Daemon HTTP

## Architecture Context

Backend profiles are currently project-only: all path helpers, load/list/resolve/set/create/delete functions in `packages/engine/src/config.ts` operate exclusively on `eforge/backends/` inside the project directory. The global user config (`~/.config/eforge/config.yaml`) is loaded by `loadConfig()` but its `backend:` field is never consulted during profile resolution.

This plan adds user-scope path helpers, extends every profile function with scope awareness, updates `ActiveProfileSource` to include user-level sources, and threads scope through the daemon HTTP routes. Client types gain `scope` fields to match.

## Implementation

### Overview

Extend the backend profile system to support two scopes (project and user) with a 5-step resolution precedence. All changes are additive - existing project-only behavior is preserved as the default.

### Key Decisions

1. **User paths reuse XDG resolution from `getUserConfigPath()`** - `userBackendsDir()` returns `~/.config/eforge/backends/` (or `$XDG_CONFIG_HOME/eforge/backends/`), `userMarkerPath()` returns `~/.config/eforge/.active-backend`, `userProfilePath(name)` returns `~/.config/eforge/backends/<name>.yaml`. These are module-level helpers alongside the existing `profilePath`/`backendsDir`/`markerPath`.

2. **Profile file lookup is always project-first, user-fallback** - When any resolution source yields a profile name, the file is looked up first in `eforge/backends/`, then `~/.config/eforge/backends/`. This means a user-scope marker can still resolve to a project-scope profile file if one exists with that name.

3. **`ActiveProfileSource` gains two new values** - `'user-local'` (user marker file selected the profile) and `'user-team'` (user config's `backend:` field matched a profile). The existing `'local'`, `'team'`, `'missing'`, `'none'` values are unchanged.

4. **Daemon HTTP changes are additive** - No existing query params or body fields change meaning. New optional `scope` parameters default to behavior equivalent to the current project-only mode for list/show, and `'project'` for mutations.

## Scope

### In Scope
- User-scope path helpers in `config.ts`
- `loadBackendProfile()` - project-first, user-fallback lookup; return `{ profile, scope }`
- `listBackendProfiles()` - return entries from both scopes with `scope` and `shadowedBy` fields
- `resolveActiveProfileName()` - add `userConfig` parameter; walk 5-source precedence
- `setActiveBackend()` - add `scope` option (`'project'` | `'user'`); user scope writes `~/.config/eforge/.active-backend`
- `createBackendProfile()` - add `scope` option; user scope writes to `~/.config/eforge/backends/`
- `deleteBackendProfile()` - add optional `scope`; infer when unique, error when ambiguous
- `loadConfig()` - thread loaded global config into `resolveActiveProfileName` for precedence steps 3-4
- Client types: `scope` field on `BackendProfileInfo`, `BackendProfileSource` gains `'user-local'` | `'user-team'`, request types gain `scope` field
- Daemon HTTP: all 5 `/api/backend/*` routes accept and thread `scope`
- Unit tests for all new behavior

### Out of Scope
- MCP tool and Pi extension schema changes (plan-02)
- Skill and documentation updates (plan-03)

## Files

### Modify
- `packages/engine/src/config.ts` - Add `userBackendsDir()`, `userProfilePath(name)`, `userMarkerPath()` path helpers alongside existing helpers (lines ~692-702). Extend `ActiveProfileSource` type (line 681) with `'user-local'` | `'user-team'`. Update `loadBackendProfile(configDir, name)` (lines 792-813) to try project first then user dir, returning `{ profile, scope }`. Update `listBackendProfiles(configDir)` (lines 821-853) to merge entries from both scopes, adding `scope: 'project' | 'user'` and `shadowedBy?: 'project'` fields to each entry. Extend `resolveActiveProfileName(configDir, projectConfig)` (lines 732-785) to accept optional `userConfig` parameter and walk 5-step precedence: (1) project marker, (2) project config `backend:`, (3) user marker, (4) user config `backend:`, (5) none. Update `setActiveBackend(configDir, name)` (lines 860-906) to accept `opts?: { scope?: 'project' | 'user' }` - when scope is `'user'`, write to `userMarkerPath()` instead of project marker; validate profile exists in at least one scope. Update `createBackendProfile(configDir, input)` (lines 913-1005) to accept `scope: 'project' | 'user'` in input - when `'user'`, write to `userBackendsDir()`. Update `deleteBackendProfile(configDir, name, force?)` (lines 1012-1055) to accept optional `scope` - when omitted and name exists in both scopes, throw a clear error; when specified, delete from that scope only. Update `loadConfig()` (lines 629-665) to pass `globalConfig` as `userConfig` into `resolveActiveProfileName` and use the scope-aware `loadBackendProfile`.
- `packages/client/src/types.ts` - Add `scope: 'project' | 'user'` to `BackendProfileInfo` (line 196). Add `shadowedBy?: 'project'` to `BackendProfileInfo`. Add `'user-local'` | `'user-team'` to `BackendProfileSource` union (line 203). Add `scope?: 'project' | 'user' | 'all'` to a new `BackendListRequest` type. Add optional `scope?: 'project' | 'user'` to `BackendUseRequest` (line 224), `BackendCreateRequest` (line 233), `BackendDeleteRequest` (line 248). Add `scope?: 'project' | 'user'` to `BackendShowResponse.resolved` (line 216).
- `packages/monitor/src/server.ts` - `GET /api/backend/list` (line 885): parse `?scope=` query param, pass to `listBackendProfiles`, include scope in response entries. `GET /api/backend/show` (line 907): pass user config to `resolveActiveProfileName`, include scope in resolved response. `POST /api/backend/use` (line 937): parse optional `scope` from body, pass to `setActiveBackend`. `POST /api/backend/create` (line 968): parse optional `scope` from body, pass to `createBackendProfile`. `DELETE /api/backend/:name` (line 1015): parse optional `scope` from body, pass to `deleteBackendProfile`.
- `test/config-backend-profile.test.ts` - Add test cases: (1) user-scope profile loads when no project profile exists, (2) project profile shadows user profile on same-name collision, (3) user marker (`~/.config/eforge/.active-backend`) wins over user config's `backend:` field, (4) project marker beats all user-level sources, (5) `createBackendProfile` with `scope: 'user'` writes to user dir, (6) `deleteBackendProfile` errors on ambiguous name without `scope`, (7) `listBackendProfiles` returns entries from both scopes with correct `scope` and `shadowedBy` fields, (8) `setActiveBackend` with `scope: 'user'` writes user marker.

## Verification

- [ ] `pnpm type-check` passes with zero errors across all packages
- [ ] `pnpm test` passes - all existing config-backend-profile tests still green
- [ ] New test: `resolveActiveProfileName` returns `source: 'user-local'` when project has no marker/config but user marker exists and points to a valid profile
- [ ] New test: `resolveActiveProfileName` returns `source: 'local'` (project) when both project and user markers exist - project wins
- [ ] New test: `listBackendProfiles` returns entries with `scope: 'project'` and `scope: 'user'` and marks user entries with `shadowedBy: 'project'` when a project profile has the same name
- [ ] New test: `createBackendProfile` with `scope: 'user'` writes file under the user config backends directory, not the project directory
- [ ] New test: `deleteBackendProfile` without `scope` throws an error containing "ambiguous" when the same name exists in both scopes
- [ ] New test: `setActiveBackend` with `scope: 'user'` writes the user marker file, not the project marker