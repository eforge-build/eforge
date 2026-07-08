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

## Recovery Guidance

- Failed PRD: "orphaned-queued-build-adoption"
- Root failed plan: "mod-adopted-failure-cancel-control"
- Failure summary: "Compiled plan artifacts are eligible for continue-and-repair for orphaned-queued-build-adoption. artifact source: feature-branch; 5 landed commit(s); failing plan: mod-adopted-failure-cancel-control; feature branch: eforge/orphaned-queued-build-adoption. Queue the failed PRD through the compiled-artifact recovery path so preserved work is reused and the remaining build can be repaired without generating a successor PRD."
- Failure detail: "1 blocking issue outcome(s) remain after 1 review round(s) (1 unresolved, 0 need human review; 2 rejected, 0 under review)."
- Failure detail: "1 blocking issue outcome(s) remain after 1 review round(s) (1 unresolved, 0 need human review; 2 rejected, 0 under review)."
- Recommended action: "Continue and repair build (Continue build): run `eforge continue-repair orphaned-queued-build-adoption`. This queues the failed PRD through the compiled-artifact repair path and reuses preserved work; do not generate a successor PRD."
- Remaining work:
  - "Repair mod-adopted-failure-cancel-control by finalizing startup failed runs only when they are proven queued via command, queue PRD file context, or queue lock context."
  - "Then run the blocked mod-ac008-regression-coverage plan."
  - "Re-run type-check, tests, and maintainability checks after repair."
- Retry/resume guidance: Continue mod-adopted-failure-cancel-control for failed PRD orphaned-queued-build-adoption from the preserved compiled artifacts; do not restart dependency-satisfied work that is already landed or complete.
- Sidecar generated at: 2026-07-08T07:29:02.918Z
- Source sidecar: .eforge/queue/failed/orphaned-queued-build-adoption.recovery.json
- Source identity: prdId=orphaned-queued-build-adoption; setName=orphaned-queued-build-adoption; featureBranch=eforge/orphaned-queued-build-adoption; baseBranch=main
