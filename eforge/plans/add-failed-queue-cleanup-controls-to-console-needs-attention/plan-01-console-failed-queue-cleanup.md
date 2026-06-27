---
id: plan-01-console-failed-queue-cleanup
name: Console Failed Queue Cleanup Controls
branch: add-failed-queue-cleanup-controls-to-console-needs-attention/plan-01-console-failed-queue-cleanup
---

# Console Failed Queue Cleanup Controls

## Architecture Context

Console already receives queue-item cleanup capabilities from the daemon and already has a shared `QueueCascadeAction` component for `remove`/`cancel` preview and apply flows. This plan keeps the daemon and `@eforge-build/client` wire contract unchanged: Needs attention will carry enough selector metadata to render an existing queue cascade remove control, and `NowDashboard` will pass the existing `useQueueControlActions()` callbacks into the strip.

Key constraints:
- Route constants and queue-control wire shapes remain owned by `@eforge-build/client` / `@eforge-build/client/browser`.
- No raw `/api/...` literals, new daemon routes, or local queue-control request/response shape declarations.
- `packages/console-ui/src/lib/selectors/now.ts` is baseline-limited; keep edits bounded and keep the final file at or below its current `noGrowthCeiling` of 1031 lines.

## Implementation

### Overview

Add a failed-queue cleanup payload to `NowAttentionItem`, populate it for failed queue rows, render `Remove…` in `AttentionPanel` via `QueueCascadeAction operation="remove"`, pass queue cascade callbacks from `NowDashboard`, and refresh queue plus run/build state after successful remove cascades. Add targeted selector, component, and dashboard tests.

### Key Decisions

1. Represent cleanup metadata as `queueCleanup?: { prdId: string; prdTitle: string; capabilities?: QueueItem['capabilities'] }` so the selector preserves daemon capabilities without redeclaring wire shapes.
2. Reuse `QueueCascadeAction` for the alert dialog, preview, target-only apply, cascade-dependent confirmation, disabled capability reason, and inline error rendering.
3. Treat `remove.allowed` or `cascadeRemove.allowed` as enough to expose the cleanup flow; when neither capability is allowed, keep the disabled `Remove…` control visible with the daemon-provided reason.
4. Use a new focused selector test file instead of growing the already-large `now-selectors.test.ts`.

## Scope

### In Scope
- Add failed-queue cleanup metadata to the Now attention view model.
- Render cleanup controls for failed queue attention rows next to `Recover…` when recovery is present.
- Pass `previewCascade` and `applyCascade` from `useQueueControlActions()` into `AttentionPanel`.
- Refresh queue and run/build state after successful queue cascade `remove` operations.
- Add targeted tests for selector payloads, capability preservation, direct remove rendering, cascade-only remove rendering, AttentionPanel cancel/error flows, and dashboard apply/refresh wiring.

### Out of Scope
- Daemon route changes.
- Queue-control capability semantics changes.
- Queue-control request/response schema changes.
- `QueueRecoveryDialog` behavior changes.
- CLI, Pi extension, Claude plugin, backlog workstation, or broader Queue card layout changes.

## Files

### Create
- `packages/console-ui/src/lib/selectors/__tests__/now-attention-cleanup.test.ts` — focused selector tests for `queueCleanup` payload population, capability preservation, failed-with-verdict and failed-without-verdict rows, and accepted-success complete suppression.

### Modify
- `packages/console-ui/src/lib/selectors/now.ts` — add the optional `queueCleanup` field to `NowAttentionItem`; populate it in both failed queue item loops while leaving recovery payload logic and accepted-success complete suppression unchanged. Keep the final line count at or below 1031 by using compact bounded edits or removing nearby obsolete comment lines if needed.
- `packages/console-ui/src/components/now/attention-panel.tsx` — import `QueueCascadeAction` from the local now component and import queue cascade types from `@eforge-build/client/browser`; add a `queueCleanupControls` prop for preview/apply callbacks; render a failed queue row when `item.recovery` or `item.queueCleanup` is present; show `Recover…` only for recovery payloads and `Remove…` only for cleanup payloads with supplied queue cleanup controls.
- `packages/console-ui/src/views/now-dashboard.tsx` — pass `queueActions.previewCascade` and `queueActions.applyCascade` into `AttentionPanel` as cleanup controls.
- `packages/console-ui/src/hooks/use-queue-control-actions.ts` — after a successful `applyQueueCascade`, refresh the queue; refresh runs for both `remove` and `cancel` operations when `refreshRuns` is supplied.
- `packages/console-ui/src/components/now/__tests__/attention-panel.test.tsx` — add tests for direct `remove.allowed` cleanup rendering, cascade-only `cascadeRemove.allowed` cleanup rendering, disabled reason rendering, confirmation cancel with no apply call, and inline preview/apply error rendering through injected callbacks.
- `packages/console-ui/src/__tests__/now-dashboard.test.tsx` — add dashboard wiring tests for a failed queue attention row: `Remove…` calls shared preview/apply helpers through the hook, successful apply refreshes queue and runs, and the row disappears when the refresh callback updates the supplied project state.
- `packages/console-ui/src/components/now/__tests__/queue-cascade-action.test.tsx` — modify only if `QueueCascadeAction` itself changes; existing tests already cover cascade preview, explicit dependent confirmation, daemon refusal, and denied capability reason.

## Implementation Notes

### Selector changes
- Add `queueCleanup` adjacent to the existing `recovery` field in `NowAttentionItem`.
- For failed-with-verdict and failed-without-verdict candidates, include:
  - `prdId: item.id`
  - `prdTitle: label`
  - `capabilities: item.capabilities`
- Do not add `queueCleanup` to skipped, blocked, system, extension trust, or failed-enqueue attention items.
- Leave `isAcceptedSuccessComplete()` filtering in place so accepted-success completed rows never surface cleanup metadata.

### AttentionPanel changes
- Avoid local queue-control response/request shape declarations. Import types such as `QueueCascadeApplyRequest`, `QueueCascadeApplyResponse`, `QueueCascadeOperation`, and `QueueCascadePreviewResponse` from `@eforge-build/client/browser` if callback typing is needed.
- Refactor the current `RecoveryRow` into a failed queue row component that accepts the full `NowAttentionItem` plus `onRecover` and `queueCleanupControls`.
- Preserve current recovery chip/dispatch text behavior for rows with `recovery`.
- For rows with `queueCleanup`, render:
  - `QueueCascadeAction itemId={queueCleanup.prdId}`
  - `itemTitle={queueCleanup.prdTitle}`
  - `operation="remove"`
  - `capability={queueCleanup.capabilities?.remove}`
  - `cascadeCapability={queueCleanup.capabilities?.cascadeRemove}`
  - the supplied preview/apply callbacks
- Keep `Recover…` and `Remove…` as separate controls.

### Dashboard and refresh changes
- Construct `queueCleanupControls` from `queueActions.previewCascade` and `queueActions.applyCascade` in `NowDashboard`.
- In `useQueueControlActions.applyCascade`, refresh runs when `request.operation` is `'remove'` or `'cancel'`; keep refreshes gated on `response.applied === true`.
- Do not trigger builds or recovery flows from cleanup.

### Test coverage
- Selector tests in the new file must assert exact `queueCleanup` payloads and exact capability object preservation.
- AttentionPanel tests must use injected preview/apply callbacks and real `QueueCascadeAction` behavior, including the AlertDialog cancel path.
- AttentionPanel tests must include a direct remove case with `capabilities.remove.allowed === true` and a cascade-only case with `capabilities.remove.allowed === false` plus `capabilities.cascadeRemove.allowed === true`.
- Dashboard tests must mock `previewQueueCascade` and `applyQueueCascade` from `@eforge-build/client/browser`, not route literals.
- If a dashboard test needs to prove the row disappears after refresh, wrap `NowDashboard` in a small test component whose `refreshQueue` callback updates `projectState.queue` to omit the failed item.

## Database Migration

No database migration.

## Verification

- [ ] `pnpm maintainability:check` exits 0, including the `now.ts` no-growth ceiling.
- [ ] `pnpm type-check` exits 0.
- [ ] `pnpm vitest run packages/console-ui/src/lib/selectors/__tests__/now-attention-cleanup.test.ts packages/console-ui/src/components/now/__tests__/attention-panel.test.tsx packages/console-ui/src/__tests__/now-dashboard.test.tsx` exits 0.
- [ ] Selector tests assert `queueCleanup` for failed queue rows with and without recovery verdicts.
- [ ] Selector tests assert `QueueItem['capabilities']` object identity or deep equality is preserved in `queueCleanup.capabilities`.
- [ ] AttentionPanel tests assert `Recover…` and `Remove…` render on the same failed row when both payloads exist.
- [ ] AttentionPanel tests assert `Remove…` renders for a failed row with `capabilities.remove.allowed === true`.
- [ ] AttentionPanel tests assert `Remove…` renders for a failed row with `capabilities.remove.allowed === false` and `capabilities.cascadeRemove.allowed === true`.
- [ ] AttentionPanel tests assert a denied cleanup capability renders the daemon reason inline.
- [ ] AttentionPanel tests assert AlertDialog cancel leaves the apply callback uncalled.
- [ ] AttentionPanel tests assert preview and apply failures render `role="alert"` text and leave the dialog open.
- [ ] Dashboard tests assert successful failed-row cleanup calls `previewQueueCascade`, `applyQueueCascade`, `refreshQueue`, and `refreshRuns` without a page reload.
- [ ] No new raw `/api/...` route literal exists in Console source.
- [ ] No new local queue-control request/response wire shape declaration exists in Console source.