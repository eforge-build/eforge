# Server Composition Coverage

## Architecture Reference

This module implements the architecture sections **Vision and goals**, **Final wiring is single-owner**, **Route ownership matrix**, **Static asset contract**, **StreamHub contract**, **Projection contracts**, **Shared File Registry**, and **Module implementation boundaries / `server-composition-coverage`** from `eforge/plans/migrate-monitor-server-to-a-maintainable-architecture/architecture.md`.

Key constraints from architecture:
- `packages/monitor/src/server.ts` becomes a composition root of at most 400 lines.
- `packages/monitor/src/server.ts` continues exporting `startServer`, `MonitorServer`, `WorkerTracker`, `DaemonState`, `StartServerOptions`, and `buildRunSummary` from `@eforge-build/monitor/server`.
- Final route wiring uses feature-owned route factories from dependency modules; route modules keep using `API_ROUTES` values from `@eforge-build/client`.
- The Node `http` server remains the runtime; do not introduce Hono, Fastify, Express, or another framework.
- The stream hub owns SSE subscribers, polling, heartbeat, semantic daemon-event reactions, broadcast, and cleanup.
- Static UI fallback remains after registered API route dispatch and unknown API fallback.
- Queue REST responses and daemon `stream:hello.queue` are both backed by `projections/queue-items.ts`; stack REST responses and daemon `stream:hello.stackLayers` are both backed by `projections/stack-layers.ts`.
- No daemon route path, HTTP method, request body, response body, SSE frame, DB schema, or `DAEMON_API_VERSION` change is in scope.
- This module owns final route aggregation, stale legacy route-file removal, compatibility coverage, security/static regression coverage, and monitor source marker normalization.

## Scope

### In Scope

- Rewrite `packages/monitor/src/server.ts` as the final composition root.
- Create `packages/monitor/src/routes/index.ts` as the single monitor route aggregation module.
- Wire `createMonitorContext`, `createStreamHub`, the shared router, static fallback, and all feature route factories into `startServer`.
- Preserve `MonitorServer` behavior:
  - `port` and `url` reflect the bound server;
  - `subscriberCount` delegates to the stream hub;
  - `broadcast(eventName, data)` delegates to the stream hub;
  - `onKeepAlive` maps to the control-route runtime callback;
  - `stop()` stops stream resources and closes the Node server.
- Preserve `listen()` behavior: bind on `0.0.0.0`, use the preferred port, and retry up to 10 incrementing ports unless `strictPort` is set.
- Re-export compatibility types and `buildRunSummary` from `server.ts`.
- Remove or replace stale legacy route files after `server.ts` no longer imports them:
  - `packages/monitor/src/queue-recovery-routes.ts`;
  - `packages/monitor/src/resume-eligibility-route.ts`;
  - `packages/monitor/src/session-plan-set-routes.ts`.
- Remove the `packages/monitor/src/server.ts` entry from `scripts/agent-maintainability-baseline.json` after the file is below 600 lines.
- Add route registry coverage comparing registered daemon route keys to `API_ROUTES`.
- Add compatibility export/start-server coverage for `@eforge-build/monitor/server`.
- Add or update start-server-level security regression tests for local-only and cross-site sensitive routes.
- Add or update start-server-level static UI tests for symlink escapes from monitor UI and Console UI roots.
- Add marker-presence coverage and normalize durable semantic `eforge:region` markers for every production file under `packages/monitor/src` that remains over 300 lines after all extraction modules land.
- Run the full regression gates: `pnpm type-check`, `pnpm test`, and `pnpm maintainability:check`.

### Out of Scope

- No feature handler implementation moves beyond final wiring and stale-file deletion.
- No edits to client-owned `API_ROUTES`, route response types, request types, schemas, or `DAEMON_API_VERSION`.
- No stream polling, heartbeat, Last-Event-ID, `stream:hello`, or daemon-event reaction behavior changes beyond routing requests to the extracted `StreamHub`.
- No projection logic changes beyond compatibility re-exporting and verifying REST/SSE parity through existing tests.
- No monitor UI or Console UI behavior changes beyond preserving existing static serving behavior through the new static fallback.
- No engine orchestration, queue scheduling, recovery semantics, extension runtime, playbook parser, session-plan parser, CLI, Claude plugin, or Pi extension changes.
- No public documentation changes; this module is daemon-internal.

## Implementation Approach

### Overview

Perform the final cutover after all dependency modules have landed. The implementation is a wiring and cleanup pass, not another feature extraction pass.

Recommended order:

1. Inspect dependency outputs and confirm the expected exports exist: context factory, HTTP router/static helpers, stream hub, projection modules, and three feature route aggregators.
2. Create `packages/monitor/src/routes/index.ts` to aggregate the feature route factories and provide route registry introspection for tests.
3. Rewrite `packages/monitor/src/server.ts` to create a context, stream hub, control runtime, monitor router, Node HTTP server, and compatibility `MonitorServer` handle.
4. Run focused start-server tests for health/version/static/SSE to catch wiring mistakes early.
5. Delete or replace stale legacy route files and verify no production `parseJsonBody` implementation remains outside `http/request.ts`.
6. Add registry, compatibility export, security, static symlink, and marker-presence tests.
7. Normalize durable region markers in every remaining `packages/monitor/src` production file over 300 lines without exceeding baseline ceilings for legacy oversized files.
8. Remove the `server.ts` baseline entry and run full type/test/maintainability gates.

### Key Decisions

1. **`server.ts` is rewritten rather than bounded-edited around old handlers.**
   - Rationale: all handler, projection, stream, static, and security logic has moved to dependency modules. A small composition file is easier to audit than thousands of deleted nested helpers plus scattered leftover imports.

2. **`routes/index.ts` is the only final route aggregator.**
   - Rationale: dependency modules export feature route factories only. A single aggregator controls registration order, route-key coverage, and static fallback wiring without creating cross-module registration conflicts.

3. **The control keep-alive callback remains outside `MonitorContext`.**
   - Rationale: `MonitorServer.onKeepAlive` is a mutable server-handle callback used by `server-main.ts`. Keep it in `ControlMonitorRuntime` and expose it through the returned server handle.

4. **The request listener delegates to the shared router and has one last-resort error guard.**
   - Rationale: route modules own route-specific error mapping, but an uncaught exception must not leave the HTTP response hanging. If `router.handle()` rejects before headers are sent, write HTTP 500 JSON through shared response helpers; if headers have already been sent, destroy the response.

5. **Stream resources are stopped on both normal shutdown and startup failure after hub creation.**
   - Rationale: `createStreamHub(context)` starts timers. If `listen()` fails, the implementation must call `streamHub.stop()` before rethrowing.

6. **Delete stale legacy route files when they are no longer imported.**
   - Rationale: keeping `queue-recovery-routes.ts` would leave a second production `parseJsonBody` implementation and stale ad hoc option-bag routes. The new registry modules are the supported internal implementation.

7. **Route registry coverage compares against `Object.keys(API_ROUTES)`.**
   - Rationale: every key in the current client route map is monitor-served. A newly added client route must fail this test until a daemon route module registers it or the test documents an explicit non-daemon exception.

8. **Marker normalization is line-ceiling aware.**
   - Rationale: some baseline files are at or near their `noGrowthCeiling`. When adding durable markers to a baseline file, remove the same number of blank/separator lines or obsolete comments in that file so `pnpm maintainability:check` still passes without raising ceilings.

## Files

### Create

- `packages/monitor/src/routes/index.ts` — final route aggregation and router factory. `[region: server-composition-coverage, entire file owner]`
  - Import `createRouter`, `getRegisteredRouteKeys`, and `RouteDefinition` from `../http/router.js`.
  - Import `serveStaticUiRequest` from `../http/static-assets.js`.
  - Import feature route factories:
    - `createControlMonitorRoutes` from `./control-monitor.js`;
    - `createConfigProfileStackRoutes` from `./config-profile-stack.js`;
    - `createExtensionContentRoutes` from `./extension-content.js`.
  - Import `ControlMonitorRuntime` from `./control-runtime.js`.
  - Export `createMonitorRoutes(context, runtime): RouteDefinition[]`, concatenating route groups in this order:
    1. control/monitor routes;
    2. config/profile/stack routes;
    3. extension/content routes.
  - Export `createMonitorRouter(context, streams, runtime)` that:
    - builds the route list with `createMonitorRoutes`;
    - calls `createRouter({ monitor: context, streams, routes, serveStatic })`;
    - passes `serveStaticUiRequest({ req, res, pathname, monitorUiDir, consoleUiDir })` using the context's normalized UI roots;
    - exposes the underlying registered route keys for tests, either by returning the router's introspection API or by exporting `getMonitorRouteKeys(context, runtime)`.
  - Export `getMonitorRegisteredRouteKeys(context, runtime)` or `getMonitorRouteKeysFromRoutes(routes)` for route coverage tests.
  - Keep this file below 200 lines.

- `packages/monitor/src/__tests__/routes-index-coverage.test.ts` — final registry coverage.
  - Create an in-memory DB and `MonitorContext` with `createMonitorContext`.
  - Create a `ControlMonitorRuntime`.
  - Call `createMonitorRoutes(context, runtime)` and assert:
    - registered route keys are unique;
    - sorted registered keys equal sorted `Object.keys(API_ROUTES)`;
    - every route `pattern === API_ROUTES[route.routeKey]`;
    - every route has method `GET`, `POST`, or `DELETE` except router-internal `OPTIONS` preflight;
    - duplicate route patterns only occur for method-separated routes such as `autoBuildGet`/`autoBuildSet`.
  - Assert `createMonitorRouter` exposes the same route key set as `createMonitorRoutes`.

- `packages/monitor/src/__tests__/server-compatibility.test.ts` — compatibility export and server-handle coverage.
  - Import `startServer`, `buildRunSummary`, and type-only `MonitorServer`, `WorkerTracker`, `DaemonState`, `StartServerOptions` from `../server.js`.
  - Import `buildRunSummary as buildRunSummaryProjection` from `../projections/run-summary.js`.
  - Assert the two `buildRunSummary` imports are the same function reference.
  - Start a real server with an in-memory DB and temp cwd.
  - Assert `server.url` uses the bound port and `server.port` is a number greater than 0.
  - Set `server.onKeepAlive`, issue `POST API_ROUTES.keepAlive`, and assert the callback is invoked once and the response body is `{ status: 'ok' }`.
  - Assert `server.subscriberCount` is `0` before SSE connections.
  - Call `server.broadcast('test:event', '{}')` with no subscribers and assert it does not throw.
  - Call `server.stop()` and close the DB.

- `packages/monitor/src/__tests__/server-security.test.ts` — start-server-level route security regressions.
  - Use real `startServer`, a temp cwd, and `node:http` requests so custom `Host`, `Origin`, and `Sec-Fetch-Site` headers can be set precisely.
  - Assert a sensitive read route such as `GET readRecoverySidecar?prdId=missing` returns HTTP 403 for:
    - non-loopback `Host` header;
    - cross-origin `Origin` with loopback `Host`;
    - `Sec-Fetch-Site: cross-site` with loopback `Host`.
  - Assert a local mutation route such as `POST stackSync` or `POST queueRecoveryApply` returns HTTP 403 for a non-loopback `Host` header before body/domain validation.
  - Assert the 403 JSON body contains an `error` property.

- `packages/monitor/src/__tests__/monitor-region-markers.test.ts` — monitor source marker presence coverage.
  - Enumerate production `.ts` files under `packages/monitor/src` excluding `__tests__`.
  - Count lines with `wc`-style newline semantics.
  - For every file over 300 lines, assert the content contains at least one `eforge:region` marker and at least one matching `eforge:endregion` marker.
  - Reuse a small stack-based marker check or shell out to `pnpm maintainability:check` only if the test remains deterministic and fast. Prefer an in-test stack parser to avoid recursive test command execution.

### Modify

- `packages/monitor/src/server.ts` — rewrite as the composition root. `[region: server-composition-coverage, entire file rewrite]`
  - Keep only imports required for composition:
    - `createServer`, `Server`, `IncomingMessage`, `ServerResponse` from `node:http`;
    - `MonitorDB` type;
    - `DAEMON_API_VERSION` from `@eforge-build/client`;
    - `createMonitorContext`;
    - `createStreamHub`;
    - `createControlMonitorRuntime`;
    - `createMonitorRouter`;
    - shared `sendJsonError` if the request listener implements the last-resort error guard;
    - compatibility types from `./types.js`.
  - Declare `EFORGE_VERSION` for tsup `define` replacement.
  - Re-export:
    - `type MonitorServer`, `type WorkerTracker`, `type DaemonState`, `type StartServerOptions` from `./types.js`;
    - `buildRunSummary` from `./projections/run-summary.js`.
  - Implement `startServer(db, preferredPort = 4567, options?)`:
    1. Build `versionInfo = { daemonApiVersion: DAEMON_API_VERSION, eforgeVersion: EFORGE_VERSION, pid: process.pid }`.
    2. `const context = await createMonitorContext(db, preferredPort, options, versionInfo)`.
    3. `const streams = createStreamHub(context)`.
    4. `const runtime = createControlMonitorRuntime()`.
    5. `const router = createMonitorRouter(context, streams, runtime)`.
    6. Create the Node HTTP server with an async request listener that delegates to `router.handle(req, res)` and writes/destroys on uncaught errors.
    7. Call `listen(server, preferredPort, options?.strictPort ? 0 : 10)`.
    8. If `listen()` rejects, stop `streams` before rethrowing.
    9. Return a `MonitorServer` object backed by `streams` and `runtime`.
  - Implement `stop()` so it:
    - calls `await streams.stop()`;
    - calls `server.closeAllConnections()` when available;
    - calls `server.close()` and resolves once Node reports closure;
    - tolerates `ERR_SERVER_NOT_RUNNING` during cleanup by resolving.
  - Keep `listen(server, port, maxRetries = 10)` as a private helper and preserve current retry/bind behavior.
  - Do not include route handlers, JSON body parsing, static file serving, SSE subscriber sets, projection helpers, security classifiers, or route prefix constants.

- `packages/monitor/src/__tests__/static-ui-serving.test.ts` — add symlink escape regression cases.
  - Import `symlinkSync` and track a boolean for symlink availability.
  - Create two symlinks when supported:
    - monitor UI asset symlink pointing to a sentinel outside the monitor root;
    - Console UI asset symlink pointing to a sentinel outside the Console root.
  - Add tests that `GET /assets/<symlink>` and `GET /console/assets/<symlink>` return HTTP 404 and do not contain the sentinel content.
  - Skip only the symlink-specific assertions when symlink creation fails on the platform.

- `scripts/agent-maintainability-baseline.json` — remove the `packages/monitor/src/server.ts` entry after `server.ts` is below 600 lines. `[region: server-composition-coverage, remove server.ts baseline object]`
  - Leave other baseline entries unchanged unless a file is also reduced below its relevant hard cap and the implementation has run `pnpm maintainability:check` after removal.

- `packages/monitor/src/queue-recovery-routes.ts` — delete stale legacy route file after no imports remain. `[region: server-composition-coverage, delete stale legacy file]`
  - Verify `rg "queue-recovery-routes" packages test` returns no production imports before deletion.

- `packages/monitor/src/resume-eligibility-route.ts` — delete stale legacy route file after no imports remain. `[region: server-composition-coverage, delete stale legacy file]`
  - Verify `rg "resume-eligibility-route" packages test` returns no production imports before deletion.

- `packages/monitor/src/session-plan-set-routes.ts` — delete stale legacy route file after no imports remain. `[region: server-composition-coverage, delete stale legacy file]`
  - Verify `rg "session-plan-set-routes" packages test` returns no production imports before deletion.

- `packages/monitor/src/db.ts` — add balanced durable semantic region markers if the file still exceeds 300 lines.
  - Suggested markers:
    - `monitor-db-row-mapping` for row types and row-to-wire helpers;
    - `monitor-db-schema` for schema constants/migrations;
    - `monitor-db-api` for the `openDatabase` returned API.
  - Keep line count at or below its baseline ceiling by replacing existing separator comments or blank lines with marker comments rather than only adding lines.

- `packages/monitor/src/server-main.ts` — add balanced durable semantic region markers if the file still exceeds 300 lines.
  - Suggested markers:
    - `daemon-state-evaluation` for state-check constants/types/functions;
    - `daemon-event-reconciliation` for daemon event writing and orphan reconciliation;
    - `daemon-watcher-runtime` for watcher setup, shutdown countdown, and `main()`.
  - Keep line count at or below its baseline ceiling.

- `packages/monitor/src/auto-build-supervisor.ts` — add balanced durable semantic region markers if the file still exceeds 300 lines.
  - Suggested markers:
    - `auto-build-types`;
    - `auto-build-reducer`;
    - `auto-build-controller`.

- `packages/monitor/src/extension-package-management.ts` — add balanced durable semantic region markers if the file still exceeds 300 lines.
  - Suggested markers:
    - `extension-package-source-classification`;
    - `extension-package-acquisition`;
    - `extension-package-selection`;
    - `extension-package-operations`.
  - This file is at its baseline ceiling in the current tree, so remove at least as many blank/comment-only lines as marker lines added.

- `packages/monitor/src/stack-sync-service.ts` — add balanced durable semantic region markers if the file still exceeds 300 lines.
  - Suggested markers:
    - `stack-sync-execution`;
    - `stack-sync-status`.

- `packages/monitor/src/recorder.ts` — add balanced durable semantic region markers if the file still exceeds 300 lines.
  - Suggested markers:
    - `event-recording-pipeline`;
    - `event-metadata-extraction`.

- Any newly created dependency file under `packages/monitor/src` that remains over 300 lines after all modules land — add balanced durable semantic region markers without using temporary `plan-*` slugs.
  - Do not add broad markers to files at 300 lines or fewer.
  - Do not add temporary build-coordination markers in this final cleanup pass.

## Implementation Details

### Final `server.ts` structure

Use this shape as the target, adjusting names to the exact dependency exports that land:

```ts
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { DAEMON_API_VERSION } from '@eforge-build/client';
import type { MonitorDB } from './db.js';
import { createMonitorContext } from './context.js';
import { sendJsonError } from './http/response.js';
import { createControlMonitorRuntime } from './routes/control-runtime.js';
import { createMonitorRouter } from './routes/index.js';
import { createStreamHub } from './streams/stream-hub.js';
import type { MonitorServer, StartServerOptions } from './types.js';

/** Replaced at build time by tsup `define` with the daemon bundle's package version. */
declare const EFORGE_VERSION: string;

export type { MonitorServer, WorkerTracker, DaemonState, StartServerOptions } from './types.js';
export { buildRunSummary } from './projections/run-summary.js';

export async function startServer(
  db: MonitorDB,
  preferredPort = 4567,
  options?: StartServerOptions,
): Promise<MonitorServer> {
  const context = await createMonitorContext(db, preferredPort, options, {
    daemonApiVersion: DAEMON_API_VERSION,
    eforgeVersion: EFORGE_VERSION,
    pid: process.pid,
  });
  const streams = createStreamHub(context);
  const runtime = createControlMonitorRuntime();
  const router = createMonitorRouter(context, streams, runtime);

  const server = createServer((req, res) => {
    void handleRequest(router.handle, req, res);
  });

  let port: number;
  try {
    port = await listen(server, preferredPort, options?.strictPort ? 0 : 10);
  } catch (err) {
    await streams.stop();
    throw err;
  }

  return {
    port,
    url: `http://localhost:${port}`,
    get subscriberCount() {
      return streams.subscriberCount;
    },
    broadcast(eventName, data) {
      streams.broadcast(eventName, data);
    },
    get onKeepAlive() {
      return runtime.getOnKeepAlive();
    },
    set onKeepAlive(cb) {
      runtime.setOnKeepAlive(cb);
    },
    async stop() {
      await streams.stop();
      await closeServer(server);
    },
  };
}
```

The final implementation may inline `handleRequest` and `closeServer` if `server.ts` remains below 400 lines. Do not keep any of the old nested handler bodies.

### Route aggregation details

`createMonitorRoutes(context, runtime)` must call dependency route factories once per server creation. Do not memoize route definitions globally because handlers close over `MonitorContext`, worker tracker, daemon state, paths, and runtime callback state.

`createMonitorRouter(context, streams, runtime)` is responsible for static fallback wiring. It must not reimplement static file security; it passes through to `serveStaticUiRequest` from `http/static-assets.ts`.

If dependency route factories expose route-key arrays, `routes/index.ts` may export a concatenated `MONITOR_ROUTE_KEYS`. If any dependency does not export a key array, derive keys from `createMonitorRoutes(context, runtime)` in tests rather than adding a second manual key list that can drift.

### Stale file deletion details

Before deleting each stale legacy file, run targeted searches:

```bash
rg "queue-recovery-routes|resume-eligibility-route|session-plan-set-routes" packages test
```

The only acceptable hits after `server.ts` rewrite are plan documents or deleted-file references. If production imports remain, update the import to the new route/service module or keep a tiny compatibility wrapper that does not contain JSON parsing, route dispatch, or ad hoc option bags. Prefer deletion when no production import remains.

### Marker normalization details

Use durable semantic slugs such as `monitor-db-api`; do not use temporary `plan-XX-*` slugs for final source organization. The maintainability checker only verifies marker balance, so `monitor-region-markers.test.ts` supplies the presence gate for files over 300 lines.

For baseline files, check line counts before and after marker edits:

```bash
wc -l packages/monitor/src/db.ts packages/monitor/src/server-main.ts packages/monitor/src/extension-package-management.ts
```

If a baseline file has no line-count headroom, replace existing separator comments with markers or remove blank lines in the same edit so the file does not exceed its `noGrowthCeiling`.

## Testing Strategy

### Unit Tests

- `routes-index-coverage.test.ts` verifies final route registration coverage, uniqueness, method metadata, and pattern equality with `API_ROUTES`.
- `monitor-region-markers.test.ts` verifies every production monitor source file over 300 lines contains balanced durable source region markers.
- Existing dependency-module unit tests remain the lower-level coverage for route matching, body parsing, static serving, security classifiers, projections, and stream helpers.

### Integration Tests

- `server-compatibility.test.ts` starts a real server and verifies compatibility exports, keep-alive callback wiring, server handle fields, broadcast without subscribers, and shutdown.
- `server-security.test.ts` starts a real server and verifies central security policies are active after final router wiring.
- `static-ui-serving.test.ts` gains symlink escape cases against the final `startServer` path.
- Existing in-process `startServer` tests remain the behavior regression suite for migrated routes and streams:
  - `packages/monitor/src/__tests__/stream-hello-parity.test.ts`;
  - `packages/monitor/src/__tests__/daemon-sse-handshake.test.ts`;
  - `packages/monitor/src/__tests__/session-sse-handshake.test.ts`;
  - `packages/monitor/src/__tests__/auto-build-route.test.ts`;
  - `packages/monitor/src/__tests__/stack-layers-route.test.ts`;
  - `test/daemon-events-stream.test.ts`;
  - `test/run-summary-plans.test.ts`;
  - recovery/resume/queue route tests;
  - extension/playbook/session-plan/session-plan-set route tests;
  - stack sync route tests;
  - static UI serving tests.

## Verification

- [ ] `wc -l packages/monitor/src/server.ts` reports `400` or fewer lines.
- [ ] `packages/monitor/src/server.ts` exports `startServer`.
- [ ] `packages/monitor/src/server.ts` re-exports `type MonitorServer` from `./types.js`.
- [ ] `packages/monitor/src/server.ts` re-exports `type WorkerTracker` from `./types.js`.
- [ ] `packages/monitor/src/server.ts` re-exports `type DaemonState` from `./types.js`.
- [ ] `packages/monitor/src/server.ts` re-exports `type StartServerOptions` from `./types.js`.
- [ ] `packages/monitor/src/server.ts` re-exports `buildRunSummary` from `./projections/run-summary.js`.
- [ ] `rg "function parseJsonBody|const parseJsonBody" packages/monitor/src --glob '!**/__tests__/**'` reports exactly one match, in `packages/monitor/src/http/request.ts`.
- [ ] `rg "queue-recovery-routes|resume-eligibility-route|session-plan-set-routes" packages/monitor/src test --glob '!**/*.md'` reports zero production TypeScript imports after stale-file deletion.
- [ ] `packages/monitor/src/routes/index.ts` exports `createMonitorRoutes`.
- [ ] `packages/monitor/src/routes/index.ts` exports `createMonitorRouter`.
- [ ] `createMonitorRoutes(context, runtime)` returns one route definition for every key in `API_ROUTES`.
- [ ] Every route returned by `createMonitorRoutes(context, runtime)` has `pattern === API_ROUTES[route.routeKey]`.
- [ ] `routes-index-coverage.test.ts` fails when a route key from `API_ROUTES` is omitted from final registration.
- [ ] `rg "['\"]\/api\/" packages/monitor/src/routes packages/monitor/src/server.ts --glob '!**/__tests__/**'` reports zero hard-coded endpoint literals in production monitor route modules and `server.ts`.
- [ ] `GET API_ROUTES.queue` through `startServer` returns the same array as `loadQueueItems(context.queuePaths.queueDir, context.queuePaths.lockDir)` for the existing queue route fixtures.
- [ ] `GET API_ROUTES.stackLayers` through `startServer` returns `{ layers: stackLayersToWire(cwd) }` for the existing stack layer fixtures.
- [ ] `stream-hello-parity.test.ts` passes with daemon `stream:hello.queue` and `stream:hello.stackLayers` populated from projection modules.
- [ ] `daemon-sse-handshake.test.ts` passes and asserts daemon `stream:hello` is the first SSE frame.
- [ ] `session-sse-handshake.test.ts` passes and asserts session `stream:hello` is the first SSE frame.
- [ ] `server-security.test.ts` asserts HTTP 403 for non-loopback `Host`, cross-origin `Origin`, and `Sec-Fetch-Site: cross-site` on sensitive routes served through `startServer`.
- [ ] `static-ui-serving.test.ts` asserts HTTP 404 for monitor UI symlink escapes and Console UI symlink escapes when symlink creation is supported.
- [ ] `test/run-summary-plans.test.ts` passes without changing its import from `@eforge-build/monitor/server`.
- [ ] `server-compatibility.test.ts` asserts the `buildRunSummary` export from `../server.js` is the same function reference as the projection export.
- [ ] `server-compatibility.test.ts` asserts `server.onKeepAlive` invokes the registered callback through `POST API_ROUTES.keepAlive`.
- [ ] `scripts/agent-maintainability-baseline.json` no longer contains `packages/monitor/src/server.ts`.
- [ ] Every production `.ts` file under `packages/monitor/src` with more than 300 lines contains at least one balanced durable `// --- eforge:region <semantic-slug> ---` / `// --- eforge:endregion <semantic-slug> ---` pair.
- [ ] No new production file under `packages/monitor/src` exceeds 600 lines.
- [ ] No new test file exceeds 1,200 lines.
- [ ] `pnpm type-check` exits 0.
- [ ] `pnpm test` exits 0.
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
