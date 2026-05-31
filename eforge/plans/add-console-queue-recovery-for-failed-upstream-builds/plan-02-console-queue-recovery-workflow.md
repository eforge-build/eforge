---
id: plan-02-console-queue-recovery-workflow
name: Console Queue Recovery Workflow
branch: add-console-queue-recovery-for-failed-upstream-builds/plan-02-console-queue-recovery-workflow
---

# Console Queue Recovery Workflow

## Architecture Context

`packages/console-ui/` is the active dashboard. It consumes daemon state through the shared client/browser entrypoint and must not redeclare daemon wire shapes or inline `/api/...` literals. The live stack selector remains focused on active pending/waiting/running queues; failed/skipped terminal cascade recovery uses the queue recovery analysis response from plan 01.

This plan depends on the backend contract from plan 01.

## Implementation

### Overview

Add a Now-dashboard queue recovery affordance for failed upstreams, a shadcn-based dialog that previews daemon-planned operations, and a queue refresh path after apply so restored descendants disappear from skipped rows without waiting for a full reconnect.

### Key Decisions

1. Keep active build-stack display stable by excluding terminal `failed` and `skipped` items from active stack components; recovery uses the analyze response rather than `QueueItem.dependsOn` for terminal edges.
2. Treat `skipped` as a known queue status in selectors, summaries, attention items, and queue row rendering.
3. Put recovery UI behind an explicit user action on failed rows; no mutation occurs during render or during read-only analysis.
4. Display daemon warnings and blockers from analyze/apply verbatim, and disable apply when blockers are present.
5. Require an explicit confirmation checkbox when warnings are present so sidecar verdicts such as `manual` or low confidence remain visible before a user-directed mutation.
6. After successful apply, fetch `GET /api/queue` through a route constant and dispatch a queue refresh action so QueueCard, QueueStackCard, header queue count, and attention items reflect the restored file locations.

## Scope

### In Scope

- Console selectors count and display `skipped` as a known queue status.
- QueueCard failed rows expose a recovery inspection action.
- A new recovery dialog loads analysis, displays skipped descendants, raw edges, warnings, blockers, planned operations, apply status, and daemon errors.
- Apply sends the expected operations from the dry-run response to the daemon apply route.
- Console state refreshes queue data after successful apply.
- Console README documents the Now-dashboard queue recovery control and REST/SSE refresh flow.
- Console tests cover skipped status handling, recovery dry-run display, blocker/warning display, apply success, apply failure, and guardrails against local queue recovery wire-shape declarations.

### Out of Scope

- Changes to `packages/monitor-ui/`.
- A new top-level Console route.
- Drag-and-drop queue reordering, priority editing, or direct `depends_on` editing.
- Automatic retry without clicking apply.
- Recovery sidecar verdict application (`/api/recover/apply`) UI changes outside the cascade recovery dialog.

## Files

### Create

- `packages/console-ui/src/components/now/queue-recovery-dialog.tsx` — shadcn Dialog/AlertDialog-based workflow for loading analysis, showing cascade preview, confirmation, apply progress, success, and errors.
- `packages/console-ui/src/components/now/__tests__/queue-recovery-dialog.test.tsx` — component tests for dry-run, warning, blocker, apply success, and apply failure states.

### Modify

- `packages/console-ui/src/components/now/queue-card.tsx` — replace the display-only note with a failed-row recovery action, render skipped rows, pass selected PRD id into the dialog, and invoke queue refresh after apply.
- `packages/console-ui/src/components/now/__tests__/queue-card.test.tsx` — update no-mutation expectations so render and expand do not POST, while failed-row recovery actions are tested explicitly.
- `packages/console-ui/src/components/now/queue-stack-card.tsx` — adjust status badge handling only if terminal skipped rows appear in stack inputs; active stack behavior must remain unchanged for non-terminal queues.
- `packages/console-ui/src/lib/selectors/queue.ts` — add `skipped` to known status sets, counts, labels, and attention selection.
- `packages/console-ui/src/lib/selectors/queue-summary.ts` — add `skippedCount`, include skipped rows in displayable queue summaries, and sort terminal failed/skipped rows before active queue rows.
- `packages/console-ui/src/lib/selectors/queue-stacks.ts` — keep stack components limited to active statuses (`running`, `waiting`, `pending`) and add regression coverage that skipped/failed items do not alter existing active stacks.
- `packages/console-ui/src/lib/selectors/now.ts` — surface skipped queue items as attention items and preserve existing failed recovery verdict details.
- `packages/console-ui/src/__tests__/now-selectors.test.ts` — add skipped summary, attention, and stack regression tests.
- `packages/console-ui/src/hooks/use-daemon-events.ts` — expose a `refreshQueue` callback that fetches `API_ROUTES.queue` and dispatches a queue refresh action.
- `packages/console-ui/src/lib/project-state.ts` — add a `QUEUE_REFRESH_RECEIVED` action that replaces `state.queue` with a `QueueItem[]` fetched from the daemon.
- `packages/console-ui/src/__tests__/project-state.test.ts` — cover the new queue refresh reducer action.
- `packages/console-ui/src/app.tsx` — pass the `refreshQueue` callback into the Now dashboard.
- `packages/console-ui/src/views/now-dashboard.tsx` — pass the queue refresh callback to QueueCard.
- `packages/console-ui/src/__tests__/now-dashboard.test.tsx` — update prop fixtures if needed.
- `packages/console-ui/src/__tests__/guards.test.ts` — add a guard that rejects local `QueueRecovery*Request` or `QueueRecovery*Response` type/interface declarations in Console source; imported client types are allowed.
- `packages/console-ui/README.md` — document the queue recovery control in the Now dashboard and note that mutation goes through client-owned daemon APIs followed by a queue refresh.

## UI Behavior Details

- Failed queue rows show a compact action such as `Inspect cascade` beside the existing recovery verdict text.
- Opening the dialog calls the browser-safe analyze helper from `@eforge-build/client/browser` with `{ prdId, strategy: 'retry-and-reactivate-descendants' }`.
- While analysis is loading, the dialog shows a progress message and disables apply.
- If analysis returns skipped descendants and no blockers, the dialog displays:
  - selected failed upstream id/title,
  - skipped descendant ids/titles,
  - raw dependency edges,
  - planned operations with source and target locations,
  - warnings, if any,
  - an apply button.
- If warnings exist, the apply button remains disabled until the user checks a confirmation control acknowledging the warnings.
- If blockers exist, apply stays disabled and blockers are displayed as daemon-provided messages.
- Clicking apply posts the exact operations returned by analysis to the browser-safe apply helper.
- On `applied: true`, call `refreshQueue()` and display success text including applied operation statuses.
- On `applied: false` or fetch failure, keep the dialog open and show blocker/error text.

## Verification

- [ ] Selector tests show `skipped` counted as a known queue status in `selectQueueSummary` and `selectNowQueueSummary`.
- [ ] Stack selector tests show pending/waiting/running stack output is unchanged when unrelated failed/skipped terminal rows exist.
- [ ] Attention selector tests include skipped queue items with a warning-level attention entry.
- [ ] QueueCard tests show failed rows render an `Inspect cascade` action and render zero apply POSTs before that action is used.
- [ ] Dialog tests mock analyze success with skipped child and grandchild nodes and assert planned operations render before apply is enabled.
- [ ] Dialog tests mock analyze warnings and assert the confirmation checkbox gates apply.
- [ ] Dialog tests mock analyze blockers and assert apply remains disabled.
- [ ] Dialog tests mock apply success and assert the queue refresh callback is called once.
- [ ] Dialog tests mock apply failure and assert the daemon error or blocker text remains visible.
- [ ] Console guard tests fail when a Console source file declares a local `QueueRecovery*Request` or `QueueRecovery*Response` type/interface.
- [ ] `packages/console-ui/README.md` contains a Queue recovery note under the Console Now dashboard/data-flow documentation.
- [ ] `pnpm type-check` exits 0 after plan 02 merges.
- [ ] `pnpm maintainability:check` exits 0 after plan 02 merges.
- [ ] Relevant Console tests exit 0 before final validation.
