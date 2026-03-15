---
id: plan-01-run-parallel
name: DRY runParallel Helper
depends_on: []
branch: parallel-agent-orchestration/run-parallel
---

# DRY runParallel Helper

## Architecture Context

The orchestrator already uses Semaphore + AsyncEventQueue to run plan builders concurrently within a wave. This same pattern is needed for expedition module planning (Layer 2) and multi-perspective review (Layer 3). Extracting it into a reusable `runParallel` helper DRYs the pattern and proves the abstraction by refactoring the orchestrator to use it.

## Implementation

### Overview

Add a generic `runParallel` async generator to `concurrency.ts` that multiplexes events from N concurrent tasks through a shared Semaphore + AsyncEventQueue. Then refactor the orchestrator's wave loop (lines 208-278) to delegate to `runParallel` for the concurrent execution part, keeping its own state/worktree management layered on top.

### Key Decisions

1. **`runParallel` is a pure concurrency primitive** - it handles semaphore limiting, event multiplexing, and error isolation. It does NOT handle state persistence, worktree management, or failure propagation - those remain in the orchestrator.
2. **Individual task failures are non-fatal** - a task that throws is caught and does not block other tasks. The caller can inspect results or handle errors through the event stream. `runParallel` emits no error events itself - callers wrap their `run()` generators to emit domain-specific failure events.
3. **Default parallelism uses `availableParallelism()` from `node:os`** when callers don't specify, matching the existing orchestrator default.

## Scope

### In Scope
- `runParallel` helper in `concurrency.ts` with `ParallelTask` interface
- Refactor orchestrator wave loop to use `runParallel` internally
- Tests for `runParallel` in the existing `test/concurrency.test.ts`

### Out of Scope
- Expedition module planning parallelism (plan-02)
- Multi-perspective review (plan-03)
- Any changes to events.ts, display.ts, or agent files

## Files

### Modify
- `src/engine/concurrency.ts` - Add `ParallelTask` interface and `runParallel` async generator function
- `src/engine/orchestrator.ts` - Refactor the wave execution loop (lines 208-278) to use `runParallel`. The orchestrator wraps each plan into a `ParallelTask` whose `run()` generator handles worktree creation, plan runner delegation, state updates, worktree cleanup, and failure propagation. `runParallel` handles the semaphore + event multiplexing.
- `test/concurrency.test.ts` - Add `runParallel` test suite

## Verification

- [ ] `pnpm type-check` passes with zero errors
- [ ] `pnpm test` passes - all existing concurrency tests still pass
- [ ] New `runParallel` tests cover: multi-task execution yielding all events, semaphore limiting (verify max concurrency is respected), error isolation (one failing task does not prevent others from completing), empty task list yields no events
- [ ] `pnpm build` produces `dist/cli.js` without errors
- [ ] Orchestrator wave loop uses `runParallel` internally - no direct Semaphore/AsyncEventQueue instantiation in orchestrator.ts outside of the `runParallel` import
