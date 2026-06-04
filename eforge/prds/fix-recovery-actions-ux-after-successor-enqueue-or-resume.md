---
title: Fix recovery Actions UX After Successor Enqueue or Resume
created: 2026-06-04
profile: gpt-claude-combo
landing: pr
landing_auto_merge: true
---

# Fix recovery Actions UX After Successor Enqueue or Resume

## Problem / Motivation

Backlog item `.backlog/items/backlog-2026-06-04-fix-recovery-actions-ux-after-successor-enqueue-or-resume.md` reports that recovery split/resume actions leave users unsure whether queue-affecting recovery succeeded. The scope now also covers the adjacent manual recovery path we just used: a build can fail final PRD/acceptance validation because the generated acceptance criterion is bad or over-narrow, while the implementation and deterministic checks are acceptable. That should be a first-class, audited Console action rather than a manual shell sequence.

This aligns with the roadmap’s `Console Observability and Control` goal, specifically actionable recovery controls in console-ui, and with `Kernel Resilience and Typed Recovery` because recovery decisions should be inspectable and repeatable without confusing UX.

Classification: this is a **bugfix / deep** change. It fixes incorrect/confusing Console behavior and idempotency around existing recovery flows, and adds a focused `accept build as successful` recovery action for human-approved validation overrides; `deep` is justified because the issue crosses Console state, queue selectors, recovery apply semantics, landing/cleanup behavior, and queue dependency handling.

Evidence gathered:

- `packages/console-ui/src/components/now/queue-recovery-dialog.tsx` resets local `applyResult` and `resumeResult` whenever the dialog opens for a PRD, calls `refreshQueue()` after sidecar apply/resume, but keeps the sheet open and the failed PRD context active after queue-affecting actions.
- `packages/console-ui/src/components/recovery/recovery-report-panel.tsx` disables sidecar/resume buttons after local success and shows inline messages, but those messages are ephemeral because they are tied to dialog-local state. Reopening the same failed PRD shows the original report/actions again.
- `packages/engine/src/recovery/apply.ts` keeps a split failed PRD and its recovery sidecars under `queue/failed/` as an audit trail while `enqueuePrd()` writes a successor to the queue root. This is intentional but means the original failed item can remain visible/actionable in attention surfaces unless the Console treats applied split as terminal for that interaction.
- `packages/engine/src/recovery/apply.ts` does not currently make split apply idempotent at the helper level; a repeated split apply can enqueue another successor because the audit sidecar remains present and no durable applied marker is written.
- `packages/engine/src/queue/resume-cascade.ts` makes compiled-build resume requeue idempotent for matching queue-root metadata via status `already-queued`, and `packages/client/src/routes/recovery.ts` exposes `ResumeBuildResponse.status`/`detail` for durable feedback. The Console currently displays metadata but does not transition/dismiss the report after queueing.
- `packages/console-ui/src/lib/selectors/queue-summary.ts` sorts failed and skipped rows before forward queue rows and then truncates `topItems` to four. `QueueCard` then filters failed/skipped out of `summary.topItems`, so multiple failed/skipped rows can consume all collapsed preview slots and hide a newly queued successor/resume even though `allItems` contains it.
- `packages/console-ui/src/hooks/use-daemon-events.ts` has an explicit REST `refreshQueue()` path that dispatches `QUEUE_REFRESH_RECEIVED`, so Console can reliably refresh queue state after recovery actions without waiting for SSE reconnect or scheduler events.
- Failed build `complete-host-queue-controls-race-safety-fixes-and-docs` showed a final-validation failure where deterministic checks passed and the implementation was acceptable, but the generated acceptance criterion `ac-010` was over-narrow: the PRD allowed CLI-boundary validation while the extracted AC required a daemon-origin validation error. We manually made a cleanup commit, opened PR #143, and unblocked skipped dependents. This should be available as an audited recovery action.

Confirmed symptoms:

- A split recovery action enqueues a successor PRD but intentionally leaves the original failed PRD and recovery sidecars under `queue/failed/` as an audit trail (`packages/engine/src/recovery/apply.ts`). Console currently has no durable applied state for that sidecar, so reopening the failed PRD can present the original `Enqueue successor PRD` action again.
- Split apply is not idempotent at the helper level: repeated application of the same split sidecar can call `enqueuePrd()` again, and `enqueuePrd()` resolves slug collisions with `-2`, `-3`, etc. (`packages/engine/src/prd-queue.ts`), which can produce duplicate successors.
- A compiled-build resume action is idempotent in the queue helper (`already-queued` exists in `packages/engine/src/queue/resume-cascade.ts` and `ResumeBuildResponse.status`), but Console currently keeps the recovery report open and only shows dialog-local metadata.
- The Queue card can fail to visibly show a newly queued successor/resume in collapsed mode because `selectNowQueueSummary()` sorts failed/skipped terminal rows ahead of forward queue rows before truncating `topItems`, while `QueueCard` filters terminal rows after truncation.
- A final validation failure caused by a bad or conflicting acceptance criterion currently has no safe Console action for human acceptance. The practical workflow is manual: inspect evidence, decide the build is acceptable, create the normal cleanup commit, open/land a PR, and unblock dependents. That is error-prone and leaves no structured recovery audit trail.

Users affected: Console users recovering failed PRDs, especially when auto-build is disabled or when multiple failures/skips are already present.

Why it matters now: recovery controls are part of the roadmap’s Console observability/control direction; duplicate successor enqueues and non-durable feedback undermine trust in recovery actions.

Confirmed root causes:

- Split apply has no durable applied state. `applyRecoverySplit()` in `packages/engine/src/recovery/apply.ts` always normalizes the sidecar successor body and calls `enqueuePrd()`; it does not record `successorPrdId` back to the sidecar or check for prior application. Because `enqueuePrd()` intentionally generates unique slugs on collision, repeated split apply can produce duplicate successor PRDs.
- Failed split audit rows are still projected as actionable. `packages/monitor/src/projections/queue-items.ts` reads only `{ verdict, confidence }` from failed recovery sidecars into `QueueItem.recoveryVerdict`; `selectNowAttentionItems()` treats any failed row with a recovery verdict as a recoverable warning with a `Recover…` action. There is no client/daemon wire shape for `already applied` recovery state.
- Dialog success state is ephemeral and does not transition the interaction. `QueueRecoveryDialog` clears `applyResult`/`resumeResult` on every open and passes them to `RecoveryReportPanel`; the panel disables the local action after success but keeps the report/action context visible. There is no completion state that replaces the report after queue-affecting actions.
- Queue preview truncates before applying its forward-only rendering rule. `selectNowQueueSummary()` builds `sorted = [...failed, ...skipped, ...sortQueueItemsTopologically(activeQueue)]`, slices `topItems` to four, and only then `QueueCard` filters failed/skipped out. The selector and component disagree about what the collapsed queue preview should prioritize.

Validated non-causes and constraints:

- The REST refresh path exists and is appropriate: `refreshQueue()` in `packages/console-ui/src/hooks/use-daemon-events.ts` fetches `API_ROUTES.queue` and dispatches `QUEUE_REFRESH_RECEIVED`.
- Compiled-build resume queueing is already backend-idempotent for matching queued metadata: `requeueFailedPrdForCompiledResume()` returns `already-queued` when the queue root already contains the matching compiled-resume PRD.
- Keeping the failed split PRD as an audit trail is intentional, so the fix should not remove the failed PRD/sidecars just to make the UI quieter.

## Goal

Make recovery queue actions in Console clear, durable, and safe after split, compiled-build resume, or human acceptance of a validation-failed build. Split apply should be idempotent, recovery dialogs should transition to stable completion feedback, accepted-success recovery should capture an explicit human reason and perform the same cleanup/landing/unblock steps we do manually today, and the Queue card should visibly prioritize forward queue work after recovery actions.

## Approach

### Accept failed build as successful action

- Add a focused recovery action labeled `Accept build as successful` (or equivalent) for failed PRDs whose recovery sidecar indicates final validation/acceptance validation failed but the build has landed implementation commits and deterministic validation evidence.
- The action must require a structured reason category and a freeform note before confirmation. Suggested categories: `bad_acceptance_criterion`, `manual_verification_passed`, `external_or_inconclusive_criterion_waived`, and `other`.
- The confirmation step should preview the concrete effects: cleanup commit for eforge plan/PRD artifacts, landing/PR behavior, durable audit metadata, and any dependent PRDs that can be unblocked.
- Add an engine/monitor route/helper for the accept action rather than asking users to perform shell commands from the Console. Keep it as a focused recovery action, not a replacement recovery framework.
- Reuse existing landing policy machinery where possible (`pr`, `merge`, or `leave`) so the accepted build lands consistently with other eforge builds. If full landing integration is too large, implement the smallest safe path that creates the cleanup commit and opens/leaves the branch through existing project configuration, with a clear result in the response.
- Create the normal cleanup commit that removes eforge plan/PRD artifacts for the accepted build without removing implementation changes. If cleanup artifacts are already absent, treat cleanup as an idempotent no-op and report that state.
- Write durable applied metadata to the recovery sidecar for the accepted-success action, including action/verdict, accepted timestamp, reason category, freeform note, cleanup commit SHA when created, landing/PR result when available, and any dependents unblocked.
- Make repeated accept action submissions idempotent: return `already-applied` (or equivalent) with the recorded cleanup/landing metadata and do not create duplicate cleanup commits or duplicate PRs.
- In the Console completion panel, show the accepted-success result, reason, cleanup commit, PR/landing URL or branch status, and dependent unblocking result.
- The failed PRD/recovery sidecar may remain as an audit artifact, but applied accepted-success rows must not be rendered as ordinary actionable recovery prompts.

### Dependent unblock prompt

- When a failed PRD is accepted as successful, detect skipped queue PRDs that directly depend on the accepted PRD.
- Show a confirmation prompt listing the candidate dependents and explain exactly what will change.
- Only unblock dependents selected/confirmed by the user. Move confirmed skipped dependents back to the queue root and remove the accepted PRD id from their `depends_on` list when that dependency has been satisfied by the accepted build. Preserve other dependencies and do not unblock dependents that still have unresolved blockers.
- Record the dependent unblock result in the accept action response and durable sidecar metadata.

### Recovery sidecar and apply response contract

- Update client-owned recovery types in `packages/client/src/routes/recovery.ts` to include optional durable applied metadata on `RecoveryVerdictSidecar`, for example `{ applied: { action, verdict?, appliedAt, successorPrdId?, acceptedReasonCategory?, acceptedReason?, cleanupCommitSha?, landing?, unblockedDependents?, status? } }`.
- Extend `ApplyRecoveryResponse` additively with `status?: 'applied' | 'already-applied'` and `detail?: string`, preserving existing fields for compatibility.
- If queue item wire shape needs to expose the durable applied state, update `packages/client/src/events.schemas.ts` and exports from `@eforge-build/client`; do not redeclare wire shapes locally in monitor/console packages.

### Split idempotency and durable applied marker

- Add engine/monitor helpers that read and write the recovery sidecar applied marker safely for split apply.
- Before enqueuing a split successor, detect an existing applied marker and return `status: 'already-applied'` with the recorded `successorPrdId` instead of enqueueing again.
- Also detect the crash-window case where a successor with `recovery_from: <prdId>` already exists in queue/waiting/running but no marker was written, then write/return the marker rather than enqueueing a duplicate when possible.
- Keep the original failed PRD and recovery report as audit artifacts.
- Add tests in `test/apply-recovery.test.ts` or `test/apply-recovery-route.test.ts` proving a repeated split apply does not create a `-2` successor and returns the same successor id/status.

### Monitor queue projection and sidecar read path

- Update `packages/monitor/src/routes/recovery-sidecar-service.ts` to preserve/validate the optional applied marker in `readRecoverySidecar()`.
- Update `packages/monitor/src/projections/queue-items.ts` to project applied recovery state through the client-owned queue item shape if the UI needs it.
- Update monitor projection tests so applied split audit rows do not appear as normal actionable recovery verdicts unless the UI explicitly renders them as already applied.

### Console recovery dialog transition

- Update `packages/console-ui/src/components/now/queue-recovery-dialog.tsx` to set a completion state after successful queue-affecting sidecar apply (`retry`, `split`, `abandon`) and resume (`queued` or `already-queued`).
- Await `refreshQueue()` before transitioning when possible; if refresh fails after the mutation succeeds, keep the success state and show the refresh failure as non-blocking follow-up feedback.
- Replace the recovery report/actions with a completion panel after success. The panel should include the action result (`successorPrdId` for split, `detail/status` for resume), a clear close control, and a cue to look at the Queue card.
- On opening a sidecar whose durable marker says split already applied, render the already-applied completion state rather than the mutating `Enqueue successor PRD` action.

### Queue summary preview fix

- Update `packages/console-ui/src/lib/selectors/queue-summary.ts` so `topItems`, `allItems`, `hiddenCount`, and `total` used by the Queue card are based on forward queue rows (`pending`/`waiting`, excluding `running`, `failed`, and `skipped`) before truncation.
- Keep `failedCount`, `skippedCount`, and `withRecoveryVerdictCount` counts accurate for status summaries and attention surfaces.
- Update `packages/console-ui/src/__tests__/now-selectors.test.ts` and `packages/console-ui/src/components/now/__tests__/queue-card.test.tsx` for the forward-only selector/component contract.

### Documentation

- Update `packages/console-ui/README.md` recovery dialog section to describe the post-action completion/transition behavior, idempotent split apply, and forward-only Queue preview if the implementation changes user-visible behavior.

### Risks and mitigations

- API/wire-shape drift: route and daemon event schemas are owned by `@eforge-build/client`. Mitigation: define applied recovery metadata in client-owned types/schemas and import it from monitor/console code.
- Split idempotency crash window: enqueue could succeed before writing the applied marker. Mitigation: after marker absence, scan live queue locations for a successor carrying `recovery_from: <prdId>` before enqueueing a new one; then write the marker from that existing successor.
- Hiding useful audit failures: applied split failed PRDs should remain available as audit records, but not as repeated recovery prompts. Mitigation: keep failed queue rows and sidecars on disk, but project/render an already-applied state with no mutating action.
- Refresh failure after successful mutation: the mutation can succeed while `refreshQueue()` fails. Mitigation: success state must still be shown; refresh errors should be secondary feedback and not imply the recovery action failed.
- Queue summary semantic change: changing `total`/`topItems` to forward-only can affect tests or labels that currently counted failed/skipped rows. Mitigation: preserve terminal counts separately (`failedCount`, `skippedCount`, `withRecoveryVerdictCount`) and update tests/docs to reflect the Queue card’s documented forward-only contract.
- Resume `already-queued` UX: treating `already-queued` as success may surprise users if the queued PRD is already running or temporarily absent from the collapsed preview. Mitigation: use `ResumeBuildResponse.detail/status` in the completion panel and rely on the forward-only selector to make queued work visible when it exists.

### Assumptions and validation

| Assumption | Evidence / validation performed | Confidence | Cost to validate further | Validation path | Impact if wrong |
|------------|----------------------------------|------------|--------------------------|-----------------|-----------------|
| Split recovery should preserve the failed PRD and sidecars as audit artifacts. | Backlog evidence states this is intentional; `packages/engine/src/recovery/apply.ts` documents that split leaves the failed PRD and sidecars under `failed/` as the audit trail. | high | low | Keep this behavior in tests; assert failed audit files still exist after split apply. | Removing audit files would discard recovery evidence and conflict with existing recovery semantics. |
| Durable applied metadata on the sidecar is the right idempotency anchor for split. | The sidecar is intentionally retained after split and is read by both apply and Console paths; no current field records prior application. | medium | low | Implement behind optional client-owned fields and add tests for read/apply/projection. If review prefers a separate marker file, keep the same semantics with a different storage location. | A poor storage choice could create migration or cleanup debt, but optional metadata is local to recovery artifacts. |
| Adding optional response/sidecar fields is additive and does not require a daemon API version bump. | Existing TypeScript interfaces can be extended optionally; this plan does not remove or rename fields. | medium | low | Check `packages/client/src/api-version.ts` policy during implementation; bump `DAEMON_API_VERSION` only if the final route/schema change is considered breaking. | Version skew could confuse older clients if a breaking change is accidentally introduced. |
| Queue projection should suppress or annotate applied split rows so they are not presented as normal actionable failures. | `selectNowAttentionItems()` currently makes every failed row with `recoveryVerdict` actionable; applied split rows would otherwise remain confusing. | high | low | Add selector/projection tests for applied sidecar rows. | Users would still see a repeated Recover action after the backend becomes idempotent. |
| Queue card preview should be forward-only before truncation. | `QueueCard` documentation says failed/skipped rows are not shown there; current selector truncates before the component filters terminal rows. | high | low | Update `selectNowQueueSummary()` tests with failed/skipped rows before pending rows. | Newly queued successors/resumes can remain hidden in collapsed preview. |
| `pnpm --filter @eforge-build/console-ui test` is a valid targeted Console test command. | `packages/console-ui/package.json` defines package name `@eforge-build/console-ui` and script `test`. | high | low | Run the command during implementation. | Validation command in AC would need adjustment. |

No low-confidence/high-impact assumptions remain unresolved. The main design assumption is sidecar metadata vs a separate marker file; it is medium confidence, low validation cost, and can be resolved during implementation review without changing the user-visible contract.

### Profile signal

Recommended profile: **Excursion**.

Rationale: this is a cohesive bugfix that crosses the recovery sidecar contract, monitor queue projection, Console recovery dialog, and Queue card selector/tests. A single planner can enumerate the sequence and dependency boundaries without delegated module planning. It is broader than an Errand because it needs client-owned wire shape changes and multiple test layers, but it does not require Expedition because there are no independent subsystems needing separate module planners.

## Scope

In scope:

- Fixing confusing Console behavior after existing split and compiled-build resume recovery actions.
- Adding an audited `Accept build as successful` recovery action for final validation failures caused by bad/over-narrow/conflicting acceptance criteria or manually verified criteria.
- Requiring a human reason and freeform note before accepting a failed build as successful.
- Creating or no-oping the normal cleanup commit for accepted builds and applying existing landing/PR behavior where possible.
- Offering a confirmed dependent-unblock step for skipped PRDs that depended on the accepted build.
- Making split recovery apply idempotent at the helper level.
- Writing durable applied metadata for split recovery sidecars.
- Preserving the original failed PRD and recovery sidecars as audit artifacts.
- Updating client-owned recovery route types and, if needed, client-owned event schemas.
- Updating monitor sidecar read paths and queue item projections.
- Updating Console recovery dialog behavior after successful queue-affecting recovery actions.
- Updating Queue card summary selector behavior so collapsed previews are based on forward queue rows before truncation.
- Updating tests for recovery apply, recovery routes, monitor projections, now selectors, and Queue card behavior as applicable.
- Updating `packages/console-ui/README.md` if user-visible behavior changes.

Explicitly out of scope:

- Removing failed split PRDs or recovery sidecars just to make the UI quieter.
- Treating `refreshQueue()` failure after a successful mutation as evidence that the mutation failed.
- Redeclaring daemon wire shapes locally in monitor or console packages.
- Removing or renaming existing recovery response fields.
- Breaking existing recovery behavior for retry, abandon, manual, or resume flows.
- Building a general-purpose recovery workflow/state-machine framework beyond the focused split/resume/accept-success UX and idempotency fixes in this PRD.
- Accepting a failed build without an explicit human reason and durable audit trail.

## Acceptance Criteria

- Applying the same split recovery sidecar twice produces exactly one successor PRD file and returns the same `successorPrdId` on the second apply.
- The second successful split apply response includes an idempotent status such as `already-applied` or an equivalent client-owned field that callers can distinguish from a first application.
- A split recovery sidecar records durable applied metadata containing the applied verdict, applied timestamp, and successor PRD id after the first successful split apply.
- Reading a recovery sidecar after split apply returns the durable applied metadata through `@eforge-build/client`-owned response types.
- Console does not render an enabled `Enqueue successor PRD` action for a failed PRD whose sidecar says split recovery was already applied.
- Console shows a completion state after successful split apply that includes the successor PRD id.
- Console shows a completion state after successful compiled-build resume queueing that includes the daemon `detail` or `status` from `ResumeBuildResponse`.
- Console treats `ResumeBuildResponse.status === 'already-queued'` as a successful completion state rather than an error.
- Console calls `refreshQueue()` after successful sidecar apply before or during the success transition.
- Console calls `refreshQueue()` after successful compiled-build resume before or during the success transition.
- Console keeps the success completion state visible when the recovery mutation succeeds but the subsequent queue refresh rejects.
- The Queue card collapsed preview includes pending or waiting forward queue items even when failed or skipped terminal rows exist earlier in raw queue order.
- `selectNowQueueSummary()` excludes failed and skipped rows from `topItems` before applying the collapsed preview limit.
- `selectNowQueueSummary()` continues to report accurate `failedCount` and `skippedCount` values.
- Console renders an `Accept build as successful` recovery action for a failed PRD whose sidecar indicates final PRD/acceptance validation failed and whose branch has implementation/validation evidence suitable for human review.
- The accept-success action is disabled until the user selects a reason category and enters a non-empty freeform reason.
- The accept-success confirmation preview lists cleanup, landing/PR behavior, durable audit metadata, and candidate dependent PRDs that may be unblocked.
- Applying accept-success writes durable sidecar applied metadata containing action `accepted-success`, accepted timestamp, reason category, freeform reason, and cleanup/landing result fields when available.
- Applying accept-success creates the normal cleanup commit removing eforge plan/PRD artifacts for the accepted build, or reports an idempotent cleanup no-op if those artifacts are already absent.
- Applying accept-success uses existing landing configuration to open a PR, merge, or leave the accepted branch, and returns the resulting PR URL, merge result, or branch status when available.
- Reapplying accept-success returns an idempotent already-applied response and does not create duplicate cleanup commits, duplicate PRs, or duplicate landing attempts.
- Console shows an accept-success completion state that includes the human reason, cleanup commit status, landing/PR result, and any dependent unblock result.
- Applied accept-success recovery rows remain available as audit records but are not rendered as ordinary actionable recovery prompts.
- Console lists skipped PRDs that directly depend on the accepted build and lets the user choose whether to unblock them.
- Confirmed dependent unblocking moves selected skipped PRDs back to the queue root, removes only the satisfied accepted-build dependency, preserves other dependencies, and leaves still-blocked dependents skipped.
- The accept-success sidecar metadata records which dependents were unblocked and which remained blocked.
- Existing recovery tests for retry, abandon, manual, and resume continue to pass.
- `pnpm --filter @eforge-build/console-ui test` exits 0.
- `pnpm test -- apply-recovery` exits 0 or the nearest existing Vitest filter for recovery apply/accept-success tests exits 0.
- `pnpm type-check` exits 0.

## Manual Verification Notes

Static split reproduction path from current code:

1. Open Console Now dashboard with a failed PRD that has a split recovery sidecar under `.eforge/queue/failed/<prdId>.recovery.json`.
2. Click `Recover…` from the Needs attention strip. `QueueRecoveryDialog` fetches the sidecar and renders `RecoveryReportPanel`.
3. Click `Enqueue successor PRD`, confirm `Enqueue`, and let `applySidecarRecovery({ prdId })` return `{ verdict: 'split', successorPrdId: '<id>' }`.
4. Expected: the UI should make it obvious that the successor was queued, stop offering the same mutating action for that failed item, and show the successor/resumed PRD in the Queue card when the queue refresh includes it.
5. Actual from code: `QueueRecoveryDialog` only stores `applyResult` locally and leaves the recovery report open; reopening the dialog clears `applyResult` and fetches the unchanged sidecar, so the action can appear again. The engine split helper can enqueue a duplicate successor on repeated apply.
6. If the refreshed queue contains four or more failed/skipped rows before a new pending successor, `selectNowQueueSummary()` includes those terminal rows in `topItems`; `QueueCard` then filters them out, so the collapsed Queue card can show no/new fewer forward rows even though `allItems` contains the successor.

Static accept-success reproduction path from the recent failed build:

1. A build fails final validation after deterministic commands pass because a generated acceptance criterion is too strict or conflicts with the PRD text. Example: `complete-host-queue-controls-race-safety-fixes-and-docs` failed because `ac-010` required daemon-origin validation for malformed CLI priority input even though the PRD allowed CLI-boundary validation.
2. Expected: the recovery dialog should show the failed criterion/conflict evidence and offer an audited `Accept build as successful` action. The user must provide a reason such as `bad_acceptance_criterion` plus notes.
3. Expected: after confirmation, eforge should create or no-op the cleanup commit, open/merge/leave according to landing settings, record the human acceptance metadata, and optionally unblock selected skipped dependents.
4. Actual current workflow: the user must manually inspect monitor DB/recovery evidence, switch branches, delete eforge plan/PRD artifacts, commit cleanup, push/open a PR, and move skipped dependent PRDs back to pending while editing their `depends_on` lists.

Static resume reproduction path from current code:

1. Open the same recovery dialog for a PRD where `fetchResumeEligibility()` returns `eligible: true`.
2. Click `Resume compiled build`, confirm `Resume`, and let `startResumeBuild()` return `status: 'queued'` or `status: 'already-queued'`.
3. Expected: the dialog should transition/dismiss with durable feedback that the resume is queued/already queued and the queue refresh should make the forward queue visible.
4. Actual from code: `QueueRecoveryDialog` stores `resumeResult` locally and refreshes the queue, but keeps rendering the recovery report/advanced sections; the success state disappears when the dialog is reopened.