---
id: plan-01-runtime-queue-lock-reconciliation
name: Runtime Queue Lock Reconciliation
branch: reconcile-scheduler-state-for-stale-queue-locks-and-phantom-running-capacity/plan-01-runtime-queue-lock-reconciliation
agents:
  builder:
    effort: high
    rationale: The fix is focused but touches scheduler state-machine and lock
      ownership behavior where regressions can cause duplicate launches or stuck
      dependencies.
  reviewer:
    effort: high
    rationale: Review must verify concurrency boundaries, live-lock preservation,
      and already-claimed semantics.
  tester:
    effort: high
    rationale: Tests need to exercise real filesystem lock states and event ordering
      around scheduler ticks.
---

# Runtime Queue Lock Reconciliation

## Architecture Context

`QueueScheduler` owns auto-build dispatch decisions, in-memory `prdState`, capacity accounting, and launch handoff tracking. Queue lock files under `.eforge/queue-locks/` are the cross-process ownership signal; `claimPrd()` intentionally treats any existing lock as held and must remain conservative. The daemon startup reconciler removes dead-PID queue locks once at startup, but runtime ticks currently only promote `pending` PRDs with locks to `running`; they never demote phantom `running` entries when locks disappear, become stale/corrupt, or the PRD leaves the root queue.

This plan keeps stale-lock cleanup out of `claimPrd()` and moves runtime repair into scheduler-owned reconciliation before capacity calculation on startup, queue mutation/kick, and completion-triggered ticks.

## Implementation

### Overview

Add a reusable queue-lock status helper in `packages/engine/src/prd-queue.ts`, replace the scheduler's one-way `reconcileClaimedPrds()` with bidirectional runtime claim reconciliation, and cover the lock/file state transitions with real filesystem tests.

### Key Decisions

1. `claimPrd()` remains unchanged except for any import/type adjustments required by the new helper. It must continue returning `false` for any existing lock, including dead-PID, corrupt, and empty locks.
2. Runtime lock repair runs in `QueueScheduler` before `startReadyPrds()` so capacity is calculated from reconciled state.
3. Live queue locks remain authoritative. A `pending` PRD with a live lock is promoted to `running`; a `running` PRD with a live lock remains `running` and dependents remain blocked.
4. Stale or corrupt queue locks are removed best-effort by scheduler reconciliation, not by claim acquisition. If removal fails, do not throw from the scheduler tick; leave the scheduler in a conservative state that avoids duplicate launching.
5. A `running` PRD that no longer exists in the root queue is removed from active capacity accounting without incrementing processed/skipped counters or emitting `queue:prd:complete`.
6. No new daemon/client event variants are required for this fix; use existing `daemon:scheduler:dequeued`, `daemon:scheduler:capacity-blocked`, and `daemon:scheduler:dependency-blocked` events for behavioral verification.

## Scope

### In Scope

- Add a lock status helper for root queue PRD lock files with states `absent`, `live`, `stale`, and `corrupt`.
- Use PID liveness semantics equivalent to daemon startup reconciliation (`process.kill(pid, 0)` via the shared `@eforge-build/client` helper or a local equivalent if import boundaries require it).
- Run scheduler runtime reconciliation from `start()`, `tick()`, and `onComplete()` through the existing `discoverNewPrds()`/tick path before capacity calculation.
- Promote pending root-queue PRDs with live locks to `running`.
- Demote non-launching in-memory `running` root-queue PRDs to `pending` when their lock is absent, stale, or corrupt.
- Remove stale/corrupt lock files best-effort during scheduler reconciliation.
- Delete in-memory `running` state, or otherwise exclude it from capacity accounting, when the PRD no longer exists in the freshly loaded root queue.
- Regression tests in `test/queue-scheduler.test.ts` using real temp `.eforge/queue-locks/*.lock` files.
- Focused helper tests in `test/prd-queue.test.ts` if the helper is exported.

### Out of Scope

- Reintroducing stale-lock deletion/retry into `claimPrd()`.
- Treating absent/stale/corrupt locks as claimable inside `claimPrd()`.
- Double-launching PRDs with live locks.
- Emitting public terminal completion events for missing root queue files unless an existing reliable completion signal is already present.
- New scheduler diagnostic event types, client schemas, or monitor UI rendering.
- Database migrations.

## Files

### Create

- None expected.

### Modify

- `packages/engine/src/prd-queue.ts` — Add and export a queue lock status helper, for example `readPrdLockStatus(prdId, cwd): Promise<{ state: 'absent' | 'live' | 'stale' | 'corrupt'; pid?: number }>`; optionally add an exported helper to remove a queue lock by PRD id if that keeps scheduler code concise. Keep `isPrdRunning()` compatible with existing callers, either implemented in terms of the new helper or left as a lock-existence check if tests depend on that exact meaning.
- `packages/engine/src/queue/scheduler.ts` — Replace one-way `reconcileClaimedPrds()` with runtime reconciliation that receives the freshly loaded ordered root queue. Build a root queue id set from `freshOrdered`. For each root PRD, update/add state as today, then reconcile pending/running states against the lock status before calling `startReadyPrds()`. Skip demotion for ids in `launching`. Remove in-memory running entries whose ids are absent from the root queue so they do not count toward capacity.
- `test/queue-scheduler.test.ts` — Add regressions for lock deletion after startup, dead-PID/corrupt lock cleanup during runtime reconciliation, live-lock preservation/dependency blocking, and missing root queue file removal from active capacity accounting.
- `test/prd-queue.test.ts` — Add helper tests for `absent`, `live`, `stale`, and `corrupt` lock states if `readPrdLockStatus()` is exported.

## Implementation Notes

- `loadQueue(this.queueDir, this.cwd)` loads the root queue plus terminal subdirectories. The scheduler reconciliation needs the root-queue PRD list used for dispatch. If `loadQueue()` includes failed/skipped/waiting subdirectories, filter `freshOrdered` down to PRD files whose `filePath` is within `resolve(this.cwd, this.queueDir)` but not within root queue subdirectories such as `failed`, `skipped`, and `waiting` before building the active root id set. Use existing path utilities and avoid string prefix bugs where possible.
- `orderedPrds` can contain stale PRD objects. When a root PRD still exists, replace the corresponding `orderedPrds` entry with the fresh object so dispatch uses current frontmatter and path. When a running PRD disappears from the root queue, remove that id from `orderedPrds` or ensure `startReadyPrds()` skips it due to missing state.
- For stale/corrupt locks, attempt `releasePrd(prdId, this.cwd)` or `rm(lockPath)` in a `try/catch`. Only demote after either the lock is absent or the stale/corrupt lock has been removed; if removal fails, keep the PRD `running` for that tick to avoid racing a live owner represented by an undeleted file.
- A corrupt lock includes non-numeric, empty, non-finite, or non-positive content. A stale lock contains a valid PID that is not alive.
- Existing scheduler `launching` covers the async route/policy/semaphore handoff. Reconciliation must not demote ids in `launching` even if `claimPrd()` has not written a lock yet.
- Existing `already-claimed` child result leaves the PRD in `running`. With the new reconciliation, it must stay `running` while a live lock exists and dependents must remain blocked. If no live lock exists on a later tick, demotion to `pending` is allowed so the scheduler can retry normally.

## Verification

- [ ] `claimPrd()` still returns `false` and leaves the file untouched when an existing lock contains a dead PID, invalid content, or empty content.
- [ ] `readPrdLockStatus()` or equivalent returns `absent` when no lock exists, `live` with `pid` for the current process PID, `stale` with `pid` for a dead positive PID, and `corrupt` for invalid or empty content.
- [ ] A scheduler started with locked `a` and independent pending `b` counts `a` as running before dispatch; after `a.lock` is deleted and `queue:mutation` is emitted, a ready independent PRD is dequeued instead of a `capacity-blocked` event with the stale `a` counted.
- [ ] A dead-PID or corrupt `a.lock` is removed during scheduler reconciliation and does not keep `a` counted as running after the next mutation/kick tick.
- [ ] A live `a.lock` keeps `a` in `running`, prevents spawning `a`, and keeps `c` with `depends_on: [a]` dependency-blocked on mutation/kick.
- [ ] A `running` PRD whose root queue markdown file was removed no longer contributes to `daemon:scheduler:capacity-blocked.runningCount` and no `queue:prd:complete` event is emitted for that PRD by reconciliation.
- [ ] `QueueExecExitCode.SkippedAlreadyClaimed` still maps to `already-claimed`, emits no public `queue:prd:complete`, and leaves dependents blocked while a live lock exists.
- [ ] `pnpm test -- queue-scheduler prd-queue auto-build-resume-after-failure` passes.
- [ ] `pnpm type-check` passes.