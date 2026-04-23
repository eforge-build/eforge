---
id: plan-01-api-routes-contract
name: Central API_ROUTES contract and typed helper migration
depends_on: []
branch: hardening-02-central-api-routes-contract-with-typed-helpers/api-routes-contract
agents:
  builder:
    effort: xhigh
    rationale: "Surface-wide type contract refactor: must harvest ~28 daemon routes
      with accurate request/response shapes, define a new helper surface, and
      migrate ten consumer files (two of them with 30+ hardcoded paths) in a
      single pass. A missed signature or response-type mismatch cascades into
      type-check failures across five packages."
  reviewer:
    effort: high
    rationale: Reviewer must cross-check every route in API_ROUTES against server.ts
      handlers and every migrated call site against the helper signature. High
      effort is warranted by breadth, not depth.
---

# Central API_ROUTES contract and typed helper migration

## Architecture Context

The eforge daemon exposes an HTTP API from `packages/monitor/src/server.ts` (~28 registered routes between lines 746 and 1360, plus a CORS catch-all). Today every consumer re-types paths and response shapes inline:

- `packages/eforge/src/cli/mcp-proxy.ts` - 30+ hardcoded `/api/...` literals passed to `daemonRequest()` / `requireDaemon()`.
- `packages/eforge/src/cli/index.ts` - 1 hardcoded literal (`/api/enqueue`).
- `packages/pi-eforge/extensions/eforge/index.ts`, `backend-commands.ts`, `config-command.ts` - 30+ hardcoded literals across three files.
- `packages/monitor-ui/src/lib/api.ts` - 12 hardcoded literals in browser `fetch()` calls.
- `packages/monitor-ui/src/components/layout/{queue-section,shutdown-banner,sidebar}.tsx` - 4 hardcoded literals in React hooks.
- `packages/monitor-ui/src/hooks/use-eforge-events.ts` - 3 hardcoded literals (`/api/run-state/${sessionId}` and two `/api/events/${sessionId}` EventSource URLs).
- `packages/monitor-ui/src/components/preview/plan-preview-panel.tsx` - 1 hardcoded literal (`/api/plans/${sessionId}` passed to `useApi`).
- `packages/monitor-ui/src/components/plans/plan-cards.tsx` - 1 hardcoded literal (`/api/plans/${sessionId}` passed to `useApi`).
- `test/backend-profile-wiring.test.ts` - 12 hardcoded literals in assertions.
- `packages/eforge/src/cli/mcp-proxy.ts:14` still imports `sanitizeProfileName` and `parseRawConfigLegacy` from `@eforge-build/engine/config`, even though both are already re-exported from `@eforge-build/client` via `packages/client/src/profile-utils.ts` and re-exported in `packages/client/src/index.ts:29`.

The client already exposes `daemonRequest<T>(cwd, method, path, body?)` returning `{ data: T; port: number }` (see `packages/client/src/daemon-client.ts`). Note: the actual signature is positional `(cwd, method, path, body)`, not the `{ cwd, body }` options-object shown in the PRD example. The plan uses the real signature. A sibling `daemonRequestIfRunning(cwd, method, path, body?)` exists for callers that should not auto-spawn the daemon - both must be wrapped or surfaced. Most request/response types are already declared in `packages/client/src/types.ts` (HealthResponse, AutoBuildState, ProjectContext, ConfigShowResponse, ConfigValidateResponse, QueueItem, SessionMetadata, RunInfo, LatestRunResponse, OrchestrationResponse, RunSummary, RunState, PlanInfo, PlansResponse, DiffBulkResponse, DiffSingleResponse, DiffResponse, EnqueueResponse, CancelResponse, StopDaemonResponse, KeepAliveResponse, BackendListResponse, BackendShowResponse, BackendUseRequest, BackendUseResponse, BackendCreateRequest, BackendCreateResponse, BackendDeleteRequest, BackendDeleteResponse, ModelProvidersResponse, ModelInfo, ModelListResponse).

So the shape of this work is: define route constants + the few missing request types + per-route helpers, then sweep the callers.

## Implementation

### Overview

Create a single-source `API_ROUTES` map, per-route request/response types (reusing the rich set already in `types.ts`), and one typed helper per route in `@eforge-build/client`. Migrate every consumer to go through the helpers (or at minimum the `API_ROUTES` constants, for the test file and for SSE/EventSource sites that cannot use a JSON helper). Update `mcp-proxy.ts:14` to drop the `@eforge-build/engine/config` import. Optionally import the same `API_ROUTES` constants in `packages/monitor/src/server.ts` for single-source symmetry.

### Key Decisions

1. **Helper signature mirrors the existing `daemonRequest<T>()` contract.** The existing helper takes positional `(cwd, method, path, body?)` and returns `{ data: T; port: number }`. Each new per-route helper accepts an options object containing `cwd` plus route params/body, delegates to `daemonRequest<ResponseType>`, and returns the same `{ data, port }` envelope. Do not silently drop `port` - downstream code in `mcp-proxy.ts` logs the port. Example:
   ```ts
   export function apiEnqueue(opts: { cwd: string; body: EnqueueRequest }) {
     return daemonRequest<EnqueueResponse>(opts.cwd, 'POST', API_ROUTES.enqueue, opts.body);
   }
   ```
2. **Provide `*IfRunning` variants only for callers that need them.** The CLI uses `daemonRequestIfRunning` for read-only status calls that must not auto-spawn the daemon. Where a helper has both a spawning and a non-spawning caller, expose a second helper suffixed with `IfRunning` (e.g., `apiGetLatestRunIfRunning`) returning `{ data, port } | null`. Do not add this variant for every route - only for routes where callers actually use the non-spawning behavior.
3. **Route params are encoded inside the helper, not the caller.** For parameterised paths (`/api/cancel/:sessionId`, `/api/events/:runId`, `/api/orchestration/:runId`, `/api/run-summary/:id`, `/api/run-state/:id`, `/api/plans/:runId`, `/api/diff/:sessionId/:planId`, `/api/backend/:name`), `API_ROUTES` stores the pattern string and the helper calls an internal `buildPath(pattern, params)` that `encodeURIComponent`-encodes each substitution. Export `buildPath` so the monitor UI can reuse it for SSE/EventSource URLs that cannot go through a JSON helper. This prevents typos and double-encoding.
4. **Browser helpers live alongside daemon helpers and share types.** `packages/monitor-ui/src/lib/api.ts` re-implements each helper against `fetch(path)` (same-origin) but reuses the same `API_ROUTES` constants and request/response types imported from `@eforge-build/client`. Keeping two transports (Node `daemonRequest` for CLI, browser `fetch` for UI) avoids dragging a Node-specific daemon client into the browser bundle, while still centralising the path contract. This matches the PRD guidance to 'pick the simpler approach consistent with existing UI patterns'.
5. **Grouping: by concern, not by route count.** Helper files under `packages/client/src/api/`:
   - `queue.ts` - enqueue, cancel, queue, runs, latest-run, run-summary, run-state, plans, diff, orchestration, session-metadata (events stays path-only via `API_ROUTES`).
   - `backend.ts` - backend/list, backend/show, backend/use, backend/create, backend/:name DELETE.
   - `status.ts` - health, keep-alive, project-context, auto-build GET/POST.
   - `config.ts` - config/show, config/validate.
   - `models.ts` - models/providers, models/list.
   - `daemon.ts` - daemon/stop.
   Re-export from `packages/client/src/index.ts`.
6. **Re-export types, not re-declare them.** Every existing type in `packages/client/src/types.ts` stays put. `routes.ts` only declares the small handful of currently-missing request shapes (e.g., `EnqueueRequest = { source: string; flags?: string[] }`, `AutoBuildSetRequest = { enabled: boolean }`, `BackendListRequest`, `ModelProvidersRequest`, `ModelListRequest` if any are missing). For each route, define explicit `*Request` (where applicable) and `*Response` aliases so a future call site can import the pair without guessing.
7. **Single-source the daemon side too.** `packages/monitor/src/server.ts` imports `API_ROUTES` from `@eforge-build/client` and swaps the inline path-match strings. The CORS `/api/*` wildcard prefix check stays literal (it is a wildcard, not a registered route). This is technically optional in the PRD but is cheap here and makes drift impossible.
8. **Drop the engine/config import in mcp-proxy.** Line 14 imports `sanitizeProfileName` and `parseRawConfigLegacy` from `@eforge-build/engine/config`. Both are already re-exported from `@eforge-build/client` (verified at `packages/client/src/index.ts:29`). Move the named imports onto the existing `@eforge-build/client` import line. No engine-side changes required. Other `@eforge-build/engine/config` imports elsewhere in `packages/eforge` (loadConfig, validateConfigFile, EforgeConfig, HookConfig, debug-composer types) are out of scope - the PRD's approach text restricts this step to the two named helpers in `mcp-proxy.ts:14`.

### Exhaustive route catalogue to encode

Harvested from `packages/monitor/src/server.ts`. Builder must confirm each one (and any additions found during harvesting) before writing `routes.ts`:

| # | Method | Path | Notes |
|---|--------|------|-------|
| 1 | OPTIONS | `/api/*` | CORS preflight, wildcard - do not expose a helper, do not add to `API_ROUTES`. |
| 2 | POST | `/api/keep-alive` | |
| 3 | POST | `/api/enqueue` | Body: `{ source: string; flags?: string[] }` |
| 4 | POST | `/api/cancel/:sessionId` | |
| 5 | POST | `/api/daemon/stop` | Body: `{ force?: boolean }` |
| 6 | GET | `/api/auto-build` | |
| 7 | POST | `/api/auto-build` | Body: `{ enabled: boolean }` |
| 8 | GET | `/api/backend/list` | Query: `?scope=project|user|all` |
| 9 | GET | `/api/backend/show` | |
| 10 | POST | `/api/backend/use` | |
| 11 | POST | `/api/backend/create` | |
| 12 | DELETE | `/api/backend/:name` | Body: `{ force?: boolean; scope?: string }` |
| 13 | GET | `/api/models/providers` | Query: `?backend=pi|claude-sdk` |
| 14 | GET | `/api/models/list` | Query: `?backend=...&provider=...` |
| 15 | GET | `/api/project-context` | |
| 16 | GET | `/api/health` | |
| 17 | GET | `/api/config/show` | |
| 18 | GET | `/api/config/validate` | |
| 19 | GET | `/api/queue` | |
| 20 | GET | `/api/session-metadata` | |
| 21 | GET | `/api/runs` | |
| 22 | GET | `/api/latest-run` | |
| 23 | GET | `/api/events/:runId` | SSE stream; consumers still use `subscribeToSession()` / EventSource - expose the path constant but do not wrap in a JSON helper. |
| 24 | GET | `/api/orchestration/:runId` | |
| 25 | GET | `/api/run-summary/:id` | |
| 26 | GET | `/api/run-state/:id` | |
| 27 | GET | `/api/plans/:runId` | |
| 28 | GET | `/api/diff/:sessionId/:planId` | Optional query: `?file=path` (returns `DiffSingleResponse` instead of `DiffBulkResponse`). |

If the builder finds additional routes during harvesting, add helpers for those too and document them in the implementation notes.

## Scope

### In Scope

- New file `packages/client/src/routes.ts`: `API_ROUTES` const map + `ApiRoute` union + `buildPath(pattern, params)` helper + per-route `*Request`/`*Response` types (reusing existing exported types from `types.ts` wherever they already exist; declaring only the few missing request types).
- New directory `packages/client/src/api/` with files `queue.ts`, `backend.ts`, `status.ts`, `config.ts`, `models.ts`, `daemon.ts`, each exporting typed helpers that delegate to `daemonRequest<T>()`. Add `*IfRunning` variants only where call sites need them.
- `packages/client/src/index.ts`: re-export `API_ROUTES`, `ApiRoute`, `buildPath`, every new helper, and every new request/response type. Do not remove or rename existing exports.
- Migrate consumers to the helpers or to `API_ROUTES` constants:
  - `packages/eforge/src/cli/mcp-proxy.ts` - replace all 30+ hardcoded literals; collapse the `@eforge-build/engine/config` import on line 14 into the existing `@eforge-build/client` import below it.
  - `packages/eforge/src/cli/index.ts` - replace the 1 `/api/enqueue` literal with `apiEnqueue()`.
  - `packages/pi-eforge/extensions/eforge/index.ts` - replace all hardcoded literals with helpers.
  - `packages/pi-eforge/extensions/eforge/backend-commands.ts` - replace all hardcoded literals with backend helpers.
  - `packages/pi-eforge/extensions/eforge/config-command.ts` - replace any hardcoded literals with config helpers.
  - `packages/monitor-ui/src/lib/api.ts` - import `API_ROUTES` and shared types; rewrite each `fetch()` call to consume the constant for the path. Keep the existing `fetch` transport. Use `buildPath()` for parameterised routes.
  - `packages/monitor-ui/src/components/layout/queue-section.tsx` - call the new helper from `lib/api.ts` (or pass `API_ROUTES.queue` to `useApi`) instead of hardcoding `/api/queue`.
  - `packages/monitor-ui/src/components/layout/shutdown-banner.tsx` - swap `/api/keep-alive` for the helper.
  - `packages/monitor-ui/src/components/layout/sidebar.tsx` - swap the 2 literals (`/api/runs`, `/api/session-metadata`) for helpers / constants.
  - `packages/monitor-ui/src/hooks/use-eforge-events.ts` - replace the 3 literals (`/api/run-state/:id`, 2x `/api/events/:id`) with `API_ROUTES.runState` / `API_ROUTES.events` plus `buildPath()`. Keep `fetch` and `EventSource`.
  - `packages/monitor-ui/src/components/preview/plan-preview-panel.tsx` - swap the `/api/plans/${sessionId}` literal for a path built from `API_ROUTES.plans`.
  - `packages/monitor-ui/src/components/plans/plan-cards.tsx` - swap the `/api/plans/${sessionId}` literal for a path built from `API_ROUTES.plans`.
  - `test/backend-profile-wiring.test.ts` - replace the 12 hardcoded literals in assertions with `API_ROUTES` references. Keep test semantics identical.
- `packages/monitor/src/server.ts` - import `API_ROUTES` from `@eforge-build/client` and swap the inline path-match strings for constant references. Keep the CORS `/api/*` wildcard literal-only.

### Out of Scope

- Daemon version negotiation (PRD 03).
- MCP tool factory refactor (PRD 07).
- Adding, renaming, or removing daemon routes.
- Other `@eforge-build/engine/config` imports in `packages/eforge/src/cli/{index,display,debug-composer}.ts` (loadConfig, validateConfigFile, EforgeConfig, HookConfig). Different surface, different PRD. The PRD's approach text is explicit that this step targets only `mcp-proxy.ts:14`.
- Adding an eslint rule or pre-commit hook to flag `'/api/'` literals (PRD calls this out as optional; the post-merge grep check is the gate).
- `packages/engine/src/review-heuristics.ts`. The PRD lists this file as a consumer, but the only `/api/` occurrence (line 157, `file.includes('/api/')`) is a file-path classifier - not an HTTP call. No migration is required and the verification grep below explicitly tolerates this match.

## Files

### Create

- `packages/client/src/routes.ts` - `API_ROUTES` const, `ApiRoute` type, `buildPath()` helper, all per-route request/response type aliases (reuse existing exported types wherever possible; declare only the missing request shapes).
- `packages/client/src/api/queue.ts` - helpers: `apiEnqueue`, `apiCancel`, `apiGetQueue`, `apiGetRuns`, `apiGetLatestRun` (+ `apiGetLatestRunIfRunning` if used), `apiGetRunSummary` (+ `apiGetRunSummaryIfRunning` if used), `apiGetRunState`, `apiGetPlans`, `apiGetDiff`, `apiGetOrchestration`, `apiGetSessionMetadata`. (`/api/events/:runId` is path-only via `API_ROUTES`, no JSON helper.)
- `packages/client/src/api/backend.ts` - helpers: `apiListBackends`, `apiShowBackend`, `apiUseBackend`, `apiCreateBackend`, `apiDeleteBackend`.
- `packages/client/src/api/status.ts` - helpers: `apiHealth`, `apiKeepAlive`, `apiGetProjectContext`, `apiGetAutoBuild`, `apiSetAutoBuild`.
- `packages/client/src/api/config.ts` - helpers: `apiShowConfig`, `apiValidateConfig` (+ `apiShowConfigIfRunning` / `apiValidateConfigIfRunning` if needed).
- `packages/client/src/api/models.ts` - helpers: `apiListModelProviders`, `apiListModels`.
- `packages/client/src/api/daemon.ts` - helpers: `apiStopDaemon`.

### Modify

- `packages/client/src/index.ts` - add re-exports for `API_ROUTES`, `ApiRoute`, `buildPath`, every helper above, and every new request/response type. Preserve all existing exports.
- `packages/monitor/src/server.ts` - import `API_ROUTES` from `@eforge-build/client` and replace inline path literals in the request dispatcher. Keep the CORS `/api/*` wildcard prefix check literal.
- `packages/eforge/src/cli/mcp-proxy.ts` - replace all hardcoded literals with helper calls; remove the `@eforge-build/engine/config` import on line 14 by moving `sanitizeProfileName` and `parseRawConfigLegacy` onto the existing `@eforge-build/client` import.
- `packages/eforge/src/cli/index.ts` - replace the 1 `/api/enqueue` literal with `apiEnqueue()`.
- `packages/pi-eforge/extensions/eforge/index.ts` - replace all hardcoded literals with helper calls.
- `packages/pi-eforge/extensions/eforge/backend-commands.ts` - replace all hardcoded literals with backend helpers.
- `packages/pi-eforge/extensions/eforge/config-command.ts` - replace hardcoded literals with config helpers.
- `packages/monitor-ui/src/lib/api.ts` - import `API_ROUTES`, `buildPath`, and shared request/response types; rewrite each `fetch()` call to use the constant for the path.
- `packages/monitor-ui/src/components/layout/queue-section.tsx` - swap `/api/queue` for the corresponding helper or `API_ROUTES.queue`.
- `packages/monitor-ui/src/components/layout/shutdown-banner.tsx` - swap `/api/keep-alive` for the helper or constant.
- `packages/monitor-ui/src/components/layout/sidebar.tsx` - swap the 2 literals for helpers or constants.
- `packages/monitor-ui/src/hooks/use-eforge-events.ts` - replace the 3 literals using `API_ROUTES.runState` / `API_ROUTES.events` + `buildPath()`; keep `fetch` and `EventSource` primitives.
- `packages/monitor-ui/src/components/preview/plan-preview-panel.tsx` - swap `/api/plans/${sessionId}` for `buildPath(API_ROUTES.plans, { runId: sessionId })` (or local constant equivalent).
- `packages/monitor-ui/src/components/plans/plan-cards.tsx` - same as above.
- `test/backend-profile-wiring.test.ts` - replace the 12 hardcoded literals in assertions with `API_ROUTES` references. A future route rename surfaces as a type error rather than silent test skew.

## Verification

- [ ] `pnpm type-check` exits 0 for the whole workspace.
- [ ] `pnpm build` exits 0 for the whole workspace.
- [ ] `pnpm test` exits 0.
- [ ] `rg "'/api/" packages/eforge/src packages/pi-eforge/extensions packages/engine/src packages/monitor-ui/src` returns only matches inside `packages/monitor-ui/src/lib/api.ts` (browser transport that pairs `API_ROUTES` with `fetch`) and the known non-route heuristic in `packages/engine/src/review-heuristics.ts:157` (`file.includes('/api/')`, a file-path classifier - not a daemon consumer). Zero matches in CLI, MCP proxy, Pi extension, or any other monitor-ui file (including `hooks/`, `components/layout/`, `components/preview/`, `components/plans/`).
- [ ] `rg "'/api/" packages/client/src` returns matches only in `packages/client/src/routes.ts`.
- [ ] `rg "@eforge-build/engine/config" packages/eforge/src/cli/mcp-proxy.ts` returns zero lines.
- [ ] `packages/client/src/routes.ts` exports an `API_ROUTES` const whose keys correspond 1:1 with the 27 registered daemon routes in the route catalogue above (rows #2-#28; row #1 is the CORS `/api/*` wildcard preflight and is intentionally not in `API_ROUTES`). Confirmed by comparing `Object.keys(API_ROUTES)` against the list.
- [ ] `packages/client/src/api/` contains exactly the six files listed under Files -> Create (`queue.ts`, `backend.ts`, `status.ts`, `config.ts`, `models.ts`, `daemon.ts`), and `packages/client/src/index.ts` re-exports each helper plus `API_ROUTES`, `ApiRoute`, and `buildPath`.
- [ ] `packages/monitor/src/server.ts` no longer contains inline `'/api/...'` path literals for registered routes; handler dispatch reads from `API_ROUTES`. The CORS `/api/*` wildcard check may remain literal.
- [ ] `packages/eforge/src/cli/mcp-proxy.ts:14` no longer imports from `@eforge-build/engine/config`; `sanitizeProfileName` and `parseRawConfigLegacy` are imported from `@eforge-build/client` instead.
- [ ] Smoke test: after `pnpm build`, run `node packages/eforge/dist/cli.js daemon start`, then `node packages/eforge/dist/cli.js queue list` and `node packages/eforge/dist/cli.js status` each exit with code 0 against the daemon started in the same shell session.
