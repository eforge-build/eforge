---
id: queue-dependency-override
name: Clear matching stack parent during queue dependency override
branch: clear-stale-stack-parent-on-queue-dependency-override/queue-dependency-override
---

# Clear matching stack parent during queue dependency override

In `packages/engine/src/queue/control.ts`, make the dependency-override mutation compare the dependency being removed with the PRD's current `stack_parent`. When they match, remove the dependency and clear `stack_parent` in the same persisted PRD update; when they do not match, preserve `stack_parent`. Apply the same rule to the pending queue-root and waiting-directory paths, reusing a shared mutation if that avoids semantic drift. Preserve existing lock/claim and stale-read protections, scheduler notification behavior, and audit-event behavior, including the waiting item's transition to pending when its final dependency is removed. Add focused real-code tests grouped around queue dependency override: cover matching and nonmatching parents in both paths, assert the on-disk PRD has no stale stack metadata after matching removal, and drive the formerly failing pre-session stacked-dispatch validation far enough to prove the dependency-free item can start. Do not change daemon route or client API contracts; exercise the existing queue-control route, capability, scheduler, and stacking-validation suites as regressions.

## Traceability

Criteria: ac-001, ac-002, ac-003, ac-004, ac-005, ac-006, ac-007, ac-008, ac-009
Aspects: ac-001:general:general, ac-002:general:general, ac-003:general:general, ac-004:general:general, ac-005:general:general, ac-006:subsystem:claiming, ac-006:subsystem:locking, ac-007:interface:test, ac-007:subsystem:test, ac-008:interface:route, ac-008:interface:route-api, ac-008:interface:test, ac-008:subsystem:route, ac-008:subsystem:test, ac-009:interface:test, ac-009:subsystem:test

## Validation

Run the focused queue dependency-override regression tests, including persisted-state and dispatch/session-start assertions. Run existing queue-control route, capability, scheduler, and stacking-validation tests, then `pnpm type-check`, `pnpm test`, and `pnpm maintainability:check`; all must exit successfully.


## Execution Intent

Test ownership: builder
Review depth: standard
Review rationale: risk score 1 (low-confidence-localization); declared docs work none, test work author-new, test owner builder; model review intent standard (The edit is localized but changes persisted queue state under locking and claiming, so review must verify atomic semantics and that race guards, notifications, and audit events are unchanged.); derived build implement -> test-cycle -> review-cycle and auto review with perspectives code, test, 1 round(s), standard evaluation