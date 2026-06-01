---
id: plan-06-control-monitor-routes
name: Create registered route modules for control-plane, recovery/resume, queue
  recovery, monitor data, run details, plans, diffs, and SSE attach routes.
branch: migrate-monitor-server-to-a-maintainable-architecture/control-monitor-routes
---

# Control Monitor Routes

## Architecture Reference

This module implements the architecture sections **Route ownership matrix / `control-monitor-routes`**, **HTTP route contract**, **Security contract**, **StreamHub contract**, and the projection reuse requirements for queue, run summary, run state, plans, diffs, auto-build, and event hydration from `eforge/plans/migrate-monitor-server-to-a-maintainable-architecture/architecture.md`.

Key constraints from architecture:
- Route definitions use `API_ROUTES` keys and values from `@eforge-build/client`; monitor route modules do not embed endpoint literals such as `/api/...`.
- Feature route modules export route factories only. `packages/monitor/src/routes/index.ts` and `packages/monitor/src/server.ts` remain owned by `server-composition-coverage`.
- Handlers use shared HTTP primitives from `packages/monitor/src/http/` for JSON parsing, JSON/text responses, route definitions, and security policies.
- Route modules consume `MonitorContext` from `packages/monitor/src/context.ts` and do not introduce broad ad hoc option bags for DB, paths, worker tracker, daemon state, or config.
- Session and daemon SSE routes delegate attachment to `StreamHub`; route handlers do not own subscriber sets, replay, polling, or heartbeat logic.
- REST routes use projection modules from `packages/monitor/src/projections/` so queue, run, plan, diff, auto-build, and stream snapshot shapes cannot drift after final wiring.
- Existing legacy extracted files (`queue-recovery-routes.ts` and `resume-eligibility-route.ts`) remain untouched in this module because `server.ts` still imports them until final composition.

## Scope

### In Scope

- Create registered route modules for the control and monitor-data route keys owned by this module:
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
- Add a module-owned route aggregator that final composition can import without editing `packages/monitor/src/routes/index.ts` in this module.
- Preserve current status codes, JSON/text error bodies, worker command names, worker argument ordering, and response bodies for the migrated route handlers.
- Replace the legacy queue recovery and resume eligibility ad hoc handler patterns with registry-based route modules while leaving the old files in place for the current `server.ts`.
- Keep the public `MonitorServer.onKeepAlive` behavior available through a narrow route-runtime object that final composition can wire into the server handle.
- Delegate SSE attach routes to `ctx.streams.attachSession()` and `ctx.streams.attachDaemon()`.
- Delegate queue REST projection to `projections/queue-items.ts`.
- Delegate run summary, run state, plans, and diff responses to the projection modules created by `projections-read-models`.
- Delegate auto-build response and scheduler-capacity shaping to `projections/auto-build-state.ts`.
- Add direct route-module tests using the shared router, real SQLite DB fixtures, real temp filesystem fixtures, and real stream hub where SSE behavior is under test.

### Out of Scope

- No edits to `packages/monitor/src/server.ts`.
- No edits to `packages/monitor/src/routes/index.ts`.
- No edits to `packages/monitor/src/queue-recovery-routes.ts` or `packages/monitor/src/resume-eligibility-route.ts`; final stale-file removal belongs to `server-composition-coverage`.
- No changes to daemon route paths, HTTP methods, request body shapes, response body shapes, SSE frame shapes, or `DAEMON_API_VERSION`.
- No changes to `packages/client/src/routes.ts` or client-owned wire interfaces.
- No changes to stream polling, heartbeat intervals, semantic daemon-event reactions, or subscriber lifecycle beyond route attachment.
- No profile, config, model, stack, extension, playbook, session-plan, or session-plan-set route migration.
- No monitor UI, Console UI, CLI, Claude plugin, or Pi extension changes.
- No public documentation changes.

## Implementation Approach

### Overview

Add registry-based route factories under `packages/monitor/src/routes/` that copy the current control-plane, recovery, queue recovery, monitor-data, run-detail, and SSE attachment behavior from `server.ts`. The new route modules compile and are tested directly, while the current daemon continues serving requests through the existing ordered dispatch chain until `server-composition-coverage` wires the final router.

Recommended implementation order:

1. Add route-local helpers for validation, JSON-object parsing, worker/daemon accessors, safe path segments, and legacy text error responses.
2. Add a small control-route runtime for the keep-alive callback cell.
3. Move enqueue request preparation and session-plan auto-submit logic into an enqueue service.
4. Create control-plane route definitions for keep-alive, enqueue, cancel, daemon stop, auto-build get/set, and scheduler kick.
5. Create recovery and resume services, then route definitions for recover, read sidecar, apply recovery, resume build, and resume eligibility.
6. Create queue recovery route definitions using shared JSON parsing and context-derived queue paths.
7. Create monitor-data and run-detail route definitions that call projection modules.
8. Create SSE attach route definitions that call the stream hub.
9. Add the module-level route aggregator and direct route tests.
10. Run type-check, focused tests, maintainability checks, and source greps for duplicate JSON parsers and hard-coded route literals.

### Key Decisions

1. **Keep `server.ts` untouched in this module.**
   - Rationale: final route wiring, compatibility re-exports, timer cleanup, and deletion of server-local handlers belong to `server-composition-coverage`, avoiding concurrent edits to the 4,924-line file.

2. **Use a narrow `ControlMonitorRuntime` for keep-alive instead of editing `MonitorContext`.**
   - Rationale: `MonitorServer.onKeepAlive` is a mutable server-handle callback, not project/runtime context. A route-runtime object lets final composition expose the getter/setter while all durable dependencies still come from `MonitorContext`.

3. **Keep route factories context-based, with only the keep-alive runtime as a named exception.**
   - Rationale: queue paths, DB access, worker tracker, daemon state, config, session resolution, scheduler capacity, and queue mutation notifications all come from `MonitorContext`. The runtime exception is limited to `keepAlive` and is not a general option bag.

4. **Replace legacy extracted route files by new registry modules, but do not delete or mutate the legacy files.**
   - Rationale: the current `server.ts` still imports `queue-recovery-routes.ts` and `resume-eligibility-route.ts`. Final composition removes stale imports and files after the router is wired.

5. **Preserve route-specific error formats.**
   - Rationale: existing invalid parameter cases mix JSON and plain-text responses. The new handlers use shared response helpers but keep the current body and content type for each route, for example plain text `Invalid runId` for session stream and plans parameter failures, and JSON `{ error }` for diff and cancel failures.

6. **Use shared projections for read models.**
   - Rationale: `GET /api/queue`, daemon `stream:hello.queue`, `GET /api/run-summary/:id`, `GET /api/run-state/:id`, `GET /api/plans/:runId`, and `GET /api/diff/:sessionId/:planId` must use the same projection modules as streams and direct projection tests.

7. **Use stream hub attachment for SSE routes only.**
   - Rationale: route modules own method/path/parameter validation; `StreamHub` owns SSE headers, hello snapshots, replay, polling, heartbeats, and cleanup.

8. **Security policies mirror current local/same-origin gates and add Fetch Metadata where the shared `localMutation` policy defines it.**
   - Rationale: recover, apply recovery, resume build, resume eligibility, recovery sidecar reads, and queue recovery apply are sensitive routes. Their route definitions declare security policies instead of embedding Host/Origin/Fetch Metadata checks inside handlers.

9. **Keep queue recovery analysis ungated unless existing tests or final security review require a gate.**
   - Rationale: the current extracted `queueRecoveryAnalyze` handler has no local-only guard. Adding one in this migration would change status codes for remote callers. `queueRecoveryApply` remains a guarded mutation.

10. **Map `RequestBodyTooLargeError` per legacy route behavior.**
    - Rationale: queue recovery already distinguishes body-too-large with HTTP 413. Older inline handlers catch all JSON/body parsing failures as HTTP 400. Route helpers keep those mappings unless an existing test has a stronger assertion.

## Files

### Create

- `packages/monitor/src/routes/control-monitor.ts` — module-owned route aggregator.
  - Export `CONTROL_MONITOR_ROUTE_KEYS` containing the 23 route keys owned by this module.
  - Export `createControlMonitorRoutes(context: MonitorContext, runtime?: ControlMonitorRuntime): RouteDefinition[]`.
  - Concatenate `createControlPlaneRoutes`, `createRecoveryRoutes`, `createResumeRoutes`, `createQueueRecoveryRoutes`, `createMonitorDataRoutes`, `createRunDetailRoutes`, and `createStreamAttachRoutes`.
  - Export no final router wiring.

- `packages/monitor/src/routes/control-runtime.ts` — keep-alive callback cell for final server composition.
  - Export `ControlMonitorRuntime` with `getOnKeepAlive()`, `setOnKeepAlive(cb)`, and `notifyKeepAlive()`.
  - Export `createControlMonitorRuntime()`.
  - `notifyKeepAlive()` calls the current callback when non-null and returns without throwing when no callback is registered.

- `packages/monitor/src/routes/control-validation.ts` — shared validators and parse helpers for this module.
  - Export `isPlainObject(value)`.
  - Export `isValidPathSegment(value)` with the current path-segment rule: non-empty, no `/`, no `\\`, no `..`, no NUL.
  - Export `isSafeRouteId(value)` with the current `/^[\w-]+$/` rule.
  - Export `assertWithinDir(resolvedPath, baseDir)` or `isWithinDir(resolvedPath, baseDir)` using the current containment semantics.
  - Export JSON object parse helpers that call shared `parseJsonBody` from `http/request.ts` and return route-level failure data instead of defining another parser.
  - Export a helper for legacy plain-text parameter failures that calls `sendText(res, 400, message)`.

- `packages/monitor/src/routes/enqueue-service.ts` — enqueue request preparation and session-plan auto-submit service.
  - Export `prepareEnqueueRequest(context, body)` that validates `source`, rejects `onSuccess`, validates `landingAction`, validates `landingAutoMerge`, validates `afterQueueId`, validates explicit and inherited profile names, normalizes session-plan sources for prevalidation, and returns worker args.
  - Export `markSessionPlanSubmittedAfterEnqueue(context, source, eforgeSessionId)` that preserves the current `.eforge/session-plans/*.md` containment check, session-id regex, input-layer load/update/write flow, and stderr-only failure logging.
  - Use lazy imports for `@eforge-build/engine/config`, `@eforge-build/engine/prd-queue`, and `@eforge-build/input` as the current handler does.
  - Throw `HttpRouteError` or return a typed validation failure for route-level status/message mapping; do not write HTTP responses from deep helpers.

- `packages/monitor/src/routes/control-plane.ts` — keep-alive, enqueue, cancel, daemon stop, auto-build, and scheduler routes.
  - Register `keepAlive`, `enqueue`, `cancel`, `daemonStop`, `autoBuildGet`, `autoBuildSet`, and `schedulerKick` with `API_ROUTES` values.
  - `keepAlive` calls `runtime.notifyKeepAlive()` and returns `{ status: 'ok' }`.
  - `enqueue` checks daemon mode, checks configured agent tiers, parses JSON with the shared parser, calls `prepareEnqueueRequest`, spawns `workerTracker.spawnWorker('enqueue', args)`, calls `markSessionPlanSubmittedAfterEnqueue`, and returns `{ sessionId, pid, autoBuild }`.
  - `cancel` validates `ctx.params.sessionId` with `isSafeRouteId`, calls `workerTracker.cancelWorker(sessionId)`, and preserves 503/400/404/200 responses.
  - `daemonStop` parses `{ force?: boolean }`, returns `{ status: 'stopping', force }`, and schedules `daemonState.onShutdown` with `setImmediate` after responding.
  - `autoBuildGet` returns the projected auto-build state with capacity from `context.getRunningBuildCount()` and `context.getSchedulerLimit()`.
  - `autoBuildSet` validates `enabled` as boolean, calls controller `enable('http enable')` or `disable('http disable')`, and returns the projected auto-build state.
  - `schedulerKick` calls `context.notifyQueueMutation('external')` and returns `{ ok: true }`.

- `packages/monitor/src/routes/recovery-sidecar-service.ts` — recovery sidecar read and apply-sidecar validation helpers.
  - Export `readRecoverySidecar(context, prdId)` returning `{ markdown, json }` from `<failedDir>/<prdId>.recovery.md` and `<failedDir>/<prdId>.recovery.json`.
  - Export `readRecoveryVerdictForApply(context, prdId)` that preserves the current missing-file, unreadable-file, malformed-JSON, missing-verdict, and invalid-verdict error messages.
  - Use context-derived queue paths for the failed PRD directory.
  - Verify resolved markdown and JSON paths stay within the failed PRD directory before reading.

- `packages/monitor/src/routes/recovery.ts` — recover, recovery sidecar read, and apply recovery route definitions.
  - Register `recover`, `readRecoverySidecar`, and `applyRecovery` with `API_ROUTES` values.
  - Declare local/cross-site security policies for all three routes using operation labels `Recovery analysis`, `Recovery sidecar reads`, and `Recovery apply`.
  - `recover` validates `setName` and `prdId`, calls `workerTracker.spawnWorker('recover', [setName, prdId])`, and returns `{ sessionId, pid }`.
  - `readRecoverySidecar` validates query param `prdId`, calls `readRecoverySidecar`, returns `ReadSidecarResponse`, maps missing sidecar files to 404, and maps malformed sidecar JSON to 500 with the current message.
  - `applyRecovery` validates `prdId`, requires daemon state and cwd, reads the sidecar verdict, calls `applyRecoveryRetry`, `applyRecoverySplit`, `applyRecoveryAbandon`, or `applyRecoveryManual`, calls `context.notifyQueueMutation('apply-recovery')`, and returns `ApplyRecoveryResponse`.

- `packages/monitor/src/routes/resume-service.ts` — resume build and resume eligibility service helpers.
  - Export `prepareResumeBuildArgs(context, body)` that validates `prdId`, optional `setName`, optional `profile`, and profile existence, then returns worker args for `workerTracker.spawnWorker('resume', args)`.
  - Export `buildResumeEligibility(context, prdId, setNameParam)` that preserves the current `resolveResumeSetName`, `projectResumeEligibility`, `computeWorktreeBase`, output-dir selection, db path, trunk branch, and relative `checkedPath` behavior.
  - Use lazy imports for engine config helpers when validating profile overrides.

- `packages/monitor/src/routes/resume.ts` — resume build and resume eligibility route definitions.
  - Register `resumeBuild` and `resumeEligibility` with `API_ROUTES` values.
  - Declare local/cross-site security policies with operation labels `Resume build` and `Resume eligibility checks`.
  - `resumeBuild` rejects non-object JSON with `Invalid request body: must be a JSON object`, validates fields through `prepareResumeBuildArgs`, spawns `workerTracker.spawnWorker('resume', args)`, and returns `{ sessionId, pid }`.
  - `resumeEligibility` validates query params `prdId` and optional `setName`, calls `buildResumeEligibility`, and returns `ResumeEligibilityResponse`.

- `packages/monitor/src/routes/queue-recovery.ts` — registry-based queue recovery routes.
  - Register `queueRecoveryAnalyze` and `queueRecoveryApply` with `API_ROUTES` values.
  - Use shared `parseJsonBody`; do not define `parseJsonBody` or `RequestBodyTooLargeError` locally.
  - Preserve current validation messages for `selectedPrdId`, `strategy`, and `expectedOperations`.
  - `queueRecoveryAnalyze` requires `context.cwd`, calls `analyzeQueueRecovery`, and returns the client-owned response type.
  - `queueRecoveryApply` declares `localMutation('Queue recovery mutations')`, requires daemon state and cwd, calls `applyQueueRecovery`, calls `context.notifyQueueMutation('apply-recovery')` when at least one operation result is `applied`, and returns the client-owned response type.

- `packages/monitor/src/routes/monitor-data.ts` — queue, session metadata, and runs route definitions.
  - Register `queue`, `sessionMetadata`, and `runs` with `API_ROUTES` values.
  - `queue` returns `[]` when `context.cwd` is absent; otherwise calls `loadQueueItems(context.queuePaths.queueDir, context.queuePaths.lockDir)`.
  - `sessionMetadata` returns `context.db.getSessionMetadataBatch()`.
  - `runs` returns `context.db.getRuns()`.

- `packages/monitor/src/routes/run-details.ts` — run summary, run state, plans, and diff route definitions.
  - Register `runSummary`, `runState`, `plans`, and `diff` with `API_ROUTES` values.
  - Validate `id`, `runId`, `sessionId`, and `planId` with `isSafeRouteId` before calling projections.
  - `runSummary` resolves run IDs through `context.resolveSessionId(id)` and returns `buildRunSummary(context.db, sessionId)`.
  - `runState` resolves run IDs and returns `buildRunState(context.db, sessionId)`.
  - `plans` resolves run IDs and returns `await buildPlansResponse({ db: context.db, sessionId, planOutputDir: context.planOutputDir })`.
  - `diff` resolves the session ID, reads optional `file` from `ctx.query`, and returns `buildDiffResponse(context.db, sessionId, planId, file)`.
  - Preserve current error response formats: plain text for invalid `id`/`runId`, JSON `{ error: 'Invalid sessionId or planId' }` for invalid diff route params.

- `packages/monitor/src/routes/stream-attach.ts` — SSE attach route definitions.
  - Register `events` and `daemonEvents` with `API_ROUTES` values.
  - `events` validates `ctx.params.runId` with `isSafeRouteId`, writes plain text `Invalid runId` on failure, and otherwise calls `ctx.streams.attachSession(ctx.req, ctx.res, runId)`.
  - `daemonEvents` calls `ctx.streams.attachDaemon(ctx.req, ctx.res)`.
  - Do not write SSE headers or frames in this module.

- `packages/monitor/src/__tests__/routes-control-harness.ts` — test-only route harness for this module.
  - Create a small Node HTTP server around `createRouter` with real `MonitorContext`, real `MonitorDB`, temp cwd support, a `ControlMonitorRuntime`, and either an inert `MonitorStreamHub` or a real `createStreamHub(context)` when SSE assertions require it.
  - Expose helpers for JSON requests, raw text requests, route URL construction with `buildPath`, and server cleanup.

- `packages/monitor/src/__tests__/routes-control-registration.test.ts` — route registration coverage for this module.
  - Assert registered route keys exactly equal `CONTROL_MONITOR_ROUTE_KEYS`.
  - Assert every route definition's `pattern` equals `API_ROUTES[route.routeKey]`.
  - Assert route keys are unique.
  - Assert `autoBuildGet` and `autoBuildSet` share the same pattern and use `GET`/`POST` respectively.
  - Assert `events`, `runSummary`, `runState`, `plans`, `diff`, and `cancel` use parameterized `API_ROUTES` patterns rather than local prefix constants.
  - Assert sensitive recovery/resume/apply/queue-recovery-apply routes declare security policies.

- `packages/monitor/src/__tests__/routes-control-plane.test.ts` — direct tests for control-plane route behavior.
  - Assert `POST keepAlive` returns `{ status: 'ok' }` and increments a callback counter registered in `ControlMonitorRuntime`.
  - Assert `POST enqueue` returns 503 without a worker tracker.
  - Assert `POST enqueue` returns 422 when configured agent tiers are absent.
  - Assert `POST enqueue` returns 400 for invalid JSON, missing `source`, legacy `onSuccess`, invalid `landingAction`, invalid `landingAutoMerge`, non-string `afterQueueId`, and missing explicit profile.
  - Assert a valid enqueue spawns command `enqueue` with source, flags, profile, landing, auto-merge, and `--after` args in the current order.
  - Assert `POST cancel` returns 400 for invalid `sessionId`, 404 for an unknown active worker, and `{ status: 'cancelled', sessionId }` for a cancelled worker.
  - Assert auto-build get/set and scheduler kick call the fake controller methods and queue mutation callback with the current reason strings.
  - Assert daemon stop returns 503 without daemon state, 500 without shutdown handler, and `{ status: 'stopping', force }` before invoking shutdown.

- `packages/monitor/src/__tests__/routes-recovery.test.ts` — direct tests for recovery, sidecar, apply, resume, and eligibility routes.
  - Assert local-only and Fetch Metadata policies return HTTP 403 for non-loopback Host, cross-origin Origin, and `Sec-Fetch-Site: cross-site` on sensitive recovery routes.
  - Assert recover route validation messages for missing/unsafe `setName` and `prdId` match the current messages.
  - Assert valid recover route calls worker command `recover` with `[setName, prdId]` and returns `{ sessionId, pid }`.
  - Assert sidecar read returns 400 for missing/unsafe `prdId`, 404 when either sidecar file is absent, and `{ markdown, json }` for valid fixture files.
  - Assert apply recovery returns 503 without daemon state, 503 without cwd, 400 for missing/unsafe `prdId`, 404 for missing recovery JSON, 400 for malformed JSON, 400 for missing verdict, and 400 for invalid verdict schema.
  - Assert resume build returns 400 for null JSON, missing `prdId`, unsafe `prdId`, unsafe `setName`, invalid profile value, and missing profile file.
  - Assert valid resume build calls worker command `resume` with `prdId`, optional `--set-name`, and optional `--profile` in the current order.
  - Assert resume eligibility returns 400 for missing/unsafe query params and returns the same ineligible/eligible projection fields as `projectResumeEligibility` for temp fixtures.

- `packages/monitor/src/__tests__/routes-queue-recovery.test.ts` — direct tests for queue recovery route modules.
  - Assert analyze returns 400 for invalid request object, missing/unsafe `selectedPrdId`, and non-string `strategy`.
  - Assert analyze returns 503 without `cwd`.
  - Assert apply returns 403 for non-local or cross-site browser requests, 503 without daemon state, 503 without `cwd`, 400 for missing/invalid `expectedOperations`, and a client-owned apply response for a real temp queue fixture.
  - Assert apply calls `context.notifyQueueMutation('apply-recovery')` only when at least one operation result has status `applied`.
  - Assert queue recovery body-too-large maps to HTTP 413 with `{ error: 'Request body too large' }`.

- `packages/monitor/src/__tests__/routes-monitor-data.test.ts` — direct tests for queue, runs, session metadata, and stream attach routes.
  - Assert `GET queue` returns `[]` without `cwd`.
  - Assert `GET queue` returns the same array as `loadQueueItems(context.queuePaths.queueDir, context.queuePaths.lockDir)` for a temp queue with pending, running, failed, skipped, waiting, dependencies, and recovery sidecar fixtures.
  - Assert `GET runs` returns `context.db.getRuns()` for seeded DB rows.
  - Assert `GET sessionMetadata` returns `context.db.getSessionMetadataBatch()` for seeded metadata.
  - Assert `GET events` with an invalid route id returns HTTP 400 text `Invalid runId`.
  - Assert `GET events` with a seeded running session writes a `stream:hello` block as the first SSE block through `StreamHub`.
  - Assert `GET daemonEvents` writes a daemon `stream:hello` block as the first SSE block through `StreamHub`.

- `packages/monitor/src/__tests__/routes-run-details.test.ts` — direct tests for run detail route modules.
  - Assert invalid `runSummary`, `runState`, and `plans` params return HTTP 400 plain text with the current messages.
  - Assert `runSummary` response equals `buildRunSummary(context.db, resolvedSessionId)` for seeded runs/events.
  - Assert `runState` response equals `buildRunState(context.db, resolvedSessionId)` for seeded runs/events, including skipped malformed rows.
  - Assert `plans` response equals `buildPlansResponse(...)` for a temp plan output fixture and a run-id-to-session-id lookup.
  - Assert `diff` returns JSON 400 for invalid `sessionId` or `planId`.
  - Assert `diff` without `file` returns the projection bulk response and `diff?file=...` returns the projection single-file response.

### Modify

- None.

This module intentionally avoids all shared files listed in the architecture Shared File Registry. No `[region: control-monitor-routes, ...]` shared-file edit annotations are required. If implementation discovers that editing `server.ts`, `routes/index.ts`, `context.ts`, `types.ts`, `queue-recovery-routes.ts`, or `resume-eligibility-route.ts` is unavoidable, stop and revise this plan before coding.

## Implementation Details

### Route factory conventions

Every route factory uses the foundation router contract and ties `routeKey` to the matching client-owned route constant:

```ts
export function createMonitorDataRoutes(context: MonitorContext): RouteDefinition[] {
  return [
    defineRoute({
      routeKey: 'runs',
      method: 'GET',
      pattern: API_ROUTES.runs,
      handler: (ctx) => sendJson(ctx.res, context.db.getRuns()),
    }),
  ];
}
```

Handlers may read `ctx.monitor` instead of the closed-over `context`, but exported factories keep a context-based signature. The only extra runtime parameter is `ControlMonitorRuntime`, used by `keepAlive` and final `MonitorServer.onKeepAlive` wiring.

### Route key list

`CONTROL_MONITOR_ROUTE_KEYS` must contain exactly:

```ts
[
  'keepAlive',
  'enqueue',
  'cancel',
  'daemonStop',
  'autoBuildGet',
  'autoBuildSet',
  'schedulerKick',
  'recover',
  'readRecoverySidecar',
  'applyRecovery',
  'resumeBuild',
  'resumeEligibility',
  'queueRecoveryAnalyze',
  'queueRecoveryApply',
  'queue',
  'sessionMetadata',
  'runs',
  'events',
  'daemonEvents',
  'runSummary',
  'runState',
  'plans',
  'diff',
] as const
```

### Body parsing

Use `parseJsonBody` from `packages/monitor/src/http/request.ts` directly. Do not add another function or constant named `parseJsonBody` in route modules.

Route-level parse error mapping:

- `enqueue`, `recover`, `applyRecovery`, `daemonStop`, and `autoBuildSet`: HTTP 400 `{ error: 'Invalid JSON body' }` for parse failures, matching the current inline handlers.
- `resumeBuild`: HTTP 400 `{ error: 'Invalid JSON body' }` for parse failures and HTTP 400 `{ error: 'Invalid request body: must be a JSON object' }` for `null`, arrays, or scalar JSON.
- `queueRecoveryAnalyze` and `queueRecoveryApply`: HTTP 413 `{ error: 'Request body too large' }` for `RequestBodyTooLargeError`, HTTP 400 `{ error: 'Invalid JSON body' }` for JSON parse failures, and HTTP 400 `{ error: 'Invalid request body: must be a JSON object' }` for non-object JSON.
- `daemonStop`: `force` is true only when the parsed field is exactly `true`; all other values produce `false` after a valid JSON parse, matching the current handler.

### Security policies

Use security policy factories from `packages/monitor/src/http/security.ts` rather than route-local Host/Origin/Fetch Metadata checks.

Policy labels:

- `recover`: `localMutation('Recovery analysis')`.
- `readRecoverySidecar`: combine local-only and cross-site rejection with operation label `Recovery sidecar reads`.
- `applyRecovery`: `localMutation('Recovery apply')`.
- `resumeBuild`: `localMutation('Resume build')`.
- `resumeEligibility`: combine local-only and cross-site rejection with operation label `Resume eligibility checks`.
- `queueRecoveryApply`: `localMutation('Queue recovery mutations')`.

Do not add security policies to `enqueue`, `cancel`, `daemonStop`, `autoBuildSet`, `schedulerKick`, or `queueRecoveryAnalyze` in this module unless an existing test already asserts a 403 for that route. Adding new gates to those routes would change existing daemon behavior.

### Enqueue details

Preserve the current enqueue behavior:

- Reject missing worker tracker with 503 `Daemon mode not active`.
- Reject absent configured agent tiers with 422 and the current tier-configuration message.
- Reject missing `source` with 400 `Missing required field: source`.
- Reject legacy `onSuccess` with the current migration message.
- Validate `landingAction` against `pr`, `merge`, and `leave`.
- Validate `landingAutoMerge` as boolean when present.
- When `landingAutoMerge === true` and `cwd` exists, load project config and reject if the effective landing action is not `pr` or `landing.pr.autoMerge` is `never`.
- Validate `afterQueueId` with `classifyAfterQueueId` when `cwd` exists.
- Validate explicit profile and inherited `agent_profile` through `loadProfile`.
- Pre-parse filesystem sources through `normalizeBuildSource` only when the resolved source is a readable file.
- Spawn command `enqueue` with source, flags, effective `--profile`, landing flags, auto-merge flag, and `--after` in the current order.
- Return `autoBuild: autoBuildStateToWire(...).enabled`.
- Mark local session-plan file sources as submitted after successful spawn and log failures to stderr without changing the HTTP response.

### Recovery details

Preserve current recovery behavior:

- `recover` spawns a detached worker and returns the worker identifiers.
- `readRecoverySidecar` reads both markdown and JSON sidecar files before responding; if either read fails, return 404 `Recovery sidecar not found`.
- `readRecoverySidecar` returns HTTP 500 `Recovery sidecar JSON is malformed for prdId: ${prdId}` when JSON parsing fails after both files were read.
- `applyRecovery` runs recovery apply helpers synchronously in-process and returns the resulting verdict response.
- `applyRecovery` calls `context.notifyQueueMutation('apply-recovery')` after successful helper execution, including manual no-op responses, matching the current handler.

### Resume details

Preserve current resume behavior:

- `resumeBuild` requires a worker tracker and never requires daemon state.
- `resumeBuild` validates profile overrides before spawning the worker.
- `resumeEligibility` does not require a worker tracker.
- `resumeEligibility` computes `setName` from the failed sidecar when omitted, otherwise uses the provided value.
- `resumeEligibility` returns `checkedPath` relative to `cwd` only when the projection includes a checked path.

### Queue and stream parity

- `GET queue` and daemon `stream:hello.queue` must both call `projections/queue-items.ts` after final wiring.
- `GET daemonEvents` must not build snapshots in route code; it calls `ctx.streams.attachDaemon`.
- `GET events` must not resolve session IDs in route code; `StreamHub.attachSession` resolves run IDs through `MonitorContext`, matching the stream-hub contract.

### Run detail projections

Route handlers only validate path/query inputs and call projections:

- `runSummary` -> `buildRunSummary`.
- `runState` -> `buildRunState`.
- `plans` -> `buildPlansResponse`.
- `diff` -> `buildDiffResponse`.

Do not copy event hydration, plan file loading, or diff mapping logic into route modules.

## Testing Strategy

### Unit Tests

- Route metadata tests for `CONTROL_MONITOR_ROUTE_KEYS`, method/pattern matching, duplicate keys, and security policy presence on sensitive routes.
- Helper tests for `isValidPathSegment`, `isSafeRouteId`, `isWithinDir`, JSON-object parse result mapping, and legacy text error responses if those helpers contain branching.
- Enqueue service tests for landing action, auto-merge, after-queue, profile, inherited profile, and session-plan auto-submit behavior using temp projects and real engine helpers.
- Recovery sidecar service tests for containment, missing files, malformed JSON, missing verdict, invalid verdict schema, and valid markdown/JSON fixtures.
- Resume service tests for profile validation and eligibility projection shaping.
- Queue recovery validation tests for selected PRD ID, strategy, expected operations, and body-too-large mapping.

### Integration Tests

- Direct HTTP tests against `createRouter` plus `createControlMonitorRoutes` for control-plane, recovery, queue recovery, monitor-data, run-detail, and SSE attach routes.
- Direct SSE attach tests with a real `createStreamHub(context)` to assert `stream:hello` is the first SSE block for `events` and `daemonEvents` route definitions.
- Existing `startServer` tests remain unchanged in this module because `server.ts` is not wired to the new route modules yet. After final composition, these existing tests become the behavior gate for the migrated routes:
  - `packages/monitor/src/__tests__/auto-build-route.test.ts`
  - `packages/monitor/src/__tests__/resume-plans-route.test.ts`
  - `packages/monitor/src/__tests__/runs-roundtrip.test.ts`
  - `packages/monitor/src/__tests__/session-sse-handshake.test.ts`
  - `packages/monitor/src/__tests__/daemon-sse-handshake.test.ts`
  - `packages/monitor/src/__tests__/stream-hello-parity.test.ts`
  - `test/daemon-recovery.test.ts`
  - `test/apply-recovery-route.test.ts`
  - `test/resume-build-route.test.ts`
  - `test/resume-eligibility-route.test.ts`
  - `test/queue-recovery-route.test.ts`
  - `test/serve-queue-depends-on-filter.test.ts`
  - `test/serve-queue-recovery-verdict.test.ts`
  - `test/daemon-enqueue-after-queue-id.test.ts`
  - `test/daemon-session-plan-routes.test.ts`
  - `test/playbook-api.test.ts` enqueue sections
  - `test/daemon-events-stream.test.ts`

## Verification

- [ ] `packages/monitor/src/routes/control-monitor.ts` exports `CONTROL_MONITOR_ROUTE_KEYS` with 23 entries.
- [ ] `packages/monitor/src/routes/control-monitor.ts` exports `createControlMonitorRoutes(context, runtime?)`.
- [ ] `createControlMonitorRoutes(context, runtime)` returns one route definition for every key in `CONTROL_MONITOR_ROUTE_KEYS`.
- [ ] Every returned route definition has `pattern === API_ROUTES[route.routeKey]`.
- [ ] `rg "['\"]\/api\/" packages/monitor/src/routes/control-monitor.ts packages/monitor/src/routes/control-plane.ts packages/monitor/src/routes/recovery.ts packages/monitor/src/routes/resume.ts packages/monitor/src/routes/queue-recovery.ts packages/monitor/src/routes/monitor-data.ts packages/monitor/src/routes/run-details.ts packages/monitor/src/routes/stream-attach.ts` returns zero lines.
- [ ] `rg "function parseJsonBody|const parseJsonBody" packages/monitor/src/routes/control-monitor.ts packages/monitor/src/routes/control-plane.ts packages/monitor/src/routes/recovery.ts packages/monitor/src/routes/resume.ts packages/monitor/src/routes/queue-recovery.ts packages/monitor/src/routes/monitor-data.ts packages/monitor/src/routes/run-details.ts packages/monitor/src/routes/stream-attach.ts packages/monitor/src/routes/control-validation.ts packages/monitor/src/routes/enqueue-service.ts packages/monitor/src/routes/recovery-sidecar-service.ts packages/monitor/src/routes/resume-service.ts` returns zero lines.
- [ ] `rg "function parseJsonBody|const parseJsonBody" packages/monitor/src/http/request.ts` reports exactly one line.
- [ ] `git diff -- packages/monitor/src/server.ts packages/monitor/src/routes/index.ts packages/monitor/src/queue-recovery-routes.ts packages/monitor/src/resume-eligibility-route.ts` produces no diff for this module.
- [ ] Route definitions for `queue`, `sessionMetadata`, `runs`, `runSummary`, `runState`, `plans`, `diff`, `events`, and `daemonEvents` use method `GET`.
- [ ] `POST` route definitions for `enqueue`, `cancel`, `daemonStop`, `autoBuildSet`, `schedulerKick`, `recover`, `applyRecovery`, `resumeBuild`, `queueRecoveryAnalyze`, and `queueRecoveryApply` use method `POST`.
- [ ] `autoBuildGet` and `autoBuildSet` share `API_ROUTES.autoBuildGet`/`API_ROUTES.autoBuildSet` pattern value and differ by method.
- [ ] `events` route handler calls `ctx.streams.attachSession(ctx.req, ctx.res, runId)` after route-id validation.
- [ ] `daemonEvents` route handler calls `ctx.streams.attachDaemon(ctx.req, ctx.res)`.
- [ ] `queue` route handler imports and calls `loadQueueItems` from `packages/monitor/src/projections/queue-items.ts`.
- [ ] `runSummary` route handler imports and calls `buildRunSummary` from `packages/monitor/src/projections/run-summary.ts`.
- [ ] `runState` route handler imports and calls `buildRunState` from `packages/monitor/src/projections/run-state.ts`.
- [ ] `plans` route handler imports and calls `buildPlansResponse` from `packages/monitor/src/projections/plans.ts`.
- [ ] `diff` route handler imports and calls `buildDiffResponse` from `packages/monitor/src/projections/diff.ts`.
- [ ] Recovery, recovery sidecar, apply recovery, resume build, resume eligibility, and queue recovery apply route definitions include security policies.
- [ ] Direct route tests assert HTTP 403 for non-loopback Host, cross-origin Origin, and `Sec-Fetch-Site: cross-site` on at least one route using each sensitive operation label.
- [ ] Direct route tests assert `events` and `daemonEvents` write `stream:hello` as the first SSE block.
- [ ] Direct route tests assert invalid `events`, `runSummary`, `runState`, and `plans` route IDs return HTTP 400 plain text with the current message.
- [ ] Direct route tests assert invalid `diff` route IDs return HTTP 400 JSON `{ error: 'Invalid sessionId or planId' }`.
- [ ] `pnpm vitest run packages/monitor/src/__tests__/routes-control-registration.test.ts packages/monitor/src/__tests__/routes-control-plane.test.ts packages/monitor/src/__tests__/routes-recovery.test.ts packages/monitor/src/__tests__/routes-queue-recovery.test.ts packages/monitor/src/__tests__/routes-monitor-data.test.ts packages/monitor/src/__tests__/routes-run-details.test.ts` exits 0.
- [ ] `pnpm type-check` exits 0.
- [ ] `pnpm maintainability:check` exits 0.
- [ ] `wc -l packages/monitor/src/routes/control-monitor.ts packages/monitor/src/routes/control-runtime.ts packages/monitor/src/routes/control-validation.ts packages/monitor/src/routes/enqueue-service.ts packages/monitor/src/routes/control-plane.ts packages/monitor/src/routes/recovery-sidecar-service.ts packages/monitor/src/routes/recovery.ts packages/monitor/src/routes/resume-service.ts packages/monitor/src/routes/resume.ts packages/monitor/src/routes/queue-recovery.ts packages/monitor/src/routes/monitor-data.ts packages/monitor/src/routes/run-details.ts packages/monitor/src/routes/stream-attach.ts` reports every created implementation file at or below 600 lines.
- [ ] Every created production file over 300 lines contains balanced durable `// --- eforge:region <semantic-slug> ---` and `// --- eforge:endregion <semantic-slug> ---` markers.

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
