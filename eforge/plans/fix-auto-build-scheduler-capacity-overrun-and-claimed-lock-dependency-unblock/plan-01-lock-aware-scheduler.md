---
id: plan-01-lock-aware-scheduler
name: Lock-Aware Queue Scheduler and Claimed-Skip Semantics
branch: fix-auto-build-scheduler-capacity-overrun-and-claimed-lock-dependency-unblock/plan-01-lock-aware-scheduler
agents:
  builder:
    effort: high
    rationale: Concurrency/state-machine bug spanning queue scheduler
      initialization, child exit interpretation, and regression tests.
  tester:
    effort: high
    rationale: Tests need to exercise lock-backed in-flight state, capacity
      accounting, dependency blocking, and already-claimed child exits.
  reviewer:
    effort: high
    rationale: Review must verify state transitions do not regress normal completed,
      failed, and skipped dependency behavior.
---

# Lock-Aware Queue Scheduler and Claimed-Skip Semantics

## Architecture Context

Auto-build uses `EforgeEngine.watchQueue()` to construct a `QueueScheduler` from PRDs present in `eforge/queue/`. Each spawned PRD child owns queue lock claiming through `.eforge/queue-locks/<prdId>.lock`, while the scheduler currently tracks capacity and dependencies only in its in-memory `prdState` map. A daemon restart or auto-build re-enable can therefore see a PRD file still present in `eforge/queue/`, miss its active lock, and attempt a duplicate launch.

The existing lock contract in `packages/engine/src/prd-queue.ts` already treats an existing lock file as a held claim; stale lock cleanup is handled by the daemon startup reconciler. The fix must reuse that contract rather than adding a second lock ownership model.

## Implementation

### Overview

Make `QueueScheduler` reconcile queue locks into its in-memory state before dispatching work, then preserve `SkippedAlreadyClaimed` as a non-terminal internal child result so lock contention cannot be collapsed into terminal `skipped` dependency satisfaction.

### Key Decisions

1. Treat any queue lock reported by `isPrdRunning(prdId, cwd)` as an in-flight `running` scheduler state for PRDs still present in `eforge/queue/`. The daemon reconciler removes dead-PID locks before scheduler startup, so the scheduler can use the existing helper without duplicating PID-liveness cleanup.
2. Keep the public `queue:prd:complete` event schema unchanged. Represent lock-contention exits as an internal scheduler child result such as `'already-claimed'`, suppress parent-emitted terminal completion for that result, and leave the PRD in `running` state until the original worker emits a real terminal completion.
3. Preserve existing `isReady()` behavior for normal terminal `skipped` dependencies. The bug is fixed by preventing `AlreadyClaimed` from becoming `skipped` scheduler state, not by changing all skipped dependency semantics.

## Scope

### In Scope

- Reconcile existing queue locks into `QueueScheduler` state during `start()` before `startReadyPrds()` runs.
- Reconcile locks for newly discovered PRDs in `discoverNewPrds()` before they can be launched.
- Ensure locked PRDs count in `runningCount`, reduce `capacityRemaining`, and contribute to `daemon:scheduler:capacity-blocked` payloads through the existing `running` state accounting.
- Prevent duplicate launches for PRDs with live queue locks.
- Widen the internal `spawnPrdChild` return contract so `QueueExecExitCode.SkippedAlreadyClaimed` becomes a non-terminal scheduler result.
- Suppress scheduler `queue:prd:complete` emission and counter increments for the non-terminal already-claimed result.
- Add regression tests for lock-aware startup and already-claimed child-result semantics.

### Out of Scope

- Database migrations.
- HTTP API or daemon wire schema changes.
- Monitor UI changes.
- Broad redesign of queue dependency semantics.
- Changing normal terminal `skipped` behavior for obsolete or cancelled PRDs.

## Files

### Create

- None.

### Modify

- `packages/engine/src/queue/scheduler.ts` — import and use `isPrdRunning`; add a lock reconciliation helper; call it before initial dispatch and after queue discovery; widen the scheduler child result type; suppress terminal completion for already-claimed child exits.
- `packages/engine/src/eforge.ts` — change `spawnPrdChild()` so `QueueExecExitCode.SkippedAlreadyClaimed` resolves to the new non-terminal internal result while still avoiding lock release and file movement; update the `watchQueue()` scheduler callback type usage.
- `test/queue-scheduler.test.ts` — add the primary regression tests using real temp queue-lock files: locked `A`, independent `B`, dependent `C(depends_on A)` at parallelism `2`, plus a simulated already-claimed child result that leaves dependents blocked and counters unchanged.
- `test/auto-build-resume-after-failure.test.ts` — update test helper return types if the scheduler child result union changes; keep pause/resume behavior covered.
- `packages/engine/test/scheduler.test.ts` — update the never-resolving scheduler test helper type if the scheduler child result union changes; add or adjust event assertions if needed for lock-aware capacity payloads.

## Implementation Notes

### Scheduler lock reconciliation

Add a private async helper in `QueueScheduler`, for example:

```ts
private async reconcileClaimedPrds(prds: QueuedPrd[]): Promise<void> {
  for (const prd of prds) {
    const state = this.prdState.get(prd.id);
    if (!state || state.status !== 'pending') continue;
    if (await isPrdRunning(prd.id, this.cwd)) {
      state.status = 'running';
    }
  }
}
```

Call this helper:

- In `start()`, after `discoverNewPrds()` and before `startReadyPrds()`.
- In `discoverNewPrds()`, after adding or resetting PRDs to pending and before control returns to `tick()`/`start()`.

If the helper is called inside `discoverNewPrds()`, avoid duplicate work in `start()` unless needed for initial PRDs when `loadQueue()` fails. The first dispatch path must see locked initial PRDs as `running`.

### Internal child result

Introduce an exported type or local scheduler type similar to:

```ts
type QueueSchedulerChildStatus = 'completed' | 'failed' | 'skipped' | 'already-claimed';
```

Use this type for `QueueSchedulerOptions.spawnPrdChild` and `EforgeEngine.spawnPrdChild()` return values. In `packages/engine/src/eforge.ts`, map `QueueExecExitCode.SkippedAlreadyClaimed` to `'already-claimed'`; keep `QueueExecExitCode.SkippedNeedsRevision` mapped to `'skipped'` because that is a terminal skip path for this scheduler contract.

In the scheduler IIFE after `await this._spawnPrdChild(...)`:

- For `'completed'`, `'failed'`, and `'skipped'`, continue pushing `queue:prd:complete` with the existing status union.
- For `'already-claimed'`, do not push `queue:prd:complete`, do not change `prdState` away from `running`, and allow the semaphore/producer cleanup in `finally` to run.

Do not add `'already-claimed'` to `EforgeEvent` or `queue:prd:complete` wire schemas.

## Verification

- [ ] With a lock file for PRD `a`, scheduler startup marks `a` as `running`, does not call `spawnPrdChild` for `a`, launches only independent PRD `b`, and leaves `c(depends_on a)` unlaunched.
- [ ] In the locked-startup regression, the `daemon:scheduler:dequeued` event for `b` reports `capacityRemaining: 0` when parallelism is `2` and locked `a` is counted as one running PRD.
- [ ] In a full-capacity locked-startup regression with locked `a` and independent pending PRDs, the `daemon:scheduler:capacity-blocked` event reports counts that include locked `a` plus scheduler-started PRDs.
- [ ] In the locked-startup regression, a `daemon:scheduler:dependency-blocked` event for `c` lists `blockedBy: ['a']`.
- [ ] `QueueExecExitCode.SkippedAlreadyClaimed` maps to the internal already-claimed result instead of terminal `skipped`.
- [ ] When `spawnPrdChild` resolves the internal already-claimed result, scheduler counters remain `processed === 0` and `skipped === 0` for that PRD.
- [ ] When `spawnPrdChild` resolves the internal already-claimed result, `c(depends_on a)` is not launched after a subsequent scheduler tick.
- [ ] Existing completed-upstream tests still launch dependents after `queue:prd:complete status=completed`.
- [ ] Existing failed-upstream tests still block dependents after `queue:prd:complete status=failed`.
- [ ] Existing terminal skipped-upstream behavior remains covered by existing tests or a new focused assertion if no current test covers it.
- [ ] `pnpm type-check` exits with code `0`.
- [ ] `pnpm test -- queue-scheduler auto-build-resume-after-failure prd-queue` exits with code `0`.
- [ ] Run `pnpm test` if the local test budget permits; record the command result in the build summary.