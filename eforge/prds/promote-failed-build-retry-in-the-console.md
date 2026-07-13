---
title: Promote Failed-Build Retry in the Console
created: 2026-07-13
---

# Promote Failed-Build Retry in the Console

## Problem / Motivation

The Console already has a safe, typed recovery path that analyzes a failed queue item, moves the failed PRD back to the queue, removes stale recovery sidecars, and can reactivate skipped descendants. However, `packages/console-ui/src/components/recovery/advanced-cascade-section.tsx` hides that path behind “Advanced: queue-cascade retry/reactivation” and labels its mutation “Apply queue-cascade recovery.” The Needs attention row in `packages/console-ui/src/components/now/attention-panel.tsx` exposes only a generic “Recover…” entry point.

As a result, users with a straightforward failed build cannot readily discover the intended retry action and must understand internal queue-cascade terminology. The existing retry capability should become a primary, user-facing recovery action while retaining conservative analysis, confirmation, warnings, and complex repair controls.

Confidence is high because the backend capability and integration tests already exist. Validation should concentrate on conditional rendering, blocked messaging, confirmation, apply invocation, queue refresh, regression tests, type-checking, and the Console build.

## Goal

Promote the existing queue-cascade retry capability in the Console recovery dialog from an advanced-only repair into an immediately discoverable `Retry build` action when analysis finds an unblocked failed PRD with no skipped descendants. Reuse the current typed client/daemon/engine analyze-and-apply path, preserve manual and low-confidence warnings as explicit override context, and keep blocker repair and descendant reactivation in the detailed/advanced flow.

The work is intentionally Console-focused: introduce no new recovery semantics, daemon routes, or engine mutations, and do not mutate directly from the Needs attention row.

## Approach

### High-level behavior and design decisions

- Analyze queue recovery early enough in the recovery dialog to classify a failed PRD before the user opens an Advanced disclosure.
- Keep one queue-recovery analysis and mutation state machine. Do not create separate primary and advanced components that independently fetch analysis or can race to apply stale operations.
- Fetch analysis when the recovery panel mounts for a PRD. Reset analysis, selection, result, and error state when `prdId` changes, and retain stale-request cancellation behavior.
- Derive presentation from the typed analysis rather than sidecar copy. A simple primary retry requires: analysis loaded, `eligible` true, no blockers, at least one operation, no `skipped-descendant` nodes, and no unresolved repair selection. Treat warnings separately from blockers.
- Present simple recovery in product language: `Retry build`, with confirmation explaining requeue and stale-sidecar cleanup. Keep operation IDs, strategy names, dependency classifications, and queue-cascade terminology in expandable details for diagnostics.
- Preserve confirmation before mutation, pending/error states, operation-drift protection, successful queue refresh, and result feedback.
- Preserve the existing backend guardrail of sending the analyzed operations back as `expectedOperations`; operation drift must still fail closed.
- Keep manual-verdict and low-confidence warnings visible beside the primary action and describe retry as a deliberate user override when appropriate. These notices remain non-blocking because the engine explicitly models them as warnings and permits user-directed recovery.
- For blocked simple retry, show blocker text before the disclosure. Show clear primary-level “Retry unavailable” messaging with blocker reasons and route repairable or complex cases to detailed controls.
- For descendants or repair actions, keep a discoverable detailed recovery section with the existing controls rather than flattening a multi-PRD mutation into a deceptively simple button.
- Keep descendant reactivation, dependency metadata repair, operation details, and other expert diagnostics available in a detailed/advanced section.
- Audit the existing sidecar `retry` action before finalizing precedence. If it overlaps the queue-recovery simple path, render one primary retry CTA and retain any materially distinct action only with differentiated copy.
- Optionally improve the Needs attention entry-point copy to mention retry while continuing to open the dialog and preserving dispatch-blocker context.
- Continue using `@eforge-build/client/browser` helpers and shared wire types; do not inline API paths or redeclare response shapes.

### Code impact

Primary implementation surfaces:

- `packages/console-ui/src/components/recovery/advanced-cascade-section.tsx`: refactor the advanced-only component into a recovery section that owns one analysis/apply state machine and can render both a simple primary retry presentation and detailed cascade/repair controls. Rename the file/component if that makes its broadened responsibility clearer.
- `packages/console-ui/src/components/recovery/recovery-report-panel.tsx`: place the promoted retry surface appropriately among recommended recovery actions, pass verdict/confidence and refresh behavior, and prevent duplicate retry CTAs when queue recovery is the selected primary path.
- `packages/console-ui/src/components/now/attention-panel.tsx`: optionally replace generic entry-point copy with discoverable retry-oriented copy while preserving `onRecover` dialog navigation and dispatch-blocker context.
- `packages/console-ui/src/components/now/__tests__/queue-recovery-dialog.test.tsx`: replace the lazy-analysis/advanced-only expectations and add eligible, blocked, warning, confirmation, application, refresh, and complex-cascade regression cases.
- `packages/console-ui/src/components/now/__tests__/attention-panel.test.tsx`: update assertions if the Needs attention label changes.
- `packages/console-ui/src/components/recovery/recovery-report-panel.stories.tsx`: add or update stories for simple retry eligibility and blocked/complex recovery if the refactor introduces presentational inputs.

Contract/reference surfaces to reuse, not redesign:

- `packages/client/src/browser-queue-recovery.ts` and `packages/client/src/queue-recovery.ts` provide browser helpers and wire types.
- `packages/monitor/src/routes/queue-recovery.ts` provides typed analyze/apply routes.
- `packages/engine/src/queue/recovery-cascade.ts` remains the authority for eligibility, blockers, exact operations, sidecar cleanup, drift checks, and descendant reactivation.

### Assumptions to validate during implementation

- Confirm that queue-recovery analysis always includes the failed-to-queue move and stale-sidecar cleanup for a valid failed PRD, and that `eligible` plus empty blockers is sufficient for the primary path.
- Compare `applySidecarRecovery` retry semantics with `applyQueueRecovery` so the UI does not expose duplicate or behaviorally conflicting retry controls.
- Verify whether analyses with warnings but no blockers remain safely applicable, including manual and low-confidence sidecars.
- Verify the desired result transition after successful queue-cascade apply; preserve current in-panel result feedback or integrate with the dialog completion panel without losing operation details.
- Confirm eager analysis cost is acceptable for one selected failed PRD and that opening/closing or switching PRDs cannot display stale analysis.

### Automated validation plan

- Extend `queue-recovery-dialog.test.tsx` with hand-crafted typed responses for simple eligible retry, blocked retry, manual/low-confidence warning override, apply failure, successful confirmed apply plus queue refresh, and skipped-descendant/repair fallback.
- Assert no mutation before confirmation, exact `expectedOperations`, no accidental sidecar apply, disabled/pending behavior, and no duplicate primary retry controls.
- Preserve existing stack-parent and dependency-repair tests.
- Update `attention-panel.test.tsx` if entry-point copy changes while asserting the same recovery payload is forwarded.
- Run `pnpm --filter @eforge-build/console-ui test`, `pnpm --filter @eforge-build/console-ui type-check`, `pnpm --filter @eforge-build/console-ui build`, and `pnpm maintainability:check`.

## Scope

### In scope

- Analyze queue recovery early enough in the recovery dialog to classify a failed PRD before the user opens an Advanced disclosure.
- For an eligible analysis with no blockers and no skipped descendants, render a prominent `Retry build` action outside Advanced.
- Explain in user-facing copy that retry moves the failed PRD back to the queue and removes stale recovery sidecars.
- Preserve confirmation before mutation, pending/error states, operation-drift protection, successful queue refresh, and result feedback.
- Keep manual-verdict and low-confidence warnings visible beside the primary action and describe retry as a deliberate user override when appropriate.
- For blocked analyses, show clear primary-level “Retry unavailable” messaging with blocker reasons and route repairable/complex cases to detailed controls.
- Keep descendant reactivation, dependency metadata repair, operation details, and other expert diagnostics available in a detailed/advanced section.
- Optionally improve the Needs attention entry-point copy to mention retry while continuing to open the dialog.
- Update focused Console tests and recovery panel stories where presentation assumptions change.

### Out of scope

- Changing engine queue-recovery planning or filesystem mutation semantics.
- Adding or changing daemon routes, client wire contracts, or API versions unless source inspection reveals an unavoidable contract gap.
- Automatically retrying without analysis and explicit confirmation.
- Applying retry directly from Needs attention.
- Broad redesign of sidecar recovery, continue-and-repair, accepted-success, queue removal, or lifecycle reconciliation.

## Acceptance Criteria

- Opening recovery for a failed PRD initiates queue-recovery analysis without requiring the user to reveal an Advanced section.
- When analysis is eligible, contains retry operations, has no blockers, and reports no skipped descendants, the dialog renders a prominent button labeled `Retry build` outside Advanced.
- Primary-action copy states that the failed PRD will return to the queue and stale recovery sidecars will be removed; it does not require queue-cascade terminology.
- Clicking `Retry build` opens a confirmation and does not mutate until confirmed.
- Confirming calls `applyQueueRecovery` with the analyzed strategy and exact expected operations, does not call `applySidecarRecovery`, and refreshes the queue after an applied response.
- Successful and failed apply outcomes remain visible, and the action cannot be applied twice or while analysis/apply is pending.
- Manual-verdict and low-confidence warnings remain visible; when no hard blocker exists, retry remains available as an explicit user-directed override.
- A blocked analysis displays actionable retry-unavailable messaging and blocker reasons at the primary level rather than merely disabling an unexplained advanced button.
- Analyses with skipped descendants or required dependency/stack-parent repairs retain the existing detailed controls and reactivation/repair behavior rather than being misrepresented as a simple retry.
- The Console does not present two competing primary retry controls for the same simple case; route semantics are audited and the queue-recovery action takes clear precedence where appropriate.
- Tests cover simple eligible rendering, blocker messaging, warning/override rendering, confirmation gating, successful apply invocation and refresh, and preservation of descendant/repair behavior.
- `pnpm --filter @eforge-build/console-ui test`, `pnpm --filter @eforge-build/console-ui type-check`, `pnpm --filter @eforge-build/console-ui build`, and `pnpm maintainability:check` pass.

## Manual Verification Notes

In Console, inspect one simple failed PRD, one blocked failed PRD, one manual/low-confidence verdict, and one failed PRD with skipped descendants.

Confirm manually that:

- The simple case is understandable without opening details.
- Blocker and override language is honest.
- Complex recovery remains available.
- Successful retry visibly returns the PRD to the queue.