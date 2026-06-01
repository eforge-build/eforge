# Config Profile Stack Routes

## Architecture Reference

This module implements the **Route ownership matrix / `config-profile-stack-routes`**, **HTTP route contract**, **Security contract**, and the projection reuse requirements for config redaction and stack layers from `eforge/plans/migrate-monitor-server-to-a-maintainable-architecture/architecture.md`.

Key constraints from architecture:
- Route definitions use `API_ROUTES` keys and values from `@eforge-build/client`; monitor route modules do not embed `/api/...` endpoint literals.
- Feature route modules export route factories only. `packages/monitor/src/routes/index.ts` and `packages/monitor/src/server.ts` remain owned by `server-composition-coverage`.
- Handlers use shared HTTP primitives from `packages/monitor/src/http/` for JSON parsing, JSON responses, route definitions, and security policies.
- Route modules consume `MonitorContext` from `packages/monitor/src/context.ts`; they do not introduce ad hoc option bags.
- Config/profile redaction comes from `packages/monitor/src/projections/config-redaction.ts`.
- Stack layer REST responses come from `packages/monitor/src/projections/stack-layers.ts`, preserving parity with daemon `stream:hello.stackLayers` once streams are wired.
- Stack sync may import `packages/monitor/src/stack-sync-service.ts`, but this module does not grow or rewrite that service.

## Scope

### In Scope

- Create registered route modules for:
  - `projectContext`
  - `health`
  - `version`
  - `configShow`
  - `configValidate`
  - `profileList`
  - `profileShow`
  - `profileUse`
  - `profileCreate`
  - `profileDelete`
  - `modelProviders`
  - `modelList`
  - `stackLayers`
  - `stackSync`
  - `stackSyncStatus`
- Add a single feature-level route factory that final composition can import without editing `routes/index.ts` in this module.
- Preserve the current response bodies, error messages, and status-code mapping for the migrated route handlers.
- Preserve current profile route behavior, including user-profile fallback in `profileShow`, conventional config-dir fallback in `profileList`, and the current `profileDelete` invalid/empty body handling.
- Preserve current model route query validation for `harness=pi|claude-sdk`.
- Preserve current stack sync request validation, disabled-stacking response shape, and stack sync status response quirks.
- Add direct route-module tests using the shared router and real filesystem/SQLite fixtures.
- Add a small shared-router extension for the existing `DELETE /api/profile/:name` endpoint if `foundation-http-context` did not already add `DELETE` to `HttpMethod`.

### Out of Scope

- No edits to `packages/monitor/src/server.ts`.
- No edits to `packages/monitor/src/routes/index.ts`.
- No changes to daemon route paths, request shapes, response shapes, SSE frame shapes, or `DAEMON_API_VERSION`.
- No changes to `packages/client/src/routes.ts` or client-owned wire interfaces.
- No changes to `packages/monitor/src/stack-sync-service.ts`; import `runStackSync` and `loadSyncStatusForRoute` only.
- No stream hub, SSE, queue, run summary, run state, plans, diff, recovery, extension, playbook, or session-plan route migration.
- No plugin or Pi extension version changes.
- No public documentation changes.

## Implementation Approach

### Overview

Add route factories under `packages/monitor/src/routes/` that copy the config/profile/model/stack handler behavior currently embedded in `packages/monitor/src/server.ts`, but express it as `RouteDefinition[]` using the shared router primitives. The new modules compile and are tested directly, while the existing `server.ts` route chain remains unchanged until `server-composition-coverage` performs final wiring.

Recommended implementation order:

1. Extend the shared router `HttpMethod` union to include `DELETE` if needed for `profileDelete`.
2. Create profile helper functions for profile harness extraction, project partial config loading, scope validation, profile name validation, warning logging, and optional delete-body parsing.
3. Create `config-context.ts` for project context, health, version, config show, and config validate routes.
4. Create `profiles.ts` for profile list/show/use/create/delete routes.
5. Create `models.ts` for model provider/model list routes.
6. Create `stack.ts` for stack layers, stack sync status, and stack sync mutation routes.
7. Create `config-profile-stack.ts` as the feature-level factory that concatenates this module's route groups.
8. Add direct route-module tests that instantiate `createRouter` with a real `MonitorContext` and a stub stream hub.
9. Run type-check, focused tests, and maintainability checks.

### Key Decisions

1. **Keep `server.ts` untouched in this module.**
   - Rationale: final route wiring and deletion of server-local handlers belongs to `server-composition-coverage`, avoiding concurrent edits to the 4,924-line file.

2. **Use client-documented methods for route definitions.**
   - Rationale: route registration is method-aware and client helpers define the daemon contract: GET for read routes, POST for profile create/use and stack sync, and DELETE for profile delete.

3. **Add `DELETE` to the shared router as a narrow cross-owner exception.**
   - Rationale: `API_ROUTES.profileDelete` is used by `packages/client/src/api/profile.ts` with method `DELETE`; the foundation plan's `HttpMethod = 'GET' | 'POST' | 'OPTIONS'` cannot represent the existing daemon endpoint. This module records the required shared edit explicitly.

4. **Do not add new security gates to profile/config read routes in this migration.**
   - Rationale: current `server.ts` exposes these routes without local-only or Fetch Metadata guards. Adding a guard would change status codes for existing callers. Stack sync keeps its existing local mutation guard.

5. **Use projection modules for every read model already extracted by dependencies.**
   - Rationale: `redactSensitive` and `redactGitRemote` live in `projections/config-redaction.ts`; `stackLayersToWire` lives in `projections/stack-layers.ts`. Route handlers import those functions instead of copying logic.

6. **Keep route-specific validation in route modules.**
   - Rationale: malformed profile names, invalid model harness values, and stack sync body field errors have route-specific response messages that must remain stable.

7. **Keep stack sync service ownership unchanged.**
   - Rationale: the service already serializes wet syncs, persists status, emits daemon events, and redacts provider errors. This module only moves HTTP request parsing and response dispatch into a route module.

## Files

### Create

- `packages/monitor/src/routes/config-profile-stack.ts` — feature-level factory owned by this module.
  - Export `createConfigProfileStackRoutes(context: MonitorContext): RouteDefinition[]`.
  - Concatenate `createConfigContextRoutes(context)`, `createProfileRoutes(context)`, `createModelRoutes(context)`, and `createStackRoutes(context)` in that order.
  - Export no route handlers directly.

- `packages/monitor/src/routes/config-context.ts` — project context, health, version, config show, and config validate route definitions.
  - Register `projectContext`, `health`, `version`, `configShow`, and `configValidate` with `API_ROUTES` values.
  - `projectContext` returns `{ cwd: context.cwd ?? null, gitRemote: redactGitRemote(context.cachedGitRemote) }`.
  - `health` returns `{ status: 'ok', pid: context.versionInfo.pid }`.
  - `version` returns `{ version: context.versionInfo.daemonApiVersion, eforgeVersion: context.versionInfo.eforgeVersion }`.
  - `configShow` parses `verbose` from `ctx.query`; `verbose=1` and `verbose=true` return the verbose sources object; all other values return the redacted merged config.
  - `configValidate` delegates to `validateConfigFile(context.cwd)`.
  - Use `ConfigShowResponse`, `ConfigShowVerboseResponse`, `ConfigValidateResponse`, `HealthResponse`, `ProjectContext`, and `VersionResponse` from `@eforge-build/client` where return values cross the daemon boundary.

- `packages/monitor/src/routes/profile-helpers.ts` — profile-only helper functions.
  - Export `extractHarnessFromProfile(profile)` with the current agent runtime and legacy `backend` fallback behavior.
  - Export `loadProjectPartialConfig(configDir)` using `yaml` parsing and returning `{}` for missing/malformed config files.
  - Export `isProfileScope(value)` for `local | project | user`.
  - Export `isValidProfileName(value)` using the current `/^[A-Za-z0-9._-]+$/` rule.
  - Export `writeWarnings(warnings)` to preserve current stderr logging behavior: write each warning followed by a newline.
  - Export `readOptionalProfileDeleteOptions(req)` that calls shared `parseJsonBody`, treats parse failure as `{ force: false, scope: undefined }`, and preserves the current delete-route behavior for invalid/empty bodies.

- `packages/monitor/src/routes/profiles.ts` — profile list/show/use/create/delete route definitions.
  - Register `profileList`, `profileShow`, `profileUse`, `profileCreate`, and `profileDelete` with `API_ROUTES` values.
  - `profileList`:
    - parse `scope` from `ctx.query`;
    - use `getConfigDir(context.cwd) ?? getConventionalConfigDir(context.cwd)` for profile discovery;
    - filter only when scope is `local`, `project`, or `user`; leave `all` and invalid values unfiltered;
    - resolve active profile with `resolveActiveProfileName` and `loadUserConfig`;
    - return `{ profiles, active: name, source }`.
  - `profileShow`:
    - when no project config dir exists, use `resolveUserActiveProfile` and `loadUserProfile`;
    - when a config dir exists, use `resolveActiveProfileName`, `loadUserConfig`, and `loadProfile`;
    - redact the returned profile object;
    - preserve source values (`none`, `user-local`, `local`, `project`, `missing`) and metadata extraction.
  - `profileUse`:
    - parse JSON body with shared `parseJsonBody`;
    - return 400 for invalid JSON or missing `name` string;
    - return 404 when no config directory exists;
    - map `not found` errors to 404 and all other engine errors to 400.
  - `profileCreate`:
    - parse JSON body with shared `parseJsonBody`;
    - return 400 for invalid JSON or missing `name` string;
    - call `createAgentRuntimeProfile` with `agents`, `metadata`, `overwrite`, and optional `scope`;
    - map `already exists` to 409 and all other engine errors to 400.
  - `profileDelete`:
    - use method `DELETE` and `pattern: API_ROUTES.profileDelete`;
    - read the decoded route param `ctx.params.name`;
    - reject invalid names with 400 and message `Invalid agent runtime profile name`;
    - use optional delete options from the helper;
    - map `currently active` and `ambiguous` to 409, `not found` to 404, all other engine errors to 400, and outer unexpected errors to 500.

- `packages/monitor/src/routes/models.ts` — model provider/model list route definitions.
  - Register `modelProviders` and `modelList` with `API_ROUTES` values.
  - Validate `harness` from `ctx.query` as `pi` or `claude-sdk`.
  - Return 400 with the current message when `harness` is missing or invalid.
  - Delegate to `listProviders(harness)` and `listModels(harness, provider)` from `@eforge-build/engine/models`.
  - Return 500 with the current fallback messages on thrown errors.

- `packages/monitor/src/routes/stack.ts` — stack layers, stack sync, and stack sync status route definitions.
  - Register `stackLayers`, `stackSync`, and `stackSyncStatus` with `API_ROUTES` values.
  - `stackLayers` returns `{ layers: context.cwd ? stackLayersToWire(context.cwd) : [] }`.
  - `stackSyncStatus` returns `{ version: 1 }` when no `cwd` is configured, and otherwise returns `{ last: statusFile.last, current: statusFile.current }` from `loadSyncStatusForRoute`.
  - `stackSync` declares the shared local mutation security policy with operation label `Stack sync mutations`.
  - `stackSync` preserves the current validation messages for invalid JSON, non-object body, `dryRun`, `trigger`, and `activeBuildPolicy`.
  - `stackSync` returns the existing skipped response when `config.stacking.enabled` is false.
  - `stackSync` delegates enabled-stack execution to `runStackSync({ db: context.db, config, cwd, request })`.

- `packages/monitor/src/__tests__/routes-config-profile-stack.test.ts` — direct route factory and router coverage.
  - Assert `createConfigProfileStackRoutes(context)` registers exactly the route keys owned by this module.
  - Assert every definition's `pattern` equals `API_ROUTES[routeKey]`.
  - Assert `profileDelete` uses method `DELETE`.
  - Assert a router created from these routes dispatches `DELETE` to the profile-delete matcher path instead of falling through due to method rejection.

- `packages/monitor/src/__tests__/routes-config-context.test.ts` — direct HTTP tests for config/context routes.
  - Use real `openDatabase(':memory:')`, `createMonitorContext`, `createRouter`, a stub stream hub, and a small Node HTTP server.
  - Assert health returns status `ok` and the injected pid.
  - Assert version returns injected daemon API version and eforge version.
  - Assert project context strips credentials from an HTTPS git remote.
  - Assert config show redacts nested sensitive keys.
  - Assert verbose config show reports local/project/user source paths and found flags.
  - Assert config validate returns the engine validation result for a temp project.

- `packages/monitor/src/__tests__/routes-profiles.test.ts` — direct HTTP tests for profile routes.
  - Use real temp config/profile directories and engine config helpers.
  - Assert list returns profiles and active profile source for local/project/user fixtures.
  - Assert show redacts sensitive profile fields and includes metadata.
  - Assert use returns 400 for invalid JSON and missing `name`, and 404 when no config dir exists.
  - Assert create maps duplicate profile errors to 409.
  - Assert delete rejects invalid profile names with 400.
  - Assert delete with an invalid JSON body still reaches profile deletion with default force/scope behavior.

- `packages/monitor/src/__tests__/routes-models.test.ts` — direct HTTP tests for model routes.
  - Assert missing or invalid `harness` returns 400 for both routes with the current error message.
  - Assert `modelProviders?harness=claude-sdk` returns `{ providers: [] }`.
  - Add a success assertion for `modelList?harness=claude-sdk` only if the repository test environment already has the required Pi AI dependency installed; otherwise limit coverage to validation and provider listing.

- `packages/monitor/src/__tests__/routes-stack.test.ts` — direct HTTP tests for stack routes.
  - Assert `stackLayers` returns the same data as `stackLayersToWire(cwd)` for a valid layer fixture.
  - Assert `stackSyncStatus` returns `{ version: 1 }` without `cwd`.
  - Assert `stackSyncStatus` returns `last` and `current` values from a persisted status fixture when `cwd` is set.
  - Assert `stackSync` rejects non-loopback Host, non-loopback remote address, and cross-origin Origin inputs with HTTP 403 through the route security policy.
  - Assert `stackSync` returns 400 for invalid JSON, non-object body, invalid `dryRun`, invalid `trigger`, and invalid `activeBuildPolicy`.
  - Assert disabled stacking returns the current skipped response fields.

### Modify

- `packages/monitor/src/http/router.ts` — add `DELETE` support for the existing profile delete route. `[region: config-profile-stack-routes, narrow HttpMethod extension for profileDelete]`
  - Extend `HttpMethod` to include `'DELETE'` if it is still absent after `foundation-http-context` lands.
  - Ensure route matching and dispatch accept a `DELETE` request method.
  - Do not change unknown API fallback behavior for unsupported methods.
  - Do not change the CORS preflight response unless the foundation implementation hard-rejects `DELETE` before route dispatch; preserving the existing `Access-Control-Allow-Methods` header is preferred for behavior parity.
  - If a temporary source marker is needed for this shared-file edit, use `plan-05-config-profile-stack-routes` and keep it outside durable semantic `eforge:region` blocks.

## Implementation Details

### Route factory conventions

Each route module exports a factory that receives `MonitorContext` and returns `RouteDefinition[]`. Handlers may close over the supplied context and must also accept the shared `RequestContext` for request-specific data (`params`, `query`, `req`, `res`). This keeps exported factories context-based without introducing new option bags.

Every route definition uses `defineRoute` and sets both `routeKey` and `pattern`:

- `routeKey` is one of the keys listed in this module's route ownership matrix.
- `pattern` is the corresponding `API_ROUTES.<key>` value.
- route modules do not construct their own route prefixes or path literals.

### Body parsing

Use `parseJsonBody` from `packages/monitor/src/http/request.ts` directly. Do not add another function or constant named `parseJsonBody` in route modules.

Invalid JSON handling by route:

- `profileUse`: 400 `{ error: 'Invalid JSON body' }`.
- `profileCreate`: 400 `{ error: 'Invalid JSON body' }`.
- `profileDelete`: ignore parse failure and use default `force=false`, `scope=undefined`.
- `stackSync`: 400 `{ error: 'Invalid JSON request body' }`.

### Security policies

- `stackSync` declares local mutation security with the existing operation label `Stack sync mutations`.
- Profile routes preserve current accessibility in this module. If a later security hardening PR changes profile route trust boundaries, it must update client/UI behavior and tests separately.
- Config/context/model/stack layer/status reads preserve current accessibility.

### Stack sync status shape

Preserve the current status-route behavior:

- no `cwd`: send `{ version: 1 }`;
- `cwd` set: load status file and send `{ last: statusFile.last, current: statusFile.current }`, even though the underlying status file also has `version`.

### Client-owned wire shapes

Use imports from `@eforge-build/client` for response and request types. Do not add local `*Response` interfaces for health, project context, config, profile, model, or stack wire shapes.

## Testing Strategy

### Unit Tests

- Route factory metadata:
  - registered route keys equal the 15 route keys owned by this module;
  - every pattern comes from `API_ROUTES[routeKey]`;
  - `profileDelete` is a `DELETE` route.
- Profile helper tests through route behavior:
  - invalid profile names;
  - scope filtering;
  - metadata extraction;
  - redaction of sensitive profile keys;
  - user-profile fallback when no project config dir exists.
- Stack sync request validation:
  - invalid JSON;
  - non-object JSON;
  - invalid `dryRun`;
  - invalid `trigger`;
  - invalid `activeBuildPolicy`.

### Integration Tests

- Use a real Node HTTP server with `createRouter`, real `MonitorContext`, real `MonitorDB`, and a stub `MonitorStreamHub` for direct route-module tests.
- Use real temp directories and real engine config/profile helpers for config and profile route tests.
- Use existing `packages/monitor/src/__tests__/stack-layers-route.test.ts` and `packages/monitor/src/__tests__/stream-hello-parity.test.ts` unchanged as final wiring regression coverage after `server-composition-coverage` connects these routes.
- Existing `startServer` tests remain unchanged in this module because `server.ts` is not wired to the new route factories yet.

## Verification

- [ ] `packages/monitor/src/routes/config-profile-stack.ts` exports `createConfigProfileStackRoutes(context: MonitorContext): RouteDefinition[]`.
- [ ] `createConfigProfileStackRoutes(context)` returns definitions with route keys `projectContext`, `health`, `version`, `configShow`, `configValidate`, `profileList`, `profileShow`, `profileUse`, `profileCreate`, `profileDelete`, `modelProviders`, `modelList`, `stackLayers`, `stackSync`, and `stackSyncStatus`.
- [ ] Every definition returned by this module has `pattern === API_ROUTES[routeKey]`.
- [ ] The `profileDelete` definition has `method === 'DELETE'`.
- [ ] `rg "['\"]\/api\/" packages/monitor/src/routes --glob '*.ts'` returns zero matches for production route modules created by this module.
- [ ] `rg "function parseJsonBody|const parseJsonBody" packages/monitor/src/routes packages/monitor/src/http --glob '!**/__tests__/**'` reports exactly one implementation, in `packages/monitor/src/http/request.ts`.
- [ ] `GET projectContext` through the shared router returns a credential-redacted HTTPS git remote.
- [ ] `GET health` through the shared router returns `{ status: 'ok', pid: <injected pid> }`.
- [ ] `GET version` through the shared router returns the injected daemon API version and eforge version.
- [ ] `GET configShow` redacts nested `apikey`, `token`, `secret`, `password`, `authorization`, `credential`, and `credentials` fields.
- [ ] `GET configShow?verbose=true` returns `resolved` and `sources.local`, `sources.project`, and `sources.user` fields.
- [ ] `GET configValidate` returns the engine validation result for the temp project fixture.
- [ ] `GET profileList` returns filtered results for `scope=local`, `scope=project`, and `scope=user` fixtures.
- [ ] `GET profileShow` returns a redacted profile object and metadata when a profile is active.
- [ ] `POST profileUse` returns HTTP 400 for invalid JSON and missing `name`.
- [ ] `POST profileCreate` maps duplicate profile creation to HTTP 409.
- [ ] `DELETE profileDelete` returns HTTP 400 for an invalid profile name.
- [ ] `GET modelProviders` and `GET modelList` return HTTP 400 when `harness` is missing or not `pi`/`claude-sdk`.
- [ ] `GET stackLayers` returns `{ layers: stackLayersToWire(cwd) }` for a valid fixture.
- [ ] `GET stackSyncStatus` without `cwd` returns `{ version: 1 }`.
- [ ] `POST stackSync` rejects a non-loopback Host, non-loopback remote address, and cross-origin Origin with HTTP 403.
- [ ] `POST stackSync` returns HTTP 400 for invalid JSON, non-object JSON, invalid `dryRun`, invalid `trigger`, and invalid `activeBuildPolicy`.
- [ ] `POST stackSync` with stacking disabled returns `outcome: 'skipped'`, `stackingActive: false`, `restackCandidates: []`, `activeBuildSkips: []`, and `providerCommands: []`.
- [ ] `git diff -- packages/monitor/src/server.ts packages/monitor/src/routes/index.ts packages/monitor/src/stack-sync-service.ts` produces no diff after this module.
- [ ] `wc -l packages/monitor/src/routes/*.ts` shows every route implementation file created by this module at 600 lines or fewer.
- [ ] Every created production file over 300 lines contains balanced durable `// --- eforge:region <semantic-slug> ---` and `// --- eforge:endregion <semantic-slug> ---` markers.
- [ ] `pnpm type-check` exits 0.
- [ ] `pnpm vitest run packages/monitor/src/__tests__/routes-config-profile-stack.test.ts packages/monitor/src/__tests__/routes-config-context.test.ts packages/monitor/src/__tests__/routes-profiles.test.ts packages/monitor/src/__tests__/routes-models.test.ts packages/monitor/src/__tests__/routes-stack.test.ts` exits 0.
- [ ] `pnpm maintainability:check` exits 0.

<build-config>
{
  "build": ["implement", "test-cycle", "review-cycle"],
  "review": {
    "strategy": "parallel",
    "perspectives": ["code", "security"],
    "maxRounds": 2,
    "evaluatorStrictness": "standard"
  }
}
</build-config>
