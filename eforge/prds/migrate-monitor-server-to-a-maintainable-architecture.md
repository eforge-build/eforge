---
title: Migrate Monitor Server to a Maintainable Architecture
created: 2026-06-01
landing: pr
landing_auto_merge: true
---

# Migrate Monitor Server to a Maintainable Architecture

## Problem / Motivation

`packages/monitor/src/server.ts` has become a 4,924-line file that combines too many responsibilities: HTTP lifecycle, route dispatch, static UI serving, SSE streams, heartbeat polling, DB event parsing, queue/stack/config projections, route validation, security guards, and multiple feature route groups.

Evidence reviewed:

- `packages/monitor/src/server.ts` is 4,924 lines and currently combines HTTP lifecycle, route dispatch, static UI serving, SSE streams, heartbeat polling, DB event parsing, queue/stack/config projections, route validation, security guards, and multiple feature route groups.
- The only durable region marker in `server.ts` is `monitor-route-dispatch`; most of the file has no semantic region boundaries despite being far above the 300-line marker threshold in `AGENTS.md`.
- Existing extracted route files include `queue-recovery-routes.ts`, `resume-eligibility-route.ts`, and `session-plan-set-routes.ts`; these reduce line count but use ad hoc option bags and duplicate shared concerns such as JSON body parsing and path-segment validation.
- `packages/client/src/routes.ts` owns `API_ROUTES`; project policy says daemon/client route constants and wire shapes must remain owned by `@eforge-build/client` and monitor code must not inline `/api/...` route literals.
- `packages/monitor/src/db.ts` already follows the desired projection style for DB rows, with named row-to-wire helpers such as `rowToRunInfo`; this is the pattern the refactor should preserve for queue, stream snapshots, run summaries, and stack projections.
- Many tests import `startServer` from `packages/monitor/src/server.ts` or `@eforge-build/monitor/server`; `test/run-summary-plans.test.ts` imports `buildRunSummary` from `@eforge-build/monitor/server`. The migration must preserve these exports or provide compatibility re-exports.
- Roadmap alignment: the daemon is intended to remain the single orchestration authority, while rich workflow UI belongs in console/wrapper surfaces. This migration supports that direction by keeping the daemon API stable and making daemon internals maintainable.

Classification: this is an **architecture / deep** change with high confidence. It changes module boundaries and data-flow ownership inside the monitor daemon while intending to preserve external behavior.

Early assumptions and unknowns:

- Assumption: external package consumers beyond this monorepo are unlikely to depend on private helper locations under `@eforge-build/monitor/server`, but `startServer`, `MonitorServer`, `WorkerTracker`, `DaemonState`, `StartServerOptions`, and `buildRunSummary` should remain compatible because tests and wildcard exports make them reachable.
- Assumption: no daemon HTTP API version bump is needed because the migration should preserve all route paths, request shapes, response shapes, SSE frame shapes, and status codes.

## Goal

Implement a behavior-preserving monitor daemon architecture migration that reduces `packages/monitor/src/server.ts` to a small composition root while preserving the external HTTP/SSE contract. The desired outcome is a maintainable internal architecture with shared HTTP primitives, typed context, feature-owned route modules, stream-focused modules, reusable projections, and compatibility exports.

## Approach

### Target architecture

The migration changes internal monitor daemon boundaries while preserving its external HTTP/SSE contract.

Target module boundaries:

- `packages/monitor/src/server.ts`
  - Composition root only.
  - Creates `MonitorContext`, stream hub, router, HTTP server, and `MonitorServer` handle.
  - Re-exports compatibility symbols that callers currently import from `@eforge-build/monitor/server`.

- `packages/monitor/src/context.ts`
  - Defines `MonitorContext` and normalized startup/runtime state.
  - Centralizes derived paths such as active UI directories, queue directories, plan output directory, config directory decisions where applicable, and version information.

- `packages/monitor/src/http/*`
  - Owns HTTP request/response primitives, route definitions, route matching, body parsing, static assets, CORS preflight, and local/cross-site security guards.
  - Route handlers consume a small `RequestContext` and return or write typed JSON/SSE/static responses.

- `packages/monitor/src/streams/*`
  - Owns session SSE streams, daemon-wide SSE streams, polling, stream hello snapshots, event parsing, heartbeat payloads, and subscriber lifecycle.
  - Keeps stream snapshot construction aligned with shared projection functions rather than duplicating response shaping.

- `packages/monitor/src/projections/*`
  - Owns daemon wire-shape projections and reusable pure/read-side logic: `run-summary`, `queue-items`, `stack-layers`, `auto-build-state`, `config-redaction`, and event hydration helpers.
  - These modules should depend on `@eforge-build/client` types and schemas where wire shapes are involved.

- `packages/monitor/src/routes/*`
  - Feature-owned route registration modules that export `RouteDefinition[]` factories.
  - Handlers perform route-specific validation and delegate domain/projection work to services or projections.

Expected data flow:

1. `startServer` builds `MonitorContext` from `MonitorDB`, `StartServerOptions`, and version constants.
2. `createStreamHub(context)` starts/presents stream lifecycle APIs and heartbeat/polling resources.
3. `createMonitorRouter(context, streamHub)` combines feature route factories into one router.
4. The Node HTTP server delegates every request to the router.
5. Route handlers call projection/service modules and shared HTTP responders.
6. Stream hello snapshots call the same projection modules as REST routes for queue, runs, session metadata, auto-build state, stack layers, and event hydration.

External contract impact:

- No intended route, method, status-code, or response-shape changes.
- No intended SSE frame format changes.
- No intended `@eforge-build/client` API changes.
- No intended `DAEMON_API_VERSION` bump.

Test architecture impact:

- Existing in-process `startServer` tests remain valid.
- Route registration coverage tests should be added so new `API_ROUTES` entries cannot silently miss daemon registration.
- Existing parity tests such as `stream-hello-parity.test.ts`, `daemon-sse-handshake.test.ts`, and `session-sse-handshake.test.ts` become key regression coverage during extraction.

### Design decisions

- Use the existing Node `http` server rather than introduce Hono/Fastify.
  - Rationale: the primary problem is ownership and module boundaries, not lack of framework features. Avoiding a new dependency keeps migration risk low and preserves SSE/static behavior.

- Define a small custom route registry instead of another ordered `if` chain.
  - Route definitions should declare method, path pattern, optional security policy, and handler.
  - Parameterized routes should use `API_ROUTES` patterns and a shared matcher rather than local prefix constants where possible.
  - Rationale: this makes API coverage testable and prevents future line-count-driven handler files.

- Keep `API_ROUTES` and daemon wire types owned by `@eforge-build/client`.
  - Monitor route modules may import `API_ROUTES`, `buildPath`-compatible pattern helpers, schemas, and response types.
  - Monitor modules must not create new local wire-shape interfaces for client-owned responses.

- Introduce `MonitorContext` as the only broad dependency object passed to route factories and stream modules.
  - Rationale: current extracted files use ad hoc option bags, making dependencies hard to audit and encouraging duplicated utilities.
  - Route-specific helpers may still accept narrow arguments internally, but exported route factories should be context-based.

- Extract projections before moving route handlers.
  - First move pure/read-side logic such as `buildRunSummary`, queue item loading, stack layer loading, event parsing, config redaction, and auto-build wire projection.
  - Rationale: extracting projections reduces duplication and makes route movement smaller and safer.

- Preserve compatibility exports from `packages/monitor/src/server.ts`.
  - Keep `startServer`, `MonitorServer`, `WorkerTracker`, `DaemonState`, `StartServerOptions`, and `buildRunSummary` available from `@eforge-build/monitor/server`.
  - Rationale: tests and wildcard package exports currently make these imports observable.

- Treat streams as infrastructure, not routes.
  - Session streams and daemon streams should live under `streams/` with explicit start/stop APIs.
  - Route handlers should only attach an HTTP request to the stream hub.
  - Rationale: the current server file interleaves route handling with polling, replay, heartbeat, and subscriber lifecycle.

- Prefer feature modules that remain below maintainability thresholds.
  - Large areas such as extensions, playbooks, and session plans should have submodules for services/projections/validation rather than one large route file.
  - New implementation files must stay at or below 600 lines per `AGENTS.md`; files above 300 lines should include balanced durable region markers.

- Keep static UI serving as a shared HTTP utility.
  - Rationale: static asset serving includes important path traversal and symlink safety behavior that should be tested and reused rather than copied.

- Make security policy explicit at route registration.
  - Policies should cover local-only, same-origin/cross-site browser rejection, and mutation gating.
  - Rationale: current security checks are manually embedded in handlers and can be forgotten when adding routes.

- Phase the migration by stable seams.
  - Recommended order: shared HTTP utilities, projections, streams, route registry, low-risk route groups, high-risk route groups, final server trim.
  - Rationale: this lets existing route tests remain useful after each phase and avoids a single unreviewable mega-diff.

### Code impact

Primary files and directories to change:

- `packages/monitor/src/server.ts`
  - Shrink to composition root and compatibility exports.
  - Remove route implementations, projection logic, stream polling, static serving logic, and security helper bodies after they move to owned modules.

- `packages/monitor/src/context.ts` or equivalent new file
  - Add `MonitorContext`, normalized options, version metadata, and shared runtime dependencies.

- `packages/monitor/src/http/router.ts`
  - Add route definition types, `createRouter`, method/path matching, parameter extraction, query handling, and unknown API/static fallback integration.

- `packages/monitor/src/http/request.ts`
  - Add shared JSON body parsing with the existing 1MB limit and a typed body-too-large error.

- `packages/monitor/src/http/response.ts`
  - Add shared `sendJson`, `sendJsonError`, and response helpers.

- `packages/monitor/src/http/security.ts`
  - Move loopback Host/Origin and Fetch Metadata checks from `server.ts` into reusable policies.

- `packages/monitor/src/http/static-assets.ts`
  - Move static UI serving and MIME-type handling while preserving traversal and symlink protections.

- `packages/monitor/src/streams/event-parser.ts`
  - Move `parseEventRow` and related event hydration helpers.

- `packages/monitor/src/streams/session-stream.ts`
  - Move per-session SSE hello/replay/subscriber attachment logic.

- `packages/monitor/src/streams/daemon-stream.ts`
  - Move daemon-wide SSE hello/replay/subscriber attachment logic.

- `packages/monitor/src/streams/stream-hub.ts`
  - Own subscriber sets, polling timer, heartbeat timer, broadcast support, and cleanup.

- `packages/monitor/src/projections/run-summary.ts`
  - Move `buildRunSummary`; re-export from `server.ts` for compatibility.

- `packages/monitor/src/projections/queue-items.ts`
  - Move sync and async queue item loading, frontmatter parsing, dependency filtering, and recovery verdict projection.

- `packages/monitor/src/projections/stack-layers.ts`
  - Move stack layer loading and schema validation.

- `packages/monitor/src/projections/auto-build-state.ts`
  - Move auto-build state and heartbeat projection helpers.

- `packages/monitor/src/projections/config-redaction.ts`
  - Move sensitive config/profile redaction.

- `packages/monitor/src/routes/*`
  - Split current route groups into feature route modules. Existing extracted files can either be adapted into this structure or replaced by registered feature modules.

Tests likely to update or add:

- Add route registry coverage tests that compare registered daemon routes against expected `API_ROUTES` entries, with explicit handling for static fallback and dynamic parameterized routes.
- Preserve or update `test/run-summary-plans.test.ts` to import `buildRunSummary` from `@eforge-build/monitor/server` and optionally add direct projection-module tests.
- Preserve existing in-process `startServer` tests in `packages/monitor/src/__tests__` and `test/`.
- Add targeted tests for shared body parsing, security policies, route parameter matching, static file protections, and stream hub cleanup if existing coverage does not already cover them.

Known dependencies and constraints:

- `packages/monitor/package.json` wildcard exports mean new source files under `src/` become importable after build, so file names should be intentional and stable.
- `packages/monitor/src/index.ts` currently exports `MonitorServer` from `./server.js`; preserve that export path.
- `AGENTS.md` prohibits inline `/api/...` path literals outside client-owned route constants; new router/route modules should consume `API_ROUTES` rather than duplicate route strings.

### Risks

- Behavior drift in route matching.
  - Parameterized routes such as cancel, profile delete, events, run summary, run state, plans, and diff currently use prefix/slice logic. A registry matcher must preserve exact matching semantics, query handling, and invalid parameter responses.

- Stream snapshot parity drift.
  - `stream:hello` snapshots currently combine DB data, queue filesystem state, session metadata, auto-build state, stack layers, and sync status. Moving streams must keep REST routes and SSE snapshots using the same projection functions.

- Security regression.
  - Local-only mutation gates, same-origin checks, Fetch Metadata rejection, static path traversal checks, and symlink protections are safety-sensitive. Centralizing them reduces long-term risk but creates short-term migration risk.

- Compatibility export regression.
  - Tests and potential downstream consumers import from `@eforge-build/monitor/server`. Removing or moving exports without re-exporting would be a breaking change even if daemon behavior is otherwise unchanged.

- File-size migration risk.
  - A naive extraction can turn one oversized `server.ts` into several oversized feature route files. Large feature areas must be split into service/projection/validation submodules.

- Partial refactor risk.
  - If route modules keep ad hoc option bags and duplicated utility helpers, the migration will satisfy line limits without improving maintainability. The implementation should remove duplicated body parsing, path validation, response helpers, and route security logic.

- Test churn risk.
  - Many tests instantiate the real daemon with `startServer`. The migration should preserve that harness rather than force broad test rewrites.

- New router abstraction complexity.
  - A custom router can become a mini-framework if overbuilt. Keep it small: method, pattern, params, query, route metadata, and handler dispatch are enough.

### Assumptions and validation

- Assumption: the migration should preserve daemon HTTP and SSE behavior rather than change public API contracts.
  - Evidence / validation performed: user asked for long-term maintainability design; roadmap says daemon remains orchestration authority; no user requested API changes.
  - Confidence: high.
  - Cost to validate further: low.
  - Validation path: keep all existing route and stream tests passing; do not bump `DAEMON_API_VERSION`.
  - Impact if wrong: high, because accidental API drift would break clients and console UI.

- Assumption: `server.ts` must continue exporting `startServer`, `MonitorServer`, `WorkerTracker`, `DaemonState`, `StartServerOptions`, and `buildRunSummary`.
  - Evidence / validation performed: search found many tests importing `startServer` and `test/run-summary-plans.test.ts` importing `buildRunSummary` from `@eforge-build/monitor/server`; `packages/monitor/src/index.ts` re-exports `MonitorServer` from `./server.js`.
  - Confidence: high.
  - Cost to validate further: low.
  - Validation path: run `rg "from ['\"](@eforge-build/monitor/server|../server\.js|./server\.js)" test packages/monitor/src`.
  - Impact if wrong: medium, because this would cause compile/test failures and potential downstream breakage.

- Assumption: a third-party HTTP framework is unnecessary for this migration.
  - Evidence / validation performed: existing code already works on Node `http`; the maintainability issue is ownership, duplication, and file size.
  - Confidence: medium.
  - Cost to validate further: medium.
  - Validation path: compare minimal custom route registry complexity against Hono/Fastify migration cost before implementation if desired.
  - Impact if wrong: medium, because a poor custom router could become hard to maintain.

- Assumption: route registration coverage can be tested from `API_ROUTES`.
  - Evidence / validation performed: `packages/client/src/routes.ts` centralizes route constants; current server dispatch uses those constants for most API routes.
  - Confidence: high.
  - Cost to validate further: low.
  - Validation path: add a route registry test that enumerates registered route patterns and known fallback/special cases.
  - Impact if wrong: medium, because without coverage, future routes may be omitted silently.

- Assumption: stream hello snapshots can reuse extracted projections without changing shape.
  - Evidence / validation performed: existing `server.ts` already contains shared helper comments for queue and stack snapshots; `stream-hello-parity.test.ts` exists.
  - Confidence: high.
  - Cost to validate further: low.
  - Validation path: move projections first, run stream parity and handshake tests after each stream extraction.
  - Impact if wrong: high, because console state hydration could break.

- Assumption: new files can stay under maintainability ceilings if features are split by service/projection/route responsibilities.
  - Evidence / validation performed: current `server.ts` groups many large feature handlers; `AGENTS.md` provides explicit file-size policy.
  - Confidence: high.
  - Cost to validate further: low.
  - Validation path: run `pnpm maintainability:check`; inspect `wc -l packages/monitor/src/**/*.ts`.
  - Impact if wrong: medium, because this would cause line-limit failure or another oversized module.

- Assumption: no plugin or Pi extension version bump is needed.
  - Evidence / validation performed: this plan intentionally avoids CLI commands, MCP tools, skills, or user-facing integration behavior changes.
  - Confidence: medium.
  - Cost to validate further: low.
  - Validation path: re-evaluate if implementation changes consumer-facing behavior in `eforge-plugin/` or `packages/pi-eforge/`.
  - Impact if wrong: low to medium, only relevant if scope expands into integrations.

### Profile signal

Recommended profile: **Expedition**.

Rationale: this is a high-risk architecture migration across daemon routing, streams, security, projections, and tests. Although the desired behavior is cohesive and behavior-preserving, the implementation is large enough that delegated subplans are likely useful for safe sequencing: shared HTTP kernel/projections, stream extraction, route group migration, and regression coverage can be planned and validated as separate but coordinated modules. Use Expedition to get architecture planning plus subplan cohesion review rather than a single oversized implementation pass.

## Scope

Implement a behavior-preserving monitor daemon architecture migration for `packages/monitor/src/server.ts`.

In scope:

- Reduce `packages/monitor/src/server.ts` to a small composition root that owns server startup, shutdown, timer/resource cleanup, and public compatibility exports.
- Introduce shared HTTP primitives for routing, JSON body parsing, JSON responses, route errors, CORS preflight, static asset serving, route matching, and security policies.
- Introduce a typed monitor context shared by route modules, stream modules, and projection modules.
- Replace the current giant ordered `if` route chain with feature-owned route registration while preserving route paths from `API_ROUTES`.
- Move SSE session streaming, daemon-event streaming, event parsing, heartbeat construction, and subscriber lifecycle into stream-focused modules.
- Move response projection logic out of route handlers into reusable projection/service modules, especially run summary derivation, queue item projection, stack layer projection, config redaction, auto-build state projection, and plan/diff projections.
- Split feature route groups by durable ownership: control plane, monitor data, config/context, stack, models, profiles, extensions, playbooks, session plans, queue/recovery, resume/recovery.
- Preserve public exports currently used by tests and downstream imports from `@eforge-build/monitor/server`.
- Add or update tests that lock route registration coverage, stream snapshot parity, helper compatibility exports, and key security guard behavior.

Out of scope:

- Changing daemon HTTP API route names, request shapes, response shapes, SSE event shapes, or `DAEMON_API_VERSION`.
- Replacing Node's built-in HTTP server with a third-party framework.
- Changing monitor UI or console UI behavior beyond what is needed to preserve existing API contracts.
- Refactoring `packages/monitor/src/db.ts` storage schema or recorder semantics.
- Changing engine orchestration behavior, queue scheduling semantics, recovery semantics, or extension runtime behavior.
- Bumping plugin or Pi package versions; this is daemon-internal unless implementation uncovers user-facing integration changes.

Migration boundary:

- Prefer incremental extraction with compatibility re-exports over a big rewrite.
- Existing tests should continue to pass after each cohesive phase.

Documentation impact:

- Documentation updates are minimal because this is an internal architecture migration with no intended user-facing daemon API changes.
- `docs/llm-friendly-code.md` should be consulted but probably does not need content changes unless the implementation discovers that monitor-specific guidance should be documented.
- `docs/roadmap.md` does not need a new roadmap item; this work supports existing daemon maturity and console workbench goals rather than adding a new future feature.
- Public user docs should not change if HTTP routes, CLI/MCP/Pi behavior, SSE payloads, and console UI behavior are preserved.
- If the implementation introduces a reusable internal router convention, add a short developer-facing comment or README near `packages/monitor/src/http/router.ts` only if the route definition API is not self-explanatory.
- Do not add broad public docs for monitor internals unless new public APIs are introduced.

## Acceptance Criteria

- `packages/monitor/src/server.ts` is at most 400 lines after the migration.
- `packages/monitor/src/server.ts` exports `startServer`.
- `packages/monitor/src/server.ts` exports the `MonitorServer` type.
- `packages/monitor/src/server.ts` exports the `WorkerTracker` type.
- `packages/monitor/src/server.ts` exports the `DaemonState` type.
- `packages/monitor/src/server.ts` exports the `StartServerOptions` type.
- `packages/monitor/src/server.ts` exports or re-exports `buildRunSummary` from a projection module.
- Every new implementation file under `packages/monitor/src` is at most 600 lines.
- Every `packages/monitor/src` file over 300 lines has balanced durable `eforge:region` and `eforge:endregion` markers.
- The monitor daemon route registry contains an entry for every daemon route in `API_ROUTES` that is served by the monitor daemon.
- Route registration uses `API_ROUTES` values instead of hard-coded `/api/...` endpoint strings in monitor route modules.
- `rg "function parseJsonBody|const parseJsonBody" packages/monitor/src --glob '!**/__tests__/**'` reports exactly one implementation in the shared HTTP request module.
- The session SSE `stream:hello` snapshot shape is unchanged for existing session stream tests.
- The daemon SSE `stream:hello` snapshot shape is unchanged for existing daemon stream parity tests.
- The queue REST response and daemon stream queue snapshot are produced by the same queue projection module.
- The stack layers REST response and daemon stream stack layer snapshot are produced by the same stack projection module.
- Local-only mutation routes still reject non-loopback requests.
- Cross-site browser requests to sensitive read or mutation routes still return HTTP 403.
- Static UI serving still rejects path traversal attempts.
- Static UI serving still rejects symlink escapes from the configured UI root.
- `test/run-summary-plans.test.ts` passes without changing its import from `@eforge-build/monitor/server`.
- `pnpm type-check` exits 0.
- `pnpm test` exits 0.
- `pnpm maintainability:check` exits 0.
