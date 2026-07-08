---
id: mod-ac008-regression-coverage
name: AC-008 adoption/reconciliation regression coverage
branch: orphaned-queued-build-adoption/mod-ac008-regression-coverage
---

# AC-008 adoption/reconciliation regression coverage

Merge the AC-008 cancellation/reconciliation and stale/corrupt projection test slices into one regression matrix. Coverage should prove cancellation state remains authoritative through daemon restart/adoption, orphan completion does not cause duplicate dispatch, adopted success unblocks dependents, stale/corrupt locks project deterministically, reconciliation is restart-safe, and daemon wire shapes continue to come from @eforge-build/client helpers.

## Traceability

Criteria: ac-008
Aspects: ac-008:interface:test, ac-008:subsystem:cancellation, ac-008:subsystem:corrupt, ac-008:subsystem:reconciliation, ac-008:subsystem:stale, ac-008:subsystem:test

## Validation

Run targeted Vitest suites plus the broader test cycle as needed. Assertions should cover cancellation/reconciliation behavior, no duplicate dispatch after orphan completion, dependent unblocking after adopted success, deterministic stale/corrupt projection, and no projection crashes or wire-shape drift.

## Fragment: AC-008 regression matrix

Add or extend real-code Vitest coverage for cancellation authority through restart/adoption, orphan completion without duplicate dispatch, adopted success unblocking dependents, and stale/corrupt lock projection without crashes or daemon wire-shape drift.