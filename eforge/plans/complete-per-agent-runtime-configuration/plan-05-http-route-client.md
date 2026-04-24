---
id: plan-05-http-route-client
name: HTTP Route Rename + Client Helpers + DAEMON_API_VERSION Bump
depends_on:
  - plan-04-slash-skills-plugin
branch: complete-per-agent-runtime-configuration/http-route-client
agents:
  builder:
    effort: high
    rationale: Breaking HTTP contract change touching server, route registry, shared
      client helpers, and all callers. Must update `API_ROUTES` keys, rename
      client helpers, and bump DAEMON_API_VERSION in lockstep.
  reviewer:
    effort: high
    rationale: Breaking wire-protocol change. Reviewer must confirm no `/backends`
      path literal leaks, all `API_ROUTES.backend*` keys renamed, version bumped
      from 5 to 6, and all callers (monitor-ui, CLI, Pi extension) updated.
---

# HTTP Route Rename + Client Helpers + DAEMON_API_VERSION Bump

## Architecture Context

The daemon exposes `/backends` and `/backends/active` (and related sub-routes) to the monitor UI and the CLI. Per AGENTS.md, the daemon dispatches off `API_ROUTES` in `packages/client/src/api-version.ts`, the shared client has typed helpers per route (`apiBackends`, etc.), and any breaking change to the HTTP surface bumps `DAEMON_API_VERSION`.

This plan completes the HTTP-surface rip of "backend" -> "profile" and bumps the version to 6 to signal the break.

## Implementation

### Overview

1. Rename HTTP routes: `/backends` -> `/profiles`, `/backends/active` -> `/profiles/active`, and any other `backend*` routes in the registry to their `profile*` equivalents.
2. Rename `API_ROUTES.backend*` keys (and any backend-prefixed route constants) to `profile*` equivalents; dispatch in `packages/monitor/src/server.ts` picks up the new keys via the shared registry.
3. Rename `packages/client/src/api/backend.ts` -> `packages/client/src/api/profile.ts` (git mv); rename exported helpers (`apiBackends` -> `apiProfiles`, etc.). Update `packages/client/src/index.ts` exports.
4. Update `packages/monitor-ui/src/lib/api.ts` fetch transport and any browser-side EventSource references to the new `API_ROUTES` keys.
5. Bump `DAEMON_API_VERSION` from 5 to 6 in `packages/client/src/api-version.ts`.
6. Update all other callers of the renamed helpers (CLI, Pi extension).

### Key Decisions

1. **API_ROUTES is the single source of truth.** No inline path literals in server or client.
2. **Version bump is required** because the wire-protocol changes. Clients on v5 will be rejected by the version-match helper.
3. **Breaking rename, no aliasing.** No `/backends` fallback route; clients must upgrade in lockstep with the daemon.

## Scope

### In Scope

- HTTP route renames and server dispatch updates.
- `API_ROUTES` key renames and `DAEMON_API_VERSION` bump.
- Client helper file rename + export rename + re-export from `packages/client/src/index.ts`.
- Caller updates in monitor-ui, CLI, and Pi extension.

### Out of Scope

- MCP tool rename (plan-03).
- Profile directory and loader rename (plan-03).
- Docs (plan-06).
- CHANGELOG.md (release-flow-owned).

## Files

### Create

- `packages/client/src/api/profile.ts` (from `backend.ts` via git mv) - renamed helpers.

### Modify

- `packages/monitor/src/server.ts` - dispatch updates to use the renamed `API_ROUTES.profile*` keys (e.g. `API_ROUTES.profileList`, `profileShow`, `profileUse`, `profileCreate`, `profileDelete` matching the existing `backend*` shape). Any inline string for profile URLs must route via `API_ROUTES`.
- `packages/client/src/api-version.ts` - rename route constants `backends`/`backendsActive` (and any other `backend*` entries) to `profiles`/`profilesActive`; update all `API_ROUTES` object keys; bump `DAEMON_API_VERSION` from 5 to 6.
- `packages/client/src/api/profile.ts` (was `backend.ts`) - rename exported helpers: `apiBackends` -> `apiProfiles`, `apiBackendsActive` -> `apiProfilesActive`, etc., and update their internals to use the renamed `API_ROUTES` keys.
- `packages/client/src/index.ts` - update re-exports: drop the old `./api/backend` export, add `./api/profile`.
- `packages/monitor-ui/src/lib/api.ts` - update fetch transport to reference renamed `API_ROUTES` entries; update any `buildPath(API_ROUTES.backend...)` calls.
- Any additional callers discovered via grep - `packages/eforge/src/` (CLI) and `packages/pi-eforge/extensions/eforge/` (Pi extension) - update imports of renamed helpers and any `API_ROUTES.backend*` key references.

## Verification

- [ ] `pnpm build` exits 0.
- [ ] `pnpm type-check` exits 0.
- [ ] `pnpm test` exits 0.
- [ ] `DAEMON_API_VERSION` in `packages/client/src/api-version.ts` equals 6.
- [ ] `grep -rn "/backends\\b" packages/` returns zero matches outside of historical markdown in CHANGELOG-like files that are not modified here.
- [ ] `grep -rn "apiBackends\\|apiBackendsActive\\|API_ROUTES\\.backend" packages/` returns zero matches.
- [ ] `packages/client/src/api/backend.ts` no longer exists.
- [ ] `packages/client/src/api/profile.ts` exists and exports `apiProfiles` (and the full set of renamed helpers matching the former `apiBackend*` set).
- [ ] Monitor UI fetches `/profiles` (not `/backends`) when rendering profile-related views (verified by inspecting `packages/monitor-ui/src/lib/api.ts`).
