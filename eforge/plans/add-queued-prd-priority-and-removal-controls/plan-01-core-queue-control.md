---
id: plan-01-core-queue-control
name: Core Queue Control API, Engine Helpers, and Scheduler Reconciliation
branch: add-queued-prd-priority-and-removal-controls/plan-01-core-queue-control
agents:
  builder:
    effort: high
    rationale: This plan touches the daemon route contract, queue filesystem
      mutation safety, and scheduler reconciliation order. It needs careful
      handling of live locks, dependency refusals, and no-growth ceilings on
      oversized engine files.
  reviewer:
    effort: high
    rationale: Local mutation security, path-safe deletion, and daemon API contract
      changes require thorough review.
---

# Core Queue Control API, Engine Helpers, and Scheduler Reconciliation

## Architecture Context

The shared client owns daemon route keys, wire request/response types, version compatibility, and typed helpers. The engine owns queue-file semantics and lock classification. The monitor daemon validates HTTP input, calls engine helpers, and notifies the scheduler only after a successful filesystem mutation. The scheduler remains reconciliation-driven and must use the queue filesystem as the source of truth before launching more work.

`packages/engine/src/prd-queue.ts` and `packages/engine/src/queue/scheduler.ts` are legacy oversized files with no-growth ceilings in `scripts/agent-maintainability-baseline.json`. Add queue-control implementation in a focused new engine module and, if line budget permits, add only a tiny re-export from `prd-queue.ts`. Do not grow either oversized file beyond its baseline ceiling; trim obsolete comments in the same bounded edit if a scheduler edit needs line-count headroom.

## Implementation

### Overview

Add client-owned queue priority/remove route contracts, engine-owned queue-control filesystem helpers, daemon routes secured by `localMutation`, and scheduler reconciliation that rebuilds dispatch order from freshly loaded queue files on every mutation tick.

### Key Decisions

1. Use `POST /api/queue/:prdId/priority` for priority mutation and `DELETE /api/queue/:prdId` for removal. `DELETE` is already supported by the router.
2. Keep queue-control filesystem logic out of route handlers. Routes validate HTTP shape, call engine helpers, map helper errors to HTTP status, and notify the scheduler after success.
3. Do not add a new event variant. `/api/queue` refresh plus `queue:mutation` notification covers current Console/SSE needs.
4. Implement the new queue-control engine functions in `packages/engine/src/queue/control.ts` to satisfy maintainability ceilings, while keeping the public helper surface engine-owned and reusable.

## Scope

### In Scope

- Queue priority and queue removal route keys in `API_ROUTES`.
- Queue priority and queue removal request/response types.
- Node and browser-safe client helpers for queue control routes.
- Daemon API version bump.
- Engine queue-control helpers for locating, status classification, priority rewrite, removal, sidecar deletion, running-lock refusal, stale/corrupt lock cleanup, and dependency-safety refusal.
- Daemon route module for priority and removal mutations.
- Scheduler reconciliation changes for fresh priority ordering and deleted pending/blocked entries.
- Core tests for engine helpers, daemon routes, client helpers, browser helpers, route registration, and scheduler behavior.

### Out of Scope

- CLI, MCP, Pi, and Console user surfaces; those are implemented in later plans.
- Hold, pause, cascade delete, cascade cancel, or per-item capability metadata.
- Running cancellation by PRD id.
- New build events.

## Files

### Create

- `packages/client/src/routes/queue-control.ts` — shared queue-control wire types such as `QueueControlStatus`, `QueuePriorityRequest`, `QueuePriorityResponse`, and `QueueRemoveResponse`.
- `packages/client/src/browser-queue-control.ts` — browser-safe fetch helpers for priority and removal mutations using `API_ROUTES` and `buildPath`.
- `packages/engine/src/queue/control.ts` — queue-control helper implementation and typed helper errors.
- `packages/monitor/src/routes/queue-control.ts` — daemon route definitions for priority and removal mutations.
- `packages/monitor/src/__tests__/routes-queue-control.test.ts` — daemon route contract, security, notification, and filesystem mutation coverage.
- `test/browser-queue-control-helpers.test.ts` — browser helper fetch-path and error-message coverage.

### Modify

- `packages/client/src/routes/route-map.ts` — add `queuePriority` and `queueRemove` route keys.
- `packages/client/src/routes.ts` — export queue-control request/response types.
- `packages/client/src/api/queue.ts` — add `apiUpdateQueuePriority`, `apiUpdateQueuePriorityIfRunning`, `apiRemoveQueueItem`, and `apiRemoveQueueItemIfRunning`.
- `packages/client/src/index.ts` — export queue-control types and helpers.
- `packages/client/src/browser.ts` — export browser queue-control types and helpers.
- `packages/client/src/api-version-const.ts` — bump `DAEMON_API_VERSION` and prepend a version-history note for the new required queue-control routes.
- `packages/engine/src/prd-queue.ts` — add a minimal re-export only if line budget permits; do not implement large helpers here.
- `packages/engine/src/queue/scheduler.ts` — rebuild `orderedPrds` from `resolveQueueOrder(freshPrds)` on every discovery tick and remove missing pending/blocked state.
- `packages/monitor/src/routes/control-monitor.ts` — register queue-control routes and add route keys to `CONTROL_MONITOR_ROUTE_KEYS`.
- `test/prd-queue.test.ts` — add helper behavior tests for priority mutation, running rejection, terminal rejection, removal, sidecars, dependency safety, and stale/corrupt locks.
- `test/queue-scheduler-policy.test.ts` — add reconciliation tests for priority reordering and deleted pending PRDs.
- `test/client-no-start-api-helpers.test.ts` — add no-start helper export cases and live request path/body assertions for queue-control helpers.
- `packages/monitor/src/__tests__/routes-index-coverage.test.ts` — only adjust if the new route keys require explicit expectations beyond the existing automatic coverage.

## Implementation Details

### Client Contract

- Add `queuePriority: '/api/queue/:prdId/priority'` and `queueRemove: '/api/queue/:prdId'` to `API_ROUTES`.
- Define queue-control response statuses as a closed union used by both route handlers and clients:
  - `pending`, `running`, `waiting`, `failed`, `skipped`, and `removed`.
- Define `QueuePriorityRequest` as `{ priority: number }`.
- Define `QueuePriorityResponse` as `{ id: string; previousStatus: 'pending' | 'waiting'; currentStatus: 'pending' | 'waiting'; priority: number }`.
- Define `QueueRemoveResponse` as `{ id: string; previousStatus: 'pending' | 'waiting' | 'failed' | 'skipped'; currentStatus: 'removed'; removedSidecars: string[] }`, where sidecars use queue-relative paths such as `failed/<id>.recovery.json`.
- Add API helpers that call `buildPath(API_ROUTES.queuePriority, { prdId })` and `buildPath(API_ROUTES.queueRemove, { prdId })`. Do not embed new `/api/...` strings outside `route-map.ts`.
- Ensure the new API helpers use the existing daemon request/version-verification path so stale daemon API versions fail before issuing queue-control requests.
- Add browser helpers that throw errors containing `Queue priority request failed (<status>)` or `Queue removal request failed (<status>)` and return typed response JSON.

### Engine Queue-Control Helpers

Implement helper functions in `packages/engine/src/queue/control.ts` with names similar to:

- `findQueuedPrdForControl({ cwd, queueDir, prdId })`
- `updateQueuedPrdPriority({ cwd, queueDir, prdId, priority })`
- `removeQueuedPrd({ cwd, queueDir, prdId })`

Helper requirements:

- Accept only safe PRD ids: non-empty, no slash, no backslash, no `..`, no NUL.
- Locate PRDs across the queue root, `waiting/`, `failed/`, and `skipped/` via `loadQueue`.
- Classify root PRDs via `readPrdLockStatus`:
  - live lock => `running`.
  - absent lock => `pending`.
  - stale/corrupt lock => best-effort `releasePrd`; after success classify as `pending`, after failure throw a conflict to avoid racing ambiguous ownership.
- Priority mutation:
  - Accept finite integers only.
  - Allow `pending` root PRDs and `waiting` PRDs.
  - Use `setQueuedPrdFrontmatterFields(prd, { priority })` to preserve body and unrelated frontmatter.
  - Reject `running`, `failed`, and `skipped` with a conflict error.
  - Running conflict messages must state that running builds must be cancelled by session id through the existing cancel route.
- Removal:
  - Allow `pending`, `waiting`, `failed`, and `skipped`.
  - Reject live `running` with the same cancel-by-session guidance.
  - For stale/corrupt root locks, remove the lock best-effort before deleting the PRD file.
  - Before deleting, load active root and waiting queue items and fail closed when any live dependent lists the target in `depends_on`; include dependent ids in the helper error.
  - Delete the PRD markdown file with `rm(..., { force: true })` only after dependency preflight passes.
  - When deleting a failed PRD, delete `failed/<id>.recovery.md` and `failed/<id>.recovery.json` if present, and return the relative sidecar paths that existed.
  - Return not-found for ids absent from all four queue locations.
- Keep route-level HTTP status mapping outside the helper, but helper errors must carry enough kind/code data for routes to map `not-found` to 404, validation to 400, and conflicts to 409.

### Daemon Routes

- Add `createQueueControlRoutes(context)` and include it in `createControlMonitorRoutes`.
- Protect both routes with `localMutation('Queue control mutations')`.
- Priority route:
  - Validate `prdId` route param with the same safe-id convention used by recovery routes.
  - Read a JSON object body.
  - Return 400 for malformed JSON, non-object body, missing `priority`, non-number `priority`, non-finite `priority`, or non-integer `priority`.
  - Call the engine helper.
  - Call `context.notifyQueueMutation('external')` only after helper success.
  - Return the typed response.
- Removal route:
  - Validate `prdId` route param.
  - Do not require a body.
  - Call the engine helper.
  - Call `context.notifyQueueMutation('external')` only after helper success.
  - Return the typed response.
- Route error messages for dependency refusals must list dependent ids and say to remove dependents first or wait for future cascade controls.

### Scheduler Reconciliation

- In `discoverNewPrds()`, keep `freshOrdered = resolveQueueOrder(freshPrds)` as the authoritative root queue order for dispatch.
- Preserve `prdState` entries for PRDs still present and refresh their `dependsOn` from fresh frontmatter.
- Add missing root PRDs as `pending` and emit `queue:prd:discovered`.
- Reset re-queued `failed` or `blocked` PRDs to `pending` when the root file reappears.
- Remove `prdState` entries with status `pending` or `blocked` when the id is no longer present in the fresh root queue.
- Remove those missing ids from `orderedPrds`.
- Replace the root portion of `orderedPrds` with `freshOrdered` after reconciliation so priority changes alter subsequent dispatch.
- Keep conservative handling for live `running` locks and `launching` ids.

## Verification

- [ ] `API_ROUTES.queuePriority` equals `/api/queue/:prdId/priority` and `API_ROUTES.queueRemove` equals `/api/queue/:prdId`.
- [ ] `DAEMON_API_VERSION` increments by one and the version-history comment names queue priority and removal routes.
- [ ] Client helper tests simulate a stale daemon API version and assert queue-control helpers fail during version verification before issuing queue-control requests.
- [ ] `apiUpdateQueuePriorityIfRunning` and `apiRemoveQueueItemIfRunning` return `null` with no daemon lockfile.
- [ ] Live client helper tests record `POST` to `buildPath(API_ROUTES.queuePriority, { prdId })` with a JSON priority body.
- [ ] Live client helper tests record `DELETE` to `buildPath(API_ROUTES.queueRemove, { prdId })` with no body.
- [ ] Browser helper tests record the same route constants and throw status-bearing errors for non-2xx responses.
- [ ] Engine priority tests show pending and waiting PRD files gain the new `priority` while body text and unrelated frontmatter remain byte-present.
- [ ] Engine priority tests return conflicts for live running, failed, and skipped items and leave files plus sidecars unchanged.
- [ ] Engine removal tests delete pending, waiting, failed, and skipped PRD files.
- [ ] Engine removal tests delete matching failed recovery sidecars and report their queue-relative paths.
- [ ] Engine removal tests leave live running PRD files and lock files in place.
- [ ] Engine removal tests remove stale or corrupt root locks before deleting the PRD file.
- [ ] Engine removal tests return a dependency conflict listing live pending/waiting dependents and leave all files in place.
- [ ] Daemon route tests return 400 for invalid ids and invalid priority bodies, 404 for unknown ids, and 409 for running, terminal priority, or dependency conflicts.
- [ ] Daemon route tests record `mutation:external` only for successful priority or removal mutations.
- [ ] Route registration coverage includes the two new route keys.
- [ ] Scheduler tests show a changed priority controls the next dequeued PRD after a mutation tick.
- [ ] Scheduler tests show a deleted pending PRD is not passed to `spawnPrdChild` after a mutation tick.
