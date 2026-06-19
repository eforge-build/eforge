# Recovery Contracts and Engine

## Architecture Reference

This module implements the `recovery-contracts-and-engine` integration contract from the architecture, especially the sections named **Queue dispatch failure event**, **Queue item dispatch failure projection**, and **Queue recovery preflight and repairs**.

Key constraints from the architecture:
- Recovery event, queue item, route request, route response, and repair-action contracts live in `@eforge-build/client`.
- Engine code emits typed events and mutates queue files; daemon and Console rendering are owned by the dependent `recovery-daemon-console` module.
- Dispatch validation for stacked builds is reusable by scheduler dispatch and queue-cascade recovery preflight.
- Queue recovery never silently edits queue metadata; dependency removal and `stack_parent` selection require explicit operator-selected repair actions.
- Recovery apply refuses to move PRDs when simulated repairs still leave a known pre-session dispatch blocker.
- Additive wire fields do not require a daemon API version bump; bump `DAEMON_API_VERSION` only if implementation changes or removes an existing request/response requirement.

## Scope

### In Scope
- Add the client-owned `queue:prd:dispatch-failed` event variant, stage literals, registry entry, summaries, persisted-daemon classification, and queue-state projection support.
- Add a client-owned optional `dispatchFailure` projection on `QueueItem` and `DaemonQueueItemSchema`.
- Extend the client-owned queue recovery contract with dependency classifications, dispatch preflight summaries, available repair actions, selected repair actions, repair confirmation, and repair results.
- Extract reusable engine stacked-dispatch validation for scheduler dispatch and recovery preflight.
- Emit durable pre-session dispatch failure events for stacked dispatch validation failures, policy gate blocks, and uncaught pre-session dispatch exceptions.
- Extend engine queue-cascade analysis with dependency classification, dispatch preflight, and available repair actions.
- Extend engine queue-cascade apply with simulated repair actions, confirmation checks, metadata writes, and a final dispatch preflight before moving queue files.
- Add tests for client contracts, scheduler/legacy queue event emission, dependency classification, repair confirmation, metadata repair, and preflight refusal.

### Out of Scope
- Daemon DB overlays, REST route parsing for new repair fields, SSE snapshot construction, and Console UI. Those belong to `recovery-daemon-console`.
- Docs rewrites, generated reference artifacts, eforge-plan annotation UX, and trust config removal.
- New queue recovery strategies beyond the existing retry-and-reactivate-descendants strategy.
- Policy-gate or profile-router execution during queue-cascade preflight; this module preflights deterministic engine-owned dispatch validation.
- Silent metadata changes during recovery apply.

## Implementation Approach

### Overview

Implement the client contracts first, then wire the engine to those contracts. Keep existing queue recovery routes and operations intact: analysis still returns `nodes`, `edges`, `operations`, `warnings`, and `blockers`; apply still accepts `expectedOperations`. Add new fields as optional in exported client TypeScript interfaces for compatibility with older daemons, but have the engine always populate them.

Engine work has two tracks:

1. Dispatch failure events: extract stacked-dispatch validation from the duplicated scheduler and legacy `runQueue` code, use it before `session:start`, and emit `queue:prd:dispatch-failed` before terminal `queue:prd:complete` for pre-session failures.
2. Queue-cascade recovery preflight: classify dependencies, derive repair offers, simulate selected repairs against in-memory frontmatter, run the same stacked-dispatch validation, then apply metadata repairs only after explicit confirmation and before existing filesystem move operations.

### Key Decisions

1. **Keep recovery route paths unchanged.** Use `API_ROUTES.queueRecoveryAnalyze` and `API_ROUTES.queueRecoveryApply`; add optional request/response fields to the existing contract.
2. **Make dispatch failure stage literals client-owned.** Use the stage union `stacking-validation`, `policy-gate`, `profile-routing`, and `dispatch` in the client event schema and reuse it in engine event construction.
3. **Use a pure stacked-dispatch validation helper.** A pure helper accepts PRD id, `depends_on`, `stack_parent`, and stacking-enabled state. Scheduler wrappers may persist inferred single-dependency `stack_parent`; recovery preflight only simulates.
4. **Classify dependencies from current queue, completion, and artifact state.** Active queue entries become `blocking`, usable artifacts become `satisfied`, failed/skipped state becomes `terminal`, and unknown or completed-without-artifact entries become `stale-historical`.
5. **Offer only bounded metadata repairs.** `remove-depends-on` removes explicitly listed satisfied dependencies from the target PRD. `set-stack-parent` persists the selected parent id. Any broader metadata repair is a future module.
6. **Require confirmation for dependency removal.** Apply rejects `remove-depends-on` actions unless the request contains the confirmation flag. `set-stack-parent` requires the selected id to exist in the target PRD's current or simulated `depends_on` list.
7. **Preflight after simulation, before mutation.** Apply validates expected operations, path guards, repair eligibility, and dispatch preflight before writing repaired frontmatter or moving files.
8. **Clear stale dispatch-failure projections on rediscovery.** Client queue projection preserves `dispatchFailure` for failed items and removes it when `queue:prd:discovered` reintroduces the PRD as live work.

## Contract Details

### Client event contract

Add a queue event variant with these fields:
- `type`: `queue:prd:dispatch-failed`
- `prdId`: queue PRD id
- `title`: PRD title
- `reason`: human-readable dispatch blocker
- `stage`: one of `stacking-validation`, `policy-gate`, `profile-routing`, `dispatch`
- `timestamp`: inherited from `EventEnvelopeSchema`

Register the event in `event-registry.ts` with `scope: 'daemon'` and `persist: true`. The summary must include the PRD id, stage, and reason. The queue projection must attach `dispatchFailure: { reason, stage, timestamp }` to the matching queue item, mark it failed when no later live rediscovery has occurred, and create a failed queue item if the item is absent from in-memory project state.

### Client queue item projection

Add `QueueDispatchFailureProjection` in `packages/client/src/types.ts` and add optional `dispatchFailure?: QueueDispatchFailureProjection` to `QueueItem`. Add the same optional object to `DaemonQueueItemSchema` in `packages/client/src/events/snapshots.ts` so REST and `stream:hello` snapshots share the wire shape used by Console and daemon code.

### Client queue recovery contract

Extend `packages/client/src/queue-recovery.ts` with exported types for:
- Dependency statuses: `blocking`, `satisfied`, `terminal`, `stale-historical`.
- Dependency info: target/dependent PRD id, dependency PRD id, status, reason, optional terminal kind, optional queue status, optional artifact status, optional completion timestamp.
- Dispatch preflight item: target PRD id, can-dispatch flag, blockers, warnings, stacking-enabled flag, current `stack_parent`, `meaningfulDependencyIds`, and `requiresStackParentChoice`.
- Dispatch preflight summary: aggregate `canApply`, blockers, warnings, and preflight items.
- Repair actions: `remove-depends-on` with target PRD id and dependency ids; `set-stack-parent` with target PRD id and selected parent id.
- Repair results: action, status, optional message, and before/after metadata for `depends_on` and `stack_parent`.

Extend `QueueRecoveryAnalyzeResponse` with optional `dependencyClassifications`, `dispatchPreflight`, and `availableRepairActions`. Extend `QueueRecoveryApplyRequest` with optional `repairActions` and an explicit confirmation flag for dependency removal. Extend `QueueRecoveryApplyResponse` with optional `dispatchPreflight` and `repairResults`.

## Files

### Create
- `packages/engine/src/queue/dispatch-validation.ts` — pure stacked-dispatch validation, shared failure message construction, optional single-dependency inference result, and helper construction for `queue:prd:dispatch-failed` events.
- `packages/engine/src/queue/recovery-preflight.ts` — dependency classification, repair-action validation, in-memory repair simulation, dispatch preflight construction, and frontmatter metadata summaries for queue-cascade recovery.
- `test/queue-dispatch-validation.test.ts` — focused tests for stacked-dispatch validation outcomes and dispatch-failure event payload construction.

### Modify
- `packages/client/src/events/queue-events.ts` — add dispatch failure stage schema exports and the `queue:prd:dispatch-failed` variant.
- `packages/client/src/events.schemas.ts` — re-export the new queue dispatch failure stage schema/type if a named export is added.
- `packages/client/src/events.ts` — re-export new queue dispatch failure named types for engine and consumers.
- `packages/client/src/event-registry.ts` — add the persisted daemon event entry, summary, and queue projection hook.
- `packages/client/src/event-projections/queue.ts` — add `projectQueuePrdDispatchFailed`; preserve dispatch failure on terminal failed queue items; clear dispatch failure in live rediscovery normalization.
- `packages/client/src/events/snapshots.ts` — add optional `dispatchFailure` to `DaemonQueueItemSchema`.
- `packages/client/src/types.ts` — add `QueueDispatchFailureProjection` and `QueueItem.dispatchFailure`.
- `packages/client/src/queue-recovery.ts` — add dependency classification, dispatch preflight, repair action, repair result, and confirmation request/response fields.
- `packages/client/src/index.ts` — export new queue recovery and dispatch failure projection types from the Node entrypoint.
- `packages/client/src/browser.ts` — export the same browser-safe queue recovery and queue item projection types.
- `packages/client/src/__tests__/events-schemas-queue-landing-stack.test.ts` — assert schema acceptance/rejection, registry scope/persistence, summaries, and daemon persisted-event inclusion for `queue:prd:dispatch-failed`.
- `packages/client/src/__tests__/events-wire-parity-valid-fixtures.ts` — add a valid `queue:prd:dispatch-failed` fixture.
- `packages/client/src/__tests__/events-wire-parity-invalid-fixtures.ts` — add an invalid-stage fixture.
- `packages/client/src/__tests__/queue-recovery.test.ts` — assert the new contract exports remain available from the client package and route constants remain unchanged.
- `packages/engine/src/queue/scheduler.ts` — replace local stacking validation with the shared helper; emit `queue:prd:dispatch-failed` for stack validation failures, policy gate blocks, and uncaught pre-session dispatch exceptions; keep `session:start` absent for those failures.
- `packages/engine/src/eforge.ts` — replace legacy `runQueue` local stacking validation with the shared helper and emit the same dispatch-failure event before terminal completion.
- `packages/engine/src/queue/recovery-cascade.ts` — call recovery preflight during analysis and apply; return new analysis fields; validate selected repair actions; write repaired frontmatter using existing queue frontmatter helpers; re-run preflight after simulation and before file moves; include repair results in apply responses.
- `test/artifact-aware-scheduler.test.ts` — extend ambiguous stacked dispatch tests to assert durable dispatch-failure events for `QueueScheduler` and legacy `runQueue`.
- `test/queue-scheduler-policy.test.ts` — assert policy-gate blocked dispatch emits `queue:prd:dispatch-failed` with stage `policy-gate`, reason text, no `session:start`, and failed completion.
- `test/queue-recovery-cascade.test.ts` — add tests for dependency classifications, satisfied-dependency removal confirmation, confirmed metadata repair, multiple-dependency `stack_parent` choice, and preflight refusal when simulated repairs still fail dispatch validation.

No files listed in the architecture Shared File Registry are modified by this module.

## Implementation Steps

1. Add client event schema and registry support.
   - Add the stage literals and event variant in `queue-events.ts`.
   - Add registry metadata with daemon scope and persistence.
   - Add queue projection behavior and queue item `dispatchFailure` typing.
   - Add schema/registry tests before engine code emits the new event.

2. Add client queue recovery contract fields.
   - Extend `queue-recovery.ts` with additive optional fields on existing request/response interfaces.
   - Export the new types from `index.ts` and `browser.ts`.
   - Keep route constants unchanged.

3. Extract stacked-dispatch validation.
   - Move the duplicate multiple-`depends_on` validation message into `dispatch-validation.ts`.
   - Expose a pure validation function for recovery preflight.
   - Expose an apply function that persists inferred single-dependency `stack_parent` for scheduler dispatch.
   - Add tests for disabled stacking, explicit parent, single-dependency inference, and multiple-dependency failure.

4. Emit pre-session dispatch failure events.
   - In `QueueScheduler`, update stack validation failure handling to emit the new event before `queue:prd:complete`.
   - In `QueueScheduler`, add the event for queue-dispatch policy blocks with stage `policy-gate`.
   - Track whether `session:start` has been emitted; if an exception occurs before that point, emit stage `dispatch` with the caught error message.
   - Apply the same stack validation event behavior in legacy `EforgeEngine.runQueue`.

5. Implement recovery dependency classification and preflight.
   - Load current queue records from root, `waiting`, `failed`, and `skipped`.
   - Load artifact and completion registries once per analysis/preflight.
   - Classify every dependency on the selected failed PRD and skipped descendants included in the cascade.
   - Build dispatch preflight items by applying simulated repairs to each PRD that a recovery move operation would reactivate.
   - Populate blockers when the pure stacked-dispatch validation fails.
   - Populate warnings for stale-historical dependencies that are not already blockers.

6. Implement explicit repair application.
   - Validate target PRD ids and dependency ids with the existing safe path/id checks.
   - Reject `remove-depends-on` without the confirmation flag.
   - Reject dependency removal when any listed dependency is not classified as `satisfied` for the target PRD.
   - Reject `set-stack-parent` when the selected parent id is not present in the target PRD's simulated `depends_on` list.
   - Re-run dispatch preflight after applying the simulated repairs.
   - If preflight passes, write repaired frontmatter to current failed/skipped files, then run the existing move and sidecar operations.
   - Return `repairResults` with before/after metadata and leave `operationResults` semantics unchanged.

7. Keep daemon route integration for the dependent module.
   - Do not edit monitor route parsing in this module unless a compile error is introduced by client type changes.
   - If a compile error requires a monitor edit, limit it to importing client-owned types and passing `repairActions`/confirmation through to the engine; do not add daemon-local wire interfaces.

## Testing Strategy

### Unit Tests
- Client event schema tests for `queue:prd:dispatch-failed` accepted payloads, invalid stage rejection, registry metadata, summary text, and `DAEMON_EVENT_TYPES` inclusion.
- Client queue projection tests for attaching `dispatchFailure`, preserving it through failed completion, and removing it on rediscovery.
- Pure dispatch validation tests for all stacked-dispatch branches.
- Recovery preflight tests for dependency classification statuses and validation blockers.

### Integration Tests
- Scheduler tests for ambiguous stacked PRD failure before `session:start`, including event order relative to `queue:prd:complete`.
- Scheduler policy-gate tests for `policy-gate` dispatch-failure events and no worker spawn.
- Legacy `runQueue` test for ambiguous stacked PRD dispatch failure event and failed completion registry entry.
- Queue recovery cascade tests for confirmed repair actions, no mutation without confirmation, operation drift blocking, and final preflight refusal.

### Targeted Commands
- `pnpm vitest run packages/client/src/__tests__/events-schemas-queue-landing-stack.test.ts packages/client/src/__tests__/queue-recovery.test.ts`
- `pnpm vitest run test/queue-dispatch-validation.test.ts test/artifact-aware-scheduler.test.ts test/queue-scheduler-policy.test.ts test/queue-recovery-cascade.test.ts`
- `pnpm type-check`
- `pnpm maintainability:check`

## Verification

- [ ] `safeParseEforgeEvent` accepts `queue:prd:dispatch-failed` with each declared stage literal.
- [ ] `safeParseEforgeEvent` rejects `queue:prd:dispatch-failed` with an undeclared stage literal.
- [ ] `eventRegistry['queue:prd:dispatch-failed']` has `scope: 'daemon'` and `persist: true`.
- [ ] `DAEMON_EVENT_TYPES` contains `queue:prd:dispatch-failed`.
- [ ] A dispatch-failure event projects `dispatchFailure.reason`, `dispatchFailure.stage`, and `dispatchFailure.timestamp` onto a queue item.
- [ ] `queue:prd:discovered` removes an older `dispatchFailure` projection for the same PRD id.
- [ ] `DaemonQueueItemSchema` accepts a queue item with `dispatchFailure`.
- [ ] `QueueRecoveryAnalyzeResponse` produced by `analyzeQueueRecovery` includes dependency classifications for blocking, satisfied, terminal, and stale-historical test fixtures.
- [ ] `QueueRecoveryAnalyzeResponse` produced by `analyzeQueueRecovery` includes a dispatch preflight blocker for stacking-enabled multiple `depends_on` without `stack_parent`.
- [ ] `QueueRecoveryAnalyzeResponse` produced by `analyzeQueueRecovery` includes `remove-depends-on` repair actions only for dependencies classified as `satisfied`.
- [ ] `applyQueueRecovery` rejects `remove-depends-on` repair actions when the confirmation flag is absent.
- [ ] `applyQueueRecovery` with confirmation removes only the requested satisfied dependency ids from PRD frontmatter.
- [ ] `applyQueueRecovery` with a `set-stack-parent` action writes the selected `stack_parent` to PRD frontmatter before moving the PRD.
- [ ] `applyQueueRecovery` returns `applied: false` and leaves queue files in place when simulated repairs still leave a stacked-dispatch blocker.
- [ ] `QueueScheduler` emits `queue:prd:dispatch-failed` before `queue:prd:complete` for ambiguous stacked dispatch.
- [ ] `QueueScheduler` emits no `session:start` for ambiguous stacked dispatch.
- [ ] `QueueScheduler` emits `queue:prd:dispatch-failed` with stage `policy-gate` when a queue-dispatch policy gate blocks.
- [ ] Legacy `EforgeEngine.runQueue` emits `queue:prd:dispatch-failed` for ambiguous stacked dispatch.
- [ ] `pnpm vitest run packages/client/src/__tests__/events-schemas-queue-landing-stack.test.ts packages/client/src/__tests__/queue-recovery.test.ts` exits 0.
- [ ] `pnpm vitest run test/queue-dispatch-validation.test.ts test/artifact-aware-scheduler.test.ts test/queue-scheduler-policy.test.ts test/queue-recovery-cascade.test.ts` exits 0.
- [ ] `pnpm type-check` exits 0.
- [ ] `pnpm maintainability:check` exits 0.

<build-config>
{
  "build": ["test-write", "implement", "test-cycle", "review-cycle"],
  "review": {
    "strategy": "parallel",
    "perspectives": ["api", "test"],
    "maxRounds": 2,
    "evaluatorStrictness": "standard"
  }
}
</build-config>
