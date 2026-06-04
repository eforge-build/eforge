---
id: plan-01-deterministic-timer-tests
name: Replace Timer-Heavy Tests with Deterministic Synchronization
branch: reduce-low-value-test-suite-latency-and-maintenance-burden/plan-01-deterministic-timer-tests
agents:
  builder:
    effort: high
    rationale: Async scheduler, watch, stream, and periodic-file-check tests require
      careful event ordering and small testability seams without changing
      runtime behavior.
  reviewer:
    effort: high
    rationale: Review must verify that latency reductions preserve scheduler
      dependency and stream reaction coverage.
---

# Replace Timer-Heavy Tests with Deterministic Synchronization

## Architecture Context

The engine scheduler and monitor stream hub are event-driven. Existing tests in this slice use fixed sleeps to wait for scheduler bus handlers, subprocess stubs, stream polling intervals, and file-check timers. The implementation must keep production behavior unchanged while replacing arbitrary waits with event observation, fake timers, explicit queue drains, or a small stream-hub flush seam.

## Implementation

### Overview

Refactor the timer-heavy target tests so they wait on observable outcomes instead of sleeping for fixed durations. Prefer local helpers in each test file unless an existing shared helper can be used without adding side effects. Add a small `StreamHub.flush()`-style seam only for synchronous stream-hub polling/heartbeat delivery in tests.

### Key Decisions

1. Keep scheduler production logic unchanged unless an event-ordering seam is required. The scheduler already exposes observable state via `spawnPrdChild`, `eventQueue`, completion registries, and `processed`/`skipped` counters.
2. Use fake timers for unit-level timer utilities and `withPeriodicFileCheck`; use event/counter waits for scheduler and watch-queue tests.
3. Add a monitor stream-hub flush seam rather than waiting for poll or heartbeat intervals. The seam must execute the same scan/deliver/heartbeat logic used by the intervals and must not run unless explicitly called.

## Scope

### In Scope

- Replace fixed `setTimeout`/`sleep` waits in the timer-heavy acceptance target files.
- Table-drive status-literal variants inside the scheduler artifact/completion tests when they exercise the same code path.
- Remove the redundant `abortableSleep(..., undefined)` test if the no-signal normal-completion test still covers the same behavior.
- Add a small stream-hub flush seam if needed to remove monitor stream waits.

### Out of Scope

- Broad scheduler, stream, or queue architecture changes.
- Wire route changes, daemon response shape changes, or client schema changes.
- Replacing Vitest or rewriting the test harness.

## Files

### Modify

- `test/artifact-aware-scheduler.test.ts` — Replace fixed sleeps and polling in artifact-aware readiness and completion-index tests with local `vi.waitFor`/event-drain helpers. Use completion registry records or scheduler events as synchronization points for negative spawn assertions. Table-drive failed/skipped completion-index cases where only the terminal status differs.
- `test/auto-build-resume-after-failure.test.ts` — Replace sleeps after `scheduler.start()`, `bus.emit()`, `queue:mutation`, and `resume()` with waits on spawn counts, scheduler counters, and drained event types. Preserve the three pause/resume behaviors currently covered.
- `test/watch-queue.test.ts` — Convert `abortableSleep` tests to fake timers, delete the redundant undefined-signal normal-completion case, abort watch loops from observed events instead of timeout callbacks, and perform requeue writes/injections directly from event handling instead of delayed callbacks.
- `test/periodic-file-check.test.ts` — Replace real timer sleeps with fake timers and controllable async generator/deferred helpers. Advance timers to trigger periodic checks and assert emitted events deterministically.
- `packages/monitor/src/streams/stream-hub.ts` — Add a small synchronous `flush()` method to the returned `StreamHub` object if needed. It must run one poll cycle using existing scan/deliver logic and emit one daemon heartbeat frame when daemon subscribers exist.
- `packages/monitor/src/__tests__/streams-stream-hub.test.ts` — Remove the delay helper. Use subscriber-count waits for close propagation, use `hub.flush()` for daemon event reactions, and use `hub.flush()` to generate a daemon heartbeat in the broadcast test instead of waiting for the heartbeat interval.

## Verification

- [ ] `rg -n "setTimeout|sleep|delay\(" test/artifact-aware-scheduler.test.ts test/auto-build-resume-after-failure.test.ts test/watch-queue.test.ts test/periodic-file-check.test.ts packages/monitor/src/__tests__/streams-stream-hub.test.ts` reports no fixed stabilization sleeps except fake-timer setup, safety-free timer utility code under test, or comments explaining removed waits.
- [ ] `pnpm vitest run test/artifact-aware-scheduler.test.ts test/auto-build-resume-after-failure.test.ts test/watch-queue.test.ts test/periodic-file-check.test.ts packages/monitor/src/__tests__/streams-stream-hub.test.ts --reporter verbose` exits 0.
- [ ] Artifact-aware scheduler tests still assert completed upstream with artifact spawns one dependent.
- [ ] Artifact-aware scheduler tests still assert completed upstream without artifact leaves the dependent unspawned.
- [ ] Artifact-aware scheduler tests still assert failed and skipped upstream states block dependents.
- [ ] Artifact-aware scheduler tests still assert stale artifact and ambiguous `stack_parent` paths do not launch invalid dependents.
- [ ] Stream-hub reaction tests call the auto-build controller once for a post-start valid enqueue row and zero times for pre-existing rows.
- [ ] Any `StreamHub.flush()` seam is documented by tests and has no interval side effects when it is not called.
- [ ] `pnpm maintainability:check` exits 0.