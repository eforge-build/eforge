---
id: plan-02-daemon-dependency-override
name: Daemon Dependency Override API
branch: queue-dependency-visibility-and-override-controls/plan-02-daemon-dependency-override
agents:
  builder:
    effort: high
    rationale: This plan adds a new filesystem mutation route with validation,
      lock/race handling, audit event persistence, client helpers, and API
      versioning.
  reviewer:
    effort: high
    rationale: Queue-control mutations cross HTTP input validation, local mutation
      security, filesystem state, and daemon auditability.
---

# Daemon Dependency Override API

## Architecture Context

Queue-control route constants, request/response types, browser helpers, and Node helpers are owned by `@eforge-build/client`. The monitor route validates HTTP shape and local mutation security, then delegates the queue-file mutation to the engine queue-control helper. The daemon persists audit events through `writeDaemonEvent`, which only records event types registered as daemon-scoped persisted events in the client registry.

## Implementation

### Overview

Add a typed daemon route that removes one dependency id from one pending or waiting PRD, rewrites frontmatter, moves a waiting PRD to the queue root when the last dependency is removed, notifies the scheduler, and writes a durable audit event.

### Key Decisions

1. Use route constant `queueDependencyOverride` with path `/api/queue/:prdId/dependencies/override`; all helpers resolve it through `API_ROUTES` and `buildPath()`.
2. The public request body is `{ dependencyId: string; reason?: string }`; the public response includes `id`, `previousStatus`, `currentStatus`, `removedDependency`, `previousDependsOn`, `currentDependsOn`, and `movedToQueueRoot`.
3. The engine helper returns the PRD title for the monitor route's audit event, and the monitor forwards the supplied reason into that timestamped audit event; the route response stays on the public `QueueDependencyOverrideResponse` wire shape.
4. Waiting PRDs move back to the queue root only when `currentDependsOn.length === 0`; remaining dependencies keep the PRD in `waiting/`.

## Scope

### In Scope

- Add dependency override route constant, request/response types, browser helper, Node helper, exports, and API version bump.
- Add `queue:prd:dependency-overridden` daemon-scoped persisted event schema, registry metadata, summary, and projection that updates an existing queue item's `dependsOn`; the event carries `prdId`, `title`, `removedDependency`, `previousDependsOn`, `currentDependsOn`, optional `reason`, and a timestamp.
- Implement engine queue-control mutation for pending and waiting PRDs only.
- Implement monitor route validation, local mutation security, queue mutation notification, error mapping, and durable audit event emission.
- Add route/helper/schema/engine tests for validation, conflicts, frontmatter rewrite, waiting-to-root movement, scheduler notification, and audit persistence.

### Out of Scope

- Bulk removal of all dependencies.
- Overrides for running, failed, or skipped PRDs.
- Automatic risk assessment for dependency safety.
- Pi, MCP, or CLI queue override tools.

## Files

### Create

- None expected.

### Modify

- `packages/client/src/routes/route-map.ts` — add `queueDependencyOverride` route constant.
- `packages/client/src/routes/queue-control.ts` — add `QueueDependencyOverrideRequest` and `QueueDependencyOverrideResponse`.
- `packages/client/src/routes.ts`, `packages/client/src/index.ts`, `packages/client/src/browser.ts` — export new route types and helpers.
- `packages/client/src/browser-queue-control.ts` — add browser-safe `overrideQueueDependency` helper using `API_ROUTES` and `buildPath()`.
- `packages/client/src/api/queue.ts` — add `apiOverrideQueueDependency` and `apiOverrideQueueDependencyIfRunning`.
- `packages/client/src/api-version-const.ts` and `test/daemon-api-version.test.ts` — bump `DAEMON_API_VERSION` to 56 with a rationale for the dependency override route/event contract.
- `packages/client/src/events/queue-events.ts` — add `queue:prd:dependency-overridden` event variant.
- `packages/client/src/event-registry.ts` — register the audit event as daemon-scoped persisted and delegate its projector to the queue projection helper.
- `packages/client/src/event-projections/queue.ts` — add dependency override audit projection.
- `packages/console-ui/src/lib/run-state/handlers/index.ts` — add the audit event to ignored run-state event types.
- `packages/engine/src/queue/control.ts` — add `overrideQueuedPrdDependency` with validation, dependency rewrite, optional waiting-to-root movement, and conflict errors.
- `packages/monitor/src/routes/queue-control.ts` — add POST handler with `localMutation('Queue control mutations')`, JSON validation, engine delegation, notification, and audit emission.
- `packages/monitor/src/routes/control-monitor.ts` — register `queueDependencyOverride` in control route keys.
- `packages/monitor/src/__tests__/routes-control-registration.test.ts` — include the new sensitive route key.
- `packages/monitor/src/__tests__/routes-queue-control.test.ts` — cover route validation, conflicts, success, notification, and audit event persistence.
- `test/prd-queue.test.ts` — cover engine helper behavior for pending and waiting queue files.
- `test/browser-queue-control-helpers.test.ts` — cover browser helper method, route, body, and error text.
- `test/client-no-start-api-helpers.test.ts` — cover Node helper method, route, body, passive no-daemon behavior, and version short-circuit.
- `packages/client/src/__tests__/events-schemas.test.ts` and/or `packages/client/src/__tests__/events-schemas-queue-landing-stack.test.ts` — cover new event schema, registry persistence, summary, and projector.
- `packages/client/src/__tests__/events-wire-parity-valid-fixtures.ts` — add a valid audit event fixture.
- `web/content/reference/api.md`, `web/public/reference/api.md`, `web/content/reference/events.md`, and `web/public/reference/events.md` — update generated references only if `pnpm docs:check` reports drift.

## Verification

- [ ] `API_ROUTES.queueDependencyOverride` equals `/api/queue/:prdId/dependencies/override`, and all helpers resolve it with `buildPath()`.
- [ ] Invalid `prdId` or `dependencyId` requests return HTTP 400 before queue files are mutated.
- [ ] Running, failed, and skipped targets return HTTP 409.
- [ ] Pending or waiting targets that do not list the requested dependency return HTTP 409.
- [ ] A successful override removes the dependency id from `depends_on` frontmatter and returns previous/current dependency arrays.
- [ ] A successful override of the only dependency on a `waiting/` PRD removes the file from `waiting/` and creates it in the queue root.
- [ ] A successful override records exactly one `notifyQueueMutation('external')` call.
- [ ] A successful override persists one `queue:prd:dependency-overridden` daemon event containing `prdId`, `title`, `removedDependency`, `previousDependsOn`, `currentDependsOn`, a timestamp, and the supplied `reason` when the request includes one.
- [ ] `DAEMON_API_VERSION` is 56 and the version guard test name states the dependency override route/event rationale.
- [ ] `packages/engine/src/queue/control.ts` stays under 600 lines or extracts overflow into a focused helper file.