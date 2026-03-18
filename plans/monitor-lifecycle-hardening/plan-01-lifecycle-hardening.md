---
id: plan-01-lifecycle-hardening
name: Monitor Lifecycle Hardening
depends_on: []
branch: monitor-lifecycle-hardening/lifecycle-hardening
---

# Monitor Lifecycle Hardening

## Architecture Context

The monitor system has a detached server architecture: `ensureMonitor()` spawns a child process that polls SQLite for events and serves them over SSE. Recording (writing events to SQLite) is currently gated behind the same `--no-monitor` flag that controls the web server, meaning `enqueue` and `--no-monitor` runs produce no event history. The server's shutdown uses a 30-second idle timeout with no user interaction mechanism.

This plan decouples recording from the web server, replaces the idle timeout with a countdown state machine that the browser can interact with, and extracts the inline shutdown logic from the CLI into a reusable function.

## Implementation

### Overview

Three interleaved changes:

1. **Always record** - `ensureMonitor` gains a `noServer` option. When true, it opens the DB and returns a `Monitor` with `server: null` but a fully functional `wrapEvents`. The CLI's `withMonitor` always creates a monitor, passing `noServer` instead of skipping entirely.

2. **Countdown shutdown** - The server gains `broadcast()`, `subscriberCount`, and `onKeepAlive` on its interface. `server-main.ts` replaces the idle timeout with a WATCHING → COUNTDOWN → SHUTDOWN state machine. The UI adds a `ShutdownBanner` component driven by named SSE events.

3. **`signalMonitorShutdown` extraction** - The 20+ lines of inline check-and-kill logic in the `monitor` CLI command moves to `src/monitor/index.ts` as a clean function.

### Key Decisions

1. `Monitor.server` becomes nullable (`{ port, url } | null`) rather than introducing a separate `Recorder` type - keeps the interface simple and avoids splitting consumers into two code paths.
2. The countdown uses two durations: 60s when browser subscribers are connected (giving users time to inspect), 10s when nobody's watching (fast cleanup). A keep-alive endpoint resets the countdown rather than transitioning back to WATCHING - this avoids re-entering the watching state without an actual running run.
3. The idle timeout stays as a 10s crash-recovery fallback - if the CLI dies and no browser is connected, the server still shuts down without waiting for a full countdown cycle.
4. Named SSE events (`monitor:shutdown-pending`, `monitor:shutdown-cancelled`) are distinct from the data-channel `onmessage` events, so the existing event processing pipeline is unaffected.

## Scope

### In Scope
- Decoupling event recording from web server lifecycle
- Countdown shutdown state machine in server-main.ts
- Browser keep-alive mechanism (POST endpoint + UI banner)
- `signalMonitorShutdown` extraction
- New tests for recording-without-server and shutdown signaling

### Out of Scope
- Changes to the recording middleware itself (`withRecording`)
- Changes to the database schema
- Changes to the monitor UI's event processing (reducer, state management)

## Files

### Create
- `src/monitor/ui/src/components/layout/shutdown-banner.tsx` — Amber banner with countdown text and "Keep Alive" button. Sends POST /api/keep-alive on click and starts a 30s periodic ping.
- `test/monitor-shutdown.test.ts` — Tests for `signalMonitorShutdown`: lockfile not found, server not alive, runs still active, successful SIGTERM.
- `test/monitor-recording.test.ts` — Tests for decoupled recording: `ensureMonitor` with `noServer` returns `server: null` and functional `wrapEvents`; `buildMonitor` wiring.

### Modify
- `src/monitor/index.ts` — Change `ensureMonitor` signature to accept `{ port?, noServer? }` options object. Make `Monitor.server` nullable. Add `noServer` path that skips lockfile/server spawn but opens DB. Add `signalMonitorShutdown(cwd)` export.
- `src/monitor/server.ts` — Add `broadcast(eventName, data)`, `subscriberCount` getter, `onKeepAlive` callback to `MonitorServer` interface and implementation. Add `POST /api/keep-alive` route to the request handler.
- `src/monitor/server-main.ts` — Replace idle timeout with WATCHING/COUNTDOWN/SHUTDOWN state machine. Wire `server.onKeepAlive` to reset countdown. Broadcast `monitor:shutdown-pending` and `monitor:shutdown-cancelled` events. Keep 10s idle fallback for crash recovery.
- `src/cli/index.ts` — `withMonitor` always creates a monitor (never returns undefined). Pass `noServer` instead of skipping. `wrapEvents` always calls `monitor.wrapEvents` (remove conditional). Replace inline monitor-command shutdown logic with `signalMonitorShutdown()` call.
- `src/monitor/ui/src/hooks/use-eforge-events.ts` — Add `shutdownCountdown: number | null` to return type. Register named SSE event listeners for `monitor:shutdown-pending` and `monitor:shutdown-cancelled`. Return countdown state.
- `src/monitor/ui/src/components/layout/shutdown-banner.tsx` — (new, listed above)
- `src/monitor/ui/src/app.tsx` — Destructure `shutdownCountdown` from `useEforgeEvents`. Render `ShutdownBanner` above the main content area when countdown is non-null.

## Verification

- [ ] `pnpm type-check` exits 0
- [ ] `pnpm test` exits 0 (all existing + new tests pass)
- [ ] `pnpm build` exits 0 (includes UI build)
- [ ] `test/monitor-recording.test.ts` has at least 2 test cases: one verifying `ensureMonitor({ noServer: true })` returns `server: null` with a working `wrapEvents`, one verifying events are inserted into the DB when `noServer` is true
- [ ] `test/monitor-shutdown.test.ts` has at least 3 test cases: lockfile missing (no-op), server alive with running runs (no SIGTERM sent), server alive with no running runs (SIGTERM sent)
- [ ] `src/monitor/index.ts` exports `signalMonitorShutdown` function
- [ ] `src/monitor/server.ts` `MonitorServer` interface includes `broadcast`, `subscriberCount`, and `onKeepAlive`
- [ ] `src/monitor/server-main.ts` contains the three states: WATCHING, COUNTDOWN, SHUTDOWN
- [ ] `src/cli/index.ts` `withMonitor` callback parameter type is `Monitor` (not `Monitor | undefined`)
- [ ] `src/cli/index.ts` `wrapEvents` has no conditional around `monitor.wrapEvents` (always calls it)
- [ ] `src/monitor/ui/src/hooks/use-eforge-events.ts` return type includes `shutdownCountdown: number | null`
- [ ] `src/monitor/ui/src/components/layout/shutdown-banner.tsx` exists and renders a button that POSTs to `/api/keep-alive`
- [ ] `src/monitor/ui/src/app.tsx` imports and renders `ShutdownBanner`
- [ ] `POST /api/keep-alive` route exists in `src/monitor/server.ts` request handler
