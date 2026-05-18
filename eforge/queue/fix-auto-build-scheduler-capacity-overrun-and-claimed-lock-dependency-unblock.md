---
title: Fix Auto-Build Scheduler Capacity Overrun and Claimed-Lock Dependency Unblock
created: 2026-05-18
profile: gpt-claude-combo
---

# Fix Auto-Build Scheduler Capacity Overrun and Claimed-Lock Dependency Unblock

## Problem / Motivation

Auto-build can exceed configured capacity and incorrectly start dependent PRDs when an already-running PRD remains in `eforge/queue/` with an active queue lock.

Observed production symptom:
- Capacity was configured/reported as `2`.
- Three PRDs were running at once:
  - `runtime-reviewer-perspective-extension-point`
  - `make-monitor-ui-auto-build-toggle-safer`
  - `add-extension-packaging-and-install-support`
- `add-extension-packaging-and-install-support` had `depends_on: ["runtime-reviewer-perspective-extension-point"]`, but it started while that dependency was still running.

Why this matters:
- It violates the user's capacity expectation and can overload provider quotas/local resources.
- It violates queue dependency semantics and can create merge conflicts or invalid work based on incomplete upstream changes.
- It makes toggling/restarting auto-build unsafe because existing in-flight queue locks are not authoritative enough for scheduler startup.

Evidence sources reviewed:
- Live daemon state showed `maxConcurrentBuilds`/scheduler limit `2`, but three queue locks existed simultaneously:
  - `runtime-reviewer-perspective-extension-point.lock` PID `29311`
  - `make-monitor-ui-auto-build-toggle-safer.lock` PID `25026`
  - `add-extension-packaging-and-install-support.lock` PID `25317`
- Live queue/status showed all three PRDs as running, while auto-build was then disabled and scheduler reported `runningCount: 3, limit: 2`.
- Monitor DB event timeline around the incident:
  - `20:57:41`: scheduler dequeued and started `runtime-reviewer-perspective-extension-point`.
  - `21:49:28`: HTTP enabled auto-build; new scheduler run dequeued `make-monitor-ui-auto-build-toggle-safer` and also dequeued `runtime-reviewer-perspective-extension-point` again.
  - The duplicate runtime-reviewer subprocess emitted `queue:prd:skip` with reason `claimed by another process`, then `queue:prd:complete status=skipped`.
  - Scheduler treated that skipped completion as terminal/satisfied and then dequeued `add-extension-packaging-and-install-support`, even though its dependency `runtime-reviewer-perspective-extension-point` was still actually running.
- `packages/engine/src/queue/scheduler.ts` initializes every PRD present in the queue directory as `pending`; it does not check `.eforge/queue-locks/<prdId>.lock` on startup/resume to mark already-claimed PRDs as running.
- `QueueScheduler.isReady()` treats dependency status `completed` **or `skipped`** as satisfied. This is correct for obsolete/cancelled dependencies in some workflows, but unsafe for the `AlreadyClaimed` skip case.
- `QueueScheduler.onComplete()` only receives `{ prdId, status }`; it has no skip reason, so it cannot distinguish an obsolete/normal skip from a lock-contention skip.
- `packages/engine/src/prd-queue.ts` already has `QueueExecExitCode.SkippedAlreadyClaimed = 10` and `QueueSkipReason.AlreadyClaimed = 'claimed by another process'`. `spawnPrdChild()` in `packages/engine/src/eforge.ts` recognizes the exit code but collapses it to returned status `'skipped'` for the scheduler.
- Follow-up validation found `reconcileOrphanedState()` in `packages/monitor/src/server-main.ts`: daemon startup removes lock files whose PIDs are dead, but intentionally leaves live lock files in place. This supports using remaining lock files as live in-flight work for scheduler capacity/dependency reconciliation.
- Existing scheduler tests are in:
  - `test/queue-scheduler.test.ts`
  - `test/auto-build-resume-after-failure.test.ts`
  - `packages/engine/test/scheduler.test.ts`
- Queue lock tests exist in `test/prd-queue.test.ts`.
- `docs/roadmap.md` does not explicitly mention this bug, but it aligns with the Daemon & MCP Server goal of daemon as single orchestration authority with richer controls and safety checks.

## Goal

Fix the production-observed scheduling bug so that existing live queue locks are treated as in-flight work, count against `maxConcurrentBuilds`, and do not unblock dependent PRDs through an `AlreadyClaimed` skip.

Dependents of already-running locked PRDs should remain blocked until the real build emits a terminal completion, while normal terminal skipped behavior for obsolete/cancelled PRDs remains intact where intentionally supported.

## Approach

### High-level implementation direction

- Make scheduler startup/rescan lock-aware by using existing live queue locks as authoritative in-flight state.
- Prevent the scheduler from spawning duplicate children for PRDs whose `.eforge/queue-locks/<prdId>.lock` is held by a live process.
- Preserve or extend skip/completion semantics so `QueueExecExitCode.SkippedAlreadyClaimed` / `QueueSkipReason.AlreadyClaimed` is not treated as a terminal satisfied dependency.
- Keep the fix localized to scheduler state initialization/completion semantics plus tests where possible.

The main implementation decision is whether to model lock-held PRDs as `running` directly or introduce a more explicit `claimed`/`external-running` state; both are acceptable if capacity and dependency behavior are correct.

### Root cause 1: scheduler startup ignores existing queue locks

`QueueScheduler` initializes `prdState` from `initialPrds` in `packages/engine/src/queue/scheduler.ts`:

```ts
this.prdState.set(prd.id, { status: 'pending', dependsOn: deps });
```

It does not call `isPrdRunning(prd.id, cwd)` or otherwise inspect `.eforge/queue-locks/`. Therefore a fresh scheduler created while a PRD is already running treats the locked PRD as eligible `pending` work.

The project already has `isPrdRunning(prdId, cwd)` in `packages/engine/src/prd-queue.ts`, but scheduler does not use it.

### Root cause 2: lock-contention skip is collapsed into normal terminal `skipped`

`buildSinglePrd()` emits `QueueSkipReason.AlreadyClaimed` and exits via `QueueExecExitCode.SkippedAlreadyClaimed` when a duplicate child cannot claim a lock.

`spawnPrdChild()` recognizes `SkippedAlreadyClaimed` but returns only `'skipped'` to the scheduler. `QueueScheduler.onComplete()` receives only `status: 'skipped'`, increments skipped, may call `propagateSkip(..., 'cancelled')`, and updates the PRD state to skipped.

`isReady()` treats dependencies with status `completed` or `skipped` as satisfied:

```ts
return depState && (depState.status === 'completed' || depState.status === 'skipped');
```

So a duplicate claim skip is indistinguishable from a terminal skip and incorrectly unblocks dependents.

### Root cause 3: capacity accounting is in-memory only

`startReadyPrds()` derives `runningCount` only from scheduler-local `prdState.status === 'running'`. Since existing locks were initialized as pending instead of running, live workers from an earlier scheduler instance did not count against the new scheduler's capacity. This allowed two more PRDs to be dequeued while one real worker was already active.

### Related but not primary

Auto-build disable/enable behavior itself worked: events show the scheduler paused when auto-build was disabled. The overrun occurred before the disable completed, after a fresh enable/restart caused scheduler state to be reconstructed from queue files without lock-aware reconciliation.

### Reproduction steps

Production reproduction from observed event timeline:
1. Have `maxConcurrentBuilds = 2`.
2. Start PRD `A` from `eforge/queue/A.md`; it remains in the queue directory while its worker holds `.eforge/queue-locks/A.lock`.
3. Queue independent PRD `B` and dependent PRD `C` with `depends_on: ["A"]`.
4. Disable/re-enable auto-build or otherwise start a fresh scheduler while `A` is still running.
5. Scheduler initializes `A`, `B`, and `C` from queue files as pending.
6. Scheduler dequeues `B` and attempts to dequeue `A` again.
7. Duplicate `A` worker cannot claim the lock and emits:
   - `queue:prd:skip` reason `claimed by another process`
   - `queue:prd:complete status=skipped`
8. Scheduler treats `A` as skipped/satisfied and starts `C`.
9. Result: `A`, `B`, and `C` run concurrently, exceeding capacity `2`, and `C` starts before `A` is complete.

Expected behavior:
- Existing live locks count against capacity on scheduler start/rescan.
- A PRD locked by another process is considered running/in-flight, not skipped terminal.
- Dependents remain blocked until the real build emits `completed` or real terminal failure/skip with non-lock reason.

### Assumptions and validation

| Assumption | Evidence / validation performed | Confidence | Cost to validate further | Validation path | Impact if wrong |
|------------|----------------------------------|------------|--------------------------|-----------------|-----------------|
| Existing live queue locks are the correct source of truth for PRDs already running when a scheduler starts. | Live `.eforge/queue-locks/*.lock` files matched active worker PIDs; `claimPrd()`/`releasePrd()` already define lock ownership; `QueueExecExitCode.SkippedAlreadyClaimed` documentation says parent must not release the lock or move the file. | high | low | Add tests with lock files and live/dead PIDs; inspect `isPrdRunning()` behavior. | If wrong, scheduler may still miscount active work after daemon restarts. |
| Treating `AlreadyClaimed` as terminal skipped is unsafe and caused dependency unblock. | Monitor DB shows duplicate `runtime-reviewer` skip reason `claimed by another process`, then `queue:prd:complete status=skipped`, followed by dependent `add-extension-packaging...` dequeue while the real runtime-reviewer lock remained active. Code shows `isReady()` accepts skipped deps. | high | low | Add explicit regression where claimed skip does not satisfy deps. | If wrong, dependents may still start before dependencies finish. |
| A lock-aware startup fix can be localized to `QueueScheduler`/`spawnPrdChild` return semantics and tests. | Relevant code paths are in `packages/engine/src/queue/scheduler.ts`, `packages/engine/src/eforge.ts`, and `packages/engine/src/prd-queue.ts`; monitor auto-build supervisor only starts/stops/kicks scheduler and appears to have done so. | medium | medium | Implement smallest test-first change; if scheduler needs PID liveness helpers, add them in `prd-queue.ts`. | If wrong, fix may require daemon-level active run reconciliation as well. |
| Stale locks should not permanently block scheduling. | Validated after initial planning: `reconcileOrphanedState()` in `packages/monitor/src/server-main.ts` removes `.eforge/queue-locks/*.lock` files whose PIDs are dead at daemon startup and leaves live locks intact. `claimPrd()` tests confirm stale-lock cleanup is delegated to the reconciler. | high | low | Add scheduler tests with live current-process PID locks; rely on existing reconciler tests for dead PID cleanup, or add one targeted integration if implementation changes the lock helper. | If wrong, adding lock-aware running state could leave stale locked PRDs stuck. |
| Normal `skipped` semantics may still intentionally satisfy dependencies for obsolete/cancelled PRDs. | Existing `isReady()` treats skipped deps as satisfied; changing all skipped semantics could break current queue behavior. | medium | low | Review existing tests and preserve normal skipped behavior unless tests/design say failed/blocked should propagate differently. | If wrong, overbroad changes could regress skip propagation. |

No low-confidence/high-impact assumptions remain.

## Scope

### In scope

- Bugfix / focused implementation for production-observed incorrect scheduling.
- Scheduler state initialization/rescan behavior in `packages/engine/src/queue/scheduler.ts`.
- Scheduler completion semantics for lock-contention skips.
- Interaction with `spawnPrdChild()` in `packages/engine/src/eforge.ts` where `QueueExecExitCode.SkippedAlreadyClaimed` is currently collapsed to `'skipped'`.
- Use of `QueueExecExitCode.SkippedAlreadyClaimed = 10` and `QueueSkipReason.AlreadyClaimed = 'claimed by another process'` from `packages/engine/src/prd-queue.ts`.
- Capacity accounting that includes live locked PRDs plus scheduler-started PRDs.
- Dependency blocking semantics for PRDs whose dependencies are already running under live queue locks.
- Regression tests in relevant scheduler and queue-lock test suites:
  - `test/queue-scheduler.test.ts`
  - `test/auto-build-resume-after-failure.test.ts`
  - `packages/engine/test/scheduler.test.ts`
  - `test/prd-queue.test.ts`

### Out of scope

- Broad feature work beyond the localized scheduler state/completion fix and tests.
- Delegated subsystem planning.
- Expedition-scale architecture pass.
- Changing normal terminal skipped behavior for obsolete/cancelled PRDs where intentionally supported, unless existing tests/design require otherwise.

### Profile signal

Recommended profile: **excursion**.

Rationale: this is a non-trivial concurrency/state-machine bug involving scheduler startup, queue locks, child exit-code interpretation, and dependency unblocking. It should be handled as one cohesive plan with regression tests, but it does not require delegated subsystem planning or an expedition-scale architecture pass.

## Acceptance Criteria

### Functional

- When `QueueScheduler` starts or rescans, PRDs with active live queue locks are represented as in-flight/running, or an equivalent non-dispatchable state, and count against `maxConcurrentBuilds`.
- Scheduler must not spawn a duplicate child for a PRD whose `.eforge/queue-locks/<prdId>.lock` is held by a live process.
- If a duplicate/legacy path still produces `QueueExecExitCode.SkippedAlreadyClaimed` or `QueueSkipReason.AlreadyClaimed`, the scheduler must not mark the PRD as terminal skipped and must not unblock dependents.
- Dependents of an already-running locked PRD remain blocked/pending until a real terminal completion for that PRD is observed.
- Capacity-blocked/dequeued events report counts consistent with live locked PRDs plus scheduler-started PRDs.
- Normal terminal skipped behavior for obsolete/cancelled PRDs remains intact where intentionally supported.

### Regression tests

- Unit test: scheduler starts with an existing live lock for PRD `A`, independent `B`, and dependent `C(depends_on A)` at parallelism `2`; only `B` is spawned, `C` is not spawned, and capacity accounting treats `A` as running.
- Unit test: an already-claimed/lock-contention skip does not unblock dependents and does not increment skipped/processed as if it were terminal, or is never spawned in the first place and therefore cannot occur.
- Existing pause/resume, dependency, failure, and skip tests continue to pass.
- Queue lock tests cover stale/dead PID behavior if the implementation starts reading lock contents.

### Test reproduction to add

- Unit-level `QueueScheduler` regression with:
  - initial queue PRDs `A`, `B`, `C(depends_on A)`
  - an existing `.eforge/queue-locks/A.lock` to represent a live claim before scheduler start
  - parallelism `2`
  - expectation: scheduler does not spawn `A`, only spawns `B`, reports capacity as one pre-existing running + one new running, and leaves `C` blocked/pending.
- Completion-semantics regression with a simulated duplicate claimed completion:
  - if scheduler receives/computes an `already claimed` skip, it must not mark `A` as terminal skipped and must not unblock `C`.

### Validation

- `pnpm test -- queue-scheduler` or the relevant Vitest subset passes.
- Full `pnpm test` passes if practical.
- `pnpm type-check` passes.
