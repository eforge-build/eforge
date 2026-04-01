---
title: Proper cleanup after failed builds
created: 2026-04-01
---

# Proper cleanup after failed builds

## Problem / Motivation

When an eforge build fails (at any phase - compile, build, validate, etc.), multiple resources are left behind in a dirty state requiring manual intervention:

1. **Stale git worktrees** - The merge worktree (and any plan worktrees) are not removed. Users must manually run `git worktree remove --force` and `rm -rf` the worktree base directory.
2. **Stale git branches** - The feature branch (`eforge/<prd-name>`) is not deleted. Users must manually `git branch -D` it.
3. **Stale queue lock files** - `.eforge/queue-locks/<prd-name>.lock` is not released. The watcher sees the lock and refuses to re-process the PRD, even after a daemon restart.
4. **Ambiguous queue state** - The PRD shows as "running" in the queue list even though nothing is building it. The watcher claims the PRD via the lock but never starts a build.
5. **PRD not moved to failed dir reliably** - Sometimes the PRD ends up in `eforge/queue/failed/` but the lock file persists, blocking retries.

The net effect: after a failed build, the user must manually clean up worktrees, branches, lock files, and sometimes restart the daemon before a retry will work. Moving the failed PRD back to the queue dir (the expected retry path) doesn't work because of the stale lock.

## Goal

After any build failure, the system should automatically clean up all resources so that no stale worktrees, branches, or lock files remain, the PRD is moved to `eforge/queue/failed/` with a clean state, and moving the PRD back to `eforge/queue/` triggers a fresh build without manual intervention or daemon restart.

## Approach

The cleanup needs to happen at multiple levels:

### 1. Build-level cleanup (orchestrator/engine)

When a build fails in `src/engine/eforge.ts` (the `buildSinglePrd` or orchestrator flow), ensure cleanup runs in a `finally` block:
- Remove all plan worktrees created for this build
- Remove the merge worktree
- Delete the feature branch (since it contains incomplete work)
- Remove the worktree base directory

The orchestrator (`src/engine/orchestrator.ts`) and worktree manager should have a `cleanup()` or `teardown()` method that handles this. Some of this may already exist for successful builds but not wired up on the failure path.

### 2. Queue lock cleanup

In the queue processing code (`src/engine/eforge.ts` - `runQueue` and `watchQueue`), ensure lock files are released in the `finally` block of each PRD's processing, regardless of success or failure. Look at how locks are acquired and where release happens - the failure path likely skips the release.

### 3. Watcher resilience

The watcher should handle the case where a lock file exists but the PID that created it is no longer alive (or is the watcher's own PID from a previous run). On startup or when scanning for ready PRDs, check if lock PIDs are still alive and clean up stale locks.

### 4. PRD state tracking

Ensure the PRD is moved to `eforge/queue/failed/` atomically with lock release. The current code may move the file but leave the lock, or vice versa.

## Scope

**In scope:**
- Worktree cleanup on build failure (merge worktree, plan worktrees, base directory)
- Branch cleanup on build failure (feature branch)
- Queue lock release on build failure
- Stale lock detection and cleanup in watcher
- PRD move-to-failed with reliable lock release
- Tests for cleanup behavior

**Out of scope:**
- Automatic retry after failure (existing behavior: auto-build pauses after failure, which is correct)
- Cleanup of successful builds (already works)
- Changes to the queue directory structure

## Acceptance Criteria

- After a build fails at compile phase, no stale worktrees, branches, or lock files remain
- After a build fails at build/validate/merge phase, same cleanup guarantees
- Moving a failed PRD back to `eforge/queue/` triggers a fresh build without manual intervention
- Daemon restart is not required after a failed build
- The watcher detects and cleans up stale lock files from dead processes
- Existing successful build cleanup continues to work
