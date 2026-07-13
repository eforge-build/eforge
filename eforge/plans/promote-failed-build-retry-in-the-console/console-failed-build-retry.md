---
id: console-failed-build-retry
name: Console failed-build retry flow
branch: promote-failed-build-retry-in-the-console/console-failed-build-retry
---

# Console failed-build retry flow

Implement the complete failed-build retry interaction as one cohesive console UI change. Use the existing queue-recovery client flow: begin analysis on dialog open; derive a strict simple-retry classification; promote that case to a single primary confirmed `Retry build` action; preserve warnings, blocker explanations, apply outcomes, and request guards; pass the analyzed strategy and exact expected operations to `applyQueueRecovery`; never use `applySidecarRecovery` for this action; refresh queue state after an applied result. Keep skipped-descendant and dependency/stack-parent repair cases on the existing detailed cascade/reactivation path. Audit existing failed-build controls and client/route semantics to ensure queue recovery has precedence without duplicating a primary action. Expected implementation/test evidence is localized around `packages/console-ui/src/components/now/attention-panel.tsx`, `packages/console-ui/src/components/recovery/advanced-cascade-section.tsx`, `queue-cascade-repair-panel.tsx`, `queue-cascade-repair-state.ts`, `recovery-report-panel.tsx`, `packages/console-ui/src/components/now/__tests__/queue-recovery-dialog.test.tsx`, and `packages/console-ui/src/components/recovery/__tests__/queue-cascade-repair-state.test.ts`; consult `packages/client/src/browser-queue-recovery.ts`, `packages/client/src/queue-recovery.ts`, and `packages/monitor/src/routes/queue-recovery.ts` for the existing contract rather than recreating route literals or wire shapes.

## Traceability

Criteria: ac-001, ac-002, ac-003, ac-004, ac-005, ac-006, ac-007, ac-008, ac-009, ac-010, ac-011, ac-012
Aspects: ac-001:general:general, ac-002:general:general, ac-003:general:general, ac-004:general:general, ac-005:general:general, ac-006:subsystem:analysis, ac-006:subsystem:apply, ac-007:general:general, ac-008:general:general, ac-009:subsystem:dependency, ac-009:subsystem:reactivation, ac-009:subsystem:repair, ac-009:subsystem:stack-parent, ac-010:interface:route, ac-010:interface:route-api, ac-010:subsystem:route, ac-011:interface:test, ac-011:subsystem:descendant, ac-011:subsystem:override, ac-011:subsystem:repair, ac-011:subsystem:test, ac-011:subsystem:warning, ac-012:interface:test, ac-012:interface:ui, ac-012:interface:ui-surface, ac-012:subsystem:console-ui, ac-012:subsystem:eforge-build, ac-012:subsystem:test, ac-012:subsystem:ui

## Validation

Tests demonstrate automatic analysis, strict eligibility and copy, primary blockers, warning override, confirmation-only mutation, exact queue-recovery invocation, no sidecar apply, queue refresh, persistent outcomes, idempotency/pending guards, stale-request cancellation and state reset when `prdId` changes, no competing retry control, and unchanged complex repair behavior. Run the four commands required by ac-012.

## Fragment: Promote simple queue recovery to Retry build

## Implementation

- In the failed-PRD recovery entry point/dialog (localized evidence includes `packages/console-ui/src/components/now/attention-panel.tsx` and the recovery components), trigger queue-recovery analysis when the dialog opens rather than when Advanced is revealed. When `prdId` changes, cancel or ignore the prior in-flight analysis and reset analysis, repair selection, result, error, and confirmation state before starting the new request so stale responses or state cannot leak between failed PRDs.
- Centralize a derived **simple retry** predicate from the returned analysis: analysis is eligible, includes retry operations, has no blockers, reports no skipped descendants, and requires no dependency or stack-parent repair. Keep the detailed cascade/reactivation controls for every non-simple analysis.
- For a simple analysis, render one prominent `Retry build` action outside Advanced. Explain that the failed PRD returns to the queue and stale recovery sidecars are removed. Keep manual-verdict and low-confidence warnings visible and permit the explicit retry when they are warnings rather than hard blockers.
- For blocked analyses, put actionable retry-unavailable text and blocker reasons at the primary level. Do not leave the user with only an unexplained disabled advanced action.
- Make `Retry build` open confirmation without mutation. On confirmation, call the existing browser/client `applyQueueRecovery` surface with the analyzed strategy and the exact analyzed expected operations. Do not invoke `applySidecarRecovery`. Disable action/confirmation while analysis or apply is pending and after a successful application so it cannot be submitted twice.
- Preserve successful and failed apply feedback in the open dialog. Refresh queue data only after an applied response, while retaining an error outcome for failed/rejected responses.
- Audit the current failed-build controls and their route/client semantics (`packages/client/src/browser-queue-recovery.ts`, `packages/client/src/queue-recovery.ts`, and the existing queue recovery route references). Prefer queue recovery for the simple case and remove/suppress any competing primary retry control; do not alter daemon route contracts unless the audit proves a semantic defect.

## Tests and validation

- Extend `packages/console-ui/src/components/now/__tests__/queue-recovery-dialog.test.tsx` and, where state classification is independently exercised, `packages/console-ui/src/components/recovery/__tests__/queue-cascade-repair-state.test.ts`.
- Cover automatic analysis; cancellation/ignoring of stale analysis plus reset of analysis, selection, result, and error state when `prdId` changes; eligible simple rendering and copy; blocker reasons; warnings with explicit override; confirmation gating; exact `applyQueueRecovery` strategy/operations; absence of `applySidecarRecovery`; refresh after applied response; visible success/failure; pending and duplicate guards; and preservation of skipped-descendant, dependency, stack-parent, reactivation, and repair controls.
- Run `pnpm --filter @eforge-build/console-ui test`, `pnpm --filter @eforge-build/console-ui type-check`, `pnpm --filter @eforge-build/console-ui build`, and `pnpm maintainability:check`.

## Execution Intent

Test ownership: builder
Review depth: standard
Review rationale: risk score 1 (low-confidence-localization); declared docs work none, test work author-new, test owner builder; model review intent standard (The flow is UI-local but controls a destructive/requeuing mutation. Review must verify state transitions, exact operation forwarding, route/client reuse, duplicate prevention, and that simple-case promotion does not flatten complex repair analyses.); derived build implement -> test-cycle -> review-cycle and auto review with perspectives code, test, 1 round(s), standard evaluation