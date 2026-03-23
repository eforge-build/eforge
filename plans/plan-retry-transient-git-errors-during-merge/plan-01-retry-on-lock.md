---
id: plan-01-retry-on-lock
name: Retry Transient Git Lock Errors
depends_on: []
branch: plan-retry-transient-git-errors-during-merge/retry-on-lock
---

# Retry Transient Git Lock Errors

## Architecture Context

The engine's git operations (`forgeCommit` in `git.ts` and `mergeWorktree` in `worktree.ts`) currently fail immediately on any error, including transient `.git/index.lock` contention from external processes (editors, Magit, etc.). The orchestrator's validation step already has retry logic (`maxValidationRetries`), but merge and commit operations — equally susceptible to brief lock contention — have none.

Both files use `promisify(execFile)` for git commands. The retry helper wraps the same `() => Promise<T>` pattern, fitting cleanly into existing call sites.

## Implementation

### Overview

Add three utilities to `src/engine/git.ts` (`isLockError`, `removeStaleIndexLock`, `retryOnLock`) and wrap all git operations that touch the index in both `git.ts` and `worktree.ts`.

### Key Decisions

1. **Stale lock threshold of 5 seconds** — a git index lock held by a normal operation (commit, merge, checkout) completes in milliseconds. A lock older than 5s is almost certainly stale (orphaned by a crashed process). This avoids removing locks held by legitimately long operations.
2. **5 retries with 500ms delay (~2.5s max wait)** — generous enough for brief editor contention, short enough to not mask real problems.
3. **Lock detection via error message string matching** — git's error messages for lock failures consistently contain `index.lock` or `Unable to create` + `.lock`. This is the standard approach used by other git tooling.
4. **Non-lock errors pass through immediately** — merge conflicts, auth failures, etc. are not retried. Only errors matching the lock pattern trigger retry.
5. **Helper is not exported** — `retryOnLock` is used internally by `forgeCommit` and imported by `worktree.ts`, but `isLockError` and `removeStaleIndexLock` are private implementation details. Export `retryOnLock` so `worktree.ts` can import it.

## Scope

### In Scope
- `isLockError(err)` — detect git index lock errors from error messages
- `removeStaleIndexLock(repoRoot)` — remove `.git/index.lock` if older than 5 seconds
- `retryOnLock(fn, repoRoot, maxRetries?, delayMs?)` — retry wrapper with stale lock removal between attempts
- Wrap `forgeCommit()` internal `exec` call with `retryOnLock`
- Import `retryOnLock` in `worktree.ts` and wrap all git operations in `mergeWorktree()`: `checkout`, `merge --squash`, both `commit` calls, and `reset --merge`

### Out of Scope
- Changes to merge conflict resolution logic (the `mergeResolver` callback and `gatherConflictInfo` are untouched)
- Changes to validation retry logic (`maxValidationRetries`)
- Retry for non-lock git errors (merge conflicts, auth failures, etc.)
- Retry for `createWorktree` or `removeWorktree` operations (these operate on worktree paths, not the main index)

## Files

### Modify
- `src/engine/git.ts` — Add `isLockError()`, `removeStaleIndexLock()`, `retryOnLock()` (exported). Wrap the `exec('git', args, { cwd })` call inside `forgeCommit()` with `retryOnLock()`.
- `src/engine/worktree.ts` — Import `retryOnLock` from `./git.js`. Wrap all five git exec calls inside `mergeWorktree()` with `retryOnLock()`: checkout (line 145), merge --squash (line 147), commit (line 148), conflict-resolution commit (line 165), and reset --merge (line 179).

## Verification

- [ ] `pnpm type-check` passes with zero errors
- [ ] `pnpm test` passes all existing tests
- [ ] `isLockError` returns `true` for error messages containing `index.lock`
- [ ] `isLockError` returns `true` for error messages containing `Unable to create` and `.lock`
- [ ] `isLockError` returns `false` for unrelated error messages (e.g., merge conflict text)
- [ ] `removeStaleIndexLock` removes a lock file older than 5 seconds and returns `true`
- [ ] `removeStaleIndexLock` does not remove a lock file younger than 5 seconds and returns `false`
- [ ] `removeStaleIndexLock` returns `false` when no lock file exists (no throw)
- [ ] `retryOnLock` retries up to `maxRetries` times on lock errors
- [ ] `retryOnLock` calls `removeStaleIndexLock` between retry attempts
- [ ] `retryOnLock` throws immediately on non-lock errors without retrying
- [ ] `retryOnLock` succeeds on first attempt when no error occurs (zero overhead in happy path)
- [ ] `forgeCommit()` in `git.ts` calls `retryOnLock` around its exec call
- [ ] All five git exec calls in `mergeWorktree()` are wrapped with `retryOnLock`
