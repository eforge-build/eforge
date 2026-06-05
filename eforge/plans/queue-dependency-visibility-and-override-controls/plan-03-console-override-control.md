---
id: plan-03-console-override-control
name: Console Dependency Override Control
branch: queue-dependency-visibility-and-override-controls/plan-03-console-override-control
---

# Console Dependency Override Control

## Architecture Context

Console queue rows already render dependency labels from `NowQueueItem.dependsOn` and stack rows from `NowQueueStackItem.dependsOn`. This plan adds a row-scoped risky action that calls the browser-safe client helper from plan 02 and refreshes queue state through the existing `refreshQueue` callback.

## Implementation

### Overview

Extend the shared queue row action component with an `Override dependency` confirmation dialog. Wire the action into loose pending/waiting queue rows and dependency-stack pending/waiting rows when they have at least one dependency. Add a NowDashboard handler that calls `overrideQueueDependency` and refreshes queue state after success.

### Key Decisions

1. Keep override as a per-row action next to Set priority and Remove for the first slice.
2. Hide the action unless the row is pending or waiting and has at least one dependency id.
3. For multiple dependencies, require the user to choose the dependency id in the confirmation dialog before invoking the mutation.
4. The confirmation copy states that the action bypasses queue dependency ordering and that pre-PR merge/reconciliation must handle overlap.

## Scope

### In Scope

- Add `onOverrideDependency` callback plumbing to queue row actions, queue card rows, stack rows, and NowDashboard.
- Add confirmation UI with dependency selection and optional reason text.
- Call `overrideQueueDependency(id, { dependencyId, reason })` and run `refreshQueue` only after helper success.
- Add component and dashboard tests for action visibility, confirmation, helper invocation, refresh timing, and failure handling.

### Out of Scope

- Global queue dependency override controls.
- Bulk dependency override UX.
- New Console routes or navigation.
- Pi, MCP, or CLI queue override tools.

## Files

### Create

- None expected.

### Modify

- `packages/console-ui/src/components/now/queue-row-actions.tsx` — add override callback prop, dependency selection state, optional reason field, confirmation dialog, pending/error handling, and risk copy.
- `packages/console-ui/src/components/now/queue-card.tsx` — pass dependency ids and override callback to loose pending/waiting rows.
- `packages/console-ui/src/components/now/queue-stack-card.tsx` — pass dependency ids and override callback to stack pending/waiting rows.
- `packages/console-ui/src/views/now-dashboard.tsx` — import `overrideQueueDependency`, call it from a new queue mutation handler, and refresh queue state after success.
- `packages/console-ui/src/components/now/__tests__/queue-card.test.tsx` — cover loose-row override action visibility and confirmation callback.
- `packages/console-ui/src/components/now/__tests__/queue-stack-card.test.tsx` — cover stack-row override action visibility for waiting/pending rows and absence for running rows.
- `packages/console-ui/src/__tests__/now-dashboard.test.tsx` — exercise the browser helper through the existing test transport/fetch seam and verify success refresh timing and failure behavior without replacing `overrideQueueDependency` with a mock.

## Verification

- [ ] A blocked pending loose queue row renders `blocked by ...` text and an `Override dependency` button when `onOverrideDependency` is supplied.
- [ ] A dependency-free pending or waiting loose row does not render an `Override dependency` button.
- [ ] A waiting or pending stack row with `dependsOn.length > 0` renders an `Override dependency` button.
- [ ] A running stack row does not render `Override dependency` even when `dependsOn` is non-empty.
- [ ] The confirmation dialog text contains `bypasses queue dependency ordering` and `pre-PR merge/reconciliation must handle overlap`.
- [ ] With multiple dependencies, confirming the dialog calls `onOverrideDependency(rowId, selectedDependencyId, reason)` for the selected id.
- [ ] NowDashboard calls `overrideQueueDependency` with `{ dependencyId, reason }` and calls `refreshQueue` after the helper promise resolves.
- [ ] NowDashboard does not call `refreshQueue` when `overrideQueueDependency` rejects, and the row renders the helper error text.