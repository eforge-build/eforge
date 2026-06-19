---
id: plan-05-console-ux
name: Now dashboard failed-enqueue attention, re-enqueue UX,
  held/capability-driven queue controls, scheduler pause/resume, and cascade
  preview confirmations.
branch: improve-recovery-failed-enqueue-and-queue-control-ux/console-ux
---

# Console UX

## Architecture Reference

This module implements the Console side of **Failed enqueue integration**, **Queue control integration**, **Queue item control metadata**, **Queue hold/unhold**, **Queue cascade remove/cancel**, **Scheduler pause/resume**, and the Console consumer side of **Projection parity** from the architecture.

Key constraints from architecture:
- Console consumes route constants, browser helpers, event/snapshot fields, and wire types from `@eforge-build/client/browser`; it does not inline `/api/...` paths or redeclare daemon wire shapes.
- Failed-enqueue attention comes from durable `FailedEnqueueInfo[]` projections keyed by `runId`, not from the transient recent-activity ring.
- Snapshot and live failed-enqueue data dedupe by `runId`; resolved failed enqueues disappear from the Needs attention strip.
- Queue action availability and disabled text come from daemon-authored `QueueItemCapabilities`; Console does not duplicate scheduler/queue rules.
- Held queue rows display held state and remain in their existing selector order.
- Remove and cancel are preview-first flows. Dependent mutation requires an explicit cascade strategy plus confirmation; the default target-only path refuses when dependents exist.
- Scheduler pause/resume is separate from the auto-build desired-state toggle. Pause leaves auto-build enabled and prevents new launches; already-running builds continue unless explicitly cancelled.
- Existing priority, remove, and dependency-override route behavior remains compatible, but the new UI must prefer client-owned queue control helpers and capability-bearing projections.
- `packages/console-ui/src/lib/selectors/now.ts` is over 1,000 lines; use bounded exact edits only and move new logic into focused helper modules when possible.

## Scope

### In Scope
- Extend Console state ingestion for `failedEnqueues` from stream snapshots, live daemon events, and explicit REST refreshes.
- Add failed-enqueue Needs attention rows with run/session identity, source label, failure reason, timestamp, confirmed re-enqueue action, disabled fallback text, and next command/path.
- Add re-enqueue action handling that calls the client browser helper with `{ confirm: true }` and refreshes failed-enqueue, queue, and run data after success.
- Propagate queue `hold` and `capabilities` metadata through Now queue selectors and view models.
- Display held state for held pending/waiting rows.
- Render priority, dependency override, hold, unhold, remove, cascade-remove, cancel, and cascade-cancel controls from capability metadata, including disabled reasons.
- Add preview/apply confirmation dialogs for queue remove/cancel cascade flows.
- Add scheduler pause/resume controls in the Console header, backed by client browser helpers and current `AutoBuildState`.
- Refresh queue/run/failed-enqueue data after the new mutations that require refreshed projections.
- Add focused selector, reducer, component, and dashboard tests for failed enqueue, held rows, capability-driven disabled states, confirmations, refresh behavior, scheduler pause/resume, and cascade previews.

### Out of Scope
- Client route constants, request/response types, browser helpers, event schemas, and API versioning; those are owned by `client-contracts`.
- Daemon route handlers, validation/security, failed-enqueue persistence, queue projection, snapshot/live parity assembly, and auto-build supervisor wiring; those are owned by `daemon-routes-projections`.
- Engine queue hold/cascade/cancel primitives and recovery-guidance patching.
- CLI, MCP, Pi, and Claude plugin command exposure.
- Public documentation updates; those are owned by `docs-validation`.
- Broad route redesign or moving Queue/Attention out of the Now dashboard shell.

## Implementation Approach

### Overview

Implement Console UX as a set of small state, hook, selector, and component changes that consume the contracts produced by the dependency modules. Keep the high-risk Now selector and project reducer edits bounded, and place new UI behavior in focused files under `components/now/`, `components/header/`, and `hooks/`.

The implementation has six parts:

1. **State ingestion and refreshes** — store `failedEnqueues` in `ConsoleProjectState`, seed it from stream hello snapshots, let client event-registry projectors update it on live failed-enqueue events, and expose explicit queue/run/failed-enqueue refresh helpers from `useDaemonEvents()`.
2. **Failed-enqueue attention** — add a failed-enqueue attention candidate keyed by `runId`, render a distinct `Enqueue failed` row, confirm one-click re-enqueue when `canReenqueue` is true, and display disabled reason plus `nextCommand` when source data is unavailable.
3. **Queue view models** — pass `hold` and `capabilities` from `QueueItem` into `NowQueueItem`, `NowQueueStackItem`, and active-build queue-control metadata without redefining daemon wire shapes.
4. **Queue controls** — add reusable hold/unhold and cascade action components. All buttons read daemon-authored capabilities and render disabled reasons from those capabilities. Cascade dialogs call preview first, then apply `target-only` or `cascade-dependents` with the preview token.
5. **Scheduler controls** — extend the auto-build hook and header with pause/resume actions that update `AutoBuildState` from the route response while leaving the existing enable/disable toggle intact.
6. **Tests** — cover reducer projection, selectors, row components, queue card controls, dashboard refresh wiring, and header scheduler controls with real components and route-aware fetch stubs.

### State Ingestion and Refresh Flow

Extend `ConsoleProjectState` with:

- `failedEnqueues: FailedEnqueueInfo[]`

Update reducer behavior:

- `SNAPSHOT_RECEIVED` sets `failedEnqueues` from `snapshot.failedEnqueues ?? []`, deduped by `runId` and sorted by newest `failedAt` first.
- `EVENT_RECEIVED` includes `failedEnqueues` in the `ProjectableState` passed to `daemonEventProjectorRegistry`. The client-owned `daemon:failed-enqueue:upsert` and `daemon:failed-enqueue:resolved` projectors update the field through the existing delta spread.
- `FAILED_ENQUEUES_REFRESH_RECEIVED` replaces the field with a deduped list from `fetchFailedEnqueues()`.
- `RUNS_REFRESH_RECEIVED` replaces `runs` from `GET /api/runs` using `API_ROUTES.runs`.
- Existing `QUEUE_REFRESH_RECEIVED` remains the queue refresh path and continues to update queue-depth projections.

Create a small helper module for dedupe/sort so `project-state.ts` stays bounded:

- `dedupeFailedEnqueuesByRunId(items)` keeps the newest row per `runId`; when a resolved and unresolved row collide, keep the row with `resolvedAt` so the selector can hide it.
- `sortFailedEnqueuesForAttention(items)` sorts unresolved rows by `failedAt` descending and tie-breaks by `runId` ascending.

Expose these new methods from `useDaemonEvents()`:

- `refreshRuns(): Promise<void>` — fetches `API_ROUTES.runs`, dispatches `RUNS_REFRESH_RECEIVED`.
- `refreshFailedEnqueues(): Promise<void>` — calls `fetchFailedEnqueues()`, dispatches `FAILED_ENQUEUES_REFRESH_RECEIVED`.

`refreshQueue()` continues to fetch `API_ROUTES.queue`; do not inline route strings.

### Failed-Enqueue Attention and Re-enqueue UX

Extend `NowAttentionItem` with:

- `failedEnqueue?: FailedEnqueueInfo`

Update `selectNowAttentionItems(...)` with a focused call to a helper such as `failedEnqueueAttentionCandidates(state.failedEnqueues)`:

- Filter out entries with `resolvedAt`.
- Candidate id: `failed-enqueue-${runId}`.
- Dedup key: `failed-enqueue:${runId}`.
- Severity: `warning`.
- Message: `Enqueue failed: ${sourceLabel}`.
- Detail includes the failure reason and formatted failed timestamp.
- The `failedEnqueue` payload is the client-owned `FailedEnqueueInfo` object.

Render in `AttentionPanel` before generic health rows:

- Badge text: `Enqueue failed`.
- Primary label: `sourceLabel`.
- Detail line contains `failureReason`, `failedAt`, `runId`, and `sessionId` when present.
- If `canReenqueue === true` and re-enqueue controls are provided, render `Re-enqueue…` that opens an `AlertDialog`; only dialog confirmation calls `onReenqueue(failedEnqueue)`.
- While a run id is pending, label the button `Re-enqueuing…` and disable it.
- Row-local re-enqueue errors render with `role="alert"`.
- If `canReenqueue === false`, render a disabled action state containing `disabledReason` and a visible `nextCommand` code span.

Create `useFailedEnqueueActions(...)` to keep `NowDashboard` small:

- Inputs: `refreshQueue`, `refreshRuns`, and `refreshFailedEnqueues`.
- State: `pendingRunId`, `errorsByRunId`.
- `reenqueue(failedEnqueue)` calls `reenqueueFailedEnqueue(failedEnqueue.runId, { confirm: true })`.
- If the response has `enqueued === true`, clear the run error and `await Promise.all([refreshQueue(), refreshRuns(), refreshFailedEnqueues()])`.
- If the response has `enqueued === false`, store `disabledReason ?? 'Re-enqueue was not accepted by the daemon.'` and call `refreshFailedEnqueues()`.
- If the helper rejects, store the thrown message and skip queue/run refreshes.

### Queue Capability and Held-State View Models

Update queue selectors to preserve daemon metadata:

- `NowQueueItem` adds `hold?: QueueItem['hold']` and `capabilities?: QueueItem['capabilities']`.
- `NowQueueStackItem` adds the same fields.
- `NowActiveBuildCard` adds optional `queueControl?: { prdId: string; title: string; capabilities?: QueueItem['capabilities'] }` for running PRD cancel controls on active build cards.
- `toNowQueueItem(...)` and stack item mapping pass through `hold` and `capabilities` from the original `QueueItem`.
- `selectNowActiveBuildCards(...)` accepts a queue item map keyed by `planSet`/PRD id instead of only a title map, then attaches `queueControl` when the active run maps to a queue item.

Create `components/now/queue-capability.ts` for UI-facing helpers:

- `capabilityOrUnavailable(capability)` returns the capability when present, otherwise `{ allowed: false, reason: 'Capability metadata unavailable from daemon.' }`.
- `capabilityReason(capability)` returns a non-empty disabled reason.
- `isHeld(hold)` returns `hold?.held === true`.

The UI must not infer whether an action is safe from status strings beyond deciding where a row belongs visually. Action enablement uses the capability metadata.

### Queue Row Controls

Extend `QueueRowActionCallbacks` to include:

- `onHold?: (id: string, reason?: string) => Promise<void> | void`
- `onUnhold?: (id: string) => Promise<void> | void`
- `onPreviewCascade?: (id: string, operation: QueueCascadeOperation) => Promise<QueueCascadePreviewResponse>`
- `onApplyCascade?: (id: string, request: QueueCascadeApplyRequest) => Promise<QueueCascadeApplyResponse>`

Keep `onSetPriority` and `onOverrideDependency` callback signatures unchanged. Replace the UI's use of legacy `onRemove` with the preview/apply cascade callbacks for remove. The legacy remove browser helper remains exported and tested by the client module; Console's destructive remove control uses the new two-phase flow.

Create reusable components:

- `QueueActionDisabledReason` — renders capability reasons in a consistent small text style and connects buttons with `aria-describedby`.
- `QueueHoldAction` — renders either `Hold…` or `Unhold…`, opens a confirmation dialog, optionally captures a hold reason for hold, calls `onHold`/`onUnhold`, and keeps the dialog open when the callback rejects.
- `QueueCascadeAction` — renders remove/cancel triggers, loads preview on dialog open, displays target/dependents/warnings/blockers, sends apply only after confirmation, and renders refusal/blocker text when `applied === false`.

`QueueCascadeAction` behavior:

- Calls `onPreviewCascade(id, operation)` when the dialog opens; no preview request happens during render.
- Displays `expectedAffected.prdIds` count and each dependent's `prdId`, `title`, `status`, `effect`, `depth`, and blockers.
- Default strategy is `target-only`.
- With dependents present, the first target-only confirmation calls apply and surfaces the daemon refusal without dependent mutation.
- The operator can select `cascade-dependents`; the confirm action is disabled until `confirmDependents` is checked.
- `confirmDependents` is `true` only when the cascade checkbox is checked.
- On an `applied: true` response, closes the dialog and calls an optional `onApplied(response)` so the parent can refresh projections.
- On helper rejection or `applied: false`, keeps the dialog open and renders an error/refusal message.

Update queue row rendering:

- Pending/waiting loose rows display status, `Held` badge when held, priority, dependency text, hold reason, and row actions.
- Stack rows display the same held badge/reason for pending/waiting items.
- Running stack rows and active build cards can render the cancel cascade action when `queueControl.capabilities.cancel` or `queueControl.capabilities.cascadeCancel` allows it; otherwise they render disabled reason text when a cancel callback is present.
- Priority input/button is disabled when `capabilities.priority.allowed === false` and the reason is visible.
- Remove target-only and cascade remove actions are disabled from `capabilities.remove` and `capabilities.cascadeRemove` reasons.
- Cancel and cascade cancel actions are disabled from `capabilities.cancel` and `capabilities.cascadeCancel` reasons.
- Dependency override is disabled from `capabilities.dependencyOverride` reason.
- Hold/unhold is disabled from `capabilities.hold` or `capabilities.unhold` reason.

Create `useQueueControlActions(...)`:

- Inputs: `refreshQueue`, optional `refreshRuns`.
- `setPriority(id, priority)` calls `updateQueuePriority(id, { priority })`, then `refreshQueue()` after the helper resolves.
- `overrideDependency(id, dependencyId, reason)` calls `overrideQueueDependency(...)`, then `refreshQueue()` after resolution.
- `hold(id, reason)` calls `holdQueueItem(id, { reason })`, then `refreshQueue()` after resolution.
- `unhold(id)` calls `unholdQueueItem(id, {})`, then `refreshQueue()` after resolution.
- `previewCascade(id, operation)` calls `previewQueueCascade(id, { operation })` and returns the response.
- `applyCascade(id, request)` calls `applyQueueCascade(id, request)`; when `response.applied === true`, calls `refreshQueue()` and, for `request.operation === 'cancel'`, also calls `refreshRuns?.()`.
- Helper rejections propagate to row/dialog components so they can render row-local errors and skip refreshes.

### Scheduler Pause/Resume UX

Extend `useAutoBuild(...)` to return:

- `schedulerToggling: boolean`
- `schedulerError: string | null`
- `pauseScheduler(): void`
- `resumeScheduler(): void`

Behavior:

- `pauseScheduler()` is a no-op while another scheduler mutation is pending or `autoBuildState?.desired !== 'enabled'`.
- It calls `pauseScheduler()` from `@eforge-build/client/browser`, then passes the returned `AutoBuildState` to the existing `onUpdate` callback.
- `resumeScheduler()` mirrors pause using `resumeScheduler()` from the client browser helper.
- Rejections populate `schedulerError`; a later successful pause/resume clears it.

Create `components/header/scheduler-pause-control.tsx`:

- Input: `autoBuild: AutoBuildState | null`, pending/error flags, and pause/resume callbacks.
- Renders nothing when auto-build state is unknown.
- Shows `Pause scheduler` when `autoBuild.desired === 'enabled'` and `scheduler.paused !== true`.
- Shows `Resume scheduler` when `autoBuild.desired === 'enabled'` and `scheduler.paused === true` or `autoBuild.mode === 'paused'`.
- Disables the control with visible reason text when `autoBuild.desired !== 'enabled'`.
- Shows `Scheduler paused` status text while paused so operators can see auto-build remains enabled.
- Shows route errors with `role="alert"`.

Keep `AutoBuildToggle` for desired enable/disable. Update its tooltip copy to distinguish `on`, `off`, and `scheduler paused` when a paused state is passed in.

### Key Decisions

1. **Store failed enqueues as first-class Console state.** Recent activity is capped and cannot be the source of durable attention; a state field fed by snapshot/live/REST matches daemon projection semantics.
2. **Use client event-registry projectors for live failed-enqueue updates.** Console avoids custom live-event mutation rules; the client package remains the owner of event projection behavior.
3. **Fail closed when capability metadata is missing.** Production v72 snapshots include capabilities; missing metadata disables mutating controls with a visible `Capability metadata unavailable from daemon.` reason.
4. **Use new cascade APIs for Console remove/cancel.** This gives remove and cancel a single preview/confirmation path and avoids accidental dependent mutation.
5. **Keep mutation helpers in hooks, not presentational components.** Row/dialog components receive callbacks and never import fetch routes directly; hooks call client browser helpers and own post-success refreshes.
6. **Put scheduler pause in the header beside auto-build.** Pause is daemon-wide scheduler state, so it belongs near the existing auto-build desired-state toggle rather than on a single queue row.
7. **Do not update docs in this module.** Documentation is intentionally owned by `docs-validation`, so this module focuses on implementation and tests.

## Files

### Create
- `packages/console-ui/src/lib/failed-enqueues.ts` — dedupe/sort helpers for `FailedEnqueueInfo[]` and failed-enqueue attention candidate helpers.
- `packages/console-ui/src/components/now/failed-enqueue-row.tsx` — distinct Needs attention row with confirmed re-enqueue and disabled fallback rendering.
- `packages/console-ui/src/components/now/queue-capability.ts` — capability fallback/reason helpers shared by queue row components.
- `packages/console-ui/src/components/now/queue-action-disabled-reason.tsx` — shared disabled-reason renderer for capability-disabled controls.
- `packages/console-ui/src/components/now/queue-hold-action.tsx` — hold/unhold confirmation controls with optional hold reason input.
- `packages/console-ui/src/components/now/queue-cascade-action.tsx` — preview-first remove/cancel cascade dialog and apply confirmation flow.
- `packages/console-ui/src/components/header/scheduler-pause-control.tsx` — header scheduler pause/resume control and status/error rendering.
- `packages/console-ui/src/hooks/use-failed-enqueue-actions.ts` — confirmed re-enqueue action state, errors, and refresh orchestration.
- `packages/console-ui/src/hooks/use-queue-control-actions.ts` — queue priority, dependency override, hold/unhold, cascade preview/apply callbacks and refresh orchestration.
- `packages/console-ui/src/__tests__/project-state-failed-enqueues.test.ts` — reducer snapshot/live/refresh dedupe coverage for failed enqueues.
- `packages/console-ui/src/__tests__/now-failed-enqueue-selectors.test.ts` — failed-enqueue attention selector coverage, including resolved-row omission and dedupe.
- `packages/console-ui/src/lib/selectors/__tests__/queue-capability-view-model.test.ts` — queue selector pass-through for hold/capabilities and held-order preservation.
- `packages/console-ui/src/components/now/__tests__/failed-enqueue-row.test.tsx` — row rendering, confirmation, disabled fallback, pending, and error tests.
- `packages/console-ui/src/components/now/__tests__/queue-hold-action.test.tsx` — hold/unhold confirmation, reason, disabled-reason, pending, and error tests.
- `packages/console-ui/src/components/now/__tests__/queue-cascade-action.test.tsx` — preview loading, target-only refusal, explicit cascade confirmation, blockers, and applied callback tests.
- `packages/console-ui/src/components/header/__tests__/scheduler-pause-control.test.tsx` — pause/resume labels, disabled desired-state reason, paused status, and error rendering tests.

### Modify
- `packages/console-ui/src/lib/project-state.ts` — add `failedEnqueues`, failed-enqueue refresh action, runs refresh action, snapshot ingestion, and `ProjectableState` wiring `[region: console-ux, failed-enqueue state and refresh reducer additions]`.
- `packages/console-ui/src/hooks/use-daemon-events.ts` — expose `refreshRuns()` and `refreshFailedEnqueues()` using client route constants/helpers; keep `refreshQueue()` source-compatible.
- `packages/console-ui/src/hooks/use-auto-build.ts` — add scheduler pause/resume helper calls, pending/error state, and returned callbacks.
- `packages/console-ui/src/app.tsx` — pass `refreshRuns`, `refreshFailedEnqueues`, scheduler pending/error/callbacks, and updated auto-build state through to Now/Header surfaces.
- `packages/console-ui/src/components/shell/console-shell.tsx` — pass scheduler-control props to `Header`.
- `packages/console-ui/src/components/header/header.tsx` — render `SchedulerPauseControl` beside `AutoBuildToggle` and pass full auto-build state.
- `packages/console-ui/src/components/header/auto-build-toggle.tsx` — update tooltip/status copy for paused scheduler state while preserving enable confirmation behavior.
- `packages/console-ui/src/lib/selectors/now.ts` — add failed-enqueue attention candidates, `failedEnqueue` payload type, queue-control metadata on active build cards, and model wiring with bounded edits only `[region: console-ux, failed-enqueue attention and queue-control view model additions]`.
- `packages/console-ui/src/lib/selectors/queue-summary.ts` — include `hold` and `capabilities` on `NowQueueItem`.
- `packages/console-ui/src/lib/selectors/queue-stacks.ts` — include `hold` and `capabilities` on `NowQueueStackItem`; preserve existing topological/order sorting.
- `packages/console-ui/src/components/now/attention-panel.tsx` — add failed-enqueue controls prop and delegate row rendering to `FailedEnqueueRow`.
- `packages/console-ui/src/components/now/queue-row-actions.tsx` — accept capability/hold metadata and render priority, dependency override, hold/unhold, remove/cascade, and cancel controls through the new helper components.
- `packages/console-ui/src/components/now/queue-card.tsx` — pass hold/capability metadata and new queue action callbacks into loose rows.
- `packages/console-ui/src/components/now/queue-stack-card.tsx` — pass hold/capability metadata and new queue action callbacks into stack rows; add cancel controls for running stack rows when capabilities allow.
- `packages/console-ui/src/components/now/active-builds-grid.tsx` — pass queue cascade callbacks through to active build cards.
- `packages/console-ui/src/components/now/active-build-card.tsx` — render optional PRD cancel/cascade control from `card.queueControl` while keeping existing session cancel button.
- `packages/console-ui/src/views/now-dashboard.tsx` — use `useQueueControlActions()` and `useFailedEnqueueActions()`, pass failed-enqueue controls to `AttentionPanel`, pass queue callbacks to Queue/ActiveBuild components, and remove direct queue-helper imports.
- `packages/console-ui/src/test-support/factories.ts` — add `makeQueueCapabilities()` and let `makeQueue()` accept capability overrides without requiring every existing fixture to hand-author capabilities.
- `packages/console-ui/src/__tests__/now-selectors.test.ts` — add or adjust coverage for held queue rows, capability pass-through, failed-enqueue attention ordering, and active-build queue-control metadata.
- `packages/console-ui/src/__tests__/project-state.test.ts` — add snapshot/refresh cases if they fit; otherwise keep failed-enqueue reducer cases in the new focused test file.
- `packages/console-ui/src/__tests__/now-dashboard.test.tsx` — convert queue mutation coverage to route-aware fetch stubs where practical; add re-enqueue, hold/unhold, cascade apply, disabled reason, and refresh-after-mutation assertions.
- `packages/console-ui/src/__tests__/header.test.tsx` — add integration coverage for header scheduler pause/resume status without changing auto-build enable/disable confirmation tests.
- `packages/console-ui/src/components/now/__tests__/attention-panel.test.tsx` — add failed-enqueue row delegation, confirmed re-enqueue, disabled fallback, pending, and error assertions.
- `packages/console-ui/src/components/now/__tests__/queue-card.test.tsx` — update fixtures to include capabilities; add held rows, disabled reasons, hold/unhold controls, and cascade trigger rendering.
- `packages/console-ui/src/components/now/__tests__/queue-stack-card.test.tsx` — add held stack rows and running PRD cancel capability rendering coverage.
- `packages/console-ui/src/components/now/__tests__/active-build-card.test.tsx` if created or existing active-build card tests are extended — add optional PRD cancel control coverage sourced from active-build queue-control metadata.

## Testing Strategy

### Unit Tests
- `dedupeFailedEnqueuesByRunId()` collapses duplicate `runId` entries and keeps resolved metadata when present.
- `consoleProjectReducer` seeds `failedEnqueues` from `SNAPSHOT_RECEIVED`, applies live `daemon:failed-enqueue:upsert`, applies live `daemon:failed-enqueue:resolved`, and replaces rows on `FAILED_ENQUEUES_REFRESH_RECEIVED`.
- `selectNowAttentionItems()` emits one `failed-enqueue-${runId}` item per unresolved failed enqueue and hides resolved entries.
- Failed-enqueue selector detail includes `sourceLabel`, `failureReason`, `failedAt`, `runId`, and `sessionId` when present.
- `selectNowAttentionItems()` dedupes failed enqueue candidates by `runId` across snapshot and live updates.
- `selectNowQueueSummary()` passes `hold` and `capabilities` into `NowQueueItem` and keeps held items in the same priority/created/dependency order as unheld items.
- `selectNowQueueStacks()` passes `hold` and `capabilities` into `NowQueueStackItem` for pending, waiting, and running rows.
- `selectNowActiveBuildCards()` attaches `queueControl` when a running run's `planSet` matches a queue item id.
- `capabilityOrUnavailable()` returns a denied capability with the exact unavailable-metadata reason when input is undefined.
- `useAutoBuild()` calls client scheduler pause/resume helpers, updates auto-build state from the response, and records helper errors.

### Component Tests
- `FailedEnqueueRow` renders `Enqueue failed`, source label, failure reason, timestamp, run id, and session id.
- `FailedEnqueueRow` opens a confirmation dialog and calls `onReenqueue` only after the dialog action is clicked.
- `FailedEnqueueRow` renders disabled reason and `nextCommand` when `canReenqueue` is false.
- `QueueHoldAction` passes the trimmed hold reason to `onHold` and calls `onUnhold` only after confirmation.
- `QueueHoldAction` disables controls and renders the capability reason when hold/unhold is denied.
- `QueueCascadeAction` performs no preview fetch during render, calls preview when opened, lists affected dependents, and sends `target-only` apply by default.
- `QueueCascadeAction` requires the cascade confirmation checkbox before sending `strategy: 'cascade-dependents'` with `confirmDependents: true`.
- `QueueCascadeAction` keeps the dialog open and renders blockers/refusal text when apply returns `applied: false`.
- `QueueCard` displays a `Held` badge and hold reason for held pending/waiting rows.
- `QueueCard` disables priority/remove/cascade/hold controls using capability reasons from the row view model.
- `QueueStackCard` renders cancel controls for running stack rows only when cancel or cascade-cancel capabilities allow them.
- `ActiveBuildCard` renders the existing session cancel button and the optional PRD cancel/cascade control as distinct controls when `queueControl` exists.
- `SchedulerPauseControl` renders `Pause scheduler`, `Resume scheduler`, disabled desired-state reason, paused status text, and route error text for the corresponding props.

### Integration Tests
- `NowDashboard` calls `reenqueueFailedEnqueue(runId, { confirm: true })` after failed-enqueue confirmation and then refreshes failed-enqueue, queue, and run data after an `enqueued: true` response.
- `NowDashboard` stores and displays the disabled re-enqueue reason when the helper returns `enqueued: false`.
- `NowDashboard` calls `holdQueueItem`, `unholdQueueItem`, `previewQueueCascade`, and `applyQueueCascade` through real client browser helpers with route-aware fetch stubs; no test adds inline route literals.
- Successful hold/unhold mutations refresh queue data after the helper resolves and do not refresh before resolution.
- Successful cascade remove/cancel apply refreshes queue data after the helper resolves; cancel apply also refreshes run data.
- Helper rejection from priority, dependency override, hold/unhold, cascade preview/apply, and re-enqueue renders component-local error text and skips the corresponding refresh.
- Header scheduler pause calls the client pause helper, updates the displayed state to paused from the returned `AutoBuildState`, and leaves the auto-build switch checked.
- Header scheduler resume calls the client resume helper and updates the displayed state to unpaused from the returned `AutoBuildState`.

## Verification

- [ ] `ConsoleProjectState` includes `failedEnqueues: FailedEnqueueInfo[]` initialized to `[]`.
- [ ] `SNAPSHOT_RECEIVED` replaces failed enqueues from `snapshot.failedEnqueues` and dedupes duplicate `runId` rows.
- [ ] Live `daemon:failed-enqueue:upsert` updates Console state through `daemonEventProjectorRegistry`.
- [ ] Live `daemon:failed-enqueue:resolved` sets `resolvedAt` on the matching Console failed-enqueue row.
- [ ] `refreshFailedEnqueues()` calls the client browser failed-enqueue helper and dispatches `FAILED_ENQUEUES_REFRESH_RECEIVED`.
- [ ] `refreshRuns()` fetches `API_ROUTES.runs` and dispatches `RUNS_REFRESH_RECEIVED`.
- [ ] Needs attention renders `Enqueue failed` for each unresolved failed enqueue row.
- [ ] The failed-enqueue row displays source label, failure reason, failed timestamp, run id, and session id when present.
- [ ] A row with `canReenqueue === true` renders a `Re-enqueue…` confirmation flow.
- [ ] Re-enqueue confirmation calls `reenqueueFailedEnqueue(runId, { confirm: true })`.
- [ ] Successful re-enqueue refreshes queue data exactly once in the dashboard test.
- [ ] Successful re-enqueue refreshes run data exactly once in the dashboard test.
- [ ] Successful re-enqueue refreshes failed-enqueue data exactly once in the dashboard test.
- [ ] A row with `canReenqueue === false` displays `disabledReason` and `nextCommand`.
- [ ] Resolved failed enqueue rows do not appear in Needs attention.
- [ ] Duplicate failed enqueue rows with the same `runId` produce one Needs attention row.
- [ ] `NowQueueItem` includes `hold` and `capabilities` copied from `QueueItem`.
- [ ] `NowQueueStackItem` includes `hold` and `capabilities` copied from `QueueItem`.
- [ ] Held pending and waiting rows display a `Held` badge.
- [ ] Held rows display the daemon hold reason when `hold.reason` is present.
- [ ] Held rows keep the same selector order as the underlying queue order rules.
- [ ] Priority controls are disabled when `capabilities.priority.allowed === false`.
- [ ] Disabled priority controls display `capabilities.priority.reason`.
- [ ] Remove controls are disabled when `capabilities.remove.allowed === false`.
- [ ] Disabled remove controls display `capabilities.remove.reason`.
- [ ] Cascade controls are disabled when the matching cascade capability has `allowed === false`.
- [ ] Disabled cascade controls display the matching cascade capability reason.
- [ ] Hold controls are disabled when `capabilities.hold.allowed === false`.
- [ ] Unhold controls are disabled when `capabilities.unhold.allowed === false`.
- [ ] Queue cascade preview runs only after the operator opens the cascade dialog.
- [ ] Queue cascade apply sends `strategy: 'target-only'` before any cascade checkbox is selected.
- [ ] Queue cascade apply sends `strategy: 'cascade-dependents'` and `confirmDependents: true` only after the cascade checkbox is selected.
- [ ] Queue cascade refusal keeps the dialog open and displays the daemon refusal text.
- [ ] Queue cascade success closes the dialog and triggers queue refresh.
- [ ] Cancel cascade success triggers run refresh in addition to queue refresh.
- [ ] Running active-build PRD cancel controls render only when active-build queue-control metadata exists.
- [ ] Scheduler pause control is visible when `autoBuild.desired === 'enabled'`.
- [ ] Scheduler pause calls the client pause helper and displays paused status from the returned `AutoBuildState`.
- [ ] Scheduler resume calls the client resume helper and displays unpaused status from the returned `AutoBuildState`.
- [ ] The auto-build switch stays checked when scheduler state is paused and desired auto-build is enabled.
- [ ] Scheduler pause/resume controls are disabled with a visible reason when desired auto-build is disabled.
- [ ] Console files introduced by this module contain no inline string matching `"/api/`.
- [ ] `packages/console-ui/src/lib/selectors/now.ts` receives bounded edits only; new helper logic lives outside the file.
- [ ] `pnpm type-check` exits 0.
- [ ] `pnpm test` exits 0.
- [ ] `pnpm maintainability:check` exits 0.

<build-config>
{
  "build": ["test-write", "implement", "test-cycle", "review-cycle"],
  "review": {
    "strategy": "parallel",
    "perspectives": ["code", "test"],
    "maxRounds": 2,
    "evaluatorStrictness": "standard"
  }
}
</build-config>
