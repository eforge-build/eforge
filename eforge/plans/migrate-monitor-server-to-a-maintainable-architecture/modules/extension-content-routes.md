# Extension Content Routes

## Architecture Reference

This module implements the architecture sections **Target package layout**, **HTTP route contract**, **Security contract**, **Projection contracts**, **Route ownership matrix / `extension-content-routes`**, and **Module implementation boundaries / `extension-content-routes`**.

Key constraints from architecture:
- Create feature-owned `RouteDefinition[]` factories for extensions, playbooks, session plans, and session plan sets; do not wire them into `packages/monitor/src/routes/index.ts` or `packages/monitor/src/server.ts` in this module.
- Route definitions use `API_ROUTES` route keys and patterns from `@eforge-build/client`; monitor route modules must not embed endpoint path literals.
- Route handlers use shared HTTP primitives from `packages/monitor/src/http/`, especially `parseJsonBody`, `sendJson`, `sendJsonError`, and security policies.
- Route handlers receive `MonitorContext` and use context helpers for `cwd`, queue paths/options, DB access, session ID resolution, config directory resolution, and queue mutation notifications.
- Wire response and request types come from `@eforge-build/client`; do not re-declare client-owned response interfaces in monitor route modules.
- Extension, playbook, session-plan, and session-plan-set implementation files must stay at or below 600 lines; files over 300 lines need balanced durable semantic region markers.
- Existing `packages/monitor/src/session-plan-set-routes.ts` is a legacy extracted route handler. This module creates the registry-based replacement and leaves stale-file deletion to `server-composition-coverage`.

## Scope

### In Scope

- Create a module-owned route aggregator that exports `createExtensionContentRoutes(context): RouteDefinition[]` and the route-key list for this module.
- Create registered route modules for all extension routes:
  - read: list, show, validate;
  - management: scaffold/new and reload;
  - replay/test;
  - trust and untrust;
  - package install, update, remove, promote, and demote.
- Create narrow extension services for discovery/list projection, path validation, replay-source hydration, trust-store mutations, reload watcher metadata, and package-operation response shaping.
- Create registered route modules and narrow services for playbook list/show/save/run/promote/demote/validate/copy.
- Create registered route modules and narrow services for session-plan list/show/create/set-section/skip-dimension/set-status/select-dimensions/readiness/migrate-legacy/create-from-playbook.
- Create registered route modules and narrow services for session-plan-set list/show/validate, replacing the current ad hoc handler pattern without deleting the legacy file.
- Preserve current status codes and JSON response shapes for known validation, not-found, conflict, and filesystem error cases.
- Preserve lazy imports of `@eforge-build/input` and `@eforge-build/engine/extensions/index` inside service functions so route-module import does not perform extension discovery or input loading work.
- Add direct route-module tests that instantiate the shared router with these routes, real temp directories, real input/extension code, and a real `MonitorDB`.

### Out of Scope

- No edits to `packages/monitor/src/server.ts`.
- No edits to `packages/monitor/src/routes/index.ts`.
- No deletion or mutation of `packages/monitor/src/session-plan-set-routes.ts`; final stale-file removal belongs to `server-composition-coverage`.
- No route path, HTTP method, request body, response body, SSE frame, or `DAEMON_API_VERSION` change.
- No changes to `packages/monitor/src/extension-package-management.ts`; import its public package-operation helpers as-is.
- No monitor UI, Console UI, CLI, Claude plugin, or Pi extension changes.
- No engine orchestration, queue scheduling, extension runtime, playbook parser, or session-plan parser behavior changes.

## Implementation Approach

### Overview

Copy the extension/playbook/session-plan/session-plan-set read and mutation logic currently embedded in `server.ts` into route factories plus route-owned services. Keep `server.ts` unchanged in this module so the existing daemon keeps serving requests through the old ordered dispatch chain until the final composition module wires the new registry.

The new route modules return `RouteDefinition[]` and are directly testable with the foundation router. Handlers perform HTTP concerns only: shared JSON parsing, query extraction, security policy declaration, status mapping, and JSON response writing. Services perform feature work with narrow inputs and return client-owned wire shapes or throw/return typed domain failures that handlers map to the current status codes.

### Key Decisions

1. **Create a module-owned aggregator, not the final route index.**
   - Rationale: `packages/monitor/src/routes/index.ts` is owned by `server-composition-coverage`. `packages/monitor/src/routes/extension-content.ts` gives the final module one import while avoiding shared-file edits here.

2. **Replace the legacy session-plan-set handler with a new registry route module, but leave the old file in place.**
   - Rationale: the legacy file is still imported by `server.ts`. Creating `routes/session-plan-sets.ts` avoids a cross-module edit; final composition removes the stale import and file when the router is wired.

3. **Keep route files thin and split feature services before line limits are at risk.**
   - Rationale: extension trust/package/replay and playbook run logic are large enough that one route file would recreate the oversized-server problem. Service files isolate discovery, validation, mutations, and response shaping.

4. **Use service return values for custom error bodies.**
   - Rationale: some existing routes return non-standard error bodies such as `{ error, errors }` for playbook validation and `{ error, readiness }` for session-plan readiness gates. Handlers must preserve those exact shapes instead of forcing every failure through `sendJsonError`.

5. **Security policies mirror current daemon gates and make them declarative.**
   - Rationale: extension mutation/replay/package/trust routes currently use local Host/Origin checks. The new route definitions declare `localMutation('Extension management mutations')`. Session-plan-set reads declare local/cross-site protection because they expose project paths and raw anchor content. Playbook and flat session-plan routes remain ungated to avoid changing the existing contract in this migration.

6. **Use projection event hydration for extension replay histories.**
   - Rationale: replaying a run by ID/session currently calls `parseEventRow`; after `projections-read-models`, the shared event hydration module owns that parser. This route module imports `hydrateEforgeEvent` or an equivalent projection helper rather than duplicating event parsing.

7. **Preserve route-specific JSON parse error behavior.**
   - Rationale: current content routes generally return HTTP 400 with `Invalid JSON body` for parse failures. New handlers use the shared `parseJsonBody` implementation but keep the route-level status/message mapping unless an existing test requires another status.

8. **Use `API_ROUTES` constants inside user-facing messages that mention routes.**
   - Rationale: messages such as the autonomous playbook create-from-playbook rejection must keep the same rendered string while satisfying the no-hard-coded-endpoints policy.

## Files

### Create

- `packages/monitor/src/routes/extension-content.ts` — module-owned route aggregator.
  - Export `EXTENSION_CONTENT_ROUTE_KEYS` containing the 34 route keys owned by this module.
  - Export `createExtensionContentRoutes(context: MonitorContext): RouteDefinition[]` that concatenates extension, playbook, session-plan, and session-plan-set route factories.
  - Export no final app router wiring.

- `packages/monitor/src/routes/content-validation.ts` — shared validators for this module.
  - Export `PLAYBOOK_NAME_RE`, `SESSION_PLAN_ID_RE`, planning type/depth/profile/status constants, and small validation helpers.
  - Keep validators route-agnostic and free of HTTP response writes.

- `packages/monitor/src/routes/extensions/index.ts` — extension route-group aggregator.
  - Export `createExtensionRoutes(context: MonitorContext): RouteDefinition[]` by concatenating read, management, replay, trust, and package route factories.

- `packages/monitor/src/routes/extensions/validation.ts` — extension request/body validators.
  - Export `EXTENSION_NAME_RE`, `isPlainObject`, boolean/string field validators, package target body validation, and extension-test body validation.
  - Do not define client-owned request/response interfaces; use imported client types plus narrow internal validation results.

- `packages/monitor/src/routes/extensions/path-security.ts` — extension path containment helpers.
  - Move `validateExtensionQueryPath` and `isProjectTeamExtensionPath` behavior from `server.ts`.
  - Use `realpath`, `lstat`, and containment checks to reject null bytes, traversal, symlink escapes, and paths outside the project/team extension roots.

- `packages/monitor/src/routes/extensions/discovery-service.ts` — extension discovery/list projection service.
  - Move `EMPTY_EXTENSION_REGISTRATIONS`, `normalizeExtensionDiagnostic`, `extensionEntryEnabled`, `selectExtensionByName`, and `loadExtensionResponse` behavior.
  - Import extension response/wire types from `@eforge-build/client`.
  - Use lazy imports for `loadConfig`, config-dir helpers, `loadNativeExtensions`, `discoverNativeExtensions`, and `projectExtensionRegistry`.

- `packages/monitor/src/routes/extensions/reload-service.ts` — reload watcher metadata service.
  - Move `reloadAutoBuildExtensions` behavior.
  - Use the auto-build controller snapshot when available and the projection fallback from `projections/auto-build-state.ts` when absent.

- `packages/monitor/src/routes/extensions/replay-service.ts` — extension test/replay service.
  - Move source diagnostic creation, fixture/run replay source resolution, config loading, and `replayNativeExtensionEvents` invocation.
  - Use `MonitorDB` plus the projection event hydration helper for run/session event replay.

- `packages/monitor/src/routes/extensions/trust-service.ts` — trust/untrust service.
  - Move project-team candidate discovery, ambiguity handling, hash computation, trust-store mutation, and response entry shaping for trust and untrust.
  - Reuse `path-security.ts` for team path containment.

- `packages/monitor/src/routes/extensions/package-service.ts` — package management response service.
  - Wrap `installExtensionPackage`, `updateExtensionPackage`, `removeExtensionPackage`, `promoteExtensionPackage`, and `demoteExtensionPackage` from `extension-package-management.ts`.
  - After install/update/promote/demote, re-discover the target path with `loadExtensionResponse({ path, discoverOnly: true })` and preserve current success/error messages.

- `packages/monitor/src/routes/extensions/read.ts` — route definitions for `extensionList`, `extensionShow`, and `extensionValidate`.
  - Use `ctx.query` for query parameters.
  - Delegate discovery and selection to extension services.
  - Preserve current 400/404/500/503 mapping.

- `packages/monitor/src/routes/extensions/management.ts` — route definitions for `extensionNew` and `extensionReload`.
  - Declare `localMutation('Extension management mutations')` security.
  - Use shared `parseJsonBody` and response helpers.
  - Preserve scaffold validation and reload watcher response shape `{ ...data, ...watcher, watcher }`.

- `packages/monitor/src/routes/extensions/replay.ts` — route definition for `extensionTest`.
  - Declare `localMutation('Extension management mutations')` security.
  - Validate name/path/fixture/run/event inputs and delegate replay work to `replay-service.ts`.

- `packages/monitor/src/routes/extensions/trust.ts` — route definitions for `extensionTrust` and `extensionUntrust`.
  - Declare `localMutation('Extension management mutations')` security.
  - Preserve trustedBy validation, name/path exclusivity, project-team-only constraints, and status-code mapping.

- `packages/monitor/src/routes/extensions/packages.ts` — route definitions for `extensionInstall`, `extensionUpdate`, `extensionRemove`, `extensionPromote`, and `extensionDemote`.
  - Declare `localMutation('Extension management mutations')` security.
  - Map `ExtensionPackageError.statusCode` to HTTP status and unknown errors to 500 with the current fallback messages.

- `packages/monitor/src/routes/playbook-service.ts` — playbook route service.
  - Move list/show/save/run/promote/demote/validate/copy and create-from-playbook feature logic out of `server.ts` into functions with narrow inputs.
  - Use lazy imports for `@eforge-build/input`, config helpers, profile loading, and queue helpers.
  - Preserve playbook acceptance-criteria quality gates, landing action/auto-merge validation, profile existence validation, afterQueueId classification, queue enqueue placement, and `monitor.notifyQueueMutation('playbook-enqueue')`.
  - Use `monitor.options.queueDir ?? '.eforge/queue'` for playbook queue enqueue/classification to preserve current route behavior.

- `packages/monitor/src/routes/playbooks.ts` — route definitions for playbook and create-from-playbook routes.
  - Register `playbookList`, `playbookShow`, `playbookSave`, `playbookRun`, `playbookPromote`, `playbookDemote`, `playbookValidate`, `playbookCopy`, and `sessionPlanCreateFromPlaybook`.
  - Use shared JSON parser/response helpers and client-owned playbook/session-plan request and response types.
  - Preserve custom error bodies for playbook validation failures.

- `packages/monitor/src/routes/session-plan-service.ts` — flat session-plan service.
  - Move list/show/create/set-section/skip-dimension/set-status/select-dimensions/readiness/migrate-legacy behavior.
  - Use lazy imports from `@eforge-build/input`.
  - Preserve readiness summary fields, submitted-plan inclusion semantics, AC diagnostics handling, and migration response shape.

- `packages/monitor/src/routes/session-plans.ts` — route definitions for flat session-plan routes.
  - Register `sessionPlanList`, `sessionPlanShow`, `sessionPlanCreate`, `sessionPlanSetSection`, `sessionPlanSkipDimension`, `sessionPlanSetStatus`, `sessionPlanSelectDimensions`, `sessionPlanReadiness`, and `sessionPlanMigrateLegacy`.
  - Use shared validators for session IDs and enum fields.
  - Preserve custom `{ error, readiness }` body for the ready-status AC diagnostics gate.

- `packages/monitor/src/routes/session-plan-set-service.ts` — session-plan-set read service.
  - Move list/show/validate shaping from `session-plan-set-routes.ts`.
  - Import session-plan-set wire types from `@eforge-build/client`.
  - Delegate manifest parsing/loading/validation to `@eforge-build/input`.
  - Preserve filtering of abandoned/submitted sets and error-to-status mapping.

- `packages/monitor/src/routes/session-plan-sets.ts` — route definitions for session-plan-set routes.
  - Register `sessionPlanSetList`, `sessionPlanSetShow`, and `sessionPlanSetValidate` as GET routes.
  - Declare local/cross-site security policies for `Session plan-set reads`.
  - Use `ctx.query` for `includeSubmitted` and `planSetId`.

- `packages/monitor/src/__tests__/route-test-harness.ts` — test-only router harness.
  - Create an in-process Node HTTP server around `createRouter` with real `MonitorContext`, real `MonitorDB`, temp cwd, and an inert `MonitorStreamHub` object.
  - Expose helpers for POST JSON, starting content-route routers, and shutting down servers.

- `packages/monitor/src/__tests__/routes-extension-content-registration.test.ts` — route registration coverage for this module.
  - Assert registered route keys exactly equal `EXTENSION_CONTENT_ROUTE_KEYS`.
  - Assert every route definition pattern equals `API_ROUTES[route.routeKey]`.
  - Assert methods match the ownership matrix and route keys are unique.
  - Assert extension mutation routes and session-plan-set read routes carry security policies while playbook and flat session-plan routes do not.

- `packages/monitor/src/__tests__/routes-extensions.test.ts` — direct tests for new extension route modules.
  - Use real temp projects and real extension files.
  - Cover list/show/validate happy paths, invalid extension names, invalid/escaped replay paths, cross-origin/Host rejection for `extensionTest`, scaffold validation, and package error mapping for at least one package route.

- `packages/monitor/src/__tests__/routes-playbooks.test.ts` — direct tests for new playbook route modules.
  - Cover list/show, save validation failures with `{ error, errors }`, save success, autonomous run queue enqueue plus queue mutation notification, planning-mode run `requires-agent`, invalid landingAutoMerge combinations, and create-from-playbook conflict/not-found mappings.

- `packages/monitor/src/__tests__/routes-session-plans.test.ts` — direct tests for new flat session-plan route modules.
  - Cover list includeSubmitted behavior, show 400/404/200 cases, create enum validation, set-section/skip-dimension responses, set-status ready AC diagnostics body, select-dimensions, readiness, and migrate-legacy.

- `packages/monitor/src/__tests__/routes-session-plan-sets.test.ts` — direct tests for new session-plan-set route module.
  - Cover list filtering, show response with anchor content, validate response, unsafe/missing planSetId, no-cwd 500 behavior, not-found 404 mapping, and local/cross-site security rejection.

### Modify

- None.

This module intentionally avoids all shared files listed in the architecture Shared File Registry. No `[region: extension-content-routes, ...]` shared-file edit annotations are required. If implementation discovers that editing `server.ts`, `routes/index.ts`, or `session-plan-set-routes.ts` is unavoidable, stop and revise this plan before coding.

## Implementation Details

### Route factory shape

Every route factory uses the foundation router contract:

```ts
export function createPlaybookRoutes(context: MonitorContext): RouteDefinition[] {
  return [
    defineRoute({
      routeKey: 'playbookList',
      method: 'GET',
      pattern: API_ROUTES.playbookList,
      handler: (ctx) => handlePlaybookList(ctx, context),
    }),
  ];
}
```

The handler may read `ctx.monitor` instead of the closed-over `context`, but the exported factory signature stays context-based for consistency with other feature modules.

### Extension route details

- `extensionList` returns the same `ExtensionListResponse` produced by current `loadExtensionResponse()`.
- `extensionShow` requires `name`, validates it with `EXTENSION_NAME_RE`, uses `selectExtensionByName`, and returns 404 `Extension not found: ${name}` when absent.
- `extensionValidate` preserves name/path mutual exclusion, realpath containment validation for `path`, scoped diagnostic filtering, duplicate diagnostic de-duping, and `{ valid, extensions, diagnostics }` shape.
- `extensionNew` validates `name`, `scope`, `template`, and `force`, then calls `scaffoldNativeExtension`.
- `extensionReload` combines extension list data with reload watcher metadata and the nested `watcher` property.
- `extensionTest` preserves static-only replay, fixture replay, latest/run/session replay, event filtering, timeout config, source diagnostics, and non-persistence of replay diagnostics.
- Trust/untrust routes preserve project-team-only lookup, ambiguity errors, path containment messages, hash failure mapping, trust-store response fields, and current success messages.
- Package routes preserve body validation, `ExtensionPackageError` status mapping, post-mutation discovery, needs-trust messages, and the remove response message.

### Playbook route details

- `playbookList` uses `getConfigDir(cwd)` and falls back to `cwd` for listing, matching current behavior.
- `playbookShow` requires kebab-case `name`, returns 404 when config dir or playbook is absent, and returns 500 for non-not-found load failures.
- `playbookSave` validates scope, frontmatter schema, required goal body, optional string body fields, and acceptance criteria diagnostics before writing.
- `playbookRun` rejects legacy `onSuccess`, validates landing action and landingAutoMerge using project config, returns `requires-agent` for planning-mode playbooks without queue writes, and enqueues autonomous playbooks with the existing PRD queue helper.
- `sessionPlanCreateFromPlaybook` remains in the playbook route/service area because it depends on playbook loading and seed conversion. It validates planning-mode only, checks file collision before writing, and maps traversal/session errors to 400.
- Promote/demote/copy use `movePlaybook`/`copyPlaybookToScope` and preserve 404 mapping for not-found/ENOENT cases.
- Validate uses `validatePlaybook(raw)` and returns `{ ok: true }` or `{ ok: false, errors }`.

### Session-plan route details

- List uses `includeSubmitted=true` or `includeSubmitted=1` to include submitted plans and always excludes abandoned plans through the input-layer statuses.
- Show strips internal `sections` from the loaded plan before returning `{ plan: { ...frontmatter, body }, readiness, path }`.
- Create validates session ID, topic, planning type, planning depth, profile, and agent_profile before calling `createSessionPlan`.
- Set-section, skip-dimension, select-dimensions, readiness, and migrate-legacy preserve current status mapping and response fields.
- Set-status preserves valid status values, submitted `eforge_session` requirement, and the ready-status AC diagnostics gate with a JSON body containing both `error` and `readiness`.

### Session-plan-set route details

- The service preserves `includeSubmitted` parsing, abandoned filtering, submitted filtering by default, and response fields from the legacy handler.
- `planSetId` validation rejects empty values, slash/backslash, traversal, and null bytes before calling `@eforge-build/input`.
- Error mapping preserves 404 for ENOENT/not-found, 400 for unsafe/invalid/escape/traversal/session-plan-set-id errors, and 500 for other failures.
- The no-cwd error remains HTTP 500 with `Daemon has no working directory configured` to match the existing route.

## Testing Strategy

### Unit Tests

- Route registration test verifies route keys, methods, pattern equality with `API_ROUTES`, uniqueness, and declared security policy presence/absence.
- Extension service tests cover name/body validation, package target validation, `selectExtensionByName` precedence, query path containment, symlink escape rejection, and project-team path checks.
- Playbook service tests cover body validation helpers, landingAutoMerge validation branches, and error-body shaping for playbook save validation failures.
- Session-plan service tests cover session ID validation, enum validation, readiness-gate error-body shaping, and migration result shaping.
- Session-plan-set service tests cover unsafe plan-set ID rejection and error-to-status classification.

### Integration Tests

- Route-module integration tests use `createRouter`, `createMonitorContext`, a real `MonitorDB`, and a real Node HTTP server around the new route definitions.
- Extension route tests use real extension files and real engine extension discovery/replay code for list/show/validate/test coverage.
- Playbook route tests use real playbook files and real queue writes for save/run/create-from-playbook coverage.
- Session-plan route tests use real session-plan files and real `@eforge-build/input` helpers for list/show/create/mutate coverage.
- Session-plan-set route tests use real plan-set fixture directories and real input validation helpers for list/show/validate coverage.
- Existing `test/extension-tooling-routes.test.ts`, `test/playbook-api.test.ts`, `test/daemon-session-plan-routes.test.ts`, and `test/daemon-session-plan-set-routes.test.ts` remain unchanged in this module; they continue to exercise the legacy `server.ts` path until final composition wires the new routes.

## Verification

- [ ] `packages/monitor/src/routes/extension-content.ts` exports `createExtensionContentRoutes` and `EXTENSION_CONTENT_ROUTE_KEYS`.
- [ ] `EXTENSION_CONTENT_ROUTE_KEYS` contains exactly the extension, playbook, flat session-plan, and session-plan-set route keys listed in the architecture ownership matrix for `extension-content-routes`.
- [ ] Every route returned by `createExtensionContentRoutes(context)` has `pattern === API_ROUTES[route.routeKey]`.
- [ ] `rg "['\"]\\/api\\/" packages/monitor/src/routes/extensions packages/monitor/src/routes/playbooks.ts packages/monitor/src/routes/session-plans.ts packages/monitor/src/routes/session-plan-sets.ts packages/monitor/src/routes/extension-content.ts` returns zero lines.
- [ ] `rg "function parseJsonBody|const parseJsonBody" packages/monitor/src/routes --glob '!**/__tests__/**'` returns zero lines.
- [ ] `rg "sendJson\(|sendJsonError\(" packages/monitor/src/routes/extensions packages/monitor/src/routes/playbooks.ts packages/monitor/src/routes/session-plans.ts packages/monitor/src/routes/session-plan-sets.ts` shows imports from `../http/response.js` or `../../http/response.js`, not locally declared response helpers.
- [ ] `rg "interface .*Response|type .*Response" packages/monitor/src/routes packages/monitor/src/routes/extensions --glob '!**/__tests__/**'` returns no duplicated client-owned route response shapes.
- [ ] `git diff -- packages/monitor/src/server.ts packages/monitor/src/routes/index.ts packages/monitor/src/session-plan-set-routes.ts` produces no diff after this module.
- [ ] `pnpm vitest run packages/monitor/src/__tests__/routes-extension-content-registration.test.ts packages/monitor/src/__tests__/routes-extensions.test.ts packages/monitor/src/__tests__/routes-playbooks.test.ts packages/monitor/src/__tests__/routes-session-plans.test.ts packages/monitor/src/__tests__/routes-session-plan-sets.test.ts` exits 0.
- [ ] `pnpm type-check` exits 0.
- [ ] `pnpm maintainability:check` exits 0.
- [ ] `wc -l packages/monitor/src/routes/**/*.ts packages/monitor/src/routes/*.ts` reports every new production route/service file at 600 lines or fewer.
- [ ] Every new production route/service file over 300 lines contains balanced durable `// --- eforge:region <semantic-slug> ---` and `// --- eforge:endregion <semantic-slug> ---` markers.

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
