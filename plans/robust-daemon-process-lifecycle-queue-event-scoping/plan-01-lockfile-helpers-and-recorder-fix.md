---
id: plan-01-lockfile-helpers-and-recorder-fix
name: Lockfile Helpers & Recorder Queue Event Scoping Fix
depends_on: []
branch: robust-daemon-process-lifecycle-queue-event-scoping/lockfile-helpers-and-recorder-fix
---

# Lockfile Helpers & Recorder Queue Event Scoping Fix

## Architecture Context

This plan lays the foundation for robust daemon lifecycle management by extending the lockfile interface with `watcherPid` tracking and adding reusable helpers (`updateLockfile`, `killPidIfAlive`). It also fixes the queue event scoping bug in the recorder, which is a self-contained change with no dependency on the lockfile work.

These changes are prerequisites for Plan 02, which wires the helpers into the daemon start/stop/kill commands and server-main watcher management.

## Implementation

### Overview

1. Extend `LockfileData` with optional `watcherPid` field
2. Add `updateLockfile()` for atomic read-modify-write of lockfile data
3. Add `killPidIfAlive()` as a safe signal-sending helper
4. Fix recorder to reset `runId`/`enqueueRunId` on phase and session boundaries

### Key Decisions

1. `watcherPid` is optional in `LockfileData` for backward compatibility — existing lockfiles without the field parse correctly via the existing validation logic in `tryReadLockfileAt` which only checks required fields (`pid`, `port`, `startedAt`).
2. `updateLockfile` no-ops when the lockfile is missing rather than throwing, since stale/missing lockfiles are a normal condition during race scenarios.
3. `killPidIfAlive` wraps `isPidAlive` + `process.kill` in a single helper that never throws — callers don't need try/catch around every signal send.
4. The recorder fix resets `runId` to `undefined` on `phase:end` and both `runId`/`enqueueRunId` on `session:end`, preventing queue-level events from being recorded under a stale run.

## Scope

### In Scope
- `LockfileData.watcherPid` optional field
- `updateLockfile(cwd, updater)` helper with atomic write semantics
- `killPidIfAlive(pid, signal?)` helper
- Recorder `runId`/`enqueueRunId` reset on `phase:end` and `session:end`
- Tests for all new helpers and recorder behavior

### Out of Scope
- Wiring helpers into server-main, daemon commands, or ensureMonitor (Plan 02)
- New CLI subcommands (Plan 02)
- UI changes

## Files

### Modify
- `src/monitor/lockfile.ts` — Add `watcherPid?: number` to `LockfileData`, add `updateLockfile()` and `killPidIfAlive()` exports
- `src/monitor/recorder.ts` — Reset `runId` on `phase:end`, reset `runId` and `enqueueRunId` on `session:end`
- `test/monitor-shutdown.test.ts` — Add tests for `watcherPid` backward compat, `updateLockfile` atomic read-modify-write and no-op on missing lockfile, `killPidIfAlive` returning false for non-existent PID
- `test/monitor-recording.test.ts` — Add test for queue cycle with multiple PRD sessions verifying queue-level events don't leak across sessions

## Verification

- [ ] `LockfileData` interface includes `watcherPid?: number`
- [ ] `updateLockfile(cwd, updater)` reads existing lockfile, applies updater function, writes result atomically via temp+rename; returns silently when lockfile is missing
- [ ] `killPidIfAlive(pid, signal?)` returns `true` when signal is sent, `false` when PID does not exist, never throws
- [ ] Existing lockfiles without `watcherPid` field parse via `readLockfile()` without error
- [ ] `runId` is set to `undefined` after `phase:end` event in recorder
- [ ] `runId` and `enqueueRunId` are both set to `undefined` after `session:end` event in recorder
- [ ] Test: queue cycle with 2 PRD sessions where queue-level events between sessions (`queue:watch:cycle`, `queue:watch:waiting`) are not recorded under either PRD's run in the DB
- [ ] Test: `updateLockfile` on a missing lockfile path does not throw and does not create a file
- [ ] Test: `updateLockfile` atomically updates an existing lockfile (reads, applies updater, writes back)
- [ ] Test: `killPidIfAlive` returns `false` for PID 999999 (non-existent)
- [ ] Test: lockfile with `watcherPid` round-trips through `writeLockfile` and `readLockfile`
- [ ] `pnpm build` compiles cleanly
- [ ] `pnpm test` passes
