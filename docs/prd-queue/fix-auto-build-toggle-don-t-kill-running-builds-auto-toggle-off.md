---
title: Fix Auto-Build Toggle: Don't Kill Running Builds + Auto-Toggle Off
created: 2026-03-25
status: pending
---

# Fix Auto-Build Toggle: Don't Kill Running Builds + Auto-Toggle Off

## Problem / Motivation

Two bugs exist in the daemon's auto-build feature:

1. **Toggle OFF kills the running build.** `POST /api/auto-build { enabled: false }` calls `killWatcher()` which sends SIGTERM to the watcher subprocess. Since the watcher IS the build process (`eforge run --queue --watch`), this interrupts the active build. The user's intent is "don't start the next build", not "kill the current one."

2. **Auto-build doesn't toggle off when a build starts.** The UI shows auto-build as ON during active builds because the flag only gets set to `false` on watcher crash (non-zero exit). Expected: auto-build shows OFF while building, user re-enables for the next cycle.

**Root cause:** The daemon spawns a long-running `--watch` subprocess and has only two options: let it run forever, or SIGTERM it. There's no way to say "finish the current build, then stop."

## Goal

Replace the long-running `--watch` watcher with daemon-managed single-cycle spawns so that toggling auto-build OFF lets the current build finish without respawning, and auto-build automatically toggles OFF when a build starts.

## Approach

**Daemon-Managed Respawn (Remove `--watch`):** The daemon manages the polling loop instead of delegating it to the subprocess.

- **Before:** `daemon → spawn eforge run --queue --watch (loops forever) → SIGTERM to stop`
- **After:** `daemon → spawn eforge run --queue (one cycle, exits) → check autoBuild → respawn or stop`

### 1. `src/monitor/server-main.ts` — `spawnWatcher()` (line 247)

Remove `--watch` from spawn args:
```
['run', '--queue', '--watch', '--auto', '--no-monitor']
→ ['run', '--queue', '--auto', '--no-monitor']
```

Auto-toggle `autoBuild` to `false` immediately after spawning (after line 253, `watcherProcess = child`):
```typescript
daemonState.autoBuild = false;
```

### 2. `src/monitor/server-main.ts` — Exit handler (lines 300-303)

Add a respawn delay so the daemon doesn't tight-loop on empty queues. Load `pollIntervalMs` from config once at startup (around line 347) into a module-level variable:

```typescript
let respawnDelayMs = 5000; // updated from config at startup
```

Replace the immediate respawn with a delayed check:
```typescript
// Clean exit (code 0) — respawn after delay if autoBuild was re-enabled
if (daemonState.autoBuild) {
  setTimeout(() => {
    if (daemonState.autoBuild && !watcherProcess) {
      spawnWatcher();
    }
  }, respawnDelayMs);
}
```

### 3. `src/monitor/server.ts` — POST `/api/auto-build` handler (lines 929-933)

Remove the `onKillWatcher()` call when toggling off. Just set the flag:

```typescript
} else {
  // Flag is set at line 923. Watcher finishes its current cycle,
  // exit handler sees autoBuild=false, no respawn. No kill needed.
}
```

### 4. `src/monitor/server-main.ts` — Orphan detection (lines 372-379)

Change the guard from `daemonState?.autoBuild` to `daemonState?.watcher.running` so stale watcher state gets cleaned up even when autoBuild is false (which is now the normal state during builds):

```typescript
if (persistent && daemonState?.watcher.running && watcherProcess?.pid) {
  if (!isPidAlive(watcherProcess.pid)) {
    watcherProcess = null;
    daemonState.watcher = { running: false, pid: null, sessionId: null };
    updateLockfile(cwd, { watcherPid: undefined });
    // Don't respawn here — exit handler manages that
  }
}
```

### State Machine

| Scenario | Before | After |
|----------|--------|-------|
| Toggle OFF during build | SIGTERM kills build | Flag set, build finishes, no respawn |
| Toggle ON during build | No-op (already ON) | Flag set to true, build finishes, daemon respawns |
| Toggle ON when idle | Spawn watcher | Spawn watcher (same) |
| Build finishes normally | autoBuild=true → respawn --watch | autoBuild=false (auto-toggled) → no respawn |
| Build fails | Set autoBuild=false, write paused event | autoBuild already false, write paused event |
| User re-enables after build | Spawn watcher with --watch | Spawn watcher (one cycle) |

## Scope

### In Scope
- `src/monitor/server-main.ts` — spawn args, auto-toggle, respawn delay, orphan detection
- `src/monitor/server.ts` — remove kill-on-toggle-off

### Out of Scope
- `src/engine/eforge.ts` — engine stays pure, no daemon awareness
- `src/monitor/ui/` — UI already polls every 5s, auto-toggle is server-side

## Acceptance Criteria

1. `pnpm build` succeeds.
2. Start daemon; verify watcher spawns without `--watch` flag.
3. `GET /api/auto-build` returns `{ enabled: false }` immediately after watcher spawns.
4. Enqueue a PRD; verify build completes without interruption.
5. Toggle OFF during build → build finishes normally (no SIGTERM).
6. Toggle ON during build → daemon respawns watcher after build completes.
7. Toggle ON when idle → watcher spawns immediately.
