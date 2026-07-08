---
id: mod-adopted-failure-cancel-control
name: Adopted failure and cancellation control
branch: orphaned-queued-build-adoption/mod-adopted-failure-cancel-control
---

# Adopted failure and cancellation control

Route adopted worker exits and failures through the shared finalizer. Cancellation of an adopted build must verify PID ownership before signaling; if ownership cannot be verified, do not signal and return a diagnostic explaining why and how to recover or reconcile manually.

## Traceability

Criteria: ac-004, ac-007
Aspects: ac-004:general:general, ac-007:general:general

## Validation

Author tests for adopted failure cleanup, recovery sidecar/degraded evidence, dependent skips, verified cancellation signaling, and unverifiable PID diagnostics without unsafe signals.

## Fragment: Shared cleanup-gated finalization

Create or refactor a single idempotent finalization path used by normal queued children, adopted workers, PID polling, and persisted completion replay. It releases locks, moves PRDs, writes normal/degraded recovery evidence, and propagates dependent skips once. For orphan queue:prd:complete replay, scheduler completion handling must occur only after cleanup has finished.
## Fragment: Adopted success, failure, and cancellation outcomes

Successful adopted builds preserve existing artifacts and completed state, update canonical queue/session projections, and unblock dependents without rerun. Adopted failures flow through the shared finalizer. Cancellation must verify PID ownership before signaling and return an actionable diagnostic if ownership cannot be verified.