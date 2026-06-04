---
id: plan-03-console-queue-controls
name: Console Queue Priority and Removal Actions
branch: add-queued-prd-priority-and-removal-controls/plan-03-console-queue-controls
agents:
  builder:
    effort: high
    rationale: This plan adds interactive row actions, confirmation state, async
      error handling, and queue refresh wiring across the Now dashboard stack
      and loose queue renderers.
---

# Console Queue Priority and Removal Actions

## Architecture Context

Console must remain a renderer/controller over daemon APIs. It must not inspect queue filesystem paths, infer locks, or duplicate daemon queue wire shapes. The browser-safe queue-control helpers from `plan-01-core-queue-control` own the mutation request paths and error formatting. The Now dashboard passes callbacks down to queue components and refreshes queue state after success.

## Implementation

### Overview

Add set-priority and confirmed remove controls to forward queue rows (`pending` and `waiting`) in both loose queue rows and dependency stack rows. Running rows receive no mutation actions. Failed and skipped terminal removal stays outside Console for this first slice.

### Key Decisions

1. Keep actions row-local: each row owns its input value, pending flag, and latest error text. The parent owns daemon mutation callbacks and refresh.
2. Use native `<input type="number">` plus existing `Button` and `AlertDialog` components; no new UI dependency is needed.
3. Render actions only for `pending` and `waiting` statuses. Running, failed, and skipped rows have no Console mutation buttons in this plan.
4. Always call `refreshQueue()` after a successful browser helper call.

## Scope

### In Scope

- Pending loose queue row priority controls.
- Waiting loose queue row priority controls.
- Pending loose queue row confirmed remove controls.
- Waiting loose queue row confirmed remove controls.
- Pending and waiting stack row controls.
- Dashboard-level handlers that call browser-safe client helpers and refresh queue.
- Console component tests for action rendering, callback invocation, confirmation behavior, running-row exclusion, and refresh-after-success.

### Out of Scope

- Failed/skipped terminal removal in the Needs Attention strip.
- Running item cancellation controls.
- Queue pause, hold, or cascade controls.
- Capability metadata on queue items.
- New daemon events.

## Files

### Create

- `packages/console-ui/src/components/now/queue-row-actions.tsx` — reusable set-priority and remove-confirmation controls for loose and stack rows.

### Modify

- `packages/console-ui/src/views/now-dashboard.tsx` — import browser helpers, define mutation handlers, call `refreshQueue()` after success, and pass callbacks to `QueueCard`.
- `packages/console-ui/src/components/now/queue-card.tsx` — accept action callbacks and render row actions for pending/waiting loose rows.
- `packages/console-ui/src/components/now/queue-stack-card.tsx` — accept action callbacks and render row actions for pending/waiting stack rows.
- `packages/console-ui/src/lib/selectors/queue-stacks.ts` — if needed, align queue display sorting with lower numeric priority first and absent priority last so the visual order matches dispatch semantics.
- `packages/console-ui/src/components/now/__tests__/queue-card.test.tsx` — add loose-row action tests.
- `packages/console-ui/src/components/now/__tests__/queue-stack-card.test.tsx` — add stack-row action tests.
- `packages/console-ui/src/__tests__/now-dashboard.test.tsx` — add helper/refresh integration tests for successful priority and removal actions.

## Implementation Details

### Browser Helper Use

- Import queue control browser helpers from `@eforge-build/client/browser` in `NowDashboard`.
- Define:
  - `handleQueuePriority(id: string, priority: number)` => await browser priority helper, then await `refreshQueue?.()`.
  - `handleQueueRemove(id: string)` => await browser remove helper, then await `refreshQueue?.()`.
- Pass callbacks to `QueueCard` as optional props. If a callback is absent, hide the related action.

### Row Action Component

- Props:
  - `itemId: string`
  - `itemTitle: string`
  - `initialPriority?: number`
  - `onSetPriority?: (id: string, priority: number) => Promise<void> | void`
  - `onRemove?: (id: string) => Promise<void> | void`
- Priority action:
  - Render a small number input with `aria-label="Priority for <title>"`.
  - Render a `Set priority` button.
  - Disable the button while the promise is pending.
  - Convert input with `Number(value)` and call `onSetPriority(itemId, valueAsNumber)`. Let daemon validation reject non-integers.
- Remove action:
  - Render a `Remove` button that opens `AlertDialog`.
  - Dialog text includes the item title and id.
  - Confirm button calls `onRemove(itemId)`.
  - Disable confirm while the promise is pending.
- Error handling:
  - Catch callback errors in the row and render a small error message containing the error text.
  - Do not mutate during render.

### Queue Card and Stack Card

- Add a small action-prop interface shared by loose and stack components.
- `QueueCard` passes the actions to `QueueStacks`.
- `LooseQueueRow` renders actions only when `item.status.toLowerCase()` is `pending` or `waiting`.
- `QueueStackItemRow` renders actions only when `item.status.toLowerCase()` is `pending` or `waiting`.
- Running rows keep their current status-only presentation.

## Verification

- [ ] QueueCard tests show pending loose rows render `Set priority` and `Remove` controls.
- [ ] QueueCard tests show waiting loose rows render `Set priority` and `Remove` controls.
- [ ] QueueCard tests show running loose rows render no queue-control buttons.
- [ ] QueueCard tests confirm `onSetPriority(id, priority)` receives the row id and numeric input value after clicking `Set priority`.
- [ ] QueueCard tests confirm `onRemove(id)` runs only after the AlertDialog confirm action.
- [ ] QueueStack tests show pending and waiting stack rows render the same controls.
- [ ] QueueStack tests show running stack rows render no queue-control buttons.
- [ ] NowDashboard tests mock browser priority helper and verify `refreshQueue` is called once after helper success.
- [ ] NowDashboard tests mock browser remove helper and verify `refreshQueue` is called once after helper success.
- [ ] NowDashboard tests verify failed browser helper calls display row error text and do not call `refreshQueue`.
- [ ] Console source continues importing queue wire types from `@eforge-build/client/browser`; no local daemon queue response interface is added.
