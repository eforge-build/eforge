---
title: Add Failed-Queue Cleanup Controls to Console Needs Attention
created: 2026-06-27
---

# Add Failed-Queue Cleanup Controls to Console Needs Attention

## Problem / Motivation

The daemon already reports cleanup capabilities for failed queue items through `remove.allowed` and `cascadeRemove.allowed`, but the Console Needs attention card only exposes `Recover…`. Users can see a failed build but cannot remove it from the visible failed-build card, making cleanup undiscoverable and forcing CLI/agent intervention.

This feature makes Console the primary recovery surface for failed queue cleanup. Failed queue attention rows should show a capability-gated cleanup action, explain what the daemon will mutate before applying it, and refresh the visible queue/build state after success.

Build confidence is high because the daemon/client queue-control contract and `QueueCascadeAction` confirmation/error flow already exist.

## Goal

Add failed-queue cleanup controls to the Console Needs attention card while reusing existing shared queue cascade/remove APIs and avoiding daemon route or wire-contract changes.

## Approach

- Add failed-queue cleanup metadata to the Now attention view model for failed queue items, including the item id/title and daemon-provided queue capabilities.
- Render a cleanup action on failed queue rows in `AttentionPanel`, next to the existing `Recover…` action where applicable.
- Reuse shared client/daemon queue-control helpers and types from `@eforge-build/client/browser`.
- Do not inline `/api/...` route literals.
- Do not redeclare queue-control wire shapes.
- Prefer the existing cascade preview/apply flow for `operation: "remove"` so the confirmation can explain target-only vs cascade-dependent impact.
- Wire the action from `NowDashboard` through `useQueueControlActions`.
- Refresh queue and relevant build/run state after successful cleanup.
- Surface daemon refusal, preview/apply errors, and disallowed capability reasons inline.
- Keep `Recover…` and cleanup as separate actions because recovery attempts to repair/continue work, while cleanup removes the failed queue artifact from the queue surface.
- Prefer visible disabled state with daemon-provided reason over silently hiding the control, because the user then understands why cleanup is unavailable.
- Hiding remains acceptable only if layout constraints make disabled controls misleading.
- Use existing destructive `Remove…` copy initially.
- Softer `Archive` copy can be a later UI-only rename if desired.
- Treat selector-provided capabilities as display gating, but let the preview/apply daemon response remain authoritative for final mutation/refusal.
- Keep confirmation and error behavior in the existing AlertDialog pattern so keyboard/accessibility behavior stays consistent with Queue card controls.

Likely implementation touch points:

- `packages/console-ui/src/lib/selectors/now.ts`
  - Extend `NowAttentionItem` with a failed-queue cleanup payload, e.g. `queueCleanup?: { prdId: string; prdTitle: string; capabilities?: QueueItem['capabilities'] }`.
  - Populate that payload for failed queue items that are already emitted into Needs attention, including failed-with-verdict and failed-without-verdict rows.
  - Preserve existing accepted-success suppression and existing `recovery` payload behavior.
- `packages/console-ui/src/components/now/attention-panel.tsx`
  - Extend props with cleanup callbacks or a small `queueCleanupControls` object carrying preview/apply callbacks.
  - Render the cleanup control only for failed queue rows with cleanup payloads.
  - Reuse `QueueCascadeAction` with `operation="remove"`, `capability={capabilities?.remove}`, and `cascadeCapability={capabilities?.cascadeRemove}` if it fits the row layout.
  - Otherwise extract a small shared row-safe wrapper rather than duplicating cascade logic.
- `packages/console-ui/src/views/now-dashboard.tsx`
  - Pass `queueActions.previewCascade` and `queueActions.applyCascade` into `AttentionPanel` alongside existing recovery/trust/failed-enqueue controls.
- `packages/console-ui/src/hooks/use-queue-control-actions.ts`
  - Verify successful remove cascades refresh enough state.
  - Consider refreshing runs as well as queue for successful `remove` and `cancel` operations when `refreshRuns` is supplied.
- Tests:
  - Add selector tests under `packages/console-ui/src/lib/selectors` for cleanup payload and capability preservation.
  - Add or update `packages/console-ui/src/components/now/__tests__/attention-panel.test.tsx` for rendering, disabled reason, cancel, and inline errors via injected callbacks.
  - Add or update `packages/console-ui/src/__tests__/now-dashboard.test.tsx` for dashboard wiring/refresh behavior.
  - Reuse or extend `packages/console-ui/src/components/now/__tests__/queue-cascade-action.test.tsx` only if shared `QueueCascadeAction` needs new behavior.

Guardrails:

- Keep edits to large files bounded.
- Do not rewrite `now.ts` or broad dashboard tests.
- Do not add local queue-control request/response types in Console.
- Do not bypass `@eforge-build/client` route helpers.
- Do not add new daemon routes, capability semantics, or queue-control wire-contract changes.
- Do not change recovery verdict generation or `QueueRecoveryDialog` behavior.
- Do not change CLI, Pi extension, Claude plugin, or backlog workstation behavior.
- Do not perform broader Queue card layout changes beyond shared component adjustments needed for reuse.

Assumptions:

- Failed queue items have capability metadata in the queue snapshot.
- Missing capability metadata should degrade to the existing disabled unavailable-capability reason.
- The existing queue cascade API supports failed-item `remove` previews/apply responses with enough affected-item detail for confirmation copy.
- Removing a failed item should not start any build work.
- Removing a failed item only mutates queue artifacts/sidecars and refreshes Console state.

## Scope

In scope:

- Add failed-queue cleanup metadata to the Now attention view model for failed queue items, including the item id/title and daemon-provided queue capabilities.
- Render a cleanup action on failed queue rows in `AttentionPanel`, next to the existing `Recover…` action where applicable.
- Reuse existing shared client/daemon queue-control helpers and types from `@eforge-build/client/browser`.
- Avoid inlining `/api/...` route literals.
- Avoid redeclaring wire shapes.
- Prefer the existing cascade preview/apply flow for `operation: "remove"` so the confirmation can explain target-only vs cascade-dependent impact.
- Wire the action from `NowDashboard` through `useQueueControlActions`.
- Refresh queue and relevant build/run state after successful cleanup.
- Surface daemon refusal, preview/apply errors, and disallowed capability reasons inline.
- Add targeted selector, component, dashboard, and queue-control action tests covering allowed, disallowed, cancel, success, and error paths.

Out of scope:

- New daemon routes.
- New capability semantics.
- Queue-control wire-contract changes.
- Changes to recovery verdict generation.
- Changes to `QueueRecoveryDialog` behavior.
- CLI behavior.
- Pi extension behavior.
- Claude plugin behavior.
- Backlog workstation behavior.
- Broader Queue card layout changes beyond shared component adjustments needed for reuse.

## Acceptance Criteria

- A failed queue item in the Console Needs attention strip exposes a destructive cleanup control when the daemon reports `remove.allowed`.
- A failed queue item in the Console Needs attention strip exposes a destructive cleanup control when the daemon reports `cascadeRemove.allowed`.
- The cleanup action uses shared client queue-control APIs/types from `@eforge-build/client/browser`.
- The cleanup action uses `previewQueueCascade`/`applyQueueCascade` through `useQueueControlActions` if the existing cascade flow fits the row layout.
- No local `/api/...` route literals are added for queue cleanup.
- No local queue-control wire-shape declarations are added.
- Opening the cleanup control shows confirmation copy containing the failed item identity.
- Opening the cleanup control shows the daemon preview of affected PRDs.
- Dependent mutation requires explicit cascade confirmation when dependents are present.
- If removal is not allowed, the cleanup control is disabled or omitted.
- If removal is not allowed and a daemon-provided reason is visible, the reason is rendered inline.
- Cancelling or dismissing the confirmation performs no mutation.
- A successful cleanup removes the failed item from Needs attention after refresh without a page reload.
- A successful cleanup refreshes related queue/build state through existing callbacks.
- Preview failures remain inline in the card or dialog with actionable text.
- Apply failures remain inline in the card or dialog with actionable text.
- API failures remain inline in the card or dialog with actionable text.
- Preview failures do not close the dialog as if cleanup succeeded.
- Apply failures do not close the dialog as if cleanup succeeded.
- API failures do not close the dialog as if cleanup succeeded.
- Selector tests verify cleanup payload population for failed queue items.
- Selector tests verify queue capability preservation.
- Component tests verify allowed failed-item cleanup rendering.
- Component tests verify disallowed reason rendering.
- Component tests verify confirmation cancel behavior.
- Component tests verify inline error rendering via injected callbacks.
- Dashboard tests verify successful apply behavior.
- Dashboard tests verify refresh behavior after successful cleanup.
- Queue cascade action tests are reused or extended only if shared `QueueCascadeAction` behavior changes.
- `pnpm type-check` exits 0.
- `pnpm maintainability:check` exits 0.

## Manual Verification Notes

- Run targeted tests for changed Console files.
- Run the broader suite if feasible with `pnpm test`.
- Manually smoke check with a daemon failed queue item.
- Confirm Needs attention shows `Recover…` and `Remove…`.
- Confirm the preview lists affected PRDs.
- Confirm cancel does nothing.
- Confirm successful remove clears the card without a page reload.
- Confirm denied/error states stay visible inline.