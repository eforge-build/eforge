---
id: plan-03-console-recovery-completion-ux
name: Console Recovery Completion UX and Queue Preview
branch: fix-recovery-actions-ux-after-successor-enqueue-or-resume/plan-03-console-recovery-completion-ux
---

# Console Recovery Completion UX and Queue Preview

## Architecture Context

Plan-01 exposes durable applied recovery state and idempotent split responses. Plan-02 exposes accepted-success preview/apply helpers. Console must consume those client-owned contracts, transition recovery interactions to stable completion panels after queue-affecting mutations, and make the collapsed Queue card show forward queue work before terminal rows can consume preview slots.

Console must continue to call `refreshQueue()` after successful mutations, but a refresh failure must be secondary feedback rather than a failed mutation.

## Implementation

### Overview

Update the Now recovery dialog to render completion states for split/retry/abandon, compiled-build resume, already-applied sidecars, and accepted-success. Add the accepted-success form with required reason category, note, dependent selection, and confirmation preview. Fix the queue summary selector so `topItems`, `allItems`, `total`, and `hiddenCount` are based on pending/waiting rows before truncation. Update README and tests for the new behavior.

### Key Decisions

1. Keep data fetching and mutation state in `QueueRecoveryDialog`, and keep presentational rendering in recovery components.
2. Replace the report/actions body with a completion panel once a queue-affecting mutation succeeds or a sidecar reports durable applied state.
3. Treat `ResumeBuildResponse.status === 'already-queued'` as a success completion state.
4. Base the Queue card loose-list preview on pending/waiting rows only; failed/skipped remain in attention surfaces and running appears through active build/stack views.
5. Use client browser helpers for all recovery REST calls; do not inline `/api/...` paths.

## Scope

### In Scope

- Completion panel after sidecar apply, resume, already-applied sidecar, and accepted-success.
- Refresh-after-mutation handling that keeps success visible when refresh fails.
- Accepted-success reason/category form, dependent checkbox selection, confirmation preview, apply call, and completion display.
- Attention selector suppression or annotation for applied recovery rows so they are not rendered as ordinary `Recover…` prompts.
- Queue summary selector forward-only truncation and Queue card component contract updates.
- Console tests and README updates for user-visible behavior.

### Out of Scope

- Backend accepted-success implementation; plan-02 owns it.
- Backend split idempotency; plan-01 owns it.
- Removing failed PRDs or sidecars.
- Adding CLI, MCP, Pi, or Claude plugin commands for accepted-success.
- Building a new top-level Console route.

## Files

### Create

- `packages/console-ui/src/components/recovery/recovery-completion-panel.tsx` — shared completion rendering for sidecar apply, resume, already-applied, and accepted-success outcomes.
- `packages/console-ui/src/components/recovery/accept-success-action.tsx` — reason/category form, dependent selection, and confirmation dialog for accepted-success.

### Modify

- `packages/console-ui/src/components/now/queue-recovery-dialog.tsx` — fetch accepted-success preview, initialize completion state from `sidecar.json.applied`, handle sidecar apply/resume/accepted-success success transitions, retain completion on refresh errors, and pass new props to the panel.
- `packages/console-ui/src/components/recovery/recovery-report-panel.tsx` — remove ephemeral success-message responsibility, hide mutating sidecar actions when durable applied metadata exists, and render the accepted-success action when preview says eligible.
- `packages/console-ui/src/components/recovery/recovery-report-panel.stories.tsx` — update stories for new required props and add an accepted-success or already-applied story when useful.
- `packages/console-ui/src/lib/selectors/queue-summary.ts` — compute `topItems`, `allItems`, `total`, and `hiddenCount` from pending/waiting rows before truncation; keep counts for running/failed/skipped/recovery verdicts over the full queue.
- `packages/console-ui/src/components/now/queue-card.tsx` — align `isForwardItem()` and empty/disclosure counts with the pending/waiting selector contract.
- `packages/console-ui/src/lib/selectors/now.ts` — avoid rendering applied recovery rows as ordinary actionable recovery prompts; use bounded edits because this file is oversized.
- `packages/console-ui/src/components/now/__tests__/queue-recovery-dialog.test.tsx` — cover split completion, already-applied sidecar open, resume `already-queued`, refresh failure after mutation, and accepted-success form/apply/completion.
- `packages/console-ui/src/__tests__/now-selectors.test.ts` — update queue summary tests for pending/waiting-only top items and add applied-recovery attention behavior; use bounded edits because this test file is near the size limit.
- `packages/console-ui/src/components/now/__tests__/queue-card.test.tsx` — update Queue card tests for the forward-only selector/component contract.
- `packages/console-ui/README.md` — document completion transitions, idempotent split apply, accepted-success recovery, and forward-only Queue preview.

## Implementation Notes

- Completion state can be a discriminated union such as `sidecar-apply`, `resume`, `already-applied`, and `accepted-success`, with an optional `refreshError` string.
- In `handleApplySidecar`, call `applySidecarRecovery()`, then attempt `refreshQueue()`, then set completion with any refresh error. Do not set an error for the mutation when only refresh fails.
- In `handleResume`, treat `queued` and `already-queued` statuses as success. Show `detail` when present, otherwise show `status`.
- On sidecar fetch, if `response.json.applied` exists for split or accepted-success, set completion immediately instead of rendering the mutating action.
- The accepted-success form must keep the confirm action disabled until both reason category and trimmed note are present. Dependent checkboxes should default to selected only for unblockable candidates, and blocked candidates must be visible but disabled.
- The accepted-success confirmation description must list cleanup, landing action, durable audit fields, and selected dependent changes from the preview response.
- The completion panel must include a close button that calls `onOpenChange(false)` and a cue to inspect the Queue card after queue-affecting actions.
- `selectNowQueueSummary()` counts (`failedCount`, `skippedCount`, `withRecoveryVerdictCount`) must still use the full queue input.

## Verification

- [ ] After a split sidecar apply resolves, the dialog shows a completion panel containing the successor PRD id and does not show an enabled `Enqueue successor PRD` button.
- [ ] Opening a sidecar with `json.applied.action === 'split'` shows an already-applied completion panel and does not call `applySidecarRecovery()`.
- [ ] A resume response with `status: 'already-queued'` renders a success completion panel containing the daemon `detail` or `status`.
- [ ] When `refreshQueue()` rejects after a successful sidecar apply, resume, or accepted-success apply, the completion panel remains visible and shows the refresh error as follow-up text.
- [ ] The accepted-success action remains disabled until a reason category is selected and the note contains non-whitespace text.
- [ ] Accepted-success confirmation text lists cleanup, landing behavior, durable audit metadata, and selected dependent changes.
- [ ] Accepted-success completion shows the reason category, freeform reason, cleanup result, landing/PR result, and dependent unblock result from the response.
- [ ] `selectNowQueueSummary()` excludes running, failed, and skipped rows from `topItems` before applying the four-item limit.
- [ ] `selectNowQueueSummary()` still reports accurate `runningCount`, `failedCount`, `skippedCount`, and `withRecoveryVerdictCount` values.
- [ ] The Queue card collapsed preview renders pending or waiting rows even when raw queue input starts with four failed/skipped rows.
- [ ] `pnpm --filter @eforge-build/console-ui test` exits 0.
- [ ] `pnpm type-check` exits 0.
