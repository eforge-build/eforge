# Architecture: Migrate Monitor Server to a Maintainable Architecture

## Current-state gap assessment

The migration is not already implemented. `packages/monitor/src/server.ts` is still 4,924 lines and still owns HTTP startup, route dispatch, static asset serving, SSE polling/heartbeat/subscriber lifecycle, event hydration, queue/stack/run projections, body parsing, security guards, and many route groups. Existing extracted files (`queue-recovery-routes.ts`, `resume-eligibility-route.ts`, `session-plan-set-routes.ts`) still receive ad hoc option bags and duplicate helpers such as JSON body parsing/path validation.

No database migration is required. The external daemon HTTP/SSE contract must remain stable; `DAEMON_API_VERSION` must not be bumped for this work.

## Vision and goals

Make `packages/monitor/src/server.ts` a composition root of at most 400 lines while preserving:

- all daemon route paths from `API_ROUTES`;
- all request and response wire shapes owned by `@eforge-build/client`;
- all SSE frame formats, including `stream:hello` snapshots;
- compatibility exports from `@eforge-build/monitor/server` (`startServer`, `MonitorServer`, `WorkerTracker`, `DaemonState`, `StartServerOptions`, and `buildRunSummary`).

The new monitor daemon shape is:

1. `startServer` creates a `MonitorContext`.
2. `createStreamHub(context)` owns SSE streams, polling, heartbeat, and cleanup.
3. `createMonitorRouter(context, streamHub)` registers feature-owned route definitions.
4. The Node `http` server delegates requests to the router.
5. Route handlers use shared HTTP primitives and projection modules.
6. REST routes and SSE hello snapshots call the same projection modules for queue, runs, session metadata, auto-build, stack layers, event hydration, and plan/run projections.

## Core architectural principles

- **Node `http` remains the server runtime.** This refactor changes ownership boundaries; it does not introduce Hono/Fastify or other framework dependencies.
- **Client-owned routes and wire types remain authoritative.** Monitor code imports `API_ROUTES`, schemas, and response types from `@eforge-build/client`. Monitor route modules must not hard-code endpoint literals such as `/api/...`.
- **Context is the broad dependency boundary, not a service locator.** Route factories and stream modules receive `MonitorContext` rather than bespoke option bags. `MonitorContext` owns normalized startup/runtime inputs and must not import routes, streams, or projection modules; projections should accept `MonitorDB` or narrow data inputs rather than the full context unless a planner documents why the broader dependency is necessary.
- **HTTP primitives are single-entry utilities.** JSON parsing, JSON response writing, route matching, route errors, CORS preflight, static serving, and security policies live under `packages/monitor/src/http/`.
- **Streams are infrastructure, not feature routes.** Routes attach requests to `StreamHub`; stream modules own replay, subscriber sets, polling, heartbeat, semantic daemon-event reactions, and cleanup.
- **Projections are reusable read models.** REST and SSE paths use the same projection functions for queue items, stack layers, run summaries, run state, plans, auto-build, config redaction, and event hydration.
- **Final wiring is single-owner.** Most modules create exports only. The final composition module owns `server.ts`, route aggregation, compatibility re-exports, route registry coverage, and monitor file marker normalization to avoid multi-worktree conflicts.

## Target package layout

```text
packages/monitor/src/
  context.ts
  types.ts
  server.ts
  http/
    request.ts
    response.ts
    router.ts
    route-errors.ts
    security.ts
    static-assets.ts
  projections/
    auto-build-state.ts
    config-redaction.ts
    event-hydration.ts
    plans.ts
    queue-items.ts
    run-state.ts
    run-summary.ts
    stack-layers.ts
  streams/
    daemon-stream.ts
    event-parser.ts
    session-stream.ts
    stream-hub.ts
  routes/
    control-plane.ts
    monitor-data.ts
    recovery.ts
    queue-recovery.ts
    profiles.ts
    config-context.ts
    stack.ts
    models.ts
    extensions/
      index.ts
      read.ts
      management.ts
      replay.ts
      trust.ts
      packages.ts
    playbooks.ts
    session-plans.ts
    session-plan-sets.ts
    index.ts              # owned by final composition, not feature modules
```

Names may vary slightly during implementation, but the boundaries above are the contract.

## Shared data model and contracts

### Public compatibility types

Move or centralize public monitor server types in `packages/monitor/src/types.ts`, then re-export them from `packages/monitor/src/server.ts`:

- `MonitorServer`
- `WorkerTracker`
- `DaemonState`
- `StartServerOptions`

`packages/monitor/src/index.ts` may continue exporting `MonitorServer` from `./server.js` as it does today.

### MonitorContext

`MonitorContext` is created once by `createMonitorContext(db, preferredPort, options, versionInfo)` and is read by routes/streams and, only when necessary, projections. It must include at least:

- `db: MonitorDB`
- original `StartServerOptions`
- `cwd?: string`
- normalized UI roots (`monitorUiDir`, `consoleUiDir`)
- queue paths (`queueDir`, queue lock directory, failed/skipped/waiting subdirs) derived from options/config/cwd
- plan output directory derived from options/config
- daemon state and worker tracker references
- effective monitor config, including retention count and scheduler limit source
- `versionInfo` carrying `DAEMON_API_VERSION`, `EFORGE_VERSION`, and `process.pid`
- cached raw git remote metadata; redaction remains owned by `projections/config-redaction.ts`
- shared helper methods: `resolveSessionId`, `getRunningBuildCount`, `getSchedulerLimit`, `notifyQueueMutation`, and profile/config directory resolution where needed by multiple routes

Startup retention cleanup and one-time git remote lookup belong in context creation, not in route handlers.

Dependency direction is intentionally one-way: `context.ts` may depend on stable types/config/db utilities, while routes and streams depend on `MonitorContext`. Projection modules should prefer `MonitorDB`, file paths, or narrow value objects as inputs. `context.ts` must not import route modules, stream modules, or projection modules; this keeps the dependency graph acyclic.

### HTTP route contract

`packages/monitor/src/http/router.ts` defines a small route registry:

```ts
type HttpMethod = 'GET' | 'POST' | 'OPTIONS';

interface RequestContext {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  pathname: string;
  params: Record<string, string>;
  query: URLSearchParams;
  monitor: MonitorContext;
  streams: StreamHub;
}

interface RouteDefinition<K extends keyof typeof API_ROUTES = keyof typeof API_ROUTES> {
  routeKey: K;
  method: HttpMethod;
  pattern: (typeof API_ROUTES)[K];
  security?: SecurityPolicy[];
  handler(ctx: RequestContext): Promise<void> | void;
}
```

Router requirements:

- Match exact and `:param` route patterns segment-by-segment.
- Strip query string before path matching; expose query via `URLSearchParams`.
- Decode parameter segments once. Structural route errors such as percent-decoding failures or missing pattern segments are rejected before handler execution.
- Route-specific semantic validation (for example unknown run IDs, malformed IDs, or unsupported action values) stays in the owning route module or a shared validator it imports, so existing per-route status-code/body behavior can be preserved.
- Preserve status-code behavior for existing invalid parameter cases (plain text where current routes return plain text; JSON where current routes return JSON).
- Expose `getRegisteredRouteKeys()` or equivalent for route coverage tests.
- Keep unknown API fallback after registered API routes and before static fallback.
- Keep CORS preflight behavior for API requests.

### HTTP request/response contract

`packages/monitor/src/http/request.ts` owns the only production implementation of `parseJsonBody`:

- 1 MiB maximum body size.
- Empty body parses as `{}`.
- Invalid JSON maps to 400 at call sites.
- Body too large maps to 413 where call sites distinguish it; existing call sites that returned 400 may retain 400 only if existing tests assert that behavior.

`packages/monitor/src/http/response.ts` owns:

- `sendJson(res, data, status = 200)`
- `sendJsonError(res, status, error)`
- optional `sendText(res, status, body)` for legacy plain-text invalid-parameter cases
- shared JSON/CORS headers.

### Security contract

`packages/monitor/src/http/security.ts` centralizes:

- loopback socket/Host validation for local-only mutation and sensitive read routes;
- Origin-vs-Host same-origin validation;
- Fetch Metadata rejection for browser cross-site requests;
- composable route policies, e.g. `localOnly`, `rejectCrossSiteBrowser`, and `localMutation`.

Route definitions declare policies explicitly. Handlers must not inline their own Host/Origin/Fetch Metadata logic unless the route has a documented exceptional case.

### Static asset contract

`packages/monitor/src/http/static-assets.ts` owns static UI serving for both monitor UI and Console UI roots:

- `/console`, `/console/`, and `/console/*` route to the Console UI root.
- all other non-API paths route to the monitor UI root.
- asset paths under `/assets/` and `/console/assets/` use immutable caching and return 404 on asset misses.
- non-asset misses use SPA fallback to `index.html`.
- percent-decoding errors return 400.
- path traversal and symlink escapes return 404 and never return outside-root file contents.

### StreamHub contract

`createStreamHub(context)` returns:

- `attachSession(req, res, id): void`
- `attachDaemon(req, res): void`
- `broadcast(eventName, data): void`
- `subscriberCount: number`
- `stop(): void | Promise<void>`
- `buildHeartbeatObject(): object` if needed by tests or daemon stream snapshots

The hub owns:

- per-session subscribers;
- daemon-event subscribers;
- poll timer for session and daemon events;
- heartbeat timer for daemon subscribers;
- semantic daemon-event reaction cursor;
- `writeHello()` as the first write for each SSE connection;
- cleanup of all subscribers and timers during `MonitorServer.stop()`.

### Projection contracts

Projection modules produce the same shapes used today:

- `projections/run-summary.ts` exports `buildRunSummary(db, sessionId)` and `server.ts` re-exports it.
- `projections/queue-items.ts` exports sync and async queue loaders. `GET /api/queue` and daemon `stream:hello.queue` must call this module.
- `projections/stack-layers.ts` exports stack-layer loading/validation. `GET /api/stack/layers` and daemon `stream:hello.stackLayers` must call this module.
- `projections/auto-build-state.ts` exports auto-build state and heartbeat projections used by routes and streams.
- `projections/config-redaction.ts` exports recursive sensitive-field redaction and git remote redaction.
- `streams/event-parser.ts` exports low-level `parseEventRow` logic that uses `safeParseEforgeEvent`; `projections/event-hydration.ts` exports higher-level event hydration/read-model helpers for REST and SSE paths by calling that parser.
- `projections/plans.ts` owns plan/orchestration file loading for `GET /api/plans/:runId`.
- `projections/run-state.ts` owns session status plus hydrated event projection for `GET /api/run-state/:id`.

Projection functions that emit daemon wire shapes depend on `@eforge-build/client` types/schemas. They must not define duplicate local response interfaces for client-owned responses.

## Route ownership matrix

Route definitions must use `routeKey` values from `API_ROUTES`.

### `control-monitor-routes`

- `keepAlive`
- `enqueue`
- `cancel`
- `daemonStop`
- `autoBuildGet`
- `autoBuildSet`
- `schedulerKick`
- `recover`
- `readRecoverySidecar`
- `applyRecovery`
- `resumeBuild`
- `resumeEligibility`
- `queueRecoveryAnalyze`
- `queueRecoveryApply`
- `queue`
- `sessionMetadata`
- `runs`
- `events`
- `daemonEvents`
- `runSummary`
- `runState`
- `plans`
- `diff`

### `config-profile-stack-routes`

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

### `extension-content-routes`

- `extensionList`
- `extensionShow`
- `extensionValidate`
- `extensionTest`
- `extensionTrust`
- `extensionUntrust`
- `extensionNew`
- `extensionReload`
- `extensionInstall`
- `extensionUpdate`
- `extensionRemove`
- `extensionPromote`
- `extensionDemote`
- `playbookList`
- `playbookShow`
- `playbookSave`
- `playbookRun`
- `playbookPromote`
- `playbookDemote`
- `playbookValidate`
- `playbookCopy`
- `sessionPlanList`
- `sessionPlanShow`
- `sessionPlanCreate`
- `sessionPlanSetSection`
- `sessionPlanSkipDimension`
- `sessionPlanSetStatus`
- `sessionPlanSelectDimensions`
- `sessionPlanReadiness`
- `sessionPlanMigrateLegacy`
- `sessionPlanCreateFromPlaybook`
- `sessionPlanSetList`
- `sessionPlanSetShow`
- `sessionPlanSetValidate`

## Shared File Registry

The architecture intentionally minimizes concurrent edits to shared files. Feature modules create owned route/projection/stream files and do not register themselves in shared aggregators. The final composition module performs the wiring.

| File | Modules | Region Strategy |
|------|---------|-----------------|
| `packages/monitor/src/server.ts` | `server-composition-coverage` | Single-owner final composition rewrite/trim; no other module edits this file. |
| `packages/monitor/src/routes/index.ts` | `server-composition-coverage` | Single-owner route aggregation; feature route modules export factories only. |
| `packages/monitor/src/context.ts` | `foundation-http-context` (owner), all others consume | Foundation owns exported context shape; downstream modules must not edit unless their module plan declares an append-only extension region. |
| `packages/monitor/src/types.ts` | `foundation-http-context` (owner), `server-composition-coverage` re-exports | Foundation owns type definitions; final module re-exports from `server.ts`. |
| `packages/monitor/src/http/*` | `foundation-http-context` | Foundation owns HTTP primitives; route modules import only. |
| `packages/monitor/src/projections/*` | `projections-read-models` | Projection module owns read models; streams/routes import only. |
| `packages/monitor/src/streams/*` | `stream-hub` | Stream module owns stream lifecycle; route modules call `StreamHub` attach methods only. |
| `packages/monitor/src/queue-recovery-routes.ts` | `control-monitor-routes`, `server-composition-coverage` | Control route module adapts this legacy extracted file into the registry or replaces it with `routes/queue-recovery.ts`; final module only removes the stale legacy file after imports are gone. |
| `packages/monitor/src/resume-eligibility-route.ts` | `control-monitor-routes`, `server-composition-coverage` | Control route module adapts this legacy extracted file into the registry or replaces it with `routes/recovery.ts`; final module only removes the stale legacy file after imports are gone. |
| `packages/monitor/src/session-plan-set-routes.ts` | `extension-content-routes`, `server-composition-coverage` | Extension/content route module adapts this legacy extracted file into the registry or replaces it with `routes/session-plan-sets.ts`; final module only removes the stale legacy file after imports are gone. |
| `scripts/agent-maintainability-baseline.json` | `server-composition-coverage` | Single-owner cleanup after `server.ts` drops below implementation hard cap. |

### Region Declarations

No planned file requires simultaneous multi-module edits. If a later module planner cannot avoid editing a shared owner file, it must declare a non-overlapping append-only temporary region using the compiled `plan-\d{2}-...` slug and must keep that region outside existing semantic `eforge:region` blocks.

Recommended fallback regions if needed:

**`packages/monitor/src/context.ts`**:
- `plan-XX-<module>`: append under a `// --- eforge:region context-extension-points ---` semantic section after the base exported interfaces.

**`packages/monitor/src/routes/index.ts`**:
- `plan-XX-<module>`: append one factory import and one factory invocation inside a dedicated registration-list section. This fallback is discouraged; the final composition module is expected to own this file.

## Technical decisions and rationale

### Keep framework surface minimal

The current server already uses Node `http` and has working SSE/static behavior. A small custom router addresses the oversized ordered `if` chain without introducing dependency and runtime changes.

### Route registry instead of route switch

A registry with method, `API_ROUTES` key, pattern, security policies, and handler makes API coverage testable. `routeKey` also prevents parameterized route drift because coverage can compare registered keys against client-owned constants.

### Extract projections before final route removal

Projection extraction reduces duplication risk before route movement. In particular, queue and stack projections already have comments in `server.ts` stating that REST and SSE paths must share helper logic; moving them first preserves that invariant.

### Streams own timers and subscribers

`server.ts` currently creates poll and heartbeat timers directly. Moving timers into `StreamHub.stop()` gives `MonitorServer.stop()` one cleanup dependency and keeps subscriber lifecycle out of route handlers.

### Final module owns deletion and compatibility

Earlier modules may copy logic into new files while `server.ts` remains unchanged. The final module deletes old nested helpers, wires the router/stream hub, preserves exports, adds coverage, and enforces line/region acceptance criteria. This produces safer intermediate diffs and avoids cross-module edits to the same 4,924-line file.

## Module implementation boundaries

### `foundation-http-context`

Creates context/types and HTTP primitives only. It does not move feature handlers out of `server.ts` and does not change route behavior. It must include unit tests for route matching, parameter decoding/rejection, body-size handling, security policies, and static path/symlink protections where direct unit tests are practical.

### `projections-read-models`

Extracts read-side functions from `server.ts` into projection modules. It may add direct projection tests while preserving `test/run-summary-plans.test.ts` import compatibility for the final module. It must keep sync/async queue item loaders in one module and stack-layer REST/SSE helpers in one module.

### `stream-hub`

Extracts `parseEventRow`, per-session SSE, daemon SSE, poll loop, heartbeat loop, daemon event reactions, and subscriber cleanup. It must retain `writeHello()` first-frame behavior and Last-Event-ID semantics.

### `control-monitor-routes`

Creates route modules for control-plane, recovery/resume, queue recovery, queue/runs/session metadata, run summary/state/plans/diff, and stream attach routes. It delegates SSE to `StreamHub` and read models to projections. It adapts or replaces `queue-recovery-routes.ts` and `resume-eligibility-route.ts` so they use `MonitorContext`/HTTP primitives rather than ad hoc option bags.

### `config-profile-stack-routes`

Creates route modules for health/version/project context, config show/validate, profiles, models, and stack sync/layers/status. It reuses config redaction and stack-layer projections. It may import existing `stack-sync-service.ts` but must not grow that legacy file beyond its baseline; if it edits the file, add durable semantic region markers.

### `extension-content-routes`

Creates route modules and narrow services for extensions, playbooks, session plans, and session plan sets. It adapts `session-plan-set-routes.ts` into the registry pattern. It may use existing `extension-package-management.ts` without growing it; large route files must be split into submodules before they exceed 600 lines.

### `server-composition-coverage`

Performs final wiring and cleanup:

- rewrite `server.ts` as a composition root of at most 400 lines;
- re-export compatibility symbols from `server.ts`;
- create the final route aggregation module;
- ensure only one production `parseJsonBody` implementation remains;
- remove or update stale extracted route files if replaced;
- add route registry coverage against monitor-served `API_ROUTES` keys;
- add compatibility export tests if not already covered;
- add static symlink escape regression coverage;
- add or update security guard tests for local-only and cross-site rejection;
- normalize durable semantic `eforge:region` markers for every remaining `packages/monitor/src` file over 300 lines, including legacy files such as `db.ts`, `server-main.ts`, `auto-build-supervisor.ts`, `extension-package-management.ts`, `stack-sync-service.ts`, and `recorder.ts` when they still exceed 300 lines;
- remove the `packages/monitor/src/server.ts` oversized baseline entry once the file is below the implementation cap.

## Testing strategy

Existing tests remain the primary behavior lock:

- `test/run-summary-plans.test.ts`
- `packages/monitor/src/__tests__/stream-hello-parity.test.ts`
- `packages/monitor/src/__tests__/daemon-sse-handshake.test.ts`
- `packages/monitor/src/__tests__/session-sse-handshake.test.ts`
- `test/daemon-events-stream.test.ts`
- route integration tests that instantiate `startServer`
- static UI serving tests
- extension/playbook/session-plan route tests
- stack sync/layers route tests
- recovery/resume route tests

Add targeted coverage:

- route registry coverage comparing registered `routeKey`s to the monitor-served `API_ROUTES` ownership matrix above;
- router matcher tests for exact routes, parameterized routes, query stripping, missing/invalid params, and method separation;
- shared JSON body parser tests for empty body, invalid JSON, and >1 MiB body;
- security policy tests for non-loopback Host, cross-origin Origin, and Fetch Metadata cross-site headers;
- static symlink escape tests for both monitor UI and Console UI roots;
- stream hub cleanup tests if existing stop tests do not assert timer/subscriber cleanup.

## Quality attributes and gates

- `server.ts` line count: `wc -l packages/monitor/src/server.ts` returns at most 400.
- New production files under `packages/monitor/src` are at most 600 lines.
- Every `packages/monitor/src` file over 300 lines has balanced durable semantic `eforge:region` / `eforge:endregion` markers.
- `rg "function parseJsonBody|const parseJsonBody" packages/monitor/src --glob '!**/__tests__/**'` returns exactly one implementation.
- Route modules use `API_ROUTES` route values; no monitor route module embeds hard-coded `/api/...` endpoint strings.
- Queue REST and daemon `stream:hello.queue` use `projections/queue-items.ts`.
- Stack REST and daemon `stream:hello.stackLayers` use `projections/stack-layers.ts`.
- `pnpm type-check`, `pnpm maintainability:check`, and `pnpm test` exit 0 after all modules merge.

## Non-goals

- No daemon API route renames.
- No request/response/SSE shape changes.
- No `DAEMON_API_VERSION` bump.
- No DB schema changes.
- No Node HTTP framework replacement.
- No monitor UI or Console UI behavior changes beyond preserving existing API/static behavior.
- No plugin or Pi extension version bump unless implementation scope expands into consumer-facing integration behavior.
