---
id: plan-04-daemon-routes-projections
name: Monitor routes, recorder/projection changes, auto-build pause/resume
  wiring, failed-enqueue re-enqueue, queue capability projection, and
  snapshot/live parity.
branch: improve-recovery-failed-enqueue-and-queue-control-ux/daemon-routes-projections
---

# Daemon Routes and Projections

## Architecture Reference

This module implements the daemon side of **Client-owned contracts**, **Monitor route/security contract**, **Recovery guidance integration**, **Queue control integration**, **Failed enqueue integration**, **Scheduler pause/resume**, and **Projection parity** from the architecture.

Key constraints from architecture:
- Import every route constant, request/response type, event variant, snapshot field, and wire shape from `@eforge-build/client`; do not inline `/api/...` literals or redeclare daemon wire interfaces.
- Keep read-only recovery analysis, continue-repair eligibility, and queue recovery analysis mutation-free; only the explicit recovery-guidance prepare route may patch plan artifacts.
- Use engine helpers from `engine-recovery-guidance` and `engine-queue-controls`; daemon route code adapts HTTP validation, security, ownership evidence, projections, and wakeups.
- Mutating routes use `localMutation(...)`; read-only routes use `localOnly(...)` plus `rejectCrossSiteBrowser(...)`, even when the read operation is a `POST` preview.
- Queue item capabilities and disabled reasons are daemon-authored projections derived from engine primitives and returned in route responses and snapshots.
- Cascade remove/cancel is a preview-then-apply flow; target-only apply refuses when dependents exist, and dependent mutation requires explicit confirmation.
- Scheduler pause leaves desired auto-build enabled and gates only new launches; it must not stop already-running builds and `notifyQueueMutation()` must not wake dispatch while paused.
- Failed enqueue attention is derived from durable DB runs/events, keyed by `runId`, and live/snapshot updates use the client-owned failed-enqueue event variants.
- REST queue/runs/failed-enqueue endpoints and stream hello snapshots call the same projection helpers so parity is testable.

## Scope

### In Scope
- Add monitor route handlers for:
  - `recoveryGuidancePrepare`
  - `queueHold`
  - `queueUnhold`
  - `queueCascadePreview`
  - `queueCascadeApply`
  - `failedEnqueues`
  - `failedEnqueueReenqueue`
  - `schedulerPause`
  - `schedulerResume`
- Add daemon projection helpers for capability-bearing queue items, failed enqueue attention, shared run projection, shared auto-build projection, and stream hello assembly.
- Persist and emit `daemon:failed-enqueue:upsert` after a failed enqueue run is recorded.
- Persist and emit `daemon:failed-enqueue:resolved` after a confirmed re-enqueue action is accepted by the daemon.
- Wire explicit scheduler pause/resume into `AutoBuildSupervisor`, `server-main` scheduler controls, and HTTP routes.
- Adapt engine queue hold/unhold/cascade/cancellation helpers to HTTP validation, worker ownership evidence, process termination delegates, refreshed queue projections, and auto-build wakeups.
- Adapt engine recovery-guidance preparation to a validated daemon route and preserve mutation-free existing analysis routes.
- Add focused daemon route validation/security tests, projection tests, recorder tests, and snapshot/REST parity tests.

### Out of Scope
- Client route constants, request/response interfaces, browser/node helpers, event schemas, and API versioning; those are owned by `client-contracts`.
- Recovery-guidance rendering, artifact patching, resume gating, and git commits; those are owned by `engine-recovery-guidance`.
- Engine queue hold/cascade/cancel primitives, scheduler held gating, and cancellation-marker finalization; those are owned by `engine-queue-controls`.
- Console selectors, components, dialogs, refresh behavior, and attention rows; those are owned by `console-ux`.
- CLI, MCP, Pi, and Claude plugin command exposure.
- Public/user documentation; that is owned by `docs-validation`.
- New database tables or migrations. This module derives failed-enqueue state from existing `runs` and `events` rows plus client-owned daemon events.

## Implementation Approach

### Overview

Implement daemon changes as a set of small route and projection adapters. Existing large files receive bounded edits that redirect to shared helpers rather than duplicating object shaping.

The implementation has eight parts:

1. **Shared monitor projections** — create projection helpers that return client-owned `QueueItemWithCapabilities[]`, `RunInfo[]`, `FailedEnqueueInfo[]`, and `AutoBuildState` for both REST routes and stream hello snapshots.
2. **Failed enqueue durability** — project failed enqueue rows from persisted enqueue runs/events, emit failed-enqueue upsert/resolved daemon events, and expose list/re-enqueue routes.
3. **Recovery guidance route** — validate the explicit prepare request and invoke `prepareRecoveryGuidance()` with cwd, queue dir, output dir, db path, and trunk branch metadata.
4. **Queue control routes** — add hold/unhold and cascade preview/apply routes that call engine helpers, attach refreshed capability-bearing queue projections, and notify auto-build only after mutations.
5. **Running PRD cancel adapter** — supply engine cascade helpers with daemon DB/worker ownership evidence and a signal-only cancellation delegate.
6. **Scheduler pause/resume** — add public supervisor methods and routes that pause/resume the scheduler without changing desired auto-build state.
7. **Async stream hello parity** — make daemon stream hello assembly await the same queue and failed-enqueue projections used by REST routes.
8. **Tests** — cover route registration, validation, local-only security, projection parity, failed enqueue projection/re-enqueue, queue mutation responses, scheduler pause semantics, and recorder-emitted failed-enqueue events.

### Shared Projection Helpers

Create `packages/monitor/src/projections/monitor-state.ts` as the route/snapshot projection facade:

- `projectQueueForContext(context): Promise<QueueItemWithCapabilities[]>`
  - Returns `[]` when `context.cwd` or `context.queuePaths` is absent.
  - Calls existing queue file parsing for title/status/recovery sidecars, then attaches hold fields and capabilities derived from engine queue-control snapshot primitives.
  - Calls `loadQueueControlSnapshot({ cwd, queueDir, classifyRootLocks: 'read-only' })` from `@eforge-build/engine/queue/snapshot`.
  - Calls `deriveQueueCapabilitiesForSnapshot(...)` from `@eforge-build/engine/queue/capabilities`.
  - Supplies running ownership evidence from `resolveRunningPrdOwnership(...)` using `context.db.getRunningRuns()` and optional worker-session evidence from `context.options.workerTracker`.
  - Applies `overlayQueueDispatchFailures(...)` after base queue loading and before returning.
  - Ensures every returned item has all capability keys required by `QueueItemCapabilities`.
- `projectRunsForContext(context): RunInfo[]`
  - Calls `projectRunsForAcceptedSuccess(context.db.getRuns(), context.queuePaths?.queueDir)`.
- `projectAutoBuildForContext(context): AutoBuildState`
  - Calls `autoBuildStateToWire(...)` with running count and scheduler limit.
- `projectSessionMetadataForContext(context): Record<string, SessionMetadata>`
  - Calls `context.db.getSessionMetadataBatch()`.
- `projectFailedEnqueuesForContext(context, options?)`
  - Delegates to the failed-enqueue projection module described below.

Modify `packages/monitor/src/projections/queue-items.ts` only for low-level queue-file parsing compatibility:

- Parse `held`, `hold_reason`, and `held_at` frontmatter into `QueueItem.hold`.
- Export a small helper for applying hold projection if the new monitor-state facade needs it.
- Keep existing `loadQueueItems`, `loadQueueItemsSync`, and `countPendingQueueDepth` exports source-compatible for existing callers/tests.

### Failed Enqueue Projection and Events

Create `packages/monitor/src/projections/failed-enqueues.ts`:

- `projectFailedEnqueues(db, options?: { includeResolved?: boolean }): FailedEnqueueInfo[]`
  - Reads `db.getRuns()` and selects runs with `command === 'enqueue'` and `status === 'failed'`.
  - Reads each run's persisted events via `db.getEvents(run.id)`.
  - Hydrates events using `hydrateEforgeEvent(...)` and extracts:
    - `enqueue:start.source` as the reconstructable source when present.
    - `enqueue:failed.error` as the failure reason when present.
    - `session:end.result.summary` as a fallback failure reason.
    - `enqueue:failed.timestamp`, then `run.completedAt`, then `run.startedAt` for `failedAt`.
  - Reads `daemon:failed-enqueue:resolved` rows from `db.getDaemonEventsAfter(0)` and marks matching run ids with `resolvedAt`.
  - Defaults to unresolved-only results; `includeResolved: true` returns resolved rows with `resolvedAt` populated.
  - Sorts unresolved rows by `failedAt` descending, tie-breaking by `runId` ascending.
- `projectFailedEnqueueByRunId(db, runId, options?)` returns one projected entry.
- `buildFailedEnqueueUpsertEvent(db, runId)` returns the client-owned event payload when a projection exists.
- `buildFailedEnqueueResolvedEvent(runId, resolvedAt, newRunId?)` returns the client-owned resolved event payload.
- `recordFailedEnqueueUpsert(db, runId)` inserts a daemon-owned `daemon:failed-enqueue:upsert` row using the same event payload that the stream will later hydrate.

Projection details:

- `FailedEnqueueInfo.source` is set to `{ source }` only when `enqueue:start.source` is a non-empty string.
- `sourceLabel` is deterministic:
  - If source has no newline and resembles a path, use the basename plus parent directory when available.
  - Otherwise use the first non-empty line truncated to 80 characters with an ellipsis suffix.
  - If no source exists, use `run.planSet` when non-empty, otherwise `Unknown source`.
- `canReenqueue` is true only when `source` exists and the row is not resolved.
- `disabledReason` is populated when `canReenqueue` is false.
- `nextCommand` is populated for every row. When source exists it is `eforge enqueue <shell-quoted-source>`; when source is missing it instructs the operator to inspect the run id in Build history and rerun the original enqueue command.

Modify `packages/monitor/src/recorder.ts`:

- After `enqueue:failed` updates the failed enqueue run and emits `daemon:run:upsert`, call `recordFailedEnqueueUpsert(db, enqueueRunId)`.
- Yield the hydrated `daemon:failed-enqueue:upsert` event after the primary failed event and run upsert, matching existing pending-upsert ordering.
- Do not emit failed-enqueue rows for successful enqueue-only runs.

### Failed Enqueue Routes

Create `packages/monitor/src/routes/failed-enqueue.ts`:

- `GET failedEnqueues`
  - Security: `localOnly('Failed enqueue reads')` and `rejectCrossSiteBrowser('Failed enqueue reads')`.
  - Response: `projectFailedEnqueuesForContext(context)`.
- `POST failedEnqueueReenqueue`
  - Security: `localMutation('Failed enqueue re-enqueue')`.
  - Validate `runId` with `isSafeRouteId`.
  - Parse a JSON object body and require `confirm === true`.
  - Load `FailedEnqueueInfo` with `includeResolved: true`.
  - Return 404 when no failed enqueue projection exists for the run id.
  - Return `{ enqueued: false, ... }` with `disabledReason` and `nextCommand` when source data is missing or the failed enqueue is already resolved.
  - Require `context.options.workerTracker`; return 503 when daemon worker spawning is unavailable.
  - Reconstruct the daemon enqueue request from `failedEnqueue.source` and call existing `prepareEnqueueRequest(context, source)` for validation and argument construction.
  - Catch `HttpRouteError` from `prepareEnqueueRequest` and return a typed `enqueued: false` response with the validation message in `disabledReason` rather than spawning.
  - Spawn the worker with `workerTracker.spawnWorker('enqueue', prepared.args)`.
  - Call `markSessionPlanSubmittedAfterEnqueue(...)` using the original source and returned worker session id.
  - Insert `daemon:failed-enqueue:resolved` with the original failed `runId` and `resolvedAt`.
  - Return `FailedEnqueueReenqueueResponse` with `enqueued: true`, the resolved failed-enqueue projection, refreshed `queue`, refreshed `runs`, and current `autoBuild`.

The route does not call `notifyQueueMutation()`. The spawned enqueue worker emits `enqueue:complete`; the existing daemon reaction path wakes auto-build from that durable event.

### Recovery Guidance Route

Create `packages/monitor/src/routes/recovery-guidance.ts`:

- `POST recoveryGuidancePrepare`
  - Security: `localMutation('Recovery guidance preparation')`.
  - Require `context.cwd`; return 503 when absent.
  - Parse a JSON object body.
  - Validate `prdId` as a safe path segment.
  - Validate optional `setName` as a safe path segment.
  - Call `prepareRecoveryGuidance({ cwd, prdId, setName, queueDir, outputDir, dbPath, trunkBranch })` from `@eforge-build/engine/recovery/guidance`.
  - Pass `queueDir` from `context.queuePaths?.queueDir` or the configured default.
  - Pass `outputDir` from `context.options.config?.plan?.outputDir`, `context.options.planOutputDir`, or `context.relativePlanOutputDir`.
  - Pass `dbPath` as `resolve(context.cwd, '.eforge', 'monitor.db')`.
  - Pass `trunkBranch` when `context.options.config?.build?.trunkBranch` is defined.
  - Map engine validation errors to 400, missing sidecar/artifact errors to 404 when the engine error kind identifies a missing sidecar, dirty/preflight conflicts to 409, and unexpected errors to 500.
  - Return the `RecoveryGuidancePrepareResponse` from the engine without reshaping it.

Existing read-only recovery sidecar, continue-repair eligibility, and queue recovery analyze routes are not modified to call this helper.

### Queue Hold/Unhold and Cascade Routes

Create `packages/monitor/src/routes/queue-control-advanced.ts`:

- Shared behavior:
  - Use `API_ROUTES` through `defineRoute(...)`; no path literals.
  - Validate every `prdId` with `isValidPathSegment`.
  - Use `queueDir(context)` from existing queue-control route logic or move that helper to a small shared route utility.
  - Use `sendQueueControlError(...)` from `routes/queue-control.ts`; export it if needed.
  - After mutations, call `projectQueueForContext(context)` and `projectAutoBuildForContext(context)` to populate response fields.
- `POST queueHold`
  - Security: `localMutation('Queue hold mutations')`.
  - Parse a JSON object body.
  - Validate optional `reason` as a string; reject control characters/newlines and strings longer than 500 UTF-16 code units before calling the engine helper.
  - Call `holdQueuedPrd({ cwd, queueDir, prdId, reason })` from `@eforge-build/engine/queue/hold`.
  - Notify `context.notifyQueueMutation('external')` only when status is `held`.
  - Return `QueueHoldResponse` with the projected mutated item, full projected queue, and auto-build state.
- `POST queueUnhold`
  - Security: `localMutation('Queue hold mutations')`.
  - Parse a JSON object body and reject non-object values.
  - Call `unholdQueuedPrd({ cwd, queueDir, prdId })`.
  - Notify only when status is `unheld`.
  - Return `QueueUnholdResponse` with the projected mutated item, full projected queue, and auto-build state.
- `POST queueCascadePreview`
  - Security: `localOnly('Queue cascade preview')` plus `rejectCrossSiteBrowser('Queue cascade preview')`.
  - Parse a JSON object body.
  - Validate `operation` as `'remove' | 'cancel'`.
  - Call `previewQueueCascade(...)` with a running-ownership resolver.
  - Return the engine `QueueCascadePreviewResponse` without mutation.
- `POST queueCascadeApply`
  - Security: `localMutation('Queue cascade mutations')`.
  - Parse a JSON object body.
  - Validate `operation`, `strategy`, `expectedAffected.token`, `expectedAffected.prdIds`, `confirmDependents`, and optional `reason`.
  - Call `applyQueueCascade(...)` with the same ownership resolver and a cancel delegate.
  - Notify `context.notifyQueueMutation('external')` only when `response.applied === true`.
  - Return the engine apply response augmented with refreshed projected `queue` and `autoBuild` fields.

### Running Cancellation Ownership Adapter

Use engine cancellation helpers rather than killing from route code:

- Add optional worker evidence methods to `packages/monitor/src/types.ts`:
  - `listWorkerSessions?(): string[]`
  - `cancelWorkerProcess?(sessionId: string): boolean`
- Keep existing `cancelWorker(sessionId)` unchanged for `/api/cancel/:sessionId` compatibility.
- Modify `packages/monitor/src/server-main.ts` worker tracker:
  - `listWorkerSessions()` returns the keys of the in-memory worker map.
  - `cancelWorkerProcess(sessionId)` sends `SIGTERM` to an in-memory worker or to the PID for a running DB row with that session id, and does not mark DB runs as killed or emit failure events.
  - Existing `cancelWorker(sessionId)` keeps its current DB status/event behavior.
- In `queue-control-advanced.ts`, implement:
  - `resolveRunningOwnership(record)` by calling `resolveRunningPrdOwnership({ cwd, prdId: record.id, runs: context.db.getRunningRuns(), workerSessions })`.
  - `cancelRunning(ownership)` by requiring `ownership.owned === true`, `ownership.sessionId`, and `context.options.workerTracker?.cancelWorkerProcess`. Return `{ cancelled: false, reason }` when any requirement is absent or the signal call returns false.

The route never calls `process.kill` directly and never cancels a PID when engine ownership resolution returns `owned: false`.

### Scheduler Pause/Resume Routes and Supervisor Wiring

Create `packages/monitor/src/routes/scheduler-control.ts`:

- `POST schedulerPause`
  - Security: `localMutation('Scheduler control mutations')`.
  - Require `context.options.daemonState`; return 503 when absent.
  - Reject with 409 when `autoBuildController.getSnapshot().desired !== 'enabled'`.
  - Call `autoBuildController.pauseScheduler('operator pause')`.
  - Return `projectAutoBuildForContext(context)`.
  - Do not call `notifyQueueMutation()`.
- `POST schedulerResume`
  - Security: `localMutation('Scheduler control mutations')`.
  - Require `context.options.daemonState`; return 503 when absent.
  - Reject with 409 when `autoBuildController.getSnapshot().desired !== 'enabled'`.
  - Call `autoBuildController.resumeScheduler('operator resume')`.
  - Return `projectAutoBuildForContext(context)`.
  - Do not call `notifyQueueMutation()`; the supervisor's resume effect calls `schedulerControl.resume()`, which triggers a scheduler tick.

Modify `packages/monitor/src/auto-build-supervisor.ts`:

- Extend `AutoBuildController` with `pauseScheduler(reason?: string): AutoBuildState` and `resumeScheduler(reason?: string): AutoBuildState`.
- Add public class methods with those names.
- `pauseScheduler(...)`:
  - Refreshes runtime details.
  - Returns the current snapshot without effects when desired is not `enabled`.
  - Calls `effects.pauseScheduler?.()`.
  - Applies the existing `scheduler-paused` reducer action.
  - Emits transition events through the existing `emitTransition` path.
- `resumeScheduler(...)`:
  - Refreshes runtime details.
  - Returns the current snapshot without effects when desired is not `enabled`.
  - Calls `effects.resumeScheduler?.()`.
  - Applies the existing `scheduler-resumed` reducer action.
  - Emits transition events through the existing `emitTransition` path.
- Change the `queue-mutation` reducer branch and `notifyQueueMutation(...)` so a state with `mode === 'paused'` or `scheduler.paused === true` records `lastMutationReason` but does not transition to `starting`/`running`, call `resumeScheduler`, call `spawnWatcher`, or emit a scheduler mutation.

Existing `pauseOnFailure(...)` may continue to call the same scheduler pause effect, but a later queue mutation must not resume it; operators resume through the new route.

### Async Stream Hello and Projection Parity

Modify `packages/monitor/src/streams/daemon-stream.ts` `[region: daemon-routes-projections, daemon hello uses shared projections]`:

- Change `attachDaemonStream(...)` to `async` and await `buildDaemonHello(...)` before writing the `stream:hello` frame.
- Change `buildDaemonHello(...)` to `async` and call:
  - `projectRunsForContext(context)`
  - `projectQueueForContext(context)`
  - `projectSessionMetadataForContext(context)`
  - `projectAutoBuildForContext(context)`
  - `projectFailedEnqueuesForContext(context)`
- Keep `buildHeartbeatObject(...)` synchronous.
- Preserve existing replay behavior after the hello frame is written.

Modify `packages/monitor/src/streams/stream-hub.ts`:

- Allow `attachDaemon(...)` to return a `Promise<void>`.
- Await or return the promise from `attachDaemonStream(...)`.

Modify `packages/monitor/src/routes/stream-attach.ts`:

- Make the daemon-events route handler `async` and `await ctx.streams.attachDaemon(ctx.req, ctx.res)`.

Modify `packages/monitor/src/types.ts`:

- Update `MonitorStreamHub.attachDaemon` to return `void | Promise<void>`.

Modify `packages/monitor/src/routes/monitor-data.ts` `[region: daemon-routes-projections, REST routes use shared projections]`:

- Use `projectQueueForContext(context)` for `GET queue`.
- Use `projectRunsForContext(context)` for `GET runs`.
- Use `projectSessionMetadataForContext(context)` for `GET sessionMetadata`.
- Leave spend projection unchanged.

### Route Registration

Modify `packages/monitor/src/routes/control-monitor.ts` `[region: daemon-routes-projections, route keys and factory spreads for new daemon routes]`:

- Import the new route factories.
- Add route keys to `CONTROL_MONITOR_ROUTE_KEYS` in this order near their related domains:
  - `schedulerPause`, `schedulerResume` after `schedulerKick`.
  - `queueHold`, `queueUnhold`, `queueCascadePreview`, `queueCascadeApply` after existing queue-control keys.
  - `recoveryGuidancePrepare` near recovery routes.
  - `failedEnqueues`, `failedEnqueueReenqueue` before monitor data routes.
- Add factory spreads in the same order as the route keys.

No edit to `packages/monitor/src/routes/index.ts` is required because it already delegates first-party control routes through `createControlMonitorRoutes(...)`. If implementation discovers a direct `routes/index.ts` edit is needed, keep it to one import/spread block tagged `[region: daemon-routes-projections, monitor route factory registration]`.

### Key Decisions

1. **Use derived failed-enqueue projection instead of a DB table.** Existing `runs` and `events` already contain failed enqueue evidence; daemon failed-enqueue events add live update semantics without a schema migration.
2. **Resolve failed enqueue by `runId`.** `runId` is stable across REST snapshots and live events, matches client event-registry dedupe, and avoids duplicating rows when sessions reconnect.
3. **Mark original failed enqueue resolved when re-enqueue is accepted for spawning.** A new enqueue failure produces its own run and attention row; the original operator action no longer needs to remain unresolved.
4. **Make stream hello async rather than duplicating capability rules synchronously.** Queue capabilities come from engine primitives, so REST and stream snapshots await the same projection helper.
5. **Keep legacy queue control routes source-compatible.** Existing priority, dependency override, and DELETE remove keep their current response shapes; new capability-bearing responses are returned by new routes and `GET queue`/stream snapshots.
6. **Notify auto-build only after state-changing queue mutations.** No-op hold/unhold statuses and refused cascade applies do not wake the scheduler.
7. **Signal-only PRD cancellation is separate from session cancel.** `/api/cancel/:sessionId` keeps marking runs killed; cascade cancel uses cancellation markers plus signal-only termination so engine child finalization can classify PRD cancellation as skipped.
8. **Pause/resume are explicit scheduler controls.** Queue mutations update `lastMutationReason` while paused but do not resume launches; only `schedulerResume` restarts discovery.
9. **Route handlers return client-owned shapes directly.** Helper functions may assemble objects, but every returned type annotation comes from `@eforge-build/client`.

## Files

### Create
- `packages/monitor/src/projections/monitor-state.ts` — shared REST/stream projection facade for queue, runs, session metadata, auto-build, and failed enqueues.
- `packages/monitor/src/projections/failed-enqueues.ts` — durable failed-enqueue projection from runs/events plus upsert/resolved event builders.
- `packages/monitor/src/routes/recovery-guidance.ts` — validated mutating route for `recoveryGuidancePrepare`.
- `packages/monitor/src/routes/failed-enqueue.ts` — failed enqueue list and confirmed re-enqueue routes.
- `packages/monitor/src/routes/queue-control-advanced.ts` — hold/unhold and cascade preview/apply routes.
- `packages/monitor/src/routes/scheduler-control.ts` — scheduler pause/resume routes.
- `packages/monitor/src/__tests__/failed-enqueue-projection.test.ts` — projection and recorder coverage for failed enqueue rows/events.
- `packages/monitor/src/__tests__/routes-failed-enqueue.test.ts` — failed enqueue route validation, security, disabled fallback, and re-enqueue response coverage.
- `packages/monitor/src/__tests__/routes-recovery-guidance.test.ts` — recovery guidance route validation/security and missing-sidecar error mapping coverage.
- `packages/monitor/src/__tests__/routes-queue-control-advanced.test.ts` — hold/unhold/cascade route validation, security, responses, mutation wakeups, and cancellation refusal coverage.
- `packages/monitor/src/__tests__/routes-scheduler-control.test.ts` — scheduler pause/resume route validation, security, and auto-build state response coverage.
- `packages/monitor/src/__tests__/queue-capability-projection.test.ts` — capability-bearing queue projection coverage for pending, waiting, held, running, failed, and skipped fixtures.

### Modify
- `packages/monitor/src/projections/queue-items.ts` — parse hold frontmatter into `QueueItem.hold` while preserving existing loader exports.
- `packages/monitor/src/projections/auto-build-state.ts` — export or keep reusable `autoBuildStateToWire(...)`; use it through `monitor-state.ts` for routes and snapshots.
- `packages/monitor/src/routes/queue-control.ts` — export `queueDir(...)` and `sendQueueControlError(...)` or move them to a shared route utility so advanced queue routes share legacy error mapping.
- `packages/monitor/src/routes/control-monitor.ts` — register new route keys and factories `[region: daemon-routes-projections, route keys and factory spreads for new daemon routes]`.
- `packages/monitor/src/routes/monitor-data.ts` — use shared projection helpers for queue, runs, session metadata, and auto-build parity `[region: daemon-routes-projections, REST routes use shared projections]`.
- `packages/monitor/src/routes/stream-attach.ts` — await async daemon stream attachment for stream hello projection parity.
- `packages/monitor/src/streams/daemon-stream.ts` — make stream hello assembly async and add `failedEnqueues` to the snapshot using shared projections `[region: daemon-routes-projections, daemon hello uses shared projections]`.
- `packages/monitor/src/streams/stream-hub.ts` — allow async daemon stream attachment and preserve synchronous heartbeat behavior.
- `packages/monitor/src/types.ts` — extend `MonitorStreamHub.attachDaemon` return type and add optional `WorkerTracker` signal-only/worker-session evidence methods.
- `packages/monitor/src/auto-build-supervisor.ts` — add explicit scheduler pause/resume methods and prevent queue mutations from waking paused schedulers.
- `packages/monitor/src/server-main.ts` — implement optional worker-session listing and signal-only cancellation in the persistent worker tracker.
- `packages/monitor/src/recorder.ts` — persist/yield failed-enqueue upsert events when enqueue runs fail.
- `packages/monitor/src/__tests__/auto-build-supervisor.test.ts` — add explicit scheduler pause/resume and paused-queue-mutation assertions; update existing queue-mutation-after-pause expectation.
- `packages/monitor/src/__tests__/routes-control-registration.test.ts` — include new route keys in registration and sensitive-route security assertions.
- `packages/monitor/src/__tests__/stream-hello-parity.test.ts` — assert `failedEnqueues` and capability-bearing `queue` snapshots equal REST projections.
- `packages/monitor/src/__tests__/streams-daemon-stream.test.ts` — await `buildDaemonHello(...)` and add failed-enqueue snapshot cases.
- `packages/monitor/src/__tests__/queue-dispatch-failure-projection.test.ts` — await `buildDaemonHello(...)` and assert dispatch failure overlay coexists with capabilities.
- `packages/monitor/src/__tests__/routes-monitor-data.test.ts` — update queue expectations to include hold/capability fields where fixtures create queue items.
- `packages/monitor/src/__tests__/routes-queue-control.test.ts` — keep legacy priority/remove/dependency assertions source-compatible and add a regression that legacy responses do not require new capability fields.
- `packages/monitor/src/__tests__/server-compatibility.test.ts` or `packages/monitor/src/__tests__/routes-control-plane.test.ts` — update auto-build route expectations if scheduler pause changes projected `mode`, `desired`, or scheduler fields in seeded fixtures.

## Testing Strategy

### Unit Tests
- `failed-enqueues.ts` projects one `FailedEnqueueInfo` from a failed enqueue run with `enqueue:start` and `enqueue:failed` events.
- Failed-enqueue projection falls back to `session:end.result.summary` and run timestamps when `enqueue:failed` is missing.
- Failed-enqueue projection hides successful enqueue runs.
- Failed-enqueue projection dedupes by `runId` and sorts newest `failedAt` first.
- Failed-enqueue projection marks `resolvedAt` from `daemon:failed-enqueue:resolved` and omits resolved entries unless `includeResolved: true` is set.
- Failed-enqueue upsert event builder returns a client-owned `daemon:failed-enqueue:upsert` payload that `safeParseEforgeEvent(...)` accepts.
- Queue projection attaches `hold` from frontmatter and every required `QueueItemCapabilities` key.
- Queue projection preserves existing `recoveryVerdict`, `recoveryApplied`, and `dispatchFailure` fields.
- AutoBuildSupervisor `pauseScheduler(...)` leaves `desired: 'enabled'`, sets `mode: 'paused'`, sets `scheduler.paused: true`, and calls the scheduler pause effect once.
- AutoBuildSupervisor `notifyQueueMutation(...)` while paused records `lastMutationReason` and calls neither scheduler resume nor watcher spawn.
- AutoBuildSupervisor `resumeScheduler(...)` calls the scheduler resume effect and returns `mode: 'running'` when desired is enabled.
- Recorder persists/yields one failed-enqueue upsert event after a failed enqueue run and persists zero upserts after a successful enqueue run.

### Integration Tests
- Route registration lists exactly the new client-owned route keys and every route pattern equals `API_ROUTES[routeKey]`.
- Cross-site requests are rejected for every new mutating endpoint.
- Invalid JSON or invalid bodies return 400/413 for every new route that parses a body.
- `POST queueHold` on a pending PRD writes hold frontmatter, returns `status: 'held'`, returns a capability-bearing item, returns a refreshed queue, and records one `notifyQueueMutation('external')` call.
- Repeating `POST queueHold` on the held PRD returns `status: 'already-held'` and records zero additional queue mutation notifications.
- `POST queueUnhold` removes hold frontmatter, returns `status: 'unheld'`, returns refreshed capabilities, and records one queue mutation notification.
- `POST queueCascadePreview` with dependents returns `defaultRefusalReason`, `expectedAffected`, and no file mutation.
- `POST queueCascadeApply` with `target-only` and dependents returns `applied: false`, leaves source files present, and records zero queue mutation notifications.
- `POST queueCascadeApply` with confirmed cascade removes/moves the engine-selected files, returns refreshed queue/auto-build projections, and records one queue mutation notification.
- `POST queueCascadeApply` for a running PRD with no ownership returns `applied: false`, includes a blocker reason, and does not call the signal-only worker cancellation delegate.
- `GET failedEnqueues` returns unresolved failed enqueue rows from persisted runs/events.
- `POST failedEnqueueReenqueue` rejects missing `confirm: true` with 400.
- `POST failedEnqueueReenqueue` with missing source data returns `enqueued: false`, `disabledReason`, `nextCommand`, refreshed queue, and refreshed runs.
- `POST failedEnqueueReenqueue` with source data spawns an enqueue worker, writes a resolved daemon event, returns `enqueued: true`, and returns refreshed queue/runs projections.
- `POST schedulerPause` leaves desired auto-build enabled, sets scheduler paused in the response, and queue mutation after pause does not emit a scheduler mutation.
- `POST schedulerResume` clears scheduler paused in the response and calls the scheduler resume effect.
- Stream hello `queue`, `runs`, `sessionMetadata`, `autoBuild`, and `failedEnqueues` deep-equal the corresponding REST route payloads for the same seeded state.
- Live `daemon:failed-enqueue:upsert` and `daemon:failed-enqueue:resolved` rows hydrate through `hydrateEforgeEvent(...)` and replay through `/api/daemon-events`.

## Verification

- [ ] `CONTROL_MONITOR_ROUTE_KEYS` contains `recoveryGuidancePrepare`, `queueHold`, `queueUnhold`, `queueCascadePreview`, `queueCascadeApply`, `failedEnqueues`, `failedEnqueueReenqueue`, `schedulerPause`, and `schedulerResume`.
- [ ] Every new route definition uses `API_ROUTES[routeKey]` through `defineRoute(...)`.
- [ ] No new monitor file contains an inline string matching `"/api/`.
- [ ] Every new mutating endpoint has `localMutation(...)` security.
- [ ] `queueCascadePreview` and `failedEnqueues` have `localOnly(...)` and `rejectCrossSiteBrowser(...)` security.
- [ ] `recoveryGuidancePrepare` returns 400 for missing `prdId`, 400 for unsafe `prdId`, and 400 for unsafe `setName`.
- [ ] `recoveryGuidancePrepare` calls `prepareRecoveryGuidance(...)` with `cwd`, `prdId`, `queueDir`, `outputDir`, `dbPath`, and configured `trunkBranch` when present.
- [ ] Existing recovery sidecar and continue-repair eligibility routes do not call `prepareRecoveryGuidance(...)`.
- [ ] `GET /api/queue` returns queue items with `capabilities.priority`, `capabilities.remove`, `capabilities.dependencyOverride`, `capabilities.hold`, `capabilities.unhold`, `capabilities.cascadeRemove`, `capabilities.cancel`, and `capabilities.cascadeCancel`.
- [ ] Held queue files produce `hold.held === true` and preserve their existing queue path.
- [ ] `POST queueHold` returns `status: 'held'` for an unheld pending item and `status: 'already-held'` for a held item.
- [ ] `POST queueUnhold` returns `status: 'unheld'` for a held waiting item and `status: 'already-unheld'` for an unheld item.
- [ ] Hold/unhold no-op statuses do not call `context.notifyQueueMutation(...)`.
- [ ] Successful hold/unhold mutations call `context.notifyQueueMutation('external')` once.
- [ ] `queueCascadePreview` performs zero file writes, deletes, renames, lock removals, and cancellation marker writes in route tests.
- [ ] `queueCascadeApply` with dependents and `strategy: 'target-only'` returns `applied: false` before file mutation.
- [ ] `queueCascadeApply` with dependents and `confirmDependents: false` returns `applied: false` before file mutation.
- [ ] `queueCascadeApply` with a mismatched `expectedAffected.token` returns `applied: false` before file mutation.
- [ ] `queueCascadeApply` attaches refreshed `queue` entries with capabilities to its response.
- [ ] Running cascade cancel without daemon ownership returns a refusal reason and sends no signal.
- [ ] Running cascade cancel with daemon ownership writes a cancellation marker before invoking the signal-only worker cancellation delegate.
- [ ] `AutoBuildSupervisor.pauseScheduler(...)` leaves `desired === 'enabled'` and sets `mode === 'paused'`.
- [ ] `AutoBuildSupervisor.notifyQueueMutation(...)` while paused does not call `resumeScheduler`, `spawnWatcher`, or `emitSchedulerMutation`.
- [ ] `POST schedulerPause` returns an `AutoBuildState` with `desired === 'enabled'` and `scheduler.paused === true`.
- [ ] `POST schedulerResume` returns an `AutoBuildState` with `desired === 'enabled'` and `scheduler.paused === false`.
- [ ] `POST schedulerPause` and `POST schedulerResume` return 409 when desired auto-build is disabled.
- [ ] Failed enqueue projection returns `runId`, `sessionId` when present, `sourceLabel`, `failureReason`, `failedAt`, `canReenqueue`, and `nextCommand` for each unresolved failed enqueue run.
- [ ] Successful enqueue runs produce zero `FailedEnqueueInfo` entries.
- [ ] A failed enqueue run with no recorded source has `canReenqueue === false`, a non-empty `disabledReason`, and a non-empty `nextCommand`.
- [ ] Recorder writes one `daemon:failed-enqueue:upsert` daemon event for one failed enqueue run.
- [ ] Recorder writes zero `daemon:failed-enqueue:upsert` daemon events for one successful enqueue run.
- [ ] `POST failedEnqueueReenqueue` requires `{ "confirm": true }`.
- [ ] Successful failed-enqueue re-enqueue writes one `daemon:failed-enqueue:resolved` daemon event with the original `runId`.
- [ ] `FailedEnqueueReenqueueResponse.queue` equals `GET /api/queue` immediately after the route returns.
- [ ] `FailedEnqueueReenqueueResponse.runs` equals `GET /api/runs` immediately after the route returns.
- [ ] Stream hello `failedEnqueues` equals `GET /api/enqueue/failed` for the same DB state.
- [ ] Stream hello `queue` equals `GET /api/queue` for the same queue files and DB state.
- [ ] Stream hello `runs` equals `GET /api/runs` for the same DB state.
- [ ] Existing priority, remove, and dependency override route tests pass with unchanged legacy response bodies.
- [ ] Route security/validation tests cover every new mutating endpoint.
- [ ] `pnpm type-check` exits 0.
- [ ] `pnpm test` exits 0.
- [ ] `pnpm maintainability:check` exits 0.

<build-config>
{
  "build": ["test-write", "implement", "test-cycle", "review-cycle"],
  "review": {
    "strategy": "parallel",
    "perspectives": ["code", "security"],
    "maxRounds": 2,
    "evaluatorStrictness": "standard"
  }
}
</build-config>
