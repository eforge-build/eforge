---
id: plan-01-queue-removal-signal
name: Emit Queue Removal Signal
branch: fix-removed-queue-coverage-cleanup/plan-01-queue-removal-signal
---

# Emit Queue Removal Signal

## Architecture Context

Queue removal is initiated through the daemon `DELETE /api/queue/:prdId` route and shared by Console, CLI, MCP, and Pi through the daemon client contract. The engine queue-control helper already performs the filesystem-side removal and protects against running/racing items. eforge-plan can only keep canonical coverage in sync if the successful daemon removal produces a lifecycle signal that extension hooks can observe.

The client package owns event wire contracts and API route constants. Keep route paths and response shapes in `@eforge-build/client`; do not add direct Console/CLI/MCP/Pi cleanup paths unless the shared daemon response contract changes.

## Implementation

### Overview

Add a `queue:prd:removed` event variant to the shared client event contract and emit it from the daemon queue-removal route only after `removeQueuedPrd` succeeds. Preserve the current `QueueRemoveResponse` shape so existing removal surfaces continue to call the same daemon API without client-specific changes.

### Key Decisions

1. Use a daemon event rather than per-client cleanup logic because Console, CLI, MCP, and Pi already converge on the daemon removal route.
2. Include the removed PRD id and prior queue status in the event so eforge-plan can locate canonical rows by PRD id and tests can distinguish failed, pending, waiting, and skipped removals.
3. Emit no event for not-found, dependency-conflict, race-to-running, or running-refusal outcomes; those outcomes leave queue coverage live or unknown and must not trigger canonical cleanup.

## Scope

### In Scope

- Shared `EforgeEvent`/TypeBox variant for successful queue PRD removal.
- Daemon route emission for successful `DELETE /api/queue/:prdId` removals.
- Tests for event emission and non-emission branches.
- Verification that the existing queue removal response contract remains stable.

### Out of Scope

- eforge-plan canonical cleanup and projection filtering; that is implemented in `plan-02-eforge-plan-cleanup`.
- Running build cancellation.
- Queue dependency semantic changes.
- Direct Console, CLI, MCP, or Pi behavior changes when the response contract is unchanged.

## Files

### Create

- `test/queue-removal-events.test.ts` — route/event regression coverage if no existing queue-control route test is a better fit.

### Modify

- `packages/client/src/events/queue.ts` — add the `queue:prd:removed` TypeBox event variant. Suggested fields: `type`, `prdId`, `previousStatus`, optional `removedSidecars`; keep fields serializable and derived from `QueueRemoveResponse`.
- `packages/client/src/events.schemas.ts` or adjacent event registry files — update only if the event union/registry is not assembled automatically from `queueEventVariants`.
- `packages/monitor/src/routes/queue-control.ts` — after a successful `removeQueuedPrd` call in the DELETE route, call `writeDaemonEvent` with `queue:prd:removed` before returning the JSON response. Leave error branches unchanged.
- Existing queue-control tests under `test/` — extend them if they already provide daemon route, lock, and sidecar fixtures.
- `packages/client/src/routes/queue-control.ts` — inspect but change only if the event needs a reusable status type import; do not alter `QueueRemoveResponse` unless required by TypeScript.

## Database Migration

No database migration is required.

## Verification

- [ ] `safeParseEforgeEvent` accepts a `queue:prd:removed` event with `prdId` and `previousStatus` from the queue-control status union.
- [ ] A successful daemon removal returns `currentStatus: 'removed'` with the pre-existing response fields intact.
- [ ] A successful failed queue-item removal emits exactly one `queue:prd:removed` event containing the removed PRD id.
- [ ] A successful pending, waiting, or skipped queue-item removal emits `queue:prd:removed` with the matching `previousStatus`.
- [ ] A not-found removal attempt emits zero `queue:prd:removed` events.
- [ ] A dependency-conflict removal attempt emits zero `queue:prd:removed` events.
- [ ] A running-refusal or race-to-running removal attempt emits zero `queue:prd:removed` events.
- [ ] `pnpm type-check` passes after the event variant and route changes.
