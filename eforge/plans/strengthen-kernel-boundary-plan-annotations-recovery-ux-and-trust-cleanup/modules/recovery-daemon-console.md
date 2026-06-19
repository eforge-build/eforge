# Recovery Daemon Console

## Architecture Reference

This module implements the `recovery-daemon-console` integration contract from the architecture, especially the sections named **Queue dispatch failure event**, **Queue item dispatch failure projection**, **Queue recovery preflight and repairs**, and **Client-owned wire contracts**.

Key constraints from the architecture:
- Recovery event, route, queue item, recovery request, recovery response, and repair-action wire contracts live in `@eforge-build/client`.
- This module consumes the contracts produced by `recovery-contracts-and-engine`; it does not add new client wire shapes unless dependency integration exposes a compile-time gap.
- Daemon REST handlers and `stream:hello` snapshots project queue data through the same queue-item path.
- Daemon and Console code import shared recovery and queue types from `@eforge-build/client` / `@eforge-build/client/browser`; they do not redeclare local wire interfaces.
- Pre-session dispatch blockers are rendered from durable events and imported queue projections, not inferred independently in Console.
- Queue-cascade recovery repair actions are explicit operator choices. Dependency removal and `stack_parent` selection are never applied as silent defaults.
- Queue-cascade recovery requeues the existing PRD artifact; frontmatter is preserved unless the operator selects a repair action.

Dependency handoff assumptions from `recovery-contracts-and-engine`:
- `QueueItem` has optional `dispatchFailure?: QueueDispatchFailureProjection`.
- `QueueRecoveryAnalyzeResponse` has optional `dependencyClassifications`, `dispatchPreflight`, and `availableRepairActions` fields.
- `QueueRecoveryApplyRequest` has optional `repairActions` and a dependency-removal confirmation field. This plan uses the field name `confirmRemoveDependsOn`; if the dependency module lands a different exported field name, use the field from `QueueRecoveryApplyRequest` everywhere in this module and do not add an alias.
- Repair action objects use the client-owned union exported from `@eforge-build/client`: `remove-depends-on` actions identify `targetPrdId` and `dependencyIds`; `set-stack-parent` actions identify `targetPrdId` and `stackParentPrdId`.

## Scope

### In Scope
- Overlay persisted `queue:prd:dispatch-failed` events onto daemon queue projections for failed queue items.
- Return `dispatchFailure` through `GET /api/queue` and `stream:hello.queue` without adding a daemon-local queue item interface.
- Pass recovery `repairActions` and dependency-removal confirmation from daemon queue recovery routes to the engine-owned queue recovery implementation.
- Validate recovery route JSON at the boundary without duplicating client-owned request/response type declarations.
- Render pre-session dispatch failure details in the Console Needs attention strip and recovery dialog.
- Render dependency classifications, dispatch preflight blockers/warnings, available repair actions, selected repairs, and repair results in the Console advanced queue-cascade recovery section.
- Require explicit UI selection for satisfied dependency removal and `stack_parent` persistence.
- Disable or block queue-cascade apply when required `stack_parent` choices remain unselected.
- Update Console and daemon guard tests so future local recovery wire-shape redeclarations fail.
- Update `packages/console-ui/README.md` to reflect the enhanced recovery UX.

### Out of Scope
- Defining or changing client event schemas, route constants, queue item wire fields, or queue recovery contract types. Those are owned by `recovery-contracts-and-engine`.
- Emitting `queue:prd:dispatch-failed` from the engine or scheduler.
- Changing engine dependency classification, preflight, repair eligibility, metadata mutation, or file move semantics.
- Adding new recovery strategies beyond `retry-and-reactivate-descendants`.
- Regenerating public docs, JSON schemas, LLM bundles, or generated reference artifacts.
- Moving recovery state into Console-only storage.
- Auto-selecting a dependency removal or `stack_parent` repair.

## Implementation Approach

### Overview

Treat this module as a projection-and-rendering layer over the recovery contracts from `@eforge-build/client` and behavior from `@eforge-build/engine/queue/recovery-cascade`.

Daemon work has two tracks:

1. Queue projection: load queue files as today, then overlay the latest persisted `queue:prd:dispatch-failed` event for matching failed queue items before returning REST or `stream:hello` queue data.
2. Queue recovery routes: keep `API_ROUTES.queueRecoveryAnalyze` and `API_ROUTES.queueRecoveryApply`, pass the new client-owned repair fields to the engine, and return the engine response without reshaping it.

Console work has three tracks:

1. Project state and attention: rely on the client event projector for live `dispatchFailure` deltas, add the new queue event to the session run-state ignored list, and surface the imported `QueueItem.dispatchFailure` field in Needs attention.
2. Recovery dialog: add a dispatch-blocker callout and render preflight details in the existing advanced queue-cascade section.
3. Repair controls: split repair-state derivation from TSX rendering so the UI can be tested with pure data and the existing `advanced-cascade-section.tsx` file stays bounded.

### Key Decisions

1. **Overlay dispatch failures at daemon projection edges.** The queue filesystem remains the source for queue membership and status. Persisted dispatch-failure events contribute only `dispatchFailure` metadata to failed queue items whose ids still match current failed rows. Pending, waiting, running, skipped, completed, or requeued rows do not inherit stale `dispatchFailure` data.
2. **Use one projection helper for REST and `stream:hello`.** `GET /api/queue` and daemon SSE hello snapshots call the same overlay helper after `loadQueueItems` / `loadQueueItemsSync`, preserving existing REST/SSE parity tests.
3. **Keep routes additive and typed.** Queue recovery route paths stay unchanged. The route imports `QueueRecoveryApplyRequest`, `QueueRecoveryRepairAction`, and `QueueRecoveryOperation` from the client package, validates only boundary safety, and passes request fields through to engine code.
4. **Let engine validate repair semantics.** The daemon route rejects malformed JSON, unsafe path segments, non-array `repairActions`, and invalid action discriminants. The engine remains the authority for satisfied dependency eligibility, `stack_parent` validity, operation drift, and final preflight refusal.
5. **Render blockers from wire data only.** Console displays `dispatchFailure`, `dependencyClassifications`, and `dispatchPreflight` from imported wire types. It does not recompute dependency status or dispatch validation from queue frontmatter.
6. **Require deliberate repair selection.** Removal checkboxes start unchecked. `stack_parent` selectors start empty unless the response already has `currentStackParent`. The apply request includes dependency-removal confirmation only after the operator confirms the dialog.
7. **Show preserved-artifact copy in the destructive confirmation.** The confirmation text lists selected metadata repairs, explains that queue-cascade recovery requeues the existing PRD artifact, and states that frontmatter is preserved unless listed repairs apply.
8. **Keep UI state local but not wire-shaped.** New Console helper types describe view state and selection keys; exported daemon/recovery wire structures stay imported from `@eforge-build/client/browser`.
9. **Avoid growth in legacy oversized files.** `packages/console-ui/src/lib/selectors/now.ts` is over 1,000 lines, so edits there must be small exact replacements. Put new formatting and repair derivation logic in new focused files.

## Files

### Create
- `packages/monitor/src/projections/queue-dispatch-failures.ts` — hydrate persisted daemon events, derive latest `queue:prd:dispatch-failed` per PRD id, and overlay `QueueItem['dispatchFailure']` onto matching failed queue items.
- `packages/monitor/src/__tests__/queue-dispatch-failure-projection.test.ts` — assert queue projection overlay behavior, stale-event suppression for requeued items, `GET /api/queue` output, and `buildDaemonHello(...).snapshot.queue` output.
- `packages/monitor/src/__tests__/queue-recovery-wire-guard.test.ts` — scan monitor source for local declarations of client-owned queue recovery / dispatch failure wire shapes.
- `packages/console-ui/src/lib/selectors/queue-dispatch-failure.ts` — format imported `QueueItem['dispatchFailure']` values for attention details and recovery callouts.
- `packages/console-ui/src/__tests__/now-dispatch-failure-selectors.test.ts` — assert failed queue attention items carry and label dispatch failure metadata.
- `packages/console-ui/src/components/recovery/queue-cascade-repair-state.ts` — pure helpers that derive dependency rows, repair-selection keys, selected `QueueRecoveryRepairAction[]`, unresolved preflight blockers, and apply-disabled reasons from imported queue recovery response types.
- `packages/console-ui/src/components/recovery/queue-cascade-repair-panel.tsx` — presentational panel for dependency classifications, dispatch preflight, repair controls, selected-repair summaries, and repair results. Keep this file under 300 lines; if implementation crosses 300 lines, add durable semantic `// --- eforge:region <semantic-slug> ---` markers rather than temporary plan markers.
- `packages/console-ui/src/components/recovery/__tests__/queue-cascade-repair-state.test.ts` — assert repair derivation groups satisfied dependency removals by target PRD, requires per-target `stack_parent` choices, and emits the selected client-owned repair actions.

### Modify
- `packages/monitor/src/routes/monitor-data.ts` — overlay queue dispatch failures on `GET /api/queue` responses by calling the new projection helper with `context.db.getDaemonEventsAfter(0)`.
- `packages/monitor/src/streams/daemon-stream.ts` — overlay queue dispatch failures on `stream:hello.queue` with the same helper used by `GET /api/queue`.
- `packages/monitor/src/routes/queue-recovery.ts` — import client-owned recovery request/repair types; validate optional `repairActions` and dependency-removal confirmation; pass `repairActions`, confirmation, and the current config/stacking context through to `analyzeQueueRecovery` / `applyQueueRecovery`; notify queue mutation when operation or repair results report applied mutations.
- `packages/monitor/src/__tests__/routes-queue-recovery.test.ts` — add route-level validation cases for malformed repair actions, unsafe repair ids, and accepted repair-action bodies.
- `test/queue-recovery-route.test.ts` — add daemon integration coverage for a recovery apply request that includes selected repair actions and receives `repairResults` / final preflight data from the engine response.
- `packages/console-ui/src/lib/run-state/handlers/index.ts` — add `queue:prd:dispatch-failed` to `IGNORED_EVENT_TYPES` so the run-state exhaustiveness check remains explicit after the client event union expands.
- `packages/console-ui/src/lib/selectors/now.ts` — bounded edits only: import dispatch-failure formatting, add `dispatchFailure?: QueueItem['dispatchFailure']` to failed-PRD recovery payloads, and include dispatch failure text in failed queue attention details.
- `packages/console-ui/src/components/now/attention-panel.tsx` — render dispatch failure reason/stage on failed recovery rows and keep `onRecover` payloads typed from `NowAttentionItem['recovery']`.
- `packages/console-ui/src/components/now/queue-recovery-dialog.tsx` — accept `dispatchFailure` from the selected attention item and pass it to `RecoveryReportPanel`.
- `packages/console-ui/src/views/now-dashboard.tsx` — pass `recoveryItem?.dispatchFailure` into `QueueRecoveryDialog`.
- `packages/console-ui/src/components/recovery/recovery-report-panel.tsx` — render a pre-session dispatch blocker callout and pass recovery analysis props to the enhanced advanced queue-cascade section.
- `packages/console-ui/src/components/recovery/advanced-cascade-section.tsx` — import the new repair-state helpers/panel; maintain analysis loading/apply lifecycle; build apply requests with selected `repairActions` and dependency-removal confirmation; render dependency/preflight/repair content; render repair results from apply responses.
- `packages/console-ui/src/components/now/__tests__/attention-panel.test.tsx` — assert dispatch blocker text appears in a recovery row and is included in the recovery payload delivered to `onRecover`.
- `packages/console-ui/src/components/now/__tests__/queue-recovery-dialog.test.tsx` — extend queue recovery fixtures with dependency classifications, dispatch preflight, available repair actions, and repair results; assert repair controls, confirmation copy, disabled states, and apply request payloads.
- `packages/console-ui/src/__tests__/guards.test.ts` — extend guards to fail on local declarations of `QueueDispatchFailureProjection`, `QueueRecoveryDependencyInfo`, `QueueRecoveryDependencyStatus`, `QueueRecoveryDispatchPreflight*`, `QueueRecoveryRepairAction`, or `QueueRecoveryRepairResult`.
- `packages/console-ui/README.md` — update the Now dashboard recovery section with dispatch blockers, dependency classification, explicit dependency-removal confirmation, explicit `stack_parent` selection, and preserved-frontmatter copy.

No files listed in the architecture Shared File Registry are modified by this module.

## Implementation Steps

1. **Add daemon dispatch-failure queue overlay.**
   - Implement `latestQueueDispatchFailuresFromEvents(rows)` using `hydrateEforgeEvent(row)` and `Extract<EforgeEvent, { type: 'queue:prd:dispatch-failed' }>`.
   - Store only the newest event per `prdId` by event timestamp or row id; row id wins when timestamps tie.
   - Implement `overlayQueueDispatchFailures(items, rows)` returning the original array when no item changes and copying only failed items with matching latest events.
   - Do not overlay failures onto non-failed items, completed accepted-success projections, or skipped items.

2. **Use the overlay in daemon queue responses.**
   - In `monitor-data.ts`, replace the direct `loadQueueItems(...)` response with `overlayQueueDispatchFailures(await loadQueueItems(...), context.db.getDaemonEventsAfter(0))`.
   - In `daemon-stream.ts`, use the same overlay around `loadQueueItemsSync(...)` when building `DaemonStreamSnapshot.queue`.
   - Leave `countPendingQueueDepth` and heartbeat queue depth unchanged; dispatch failure metadata does not alter queue depth.

3. **Extend queue recovery route parsing.**
   - Import `type QueueRecoveryApplyRequest`, `type QueueRecoveryOperation`, and `type QueueRecoveryRepairAction` from `@eforge-build/client`.
   - Keep `validateExpectedOperations` as the operation boundary validator.
   - Add `validateRepairActions(value, res): QueueRecoveryApplyRequest['repairActions'] | null | undefined` that accepts `undefined` or arrays of client-owned action discriminants and rejects unsafe ids.
   - Add a boolean parser for the dependency-removal confirmation field; reject non-boolean values when present.
   - Pass `repairActions` and confirmation through to `applyQueueRecovery` without reshaping response data.
   - If dependency engine options require stacking config, pass `context.options.config` or the exact config subset accepted by the upstream options type.

4. **Project new queue event in Console state.**
   - Rely on `daemonEventProjectorRegistry` deriving the projector from client `eventRegistry` for live `queue:prd:dispatch-failed` events.
   - Add the event to `IGNORED_EVENT_TYPES` in the run-state handler registry because it is daemon-wide queue metadata, not per-session timeline state.
   - Add selector tests that start with `ConsoleProjectState.queue` containing a failed item with `dispatchFailure`.

5. **Surface dispatch blockers in Needs attention.**
   - Extend `NowAttentionItem['recovery']` with `dispatchFailure?: QueueItem['dispatchFailure']`.
   - Use `formatQueueDispatchFailure(...)` for detail text such as `Dispatch blocked before session:start (stacking-validation): <reason>`.
   - For failed items that also have a recovery verdict, keep verdict/confidence available while adding dispatch blocker detail.
   - For failed items without a recovery verdict, replace plain `recovery pending` detail with the dispatch blocker detail when `dispatchFailure` exists.

6. **Render recovery dialog dispatch callout.**
   - Pass `dispatchFailure` from `NowDashboard` to `QueueRecoveryDialog` and `RecoveryReportPanel`.
   - Render a callout above the sidecar report when present, including stage, timestamp, and reason.
   - Keep existing sidecar, continue-and-repair, accepted-success, and analysis actions available; the callout is informational unless advanced preflight data disables queue-cascade apply.

7. **Add repair-state helper and panel.**
   - In `queue-cascade-repair-state.ts`, derive:
     - dependency rows grouped by target PRD id;
     - selectable satisfied dependency removal keys from `availableRepairActions`;
     - per-target stack-parent candidates from `dispatchPreflight` and `availableRepairActions`;
     - unresolved preflight blocker strings for targets that still require a stack-parent choice after selected removals;
     - selected `QueueRecoveryRepairAction[]` for the apply request;
     - a boolean indicating whether dependency removal confirmation is required.
   - In `queue-cascade-repair-panel.tsx`, render:
     - dependency classification badges for `blocking`, `satisfied`, `terminal`, and `stale-historical`;
     - dispatch preflight `canApply`, blockers, warnings, and target-level stacking details;
     - unchecked removal controls for satisfied dependencies;
     - a per-target `stack_parent` selector when multiple meaningful dependencies remain;
     - selected repair summary text showing before/after intent;
     - repair result rows after apply.

8. **Wire repair controls into `AdvancedCascadeSection`.**
   - Reset repair-selection state when a new analysis loads or `prdId` changes.
   - Keep lazy analysis loading behavior unchanged.
   - Compute `canApply` from loading/applying state, planned operations, non-repairable blockers, unresolved repair-selection blockers, and prior applied result.
   - On confirmed apply, send `selectedPrdId`, `strategy`, `expectedOperations`, selected `repairActions`, and dependency-removal confirmation.
   - Preserve existing completion behavior: refresh queue only after an applied response, and show non-applied blockers in-place.

9. **Update tests and docs.**
   - Add monitor projection and route tests before or alongside implementation.
   - Add Console pure-helper, selector, and component tests around the new UI.
   - Update Console README after UI labels are final so the prose matches rendered copy.

## Testing Strategy

### Unit Tests
- Monitor projection tests for latest dispatch failure selection, failed-only overlay, stale event suppression after requeue, and malformed persisted event ignoring.
- Monitor source guard test for local declarations of client-owned recovery and dispatch-failure wire types.
- Console selector tests for failed queue items with `dispatchFailure`, with and without recovery verdicts.
- Console repair-state helper tests for satisfied dependency removal grouping, dependency-removal confirmation flag derivation, stack-parent choice requirements, and selected repair action output.
- Console component tests for dependency classification rendering, preflight blocker rendering, repair result rendering, and dispatch callout rendering.

### Integration Tests
- Daemon route test where `GET /api/queue` returns a failed item with `dispatchFailure` from a persisted `queue:prd:dispatch-failed` row.
- Daemon snapshot test where `buildDaemonHello(...).snapshot.queue` includes the same `dispatchFailure` projection as `GET /api/queue`.
- Daemon queue recovery route test where a valid apply body containing `repairActions` and dependency-removal confirmation reaches the engine and returns `repairResults`.
- Console dialog test where selecting a satisfied dependency removal and a `stack_parent` option sends an apply request containing client-owned repair actions only after the confirmation button is clicked.
- Console dialog test where an unresolved stack-parent requirement leaves the apply trigger disabled and displays the preflight blocker text.

### Targeted Commands
- `pnpm vitest run packages/monitor/src/__tests__/queue-dispatch-failure-projection.test.ts packages/monitor/src/__tests__/routes-queue-recovery.test.ts packages/monitor/src/__tests__/queue-recovery-wire-guard.test.ts test/queue-recovery-route.test.ts`
- `pnpm --filter @eforge-build/console-ui test -- --run packages/console-ui/src/__tests__/now-dispatch-failure-selectors.test.ts packages/console-ui/src/components/recovery/__tests__/queue-cascade-repair-state.test.ts packages/console-ui/src/components/now/__tests__/attention-panel.test.tsx packages/console-ui/src/components/now/__tests__/queue-recovery-dialog.test.tsx packages/console-ui/src/__tests__/guards.test.ts`
- `pnpm type-check`
- `pnpm maintainability:check`

## Verification

- [ ] `GET /api/queue` returns `dispatchFailure.reason`, `dispatchFailure.stage`, and `dispatchFailure.timestamp` for a failed queue item with a persisted `queue:prd:dispatch-failed` event.
- [ ] `GET /api/queue` omits `dispatchFailure` for a pending queue item with the same PRD id as an older persisted dispatch-failure event.
- [ ] `buildDaemonHello(...).snapshot.queue` deep-equals `GET /api/queue` output for queue items with dispatch failure metadata.
- [ ] `stream:hello.recentActivity` includes the persisted `queue:prd:dispatch-failed` event when it is inside the recent activity window.
- [ ] Queue recovery analyze route accepts the existing request body and returns the new optional preflight fields from the engine without renaming them.
- [ ] Queue recovery apply route rejects malformed `repairActions` with HTTP 400 before calling engine recovery.
- [ ] Queue recovery apply route passes valid `repairActions` and dependency-removal confirmation to engine recovery and returns `repairResults` in the JSON response.
- [ ] Monitor source guard reports zero local declarations of `QueueDispatchFailureProjection`, `QueueRecoveryDependencyInfo`, `QueueRecoveryDependencyStatus`, `QueueRecoveryDispatchPreflight*`, `QueueRecoveryRepairAction`, and `QueueRecoveryRepairResult`.
- [ ] Console reducer compiles with `queue:prd:dispatch-failed` in the client event union and the event listed in `IGNORED_EVENT_TYPES`.
- [ ] Needs attention failed-PRD rows display the dispatch failure reason when `QueueItem.dispatchFailure` is present.
- [ ] Clicking Recover on a failed-PRD row passes `dispatchFailure` into `QueueRecoveryDialog`.
- [ ] Recovery dialog displays dispatch failure stage, timestamp, and reason above the recovery report.
- [ ] Advanced queue-cascade section lists dependency classifications for `blocking`, `satisfied`, `terminal`, and `stale-historical` statuses.
- [ ] Satisfied dependency removal controls start unchecked.
- [ ] Applying with selected satisfied dependency removals includes `confirmRemoveDependsOn: true` in the apply request.
- [ ] Applying with no selected dependency removals omits dependency-removal confirmation or sends it as `false`, matching the client request type.
- [ ] A target with multiple meaningful dependencies and no selected `stack_parent` displays the preflight blocker and leaves the apply trigger disabled.
- [ ] Selecting a `stack_parent` adds a `set-stack-parent` repair action to the apply request.
- [ ] The queue-cascade confirmation text contains `requeues the existing PRD artifact`.
- [ ] The queue-cascade confirmation text contains `frontmatter is preserved unless`.
- [ ] Apply result rendering lists each `repairResults` entry with action type, target PRD id, status, and before/after metadata when provided.
- [ ] `packages/console-ui/README.md` documents dispatch blockers, dependency classifications, explicit dependency removal, explicit `stack_parent` selection, and preserved-frontmatter copy.
- [ ] Targeted monitor vitest command exits 0.
- [ ] Targeted Console vitest command exits 0.
- [ ] `pnpm type-check` exits 0.
- [ ] `pnpm maintainability:check` exits 0.

<build-config>
{
  "build": ["test-write", ["implement", "doc-author"], "test-cycle", "doc-sync", "review-cycle"],
  "review": {
    "strategy": "parallel",
    "perspectives": ["api", "test"],
    "maxRounds": 2,
    "evaluatorStrictness": "standard"
  }
}
</build-config>
