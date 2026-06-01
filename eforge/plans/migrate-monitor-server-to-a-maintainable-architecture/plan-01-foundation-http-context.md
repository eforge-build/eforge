---
id: plan-01-foundation-http-context
name: Create MonitorContext, public monitor types, and shared HTTP
  router/request/response/security/static primitives without moving feature
  routes yet.
branch: migrate-monitor-server-to-a-maintainable-architecture/foundation-http-context
---

# Foundation HTTP Context

## Architecture Reference

This module implements the architecture sections **Public compatibility types**, **MonitorContext**, **HTTP route contract**, **HTTP request/response contract**, **Security contract**, and **Static asset contract** from `eforge/plans/migrate-monitor-server-to-a-maintainable-architecture/architecture.md`.

Key constraints from architecture:
- Keep Node `http`; do not introduce Hono, Fastify, Express, or another server framework.
- Do not move feature routes out of `packages/monitor/src/server.ts` in this module.
- Keep client-owned routes authoritative: new route definitions and router tests use `API_ROUTES` values rather than embedded `/api/...` endpoint strings.
- `context.ts` must not import routes, streams, or projections.
- `packages/monitor/src/http/request.ts` owns the shared production `parseJsonBody` implementation for future route modules.
- `packages/monitor/src/http/security.ts` owns loopback, same-origin, and Fetch Metadata checks for future route policies.
- `packages/monitor/src/http/static-assets.ts` preserves monitor UI and Console UI path traversal and symlink escape protections.

## Scope

### In Scope

- Create `packages/monitor/src/types.ts` with public compatibility types that later `server.ts` can re-export.
- Create `packages/monitor/src/context.ts` with `MonitorContext`, normalized startup/runtime fields, derived paths, version metadata, startup retention cleanup, one-time git remote lookup, and shared helper methods.
- Create shared HTTP primitives under `packages/monitor/src/http/`:
  - route errors;
  - JSON request body parsing with a 1 MiB limit;
  - JSON/text response helpers;
  - route definition and matching;
  - request dispatch shell with CORS preflight, registered-route dispatch, unknown API fallback, and optional static fallback;
  - security policy factories;
  - static UI serving for monitor UI and Console UI roots.
- Add direct unit tests for context creation, route matching/dispatch shell behavior, JSON body parsing, response helpers, security classifiers/policies, and static asset protections.
- Keep all new production files under 600 lines; split files before they exceed that limit.

### Out of Scope

- No edits to `packages/monitor/src/server.ts`.
- No edits to `packages/monitor/src/routes/index.ts`.
- No edits to `packages/monitor/src/queue-recovery-routes.ts`, `packages/monitor/src/resume-eligibility-route.ts`, or `packages/monitor/src/session-plan-set-routes.ts`.
- No route handler migration or feature route registration.
- No stream hub implementation.
- No projection extraction.
- No package version changes.
- No daemon HTTP/SSE contract changes and no `DAEMON_API_VERSION` bump.

## Implementation Approach

### Overview

Add the foundational modules as unused-but-compiled building blocks. Existing daemon behavior remains driven by `server.ts` until later modules wire these primitives into feature routes and final composition.

The implementation order is:

1. Add shared public/internal types in `types.ts`.
2. Add `context.ts` and direct context tests.
3. Add request/response/error primitives and tests.
4. Add security classifiers/policy factories and tests.
5. Add static asset serving and tests with real temporary files and a small Node HTTP server.
6. Add route definition/matching/dispatch shell and tests.
7. Run type-check and focused Vitest files.

### Key Decisions

1. `types.ts` duplicates the public server types for now instead of editing `server.ts`.
   - Rationale: final composition owns `server.ts`. Creating the shared type home now gives downstream modules a stable import path without creating a cross-worktree edit conflict.

2. Define a minimal stream interface in `types.ts`, not in `streams/stream-hub.ts`.
   - Rationale: this module has no dependency on the later stream module. The router needs a typed `streams` field in `RequestContext`, so `types.ts` exports `MonitorStreamHub` with the contract later `createStreamHub(context)` must satisfy.

3. `MonitorContext` exposes derived path objects rather than recomputing path strings in route modules.
   - Rationale: queue, plan output, UI, lock, failed, skipped, and waiting paths are reused across route and stream modules. Centralizing derivation prevents repeated `resolve(cwd, ...)` logic.

4. `MonitorContext` stores the raw git remote only.
   - Rationale: config and remote redaction belongs to the later projection module; context only performs the startup lookup currently done by `server.ts`.

5. Security modules expose pure classifiers plus route policy factories.
   - Rationale: pure classifiers are easy to test without fake sockets or response objects; policy factories adapt them to `RequestContext` and write the same 403 JSON error shapes later route modules need.

6. The router derives the API prefix from `API_ROUTES.keepAlive`.
   - Rationale: even generic unknown-API and CORS checks avoid embedding `/api/...` path literals in monitor code.

7. Router method mismatches fall through to unknown API fallback rather than returning 405.
   - Rationale: current daemon behavior returns 404 for unknown method/path combinations except global CORS preflight.

8. Route matcher performs only structural matching and percent-decoding.
   - Rationale: semantic validation such as `^[\w-]+$` for run IDs stays in owning route modules so existing route-specific response bodies can be preserved.

9. Static asset serving is implemented as a standalone utility with no dependency on `MonitorContext`.
   - Rationale: tests can exercise traversal and symlink protections directly; final router wiring can pass `context.uiRoots` later.

## Files

### Create

- `packages/monitor/src/types.ts` — public compatibility and shared internal monitor types. `[region: foundation-http-context, entire file owner]`
  - Export `MonitorServer`, `WorkerTracker`, `DaemonState`, and `StartServerOptions` with the same public shape currently declared in `server.ts`.
  - Import `AutoBuildController` only as a type for `DaemonState`.
  - Export `MonitorVersionInfo` with `daemonApiVersion`, `eforgeVersion`, and `pid`.
  - Export `MonitorQueuePaths`, `MonitorUiRoots`, and `MonitorStreamHub`.
  - `MonitorStreamHub` includes `attachSession`, `attachDaemon`, `broadcast`, `subscriberCount`, `stop`, and optional `buildHeartbeatObject`.

- `packages/monitor/src/context.ts` — monitor runtime context factory. `[region: foundation-http-context, entire file owner]`
  - Export `MonitorContext`.
  - Export `createMonitorContext(db, preferredPort, options?, versionInfo?)` as an async factory.
  - Define default UI roots relative to `fileURLToPath(import.meta.url)`: `monitor-ui` and `console-ui`.
  - Derive queue paths when `cwd` is set:
    - `relativeQueueDir = options.config?.prdQueue?.dir ?? options.queueDir ?? '.eforge/queue'`;
    - `queueDir = resolve(cwd, relativeQueueDir)`;
    - `lockDir = resolve(cwd, '.eforge', 'queue-locks')`;
    - `failedDir`, `skippedDir`, and `waitingDir` under `queueDir`.
  - Derive `relativePlanOutputDir = options.config?.plan?.outputDir ?? options.planOutputDir ?? 'eforge/plans'` and `planOutputDir = cwd ? resolve(cwd, relativePlanOutputDir) : relativePlanOutputDir`.
  - Run startup retention cleanup with `options.config?.monitor?.retentionCount ?? 20`, catching cleanup errors.
  - Resolve git remote once with `git remote get-url origin` when `cwd` exists; store `cachedGitRemote: string | null`.
  - Include helpers:
    - `resolveSessionId(id)` using `db.getRun(id)?.sessionId ?? id`;
    - `getRunningBuildCount()` returning `0` on DB errors;
    - `getSchedulerLimit()` using `options.config?.maxConcurrentBuilds ?? DEFAULT_CONFIG.maxConcurrentBuilds`;
    - `notifyQueueMutation(reason)` delegating to `options.daemonState?.autoBuildController.notifyQueueMutation(reason)`;
    - `getDiscoveredConfigDir()` delegating to `getConfigDir(cwd)`;
    - `getConfigDirOrConventional()` returning discovered config dir or `getConventionalConfigDir(cwd)`.
  - Do not import any module from `routes/`, `streams/`, or `projections/`.

- `packages/monitor/src/http/route-errors.ts` — small shared error types. `[region: foundation-http-context, entire file owner]`
  - Export `HttpRouteError` with `status`, `message`, and optional `bodyKind: 'json' | 'text'`.
  - Export `MalformedRouteParameterError` for percent-decoding failures.
  - Export `isHttpRouteError(value)` type guard.

- `packages/monitor/src/http/request.ts` — JSON request parsing. `[region: foundation-http-context, entire file owner]`
  - Export `MAX_JSON_BODY_BYTES = 1024 * 1024`.
  - Export `RequestBodyTooLargeError` and `isRequestBodyTooLargeError`.
  - Export the only new production `parseJsonBody(req)` implementation.
  - Empty body returns `{}`.
  - Invalid JSON rejects with the original parse error.
  - Body larger than `MAX_JSON_BODY_BYTES` rejects with `RequestBodyTooLargeError`; use a settled guard so later `error` or `end` events do not reject twice after `req.destroy()`.

- `packages/monitor/src/http/response.ts` — response helpers. `[region: foundation-http-context, entire file owner]`
  - Export `jsonHeaders` or `buildJsonHeaders` for shared JSON/CORS headers.
  - Export `sendJson(res, data, status = 200)`.
  - Export `sendJsonError(res, status, error)` producing `{ error }`.
  - Export `sendText(res, status, body, options?)`; default content type is `text/plain; charset=utf-8`; include CORS only when `options.cors === true`.
  - Do not call `res.writeHead` after `res.headersSent`.

- `packages/monitor/src/http/security.ts` — security classifiers and policy factories. `[region: foundation-http-context, entire file owner]`
  - Export pure helpers:
    - `isLoopbackRemoteAddress(remoteAddress)`;
    - `isLoopbackHostHeader(hostHeader)`;
    - `getLocalOnlyRejection(input)`;
    - `getCrossSiteBrowserRejection(input)`.
  - Preserve current loopback semantics: missing remote address is allowed, `::1`, `::ffff:127.0.0.1`, and `127.*` are allowed; `localhost`, `localhost.`, `[::1]`, `::1`, and `127.*` Host headers are allowed.
  - Preserve current Origin semantics: when Origin exists, `new URL(origin).host` must equal the raw Host header.
  - Preserve current Fetch Metadata semantics: absent `Sec-Fetch-Site` is allowed; only `same-origin` and `none` are allowed when present.
  - Export `SecurityPolicy` as a function or object compatible with `RequestContext`.
  - Export factories `localOnly(operationLabel)`, `rejectCrossSiteBrowser(operationLabel)`, and `localMutation(operationLabel)`; policies write 403 JSON via `sendJsonError` and return `true` when a response was written.

- `packages/monitor/src/http/static-assets.ts` — static UI serving. `[region: foundation-http-context, entire file owner]`
  - Export `MIME_TYPES`.
  - Export `serveStaticFile(res, pathname, rootDir, basePath)` or equivalent with no route-handler dependencies.
  - Export `serveStaticUiRequest({ req, res, pathname, monitorUiDir, consoleUiDir })` that routes `/console`, `/console/`, and `/console/*` to the Console UI root and all other non-API paths to the monitor UI root.
  - Preserve status/body behavior from current `server.ts`:
    - malformed percent-decoding returns 400 text;
    - traversal outside root returns 404 text;
    - asset misses return 404 text;
    - non-asset misses fall back to `index.html`;
    - missing/unreadable root realpath returns 500 text;
    - symlink final files and symlink escapes return 404 text;
    - asset responses use `Cache-Control: public, max-age=31536000, immutable`;
    - non-asset responses use `Cache-Control: no-cache`.

- `packages/monitor/src/http/router.ts` — route definitions, matching, and request dispatch shell. `[region: foundation-http-context, entire file owner]`
  - Export `HttpMethod = 'GET' | 'POST' | 'OPTIONS'`.
  - Export `ApiRouteKey = keyof typeof API_ROUTES`.
  - Export `RouteDefinition<K extends ApiRouteKey = ApiRouteKey>` with `routeKey`, `method`, `pattern`, optional `security`, and `handler`.
  - Export `defineRoute(route)` helper to tie `routeKey` to `API_ROUTES[routeKey]` at compile time.
  - Export `RequestContext` with `req`, `res`, `url`, `pathname`, `params`, `query`, `monitor`, and `streams`.
  - Export `matchRoute(routes, method, pathname)` for tests and final route coverage.
  - Export `getRegisteredRouteKeys(routes)` for final route registry coverage.
  - Export `createRouter({ monitor, streams, routes, serveStatic? })` returning an object with `handle(req, res)` and registered-route introspection.
  - Dispatch order inside `handle`:
    1. CORS preflight for derived API prefix and `OPTIONS` returns 204 with `Access-Control-Allow-Origin: *`, methods `GET, POST, OPTIONS`, and header `Content-Type`.
    2. Registered route match by method and decoded path params.
    3. Route security policies in declared order; stop if a policy writes a response.
    4. Route handler.
    5. Unknown API fallback returns 404 JSON `{ error: "Unknown route: METHOD PATH" }`.
    6. Optional static fallback.
  - Method mismatches do not return 405.
  - Pattern matching is exact by path segment count; `:param` placeholders capture exactly one non-empty segment.

- `packages/monitor/src/__tests__/context.test.ts` — tests for `createMonitorContext`.
  - Use real `openDatabase(':memory:')`.
  - Verify default and configured path derivation.
  - Verify `resolveSessionId` maps run ID to session ID after inserting a run.
  - Verify `getRunningBuildCount` counts running runs.
  - Verify `getSchedulerLimit` follows `maxConcurrentBuilds` from config.

- `packages/monitor/src/__tests__/http-request.test.ts` — tests for `parseJsonBody`.
  - Empty body returns `{}`.
  - Valid JSON returns parsed data.
  - Invalid JSON rejects without `RequestBodyTooLargeError`.
  - `MAX_JSON_BODY_BYTES + 1` rejects with `RequestBodyTooLargeError`.

- `packages/monitor/src/__tests__/http-response.test.ts` — tests for response helpers.
  - `sendJson` emits status 200 by default, JSON content type, CORS `*`, and serialized body.
  - `sendJson` honors a non-200 status argument.
  - `sendJsonError` emits `{ error }`.
  - `sendText` omits CORS unless `cors: true` is passed.

- `packages/monitor/src/__tests__/http-security.test.ts` — tests for security classifiers and policies.
  - Loopback remote accepts `undefined`, `::1`, `::ffff:127.0.0.1`, and `127.0.0.1`.
  - Loopback Host accepts `localhost`, `localhost.`, `[::1]`, `::1`, and `127.0.0.1:4567`.
  - Loopback Host rejects `127.0.0.1.evil.example`, `192.0.2.1`, empty, and malformed host strings.
  - Local-only rejection messages match the current operation-label wording for non-loopback remote, non-loopback Host, and cross-origin Origin.
  - Fetch Metadata rejects `cross-site` and `same-site`; it accepts `same-origin`, `none`, and absent header.

- `packages/monitor/src/__tests__/http-static-assets.test.ts` — tests for static asset utility.
  - Use real temp directories and a small real Node HTTP server that calls `serveStaticUiRequest`.
  - Verify monitor root, monitor asset, Console root, Console asset, SPA fallback, asset miss, malformed percent escape, encoded traversal, and immutable/no-cache headers.
  - Add symlink escape coverage for monitor and Console roots. If symlink creation fails on the platform, skip only the symlink-specific cases using Vitest `it.skipIf` or an equivalent runtime guard.

- `packages/monitor/src/__tests__/http-router.test.ts` — tests for route matcher and dispatch shell.
  - Use sample route definitions built with `defineRoute` and `API_ROUTES` constants.
  - Verify exact route match with query stripped.
  - Verify parameterized match decodes a parameter once.
  - Verify malformed percent encoding produces `MalformedRouteParameterError` and the dispatch shell returns 400.
  - Verify extra path segments do not match.
  - Verify method mismatch falls through to unknown API fallback with 404.
  - Verify CORS preflight returns 204 before route matching.
  - Verify `getRegisteredRouteKeys` returns route keys in registration order without duplicates when definitions are unique.
  - Verify security policies run before handlers by installing a test policy that writes 403 and asserting the handler is not invoked.

### Modify

- None.

This module intentionally does not modify shared final-composition files. The files it creates are owned by `foundation-http-context`; downstream modules consume them. No temporary build-coordination source markers are required in these full-file-owner creations. If any created source file exceeds 300 lines, add balanced durable semantic `// --- eforge:region <semantic-slug> ---` markers inside that file.

## Testing Strategy

### Unit Tests

- `context.test.ts` covers path normalization, DB-backed helpers, scheduler limit derivation, and version metadata shape.
- `http-request.test.ts` covers JSON body parsing success and error paths.
- `http-response.test.ts` covers status codes, headers, and body serialization.
- `http-security.test.ts` covers loopback, Origin, and Fetch Metadata classifiers plus policy response behavior.
- `http-router.test.ts` covers route definition typing through `defineRoute`, path matching, query stripping, parameter decoding, preflight, unknown API fallback, and security ordering.

### Integration Tests

- `http-static-assets.test.ts` uses real filesystem fixtures and a real Node HTTP server to verify static file responses, traversal rejection, and symlink escape rejection without starting the full monitor daemon.

## Verification

- [ ] `pnpm type-check` exits 0.
- [ ] `pnpm vitest run packages/monitor/src/__tests__/context.test.ts packages/monitor/src/__tests__/http-request.test.ts packages/monitor/src/__tests__/http-response.test.ts packages/monitor/src/__tests__/http-security.test.ts packages/monitor/src/__tests__/http-static-assets.test.ts packages/monitor/src/__tests__/http-router.test.ts` exits 0.
- [ ] `find packages/monitor/src/http -name '*.ts' -maxdepth 1 -print0 | xargs -0 wc -l` shows each created HTTP source file at 600 lines or fewer.
- [ ] `wc -l packages/monitor/src/context.ts packages/monitor/src/types.ts` shows each created context/type source file at 600 lines or fewer.
- [ ] Every created `packages/monitor/src` production file over 300 lines contains balanced durable semantic `eforge:region` and `eforge:endregion` markers.
- [ ] `rg "function parseJsonBody|const parseJsonBody" packages/monitor/src/http/request.ts` reports exactly one match.
- [ ] `rg "['\"]\/api\/" packages/monitor/src/http packages/monitor/src/context.ts packages/monitor/src/types.ts` reports zero matches.
- [ ] `rg "from ['\"]\.\.?/routes|from ['\"]\.\.?/streams|from ['\"]\.\.?/projections" packages/monitor/src/context.ts` reports zero matches.
- [ ] Static asset tests assert 404 for symlink escapes from both monitor UI and Console UI roots.
- [ ] Security tests assert HTTP 403 policy responses for non-loopback Host, cross-origin Origin, and cross-site Fetch Metadata inputs.

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
