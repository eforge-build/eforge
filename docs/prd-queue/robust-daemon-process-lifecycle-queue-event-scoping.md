---
title: Robust Daemon Process Lifecycle & Queue Event Scoping
created: 2026-03-24
status: pending
---

# Robust Daemon Process Lifecycle & Queue Event Scoping

## Problem / Motivation

Two related issues degrade the daemon experience:

1. **Stale processes accumulate** — after multiple `daemon stop`/`daemon start` cycles, old `eforge-monitor` and `eforge-watcher` processes linger (observed: 5 monitors + 2 watchers running simultaneously). Root causes:
   - Watcher PID is only tracked in-memory (not persisted in the lockfile)
   - `daemon stop` has no force-kill escalation — if SIGTERM doesn't work within 5s, it just prints a warning and exits
   - `daemon start` doesn't kill stale PIDs when it finds a stale lockfile

2. **Queue events leak into build timelines** — `queue:watch:cycle`, `queue:watch:waiting`, `queue:start` events appear in a specific PRD build's timeline in the monitor UI. Root cause: the recorder's `runId` variable isn't cleared between PRD sessions within a queue cycle, so queue-level events get recorded under the previous PRD's run.

## Goal

Ensure exactly one monitor and one watcher process per repo at all times, with clean startup/shutdown semantics and force-kill escalation. Fix queue event scoping so transient queue-level events never appear in individual PRD build timelines.

## Approach

### 1. Add `watcherPid` to lockfile

**File**: `src/monitor/lockfile.ts`

- Add optional `watcherPid?: number` to `LockfileData` interface.
- Add `updateLockfile(cwd, updater)` helper: reads current lockfile, applies updater function, writes atomically. No-op if lockfile missing.
- Add `killPidIfAlive(pid, signal?)` helper: checks `isPidAlive`, sends signal, returns boolean. Wraps the try/catch pattern used in multiple places.
- `tryReadLockfileAt` already casts to `LockfileData` after checking required fields — optional `watcherPid` needs no validation change.

### 2. Update lockfile on watcher start/stop

**File**: `src/monitor/server-main.ts`

- In `spawnWatcher()`: after setting `daemonState.watcher`, call `updateLockfile(cwd, data => ({ ...data, watcherPid: child.pid }))`.
- In `killWatcher()`: after clearing `daemonState.watcher`, call `updateLockfile` to remove `watcherPid`.
- In watcher `exit`/`error` handlers: also remove `watcherPid` from lockfile (handles crashes where `killWatcher` wasn't the cause).

### 3. Kill stale processes on `daemon start`

**File**: `src/cli/index.ts` (~line 596-598)

When a stale lockfile is found (server not responding to health check):
- `killPidIfAlive(existingLock.pid)` — SIGTERM the old monitor
- `killPidIfAlive(existingLock.watcherPid)` if present — SIGTERM the old watcher
- 500ms pause, then SIGKILL any survivors
- Then `removeLockfile(cwd)` (existing)

### 4. Robust `daemon stop` with safety valve & force-kill

**File**: `src/cli/index.ts` (~line 670-713)

**Safety valve — check for active builds before stopping:**
- Before sending SIGTERM, query the daemon's HTTP API for running builds: `GET http://localhost:{port}/api/health` confirms daemon is up, then open `.eforge/monitor.db` and call `getRunningRuns()` to check for active builds.
- If builds are running, prompt the user via readline (reuse pattern from `src/cli/interactive.ts`):
  ```
  2 build(s) in progress:
    - untitled-prd (compile, started 3m ago)
    - fix-auth (build, started 1m ago)
  Stop anyway? Workers will be killed. [y/N]:
  ```
- If user declines: exit without stopping.
- Add `--force` flag to skip the prompt.
- Auto-force when stdin is not a TTY (`!process.stdin.isTTY`) — non-interactive contexts (scripts, daemon-spawned processes) should never block on prompts.

**Force-kill escalation:**
- When monitor PID is dead but lockfile exists: also kill `lock.watcherPid` if alive before removing lockfile.
- After SIGTERM: also directly `killPidIfAlive(lock.watcherPid)` (belt-and-suspenders — don't rely solely on shutdown handler).
- After 5s timeout waiting for lockfile removal: escalate to SIGKILL on both PIDs, then force-remove lockfile. Currently just prints a warning and exits.

### 5. Stale-process cleanup in `ensureMonitor`

**File**: `src/monitor/index.ts` (~line 56-63)

When a stale lockfile is found (daemon not responding to health check but lockfile exists):
- Kill `existingLock.pid` and `existingLock.watcherPid` if alive
- `removeLockfile(cwd)` before spawning new server

Currently just falls through with a comment.

### 6. Fix queue event scoping in recorder

**File**: `src/monitor/recorder.ts`

The recorder tracks `runId` (from `phase:start`) and `enqueueRunId` (from `enqueue:start`). Between PRD sessions in a queue cycle, queue-level events (`queue:start`, `queue:watch:*`, `queue:complete`) get recorded under the stale `runId` from the previous PRD.

Fix: reset `runId` on `phase:end` and `session:end`:

```typescript
if (event.type === 'phase:end' && runId) {
  db.updateRunStatus(runId, event.result.status, event.timestamp);
  runId = undefined;  // <-- add this
}
```

```typescript
if (event.type === 'session:end') {
  // ... existing enqueue status update logic ...
  runId = undefined;      // <-- add this
  enqueueRunId = undefined; // <-- add this
}
```

Queue-level events between PRD sessions will have no `activeRunId` and won't be recorded — they're transient status events with no diagnostic value in the DB.

### 7. Add `daemon kill` command (lockfile-only, repo-scoped)

**File**: `src/cli/index.ts`

New subcommand `eforge daemon kill` as a last-resort escape hatch:
- Kill PIDs from **this repo's lockfile only** (SIGKILL) — monitor PID + watcher PID
- Remove lockfile
- Report what was killed
- No `pkill` sweeps — multi-repo safe. If lockfile is gone and orphans exist, report "no daemon tracked for this repo" and suggest `ps aux | grep eforge`.

### 8. Enhance `daemon status` with watcher info

**File**: `src/cli/index.ts` (daemon status command)

Show watcher PID and alive/stale status from lockfile data. Show count of running builds.

**Constraint**: Must support multiple eforge daemons on the same machine (one per repo). No `pkill` sweeps — only kill PIDs tracked in the current repo's lockfile.

### Existing code to reuse

- `isPidAlive()` from `src/monitor/lockfile.ts` — PID liveness check via signal 0
- `writeLockfile()` from `src/monitor/lockfile.ts` — atomic write via temp+rename
- `readline.createInterface` pattern from `src/cli/interactive.ts` — interactive prompting
- `db.getRunningRuns()` from `src/monitor/db.ts` — query active builds
- `openDatabase()` from `src/monitor/db.ts` — open SQLite for daemon stop safety check

## Scope

### In scope

- Persisting watcher PID in the lockfile with read/write/update helpers
- Killing stale processes on `daemon start` and in `ensureMonitor`
- Force-kill escalation on `daemon stop` (SIGTERM → wait → SIGKILL)
- Safety valve on `daemon stop` prompting about active builds (with `--force` override)
- New `daemon kill` subcommand (lockfile-scoped SIGKILL + cleanup)
- Enhanced `daemon status` showing watcher PID and running build count
- Fixing queue event scoping in the recorder by resetting `runId`/`enqueueRunId` on phase and session boundaries
- Tests for lockfile enhancements and queue event scoping

### Out of scope

- Cross-repo process sweeps (`pkill` or similar)
- Changes to the monitor web UI
- Changes to the build/compile pipeline itself

## Acceptance Criteria

### Lockfile & helpers
- `LockfileData` interface includes optional `watcherPid?: number`
- `updateLockfile(cwd, updater)` reads, applies updater, writes atomically; no-ops when lockfile is missing
- `killPidIfAlive(pid, signal?)` checks liveness and sends signal, returns boolean, never throws
- Lockfiles without `watcherPid` parse correctly (backward compatibility)

### Watcher PID tracking
- `spawnWatcher()` writes `watcherPid` to lockfile after spawning
- `killWatcher()` removes `watcherPid` from lockfile
- Watcher `exit`/`error` handlers remove `watcherPid` from lockfile (crash resilience)

### Daemon start — stale process cleanup
- When stale lockfile found: SIGTERM old monitor PID and watcher PID → 500ms pause → SIGKILL survivors → remove lockfile → spawn new daemon
- After `daemon start` → `daemon stop` → `daemon start` cycle, exactly 1 monitor + 1 watcher process exists

### Daemon stop — safety valve & force-kill
- If active builds detected, prompts user with build names/phases/durations and `[y/N]` confirmation
- `--force` flag skips the prompt
- Non-TTY stdin auto-forces (no blocking on prompts in scripts)
- User declining exits without stopping
- After SIGTERM: directly kills watcher PID (belt-and-suspenders)
- After 5s timeout: escalates to SIGKILL on both PIDs, force-removes lockfile

### ensureMonitor — stale cleanup
- When stale lockfile found (daemon unresponsive): kills monitor PID and watcher PID if alive, removes lockfile, then spawns new server

### Queue event scoping
- `runId` is reset to `undefined` on `phase:end`
- `runId` and `enqueueRunId` are reset to `undefined` on `session:end`
- Queue-level events (`queue:watch:cycle`, `queue:watch:waiting`, `queue:start`) between PRD sessions are not recorded under any PRD's run in the DB
- Each PRD's events are recorded under that PRD's own `runId`, not a previous PRD's

### Daemon kill command
- `eforge daemon kill` sends SIGKILL to monitor PID + watcher PID from current repo's lockfile
- Removes lockfile after killing
- Reports what was killed
- If no lockfile exists, reports "no daemon tracked for this repo" and suggests `ps aux | grep eforge`
- No `pkill` sweeps — multi-repo safe

### Daemon status enhancements
- Shows watcher PID and alive/stale status
- Shows count of running builds

### Tests
- `test/monitor-recording.test.ts`: queue cycle with multiple PRD sessions verifies queue-level events don't leak across sessions; `session:end` resets tracking
- `test/monitor-shutdown.test.ts`: `watcherPid` backward compat, `watcherPid` round-trip, `killPidIfAlive` returns false for non-existent PID, `updateLockfile` atomic read-modify-write and no-op on missing lockfile

### Build & test
- `pnpm build` compiles cleanly
- `pnpm test` passes (including new tests)

### Files to modify

| File | Changes |
|------|---------|
| `src/monitor/lockfile.ts` | `watcherPid` in interface, `updateLockfile`, `killPidIfAlive` helpers |
| `src/monitor/server-main.ts` | Wire `updateLockfile` into watcher spawn/kill/exit |
| `src/monitor/index.ts` | Kill stale processes in `ensureMonitor` |
| `src/monitor/recorder.ts` | Reset `runId`/`enqueueRunId` on phase:end/session:end |
| `src/cli/index.ts` | Harden start/stop (safety valve + force-kill), add kill command, enhance status |
