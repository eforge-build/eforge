---
id: mod-idempotent-queue-finalizer
name: Shared idempotent queued-build finalizer
branch: orphaned-queued-build-adoption/mod-idempotent-queue-finalizer
---

# Shared idempotent queued-build finalizer

Create or refactor one finalization entry point used by normal queued children, adopted workers, persisted completion events, and PID polling. It must atomically ignore duplicate finalize attempts; release locks once; move PRDs to success/failed destinations; write normal or degraded recovery evidence; propagate dependent skips; and ensure orphan queue:prd:complete completion handling is dispatched only after cleanup finishes.

## Traceability

Criteria: ac-002, ac-004, ac-006
Aspects: ac-002:general:general, ac-004:general:general, ac-006:subsystem:finalize

## Validation

Author real-code Vitest coverage for duplicate completion-event/PID-poll races and persisted orphan queue:prd:complete replay. Assert one terminal PRD transition, one lock release, expected recovery evidence, dependent-skip propagation, cleanup before completion handling, and no-op repeated finalization.

## Fragment: Shared cleanup-gated finalization

Create or refactor a single idempotent finalization path used by normal queued children, adopted workers, PID polling, and persisted completion replay. It releases locks, moves PRDs, writes normal/degraded recovery evidence, and propagates dependent skips once. For orphan queue:prd:complete replay, scheduler completion handling must occur only after cleanup has finished.
## Fragment: Startup adoption and lock reconciliation

On daemon startup, enumerate queued-build locks and running projections. Verified live PIDs from prior daemon generations become adopted workers or monitored PIDs. Dead, stale, corrupt, and absent locks reconcile to terminal or queued/non-running states with diagnostics. Persisted orphan queue:prd:complete events wake adoption exactly once.
## Fragment: Adopted success, failure, and cancellation outcomes

Successful adopted builds preserve existing artifacts and completed state, update canonical queue/session projections, and unblock dependents without rerun. Adopted failures flow through the shared finalizer. Cancellation must verify PID ownership before signaling and return an actionable diagnostic if ownership cannot be verified.