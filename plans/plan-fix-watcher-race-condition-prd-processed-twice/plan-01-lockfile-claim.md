---
id: plan-01-lockfile-claim
name: Lockfile-based PRD claim to prevent duplicate processing
depends_on: []
branch: plan-fix-watcher-race-condition-prd-processed-twice/lockfile-claim
---

# Lockfile-based PRD claim to prevent duplicate processing

## Architecture Context

The PRD queue system (`src/engine/prd-queue.ts`) loads pending PRDs from disk and `runQueue()` in `src/engine/eforge.ts` processes them sequentially. The daemon spawns a watcher subprocess that calls `runQueue()`. When the watcher exits cleanly and `autoBuild` is enabled, the daemon respawns it. A race window exists between watcher exit and respawn where two watcher processes can both call `loadQueue()`, see the same PRD as `pending`, and process it concurrently — the `updatePrdStatus(prd.filePath, 'running')` call at line 635 is not atomic.

The fix adds an exclusive lockfile mechanism using `fs.open()` with `O_CREAT | O_EXCL` flags, which is atomic at the filesystem level. Only the process that successfully creates the `.lock` file proceeds; others skip the PRD.

## Implementation

### Overview

Add `claimPrd()` and `releasePrd()` functions to `prd-queue.ts` using exclusive file creation (`O_CREAT | O_EXCL`). Integrate them into the per-PRD processing loop in `eforge.ts` so that only one process can claim a given PRD.

### Key Decisions

1. **Use `fs.open()` with `O_CREAT | O_EXCL` flags** rather than a PID-based lock or advisory locks. This is the simplest cross-platform atomic lock mechanism available in Node.js — if the file already exists, the `open()` call fails with `EEXIST`. No external dependencies needed.
2. **Lock file lives adjacent to the PRD** (`{prdFilePath}.lock`) rather than in a central lock directory. This keeps locks co-located with their PRDs and avoids needing to manage a separate lock directory.
3. **`releasePrd()` is best-effort and non-throwing** — if the lock file is already gone (e.g., manual cleanup), that's fine. The `finally` block in `runQueue()` ensures cleanup happens even on abort/crash.
4. **Write PID into the lock file** for debugging — allows operators to identify which process holds a lock.

## Scope

### In Scope
- `claimPrd()` function using exclusive file creation
- `releasePrd()` function with best-effort cleanup
- Integration into `runQueue()` per-PRD loop
- Unit tests for `claimPrd()` / `releasePrd()`

### Out of Scope
- Changes to `spawnWatcher()` logic in `server-main.ts`
- Stale lock detection/recovery (lock files are always cleaned up in `finally`)

## Files

### Modify
- `src/engine/prd-queue.ts` — Add `claimPrd()` and `releasePrd()` exports using `fs.open()` with `O_CREAT | O_EXCL` flags. `claimPrd(filePath)` creates `{filePath}.lock` atomically, writes the current PID, and returns `true` on success or `false` if `EEXIST`. `releasePrd(filePath)` removes `{filePath}.lock` with `rm()`, catching and ignoring `ENOENT`.
- `src/engine/eforge.ts` — In `runQueue()`, after the `queue:prd:start` yield (~line 575) and before the staleness check (~line 578), call `claimPrd(prd.filePath)`. If it returns `false`, yield a `queue:prd:skip` event with reason `'claimed by another process'` and `continue`. In the `finally` block (~line 705), call `releasePrd(prd.filePath)` before the `updatePrdStatus()` call.
- `src/engine/events.ts` — No changes needed; `queue:prd:skip` event with a `reason` string already exists.
- `test/prd-queue.test.ts` — Add tests for `claimPrd()` and `releasePrd()`: (1) `claimPrd` returns `true` on first call and creates `.lock` file, (2) second `claimPrd` on same path returns `false`, (3) `releasePrd` removes the `.lock` file, (4) `releasePrd` does not throw when lock file is already gone, (5) after `releasePrd`, `claimPrd` succeeds again.

## Verification

- [ ] `pnpm type-check` exits with code 0
- [ ] `pnpm test` exits with code 0
- [ ] `claimPrd()` returns `true` on first call and `false` on second call for the same file path (covered by new unit tests)
- [ ] `releasePrd()` removes the `.lock` file and does not throw if file is absent (covered by new unit tests)
- [ ] `runQueue()` skips PRDs where `claimPrd()` returns `false` (yields `queue:prd:skip` event)
- [ ] Lock file is removed in the `finally` block regardless of build success/failure
