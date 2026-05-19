---
title: Reconcile Scheduler State for Stale Queue Locks and Phantom Running Capacity
created: 2026-05-19
profile: gpt-claude-combo
---

# Reconcile Scheduler State for Stale Queue Locks and Phantom Running Capacity

## Problem / Motivation

User-observed defect: after a queued PRD was enqueued with auto-build enabled and scheduler capacity `limit = 2`, it did not start even though only one build appeared active and the new PRD had no dependencies. DB events showed the scheduler emitted `daemon:scheduler:capacity-blocked` with `runningCount: 2, limit: 2`. Filesystem inspection found a stale dead-PID lock for an already completed PRD (`.eforge/queue-locks/keep-public-documentation-synchronized-with-the-current-implementation.lock`), and deleting that lock plus calling `POST /api/scheduler/kick` still left the scheduler capacity-blocked. `eforge_auto_build` then reported `runningCount: 1, limit: 2`, revealing divergence between monitor DB-derived capacity display and the scheduler's in-memory `prdState`.

The auto-build scheduler can get stuck capacity-blocked by phantom `running` PRDs after queue lock state changes during daemon runtime. Users can enqueue a ready PRD with available real capacity, call the documented scheduler kick endpoint, and still see the PRD remain pending because the live scheduler counts stale in-memory `prdState.status === 'running'` entries.

This affects daemon auto-build reliability and observability:

- Queue watcher/kick semantics are misleading: `POST /api/scheduler/kick` returns `{ ok: true }` but does not repair stale in-memory capacity.
- Monitor capacity display can disagree with scheduler decisions because monitor derives running count from DB runs while scheduler uses its internal PRD state.
- Users must restart/toggle the watcher to rebuild scheduler state, which is operationally disruptive and undermines the purpose of the kick endpoint.

Roadmap alignment: `docs/roadmap.md` has no specific item for scheduler reconciliation. This is a daemon maturity/correctness bug under the existing auto-build orchestration goal, not a new roadmap feature.

### Evidence from current code

- `packages/engine/src/queue/scheduler.ts` owns event-driven scheduling. `tick()` calls `discoverNewPrds()` then `startReadyPrds()`.
- `discoverNewPrds()` currently adds new PRDs, resets failed/blocked re-queued PRDs, and calls `reconcileClaimedPrds(freshOrdered)`.
- `reconcileClaimedPrds()` only transitions `pending` PRDs to `running` when `isPrdRunning(prd.id, cwd)` sees a lock file. It never demotes or removes an existing in-memory `running` PRD when its lock is missing/stale or its PRD file is no longer in queue root.
- `startReadyPrds()` computes capacity by counting in-memory states with `status === 'running'`, so phantom `running` entries block later PRDs.
- `packages/engine/src/prd-queue.ts` currently makes `claimPrd()` treat any existing lock as held. The comments explicitly say stale locks are the startup reconciler's job, not claim-time cleanup.
- `packages/monitor/src/server-main.ts` has `reconcileOrphanedState()` at daemon startup. It marks dead-PID running DB rows failed and deletes dead-PID queue lock files. It runs once on startup. The periodic orphan timer handles DB running runs whose PID dies, but does not sweep queue locks or notify the live scheduler's in-memory state.
- `packages/client/src/api/scheduler.ts` documents `POST /api/scheduler/kick` as waking the daemon `QueueScheduler` without relying on filesystem events. In practice it injects a mutation, but the scheduler's current tick does not reconcile stale `running` state.

### Git history validation

- `cba63974 feat(engine): subprocess-per-build with crash-safe reconciler` deliberately removed PID-liveness stale-lock cleanup from `claimPrd()`. Before that commit, `claimPrd()` read the lock PID, checked liveness, deleted stale locks, and retried. The commit message says stale-lock sweeping moved to a one-shot daemon startup reconciler and that parent child-exit cleanup is the sole normal cleanup path.
- `bd23be9a` / `1ad4d3de feat(plan-01-lock-aware-scheduler)` added the current lock-aware scheduler design to prevent duplicate launches: locked PRDs are reconciled to in-memory `running`, and `QueueExecExitCode.SkippedAlreadyClaimed` becomes non-terminal `already-claimed` so dependents do not unblock incorrectly.
- The prior lock-aware plan explicitly assumed: "The daemon reconciler removes dead-PID locks before scheduler startup, so the scheduler can use the existing helper without duplicating PID-liveness cleanup." The current bug is a runtime version of that assumption failing after startup.

### Reproduction Steps

Observed reproduction in the current project:

1. Auto-build is enabled and the scheduler is alive with `maxConcurrentBuilds` / limit `2`.
2. One PRD build is actually running: `investigation-first-planning-playbook-invocation-semantics`.
3. A stale lock file remains for an already completed PRD: `.eforge/queue-locks/keep-public-documentation-synchronized-with-the-current-implementation.lock`, containing dead PID `6403`.
4. Enqueue a new independent PRD: `surface-and-persist-selected-build-profile-in-monitor-ui`.
5. The scheduler handles the enqueue mutation and emits `daemon:scheduler:capacity-blocked` with `runningCount: 2, limit: 2`, so the new PRD remains pending.
6. Remove the dead lock file and call `POST /api/scheduler/kick`.
7. The endpoint returns `{ ok: true }`, and `eforge_auto_build` reports `runningCount: 1, limit: 2`, but the scheduler still emits `daemon:scheduler:capacity-blocked runningCount: 2, limit: 2` and does not launch the pending PRD.
8. Toggling/restarting the watcher rebuilds scheduler state and unblocks dispatch.

Expected behavior:

- A scheduler kick or queue mutation should reconcile runtime lock/file state before capacity calculation.
- Dead or missing claims should not keep an in-memory PRD counted as `running` forever.
- A ready independent PRD should start when real capacity is available, without daemon restart or watcher toggle.

Actual behavior:

- Runtime ticks only reconcile `pending → running` for locked PRDs. They do not reconcile stale `running → pending/removed`, so phantom running entries can block capacity indefinitely.

### Root Cause

Confirmed by code inspection and git history.

Immediate root cause:

- `QueueScheduler.tick()` in `packages/engine/src/queue/scheduler.ts` runs `discoverNewPrds()` and then `startReadyPrds()`.
- `discoverNewPrds()` calls `reconcileClaimedPrds(freshOrdered)`.
- `reconcileClaimedPrds()` only checks PRDs whose in-memory state is `pending`; if a lock exists, it changes them to `running`.
- There is no runtime reconciliation path for PRDs already marked `running` when their lock disappears, their lock PID is dead, or their queue file is no longer present in `eforge/queue/`.
- `startReadyPrds()` computes `runningCount` purely from in-memory `prdState.status === 'running'`, so stale `running` entries continue to consume capacity.

Historical/design root cause:

- Before `cba63974`, `claimPrd()` performed stale-lock cleanup by reading the lock PID, checking liveness, deleting dead locks, and retrying the claim.
- `cba63974` intentionally removed that behavior and moved stale-lock sweeping to daemon startup reconciliation, so claim acquisition became conservative: any existing lock means held.
- `1ad4d3de` later made the scheduler lock-aware by treating locked queue PRDs as in-flight `running`, preventing duplicate launches and preserving `already-claimed` as non-terminal.
- That lock-aware scheduler assumed startup reconciliation had already removed stale locks. It did not add a runtime reconciler for the live scheduler after locks/files change while the daemon remains up.

## Goal

Make scheduler state self-healing during normal operation without reverting to the older race-prone claim-time stale-lock deletion design.

A scheduler tick/kick or queue mutation should reconcile runtime lock/file state before capacity calculation so phantom `running` PRDs do not block ready independent PRDs when real capacity is available.

## Approach

Recommended profile: **excursion**.

Rationale: This is a focused scheduler correctness bug with a well-bounded root cause, but it touches concurrency/state-machine behavior, lock ownership contracts, and regression tests around historically fragile queue semantics. A single cohesive planner can cover the design; expedition is unnecessary. It is not an errand because careless changes could reintroduce duplicate launches or already-claimed dependency bugs.

### Design constraints

- Do not reintroduce stale-lock deletion into `claimPrd()`. Claim-time cleanup was deliberately removed and is a race-prone ownership boundary.
- Keep lock cleanup and state repair owned by scheduler/watcher reconciliation, where launch/capacity state is also owned.
- Preserve live-lock semantics: a live lock means another process owns the PRD; do not reclaim or double-launch it.

### Likely implementation shape

- Add a lock-status helper in `packages/engine/src/prd-queue.ts`, e.g. `readPrdLockStatus(prdId, cwd): { state: 'absent' | 'live' | 'stale' | 'corrupt'; pid?: number }`, or equivalent. It should use the same liveness semantics as daemon startup reconciliation (`process.kill(pid, 0)` / shared client `isPidAlive` if import boundaries allow).
- Add a scheduler-owned `reconcileRuntimeClaims()` in `packages/engine/src/queue/scheduler.ts` that receives/uses the freshly loaded root queue PRDs.
- For each root-queue PRD with `pending` state and a live lock, keep current behavior: mark `running`.
- For each in-memory `running` PRD:
  - If it is in `launching`, leave it alone; this is the scheduler's own handoff window.
  - If the root queue still contains the PRD and the lock is live, leave it `running`.
  - If the root queue still contains the PRD and the lock is absent/stale/corrupt, remove stale/corrupt lock if present and demote to `pending` so capacity can be recalculated and normal dispatch can claim it.
  - If the root queue no longer contains the PRD, remove it from active capacity accounting (for example delete from `prdState` or mark terminal based on a conservative internal state) so it no longer blocks new work.
- Run this reconciliation during startup and each tick before `startReadyPrds()`, including kicks and completion-triggered ticks.
- Emit diagnostic events for reconciliation actions if suitable (`daemon:scheduler:reconciled` / `daemon:scheduler:lock-stale`), but avoid over-expanding the wire contract unless needed; tests can assert behavior via existing dequeued/capacity events if new event variants are too costly.

### Early assumptions / unknowns

- Assumption: the long-term fix should not reintroduce stale-lock deletion inside `claimPrd()`. Confidence high; git history shows that behavior was intentionally removed because claim-time cleanup is race-prone and conflicts with parent/scheduler ownership.
- Assumption: the fix belongs in scheduler-owned runtime reconciliation, invoked before capacity calculation on startup, mutation/kick, and completion ticks. Confidence high; the scheduler owns `prdState`, capacity, and launch decisions.
- Unknown: exact terminal-state inference for `running` PRDs whose queue file is missing and no lock remains. Candidate conservative behavior: remove from active capacity accounting and do not emit terminal queue completion; rely on run DB/events for terminal history. Builder should validate against existing completion/cleanup flow.

### Assumptions and validation

| Assumption | Evidence / validation performed | Confidence | Cost to validate further | Validation path | Impact if wrong |
|------------|----------------------------------|------------|--------------------------|-----------------|-----------------|
| The scheduler is stuck because its in-memory `prdState` still has a phantom `running` entry. | Observed `daemon:scheduler:capacity-blocked runningCount=2` after lock deletion while `eforge_auto_build` reported `runningCount=1`; read `startReadyPrds()` capacity calculation from `prdState`. | high | low | Add scheduler unit test that reproduces stale running state after lock deletion. | If wrong, fix may need daemon DB/run reconciliation instead. |
| Reintroducing stale-lock cleanup inside `claimPrd()` is not the right fix. | Git history: `cba63974` deliberately removed PID-liveness cleanup from `claimPrd()` and moved stale sweeping to reconciler; current comments say existing locks are treated as held. | high | low | Keep `claimPrd()` unchanged and add tests that assert live-lock/claim behavior remains conservative. | If wrong, a scheduler-only fix might miss direct queue exec scenarios; however claim-time retry could reintroduce races. |
| Runtime reconciliation belongs in `QueueScheduler.tick()` before capacity calculation. | `POST /api/scheduler/kick` injects queue mutation; `onMutation()` calls `tick()`; `tick()` is the shared path for discovery and launch decisions. | high | low | Test mutation/kick path through scheduler bus. | If wrong, kick endpoint may still not repair state. |
| A live lock should remain authoritative for cross-process ownership. | Lock-aware scheduler plan and tests were added to prevent duplicate launches and keep already-claimed non-terminal. | high | low | Existing lock-aware startup and already-claimed tests should continue to pass. | If wrong, double-builds or incorrect dependency unblocking can return. |
| Missing root queue file for an in-memory `running` PRD should free scheduler capacity without synthesizing terminal success/failure. | Queue file removal usually means completed cleanup or moved terminal state; terminal events are produced by child/parent flow elsewhere. This exact inference has not been exhaustively validated. | medium | medium | Builder should inspect completion cleanup flow and add a focused test for disappeared root queue file. | If wrong, counters or dependents could become inconsistent; conservative no-terminal behavior reduces risk. |
| A lock-status helper can live in `prd-queue.ts` without importing monitor packages. | `prd-queue.ts` already owns queue lock paths and claim/release helpers. Liveness can be implemented locally or via an allowed shared client helper if import boundaries permit. | high | low | Type-check import boundaries; avoid monitor dependency from engine. | If wrong, duplicate small liveness helper in engine or move to shared package. |
| New diagnostic event variants are optional for the fix. | Existing scheduler events (`dequeued`, `capacity-blocked`, `dependency-blocked`) can verify behavior; adding event variants expands client schema/docs work. | medium | low | Builder can decide whether diagnostics are worth added schema work. | If wrong, users may lack visibility into reconciliation actions, but core behavior still fixes the bug. |

No low-confidence/high-impact assumptions remain unresolved. The medium-confidence queue-file-missing handling should be implemented conservatively and covered by tests before the plan is considered complete.

## Scope

### In scope

- Runtime scheduler reconciliation for stale in-memory `running` PRDs.
- Reconciliation before scheduler capacity calculation on startup, mutation/kick, and completion-triggered ticks.
- Lock status detection for absent, live, stale, and corrupt queue locks.
- Best-effort removal of stale/corrupt locks during scheduler-owned reconciliation.
- Demotion of stale `running` PRDs back to `pending` when they still exist in the root queue and have no live lock.
- Removal from active capacity accounting for in-memory `running` PRDs whose root queue file no longer exists.
- Preservation of lock-aware scheduler behavior that prevents duplicate launches.
- Regression tests using real temp queue-lock files in `test/queue-scheduler.test.ts`.

### Out of scope

- Reintroducing stale-lock deletion/retry inside `claimPrd()`.
- Treating absent/stale/corrupt locks as claimable inside `claimPrd()`.
- Reclaiming or double-launching PRDs that have live locks.
- Synthesizing success/failure terminal queue completion events for running PRDs whose queue file disappeared unless an existing reliable terminal signal exists.
- Adding new scheduler diagnostic event variants unless deemed worthwhile; the fix can be verified via existing events.

## Acceptance Criteria

### Functional acceptance

1. A scheduler tick/kick reconciles stale in-memory `running` PRDs before capacity calculation.
2. If a PRD is `running` in scheduler memory, still exists in `eforge/queue/`, is not in the scheduler's `launching` handoff set, and has no live lock, the scheduler demotes it to `pending` so it can be normally dispatched or so capacity is freed for later ready PRDs.
3. If a PRD is `running` in scheduler memory and its lock file contains a dead PID or corrupt content, runtime reconciliation removes the stale/corrupt lock (best-effort), demotes the PRD to `pending`, and allows normal dispatch to reclaim it.
4. If a PRD is `running` in scheduler memory and has a live lock, it remains `running`, counts against capacity, is not double-launched, and continues to block dependents until a real terminal completion is observed.
5. If a PRD is `running` in scheduler memory but no longer exists in the root queue, it stops counting against active capacity. The implementation should be conservative about terminal counters/events; do not synthesize success/failure unless an existing reliable terminal signal exists.
6. `POST /api/scheduler/kick` triggers the reconciliation path because it already injects `queue:mutation` and `onMutation()` calls `tick()`.
7. Existing `already-claimed` semantics remain intact: `QueueExecExitCode.SkippedAlreadyClaimed` still maps to internal non-terminal `already-claimed`; no public `queue:prd:complete` is emitted for it; dependents remain blocked while a live lock exists.
8. `claimPrd()` remains conservative and does not reintroduce claim-time stale-lock deletion/retry.
9. Monitor/daemon capacity reports and scheduler decisions no longer diverge after stale locks are removed: once real running count is below limit and a ready PRD is pending, the scheduler dequeues it on kick/mutation.

### Test acceptance

- Add queue scheduler tests in `test/queue-scheduler.test.ts` using real temp queue-lock files.
- Regression: initial scheduler state has `a` as running due to a lock; the lock is later deleted; independent ready `b` is pending; after `queue:mutation`/kick, `b` is dequeued rather than capacity-blocked by phantom `a`.
- Regression: stale/dead-PID lock for `a` is removed during runtime reconciliation, `a` is demoted to pending or otherwise no longer phantom-running, and a ready PRD can launch when capacity is available.
- Regression: live lock for `a` remains counted as running and prevents double-launch; dependent `c(depends_on a)` remains dependency-blocked.
- Regression: in-memory running PRD whose queue file has disappeared no longer counts against capacity and does not produce duplicate terminal completion events.
- Existing lock-aware startup tests from `1ad4d3de` continue to pass.
- Existing already-claimed child-result tests continue to pass.
- Run targeted tests: `pnpm test -- queue-scheduler auto-build-resume-after-failure prd-queue` or the current vitest filter equivalent, plus `pnpm type-check` if time permits.
