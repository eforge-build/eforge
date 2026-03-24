---
id: plan-02-daemon-lifecycle-hardening
name: Daemon Lifecycle Hardening & New Commands
depends_on: [plan-01-lockfile-helpers-and-recorder-fix]
branch: robust-daemon-process-lifecycle-queue-event-scoping/daemon-lifecycle-hardening
---

# Daemon Lifecycle Hardening & New Commands

## Architecture Context

This plan wires the lockfile helpers from Plan 01 into all daemon lifecycle touchpoints: watcher PID tracking in server-main, stale process cleanup in `daemon start` and `ensureMonitor`, force-kill escalation in `daemon stop` with a safety valve for active builds, a new `daemon kill` escape hatch command, and enhanced `daemon status` output.

## Implementation

### Overview

1. Wire `updateLockfile` into server-main's `spawnWatcher`/`killWatcher`/exit handlers to track watcher PID
2. Harden `daemon start` to SIGTERM+SIGKILL stale processes before spawning
3. Add safety valve to `daemon stop` (prompt about active builds, `--force` flag, non-TTY auto-force)
4. Add force-kill escalation to `daemon stop` (SIGTERM → 5s → SIGKILL)
5. Fix `ensureMonitor` stale lockfile path to kill stale PIDs before spawning
6. Add `daemon kill` subcommand (SIGKILL from lockfile, remove lockfile)
7. Enhance `daemon status` to show watcher PID and alive/stale status

### Key Decisions

1. `spawnWatcher` writes `watcherPid` to lockfile immediately after spawn. The `exit` and `error` handlers also remove it, ensuring crash resilience — if `killWatcher()` isn't called (e.g., daemon crashes), the exit handler cleans up.
2. `daemon stop` uses belt-and-suspenders: sends SIGTERM to both monitor and watcher PIDs directly (not relying solely on the monitor's shutdown handler to kill its watcher). After 5s timeout, escalates to SIGKILL on both.
3. Safety valve uses `readline.createInterface` pattern from `src/cli/interactive.ts`. Non-TTY stdin auto-forces to avoid blocking in scripts or daemon-spawned processes.
4. `daemon kill` only kills PIDs from the current repo's lockfile — no `pkill` sweeps. Multi-repo safe by design.
5. In `ensureMonitor`, stale lockfile handling now calls `killPidIfAlive` on both `pid` and `watcherPid` before removing the lockfile. This prevents orphan accumulation from the `eforge build` path (non-daemon).

## Scope

### In Scope
- Watcher PID lockfile tracking in server-main (spawn, kill, exit, error handlers)
- Stale process cleanup in `daemon start` (SIGTERM → 500ms → SIGKILL → remove lockfile)
- Safety valve in `daemon stop` prompting about active builds with `--force` and non-TTY auto-force
- Force-kill escalation in `daemon stop` (SIGTERM → 5s → SIGKILL on both PIDs, force-remove lockfile)
- Belt-and-suspenders watcher kill in `daemon stop` (direct SIGTERM to watcher PID)
- Stale process cleanup in `ensureMonitor`
- New `daemon kill` subcommand
- Enhanced `daemon status` showing watcher PID + alive/stale status

### Out of Scope
- Changes to the lockfile interface or helpers (Plan 01)
- Changes to the recorder (Plan 01)
- Cross-repo process sweeps
- Monitor web UI changes
- Build/compile pipeline changes

## Files

### Modify
- `src/monitor/server-main.ts` — Wire `updateLockfile` into `spawnWatcher()` (write `watcherPid`), `killWatcher()` (remove `watcherPid`), watcher `exit`/`error` handlers (remove `watcherPid` on crash)
- `src/monitor/index.ts` — In `ensureMonitor()` stale lockfile branch: call `killPidIfAlive` on `existingLock.pid` and `existingLock.watcherPid`, then `removeLockfile` before spawning new server
- `src/cli/index.ts` — Harden `daemon start` (kill stale PIDs with SIGTERM+SIGKILL before spawning); harden `daemon stop` (safety valve prompt, `--force` flag, non-TTY auto-force, SIGTERM watcher PID, SIGKILL escalation after 5s); add `daemon kill` subcommand (SIGKILL both PIDs from lockfile, remove lockfile, report results); enhance `daemon status` (show watcher PID, alive/stale indicator)

## Verification

- [ ] `spawnWatcher()` calls `updateLockfile` to write `watcherPid` after spawning the watcher process
- [ ] `killWatcher()` calls `updateLockfile` to remove `watcherPid` from lockfile
- [ ] Watcher `exit` handler calls `updateLockfile` to remove `watcherPid` (crash resilience — handles case where `killWatcher` was not the cause)
- [ ] Watcher `error` handler calls `updateLockfile` to remove `watcherPid`
- [ ] `daemon start` with stale lockfile: sends SIGTERM to old monitor PID and watcher PID, waits 500ms, sends SIGKILL to survivors, removes lockfile, then spawns new daemon
- [ ] `daemon stop` with active builds: prints build names/phases and prompts `[y/N]`; user declining exits without stopping
- [ ] `daemon stop --force` skips the active-build prompt
- [ ] `daemon stop` with non-TTY stdin auto-forces (no blocking prompt)
- [ ] `daemon stop` sends SIGTERM to both monitor PID and watcher PID (belt-and-suspenders)
- [ ] `daemon stop` after 5s timeout: sends SIGKILL to both PIDs and force-removes lockfile (instead of printing warning and exiting)
- [ ] `ensureMonitor` stale lockfile path: kills `existingLock.pid` and `existingLock.watcherPid` if alive, removes lockfile before spawning new server
- [ ] `eforge daemon kill` sends SIGKILL to monitor PID + watcher PID from current repo's lockfile, removes lockfile, reports what was killed
- [ ] `eforge daemon kill` with no lockfile: prints "no daemon tracked for this repo" and suggests `ps aux | grep eforge`
- [ ] `eforge daemon kill` does not use `pkill` or any cross-repo process sweep
- [ ] `daemon status` displays watcher PID and alive/stale indicator when lockfile contains `watcherPid`
- [ ] `daemon status` displays running build count (existing behavior preserved)
- [ ] `pnpm build` compiles cleanly
- [ ] `pnpm test` passes
