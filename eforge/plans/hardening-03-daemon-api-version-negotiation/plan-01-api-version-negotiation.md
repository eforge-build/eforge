---
id: plan-01-api-version-negotiation
name: Daemon API Version Negotiation
depends_on: []
branch: hardening-03-daemon-api-version-negotiation/api-version-negotiation
---

# Daemon API Version Negotiation

## Architecture Context

`DAEMON_API_VERSION` is declared in `packages/client/src/api-version.ts` (currently `4`) but is not load-bearing: nothing at runtime compares client vs daemon versions, so a mismatched client and daemon silently produce 404s or schema mismatches. The HTTP contract surface lives behind a single route map in `packages/client/src/routes.ts` (`API_ROUTES`) and a single HTTP dispatcher in `packages/monitor/src/server.ts`. The CLI error pipeline in `packages/eforge/src/cli/errors.ts` already reserves a `version-mismatch` classification (it matches `version-mismatch` or `api version` substrings, case-insensitive) and maps it to exit code 2 with a hint to restart the daemon. The slot exists; this plan wires the actual HTTP check into it.

`daemonRequest(cwd, method, path, body?)` in `packages/client/src/daemon-client.ts` is the single chokepoint every CLI / MCP / plugin call passes through, making it the correct place to hook the version check. The lockfile (`packages/client/src/lockfile.ts`) exposes `{ pid, port, startedAt }`, giving a stable per-daemon cache key of `${port}:${pid}`.

## Implementation

### Overview

1. Register a new `version` route in `API_ROUTES` and define a `VersionResponse` type.
2. Add a `GET /api/version` handler in the monitor HTTP server that returns `{ version: DAEMON_API_VERSION }` without touching the queue or requiring auth.
3. Rewrite `packages/client/src/api-version.ts` to keep the `DAEMON_API_VERSION` constant, add a documented comment block about when to bump it, and export a `verifyApiVersion(cwd)` function with a per-daemon cache.
4. Call `verifyApiVersion(cwd)` from inside `daemonRequest` before dispatching the real HTTP call, skipping when the path is the version route itself to avoid recursion.
5. Export `verifyApiVersion` and `VersionResponse` from `packages/client/src/index.ts`.
6. Add a unit test covering happy path, mismatch error, cache hit, no-lockfile bail-out, and the recursion-guard for the version route.

### Key Decisions

1. **Cache key is `${lock.port}:${lock.pid}`** — matches the source spec and invalidates automatically when the daemon restarts (new PID) or picks a new port. Cache is a module-level `Map<string, number>` so it survives within a single CLI process.
2. **Check is invoked from `daemonRequest`, not from every call site.** Single chokepoint means no caller can forget the check. Skip the check when `path === API_ROUTES.version` to prevent infinite recursion in the first call against a new daemon.
3. **No-lockfile case is a silent no-op.** If there is no lockfile, the daemon is not running; the caller will surface a clearer `daemon-down` error a moment later via `ensureDaemon`. We do not try to pre-fail here.
4. **Error message contains the literal substring `version mismatch`.** `classifyDaemonError` matches `version-mismatch` (hyphen) OR `api version` (any casing). The spec's suggested message `eforge daemon API version mismatch: ...` hits the `api version` branch; we include the hyphenated form too (`API version-mismatch`) so both classifier substrings match and the behavior is robust to future reclassifier edits.
5. **Version route takes the direct HTTP path, not `daemonRequest`.** `verifyApiVersion` cannot call `daemonRequest(cwd, 'GET', API_ROUTES.version)` because that would re-enter `verifyApiVersion`. Two options: (a) inline a `fetch` against `http://127.0.0.1:${lock.port}${API_ROUTES.version}`, or (b) pass a skip flag through `daemonRequest`. Option (a) is simpler and keeps `daemonRequest`'s signature unchanged — the implementation must mirror the HTTP + error handling already in `daemonRequestWithPort` (timeout, non-2xx detection) but without going through `ensureDaemon` (if the daemon is down, we already short-circuited on no lockfile). Use option (a).
6. **Daemon handler is dispatched inside the existing `createServer` switch in `server.ts`**, alongside `serveHealth` and similar no-side-effect endpoints. It must not reference `db`, `workerTracker`, or `daemonState` so it keeps working when those are absent.

## Scope

### In Scope
- `packages/client/src/routes.ts` — add `version: '/api/version'` to `API_ROUTES`, define and export `VersionResponse`.
- `packages/client/src/api-version.ts` — keep `DAEMON_API_VERSION` constant, add documented comment block about when to bump, add `verifyApiVersion(cwd)` plus per-daemon cache.
- `packages/client/src/daemon-client.ts` — call `verifyApiVersion(cwd)` at the top of `daemonRequest`, skipping when the target path equals `API_ROUTES.version`.
- `packages/client/src/index.ts` — re-export `verifyApiVersion` and the `VersionResponse` type.
- `packages/monitor/src/server.ts` — add `GET /api/version` handler returning `{ version: DAEMON_API_VERSION }` with CORS headers matching the existing pattern; handler does not touch `db`, `workerTracker`, `daemonState`, or queue; handler never throws except on fundamental process failure.
- `packages/eforge/src/cli/errors.ts` — verify the existing classifier matches the thrown message. No code change expected unless the thrown string does not match; if not, align the thrown string rather than the classifier (the classifier's `version-mismatch` and `api version` substrings are already referenced by existing tests in `test/mcp-tool-factory.test.ts` and must not regress).
- `test/api-version-check.test.ts` — new unit test file covering `verifyApiVersion`.

### Out of Scope
- Automated release tooling to bump `DAEMON_API_VERSION` on HTTP contract changes.
- Negotiating a compatibility range instead of strict equality.
- Daemon-side rejection of clients older than some floor via a request header.
- Validating request bodies against schema at the daemon.
- Bumping `DAEMON_API_VERSION` itself — this plan wires the check but does not bump the version number; adding the `/api/version` route is additive (a new optional route) and does not break existing clients.

## Files

### Create
- `test/api-version-check.test.ts` — vitest unit test for `verifyApiVersion`. Covers: (1) happy path returns without throwing when daemon reports matching version, (2) mismatch throws an `Error` whose message contains `version mismatch` (case-insensitive) AND routes through `classifyDaemonError` to `kind: 'version-mismatch'`, (3) second call for the same `${port}:${pid}` key hits the cache and does not re-issue a fetch, (4) missing lockfile returns without throwing and without fetching, (5) a `GET /api/version` request path is not itself intercepted recursively. Test uses a real ephemeral HTTP server (via `node:http.createServer`) bound to `127.0.0.1:0` and writes a fake lockfile in a tmpdir — no mocking frameworks, consistent with AGENTS.md ("No mocks. Test real code"). Test must clean up the tmpdir and close the HTTP server in an `afterEach` / `afterAll`.

### Modify
- `packages/client/src/routes.ts` — add `version: '/api/version'` entry to `API_ROUTES`; add and export `export interface VersionResponse { version: number }`.
- `packages/client/src/api-version.ts` — keep `export const DAEMON_API_VERSION = 4`; prepend a JSDoc-style comment block stating: bump when making a breaking change to any route's path, request shape, or response shape; adding a new optional field is NOT breaking; removing a field, renaming a route, or changing a response's required fields IS. Add a module-level `const verifiedDaemons = new Map<string, number>()`. Add `export async function verifyApiVersion(cwd: string): Promise<void>` that reads the lockfile, bails out if absent, computes the cache key, short-circuits on cache hit, issues a direct `fetch` to `http://127.0.0.1:${lock.port}${API_ROUTES.version}` with a short abort-signal timeout (reuse the 30s timeout pattern from `daemon-client.ts` for consistency), parses the JSON body as `VersionResponse`, compares `data.version` to `DAEMON_API_VERSION`, throws an `Error` with message `eforge daemon API version-mismatch: client expects v${DAEMON_API_VERSION}, daemon reports v${data.version}. Restart the daemon with the matching version.` on inequality, and caches the value on equality. Also export a `clearApiVersionCache()` helper for test use so the test file can reset state between cases without reaching into module internals.
- `packages/client/src/daemon-client.ts` — import `verifyApiVersion` and `API_ROUTES` (already indirectly used), call `await verifyApiVersion(cwd)` at the top of `daemonRequest` when `path !== API_ROUTES.version`. Do not add the check to `daemonRequestIfRunning` — that helper is called from places that must stay fast-and-fallible (e.g. status displays that already tolerate a null return).
- `packages/client/src/index.ts` — add `verifyApiVersion` (and `clearApiVersionCache`) to the existing `export { DAEMON_API_VERSION } from './api-version.js'` line; add `VersionResponse` to the `export type` line that re-exports route types from `./routes.js`.
- `packages/monitor/src/server.ts` — import `DAEMON_API_VERSION` from `@eforge-build/client` alongside the existing `API_ROUTES` import. Inside the `createServer` request handler, add a branch: `if (req.method === 'GET' && url === API_ROUTES.version) { sendJson(res, { version: DAEMON_API_VERSION }); return; }` placed next to the existing `API_ROUTES.health` branch so it is processed before the static-file SPA fallback. The handler must NOT touch `db`, `workerTracker`, `daemonState`, or queue state so it works uniformly in daemon and non-daemon modes.
- `packages/eforge/src/cli/errors.ts` — **verification only**. Confirm `classifyDaemonError` routes the thrown mismatch error to `kind: 'version-mismatch'`. The existing conditional matches `version-mismatch` (hyphen) or `api version` (space), and the thrown message contains both `API version-mismatch` and `version mismatch`, so no edit should be required. If the builder discovers a mismatch, prefer adjusting the thrown string in `api-version.ts` over changing the classifier (the classifier has unit tests in `test/mcp-tool-factory.test.ts` that must not regress).

## Verification

- [ ] `pnpm build` completes with zero TypeScript errors (new `API_ROUTES.version` entry and `VersionResponse` type resolve across workspace packages).
- [ ] `pnpm type-check` completes with zero errors.
- [ ] `pnpm test` passes; the new `test/api-version-check.test.ts` runs and all five cases (happy path, mismatch, cache hit, no-lockfile bail-out, recursion guard) pass.
- [ ] `test/mcp-tool-factory.test.ts` continues to pass without modification (classifier behavior for `version-mismatch` and `api version` substrings remains intact).
- [ ] Running `curl -s http://127.0.0.1:${PORT}/api/version` against a running daemon returns HTTP 200 with JSON body `{"version":4}` (or whatever `DAEMON_API_VERSION` is at the time).
- [ ] The `/api/version` handler returns 200 even when `workerTracker`, `daemonState`, and `db` are absent or empty (i.e. it does not gate behind daemon mode).
- [ ] `verifyApiVersion` issues exactly one fetch per unique `${port}:${pid}` key within a single process, verified in the test by a request counter on the test HTTP server.
- [ ] When the test forces `DAEMON_API_VERSION` to differ from the server response, `verifyApiVersion` throws an `Error` whose message contains the case-insensitive substring `version mismatch`, AND `classifyDaemonError(err).kind === 'version-mismatch'`, AND `formatCliError(err).exitCode === 2`.
- [ ] `verifyApiVersion` with no lockfile at `cwd` resolves without throwing and without issuing any HTTP request (verified via a request counter on the test HTTP server staying at 0).
- [ ] `daemonRequest(cwd, 'GET', API_ROUTES.version)` does not recurse into `verifyApiVersion` (verified because `verifyApiVersion` is skipped for that exact path; the test covers this by calling `daemonRequest` against the version route and observing the request counter stays at 1).
- [ ] `packages/client/src/api-version.ts` contains a comment block that states: bump when making a breaking change to any route's path, request shape, or response shape; adding a new optional field is NOT breaking; removing a field, renaming a route, or changing a response's required fields IS.
