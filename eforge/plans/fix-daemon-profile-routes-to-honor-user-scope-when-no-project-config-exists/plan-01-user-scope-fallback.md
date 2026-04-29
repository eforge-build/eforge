---
id: plan-01-user-scope-fallback
name: Daemon profile routes fall back to user scope when no project config
branch: fix-daemon-profile-routes-to-honor-user-scope-when-no-project-config-exists/user-scope-fallback
---

# Daemon profile routes fall back to user scope when no project config

## Architecture Context

The `/eforge:init` skill (Step 1.5) calls `mcp__eforge__eforge_profile { action: "list", scope: "user" }` in fresh projects to surface existing user-scope profiles from `~/.config/eforge/profiles/`. The MCP tool proxies to the daemon's `/api/profile/list` route in `packages/monitor/src/server.ts`. Today, both `profileList` and `profileShow` route handlers call `getConfigDir(cwd)` and short-circuit to an empty response when it returns `null` (no `eforge/config.yaml` in the cwd ancestry), so the user's existing user-scope profiles never reach the caller.

The engine already supports user-only operations: `listProfiles` scans both `profilesDir(configDir)` and `userProfilesDir()`, and `loadProfile` falls through from project to user scope. The fix is to expose a configDir-free path for user-only listing/lookup and to teach the two route handlers to take it when `configDir` is null. Project-scope behavior, `getConfigDir` semantics, and the `profileUse`/`profileCreate`/`profileDelete` routes are explicitly out of scope.

Key files in play:
- `packages/engine/src/config.ts` — owns `userProfilesDir()`, `userMarkerPath()`, `readMarkerName()`, `loadProfileFromPath()`, `listProfiles()`, `loadProfile()`, `resolveActiveProfileName()`. Helpers `userProfilesDir`, `userMarkerPath`, `readMarkerName`, `loadProfileFromPath`, `userProfilePath` are file-private today.
- `packages/monitor/src/server.ts` — hosts the route handlers at lines ~1060 (`profileList`) and ~1093 (`profileShow`).
- `test/config-backend-profile.test.ts` — existing engine-level tests for `listProfiles` (project+user) and `resolveActiveProfileName`. Sets `process.env.XDG_CONFIG_HOME` and exercises the user-scope helpers via `makeUserHome()`.

## Implementation

### Overview

1. In `packages/engine/src/config.ts`, add and export new helpers that operate without a `configDir`:
   - `listUserProfiles(): Promise<Array<{ name: string; harness: 'claude-sdk' | 'pi' | undefined; path: string; scope: 'user' }>>` — scans only `userProfilesDir()`, reuses the existing `scanDir` logic. Implementation: extract the `scanDir` body from `listProfiles` into a module-private helper (e.g. `scanProfilesDir(dir, scope)`) so both `listProfiles` and `listUserProfiles` share one code path; do not duplicate the YAML parse/harness extraction.
   - `resolveUserActiveProfile(): Promise<{ name: string | null; source: 'user-local' | 'none'; warnings: string[] }>` — reads `userMarkerPath()` via `readMarkerName`, validates that the named profile file exists at `userProfilePath(name)`, and returns `{ name, source: 'user-local', warnings: [] }` on hit, `{ name: null, source: 'none', warnings: [...] }` on miss/stale. When the marker is present but the profile file is absent, push a warning string identical in shape to the existing stale-marker warning in `resolveActiveProfileName` so consumers can surface it.
   - `loadUserProfile(name: string): Promise<{ profile: PartialEforgeConfig; scope: 'user' } | null>` — calls `loadProfileFromPath(userProfilePath(name))` and wraps with `scope: 'user'` on hit.
   These three helpers must be exported from the same module surface that `@eforge-build/engine/config` exposes (the route handler uses `await import('@eforge-build/engine/config')`). Verify by grepping the package's `package.json` `exports` block and `src/index.ts` re-exports if present, and adjust re-exports so the new symbols are reachable through the same import the server uses today (alongside `getConfigDir`, `listProfiles`, `loadProfile`, `resolveActiveProfileName`, `loadUserConfig`).
   Do not change the signatures of `listProfiles`, `loadProfile`, or `resolveActiveProfileName`. Do not export `userProfilesDir`, `userProfilePath`, or `userMarkerPath` directly — keep them file-private and expose only the three new high-level helpers.

2. In `packages/monitor/src/server.ts`, rewrite the `profileList` handler (currently at lines ~1060–1091):
   - Parse `scopeParam` from the URL **before** the `configDir` null check so it is available in the no-config branch.
   - When `configDir === null`:
     - If `scopeParam === 'project'`: keep the existing response `{ profiles: [], active: null, source: 'none' }`.
     - Otherwise (`'user'`, `'all'`, or unset): call `listUserProfiles()` and `resolveUserActiveProfile()`. Surface any returned warnings to `process.stderr` (match the existing `for (const warning of warnings) { process.stderr.write(... + '\n'); }` pattern). Respond with `{ profiles, active: name, source }` where `source` is either `'user-local'` (active resolved) or `'none'` (no active). Do not call `loadUserConfig()` or `loadProjectPartialConfig` in this branch — they are not needed for the user-only path.
   - When `configDir !== null`: behavior is unchanged. Do not refactor or restructure the existing branch beyond what is required to share the parsed `scopeParam`.

3. In `packages/monitor/src/server.ts`, rewrite the `profileShow` handler (currently at lines ~1093–1144):
   - When `configDir === null`: call `resolveUserActiveProfile()`. Surface warnings to `process.stderr` as above. If `name` is null, respond with `{ active: null, source: 'none', resolved: { harness: undefined, profile: null } }`. If `name` resolves, call `loadUserProfile(name)` and reuse the existing harness-extraction block (the `agentRuntimes.<runtimeKey>.harness` path with the legacy `backend` fallback). Respond with `{ active: name, source: 'user-local', resolved: { harness, profile, scope: 'user' } }`. The harness-extraction logic is duplicated verbatim from the existing handler — extract it into a small module-private helper inside `server.ts` (e.g. `extractHarnessFromProfile(profile): 'claude-sdk' | 'pi' | undefined`) so the configDir-present and configDir-null branches share one implementation rather than re-pasting the nested `agentRuntimes`/`backend` branching.
   - When `configDir !== null`: behavior is unchanged aside from the helper call replacing the inline block.

4. Tests (extend `test/config-backend-profile.test.ts`):
   - New `describe('user-scope helpers without configDir')` block that follows the existing `describe('user-scope: listProfiles')` pattern (use `makeUserHome()` and set/restore `process.env.XDG_CONFIG_HOME`).
   - Cases:
     a. `listUserProfiles()` returns the two user-scope yaml entries (`claude-sdk-4-7` and `pi-codex-5-5`) with correct `harness` and `scope: 'user'` and skips non-yaml files.
     b. `listUserProfiles()` on an empty user dir returns `[]`.
     c. `resolveUserActiveProfile()` with a valid user marker returns `{ name, source: 'user-local', warnings: [] }`.
     d. `resolveUserActiveProfile()` with a stale user marker (marker file present, profile yaml missing) returns `{ name: null, source: 'none', warnings: [<stale-marker warning string>] }`.
     e. `resolveUserActiveProfile()` with no marker returns `{ name: null, source: 'none', warnings: [] }`.
     f. `loadUserProfile(name)` returns `{ profile, scope: 'user' }` for a present yaml and `null` for an absent name.
   - All fixtures should be constructed inline (no new fixture files), in line with the project's "no mocks, fixtures only for I/O tests" convention.

5. The two existing `describe` blocks in `test/config-backend-profile.test.ts` (`'user-scope: listProfiles'`, the resolve tests) must continue to pass unchanged — do not edit them. Confirm with a `pnpm test -- config-backend-profile` run during build.

### Key Decisions

1. **New high-level helpers, not exported file-private primitives.** Exporting `userProfilesDir`/`userMarkerPath`/`userProfilePath` directly would leak path-construction details and force callers to re-implement marker validation. Three small helpers (`listUserProfiles`, `resolveUserActiveProfile`, `loadUserProfile`) keep the public surface aligned with the existing `listProfiles`/`resolveActiveProfileName`/`loadProfile` trio.
2. **`source: 'user-local'` only when active resolves.** The source field is reused from `ActiveProfileSource`; `'user-local'` is the existing label for the user-marker path in `resolveActiveProfileName`, so the no-configDir branch returns the same label rather than introducing a new one.
3. **No HTTP-level integration test.** The route handlers call `await import('@eforge-build/engine/config')` and dispatch through the daemon's plain `http` server — there is no existing route-level test harness in `test/`. Engine-helper tests cover the new logic; the route wiring is small, mechanical, and validated via the existing manual `/eforge:init` smoke check listed as acceptance criterion. Adding a route harness is out of scope for this fix.
4. **Extract `extractHarnessFromProfile` helper in `server.ts`.** The harness extraction block is non-trivial (nested `agentRuntimes`/`backend` paths) and would otherwise be duplicated across the two `profileShow` branches. Extracting it keeps the no-configDir branch a single readable line.

## Scope

### In Scope
- New exports in `packages/engine/src/config.ts`: `listUserProfiles`, `resolveUserActiveProfile`, `loadUserProfile` (and any required re-exports through `@eforge-build/engine/config`).
- Refactor of `scanDir` in `listProfiles` into a module-private shared helper.
- Updated `profileList` and `profileShow` route handlers in `packages/monitor/src/server.ts`.
- New `extractHarnessFromProfile` module-private helper in `server.ts` (or close to the route handler), reused by both `profileShow` branches.
- New vitest cases in `test/config-backend-profile.test.ts` covering the six scenarios above.

### Out of Scope
- Any change to `getConfigDir`, `findConfigFile`, or project-scope semantics.
- Any change to `profileUse`, `profileCreate`, `profileDelete` route handlers (the source explicitly punts on these unless the same null-configDir bug is also present; engine create/use/delete already accept explicit `scope: 'user'` and do not require configDir for user-only ops, so no fix is needed).
- Any change to the `/eforge:init` skill itself or the MCP tool wiring — both pass through unchanged once the daemon route returns the right data.
- Pi extension changes — `packages/pi-eforge/` consumes the same daemon HTTP API via `@eforge-build/client`, so the fix is automatic; no Pi-side code changes are required and none should be made.
- Plugin version bump — this is a daemon-side bug fix in the engine + monitor; no behavior in `eforge-plugin/` or `packages/pi-eforge/` changes, and per project convention only `eforge-plugin/.claude-plugin/plugin.json` requires bumps when *plugin* code changes. Do not bump it here.
- New documentation. The behavior change is bug-fix-shaped; existing docs already describe the user-scope path as supported, so no doc-updater work is needed.

## Files

### Create
- (none)

### Modify
- `packages/engine/src/config.ts` — extract the inner `scanDir` from `listProfiles` into a module-private `scanProfilesDir(dir, scope)` helper and have `listProfiles` call it. Add and `export` three new functions: `listUserProfiles()`, `resolveUserActiveProfile()`, `loadUserProfile(name)`. If the package re-exports through an `index.ts` (or the `exports` block points elsewhere), add the symbols to whatever surface `@eforge-build/engine/config` resolves to.
- `packages/monitor/src/server.ts` — update the `profileList` handler (currently `if (req.method === 'GET' && (url === API_ROUTES.profileList || url.startsWith(...)))`) so the `scopeParam` is parsed before the null-configDir branch and so the null branch returns user-scope data for `'user'`/`'all'`/unset. Update the `profileShow` handler (currently `if (req.method === 'GET' && url === API_ROUTES.profileShow)`) so the null-configDir branch resolves via the user marker and returns harness/profile/scope. Add a module-private `extractHarnessFromProfile` helper used by both `profileShow` branches.
- `test/config-backend-profile.test.ts` — append a new `describe('user-scope helpers without configDir')` block exercising `listUserProfiles`, `resolveUserActiveProfile`, and `loadUserProfile`. Reuse the file's existing `makeProject`/`makeUserHome` utilities and `XDG_CONFIG_HOME` setup pattern.

## Verification

- [ ] `pnpm type-check` passes with zero errors.
- [ ] `pnpm test` passes including the six new cases in `test/config-backend-profile.test.ts`.
- [ ] `pnpm build` succeeds; `packages/eforge/dist/cli.js` and `packages/monitor/dist/*` rebuild without errors.
- [ ] In a temp directory containing no `eforge/config.yaml`, with `~/.config/eforge/profiles/claude-sdk-4-7.yaml` and `~/.config/eforge/profiles/pi-codex-5-5.yaml` present, an HTTP GET to `/api/profile/list?scope=user` against a daemon started with that cwd returns both profiles with `scope: 'user'` (manual or scripted curl check).
- [ ] Same setup with `scope=all` returns both profiles.
- [ ] Same setup with `scope=project` returns `{ profiles: [], active: null, source: 'none' }`.
- [ ] GET `/api/profile/show` in the same cwd, with `~/.config/eforge/.active-profile` pointing at `claude-sdk-4-7`, returns `{ active: 'claude-sdk-4-7', source: 'user-local', resolved: { harness: 'claude-sdk', profile: <yaml contents>, scope: 'user' } }`.
- [ ] In a project that does have `eforge/config.yaml`, `/api/profile/list` and `/api/profile/show` return identical payloads to the pre-change daemon (regression check against the existing `'user-scope: listProfiles'` and `resolveActiveProfileName` test suites, which must continue to pass without edits).
- [ ] In a fresh project with the two user profiles above, running `/eforge:init` Step 1.5 lists both profiles instead of saying "no existing user-scope profiles available".
