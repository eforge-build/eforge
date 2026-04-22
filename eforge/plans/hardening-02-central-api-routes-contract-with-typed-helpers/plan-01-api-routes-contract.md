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
      migrate six consumer files (two of them with 30+ hardcoded paths) in a
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

The eforge daemon exposes an HTTP API from `packages/monitor/src/server.ts` (~28 routes between lines 746 and 1360). Today every consumer re-types paths and response shapes inline:

- `packages/eforge/src/cli/mcp-proxy.ts` — 32 hardcoded `/api/…` literals passed to `daemonRequest()`.
- `packages/eforge/src/cli/index.ts` — 1 hardcoded literal.
- `packages/pi-eforge/extensions/eforge/{index,backend-commands,config-command}.ts` — 35 hardcoded literals across three files.
- `packages/monitor-ui/src/lib/api.ts` — 12 hardcoded literals in browser `fetch()` calls.
- `packages/monitor-ui/src/components/layout/{queue-section,shutdown-banner,sidebar}.tsx` — 4 hardcoded literals in React hooks.
- `packages/monitor-ui/src/hooks/use-eforge-events.ts` — 3 hardcoded literals (`/api/run-state/${sessionId}` and two `/api/events/${sessionId}` EventSource URLs).
- `packages/monitor-ui/src/components/preview/plan-preview-panel.tsx` — 1 hardcoded literal (`/api/plans/${sessionId}` passed to `useApi`).
- `packages/monitor-ui/src/components/plans/plan-cards.tsx` — 1 hardcoded literal (`/api/plans/${sessionId}` passed to `useApi`).
- `test/backend-profile-wiring.test.ts` — 12 hardcoded literals in assertions.
- `packages/eforge/src/cli/mcp-proxy.ts:14` still imports `sanitizeProfileName` and `parseRawConfigLegacy` from `@eforge-build/engine/config` (even though both are already re-exported from `@eforge-build/client` via `packages/client/src/profile-utils.ts`).

The client already exposes `daemonRequest<T>(cwd, method, path, body?)` returning `{ data: T; port: number }` (see `packages/client/src/daemon-client.ts`), and `@eforge-build/client` already re-exports `sanitizeProfileName`/`parseRawConfigLegacy`. So the shape of this work is: define constants + types + helpers, then sweep the callers.

## Implementation

### Overview

Create a single-source `API_ROUTES` map, per-route request/response types, and one typed helper per route in `@eforge-build/client`. Migrate every consumer to go through the helpers (or at minimum the `API_ROUTES` constants, for the test file and any `fetch()` sites in the UI). Update `mcp-proxy.ts:14` to import the two profile helpers from `@eforge-build/client`. Optionally import the same constants in `packages/monitor/src/server.ts` for single-source symmetry.

### Key Decisions

1. **Helper signature mirrors the existing `daemonRequest<T>()` contract.** The existing helper takes positional `(cwd, method, path, body?)` and returns `{ data: T; port: number }`. Each new per-route helper accepts an options object containing `cwd` plus route params/body, delegates to `daemonRequest<ResponseType>`, and returns the same `{ data, port }` envelope. Do **not** silently drop `port` — downstream code uses it (e.g., MCP proxy logs the port). Example:
   ```ts
   export function apiEnqueue(opts: { cwd: string; body: EnqueueRequest }) {
     return daemonRequest<EnqueueResponse>(opts.cwd, 'POST', API_ROUTES.enqueue, opts.body);
   }
   ```
2. **Route params are encoded inside the helper, not the caller.** For parameterised paths (`/api/cancel/:sessionId`, `/api/events/:runId`, `/api/orchestration/:runId`, `/api/run-summary/:id`, `/api/run-state/:id`, `/api/plans/:runId`, `/api/diff/:sessionId/:planId`, `/api/backend/:name`), `API_ROUTES` stores the pattern string and the helper calls an internal `buildPath(pattern, params)` that `encodeURIComponent`-encodes each substitution. This prevents typos and double-encoding.
3. **Browser helpers live alongside daemon helpers and share types.** `packages/monitor-ui/src/lib/api.ts` re-implements each helper against `fetch(window.location.origin + path)` but reuses the same `API_ROUTES` constants and request/response types imported from `@eforge-build/client`. Keeping two transports (one for daemon, one for browser) avoids dragging a Node-specific daemon client into the browser bundle, while still centralising the path contract. This matches the PRD guidance to 'pick the simpler approach consistent with existing UI patterns'.
4. **Grouping: by concern, not by route count.** Helper files under `packages/client/src/api/`: `queue.ts` (enqueue, cancel, queue, runs, latest-run, run-summary, run-state, plans, diff, orchestration, session-metadata, events), `backend.ts` (backend/list, backend/show, backend/use, backend/create, backend/:name DELETE), `status.ts` (health, keep-alive, project-context, auto-build GET/POST), `config.ts` (config/show, config/validate), `models.ts` (models/providers, models/list), `daemon.ts` (daemon/stop). Re-export from `packages/client/src/index.ts`.
5. **Re-export types, not re-declare them.** Request/response types for existing routes should be pulled from the existing daemon-side definitions where already exported (`EnqueueResponse`, `LatestRunResponse`, `RunSummary`, `ConfigValidateResponse`, etc. — most already live in `@eforge-build/client`). Only declare new types when a route currently has no named response shape. Avoid duplicating types.
6. **Single-source the daemon side too.** `packages/monitor/src/server.ts` imports `API_ROUTES` from `@eforge-build/client` and swaps the inline path-match strings. This is technically optional in the PRD but is cheap here and makes drift impossible. Do this as part of the same plan.
7. **Drop the engine/config import in mcp-proxy.** Line 14 already has a twin (line 15 imports `daemonRequest` etc. from `@eforge-build/client`). Collapse into one import line sourced from `@eforge-build/client`. No engine-side changes required — the functions were already moved to `packages/client/src/profile-utils.ts`. Other `@eforge-build/engine/config` imports in `packages/eforge` (for `loadConfig`, `validateConfigFile`, `EforgeConfig`, `HookConfig`, debug-composer types) are out of scope; the PRD's own approach section restricts this step to the two named helpers in `mcp-proxy.ts:14`.

### Exhaustive route catalogue to encode

Harvested from `packages/monitor/src/server.ts`. Confirm all 28 in the builder's first step before writing `routes.ts`:

| # | Method | Path | Notes |
|---|--------|------|-------|
| 1 | OPTIONS | `/api/*` | CORS preflight, not a consumer-callable route — do not expose a helper. |
| 2 | POST | `/api/keep-alive` | |
| 3 | POST | `/api/enqueue` | |
| 4 | POST | `/api/cancel/:sessionId` | |
| 5 | POST | `/api/daemon/stop` | |
| 6 | GET | `/api/auto-build` | |
| 7 | POST | `/api/auto-build` | |
| 8 | GET | `/api/backend/list` | |
| 9 | GET | `/api/backend/show` | |
| 10 | POST | `/api/backend/use` | |
| 11 | POST | `/api/backend/create` | |
| 12 | DELETE | `/api/backend/:name` | |
| 13 | GET | `/api/models/providers` | |
| 14 | GET | `/api/models/list` | |
| 15 | GET | `/api/project-context` | |
| 16 | GET | `/api/health` | |
| 17 | GET | `/api/config/show` | |
| 18 | GET | `/api/config/validate` | |
| 19 | GET | `/api/queue` | |
| 20 | GET | `/api/session-metadata` | |
| 21 | GET | `/api/runs` | |
| 22 | GET | `/api/latest-run` | |
| 23 | GET | `/api/events/:runId` | SSE stream; consumers still use `subscribeToSession()` — expose the path constant but do not wrap in a JSON helper. |
| 24 | GET | `/api/orchestration/:runId` | |
| 25 | GET | `/api/run-summary/:id` | |
| 26 | GET | `/api/run-state/:id` | |
| 27 | GET | `/api/plans/:runId` | |
| 28 | GET | `/api/diff/:sessionId/:planId` | |

If the builder finds additional routes or sub-routes during harvesting (e.g., more specific paths past line 1300), add helpers for those too and mention them in the implementation notes.

## Scope

### In Scope

- New file `packages/client/src/routes.ts`: `API_ROUTES` const map + `ApiRoute` union + per-route `*Request` / `*Response` types (reusing existing types where available).
- New directory `packages/client/src/api/` with files `queue.ts`, `backend.ts`, `status.ts`, `config.ts`, `models.ts`, `daemon.ts`, each exporting typed helpers that delegate to `daemonRequest<T>()`.
- `packages/client/src/index.ts`: re-export `API_ROUTES`, `ApiRoute`, every new helper, and every new request/response type.
- Migrate consumers to the helpers or to `API_ROUTES` constants:
  - `packages/eforge/src/cli/mcp-proxy.ts` — replace all 32 hardcoded literals; collapse line 14 import into the line 15 `@eforge-build/client` import.
  - `packages/eforge/src/cli/index.ts` — replace the 1 hardcoded literal.
  - `packages/pi-eforge/extensions/eforge/index.ts`, `backend-commands.ts`, `config-command.ts` — replace all 35 literals.
  - `packages/monitor-ui/src/lib/api.ts` — refactor the 12 `fetch` calls to consume `API_ROUTES` + shared request/response types (browser transport stays local; paths come from the shared map).
  - `packages/monitor-ui/src/components/layout/queue-section.tsx`, `shutdown-banner.tsx`, `sidebar.tsx` — call helpers from `lib/api.ts` instead of hardcoding paths.
  - `packages/monitor-ui/src/hooks/use-eforge-events.ts` — replace the `/api/run-state/${sessionId}` fetch and the two `/api/events/${sessionId}` EventSource URLs with `API_ROUTES.runState` / `API_ROUTES.events` plus the same `buildPath()` helper used server-side. (EventSource stays — only the path string is centralised.)
  - `packages/monitor-ui/src/components/preview/plan-preview-panel.tsx` — swap the `/api/plans/${sessionId}` literal passed to `useApi` for a path built from `API_ROUTES.plans`.
  - `packages/monitor-ui/src/components/plans/plan-cards.tsx` — swap the `/api/plans/${sessionId}` literal passed to `useApi` for a path built from `API_ROUTES.plans`.
  - `test/backend-profile-wiring.test.ts` — use `API_ROUTES` constants in assertions.
- `packages/monitor/src/server.ts` — import `API_ROUTES` from `@eforge-build/client` and swap the inline path-match strings for constant references (single-source symmetry).

### Out of Scope

- Daemon version negotiation (PRD 03).
- MCP tool factory refactor (PRD 07).
- Adding, renaming, or removing daemon routes.
- Migrating other `@eforge-build/engine/config` imports in `packages/eforge/src/cli/{index,display,debug-composer}.ts`. Those import `loadConfig`, `validateConfigFile`, `EforgeConfig`, `HookConfig` — different surface, different PRD. The PRD's approach text is explicit that this step only targets `mcp-proxy.ts:14`.
- Adding an eslint rule or pre-commit hook to flag `'/api/'` literals (PRD calls this out as optional; the post-merge grep check covers the regression).
- `packages/engine/src/review-heuristics.ts`. The PRD lists this file as a consumer, but the only `/api/` occurrence (line 157, `file.includes('/api/')`) is a file-path classifier used to recognise API-route source files — it is not an HTTP call to the daemon. No migration is required; the verification criterion above explicitly allows this one match.

## Files

### Create

- `packages/client/src/routes.ts` — `API_ROUTES` const, `ApiRoute` type, all per-route request/response types (reuse existing exported types wherever they already exist).
- `packages/client/src/api/queue.ts` — helpers: `apiEnqueue`, `apiCancel`, `apiGetQueue`, `apiGetRuns`, `apiGetLatestRun`, `apiGetRunSummary`, `apiGetRunState`, `apiGetPlans`, `apiGetDiff`, `apiGetOrchestration`, `apiGetSessionMetadata`. (`/api/events/:runId` stays path-only — surfaced via `API_ROUTES` but not wrapped, since streaming lives in `subscribeToSession`.)
- `packages/client/src/api/backend.ts` — helpers: `apiListBackends`, `apiShowBackend`, `apiUseBackend`, `apiCreateBackend`, `apiDeleteBackend`.
- `packages/client/src/api/status.ts` — helpers: `apiHealth`, `apiKeepAlive`, `apiGetProjectContext`, `apiGetAutoBuild`, `apiSetAutoBuild`.
- `packages/client/src/api/config.ts` — helpers: `apiShowConfig`, `apiValidateConfig`.
- `packages/client/src/api/models.ts` — helpers: `apiListModelProviders`, `apiListModels`.
- `packages/client/src/api/daemon.ts` — helpers: `apiStopDaemon`.

### Modify

- `packages/client/src/index.ts` — add re-exports for `API_ROUTES`, `ApiRoute`, every helper above, and every new request/response type. Do not remove or rename existing exports.
- `packages/monitor/src/server.ts` — import `API_ROUTES` from `@eforge-build/client` and replace the inline path literals in the request dispatcher. Keep the CORS `/api/*` prefix check literal-only (it's a wildcard, not a route).
- `packages/eforge/src/cli/mcp-proxy.ts` — replace the 32 hardcoded literals with helper calls; collapse the `@eforge-build/engine/config` import on line 14 into the existing `@eforge-build/client` import on line 15.
- `packages/eforge/src/cli/index.ts` — replace the 1 hardcoded `/api/enqueue` literal with `apiEnqueue()`.
- `packages/pi-eforge/extensions/eforge/index.ts` — replace all 27 hardcoded literals with helper calls.
- `packages/pi-eforge/extensions/eforge/backend-commands.ts` — replace all 7 hardcoded literals with backend helpers.
- `packages/pi-eforge/extensions/eforge/config-command.ts` — replace the 1 hardcoded literal with a config helper.
- `packages/monitor-ui/src/lib/api.ts` — import `API_ROUTES` and shared request/response types; rewrite each `fetch()` call to use the constant for the path. Keep the existing `fetch`-based transport; do not import the Node-specific `daemonRequest`.
- `packages/monitor-ui/src/components/layout/queue-section.tsx` — swap the hardcoded `/api/queue` literal for the corresponding helper from `lib/api.ts`.
- `packages/monitor-ui/src/components/layout/shutdown-banner.tsx` — swap the hardcoded `/api/keep-alive` literal for the helper.
- `packages/monitor-ui/src/components/layout/sidebar.tsx` — swap the 2 hardcoded literals (`/api/runs`, `/api/session-metadata`) for helpers.
- `packages/monitor-ui/src/hooks/use-eforge-events.ts` — replace the 3 hardcoded literals (`/api/run-state/:id`, 2× `/api/events/:id`) with `API_ROUTES.runState` / `API_ROUTES.events` via a shared `buildPath()` helper; keep the `fetch` and `EventSource` primitives.
- `packages/monitor-ui/src/components/preview/plan-preview-panel.tsx` — swap the `/api/plans/${sessionId}` literal for a path built from `API_ROUTES.plans`.
- `packages/monitor-ui/src/components/plans/plan-cards.tsx` — swap the `/api/plans/${sessionId}` literal for a path built from `API_ROUTES.plans`.
- `test/backend-profile-wiring.test.ts` — replace the 12 hardcoded literals with `API_ROUTES` references. Keep test semantics identical; the point is that assertions now reference the shared constant, so a route rename surfaces as a type error rather than a silent test skew.

## Verification

- [ ] `pnpm type-check` exits 0 for the whole workspace.
- [ ] `pnpm build` exits 0 for the whole workspace.
- [ ] `pnpm test` exits 0.
- [ ] `rg "'/api/" packages/eforge/src packages/pi-eforge/extensions packages/engine/src packages/monitor-ui/src` returns only matches inside `packages/monitor-ui/src/lib/api.ts` (browser transport that pairs `API_ROUTES` with `fetch`) and the known non-route heuristic in `packages/engine/src/review-heuristics.ts:157` (`file.includes('/api/')`, a file-path classifier — not a daemon consumer). Zero matches in CLI, MCP proxy, Pi extension, or any other monitor-ui file (including `hooks/`, `components/layout/`, `components/preview/`, `components/plans/`).
- [ ] `rg "'/api/" packages/client/src` returns matches only in `packages/client/src/routes.ts`.
- [ ] `rg "@eforge-build/engine/config" packages/eforge/src/cli/mcp-proxy.ts` returns zero lines.
- [ ] `packages/client/src/routes.ts` exports an `API_ROUTES` const whose keys correspond 1:1 with the 28 daemon routes listed in the plan body (confirmed by comparing `Object.keys(API_ROUTES)` against a manual grep of `server.ts` handlers).
- [ ] `packages/client/src/api/` contains exactly the six files listed under Files → Create, and `packages/client/src/index.ts` re-exports each helper.
- [ ] `packages/monitor/src/server.ts` no longer contains inline `'/api/'` path literals for registered routes; handler dispatch reads from `API_ROUTES`. The CORS `/api/*` wildcard check may remain literal.
- [ ] `packages/eforge/src/cli/mcp-proxy.ts:14` imports `sanitizeProfileName` and `parseRawConfigLegacy` from `@eforge-build/client` (or the line is absorbed into the existing `@eforge-build/client` import below it).
- [ ] Smoke test: `node packages/eforge/dist/cli.js daemon start`, then `node packages/eforge/dist/cli.js queue list` and `node packages/eforge/dist/cli.js status` each complete with exit code 0 against the daemon started in the same shell session. (Run after `pnpm build`.)
