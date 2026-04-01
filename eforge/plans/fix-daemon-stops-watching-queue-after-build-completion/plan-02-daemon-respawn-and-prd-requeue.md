---
id: plan-02-daemon-respawn-and-prd-requeue
name: Daemon Watcher Respawn and PRD Re-queue Support
dependsOn: [plan-01-queue-dir-preservation-and-watch-recovery]
branch: fix-daemon-stops-watching-queue-after-build-completion/daemon-respawn-and-prd-requeue
---

# Daemon Watcher Respawn and PRD Re-queue Support

## Architecture Context

The daemon in `src/monitor/server-main.ts` spawns a watcher child process. The current exit handler (lines 312-333) has two gaps:

1. When the watcher is killed by a signal, `code` is `null` and `signal` is non-null. The handler checks `code !== 0 && code !== null`, which is `false` when code is null, so it falls through to the comment "Clean exit - no respawn needed" and does nothing. This leaves `autoBuild = true` with no watcher running.

2. When the watcher exits with code 0 (e.g., after fs.watch recovery exhausts retries from plan-01, or any other clean exit while autoBuild is still enabled), the handler does nothing. It should respawn the watcher since the daemon still wants auto-build to be active.

Separately, `discoverNewPrds()` in `src/engine/eforge.ts` (line 1201) skips PRDs whose `id` is already in `prdState`. When a user moves a failed PRD back to `eforge/queue/`, its id remains in `prdState` with status `'failed'`, so `isReady()` returns false and the PRD is never re-started.

## Implementation

### Overview

1. Rewrite the daemon exit handler to handle signal kills and respawn on clean exit
2. Add a circuit breaker to prevent runaway respawning
3. Add an `else` branch in `discoverNewPrds()` to reset prdState for re-queued PRDs

### Key Decisions

1. **Signal kill disables autoBuild** - if the watcher is killed by an external signal (not by the daemon itself via `watcherKilledByUs`), something unexpected happened. Disabling autoBuild and writing a paused event is the safe default.
2. **Code 0 with autoBuild still true triggers respawn** - the watcher exiting cleanly while the daemon expects it to be running means something caused an unexpected shutdown (e.g., all fs.watch producers removed). Respawning after a short delay (1 second) recovers automatically.
3. **Circuit breaker: max 3 respawns within 60 seconds** - prevents runaway respawning. Track respawn timestamps in an array; if 3 or more occurred within the last 60 seconds, disable autoBuild instead of respawning. Clear old timestamps to prevent unbounded growth.
4. **Reset prdState for re-queued PRDs** - when `discoverNewPrds()` finds a PRD id already in `prdState` with status `'failed'` or `'blocked'`, reset it to `'pending'`, update `dependsOn`, replace the stale entry in `orderedPrds` with the fresh PRD object, and emit `queue:prd:discovered`.

## Scope

### In Scope
- Rewrite `child.on('exit', ...)` handler in `src/monitor/server-main.ts` to capture `signal` parameter and handle three cases: non-zero exit, signal kill, and clean exit with autoBuild still enabled
- Add circuit breaker (respawn timestamp tracking, max 3 within 60 seconds)
- Add `else` branch in `discoverNewPrds()` in `src/engine/eforge.ts` to handle re-queued failed/blocked PRDs
- Unit tests for prdState reset on re-queued PRDs
- Unit tests for daemon respawn logic

### Out of Scope
- fs.watch recovery logic (plan-01)
- Queue directory deletion removal (plan-01)

## Files

### Modify
- `src/monitor/server-main.ts` - Rewrite the `child.on('exit', (code) => { ... })` handler at line 312:
  - Change signature to `child.on('exit', (code, signal) => { ... })`
  - After the `watcherKilledByUs` check, add three branches:
    - `code !== 0 && code !== null`: non-zero exit - disable autoBuild (existing behavior)
    - `signal !== null`: signal kill - disable autoBuild, write paused event (new)
    - `code === 0`: clean exit - if `autoBuild` is still true, check circuit breaker then respawn after 1 second delay via `setTimeout(() => spawnWatcher(), 1000)`
  - Add a `respawnTimestamps: number[]` array (scoped alongside `watcherKilledByUs`) to track respawn times
  - In the code-0 branch: push `Date.now()` to `respawnTimestamps`, filter out entries older than 60 seconds, and if length >= 3, disable autoBuild instead of respawning
- `src/engine/eforge.ts` - In `discoverNewPrds()`, after the `if (!prdState.has(prd.id))` block (line 1201-1214), add an `else` branch:
  - Get existing state via `prdState.get(prd.id)`
  - If status is `'failed'` or `'blocked'`: reset status to `'pending'`, update `dependsOn` from the fresh PRD's frontmatter, find and replace the stale entry in `orderedPrds` with the fresh `prd` object (matching by `id`), and push a `queue:prd:discovered` event
- `test/watch-queue.test.ts` - Add test: a PRD file moved back to the queue directory after being marked as failed in prdState is re-discovered and emits `queue:prd:discovered` with its id
- `test/monitor-shutdown.test.ts` - Add tests for daemon exit handler: (1) signal kill with `watcherKilledByUs = false` disables autoBuild, (2) code-0 exit with `autoBuild = true` and `watcherKilledByUs = false` triggers respawn via `spawnWatcher()`, (3) circuit breaker disables autoBuild after 3 respawns within 60 seconds

## Verification

- [ ] `child.on('exit', ...)` handler in `src/monitor/server-main.ts` accepts both `code` and `signal` parameters
- [ ] When the watcher is killed by a signal (`code === null`, `signal !== null`) and `watcherKilledByUs` is false, `daemonState.autoBuild` is set to false and `writeAutoBuildPausedEvent` is called
- [ ] When the watcher exits with code 0, `autoBuild` is still true, and `watcherKilledByUs` is false, `spawnWatcher()` is called after a delay
- [ ] A `respawnTimestamps` array tracks respawn times; when 3 or more respawns occur within 60 seconds, autoBuild is disabled instead of respawning
- [ ] `discoverNewPrds()` resets prdState entries with status `'failed'` or `'blocked'` back to `'pending'` when the PRD file is found in the queue directory
- [ ] `discoverNewPrds()` replaces the stale `orderedPrds` entry with the fresh PRD object when resetting a re-queued PRD
- [ ] `discoverNewPrds()` emits a `queue:prd:discovered` event when resetting a re-queued PRD
- [ ] `pnpm type-check` passes with zero errors
- [ ] `pnpm test` passes with no regressions
