---
id: plan-01-queue-dir-preservation-and-watch-recovery
name: Queue Directory Preservation and fs.watch Recovery
dependsOn: []
branch: fix-daemon-stops-watching-queue-after-build-completion/queue-dir-preservation-and-watch-recovery
---

# Queue Directory Preservation and fs.watch Recovery

## Architecture Context

The daemon's queue watcher uses `fs.watch` on `eforge/queue/` to detect new PRDs. Two independent code paths delete this directory after builds complete: `cleanupPlanFiles()` in `src/engine/cleanup.ts` (lines 49-57) removes the empty parent directory of the PRD file, and `cleanupCompletedPrd()` in `src/engine/prd-queue.ts` (lines 285-288) calls `rmdir(absQueueDir)`. Additionally, when the merge worktree's feature branch merges back to main, git itself can remove the now-empty `eforge/queue/` directory from the working tree.

When the directory disappears, `fs.watch` emits an error, which triggers `onAbort()` (line 1294-1296 in `src/engine/eforge.ts`), removing the fs.watch producer from the event queue. With no producers left, the `for await` loop terminates and the watcher exits cleanly with code 0.

This plan addresses two of the four bugs: (a) stop deleting the queue directory, and (b) make `fs.watch` recover from directory deletion instead of aborting.

## Implementation

### Overview

1. Remove queue directory deletion from `cleanup.ts` and `prd-queue.ts`
2. Replace the `fs.watch` error handler in `eforge.ts` with a recovery function that recreates the directory and re-establishes the watcher
3. Add tests for the recovery behavior

### Key Decisions

1. **Remove directory deletion rather than guard it** - the queue directory is a well-known sentinel path. Deleting it has no benefit (empty directories are harmless) and causes the watcher to break. Removing the deletion is simpler and more reliable than trying to detect whether a watcher is active.
2. **Recovery with retry limit** - on `fs.watch` error, close the broken watcher, recreate the queue directory via `mkdir(absQueueDir, { recursive: true })`, establish a new `fs.watch`, and call `discoverNewPrds()` + `startReadyPrds()`. A circuit breaker (max 3 consecutive failures within 10 seconds) prevents infinite loops - after exhausting retries, fall back to `onAbort()`.
3. **Extract watcher setup into a helper** - the `fsWatch()` call and its event/error handler wiring (currently lines 1284-1296) should be extracted into a `setupWatcher()` helper function so it can be called both initially and during recovery.

## Scope

### In Scope
- Remove empty-parent-directory deletion from `src/engine/cleanup.ts` (lines 49-57)
- Remove `rmdir(absQueueDir)` from `src/engine/prd-queue.ts` (lines 285-288)
- Extract watcher setup into a reusable helper in `src/engine/eforge.ts`
- Replace `watcher.on('error', () => onAbort())` with recovery logic that recreates the directory and re-establishes the watcher
- Add retry limit: max 3 consecutive failures within 10 seconds, then fall back to `onAbort()`
- Unit tests for fs.watch recovery behavior

### Out of Scope
- Daemon exit handler changes (plan-02)
- prdState reset for re-queued PRDs (plan-02)

## Files

### Modify
- `src/engine/cleanup.ts` - Remove the block at lines 49-57 that deletes the empty parent directory of the PRD file. Keep the PRD file deletion via `git rm`.
- `src/engine/prd-queue.ts` - Remove `rmdir(absQueueDir)` call at lines 285-288 in `cleanupCompletedPrd()`.
- `src/engine/eforge.ts` - In `watchQueue()`: extract `fsWatch()` setup + error/event handler wiring into a `setupWatcher()` helper. Replace the error handler (`watcher.on('error', () => onAbort())`) with recovery logic: close broken watcher, `await mkdir(absQueueDir, { recursive: true })`, call `setupWatcher()` again, then `await discoverNewPrds()` + `startReadyPrds()`. Track consecutive failures with timestamps; if 3 failures occur within 10 seconds, call `onAbort()` instead of recovering.
- `test/watch-queue.test.ts` - Add test: deleting the queue directory mid-watch triggers recovery (directory is recreated and watcher continues to detect new PRDs written after recovery). Add test: 3 rapid consecutive directory deletions within 10 seconds triggers abort (watcher exits with `queue:complete`).

## Verification

- [ ] `cleanupPlanFiles()` in `src/engine/cleanup.ts` no longer contains `readdir`/`rm` logic for the PRD's parent directory (lines 49-57 removed)
- [ ] `cleanupCompletedPrd()` in `src/engine/prd-queue.ts` no longer calls `rmdir(absQueueDir)` (lines 285-288 removed)
- [ ] `watchQueue()` in `src/engine/eforge.ts` contains a `setupWatcher()` helper that is called both during initial setup and during recovery
- [ ] The `fs.watch` error handler recreates the queue directory via `mkdir` with `{ recursive: true }` and re-establishes the watcher
- [ ] After the queue directory is deleted and recreated by recovery, a new PRD file written to the queue directory emits a `queue:prd:discovered` event
- [ ] 3 consecutive `fs.watch` errors within 10 seconds cause the watcher to fall back to `onAbort()` and emit `queue:complete`
- [ ] `pnpm type-check` passes with zero errors
- [ ] `pnpm test` passes with no regressions
