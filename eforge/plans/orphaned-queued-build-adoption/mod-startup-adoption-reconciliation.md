---
id: mod-startup-adoption-reconciliation
name: Startup adoption and lock reconciliation
branch: orphaned-queued-build-adoption/mod-startup-adoption-reconciliation
---

# Startup adoption and lock reconciliation

On daemon startup, enumerate queued-build locks and running queue projections. Verified live PIDs from previous daemon generations become adopted workers or monitored PIDs. Persisted orphan queue:prd:complete events should wake adoption when needed. Dead, stale, corrupt, and absent locks reconcile to terminal or queued/non-running states so UI/API snapshots do not show permanent running items.

## Traceability

Criteria: ac-001, ac-005, ac-006
Aspects: ac-001:general:general, ac-005:general:general, ac-006:subsystem:wake

## Validation

Author restart/reconciliation tests covering live prior-generation locks, dead PIDs, stale locks, corrupt lock payloads, missing locks, and persisted orphan completion replay. Assert adopted/monitored state or cleared/degraded running state with exact diagnostics and no duplicate dispatch.

## Fragment: Shared cleanup-gated finalization

Create or refactor a single idempotent finalization path used by normal queued children, adopted workers, PID polling, and persisted completion replay. It releases locks, moves PRDs, writes normal/degraded recovery evidence, and propagates dependent skips once. For orphan queue:prd:complete replay, scheduler completion handling must occur only after cleanup has finished.
## Fragment: Startup adoption and lock reconciliation

On daemon startup, enumerate queued-build locks and running projections. Verified live PIDs from prior daemon generations become adopted workers or monitored PIDs. Dead, stale, corrupt, and absent locks reconcile to terminal or queued/non-running states with diagnostics. Persisted orphan queue:prd:complete events wake adoption exactly once.