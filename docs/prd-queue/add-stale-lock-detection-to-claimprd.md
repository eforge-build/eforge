---
title: Add stale lock detection to `claimPrd()`
created: 2026-03-26
status: pending
---



# Add stale lock detection to `claimPrd()`

## Problem / Motivation

If a process that claimed a PRD via `claimPrd()` gets SIGKILL'd or crashes without calling `releasePrd()`, the lock file persists with a dead PID. The next watcher sees the lock file (`EEXIST`), returns `false`, skips the PRD, and the PRD is stuck forever until manual intervention.

## Goal

When `claimPrd()` finds an existing lock file, detect whether the owning process is still alive. If the PID is dead, remove the stale lock and re-acquire it, so that PRDs are never permanently stuck due to a crashed process.

## Approach

- In `claimPrd()` in `src/engine/prd-queue.ts`, in the `catch` block for `EEXIST` (line 343):
  1. Read the lock file contents and parse the PID.
  2. Check PID liveness with a `try/catch` around `process.kill(pid, 0)` (throws if the PID doesn't exist).
  3. If the PID is dead, remove (`rm`) the lock file and retry the exclusive open once.
  4. If the PID is alive, return `false` as before.
- Use the same pattern as `killPidIfAlive()` in `src/monitor/lockfile.ts` for the PID liveness check.

## Scope

**In scope:**
- `claimPrd()` function in `src/engine/prd-queue.ts`
- A corresponding test in the appropriate test file

**Out of scope:**
- All other files and functions

## Acceptance Criteria

- `claimPrd()` returns `true` and acquires the lock when a stale lock file exists with a dead PID.
- `claimPrd()` returns `false` when a lock file exists with a live PID.
- `pnpm type-check` passes.
- `pnpm test` passes.
